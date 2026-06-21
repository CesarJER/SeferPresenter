import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  ConnectionState,
  createLocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import type {
  LiveAudioAvailability,
  LiveAudioConnectionState,
  LiveAudioParticipantRole,
  LiveAudioTokenResponse,
} from '../../../types/liveAudio';
import { useLiveAudioAvailability } from './useLiveAudioAvailability';

interface UseLiveAudioOptions {
  role: LiveAudioParticipantRole;
  roomSession?: string;
  autoConnect?: boolean;
}

interface UseLiveAudioResult {
  state: LiveAudioConnectionState;
  availability: LiveAudioAvailability;
  remoteTracks: MediaStreamTrack[];
  participantId: string | null;
  participantIdentity: string | null;
  isMicrophoneActive: boolean;
  startRemoteAudio: () => Promise<void>;
  publishMicrophone: () => Promise<void>;
  unpublishMicrophone: () => Promise<void>;
  retryAudio: () => Promise<void>;
  disconnect: () => void;
}

const TOKEN_REFRESH_MARGIN_MS = 2 * 60_000;
const RECONNECT_FAILURE_MS = 45_000;
const RECONNECTED_VISIBLE_MS = 3_000;

const canRolePublish = (role: LiveAudioParticipantRole) =>
  role === 'audience' || role === 'control' || role === 'presenter';

const isPermissionDeniedError = (error: unknown) =>
  error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');

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

const getAudioTrack = (track: RemoteTrack): MediaStreamTrack | null => {
  if (track.kind !== Track.Kind.Audio) return null;
  return track.mediaStreamTrack;
};

const requestToken = async (role: LiveAudioParticipantRole, roomSession?: string) => {
  const response = await fetch('/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ role, roomSession }),
  });

  if (!response.ok) throw new Error('Live Audio token request failed');
  return (await response.json()) as LiveAudioTokenResponse;
};

