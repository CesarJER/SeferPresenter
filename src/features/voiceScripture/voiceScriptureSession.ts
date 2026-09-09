import { VOICE_PCM_WORKLET } from './voicePcmWorklet';

export type VoiceSessionPhase = 'connecting' | 'listening' | 'partial' | 'final' | 'stopping' | 'idle' | 'error';
export interface VoiceSessionCallbacks {
  phase: (phase: VoiceSessionPhase, detail?: string) => void;
  final: (transcript: string, eventId: string) => void;
}
export const VOICE_LIMITS = {
  queueBytes: 256 * 1024,
  rotateBytes: 256 * 1024 * 1024,
  forceBytes: 448 * 1024 * 1024,
  stalledMs: 4_000,
  utteranceMs: 20_000,
};

/** Owns one audio track and socket. No React, persistence, transcript history or LiveKit. */
export class VoiceScriptureSession {
  private controller = new AbortController();
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private processor: AudioWorkletNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private stopping = false;
  private bytes = 0;
  private firstPartialAt = 0;
  private lastPartialAt = 0;
  private lastAudioAt = 0;
  private lastSttAt = 0;
  private seen = new Set<string>();
  private flushResolve: (() => void) | null = null;
  private track: MediaStreamTrack;
  private phrases: string[];
  private callbacks: VoiceSessionCallbacks;

  constructor(track: MediaStreamTrack, phrases: string[], callbacks: VoiceSessionCallbacks) {
    this.track = track;
    this.phrases = phrases;
    this.callbacks = callbacks;
  }

  private fail = (detail: string) => {
    if (this.stopped) return;
    this.dispose();
    this.callbacks.phase('error', detail);
  };

