// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const liveKit = vi.hoisted(() => {
  const rooms: Array<{ localParticipant: Record<string, unknown>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const createLocalAudioTrack = vi.fn();

  class Room {
    state = 'disconnected';
    remoteParticipants = new Map();
    listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    disconnect = vi.fn(async () => { this.state = 'disconnected'; });
    startAudio = vi.fn(async () => undefined);
    localParticipant = {
      sid: 'local-sid',
      permissions: { canPublish: true },
      connectionQuality: 'excellent',
      trackPublications: new Map(),
      publishTrack: vi.fn(),
      unpublishTrack: vi.fn(async () => undefined),
    };

    constructor() {
      rooms.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) || []), handler]);
      return this;
    }

    removeAllListeners() {
      this.listeners.clear();
    }

    async connect() {
      this.state = 'connected';
    }
  }

  return { Room, rooms, createLocalAudioTrack };
});

vi.mock('livekit-client', () => ({
  ConnectionState: {
    Connected: 'connected',
    Connecting: 'connecting',
    Reconnecting: 'reconnecting',
    SignalReconnecting: 'signalReconnecting',
    Disconnected: 'disconnected',
  },
  ConnectionQuality: {
    Excellent: 'excellent',
    Good: 'good',
    Poor: 'poor',
    Lost: 'lost',
  },
  Room: liveKit.Room,
  RoomEvent: {
    Connected: 'connected', Reconnected: 'reconnected', Disconnected: 'disconnected',
    ParticipantConnected: 'participantConnected', ParticipantDisconnected: 'participantDisconnected',
    TrackMuted: 'trackMuted', TrackUnmuted: 'trackUnmuted', TrackPublished: 'trackPublished',
    TrackUnpublished: 'trackUnpublished', TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed', ConnectionStateChanged: 'connectionStateChanged',
    ConnectionQualityChanged: 'connectionQualityChanged', ActiveSpeakersChanged: 'activeSpeakersChanged',
  },
  Track: { Kind: { Audio: 'audio' }, Source: { Microphone: 'microphone' } },
  createLocalAudioTrack: liveKit.createLocalAudioTrack,
}));

vi.mock('../../src/features/liveAudio/hooks/useLiveAudioAvailability', () => ({
  useLiveAudioAvailability: () => ({ availability: 'enabled' }),
}));

import { useLiveAudio } from '../../src/features/liveAudio/hooks/useLiveAudio';

const makeTrack = () => ({
  mediaStreamTrack: { id: 'microphone-track' },
  setAudioContext: vi.fn(),
  setProcessor: vi.fn(async () => undefined),
  stop: vi.fn(),
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

describe('useLiveAudio microphone publication', () => {
  afterEach(cleanup);

  beforeEach(() => {
    liveKit.rooms.length = 0;
    liveKit.createLocalAudioTrack.mockReset();
    liveKit.createLocalAudioTrack.mockResolvedValue(makeTrack());
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        livekitUrl: 'wss://livekit.example.test', token: 'token', participantId: 'participant-1',
        participantIdentity: 'audience-participant-1', refreshCredential: 'x'.repeat(32),
        expiresAt: Date.now() + 1_800_000, expiresInMs: 1_800_000,
      }),
    })));
  });

  const renderConnectedHook = async () => {
    const hook = renderHook(() => useLiveAudio({ role: 'audience' }));
    await waitFor(() => expect(hook.result.current.state).toBe('connected'));
    return hook;
  };

  it('changes from publishing to published only after LiveKit confirms publication', async () => {
    const publication = deferred<unknown>();
    const hook = await renderConnectedHook();
    const room = liveKit.rooms[0];
    const publishTrack = room.localParticipant.publishTrack as ReturnType<typeof vi.fn>;
    publishTrack.mockReturnValue(publication.promise);
    let pending!: Promise<void>;

    act(() => { pending = hook.result.current.publishMicrophone(); });
    expect(hook.result.current.microphoneTrackState).toBe('publishing');
    expect(hook.result.current.isMicrophoneActive).toBe(false);
    await waitFor(() => expect(publishTrack).toHaveBeenCalledTimes(1));

    await act(async () => {
      publication.resolve({});
      await pending;
    });
    expect(hook.result.current.microphoneTrackState).toBe('published');
    expect(hook.result.current.isMicrophoneActive).toBe(true);
  });

  it('leaves listening connected on missing publish permission without reconnecting', async () => {
    const hook = await renderConnectedHook();
    const room = liveKit.rooms[0];
    (room.localParticipant.permissions as { canPublish: boolean }).canPublish = false;

    await act(async () => {
      await expect(hook.result.current.publishMicrophone()).rejects.toThrow('Reintenta');
    });

    expect(hook.result.current.state).toBe('connected');
    expect(hook.result.current.microphoneTrackState).toBe('error');
    expect(hook.result.current.isMicrophoneActive).toBe(false);
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(liveKit.createLocalAudioTrack).not.toHaveBeenCalled();
    await hook.result.current.startRemoteAudio();
    expect(room.startAudio).toHaveBeenCalledTimes(1);
  });

  it('leaves error state and permits an explicit retry after publication fails', async () => {
    const hook = await renderConnectedHook();
    const publishTrack = liveKit.rooms[0].localParticipant.publishTrack as ReturnType<typeof vi.fn>;
    publishTrack.mockRejectedValueOnce(new Error('publish failed')).mockResolvedValueOnce({});

    await act(async () => {
      await expect(hook.result.current.publishMicrophone()).rejects.toThrow('publish failed');
    });
    expect(hook.result.current.microphoneTrackState).toBe('error');
    expect(hook.result.current.isMicrophoneActive).toBe(false);

    await act(async () => { await hook.result.current.publishMicrophone(); });
    expect(hook.result.current.microphoneTrackState).toBe('published');
    expect(hook.result.current.isMicrophoneActive).toBe(true);
    expect(publishTrack).toHaveBeenCalledTimes(2);
  });

  it('coalesces a double activation into one track publication', async () => {
    const publication = deferred<unknown>();
    const hook = await renderConnectedHook();
    const publishTrack = liveKit.rooms[0].localParticipant.publishTrack as ReturnType<typeof vi.fn>;
    publishTrack.mockReturnValue(publication.promise);
    let first!: Promise<void>;

    act(() => {
      first = hook.result.current.publishMicrophone();
      void hook.result.current.publishMicrophone();
    });
    await waitFor(() => expect(publishTrack).toHaveBeenCalledTimes(1));
    expect(liveKit.createLocalAudioTrack).toHaveBeenCalledTimes(1);

    await act(async () => {
      publication.resolve({});
      await first;
    });
  });
});
