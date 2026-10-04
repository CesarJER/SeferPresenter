import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  ConnectionState,
  ConnectionQuality,
  DisconnectReason,
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
  microphoneDeviceId?: string;
}

interface UseLiveAudioResult {
  state: LiveAudioConnectionState;
  connectionQuality: LiveAudioConnectionQuality;
  availability: LiveAudioAvailability;
  remoteTracks: LiveAudioRemoteTrack[];
  controlParticipants: { participantId: string; isMicrophoneActive: boolean }[];
  participantId: string | null;
  participantIdentity: string | null;
  sessionRevision: number;
  isMicrophoneActive: boolean;
  microphoneTrackState: MicrophoneTrackState;
  isDuckingActive: boolean;
  hasAudioStarted: boolean;
  startRemoteAudio: () => Promise<boolean>;
  publishMicrophone: (options?: { musicMode?: boolean }) => Promise<void>;
  republishMicrophone: (options: { musicMode: boolean }) => Promise<void>;
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

export const isMicrophonePublicationCancelled = (error: unknown) => getErrorName(error) === 'AbortError';

class LiveAudioRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const readTokenResponse = async (response: Response): Promise<LiveAudioTokenResponse> => {
  const body = await response.json().catch(() => null) as (LiveAudioTokenResponse & { error?: unknown; code?: unknown }) | null;
  if (!response.ok) {
    throw new LiveAudioRequestError(
      response.status,
      typeof body?.code === 'string' ? body.code : null,
      typeof body?.error === 'string' ? body.error : `Live Audio request failed (HTTP ${response.status})`,
    );
  }
  if (!body) throw new Error('Live Audio returned an invalid token response');
  return body;
};

interface MicrophonePublicationOperation {
  cancelled: boolean;
  track: LocalAudioTrack | null;
  audioContext: AudioContext | null;
  processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> | null;
  promise: Promise<void>;
}

const disposePendingMicrophone = (operation: MicrophonePublicationOperation) => {
  operation.track?.stop();
  if (operation.processor) void operation.processor.destroy().catch(() => undefined);
  if (operation.audioContext && operation.audioContext.state !== 'closed') {
    void operation.audioContext.close().catch(() => undefined);
  }
};

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

  return readTokenResponse(response);
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

