import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  ConnectionState,
  ConnectionQuality,
  createLocalAudioTrack,
  type Participant,
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type AudioProcessorOptions,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackProcessor,
} from 'livekit-client';
import type {
  LiveAudioAvailability,
  LiveAudioConnectionState,
  LiveAudioConnectionQuality,
  LiveAudioMicrophoneDiagnostics,
  LiveAudioParticipantRole,
  LiveAudioRemoteTrack,
  LiveAudioTokenResponse,
  MicrophoneTrackState,
} from '../../../types/liveAudio';
import { useLiveAudioAvailability } from './useLiveAudioAvailability';

interface UseLiveAudioOptions {
  role: LiveAudioParticipantRole;
  roomSession?: string;
  controlSessionId?: string;
  autoConnect?: boolean;
  microphoneVolumePercent?: number;
}

interface UseLiveAudioResult {
  state: LiveAudioConnectionState;
  connectionQuality: LiveAudioConnectionQuality;
  availability: LiveAudioAvailability;
  remoteTracks: LiveAudioRemoteTrack[];
  controlParticipants: { participantId: string; isMicrophoneActive: boolean }[];
  participantId: string | null;
  participantIdentity: string | null;
  isMicrophoneActive: boolean;
  microphoneTrackState: MicrophoneTrackState;
  isDuckingActive: boolean;
  startRemoteAudio: () => Promise<void>;
  publishMicrophone: (options?: { musicMode?: boolean }) => Promise<void>;
  unpublishMicrophone: () => Promise<void>;
  retryAudio: () => Promise<void>;
  disconnect: () => void;
  microphoneDiagnostics: LiveAudioMicrophoneDiagnostics;
  localMicrophoneTrack: MediaStreamTrack | null;
}

const TOKEN_REFRESH_MARGIN_MS = 2 * 60_000;
const RECONNECT_FAILURE_MS = 45_000;
const RECONNECTED_VISIBLE_MS = 3_000;

const canRolePublish = (role: LiveAudioParticipantRole) =>
  role === 'audience' || role === 'control' || role === 'presenter';

const clampVolumePercent = (value: number) => Math.max(0, Math.min(value, 300));

const createBrowserAudioContext = (): AudioContext | null => {
  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return AudioContextConstructor ? new AudioContextConstructor() : null;
};

const isPermissionDeniedError = (error: unknown) =>
  error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');

const getErrorName = (error: unknown) =>
  error instanceof Error ? error.name : typeof error === 'object' && error && 'name' in error ? String(error.name) : 'Error';

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const makeInitialMicrophoneDiagnostics = (): LiveAudioMicrophoneDiagnostics => ({
  secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
  mediaDevicesAvailable: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  permissionState: 'unknown',
  lastErrorName: null,
  lastErrorMessage: null,
});

const mapRoomState = (state: ConnectionState): LiveAudioConnectionState => {
  switch (state) {
    case ConnectionState.Connected:
      return 'connected';
    case ConnectionState.Connecting:
      return 'connecting';
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return 'reconnecting';
    case ConnectionState.Disconnected:
    default:
      return 'disconnected';
  }
};

const mapConnectionQuality = (quality: ConnectionQuality): LiveAudioConnectionQuality => {
  switch (quality) {
    case ConnectionQuality.Excellent:
      return 'excellent';
    case ConnectionQuality.Good:
      return 'good';
    case ConnectionQuality.Poor:
      return 'poor';
    case ConnectionQuality.Lost:
      return 'lost';
    default:
      return 'unknown';
  }
};

const getAudioMediaTrack = (track: RemoteTrack): MediaStreamTrack | null => {
  if (track.kind !== Track.Kind.Audio) return null;
  return track.mediaStreamTrack;
};

const getRemoteParticipantId = (participant?: RemoteParticipant): string | null => {
  if (!participant) return null;
  if (participant.metadata) {
    try {
      const metadata = JSON.parse(participant.metadata) as { participantId?: unknown };
      if (typeof metadata.participantId === 'string') return metadata.participantId;
    } catch {
      // Fall back to identity parsing below.
    }
  }

  const match = /^(audience|control|presenter)-(.+)$/.exec(participant.identity);
  return match?.[2] ?? null;
};

