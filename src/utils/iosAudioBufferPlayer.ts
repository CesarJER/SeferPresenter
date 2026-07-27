import {
  getManagedMediaAudioContext,
  isMediaPlaybackBlockedError,
  resumeManagedMediaAudio,
} from './mediaVolume';

const clamp01 = (value: number) => Math.max(0, Math.min(value, 1));

type ForwardedEvent = 'play' | 'pause' | 'ended' | 'loadedmetadata' | 'durationchange' | 'seeked';

export class IosAudioBufferPlayer extends EventTarget {
  private readonly context: AudioContext;
  private readonly gain: GainNode;
  private streamOutput: HTMLAudioElement | null = null;
  private usesDirectOutput = false;
  private fallback: HTMLAudioElement | null = null;
  private fallbackActive = false;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private loadPromise: Promise<void> | null = null;
  private loadAbortController: AbortController | null = null;
  private loadVersion = 0;
  private desiredPlaying = false;
  private offsetSec = 0;
  private startedAtContextSec = 0;
  private startedOffsetSec = 0;
  private rate = 1;
  private gainValue = 1;
  private loopValue = false;
  private sourceGeneration = 0;
  private sourceUrl = '';
  private readonly attributes = new Map<string, string>();

  constructor() {
    super();
    const context = getManagedMediaAudioContext();
    if (!context) throw new Error('Web Audio is not available');
    this.context = context;
    this.gain = context.createGain();
    this.configureOutput();
    this.context.addEventListener('statechange', this.handleContextStateChange);
    this.toggleActivationListeners(true);
  }

  setFallbackElement(element: HTMLAudioElement | null): void {
    if (this.fallback === element) return;
    if (this.fallback) this.toggleFallbackEvents(this.fallback, false);
    this.fallback = element;
    if (element) this.toggleFallbackEvents(element, true);
  }

  get src(): string { return this.sourceUrl; }
  set src(value: string) { this.sourceUrl = value; }
  get currentSrc(): string { return this.fallbackActive ? (this.fallback?.currentSrc ?? '') : this.sourceUrl; }
  get paused(): boolean { return this.fallbackActive ? (this.fallback?.paused ?? true) : !this.desiredPlaying; }
  get duration(): number { return this.fallbackActive ? (this.fallback?.duration ?? 0) : (this.buffer?.duration ?? 0); }

  get currentTime(): number {
    if (this.fallbackActive) return this.fallback?.currentTime ?? 0;
    if (!this.desiredPlaying || !this.source) return this.normalizePosition(this.offsetSec);
    const elapsed = Math.max(0, this.context.currentTime - this.startedAtContextSec) * this.rate;
    return this.normalizePosition(this.startedOffsetSec + elapsed);
  }

  set currentTime(value: number) {
    const position = this.normalizePosition(value);
    if (this.fallbackActive && this.fallback) {
      this.fallback.currentTime = position;
      return;
    }
    this.offsetSec = position;
    if (this.desiredPlaying && this.buffer) this.startSource(position);
    queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
  }

  get volume(): number { return this.fallbackActive ? (this.fallback?.volume ?? this.gainValue) : this.gainValue; }
  set volume(value: number) { this.setVolume(value, 0); }
  get muted(): boolean { return this.fallbackActive ? (this.fallback?.muted ?? false) : this.gainValue === 0; }
  set muted(value: boolean) { this.setVolume(value ? 0 : this.gainValue || 1, 0); }
  get playbackRate(): number { return this.fallbackActive ? (this.fallback?.playbackRate ?? this.rate) : this.rate; }
  set playbackRate(value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    if (this.fallbackActive && this.fallback) {
      this.fallback.playbackRate = value;
      return;
    }
    const position = this.currentTime;
    this.rate = value;
    this.offsetSec = position;
    this.startedOffsetSec = position;
    this.startedAtContextSec = this.context.currentTime;
    if (this.source) this.source.playbackRate.setValueAtTime(value, this.context.currentTime);
  }
  get loop(): boolean { return this.fallbackActive ? (this.fallback?.loop ?? this.loopValue) : this.loopValue; }
  set loop(value: boolean) {
    this.loopValue = value;
    if (this.fallbackActive && this.fallback) this.fallback.loop = value;
    if (this.source) this.source.loop = value;
  }

