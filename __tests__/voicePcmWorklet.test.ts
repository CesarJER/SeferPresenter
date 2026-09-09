import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { VOICE_PCM_WORKLET } from '../src/features/voiceScripture/voicePcmWorklet';

const render = (rate: number, frequency: number, count = rate) => {
  const frames: ArrayBuffer[] = [];
  let Processor;
  const scope = {
    sampleRate: rate, Float32Array, Float64Array, Int16Array, Math,
    AudioWorkletProcessor: class { port = { onmessage: null, postMessage: (data) => { if (data instanceof ArrayBuffer) frames.push(data); } }; },
    registerProcessor: (_name, constructor) => { Processor = constructor; },
  };
  vm.runInNewContext(VOICE_PCM_WORKLET, scope);
  const processor = new Processor();
  for (let offset = 0; offset < count; offset += 128) {
    const input = Float32Array.from({ length: Math.min(128, count - offset) }, (_, index) => 0.5 * Math.sin(2 * Math.PI * frequency * (offset + index) / rate));
    processor.process([[input]]);
  }
  processor.port.onmessage({ data: 'flush' });
  return frames.flatMap((frame) => [...new Int16Array(frame)]);
};
describe('filtered PCM worklet', () => {
  it.each([16000, 44100, 48000])('produces 16k samples including the partial tail from %s Hz', (rate) => {
    expect(render(rate, 1000)).toHaveLength(16000);
  });
  it('flushes a sub-frame recording', () => expect(render(48000, 1000, 4800)).toHaveLength(1600));
  it('attenuates frequencies above the output Nyquist limit', () => {
    const rms = (samples: number[]) => Math.sqrt(samples.slice(100).reduce((sum, v) => sum + v * v, 0) / (samples.length - 100));
    expect(rms(render(48000, 12000)) / rms(render(48000, 1000))).toBeLessThan(0.02);
  });
});