const refreshToken = async (participantId: string) => {
  const response = await fetch('/api/livekit/refresh-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ participantId }),
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
  autoConnect = true,
}: UseLiveAudioOptions): UseLiveAudioResult => {
  const { availability } = useLiveAudioAvailability();
  const [state, setState] = useState<LiveAudioConnectionState>('disconnected');
  const [remoteTracks, setRemoteTracks] = useState<MediaStreamTrack[]>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [participantIdentity, setParticipantIdentity] = useState<string | null>(null);
  const [isMicrophoneActive, setIsMicrophoneActive] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const localAudioTrackRef = useRef<LocalAudioTrack | null>(null);
  const connectionRunRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectFailureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<LiveAudioTokenResponse | null>(null);
  const participantIdRef = useRef<string | null>(null);
  const userDisconnectedRef = useRef(false);

  useEffect(() => {
    participantIdRef.current = participantId;
  }, [participantId]);

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

  const addRemoteTrack = useCallback((track: MediaStreamTrack) => {
    setRemoteTracks((current) => current.some((item) => item.id === track.id) ? current : [...current, track]);
  }, []);

  const removeRemoteTrack = useCallback((track: MediaStreamTrack) => {
    setRemoteTracks((current) => current.filter((item) => item.id !== track.id));
  }, []);

  const subscribePublication = useCallback((publication: RemoteTrackPublication) => {
    publication.setSubscribed(publication.kind === Track.Kind.Audio);
    if (publication.kind === Track.Kind.Audio && publication.track) {
      const mediaTrack = getAudioTrack(publication.track);
      if (mediaTrack) addRemoteTrack(mediaTrack);
    }
  }, [addRemoteTrack]);

  const subscribeExistingAudio = useCallback((room: Room) => {
    room.remoteParticipants.forEach((participant: RemoteParticipant) => {
      participant.trackPublications.forEach((publication) => subscribePublication(publication));
    });
  }, [subscribePublication]);

  const unpublishMicrophone = useCallback(async () => {
    const room = roomRef.current;
    const localTrack = localAudioTrackRef.current;
    if (!localTrack) {
      setIsMicrophoneActive(false);
      return;
    }

    localAudioTrackRef.current = null;
    try {
      if (room?.state === ConnectionState.Connected) {
        await room.localParticipant.unpublishTrack(localTrack, true);
      }
    } finally {
      stopAllLocalTracks(room, localTrack);
      setIsMicrophoneActive(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    userDisconnectedRef.current = true;
    connectionRunRef.current += 1;
    clearLifecycleTimers();
    const room = roomRef.current;
    void unpublishMicrophone();
    stopAllLocalTracks(room, localAudioTrackRef.current);
    localAudioTrackRef.current = null;
    roomRef.current = null;
    tokenRef.current = null;
    participantIdRef.current = null;
    setRemoteTracks([]);
    setParticipantId(null);
    setParticipantIdentity(null);
    setState(availability === 'enabled' ? 'disconnected' : 'unavailable');
    if (room) {
      room.removeAllListeners();
      void room.disconnect(true);
    }
  }, [availability, clearLifecycleTimers, unpublishMicrophone]);

  const scheduleTokenRefresh = useCallback((tokenResponse: LiveAudioTokenResponse, runId: number) => {
    clearTimer(refreshTimerRef);
    const delayMs = Math.max(tokenResponse.expiresAt - Date.now() - TOKEN_REFRESH_MARGIN_MS, 5_000);

    refreshTimerRef.current = setTimeout(() => {
      const activeParticipantId = participantIdRef.current;
      if (!activeParticipantId || connectionRunRef.current !== runId) return;

      void refreshToken(activeParticipantId)
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

  const publishMicrophone = useCallback(async () => {
    if (!canRolePublish(role)) {
      throw new Error('This Live Audio role cannot publish microphone audio');
    }
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) {
      throw new Error('Live Audio room is not connected');
    }
    if (localAudioTrackRef.current) return;

    try {
      const activeParticipantId = participantIdRef.current;
      if (role === 'audience' && activeParticipantId) {
        const nextToken = await refreshToken(activeParticipantId);
        if (nextToken.participantId !== activeParticipantId) {
          throw new Error('Live Audio token refresh returned a different participant');
        }
        tokenRef.current = nextToken;
      }
      const localTrack = await createLocalAudioTrack();
      await room.localParticipant.publishTrack(localTrack, {
        source: Track.Source.Microphone,
        name: 'microphone',
        dtx: true,
        red: false,
      });
      localAudioTrackRef.current = localTrack;
      setIsMicrophoneActive(true);
    } catch (error) {
      if (isPermissionDeniedError(error)) setState('permissionDenied');
      throw error;
    }
  }, [role]);

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
    const handleTrackPublished = (publication: RemoteTrackPublication) => {
      subscribePublication(publication);
    };
    const handleTrackSubscribed = (track: RemoteTrack) => {
      const mediaTrack = getAudioTrack(track);
      if (mediaTrack) addRemoteTrack(mediaTrack);
    };
    const handleTrackUnsubscribed = (track: RemoteTrack) => {
      const mediaTrack = getAudioTrack(track);
      if (mediaTrack) removeRemoteTrack(mediaTrack);
    };

    room
      .on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
      .on(RoomEvent.TrackPublished, handleTrackPublished)
      .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
      .on(RoomEvent.Disconnected, () => {
        if (connectionRunRef.current !== runId || userDisconnectedRef.current) return;
        setState('reconnecting');
        scheduleReconnectFailure(runId);
      });

    const connect = async () => {
      setState('connecting');
      try {
        const existingParticipantId = participantIdRef.current;
        const tokenResponse = existingParticipantId
          ? await refreshToken(existingParticipantId)
          : await requestToken(role, roomSession);
        if (cancelled || connectionRunRef.current !== runId) return;
        tokenRef.current = tokenResponse;
        setParticipantId(tokenResponse.participantId);
        setParticipantIdentity(tokenResponse.participantIdentity);
        await room.connect(tokenResponse.livekitUrl, tokenResponse.token, { autoSubscribe: false });
        if (cancelled || connectionRunRef.current !== runId) return;
        subscribeExistingAudio(room);
        scheduleTokenRefresh(tokenResponse, runId);
        setConnectedState('connected');
      } catch {
        if (cancelled || connectionRunRef.current !== runId) return;
        setState(participantIdRef.current ? 'reconnectFailed' : 'unavailable');
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
      localAudioTrackRef.current = null;
      void room.disconnect(true);
      setRemoteTracks([]);
    };
  }, [
    addRemoteTrack,
    autoConnect,
    availability,
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
  ]);

  const retryAudio = useCallback(async () => {
    connectionRunRef.current += 1;
    const runId = connectionRunRef.current;
    clearLifecycleTimers();
    userDisconnectedRef.current = false;

    const previousRoom = roomRef.current;
    void unpublishMicrophone();
    stopAllLocalTracks(previousRoom, localAudioTrackRef.current);
    localAudioTrackRef.current = null;
    previousRoom?.removeAllListeners();
    await previousRoom?.disconnect(true);

    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      stopLocalTrackOnUnpublish: true,
    });
    roomRef.current = room;
    setRemoteTracks([]);
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
      .on(RoomEvent.TrackPublished, subscribePublication)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        const mediaTrack = getAudioTrack(track);
        if (mediaTrack) addRemoteTrack(mediaTrack);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        const mediaTrack = getAudioTrack(track);
        if (mediaTrack) removeRemoteTrack(mediaTrack);
      });

    try {
      const activeParticipantId = participantIdRef.current;
      const tokenResponse = activeParticipantId
        ? await refreshToken(activeParticipantId)
        : await requestToken(role, roomSession);
      if (connectionRunRef.current !== runId) return;
      tokenRef.current = tokenResponse;
      setParticipantId(tokenResponse.participantId);
      setParticipantIdentity(tokenResponse.participantIdentity);
      await room.connect(tokenResponse.livekitUrl, tokenResponse.token, { autoSubscribe: false });
      if (connectionRunRef.current !== runId) return;
      subscribeExistingAudio(room);
      scheduleTokenRefresh(tokenResponse, runId);
      setConnectedState('connected');
    } catch {
      if (connectionRunRef.current === runId) setState('reconnectFailed');
    }
  }, [
    addRemoteTrack,
    clearLifecycleTimers,
    removeRemoteTrack,
    role,
    roomSession,
    scheduleReconnectFailure,
    scheduleTokenRefresh,
    setConnectedState,
    subscribeExistingAudio,
    subscribePublication,
    unpublishMicrophone,
  ]);

  return useMemo(() => ({
    state,
    availability,
    remoteTracks,
    participantId,
    participantIdentity,
    isMicrophoneActive,
    startRemoteAudio,
    publishMicrophone,
    unpublishMicrophone,
    retryAudio,
    disconnect,
  }), [
    availability,
    disconnect,
    isMicrophoneActive,
    participantId,
    participantIdentity,
    publishMicrophone,
    retryAudio,
    remoteTracks,
    startRemoteAudio,
    state,
    unpublishMicrophone,
  ]);
};