  setVolume(value: number, durationMs: number): void {
    const volume = clamp01(Number.isFinite(value) ? value : 1);
    this.gainValue = volume;
    if (this.fallbackActive && this.fallback) {
      try { this.fallback.volume = volume; } catch { /* Safari may ignore native volume. */ }
      return;
    }
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    if (durationMs > 0) this.gain.gain.linearRampToValueAtTime(volume, now + durationMs / 1000);
    else this.gain.gain.setValueAtTime(volume, now);
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === 'src') {
      this.loadVersion += 1;
      this.abortPendingLoad();
      this.loadPromise = null;
      this.sourceUrl = '';
      this.clearTrack();
      this.pauseStreamOutput();
    }
  }

  load(): void {
    const url = this.sourceUrl;
    const version = ++this.loadVersion;
    this.abortPendingLoad();
    this.clearTrack();
    this.fallbackActive = false;
    if (!url) {
      this.loadPromise = null;
      this.pauseStreamOutput();
      return;
    }

    const controller = new AbortController();
    this.loadAbortController = controller;
    const isCurrentLoad = () => (
      version === this.loadVersion &&
      this.loadAbortController === controller &&
      !controller.signal.aborted
    );

    this.loadPromise = (async () => {
      try {
        const response = await fetch(url, {
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!isCurrentLoad()) return;
        if (!response.ok) throw new Error(`Audio request failed (${response.status})`);

        const data = await response.arrayBuffer();
        if (!isCurrentLoad()) return;

        const buffer = await this.context.decodeAudioData(data);
        if (!isCurrentLoad()) return;

        this.buffer = buffer;
        this.dispatchEvent(new Event('loadedmetadata'));
        this.dispatchEvent(new Event('durationchange'));
        if (this.desiredPlaying) void this.startWhenReady().catch(() => {});
      } catch (error) {
        if (!isCurrentLoad()) return;
        console.error('[iOS AudioBuffer] Falling back to native audio:', error);
        this.activateFallback();
      } finally {
        if (this.loadAbortController === controller) {
          this.loadAbortController = null;
        }
      }
    })();
  }

  async play(): Promise<void> {
    this.desiredPlaying = true;
    if (this.fallbackActive) return this.fallback?.play() ?? Promise.resolve();
    if (this.loadPromise) await this.loadPromise;
    if (this.fallbackActive) return this.fallback?.play() ?? Promise.resolve();
    if (this.buffer && !this.loopValue && this.offsetSec >= this.buffer.duration - 0.01) {
      this.offsetSec = 0;
    }
    return this.startWhenReady();
  }

  pause(): void {
    if (this.fallbackActive) {
      this.desiredPlaying = false;
      this.fallback?.pause();
      return;
    }
    if (!this.desiredPlaying) return;
    this.offsetSec = this.currentTime;
    this.desiredPlaying = false;
    this.stopSource();
    this.pauseStreamOutput();
    this.dispatchEvent(new Event('pause'));
  }

  destroy(): void {
    this.loadVersion += 1;
    this.abortPendingLoad();
    this.loadPromise = null;
    this.desiredPlaying = false;
    this.stopSource();
    this.buffer = null;
    this.disposeStreamOutput();
    this.gain.disconnect();
    this.context.removeEventListener('statechange', this.handleContextStateChange);
    this.toggleActivationListeners(false);
    if (this.fallback) this.toggleFallbackEvents(this.fallback, false);
  }

  private async startWhenReady(): Promise<void> {
    if (!this.buffer || !this.desiredPlaying) return;
    await resumeManagedMediaAudio();
    if (!this.desiredPlaying) return;
    await this.ensureStreamOutputPlaying();
    if (!this.desiredPlaying) {
      this.pauseStreamOutput();
      return;
    }
    if (this.context.state !== 'running') {
      throw new DOMException('AudioContext requires user activation', 'NotAllowedError');
    }
    if (!this.source) {
      this.startSource(this.offsetSec);
      this.dispatchEvent(new Event('play'));
    }
  }

  private startSource(positionSec: number): void {
    this.stopSource();
    if (!this.buffer) return;
    const source = this.context.createBufferSource();
    const generation = ++this.sourceGeneration;
    const offset = this.normalizePosition(positionSec);
    source.buffer = this.buffer;
    source.loop = this.loopValue;
    source.playbackRate.setValueAtTime(this.rate, this.context.currentTime);
    source.connect(this.gain);
    source.onended = () => {
      if (generation !== this.sourceGeneration || this.loopValue || !this.desiredPlaying) return;
      this.source = null;
      this.desiredPlaying = false;
      this.offsetSec = this.buffer?.duration ?? offset;
      this.pauseStreamOutput();
      this.dispatchEvent(new Event('ended'));
    };
    this.source = source;
    this.offsetSec = offset;
    this.startedOffsetSec = offset;
    this.startedAtContextSec = this.context.currentTime;
    source.start(0, offset);
  }

  private stopSource(): void {
    if (!this.source) return;
    this.sourceGeneration += 1;
    const source = this.source;
    this.source = null;
    source.onended = null;
    try { source.stop(); } catch { /* Source may already be stopped. */ }
    source.disconnect();
  }

  private clearTrack(): void {
    this.stopSource();
    this.buffer = null;
    this.offsetSec = 0;
  }

  private abortPendingLoad(): void {
    this.loadAbortController?.abort();
    this.loadAbortController = null;
  }

  private normalizePosition(value: number): number {
    const position = Number.isFinite(value) ? Math.max(0, value) : 0;
    const duration = this.buffer?.duration;
    if (!duration || duration <= 0) return position;
    if (this.loopValue) return position % duration;
    return Math.min(position, Math.max(0, duration - 0.001));
  }

  private activateFallback(): void {
    const fallback = this.fallback;
    if (!fallback) return;
    this.useDirectOutput();
    this.fallbackActive = true;
    fallback.src = this.sourceUrl;
    fallback.loop = this.loopValue;
    fallback.playbackRate = this.rate;
    try { fallback.volume = this.gainValue; } catch { /* Safari may ignore native volume. */ }
    fallback.load();
    try { fallback.currentTime = this.offsetSec; } catch { /* Metadata may not be available yet. */ }
    if (this.desiredPlaying) void fallback.play().catch(() => {});
  }

  private readonly handleContextStateChange = () => {
    if (this.context.state === 'running' && this.desiredPlaying && this.buffer && !this.source) {
      void this.startWhenReady().catch(() => {});
    }
  };

  private configureOutput(): void {
    if (typeof document === 'undefined') {
      this.useDirectOutput();
      return;
    }

    try {
      const destination = this.context.createMediaStreamDestination();
      const output = document.createElement('audio');
      output.autoplay = true;
      output.preload = 'none';
      output.controls = false;
      output.volume = 1;
      output.srcObject = destination.stream;
      output.style.display = 'none';
      output.setAttribute('aria-hidden', 'true');
      output.setAttribute('playsinline', '');
      output.setAttribute('data-ios-buffer-stream-output', '');
      output.setAttribute('x-webkit-airplay', 'deny');
      document.body.appendChild(output);

      this.streamOutput = output;
      this.gain.connect(destination);
    } catch (error) {
      console.warn('[iOS AudioBuffer] MediaStream output unavailable; using AudioContext destination.', error);
      this.useDirectOutput();
    }
  }

  private async ensureStreamOutputPlaying(): Promise<void> {
    const output = this.streamOutput;
    if (!output || !output.paused) return;

    try {
      await output.play();
    } catch (error) {
      if (isMediaPlaybackBlockedError(error)) throw error;
      console.warn('[iOS AudioBuffer] MediaStream output failed; using AudioContext destination.', error);
      this.useDirectOutput();
    }
  }

  private useDirectOutput(): void {
    if (this.usesDirectOutput) return;
    try { this.gain.disconnect(); } catch { /* The gain may not be connected yet. */ }
    this.disposeStreamOutput();
    this.gain.connect(this.context.destination);
    this.usesDirectOutput = true;
  }

  private pauseStreamOutput(): void {
    this.streamOutput?.pause();
  }

  private disposeStreamOutput(): void {
    const output = this.streamOutput;
    if (!output) return;
    output.pause();
    output.srcObject = null;
    output.remove();
    this.streamOutput = null;
  }

  private toggleActivationListeners(attach: boolean): void {
    if (typeof window === 'undefined') return;
    const method = attach ? 'addEventListener' : 'removeEventListener';
    window[method]('pointerdown', this.handleUserActivation, { capture: true });
    window[method]('touchstart', this.handleUserActivation, { capture: true });
    window[method]('click', this.handleUserActivation, { capture: true });
    window[method]('keydown', this.handleUserActivation, { capture: true });
  }

  private readonly handleUserActivation = () => {
    if (!this.desiredPlaying || !this.buffer || this.source) return;
    // Invoke play synchronously from the activation event before awaiting resume().
    const outputPlay = this.ensureStreamOutputPlaying();
    void resumeManagedMediaAudio()
      .then(() => outputPlay)
      .then(() => this.startWhenReady())
      .catch(() => {});
  };

  private toggleFallbackEvents(element: HTMLAudioElement, attach: boolean): void {
    const method = attach ? 'addEventListener' : 'removeEventListener';
    for (const eventName of ['play', 'pause', 'ended', 'loadedmetadata', 'durationchange', 'seeked'] as ForwardedEvent[]) {
      element[method](eventName, this.forwardFallbackEvent);
    }
  }

  private readonly forwardFallbackEvent = (event: Event) => {
    if (!this.fallbackActive) return;
    if (event.type === 'play') this.desiredPlaying = true;
    if (event.type === 'pause' || event.type === 'ended') this.desiredPlaying = false;
    this.dispatchEvent(new Event(event.type));
  };
}
