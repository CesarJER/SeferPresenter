// Kept as an independent worklet module; tests execute this exact source.
export const VOICE_PCM_WORKLET = `
class SeferPcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.phase = 0;
    this.output = new Int16Array(5120);
    this.index = 0;
    this.ring = new Float32Array(63);
    this.cursor = 0;
    const cutoff = Math.min(0.45, 7200 / sampleRate);
    this.filter = Float64Array.from({ length: 63 }, (_, i) => {
      const x = i - 31;
      return (x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x))
        * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / 62));
    });
    const sum = this.filter.reduce((a, b) => a + b, 0);
    this.filter = this.filter.map(value => value / sum);
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        this.active = false;
        if (this.index) this.emit();
        this.port.postMessage('flushed');
      }
    };
  }
  emit() {
    const buffer = this.output.slice(0, this.index).buffer;
    this.port.postMessage(buffer, [buffer]);
    this.index = 0;
  }
  process(inputs) {
    if (!this.active) return true;
    const channels = inputs[0];
    if (!channels || !channels.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      this.ring[this.cursor] = sample / channels.length;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        let filtered = 0;
        for (let tap = 0; tap < 63; tap++) filtered += this.filter[tap] * this.ring[(this.cursor - tap + 63) % 63];
        filtered = Math.max(-1, Math.min(1, filtered));
        this.output[this.index++] = filtered < 0 ? filtered * 32768 : filtered * 32767;
        if (this.index === this.output.length) this.emit();
      }
      this.cursor = (this.cursor + 1) % 63;
    }
    return true;
  }
}
registerProcessor('sefer-pcm16', SeferPcm16Processor);
`;