  return readTokenResponse(response);
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
  microphoneDeviceId,
}: UseLiveAudioOptions): UseLiveAudioResult => {
  const { availability } = useLiveAudioAvailability();
  const [state, setState] = useState<LiveAudioConnectionState>('disconnected');
  const [connectionQuality, setConnectionQuality] = useState<LiveAudioConnectionQuality>('unknown');
  const [remoteTracks, setRemoteTracks] = useState<LiveAudioRemoteTrack[]>([]);
  const [controlParticipants, setControlParticipants] = useState<UseLiveAudioResult['controlParticipants']>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [participantIdentity, setParticipantIdentity] = useState<string | null>(null);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [isMicrophoneActive, setIsMicrophoneActive] = useState(false);
  const [microphoneTrackState, setMicrophoneTrackState] = useState<MicrophoneTrackState>('notRequested');
  const [isDuckingActive, setIsDuckingActive] = useState(false);
  const [hasAudioStarted, setHasAudioStarted] = useState(false);
  const [microphoneDiagnostics, setMicrophoneDiagnostics] = useState<LiveAudioMicrophoneDiagnostics>(makeInitialMicrophoneDiagnostics);

  const roomRef = useRef<Room | null>(null);
  const localAudioTrackRef = useRef<LocalAudioTrack | null>(null);
  const connectionRunRef = useRef(0);
  const connectingRunRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectFailureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<LiveAudioTokenResponse | null>(null);
  const participantIdRef = useRef<string | null>(null);
  const userDisconnectedRef = useRef(false);
  const automaticRecoveryRef = useRef(true);
  const recoveryAttemptsRef = useRef(0);
  const microphoneVolumePercentRef = useRef(clampVolumePercent(microphoneVolumePercent));
  const microphoneDeviceIdRef = useRef(microphoneDeviceId);
  const microphoneGainNodeRef = useRef<GainNode | null>(null);
  const microphoneAudioContextRef = useRef<AudioContext | null>(null);
  const microphoneProcessorRef = useRef<TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> | null>(null);
  const microphonePublicationRef = useRef<MicrophonePublicationOperation | null>(null);
  const microphoneIntentRef = useRef(0);
  const pendingRefreshRef = useRef<{
    participantId: string; credential: string; promise: Promise<LiveAudioTokenResponse>;
  } | null>(null);

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

  useEffect(() => {
    microphoneDeviceIdRef.current = microphoneDeviceId;
  }, [microphoneDeviceId]);

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
    recoveryAttemptsRef.current = 0;
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
    microphoneIntentRef.current += 1;
    const pending = microphonePublicationRef.current;
    if (pending) {
      pending.cancelled = true;
      disposePendingMicrophone(pending);
    }
    const room = roomRef.current;
    const localTrack = localAudioTrackRef.current;
    setIsMicrophoneActive(false);
    setMicrophoneTrackState('off');
    clearMicrophoneProcessor();
    if (!localTrack) {
      return;
    }

    localAudioTrackRef.current = null;
    try {
      if (room?.state === ConnectionState.Connected) {
        await room.localParticipant.unpublishTrack(localTrack, true);
      }
    } finally {
      localTrack.stop();
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
    pendingRefreshRef.current = null;
    participantIdRef.current = null;
    setRemoteTracks([]);
    setControlParticipants([]);
    setParticipantId(null);
    setParticipantIdentity(null);
    setIsDuckingActive(false);
    setHasAudioStarted(false);
    window.dispatchEvent(new CustomEvent('sefer-autoduck', { detail: { active: false, isDuckingActive: false } }));
    setConnectionQuality('unknown');
    setState(availability === 'enabled' ? 'disconnected' : 'unavailable');
    if (room) {
      room.removeAllListeners();
      void room.disconnect(true);
    }
  }, [availability, clearLifecycleTimers, clearMicrophoneProcessor, unpublishMicrophone]);

  const refreshCurrentToken = useCallback((id: string, credential: string) => {
    if (pendingRefreshRef.current?.participantId !== id || pendingRefreshRef.current.credential !== credential) {
      const promise = refreshToken(id, credential).finally(() => {
        if (pendingRefreshRef.current?.promise === promise) pendingRefreshRef.current = null;
      });
      pendingRefreshRef.current = { participantId: id, credential, promise };
    }
    return pendingRefreshRef.current.promise;
  }, []);

  const requestConnectionToken = useCallback(async () => {
    const runId = connectionRunRef.current;
    const token = await requestToken(role, roomSession, controlSessionId);
    if (connectionRunRef.current === runId) setSessionRevision((value) => value + 1);
    return token;
  }, [controlSessionId, role, roomSession]);

  const obtainConnectionToken = useCallback(async () => {
    const runId = connectionRunRef.current;
    const id = participantIdRef.current;
    if (id) {
      try {
        const token = await refreshCurrentToken(id, tokenRef.current?.refreshCredential || '');
        if (connectionRunRef.current !== runId) throw new DOMException('Connection attempt cancelled', 'AbortError');
        if (token.participantId !== id) throw new Error('Live Audio token refresh returned a different participant');
        return token;
      } catch (error) {
        if (connectionRunRef.current !== runId) throw new DOMException('Connection attempt cancelled', 'AbortError');
        const recoverable = error instanceof LiveAudioRequestError && (
          (error.status === 401 && error.code === 'session_expired') ||
          (error.status === 403 && error.code === 'participant_inactive')
        );
        if (!recoverable) throw error;
        tokenRef.current = null;
        participantIdRef.current = null;
        setParticipantId(null);
        setParticipantIdentity(null);
      }
    }
    return requestConnectionToken();
  }, [refreshCurrentToken, requestConnectionToken]);

  const scheduleTokenRefresh = useCallback((tokenResponse: LiveAudioTokenResponse, runId: number) => {
    clearTimer(refreshTimerRef);
    const timeUntilExpiry = tokenResponse.expiresInMs ?? (tokenResponse.expiresAt - Date.now());
    const delayMs = Math.max(timeUntilExpiry - TOKEN_REFRESH_MARGIN_MS, 5_000);

    const renew = () => {
      const activeParticipantId = participantIdRef.current;
      if (!activeParticipantId || connectionRunRef.current !== runId) return;

      void refreshCurrentToken(activeParticipantId, tokenResponse.refreshCredential)
        .then((nextToken) => {
          if (connectionRunRef.current !== runId) return;
          if (nextToken.participantId !== activeParticipantId) {
            throw new Error('Live Audio token refresh returned a different participant');
          }
          tokenRef.current = nextToken;
          setParticipantIdentity(nextToken.participantIdentity);
          scheduleTokenRefresh(nextToken, runId);
        })
        .catch((error) => {
          if (connectionRunRef.current !== runId) return;
          // A failed API renewal does not mean the media connection failed.
          // Keep listening and retry transient errors without replacing Room.
          if (error instanceof LiveAudioRequestError && error.status < 500) {
            automaticRecoveryRef.current =
              (error.status === 401 && error.code === 'session_expired') ||
              (error.status === 403 && error.code === 'participant_inactive');
          } else {
            refreshTimerRef.current = setTimeout(renew, 30_000);
          }
        });
    };
    refreshTimerRef.current = setTimeout(renew, delayMs);
  }, [refreshCurrentToken]);

  const publishMicrophone = useCallback(async (options?: { musicMode?: boolean }) => {
    if (!canRolePublish(role)) {
      throw new Error('This Live Audio role cannot publish microphone audio');
    }
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) {
      throw new Error('Live Audio room is not connected');
    }
    if (localAudioTrackRef.current) return;
    if (microphonePublicationRef.current) return microphonePublicationRef.current.promise;
    const operation: MicrophonePublicationOperation = {
      cancelled: false, track: null, audioContext: null, processor: null, promise: Promise.resolve(),
    };
    const runId = connectionRunRef.current;
    const checkCurrent = () => {
      if (operation.cancelled || connectionRunRef.current !== runId || roomRef.current !== room ||
          room.state !== ConnectionState.Connected ||
          (role === 'audience' && room.localParticipant.permissions?.canPublish !== true)) {
        throw new DOMException('Microphone publication cancelled', 'AbortError');
      }
    };
    microphonePublicationRef.current = operation;
    operation.promise = (async () => {
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
        deviceId: microphoneDeviceIdRef.current !== 'default' ? microphoneDeviceIdRef.current : undefined,
        echoCancellation: true,
        noiseSuppression: !options?.musicMode,
        autoGainControl: !options?.musicMode,
      });
      console.log(`[LIVEKIT] livekit:microphone:track-created durationMs=${Math.round(performance.now() - startedAt)}`);
      pendingLocalTrack = localTrack;
      operation.track = localTrack;
      checkCurrent();
      stage = 'processing';
      const audioContext = createBrowserAudioContext();
      operation.audioContext = audioContext;
      if (audioContext) {
        try {
          localTrack.setAudioContext(audioContext);
          const processor = createMicrophoneGainProcessor(microphoneVolumePercentRef, microphoneGainNodeRef);
          operation.processor = processor;
          await localTrack.setProcessor(processor);
          checkCurrent();
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
      checkCurrent();
      await room.localParticipant.publishTrack(localTrack, {
        source: Track.Source.Microphone,
        name: 'microphone',
        dtx: true,
        red: true,
      });
      try {
        checkCurrent();
      } catch (error) {
        await room.localParticipant.unpublishTrack(localTrack, true).catch(() => undefined);
        throw error;
      }
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
      pendingLocalTrack?.stop();
      disposePendingMicrophone(operation);
      if (operation.cancelled || connectionRunRef.current !== runId || isMicrophonePublicationCancelled(error)) {
        throw new DOMException('Microphone publication cancelled', 'AbortError');
      }
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
      }
      pendingLocalTrack?.stop();
      clearMicrophoneProcessor();
      throw error;
    } finally {
      if (microphonePublicationRef.current === operation) microphonePublicationRef.current = null;
    }
    })();
    return operation.promise;
  }, [clearMicrophoneProcessor, role]);

  const republishMicrophone = useCallback(async (options: { musicMode: boolean }) => {
    if (!localAudioTrackRef.current && !microphonePublicationRef.current) return;
    const expectedIntent = microphoneIntentRef.current + 1;
    const pending = microphonePublicationRef.current?.promise;
    await unpublishMicrophone();
    await pending?.catch(() => undefined);
    if (microphoneIntentRef.current !== expectedIntent) {
      throw new DOMException('Microphone configuration cancelled', 'AbortError');
    }
    await publishMicrophone(options);
  }, [publishMicrophone, unpublishMicrophone]);

  const startRemoteAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return false;
    await room.startAudio();
    if (roomRef.current !== room || room.state !== ConnectionState.Connected) return false;
    setHasAudioStarted(true);
    return true;
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
    setHasAudioStarted(false);
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
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (connectionRunRef.current !== runId || userDisconnectedRef.current) return;
        automaticRecoveryRef.current = automaticRecoveryRef.current && ![
          DisconnectReason.CLIENT_INITIATED, DisconnectReason.DUPLICATE_IDENTITY,
          DisconnectReason.PARTICIPANT_REMOVED, DisconnectReason.ROOM_DELETED,
        ].includes(reason as DisconnectReason);
        void unpublishMicrophone();
        setState('reconnectFailed');
      });

    const connect = async () => {
      if (connectingRunRef.current === runId || room.state === ConnectionState.Connected) return;
      connectingRunRef.current = runId;
      setState('connecting');
      try {
        console.log(`[LIVEKIT] livekit:connect:start role=${role}`);
        const tokenResponse = await obtainConnectionToken();
        if (cancelled || connectionRunRef.current !== runId) return;
        tokenRef.current = tokenResponse;
        setParticipantId(tokenResponse.participantId);
        setParticipantIdentity(tokenResponse.participantIdentity);
        await room.connect(tokenResponse.livekitUrl, tokenResponse.token, { autoSubscribe: false });
        if (cancelled || connectionRunRef.current !== runId) return;
        console.log(`[LIVEKIT] livekit:connect:success`);
        subscribeExistingAudio(room);
        scheduleTokenRefresh(tokenResponse, runId);
        automaticRecoveryRef.current = true;
        setConnectionQuality(mapConnectionQuality(room.localParticipant.connectionQuality));
        setConnectedState('connected');
      } catch (err) {
        if (cancelled || connectionRunRef.current !== runId) return;
        automaticRecoveryRef.current = !(err instanceof LiveAudioRequestError && err.status < 500) && !isPermissionDeniedError(err);
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`[LIVEKIT] livekit:connect:fail error=${errMsg}`);
        if (!(err instanceof LiveAudioRequestError) && (errMsg.toLowerCase().includes('invalid token') || errMsg.toLowerCase().includes('expired'))) {
          console.log(`[LIVEKIT] livekit:invalid-token:retry discarding token and retrying once...`);
          tokenRef.current = null;
          setParticipantId(null);
          setParticipantIdentity(null);
          participantIdRef.current = null;
          
          try {
            const tokenResponse = await requestConnectionToken();
            if (cancelled || connectionRunRef.current !== runId) return;
            tokenRef.current = tokenResponse;
            setParticipantId(tokenResponse.participantId);
            setParticipantIdentity(tokenResponse.participantIdentity);
            await room.connect(tokenResponse.livekitUrl, tokenResponse.token, { autoSubscribe: false });
            if (cancelled || connectionRunRef.current !== runId) return;
            console.log(`[LIVEKIT] livekit:connect:success (retry)`);
            subscribeExistingAudio(room);
            scheduleTokenRefresh(tokenResponse, runId);
            automaticRecoveryRef.current = true;
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
        if (connectingRunRef.current === runId) connectingRunRef.current = null;
      }
    };

    void connect();

    return () => {
      cancelled = true;
      connectionRunRef.current += 1;
      clearLifecycleTimers();
      const activeRoom = roomRef.current;
      roomRef.current = null;
      room.removeAllListeners();
      activeRoom?.removeAllListeners();
      void unpublishMicrophone();
      stopAllLocalTracks(activeRoom, localAudioTrackRef.current);
      clearMicrophoneProcessor();
      localAudioTrackRef.current = null;
      void room.disconnect(true);
      if (activeRoom && activeRoom !== room) void activeRoom.disconnect(true);
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
    obtainConnectionToken,
    requestConnectionToken,
  ]);

  const retryAudio = useCallback(async () => {
    if (connectingRunRef.current === connectionRunRef.current) return;
    connectionRunRef.current += 1;
    const runId = connectionRunRef.current;
    connectingRunRef.current = runId;
    clearLifecycleTimers();
    userDisconnectedRef.current = false;

    try {
    const previousRoom = roomRef.current;
    void unpublishMicrophone();
    stopAllLocalTracks(previousRoom, localAudioTrackRef.current);
    clearMicrophoneProcessor();
    localAudioTrackRef.current = null;
    previousRoom?.removeAllListeners();
    await previousRoom?.disconnect(true);
    if (connectionRunRef.current !== runId) return;

    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      stopLocalTrackOnUnpublish: true,
    });
    roomRef.current = room;
    setHasAudioStarted(false);
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
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (connectionRunRef.current !== runId || userDisconnectedRef.current) return;
        automaticRecoveryRef.current = automaticRecoveryRef.current && ![
          DisconnectReason.CLIENT_INITIATED, DisconnectReason.DUPLICATE_IDENTITY,
          DisconnectReason.PARTICIPANT_REMOVED, DisconnectReason.ROOM_DELETED,
        ].includes(reason as DisconnectReason);
        void unpublishMicrophone();
        setState('reconnectFailed');
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

      console.log(`[LIVEKIT] livekit:connect:start role=${role} (retryAudio)`);
      const tokenResponse = await obtainConnectionToken();
      if (connectionRunRef.current !== runId) return;
      tokenRef.current = tokenResponse;
      setParticipantId(tokenResponse.participantId);
      setParticipantIdentity(tokenResponse.participantIdentity);
      await room.connect(tokenResponse.livekitUrl, tokenResponse.token, { autoSubscribe: false });
      if (connectionRunRef.current !== runId) return;
      console.log(`[LIVEKIT] livekit:connect:success`);
      subscribeExistingAudio(room);
      scheduleTokenRefresh(tokenResponse, runId);
      automaticRecoveryRef.current = true;
      setConnectionQuality(mapConnectionQuality(room.localParticipant.connectionQuality));
      setConnectedState('connected');
    } catch (err) {
      if (connectionRunRef.current !== runId) return;
      automaticRecoveryRef.current = !(err instanceof LiveAudioRequestError && err.status < 500) && !isPermissionDeniedError(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`[LIVEKIT] livekit:connect:fail error=${errMsg}`);
      if (connectionRunRef.current === runId) setState('reconnectFailed');
    } finally {
      if (connectingRunRef.current === runId) connectingRunRef.current = null;
    }
  }, [
    addRemoteTrack,
    clearMicrophoneProcessor,
    clearLifecycleTimers,
    removeRemoteTrack,
    role,
    scheduleReconnectFailure,
    scheduleTokenRefresh,
    setConnectedState,
    subscribeExistingAudio,
    subscribePublication,
    unpublishMicrophone,
    observeControls,
    obtainConnectionToken,
  ]);

  useEffect(() => {
    if (!autoConnect || availability !== 'enabled' || userDisconnectedRef.current || !automaticRecoveryRef.current ||
        !['reconnectFailed', 'unavailable'].includes(state) || recoveryAttemptsRef.current >= 8) return;
    const delay = Math.min(1_000 * 2 ** recoveryAttemptsRef.current, 30_000);
    const timer = setTimeout(() => {
      recoveryAttemptsRef.current += 1;
      void retryAudio();
    }, delay);
    const handleOnline = () => {
      clearTimeout(timer);
      recoveryAttemptsRef.current = 0;
      void retryAudio();
    };
    window.addEventListener('online', handleOnline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', handleOnline);
    };
  }, [autoConnect, availability, retryAudio, state]);

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
    sessionRevision,
    isMicrophoneActive,
    microphoneTrackState,
    isDuckingActive,
    hasAudioStarted,
    startRemoteAudio,
    publishMicrophone,
    republishMicrophone,
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
    hasAudioStarted,
    connectionQuality,
    participantId,
    participantIdentity,
    sessionRevision,
    publishMicrophone,
    republishMicrophone,
    retryAudio,
    remoteTracks,
    controlParticipants,
    startRemoteAudio,
    state,
    unpublishMicrophone,
    microphoneDiagnostics,
  ]);
};
