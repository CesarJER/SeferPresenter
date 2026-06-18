import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  disconnect: () => void;
}

const canRolePublish = (role: LiveAudioParticipantRole) => role === 'control' || role === 'presenter';

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
      localTrack.stop();
      setIsMicrophoneActive(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    const room = roomRef.current;
    void unpublishMicrophone();
    roomRef.current = null;
    setRemoteTracks([]);
    setParticipantId(null);
    setParticipantIdentity(null);
    setState(availability === 'enabled' ? 'disconnected' : 'unavailable');
    if (room) {
      room.removeAllListeners();
      void room.disconnect(true);
    }
  }, [availability, unpublishMicrophone]);

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
      const localTrack = await createLocalAudioTrack();
      await room.localParticipant.publishTrack(localTrack, {
        source: Track.Source.Microphone,
        name: 'microphone',
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

    let cancelled = false;
    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      stopLocalTrackOnUnpublish: true,
    });
    roomRef.current = room;

    const handleConnectionStateChanged = (nextState: ConnectionState) => {
      if (connectionRunRef.current !== runId) return;
      setState(mapRoomState(nextState));
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
        if (connectionRunRef.current === runId) setState('disconnected');
      });

    const connect = async () => {
      setState('connecting');
      try {
        const tokenResponse = await requestToken(role, roomSession);
        if (cancelled || connectionRunRef.current !== runId) return;
        setParticipantId(tokenResponse.participantId);
        setParticipantIdentity(tokenResponse.participantIdentity);
        await room.connect(tokenResponse.livekitUrl, tokenResponse.token, { autoSubscribe: false });
        if (cancelled || connectionRunRef.current !== runId) return;
        subscribeExistingAudio(room);
        setState('connected');
      } catch {
        if (cancelled || connectionRunRef.current !== runId) return;
        setState('unavailable');
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (roomRef.current === room) roomRef.current = null;
      room.removeAllListeners();
      void unpublishMicrophone();
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
    disconnect,
  }), [
    availability,
    disconnect,
    isMicrophoneActive,
    participantId,
    participantIdentity,
    publishMicrophone,
    remoteTracks,
    startRemoteAudio,
    state,
    unpublishMicrophone,
  ]);
};