const createMicrophoneGainProcessor = (
  volumePercentRef: MutableRefObject<number>,
  gainNodeRef: MutableRefObject<GainNode | null>,
): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> => {
  let source: MediaStreamAudioSourceNode | null = null;
  let gain: GainNode | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;

  const destroy = async () => {
    source?.disconnect();
    gain?.disconnect();
    source = null;
    gain = null;
    destination?.stream.getTracks().forEach((track) => track.stop());
    destination = null;
    gainNodeRef.current = null;
    processor.processedTrack = undefined;
  };

  const processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = {
    name: 'sefer-microphone-gain',
    processedTrack: undefined,
    async init(options) {
      source = options.audioContext.createMediaStreamSource(new MediaStream([options.track]));
      gain = options.audioContext.createGain();
      gain.gain.value = clampVolumePercent(volumePercentRef.current) / 100;
      destination = options.audioContext.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(destination);
      processor.processedTrack = destination.stream.getAudioTracks()[0];
      gainNodeRef.current = gain;
    },
    async restart(options) {
      await destroy();
      await processor.init(options);
    },
    destroy,
  };

  return processor;
};

const requestToken = async (
  role: LiveAudioParticipantRole,
  roomSession?: string,
  controlSessionId?: string,
) => {
  let audienceAccessCredential: string | undefined;
  if (role === 'audience') {
    try {
      const stored = JSON.parse(localStorage.getItem('sefer-audience-access') || 'null') as { credential?: unknown } | null;
      if (typeof stored?.credential === 'string') audienceAccessCredential = stored.credential;
    } catch {
      audienceAccessCredential = undefined;
    }
  }
  const response = await fetch('/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ role, roomSession, controlSessionId, audienceAccessCredential }),
  });

  if (!response.ok) throw new Error('Live Audio token request failed');
  return (await response.json()) as LiveAudioTokenResponse;
};

const refreshToken = async (participantId: string, refreshCredential: string) => {
  let audienceAccessCredential: string | undefined;
  try {
    const stored = JSON.parse(localStorage.getItem('sefer-audience-access') || 'null') as { credential?: unknown } | null;
    if (typeof stored?.credential === 'string') audienceAccessCredential = stored.credential;
  } catch {
    audienceAccessCredential = undefined;
  }
  const response = await fetch('/api/livekit/refresh-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ participantId, refreshCredential, audienceAccessCredential }),
  });

  if (!response.ok) throw new Error('Live Audio token refresh failed');
  return (await response.json()) as LiveAudioTokenResponse;
};

const stopAllLocalTracks = (room: Room | null, localAudioTrack: LocalAudioTrack | null) => {
  room?.localParticipant.trackPublications.forEach((publication) => {
    publication.track?.stop();
  });
  localAudioTrack?.stop();
};


