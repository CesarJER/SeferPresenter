import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceScriptureSession, VOICE_LIMITS } from '../src/features/voiceScripture/voiceScriptureSession';

class Socket extends EventTarget {
  static OPEN = 1;
  static latest: Socket;
  readyState = 1;
  bufferedAmount = 0;
  sent: unknown[] = [];
  constructor() { super(); Socket.latest = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
  send(data: unknown) { this.sent.push(data); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  message(data: object) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
}
class Processor {
  static latest: Processor;
  port = { onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: () => { this.port.onmessage?.({ data: new ArrayBuffer(200) }); this.port.onmessage?.({ data: 'flushed' }); } };
  constructor() { Processor.latest = this; }
  connect() { return this; }
  disconnect() {}
}
class Context {
  state = 'running'; sampleRate = 48000;
  audioWorklet = { addModule: async () => undefined };
  destination = {};
  createMediaStreamSource() { return { connect: (node) => node }; }
  createGain() { return { gain: { value: 0 }, connect: () => undefined }; }
  resume() { return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
let session: VoiceScriptureSession;
let track: EventTarget & { readyState: string };
let phase: ReturnType<typeof vi.fn>;
let final: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('AudioContext', Context); vi.stubGlobal('AudioWorkletNode', Processor);
  vi.stubGlobal('MediaStream', class {}); vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: 'capability' }))));
  track = Object.assign(new EventTarget(), { readyState: 'live' });
  phase = vi.fn(); final = vi.fn();
  session = new VoiceScriptureSession(track as unknown as MediaStreamTrack, [], { phase, final });
});
afterEach(() => { session.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const completed = (id = 'one') => Socket.latest.message({ type: 'conversation.item.input_audio_transcription.completed', event_id: id, transcript: 'Alfa uno tres' });
describe('voice session lifecycle', () => {
  it('accepts consecutive finals and ignores duplicate IDs', async () => {
    await session.start(); completed(); completed(); completed('two');
    expect(final).toHaveBeenCalledTimes(2);
  });
  it('flushes PCM before commit and never projects after stop', async () => {
    await session.start(); await session.stop(); completed();
    expect(final).not.toHaveBeenCalled();
    const sent = Socket.latest.sent;
    expect(sent.at(-2)).toBeInstanceOf(ArrayBuffer);
    expect(JSON.parse(sent.at(-1) as string).type).toBe('input_audio_buffer.commit');
  });
  it('cancels a pending capability fetch', async () => {
    let resolve;
    vi.stubGlobal('fetch', () => new Promise((r) => { resolve = r; }));
    const start = session.start(); await session.stop();
    resolve(new Response(JSON.stringify({ token: 'late' })));
    await start;
    expect(phase).not.toHaveBeenCalledWith('listening');
  });
  it('fails closed when partials never finalize', async () => {
    await session.start();
    Socket.latest.message({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Alfa' });
    for (let i = 0; i < 10; i++) { Processor.latest.port.onmessage?.({ data: new ArrayBuffer(10240) }); await vi.advanceTimersByTimeAsync(500); }
    expect(phase).toHaveBeenCalledWith('error', expect.stringContaining('finales'));
    completed(); expect(final).not.toHaveBeenCalled();
  });
  it('releases the session when the track ends', async () => {
    await session.start(); track.dispatchEvent(new Event('ended'));
    expect(Socket.latest.readyState).toBe(3);
    expect(phase).toHaveBeenCalledWith('error', expect.stringContaining('fuente'));
  });
  it('bounds buffered audio', async () => {
    await session.start(); Socket.latest.bufferedAmount = VOICE_LIMITS.queueBytes;
    Processor.latest.port.onmessage?.({ data: new ArrayBuffer(10240) });
    expect(phase).toHaveBeenCalledWith('error', expect.stringContaining('cola'));
  });
  it('survives six simulated hours with repeated finals and bounded session rotation', async () => {
    await session.start();
    let sessions = 1;
    const block = new ArrayBuffer(96_000); // Three seconds of mono PCM16.
    for (let seconds = 0; seconds < 6 * 3600; seconds += 3) {
      Processor.latest.port.onmessage?.({ data: block });
      Socket.latest.sent.length = 0;
      await vi.advanceTimersByTimeAsync(3_000);
      completed(String(seconds));
      if (Socket.latest.readyState === 3) {
        session = new VoiceScriptureSession(track as unknown as MediaStreamTrack, [], { phase, final });
        await session.start(); sessions += 1;
      }
    }
    expect(sessions).toBe(3);
    expect(final).toHaveBeenCalledTimes(7200);
    expect(phase.mock.calls.some(([value]) => value === 'error')).toBe(false);
  }, 30_000);
  it('rotates only after a final at the byte threshold', async () => {
    await session.start();
    // Accelerate cumulative transport without allocating a multi-hour recording.
    for (let i = 0; i < VOICE_LIMITS.rotateBytes / (256 * 1024); i++) Processor.latest.port.onmessage?.({ data: new ArrayBuffer(256 * 1024) });
    expect(Socket.latest.readyState).toBe(1);
    completed();
    expect(final).toHaveBeenCalledTimes(1);
    expect(phase).toHaveBeenCalledWith('idle', 'rotate');
  });
});
