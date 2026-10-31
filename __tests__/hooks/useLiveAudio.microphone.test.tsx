// @vitest-environment jsdom
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const liveKit = vi.hoisted(() => {
  const rooms: Room[] = [];
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
  DisconnectReason: { CLIENT_INITIATED: 1, DUPLICATE_IDENTITY: 2, SERVER_SHUTDOWN: 3, PARTICIPANT_REMOVED: 4, ROOM_DELETED: 5 },
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
  afterEach(() => { cleanup(); vi.useRealTimers(); });

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

  it('releases the previous microphone and refresh identity when the RTC owner is remounted for a new session', async () => {
    let current!: ReturnType<typeof useLiveAudio>;
    function SessionRtc() { current = useLiveAudio({ role: 'audience' }); return null; }
    const view = render(<SessionRtc key="session-a" />);
    await waitFor(() => expect(current.state).toBe('connected'));
    const previousRoom = liveKit.rooms[0];
    await act(async () => { await current.publishMicrophone(); });
    const previousTrack = liveKit.createLocalAudioTrack.mock.results[0].value;
    const track = await previousTrack;
    expect(current.isMicrophoneActive).toBe(true);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
    view.rerender(<SessionRtc key="session-b" />);
    await waitFor(() => expect(liveKit.rooms).toHaveLength(2));
    await waitFor(() => expect(current.state).toBe('connected'));
    expect(previousRoom.disconnect).toHaveBeenCalledWith(true);
    expect(track.stop).toHaveBeenCalled();
    expect(current.isMicrophoneActive).toBe(false);
    expect(liveKit.createLocalAudioTrack).toHaveBeenCalledTimes(1);
    const paths = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => url);
    expect(paths).toEqual(['/api/livekit/token']);
  });

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

  it('keeps listening and microphone controls recoverable when the browser denies capture', async () => {
    const hook = await renderConnectedHook();
    liveKit.createLocalAudioTrack.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    await act(async () => {
      await expect(hook.result.current.publishMicrophone()).rejects.toMatchObject({ name: 'NotAllowedError' });
      expect(await hook.result.current.startRemoteAudio()).toBe(true);
    });
    expect(hook.result.current.state).toBe('connected');
    expect(hook.result.current.microphoneTrackState).toBe('error');
    expect(hook.result.current.hasAudioStarted).toBe(true);
    expect(liveKit.rooms[0].disconnect).not.toHaveBeenCalled();
  });

  it('stops a capture that finishes after Control has silenced the microphone', async () => {
    const hook = await renderConnectedHook();
    const capture = deferred<ReturnType<typeof makeTrack>>();
    const track = makeTrack();
    liveKit.createLocalAudioTrack.mockReturnValueOnce(capture.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.publishMicrophone(); });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await act(async () => {
      await hook.result.current.unpublishMicrophone();
      capture.resolve(track);
      await rejected;
    });
    expect(track.stop).toHaveBeenCalled();
    expect(liveKit.rooms[0].localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(hook.result.current.microphoneTrackState).toBe('off');
  });

  it('releases an in-flight publication immediately and removes its late SDK publication', async () => {
    const hook = await renderConnectedHook();
    const publication = deferred<unknown>();
    const track = makeTrack();
    liveKit.createLocalAudioTrack.mockResolvedValueOnce(track);
    liveKit.rooms[0].localParticipant.publishTrack.mockReturnValueOnce(publication.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.publishMicrophone(); });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(liveKit.rooms[0].localParticipant.publishTrack).toHaveBeenCalled());
    await act(async () => { await hook.result.current.unpublishMicrophone(); });
    expect(track.stop).toHaveBeenCalled();
    await act(async () => { publication.resolve({}); await rejected; });
    expect(liveKit.rooms[0].localParticipant.unpublishTrack).toHaveBeenCalledWith(track, true);
    expect(hook.result.current.isMicrophoneActive).toBe(false);
    expect(hook.result.current.microphoneTrackState).toBe('off');
  });

  it('applies music mode to new capture without rebuilding the room', async () => {
    const hook = await renderConnectedHook();
    await act(async () => { await hook.result.current.publishMicrophone(); });
    await act(async () => { await hook.result.current.republishMicrophone({ musicMode: true }); });
    expect(liveKit.createLocalAudioTrack).toHaveBeenLastCalledWith(expect.objectContaining({ noiseSuppression: false, autoGainControl: false }));
    expect(liveKit.rooms).toHaveLength(1);
    expect(liveKit.rooms[0].disconnect).not.toHaveBeenCalled();
    expect(hook.result.current.isMicrophoneActive).toBe(true);
  });

  it('does not reopen audio if silenced while changing capture filters', async () => {
    const hook = await renderConnectedHook();
    await act(async () => { await hook.result.current.publishMicrophone(); });
    const unpublish = deferred<void>();
    liveKit.rooms[0].localParticipant.unpublishTrack.mockReturnValueOnce(unpublish.promise);
    let configuration!: Promise<void>;
    act(() => { configuration = hook.result.current.republishMicrophone({ musicMode: true }); });
    const rejected = expect(configuration).rejects.toMatchObject({ name: 'AbortError' });
    await act(async () => {
      await hook.result.current.unpublishMicrophone();
      unpublish.resolve();
      await rejected;
    });
    expect(liveKit.createLocalAudioTrack).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isMicrophoneActive).toBe(false);
  });

  it('marks playback started only on a connected room and resets it on retry', async () => {
    const response = deferred<unknown>();
    const existingFetch = fetch;
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(response.promise).mockImplementation(existingFetch));
    const hook = renderHook(() => useLiveAudio({ role: 'audience' }));
    await act(async () => { expect(await hook.result.current.startRemoteAudio()).toBe(false); });
    expect(hook.result.current.hasAudioStarted).toBe(false);
    response.resolve(await existingFetch('/api/livekit/token'));
    await waitFor(() => expect(hook.result.current.state).toBe('connected'));
    await act(async () => { expect(await hook.result.current.startRemoteAudio()).toBe(true); });
    expect(hook.result.current.hasAudioStarted).toBe(true);
    await act(async () => { await hook.result.current.retryAudio(); });
    expect(hook.result.current.hasAudioStarted).toBe(false);
  });

  it('obtains a new admitted listener session after the backend lost the old registry', async () => {
    const hook = await renderConnectedHook();
    expect(hook.result.current.sessionRevision).toBe(1);
    const originalFetch = fetch;
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url);
      if (url.endsWith('refresh-token')) return { ok: false, status: 403, json: async () => ({ code: 'participant_inactive', error: 'Participant is not active' }) };
      return originalFetch(url);
    }));
    await act(async () => { await hook.result.current.retryAudio(); });
    expect(requests).toEqual(['/api/livekit/refresh-token', '/api/livekit/token']);
    expect(hook.result.current.state).toBe('connected');
    expect(hook.result.current.isMicrophoneActive).toBe(false);
    expect(hook.result.current.participantId).toBe('participant-1');
    expect(hook.result.current.sessionRevision).toBe(2);
  });

  it.each([403, 503])('keeps a working media connection when token renewal fails with HTTP %s', async (status) => {
    const originalFetch = fetch;
    const request = vi.fn(async (url: string) => {
      if (url.endsWith('refresh-token')) return {
        ok: false, status, json: async () => ({ code: 'invalid_refresh_credential', error: 'Renewal failed' }),
      };
      const response = await originalFetch(url);
      return { ...response, json: async () => ({ ...await response.json(), expiresInMs: 125_000 }) };
    });
    vi.stubGlobal('fetch', request);
    vi.useFakeTimers();
    const hook = renderHook(() => useLiveAudio({ role: 'audience' }));
    await act(async () => {});
    expect(hook.result.current.state).toBe('connected');
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(hook.result.current.state).toBe('connected');
    expect(liveKit.rooms[0].disconnect).not.toHaveBeenCalled();
    if (status === 503) {
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(request).toHaveBeenCalledTimes(3);
      expect(liveKit.rooms).toHaveLength(1);
    } else {
      act(() => {
        liveKit.rooms[0].state = 'disconnected';
        liveKit.rooms[0].listeners.get('disconnected')?.forEach(listener => listener(3));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(liveKit.rooms).toHaveLength(1);
    }
  });

  it('preserves the admission revision when reconnecting with a valid refreshed session', async () => {
    const hook = await renderConnectedHook();
    await act(async () => { await hook.result.current.retryAudio(); });
    expect(hook.result.current.sessionRevision).toBe(1);
  });

  it('coalesces retries while the previous room is still disconnecting', async () => {
    const hook = await renderConnectedHook();
    const disconnection = deferred<void>();
    liveKit.rooms[0].disconnect.mockReturnValueOnce(disconnection.promise);
    let first!: Promise<void>;
    act(() => { first = hook.result.current.retryAudio(); });
    await act(async () => { await hook.result.current.retryAudio(); });
    expect(liveKit.rooms).toHaveLength(1);
    await act(async () => { disconnection.resolve(); await first; });
    expect(liveKit.rooms).toHaveLength(2);
    expect(hook.result.current.state).toBe('connected');
  });

  it('does not create a replacement room after unmount during disconnection', async () => {
    const hook = await renderConnectedHook();
    const disconnection = deferred<void>();
    liveKit.rooms[0].disconnect.mockReturnValueOnce(disconnection.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.retryAudio(); });
    hook.unmount();
    await act(async () => { disconnection.resolve(); await pending; });
    expect(liveKit.rooms).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rearms network recovery after an explicitly accepted retry', async () => {
    const hook = await renderConnectedHook();
    act(() => {
      liveKit.rooms[0].state = 'disconnected';
      liveKit.rooms[0].listeners.get('disconnected')?.forEach(listener => listener(4));
    });
    await act(async () => { await hook.result.current.retryAudio(); });
    vi.useFakeTimers();
    act(() => {
      liveKit.rooms[1].state = 'disconnected';
      liveKit.rooms[1].listeners.get('disconnected')?.forEach(listener => listener(3));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(liveKit.rooms).toHaveLength(3);
    expect(hook.result.current.isMicrophoneActive).toBe(false);
  });

  it('does not bypass a denied refresh credential with a new token request', async () => {
    const hook = await renderConnectedHook();
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url);
      return { ok: false, status: 403, json: async () => ({ code: 'invalid_refresh_credential', error: 'Invalid credential' }) };
    }));
    await act(async () => { await hook.result.current.retryAudio(); });
    expect(requests).toEqual(['/api/livekit/refresh-token']);
    expect(hook.result.current.state).toBe('reconnectFailed');
  });

  it.each([[3, 2], [4, 1]])('recovers a server shutdown but respects an administrative removal (%s)', async (reason, expectedRooms) => {
    const hook = await renderConnectedHook();
    vi.useFakeTimers();
    act(() => {
      liveKit.rooms[0].state = 'disconnected';
      liveKit.rooms[0].listeners.get('disconnected')?.forEach(listener => listener(reason));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(liveKit.rooms).toHaveLength(expectedRooms);
    expect(hook.result.current.isMicrophoneActive).toBe(false);
    expect(liveKit.createLocalAudioTrack).not.toHaveBeenCalled();
  });
});