export const useLiveAudio = ({
  role,
  roomSession,
  controlSessionId,
  autoConnect = true,
  microphoneVolumePercent = 100,
}: UseLiveAudioOptions): UseLiveAudioResult => {
  const { availability } = useLiveAudioAvailability();
  const [state, setState] = useState<LiveAudioConnectionState>('disconnected');
  const [connectionQuality, setConnectionQuality] = useState<LiveAudioConnectionQuality>('unknown');
  const [remoteTracks, setRemoteTracks] = useState<LiveAudioRemoteTrack[]>([]);
  const [controlParticipants, setControlParticipants] = useState<UseLiveAudioResult['controlParticipants']>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [participantIdentity, setParticipantIdentity] = useState<string | null>(null);
  const [isMicrophoneActive, setIsMicrophoneActive] = useState(false);
  const [microphoneTrackState, setMicrophoneTrackState] = useState<MicrophoneTrackState>('notRequested');
  const [isDuckingActive, setIsDuckingActive] = useState(false);
  const [microphoneDiagnostics, setMicrophoneDiagnostics] = useState<LiveAudioMicrophoneDiagnostics>(makeInitialMicrophoneDiagnostics);

  const roomRef = useRef<Room | null>(null);
  const localAudioTrackRef = useRef<LocalAudioTrack | null>(null);
  const connectionRunRef = useRef(0);
  const isConnectingRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectFailureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<LiveAudioTokenResponse | null>(null);
  const participantIdRef = useRef<string | null>(null);
  const userDisconnectedRef = useRef(false);
  const microphoneVolumePercentRef = useRef(clampVolumePercent(microphoneVolumePercent));
  const microphoneGainNodeRef = useRef<GainNode | null>(null);
  const microphoneAudioContextRef = useRef<AudioContext | null>(null);
  const microphoneProcessorRef = useRef<TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> | null>(null);
  const isPublishingMicrophoneRef = useRef(false);

  const observeControls = useCallback((room: Room) => {
    const update = () => {
      if (roomRef.current !== room) return;
      setControlParticipants(Array.from(room.remoteParticipants.values())
        .filter(participant => participant.identity.startsWith('control-'))
        .flatMap(participant => {
          const id = getRemoteParticipantId(participant);
          return id ? [{ participantId: id, isMicrophoneActive: participant.isMicrophoneEnabled }] : [];
        }));
    };
    room.on(RoomEvent.Connected, update).on(RoomEvent.Reconnected, update)
      .on(RoomEvent.ParticipantConnected, update).on(RoomEvent.ParticipantDisconnected, update)
      .on(RoomEvent.TrackMuted, update).on(RoomEvent.TrackUnmuted, update)
      .on(RoomEvent.TrackPublished, update).on(RoomEvent.TrackUnpublished, update)
      .on(RoomEvent.Disconnected, () => { if (roomRef.current === room) setControlParticipants([]); });
  }, []);

  useEffect(() => {
    participantIdRef.current = participantId;
  }, [participantId]);

  useEffect(() => {
    let cancelled = false;
    let permissionStatus: PermissionStatus | null = null;
    let permissionChangeHandler: (() => void) | null = null;

    setMicrophoneDiagnostics((current) => ({
      ...current,
      secureContext: window.isSecureContext,
      mediaDevicesAvailable: !!navigator.mediaDevices?.getUserMedia,
    }));

    if (!navigator.permissions?.query) {
      setMicrophoneDiagnostics((current) => ({
        ...current,
        permissionState: 'unsupported',
      }));
      return;
    }

    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((status) => {
        if (cancelled) return;
        permissionStatus = status;
        const updateState = () => {
          setMicrophoneDiagnostics((current) => ({
            ...current,
            permissionState: status.state,
          }));
        };
        permissionChangeHandler = updateState;
        updateState();
        status.addEventListener('change', updateState);
      })
      .catch(() => {
        if (!cancelled) {
          setMicrophoneDiagnostics((current) => ({
            ...current,
            permissionState: 'unsupported',
          }));
        }
      });

    return () => {
      cancelled = true;
      if (permissionStatus && permissionChangeHandler) {
        permissionStatus.removeEventListener('change', permissionChangeHandler);
      }
    };
  }, []);

  useEffect(() => {
    const volume = clampVolumePercent(microphoneVolumePercent);
    microphoneVolumePercentRef.current = volume;
    if (microphoneGainNodeRef.current) microphoneGainNodeRef.current.gain.value = volume / 100;
  }, [microphoneVolumePercent]);

  const clearTimer = (timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const clearLifecycleTimers = useCallback(() => {
    clearTimer(refreshTimerRef);
    clearTimer(reconnectFailureTimerRef);
    clearTimer(reconnectedTimerRef);
  }, []);

  const clearMicrophoneProcessor = useCallback(() => {
    const processor = microphoneProcessorRef.current;
    microphoneProcessorRef.current = null;
    microphoneGainNodeRef.current = null;
    if (processor) void processor.destroy().catch(() => undefined);

    const context = microphoneAudioContextRef.current;
    microphoneAudioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }, []);

  const setConnectedState = useCallback((nextState: LiveAudioConnectionState) => {
    clearTimer(reconnectFailureTimerRef);
    clearTimer(reconnectedTimerRef);
    setState((current) => {
      if (nextState === 'connected' && current === 'reconnecting') {
        reconnectedTimerRef.current = setTimeout(() => {
          setState('connected');
          reconnectedTimerRef.current = null;
        }, RECONNECTED_VISIBLE_MS);
        return 'reconnected';
      }
      return nextState;
    });
  }, []);

  const scheduleReconnectFailure = useCallback((runId: number) => {
    clearTimer(reconnectFailureTimerRef);
    reconnectFailureTimerRef.current = setTimeout(() => {
      if (connectionRunRef.current === runId) {
        setState('reconnectFailed');
      }
    }, RECONNECT_FAILURE_MS);
  }, []);

  const addRemoteTrack = useCallback((track: RemoteTrack, participant?: RemoteParticipant) => {
    const mediaStreamTrack = getAudioMediaTrack(track);
    if (!mediaStreamTrack) return;

    const remoteTrack: LiveAudioRemoteTrack = {
      id: mediaStreamTrack.id,
      track: mediaStreamTrack,
      attach: (element) => {
        track.attach(element);
      },
      detach: (element) => {
        track.detach(element);
      },
      participantId: getRemoteParticipantId(participant),
      participantIdentity: participant?.identity ?? null,
    };
    setRemoteTracks((current) => current.some((item) => item.id === mediaStreamTrack.id) ? current : [...current, remoteTrack]);
  }, []);

  const removeRemoteTrack = useCallback((track: RemoteTrack) => {
    const mediaStreamTrack = getAudioMediaTrack(track);
    if (!mediaStreamTrack) return;
    setRemoteTracks((current) => current.filter((item) => item.id !== mediaStreamTrack.id));
  }, []);

  const subscribePublication = useCallback((publication: RemoteTrackPublication, participant?: RemoteParticipant) => {
    publication.setSubscribed(publication.kind === Track.Kind.Audio);
    if (publication.kind === Track.Kind.Audio && publication.track) {
      addRemoteTrack(publication.track, participant);
    }
  }, [addRemoteTrack]);

  const subscribeExistingAudio = useCallback((room: Room) => {
    room.remoteParticipants.forEach((participant: RemoteParticipant) => {
      participant.trackPublications.forEach((publication) => subscribePublication(publication, participant));
    });
  }, [subscribePublication]);

  const unpublishMicrophone = useCallback(async () => {
    const room = roomRef.current;
    const localTrack = localAudioTrackRef.current;
    if (!localTrack) {
      setIsMicrophoneActive(false);
      setMicrophoneTrackState('off');
      return;
    }

    localAudioTrackRef.current = null;
    try {
      if (room?.state === ConnectionState.Connected) {
        await room.localParticipant.unpublishTrack(localTrack, true);
      }
    } finally {
      stopAllLocalTracks(room, localTrack);
      clearMicrophoneProcessor();
      setIsMicrophoneActive(false);
      setMicrophoneTrackState('off');
    }
  }, [clearMicrophoneProcessor]);

  const disconnect = useCallback(() => {
    userDisconnectedRef.current = true;
    connectionRunRef.current += 1;
    clearLifecycleTimers();
    const room = roomRef.current;
    void unpublishMicrophone();
    stopAllLocalTracks(room, localAudioTrackRef.current);
    clearMicrophoneProcessor();
    localAudioTrackRef.current = null;
    roomRef.current = null;
    tokenRef.current = null;
    participantIdRef.current = null;
    setRemoteTracks([]);
    setControlParticipants([]);
    setParticipantId(null);
    setParticipantIdentity(null);
    setIsDuckingActive(false);
    window.dispatchEvent(new CustomEvent('sefer-autoduck', { detail: { active: false, isDuckingActive: false } }));
    setConnectionQuality('unknown');
    setState(availability === 'enabled' ? 'disconnected' : 'unavailable');
    if (room) {
      room.removeAllListeners();
      void room.disconnect(true);
    }
  }, [availability, clearLifecycleTimers, clearMicrophoneProcessor, unpublishMicrophone]);

  const scheduleTokenRefresh = useCallback((tokenResponse: LiveAudioTokenResponse, runId: number) => {
    clearTimer(refreshTimerRef);
    const timeUntilExpiry = tokenResponse.expiresInMs ?? (tokenResponse.expiresAt - Date.now());
    const delayMs = Math.max(timeUntilExpiry - TOKEN_REFRESH_MARGIN_MS, 5_000);

    refreshTimerRef.current = setTimeout(() => {
      const activeParticipantId = participantIdRef.current;
      if (!activeParticipantId || connectionRunRef.current !== runId) return;

      void refreshToken(activeParticipantId, tokenResponse.refreshCredential)
        .then((nextToken) => {
          if (connectionRunRef.current !== runId) return;
          if (nextToken.participantId !== activeParticipantId) {
            throw new Error('Live Audio token refresh returned a different participant');
          }
          tokenRef.current = nextToken;
          setParticipantIdentity(nextToken.participantIdentity);
          scheduleTokenRefresh(nextToken, runId);
        })
        .catch(() => {
          if (connectionRunRef.current === runId) setState('reconnectFailed');
        });
    }, delayMs);
  }, []);

  const publishMicrophone = useCallback(async (options?: { musicMode?: boolean }) => {
    if (!canRolePublish(role)) {
      throw new Error('This Live Audio role cannot publish microphone audio');
    }
    let room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) {
      throw new Error('Live Audio room is not connected');
    }
    if (localAudioTrackRef.current) return;
    if (isPublishingMicrophoneRef.current) return;

    isPublishingMicrophoneRef.current = true;
    setIsMicrophoneActive(false);
    setMicrophoneTrackState('publishing');
    const startedAt = performance.now();
    let stage = 'permission';
    console.log('[LIVEKIT] livekit:microphone:capture-start');
    let pendingLocalTrack: LocalAudioTrack | null = null;
    try {
      const activeParticipantId = participantIdRef.current;
      if (role === 'audience' && activeParticipantId && room.localParticipant.permissions?.canPublish !== true) {
        throw new Error('LiveKit todavía no ha confirmado el permiso para publicar. Reintenta el micrófono.');
      }
      stage = 'capture';
      const localTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: !options?.musicMode,
        autoGainControl: !options?.musicMode,
      });
      console.log(`[LIVEKIT] livekit:microphone:track-created durationMs=${Math.round(performance.now() - startedAt)}`);
      pendingLocalTrack = localTrack;
      stage = 'processing';
      const audioContext = createBrowserAudioContext();
      if (audioContext) {
        try {
          localTrack.setAudioContext(audioContext);
          const processor = createMicrophoneGainProcessor(microphoneVolumePercentRef, microphoneGainNodeRef);
          await localTrack.setProcessor(processor);
          microphoneAudioContextRef.current = audioContext;
          microphoneProcessorRef.current = processor;
          console.log(`[LIVEKIT] livekit:microphone:processor-ready durationMs=${Math.round(performance.now() - startedAt)}`);
        } catch {
          if (audioContext.state !== 'closed') void audioContext.close().catch(() => undefined);
          microphoneGainNodeRef.current = null;
          microphoneAudioContextRef.current = null;
          microphoneProcessorRef.current = null;
        }
      }
      stage = 'publication';
      await room.localParticipant.publishTrack(localTrack, {
        source: Track.Source.Microphone,
        name: 'microphone',
        dtx: true,
        red: true,
      });
      localAudioTrackRef.current = localTrack;
      pendingLocalTrack = null;
      setIsMicrophoneActive(true);
      setMicrophoneTrackState('published');
      console.log(`[LIVEKIT] livekit:microphone:published durationMs=${Math.round(performance.now() - startedAt)}`);
      setMicrophoneDiagnostics((current) => ({
        ...current,
        lastErrorName: null,
        lastErrorMessage: null,
      }));
    } catch (error) {
      setIsMicrophoneActive(false);
      setMicrophoneTrackState('error');
      console.warn(`[LIVEKIT] livekit:microphone:failed stage=${stage} error=${getErrorName(error)} durationMs=${Math.round(performance.now() - startedAt)}`);
      setMicrophoneDiagnostics((current) => ({
        ...current,
        permissionState: isPermissionDeniedError(error) ? 'denied' : current.permissionState,
        lastErrorName: getErrorName(error),
        lastErrorMessage: getErrorMessage(error),
      }));
      if (isPermissionDeniedError(error)) {
        console.log(`[LIVEKIT] livekit:microphone:permission-denied`);
        setState('permissionDenied');
      }
      pendingLocalTrack?.stop();
      clearMicrophoneProcessor();
      throw error;
    } finally {
      isPublishingMicrophoneRef.current = false;
    }
  }, [clearMicrophoneProcessor, role]);

  const startRemoteAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    await room.startAudio();
  }, []);

  useEffect(() => {
    const runId = connectionRunRef.current + 1;
    connectionRunRef.current = runId;

    if (!autoConnect || availability !== 'enabled') {
      disconnect();
      if (availability !== 'enabled') setState('unavailable');
      return;
    }

    userDisconnectedRef.current = false;
    let cancelled = false;
    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      stopLocalTrackOnUnpublish: true,
    });
    roomRef.current = room;
    observeControls(room);

    const handleConnectionStateChanged = (nextState: ConnectionState) => {
      if (connectionRunRef.current !== runId) return;
      const mappedState = mapRoomState(nextState);
      if (mappedState === 'reconnecting') {
        setState('reconnecting');
        scheduleReconnectFailure(runId);
        return;
      }
      if (mappedState === 'connected') {
        setConnectedState('connected');
        return;
      }
      setState(mappedState);
    };
    const handleConnectionQualityChanged = (quality: ConnectionQuality, participant: Participant) => {
      if (connectionRunRef.current !== runId) return;
      if (participant.sid !== room.localParticipant.sid) return;
      setConnectionQuality(mapConnectionQuality(quality));
    };
    const handleTrackPublished = (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      subscribePublication(publication, participant);
    };
    const handleTrackSubscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      addRemoteTrack(track, participant);
    };
    const handleTrackUnsubscribed = (track: RemoteTrack) => {
      removeRemoteTrack(track);
    };

    room
      .on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
      .on(RoomEvent.ConnectionQualityChanged, handleConnectionQualityChanged)
      .on(RoomEvent.TrackPublished, handleTrackPublished)
      .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        if (connectionRunRef.current !== runId) return;
        const duckRoles = (import.meta.env.VITE_AUTODUCK_ROLES || 'control,audience').split(',');
        const active = speakers.some(p => {
          const match = /^(audience|control|presenter)-(.+)$/.exec(p.identity);
          const participantRole = match?.[1];
          return participantRole && duckRoles.includes(participantRole);
        });
        setIsDuckingActive(active);
        window.dispatchEvent(new CustomEvent('sefer-autoduck', { detail: { active, isDuckingActive: active } }));
      })
      .on(RoomEvent.Disconnected, () => {
        if (connectionRunRef.current !== runId || userDisconnectedRef.current) return;
        setState('reconnecting');
        scheduleReconnectFailure(runId);
      });

    const connect = async () => {
      if (isConnectingRef.current || room.state === ConnectionState.Connected) return;
      isConnectingRef.current = true;
      setState('connecting');
      try {
        const existingParticipantId = participantIdRef.current;
        console.log(`[LIVEKIT] livekit:connect:start role=${role}`);
        const tokenResponse = existingParticipantId
          ? await refreshToken(existingParticipantId, tokenRef.current?.refreshCredential || '')
          : await requestToken(role, roomSession, controlSessionId);
        if (cancelled || connectionRunRef.current !== runId) return;
        tokenRef.current = tokenResponse;
        setParticipantId(tokenResponse.participantId);
        setParticipantIdentity(tokenResponse.participantIdentity);
        await room.connect(tokenResponse.livekitUrl, tokenResponse.token, { autoSubscribe: false });
        if (cancelled || connectionRunRef.current !== runId) return;
        console.log(`[LIVEKIT] livekit:connect:success`);
        subscribeExistingAudio(room);
        scheduleTokenRefresh(tokenResponse, runId);
        setConnectionQuality(mapConnectionQuality(room.localParticipant.connectionQuality));
        setConnectedState('connected');
      } catch (err) {
        if (cancelled || connectionRunRef.current !== runId) return;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`[LIVEKIT] livekit:connect:fail error=${errMsg}`);
        if (errMsg.toLowerCase().includes('invalid token') || errMsg.toLowerCase().includes('expired') || errMsg.toLowerCase().includes('unauthorized')) {
          console.log(`[LIVEKIT] livekit:invalid-token:retry discarding token and retrying once...`);
          tokenRef.current = null;
          setParticipantId(null);
          setParticipantIdentity(null);
          participantIdRef.current = null;
          
          try {
            const tokenResponse = await requestToken(role, roomSession, controlSessionId);
            if (cancelled || connectionRunRef.current !== runId) return;
            tokenRef.current = tokenResponse;
            setParticipantId(tokenResponse.participantId);
            setParticipantIdentity(tokenResponse.participantIdentity);
            await room.connect(tokenResponse.livekitUrl, tokenResponse.token, { autoSubscribe: false });
            if (cancelled || connectionRunRef.current !== runId) return;
            console.log(`[LIVEKIT] livekit:connect:success (retry)`);
            subscribeExistingAudio(room);
            scheduleTokenRefresh(tokenResponse, runId);
            setConnectionQuality(mapConnectionQuality(room.localParticipant.connectionQuality));
            setConnectedState('connected');
            return;
          } catch (retryErr) {
            if (cancelled || connectionRunRef.current !== runId) return;
            const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            console.log(`[LIVEKIT] livekit:connect:fail error=${retryErrMsg} (retry)`);
          }
        }
        setState(participantIdRef.current ? 'reconnectFailed' : 'unavailable');
      } finally {
        isConnectingRef.current = false;
      }
    };

    void connect();

    return () => {
      cancelled = true;
      clearLifecycleTimers();
      if (roomRef.current === room) roomRef.current = null;
      room.removeAllListeners();
      void unpublishMicrophone();
      stopAllLocalTracks(room, localAudioTrackRef.current);
      clearMicrophoneProcessor();
      localAudioTrackRef.current = null;
      void room.disconnect(true);
      setRemoteTracks([]);
      setControlParticipants([]);
    };
  }, [
    addRemoteTrack,
    autoConnect,
    availability,
    clearMicrophoneProcessor,
    disconnect,
    removeRemoteTrack,
    role,
    roomSession,
    scheduleReconnectFailure,
    scheduleTokenRefresh,
    setConnectedState,
    subscribeExistingAudio,
    subscribePublication,
    unpublishMicrophone,
    clearLifecycleTimers,
    controlSessionId,
    observeControls,
  ]);

  const retryAudio = useCallback(async () => {
    connectionRunRef.current += 1;
    const runId = connectionRunRef.current;
    clearLifecycleTimers();
    userDisconnectedRef.current = false;

    const previousRoom = roomRef.current;
    void unpublishMicrophone();
    stopAllLocalTracks(previousRoom, localAudioTrackRef.current);
    clearMicrophoneProcessor();
    localAudioTrackRef.current = null;
    previousRoom?.removeAllListeners();
    await previousRoom?.disconnect(true);

    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      stopLocalTrackOnUnpublish: true,
    });
    roomRef.current = room;
    observeControls(room);
    setRemoteTracks([]);
    setControlParticipants([]);
    setState('connecting');

    room
      .on(RoomEvent.ConnectionStateChanged, (nextState: ConnectionState) => {
        if (connectionRunRef.current !== runId) return;
        const mappedState = mapRoomState(nextState);
        if (mappedState === 'reconnecting') {
          setState('reconnecting');
          scheduleReconnectFailure(runId);
          return;
        }
        if (mappedState === 'connected') {
          setConnectedState('connected');
          return;
        }
        setState(mappedState);
      })
      .on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant) => {
        if (connectionRunRef.current !== runId) return;
        if (participant.sid !== room.localParticipant.sid) return;
        setConnectionQuality(mapConnectionQuality(quality));
      })
      .on(RoomEvent.TrackPublished, subscribePublication)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        addRemoteTrack(track, participant);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        removeRemoteTrack(track);
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        if (connectionRunRef.current !== runId) return;
        const duckRoles = (import.meta.env.VITE_AUTODUCK_ROLES || 'control,audience').split(',');
        const active = speakers.some(p => {
          const match = /^(audience|control|presenter)-(.+)$/.exec(p.identity);
          const participantRole = match?.[1];
          return participantRole && duckRoles.includes(participantRole);
        });
        setIsDuckingActive(active);
        window.dispatchEvent(new CustomEvent('sefer-autoduck', { detail: { active, isDuckingActive: active } }));
      });

    try {
      isConnectingRef.current = true;
      const activeParticipantId = participantIdRef.current;
      console.log(`[LIVEKIT] livekit:connect:start role=${role} (retryAudio)`);
      const tokenResponse = activeParticipantId
        ? await refreshToken(activeParticipantId, tokenRef.current?.refreshCredential || '')
        : await requestToken(role, roomSession, controlSessionId);
      if (connectionRunRef.current !== runId) return;
      tokenRef.current = tokenResponse;
      setParticipantId(tokenResponse.participantId);
      setParticipantIdentity(tokenResponse.participantIdentity);
      await room.connect(tokenResponse.livekitUrl, tokenResponse.token, { autoSubscribe: false });
      if (connectionRunRef.current !== runId) return;
      console.log(`[LIVEKIT] livekit:connect:success`);
      subscribeExistingAudio(room);
      scheduleTokenRefresh(tokenResponse, runId);
      setConnectionQuality(mapConnectionQuality(room.localParticipant.connectionQuality));
      setConnectedState('connected');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`[LIVEKIT] livekit:connect:fail error=${errMsg}`);
      if (connectionRunRef.current === runId) setState('reconnectFailed');
    } finally {
      isConnectingRef.current = false;
    }
  }, [
    addRemoteTrack,
    clearMicrophoneProcessor,
    clearLifecycleTimers,
    controlSessionId,
    removeRemoteTrack,
    role,
    roomSession,
    scheduleReconnectFailure,
    scheduleTokenRefresh,
    setConnectedState,
    subscribeExistingAudio,
    subscribePublication,
    unpublishMicrophone,
    observeControls,
  ]);

  useEffect(() => {
    type WakeLockSentinelLike = { release: () => Promise<void> };
    type NavigatorWithWakeLock = Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    let wakeLock: WakeLockSentinelLike | null = null;

    const requestWakeLock = async () => {
      const wakeLockManager = (navigator as NavigatorWithWakeLock).wakeLock;
      if (isMicrophoneActive && wakeLockManager) {
        try {
          wakeLock = await wakeLockManager.request('screen');
          console.log('[LIVEKIT] wakeLock active (screen)');
        } catch (err) {
          console.error('[LIVEKIT] wakeLock failed:', err);
        }
      }
    };

    void requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isMicrophoneActive && wakeLock === null) {
        void requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
      }
    };
  }, [isMicrophoneActive]);

  return useMemo(() => ({
    state,
    connectionQuality,
    availability,
    remoteTracks,
    controlParticipants,
    participantId,
    participantIdentity,
    isMicrophoneActive,
    microphoneTrackState,
    isDuckingActive,
    startRemoteAudio,
    publishMicrophone,
    unpublishMicrophone,
    retryAudio,
    disconnect,
    microphoneDiagnostics,
    localMicrophoneTrack: localAudioTrackRef.current?.mediaStreamTrack || null,
  }), [
    availability,
    disconnect,
    isMicrophoneActive,
    microphoneTrackState,
    isDuckingActive,
    connectionQuality,
    participantId,
    participantIdentity,
    publishMicrophone,
    retryAudio,
    remoteTracks,
    controlParticipants,
    startRemoteAudio,
    state,
    unpublishMicrophone,
    microphoneDiagnostics,
  ]);
};
