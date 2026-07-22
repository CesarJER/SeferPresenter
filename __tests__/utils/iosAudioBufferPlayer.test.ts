import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockAudioParam {
  value = 1;
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  linearRampToValueAtTime = vi.fn((value: number) => { this.value = value; });
}

class MockGainNode {
  gain = new MockAudioParam();
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockBufferSourceNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  playbackRate = new MockAudioParam();
  onended: ((event: Event) => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockMediaStreamDestination {
  stream = {} as MediaStream;
}

class MockStreamAudioElement extends EventTarget {
  autoplay = false;
  playsInline = false;
  preload = '';
  controls = true;
  volume = 1;
  paused = true;
  srcObject: MediaStream | null = null;
  style = { display: '' };
  setAttribute = vi.fn();
  remove = vi.fn();
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
}

class MockAudioContext extends EventTarget {
  static latest: MockAudioContext;
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {} as AudioDestinationNode;
  gain = new MockGainNode();
  streamDestination = new MockMediaStreamDestination();
  sources: MockBufferSourceNode[] = [];
  decodedBuffer = { duration: 120 } as AudioBuffer;

  constructor() {
    super();
    MockAudioContext.latest = this;
  }

  createGain(): GainNode {
    return this.gain as unknown as GainNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new MockBufferSourceNode();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  createMediaStreamDestination(): MediaStreamAudioDestinationNode {
    return this.streamDestination as unknown as MediaStreamAudioDestinationNode;
  }

  decodeAudioData = vi.fn(async () => this.decodedBuffer);
  resume = vi.fn(async () => { this.state = 'running'; });
}

describe('IosAudioBufferPlayer', () => {
  let streamOutput: MockStreamAudioElement;

  beforeEach(() => {
    vi.resetModules();
    const fakeWindow = new EventTarget() as EventTarget & { AudioContext: typeof AudioContext };
    fakeWindow.AudioContext = MockAudioContext as unknown as typeof AudioContext;
    vi.stubGlobal('window', fakeWindow);
    streamOutput = new MockStreamAudioElement();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => streamOutput),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
  });

  it('routes gain through a MediaStream-backed audio element', async () => {
    const { IosAudioBufferPlayer } = await import('../../src/utils/iosAudioBufferPlayer');
    const player = new IosAudioBufferPlayer();
    const context = MockAudioContext.latest;

    expect(context.gain.connect).toHaveBeenCalledWith(context.streamDestination);
    expect(streamOutput.srcObject).toBe(context.streamDestination.stream);

    player.src = '/audio/music/test.mp3';
    player.load();
    await player.play();

    expect(streamOutput.play).toHaveBeenCalledOnce();
    expect(context.sources[0].start).toHaveBeenCalledWith(0, 0);
  });

  it('resumes an interrupted iPhone audio context before playback', async () => {
    const { IosAudioBufferPlayer } = await import('../../src/utils/iosAudioBufferPlayer');
    const player = new IosAudioBufferPlayer();
    const context = MockAudioContext.latest;
    context.state = 'interrupted' as AudioContextState;

    player.src = '/audio/music/test.mp3';
    player.load();
    await player.play();

    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(1);
  });

  it('selects only iPhone user agents', async () => {
    const { isIphoneDevice } = await import('../../src/utils/mediaVolume');

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    expect(isIphoneDevice()).toBe(true);

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' });
    expect(isIphoneDevice()).toBe(false);

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15)' });
    expect(isIphoneDevice()).toBe(false);
  });

  it('loads, decodes and recreates one-shot sources for pause and seek', async () => {
    const { IosAudioBufferPlayer } = await import('../../src/utils/iosAudioBufferPlayer');
    const player = new IosAudioBufferPlayer();
    const context = MockAudioContext.latest;

    player.src = '/audio/music/test.mp3';
    player.load();
    await player.play();

    expect(fetch).toHaveBeenCalledWith('/audio/music/test.mp3', {
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    });
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(0, 0);

    context.currentTime = 10;
    expect(player.currentTime).toBeCloseTo(10);
    player.pause();
    expect(player.currentTime).toBeCloseTo(10);
    expect(streamOutput.pause).toHaveBeenCalled();

    player.currentTime = 30;
    await player.play();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].start).toHaveBeenCalledWith(0, 30);
  });

  it('does not start after pause wins a pending decode race', async () => {
    const { IosAudioBufferPlayer } = await import('../../src/utils/iosAudioBufferPlayer');
    const player = new IosAudioBufferPlayer();
    const context = MockAudioContext.latest;
    let resolveDecode: ((buffer: AudioBuffer) => void) | undefined;
    context.decodeAudioData.mockImplementationOnce(() => new Promise<AudioBuffer>(resolve => {
      resolveDecode = resolve;
    }));

    player.src = '/audio/music/test.mp3';
    player.load();
    const pendingPlay = player.play();
    await vi.waitFor(() => expect(resolveDecode).toBeTypeOf('function'));
    player.pause();
    resolveDecode?.(context.decodedBuffer);
    await pendingPlay;

    expect(context.sources).toHaveLength(0);
    expect(player.paused).toBe(true);
  });