  async start() {
    if (this.stopped) return;
    this.callbacks.phase('connecting');
    this.startupTimer = setTimeout(() => this.fail('El inicio de audio STT agotó su tiempo'), 15_000);
    this.track.addEventListener('ended', this.trackEnded);
    try {
      if (this.track.readyState !== 'live') throw new Error('La fuente de audio ha terminado');
      const response = await fetch('/api/voice-scripture/token', {
        method: 'POST', headers: { Accept: 'application/json' },
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(7_000)]),
      });
      const data: unknown = await response.json();
      if (this.stopped) return;
      if (!response.ok || !data || typeof data !== 'object' || !('token' in data) || typeof data.token !== 'string') {
        throw new Error('STT no disponible o Control no autorizado');
      }
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${location.host}/voice-scripture/ws`, ['voice-scripture', data.token]);
      this.socket = socket;
      socket.addEventListener('message', this.message);
      socket.addEventListener('close', () => this.fail('Se perdió la conexión STT; vuelve a iniciar'));
      socket.addEventListener('error', () => this.fail('Error de conexión STT'));
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Tiempo de conexión STT agotado')), 7_000);
        const finish = () => { clearTimeout(timeout); resolve(); };
        socket.addEventListener('open', finish, { once: true });
        socket.addEventListener('close', finish, { once: true });
        this.controller.signal.addEventListener('abort', finish, { once: true });
      });
      if (this.stopped) return;
      socket.send(JSON.stringify({ type: 'session.update', session: {
        sample_rate: 16000, language: 'es-ES', automatic_punctuation: true,
        endpointing_ms: 1000, speech_contexts: [{ phrases: this.phrases, boost: 2.5 }],
      } }));
      const context = new AudioContext({ latencyHint: 'interactive' });
      this.context = context;
      if (context.sampleRate < 16000) throw new Error('Frecuencia de audio no soportada');
      const url = URL.createObjectURL(new Blob([VOICE_PCM_WORKLET], { type: 'text/javascript' }));
      try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      if (this.stopped) return;
      const processor = new AudioWorkletNode(context, 'sefer-pcm16');
      this.processor = processor;
      processor.port.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
        if (event.data === 'flushed') { this.flushResolve?.(); return; }
        if (this.stopped || !(event.data instanceof ArrayBuffer)) return;
        if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount + event.data.byteLength > VOICE_LIMITS.queueBytes) {
          this.fail('La cola de audio está bloqueada; vuelve a iniciar'); return;
        }
        socket.send(event.data);
        this.bytes += event.data.byteLength;
        this.lastAudioAt = Date.now();
        if (this.bytes >= VOICE_LIMITS.forceBytes) this.fail('Sesión sin límites de intervención; revisa endpointing');
      };
      const source = context.createMediaStreamSource(new MediaStream([this.track]));
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(processor).connect(silent).connect(context.destination);
      await context.resume();
      if (this.stopped) return;
      if (this.startupTimer) clearTimeout(this.startupTimer);
      this.startupTimer = null;
      this.lastAudioAt = Date.now();
      this.lastSttAt = Date.now();
      this.timer = setInterval(this.checkHealth, 500);
      this.callbacks.phase('listening');
    } catch (error) {
      if (!this.stopped) this.fail(error instanceof Error ? error.message : 'No se pudo iniciar STT');
    }
  }

  private trackEnded = () => this.fail('La fuente de audio ha terminado');

  private checkHealth = () => {
    const now = Date.now();
    if (now - this.lastAudioAt > 4_000) { this.fail('No llega audio de la fuente seleccionada'); return; }
    if (now - this.lastSttAt > 10_000) { this.fail('El motor no confirma procesamiento de audio'); return; }
    if (this.firstPartialAt && (now - this.lastPartialAt > VOICE_LIMITS.stalledMs || now - this.firstPartialAt > VOICE_LIMITS.utteranceMs)) {
      this.fail('No llegan finales STT: revisa endpointing y vuelve a iniciar');
    }
  };

  private message = (event: MessageEvent) => {
    if (this.stopped || this.stopping || typeof event.data !== 'string') return;
    try {
      const message = JSON.parse(event.data) as Record<string, unknown>;
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid STT event');
      this.lastSttAt = Date.now();
      if (message.type === 'error') { this.fail('El motor STT rechazó la sesión'); return; }
      if (message.type === 'conversation.item.input_audio_transcription.delta' && typeof message.delta === 'string' && message.delta.trim()) {
        this.firstPartialAt ||= Date.now();
        this.lastPartialAt = Date.now();
        this.callbacks.phase('partial');
      }
      if (message.type !== 'conversation.item.input_audio_transcription.completed') return;
      if (typeof message.transcript !== 'string' || typeof message.event_id !== 'string') {
        this.fail('Resultado STT sin identificador o texto válido'); return;
      }
      if (this.seen.has(message.event_id)) return;
      this.seen.add(message.event_id);
      if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
      if (this.firstPartialAt && Date.now() - this.firstPartialAt > VOICE_LIMITS.utteranceMs) {
        this.fail('Intervención demasiado larga; revisa la segmentación'); return;
      }
      this.firstPartialAt = 0;
      this.lastPartialAt = 0;
      this.callbacks.phase('final');
      this.callbacks.final(message.transcript, message.event_id);
      if (this.bytes >= VOICE_LIMITS.rotateBytes) {
        // The owner restarts on a clean utterance boundary with the same track.
        this.dispose();
        this.callbacks.phase('idle', 'rotate');
      }
    } catch { this.fail('Respuesta STT inválida'); }
  };

  async stop() {
    if (this.stopped || this.stopping) return;
    this.stopping = true; // From this point no final may trigger an action.
    this.callbacks.phase('stopping');
    if (this.processor && this.context?.state === 'running') {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 300);
        this.flushResolve = () => { clearTimeout(timeout); resolve(); };
        this.processor!.port.postMessage('flush');
      });
    }
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    this.dispose();
    this.callbacks.phase('idle');
  }

  dispose() {
    this.stopped = true;
    this.controller.abort();
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.flushResolve?.();
    this.track.removeEventListener('ended', this.trackEnded);
    this.processor?.disconnect();
    if (this.processor) this.processor.port.onmessage = null;
    this.processor = null;
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => undefined);
    this.context = null;
    this.socket?.close();
    this.socket = null;
    this.seen.clear();
  }
}