  it('aborts a slow first request when a second track load wins', async () => {
    const { IosAudioBufferPlayer } = await import('../../src/utils/iosAudioBufferPlayer');
    const player = new IosAudioBufferPlayer();
    const context = MockAudioContext.latest;
    const firstArrayBuffer = vi.fn(async () => new Uint8Array([1]).buffer);
    let resolveFirstFetch: ((response: Response) => void) | undefined;
    const firstFetch = new Promise<Response>((resolve) => {
      resolveFirstFetch = resolve;
    });
    const secondBuffer = { duration: 45 } as AudioBuffer;

    vi.mocked(fetch)
      .mockImplementationOnce(() => firstFetch)
      .mockResolvedValueOnce(new Response(new Uint8Array([2]), { status: 200 }));
    context.decodeAudioData.mockResolvedValueOnce(secondBuffer);

    player.src = '/audio/music/a.mp3';
    player.load();
    const firstSignal = vi.mocked(fetch).mock.calls[0][1]?.signal;

    player.src = '/audio/music/b.mp3';
    player.load();

    expect(firstSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(player.duration).toBe(45));

    resolveFirstFetch?.({
      ok: true,
      status: 200,
      arrayBuffer: firstArrayBuffer,
    } as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();

    expect(firstArrayBuffer).not.toHaveBeenCalled();
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    expect(player.currentSrc).toBe('/audio/music/b.mp3');
    expect(player.duration).toBe(45);
  });

  it('aborts an in-flight request when hook cleanup destroys the player', async () => {
    const { IosAudioBufferPlayer } = await import('../../src/utils/iosAudioBufferPlayer');
    const player = new IosAudioBufferPlayer();
    const context = MockAudioContext.latest;
    const loaded = vi.fn();
    let resolveFetch: ((response: Response) => void) | undefined;

    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      expect(options?.signal?.aborted).toBe(false);
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    player.addEventListener('loadedmetadata', loaded);
    player.src = '/audio/music/slow.mp3';
    player.load();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;

    player.destroy();
    expect(signal?.aborted).toBe(true);

    resolveFetch?.(new Response(new Uint8Array([1]), { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();

    expect(context.decodeAudioData).not.toHaveBeenCalled();
    expect(loaded).not.toHaveBeenCalled();
    expect(streamOutput.remove).toHaveBeenCalledOnce();
  });

  it('does not apply a stale decode result after a newer track is ready', async () => {
    const { IosAudioBufferPlayer } = await import('../../src/utils/iosAudioBufferPlayer');
    const player = new IosAudioBufferPlayer();
    const context = MockAudioContext.latest;
    const loaded = vi.fn();
    let resolveFirstDecode: ((buffer: AudioBuffer) => void) | undefined;
    const firstDecode = new Promise<AudioBuffer>((resolve) => {
      resolveFirstDecode = resolve;
    });
    const firstBuffer = { duration: 90 } as AudioBuffer;
    const secondBuffer = { duration: 30 } as AudioBuffer;

    context.decodeAudioData
      .mockImplementationOnce(() => firstDecode)
      .mockResolvedValueOnce(secondBuffer);
    player.addEventListener('loadedmetadata', loaded);

    player.src = '/audio/music/a.mp3';
    player.load();
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(1));

    player.src = '/audio/music/b.mp3';
    player.load();
    await vi.waitFor(() => expect(player.duration).toBe(30));

    resolveFirstDecode?.(firstBuffer);
    await Promise.resolve();
    await Promise.resolve();

    expect(player.duration).toBe(30);
    expect(player.currentSrc).toBe('/audio/music/b.mp3');
    expect(loaded).toHaveBeenCalledOnce();
  });

  it('preserves a synchronized seek requested while decoding', async () => {
    const { IosAudioBufferPlayer } = await import('../../src/utils/iosAudioBufferPlayer');
    const player = new IosAudioBufferPlayer();

    player.src = '/audio/music/test.mp3';
    player.load();
    player.currentTime = 42;
    await player.play();

    expect(MockAudioContext.latest.sources[0].start).toHaveBeenCalledWith(0, 42);
  });

  it('anchors playback-rate changes and ramps gain without restarting', async () => {
    const { IosAudioBufferPlayer } = await import('../../src/utils/iosAudioBufferPlayer');
    const player = new IosAudioBufferPlayer();
    const context = MockAudioContext.latest;

    player.src = '/audio/music/test.mp3';
    player.load();
    await player.play();
    context.currentTime = 5;
    player.playbackRate = 2;
    context.currentTime = 8;

    expect(player.currentTime).toBeCloseTo(11);
    expect(context.sources).toHaveLength(1);

    player.setVolume(0.25, 300);
    expect(context.gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.25, 8.3);
  });

  it('reports natural completion and releases the active source', async () => {
    const { IosAudioBufferPlayer } = await import('../../src/utils/iosAudioBufferPlayer');
    const player = new IosAudioBufferPlayer();
    const ended = vi.fn();
    player.addEventListener('ended', ended);

    player.src = '/audio/music/test.mp3';
    player.load();
    await player.play();
    MockAudioContext.latest.sources[0].onended?.(new Event('ended'));

    expect(ended).toHaveBeenCalledOnce();
    expect(player.paused).toBe(true);
    expect(streamOutput.pause).toHaveBeenCalled();
    expect(streamOutput.remove).not.toHaveBeenCalled();

    await player.play();
    expect(MockAudioContext.latest.sources[1].start).toHaveBeenCalledWith(0, 0);
  });
});
