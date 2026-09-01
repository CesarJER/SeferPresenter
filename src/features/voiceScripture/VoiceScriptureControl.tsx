import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SeferReaderState, VerseData } from '../../hooks/useSeferReader';
import type { ScriptureNavState } from '../../types/presentation';
import { getMetadata, loadBookData, type AppMetadata } from '../../utils/metadataCache';
import { parseVerses } from '../../utils/scriptureParser';
import {
  parseVoiceScriptureCommand,
  type VoiceScriptureCandidate,
} from './voiceScriptureParser';

interface VoiceTrack {
  id: string;
  label: string;
  track: MediaStreamTrack;
}

interface VoiceScriptureControlProps {
  tracks: VoiceTrack[];
  scriptureState: ScriptureNavState | null;
  onProject: (state: SeferReaderState, command?: 'navigate') => void;
  onStateChange?: (state: 'idle' | 'listening-own' | 'listening-other') => void;
}

type Availability = 'checking' | 'disabled' | 'unavailable' | 'ready';
type ListeningState = 'idle' | 'connecting' | 'listening' | 'error';
interface VoiceScriptureStatus {
  enabled?: boolean;
  available?: boolean;
  debug?: boolean;
}

const debugLog = (enabled: boolean, event: string, details: Record<string, unknown> = {}) => {
  if (enabled) console.debug('[VOICE_SCRIPTURE_DEBUG]', { event, ...details });
};

const WORKLET_SOURCE = `
class SeferPcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.rateAccumulator = 0;
    this.output = new Int16Array(5120);
    this.outputIndex = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let index = 0; index < channel.length; index += 1) {
      this.rateAccumulator += this.targetRate;
      if (this.rateAccumulator < sampleRate) continue;
      this.rateAccumulator -= sampleRate;
      const sample = Math.max(-1, Math.min(1, channel[index]));
      this.output[this.outputIndex++] = sample < 0 ? sample * 32768 : sample * 32767;
      if (this.outputIndex === this.output.length) {
        this.port.postMessage(this.output.buffer, [this.output.buffer]);
        this.output = new Int16Array(5120);
        this.outputIndex = 0;
      }
    }
    return true;
  }
}
registerProcessor('sefer-pcm16', SeferPcm16Processor);
`;

const makeContext = (state: ScriptureNavState | null) => state ? {
  book: state.bookAbbrevEs || state.bookEs,
  chapter: Number(state.chapter),
  verse: Number(state.verse),
} : null;

const hydrateCandidate = async (candidate: VoiceScriptureCandidate): Promise<SeferReaderState | null> => {
  const verses = await loadBookData(candidate.book, parseVerses) as VerseData[];
  const startIndex = verses.findIndex((verse) => (
    verse.chapter === String(candidate.chapter) && verse.verse === String(candidate.verseStart)
  ));
  if (startIndex < 0) return null;
  const start = verses[startIndex];
  const rangeLength = candidate.verseEnd - candidate.verseStart + 1;
  return {
    bookEs: start.bookEs,
    bookHeb: start.bookHeb,
    bookAbbrevEs: start.bookAbbrevEs,
    chapter: String(candidate.chapter),
    verseStart: String(candidate.verseStart),
    verse: String(candidate.verseStart),
    verseEnd: candidate.verseEnd > candidate.verseStart ? String(candidate.verseEnd) : undefined,
    verseNikud: start.verseNikudSanitized ?? start.verseNikud,
    verseNikudSanitized: start.verseNikudSanitized,
    transliteration: start.transliteration,
    translation: start.translation,
    verseIdx: startIndex,
    totalVerses: rangeLength > 1 ? rangeLength : verses.length,
    scriptureKind: 'sefer',
  };
};

const candidateLabel = (candidate: VoiceScriptureCandidate) => {
  const range = candidate.verseEnd === candidate.verseStart
    ? candidate.verseStart
    : `${candidate.verseStart}-${candidate.verseEnd}`;
  return `${candidate.bookAbbrev} ${candidate.chapter}:${range}`;
};

const CONTEXTUAL_PHRASES = [
  'capítulo', 'versículo', 'siguiente versículo', 'versículo anterior',
  'siguiente capítulo', 'capítulo anterior', 'ahora el', 'volvamos al', 'continúa hasta',
  'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
  'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
  'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa', 'cien', 'ciento'
];

const makeSpeechContextPhrases = (metadata: AppMetadata) => {
  const entries = Object.entries(metadata);
  return [...new Set([
    ...CONTEXTUAL_PHRASES,
    ...entries.flatMap(([, details]) => details.voiceAliases ?? []),
    ...entries.flatMap(([book]) => [book]),
  ].map((phrase) => phrase.trim()).filter((phrase) => phrase.length > 0 && phrase.length <= 80))].slice(0, 256);
};

export default function VoiceScriptureControl({ tracks, scriptureState, onProject, onStateChange }: VoiceScriptureControlProps) {
  const [availability, setAvailability] = useState<Availability>('checking');
  const [listeningState, setListeningState] = useState<ListeningState>('idle');
  const [selectedTrackId, setSelectedTrackId] = useState('');
  const [candidate, setCandidate] = useState<VoiceScriptureCandidate | null>(null);
  const metadataRef = useRef<AppMetadata>({});
  const scriptureStateRef = useRef(scriptureState);
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const debugRef = useRef(false);
  const audioStatsRef = useRef({ frames: 0, bytes: 0 });

  useEffect(() => {
    scriptureStateRef.current = scriptureState;
  }, [scriptureState]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/voice-scripture/status', { headers: { Accept: 'application/json' } }).then((response) => (
        response.ok ? response.json() as Promise<VoiceScriptureStatus> : null
      )),
      getMetadata(),
    ]).then(([status, metadata]) => {
      if (cancelled) return;
      debugRef.current = status?.debug === true;
      metadataRef.current = metadata;
      debugLog(debugRef.current, 'client.status', {
        enabled: status?.enabled === true,
        available: status?.available === true,
        metadataBooks: Object.keys(metadata).length,
      });
      setAvailability(!status?.enabled ? 'disabled' : status.available ? 'ready' : 'unavailable');
    }).catch((error: unknown) => {
      debugLog(debugRef.current, 'client.status-error', {
        message: error instanceof Error ? error.message : String(error),
      });
      if (!cancelled) setAvailability('unavailable');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (onStateChange) {
      if (listeningState === 'listening' || listeningState === 'connecting') {
        onStateChange(selectedTrackId === 'local-mic' ? 'listening-own' : 'listening-other');
      } else {
        onStateChange('idle');
      }
    }
  }, [listeningState, selectedTrackId, onStateChange]);

  useEffect(() => {
    if (tracks.length === 1) setSelectedTrackId(tracks[0].id);
    if (selectedTrackId && !tracks.some((track) => track.id === selectedTrackId)) setSelectedTrackId('');
  }, [selectedTrackId, tracks]);

  const stop = useCallback(() => {
    debugLog(debugRef.current, 'client.stop', audioStatsRef.current);
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      socket.close(1000, 'Voice Scripture stopped');
    } else {
      socket?.close();
    }
    socketRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setListeningState('idle');
  }, []);

  useEffect(() => {
    if (
      (listeningState === 'connecting' || listeningState === 'listening') &&
      !tracks.some((track) => track.id === selectedTrackId)
    ) {
      stop();
    }
  }, [listeningState, selectedTrackId, stop, tracks]);

  useEffect(() => stop, [stop]);

  const handleFinalTranscript = useCallback((transcript: string) => {
    const context = makeContext(scriptureStateRef.current);
    const parsed = parseVoiceScriptureCommand(
      transcript,
      context,
      metadataRef.current,
    );
    debugLog(debugRef.current, 'parser.result', { transcript, context, candidate: parsed });
    if (parsed) setCandidate(parsed);
  }, []);

  const start = useCallback(async () => {
    const selected = tracks.find((track) => track.id === selectedTrackId);
    if (!selected || availability !== 'ready') return;
    setCandidate(null);
    setListeningState('connecting');
    audioStatsRef.current = { frames: 0, bytes: 0 };
    debugLog(debugRef.current, 'client.start', {
      trackId: selected.id,
      trackLabel: selected.label,
      trackReadyState: selected.track.readyState,
      trackMuted: selected.track.muted,
    });

    try {
      const res = await fetch('/api/voice-scripture/token', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json() as { available: boolean; token?: string };
      debugLog(debugRef.current, 'client.capability', {
        httpStatus: res.status,
        available: data.available,
        tokenIssued: Boolean(data.token),
      });
      if (!res.ok || !data.available || !data.token) throw new Error('STT unavailable');

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = new URL(`${protocol}//${window.location.host}/voice-scripture/ws`);
      const socket = new WebSocket(wsUrl, ['voice-scripture', data.token]);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => {
          debugLog(debugRef.current, 'client.socket-open', { protocol: socket.protocol });
          resolve();
        }, { once: true });
        socket.addEventListener('error', () => {
          reject(new Error('STT unavailable'));
        }, { once: true });
      });
      const speechContextPhrases = makeSpeechContextPhrases(metadataRef.current);
      socket.send(JSON.stringify({
        type: 'session.update',
        session: {
          sample_rate: 16000,
          language: 'es-ES',
          automatic_punctuation: true,
          endpointing_ms: 800,
          speech_contexts: [{
            phrases: speechContextPhrases,
            boost: 2.5,
          }],
        },
      }));
      debugLog(debugRef.current, 'client.session-update', {
        phraseCount: speechContextPhrases.length,
      });

      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const message = JSON.parse(event.data) as { type?: string; transcript?: string; delta?: string };
          debugLog(debugRef.current, 'client.stt-event', { ...message });
          if (
            message.type === 'conversation.item.input_audio_transcription.completed' &&
            typeof message.transcript === 'string'
          ) {
            handleFinalTranscript(message.transcript);
          } else if (message.type === 'error') {
            setListeningState('error');
          }
        } catch (error) {
          debugLog(debugRef.current, 'client.stt-invalid-json', {
            message: error instanceof Error ? error.message : String(error),
            payload: event.data.slice(0, 8_000),
          });
          setListeningState('error');
        }
      });
      socket.addEventListener('error', () => {
        debugLog(debugRef.current, 'client.socket-error');
      });
      socket.addEventListener('close', (event) => {
        debugLog(debugRef.current, 'client.socket-close', {
          code: event.code,
          reason: event.reason,
          ...audioStatsRef.current,
        });
        if (socketRef.current === socket) {
          socketRef.current = null;
          void audioContextRef.current?.close();
          audioContextRef.current = null;
          setListeningState('idle');
        }
      });

      const context = new AudioContext({ latencyHint: 'interactive' });
      audioContextRef.current = context;
      const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
      try {
        await context.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }
      const source = context.createMediaStreamSource(new MediaStream([selected.track]));
      const processor = new AudioWorkletNode(context, 'sefer-pcm16');
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      processor.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(event.data);
          audioStatsRef.current.frames += 1;
          audioStatsRef.current.bytes += event.data.byteLength;
          if (audioStatsRef.current.frames === 1 || audioStatsRef.current.frames % 16 === 0) {
            debugLog(debugRef.current, 'client.audio-sent', audioStatsRef.current);
          }
        }
      };
      source.connect(processor).connect(silentOutput).connect(context.destination);
      await context.resume();
      debugLog(debugRef.current, 'client.audio-ready', { audioContextState: context.state });
      setListeningState('listening');
    } catch (error) {
      debugLog(debugRef.current, 'client.start-error', {
        message: error instanceof Error ? error.message : String(error),
      });
      socketRef.current?.close();
      socketRef.current = null;
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      setListeningState('error');
    }
  }, [availability, handleFinalTranscript, selectedTrackId, tracks]);

  const showCandidate = useCallback(async () => {
    if (candidate) {
      const state = await hydrateCandidate(candidate);
      debugLog(debugRef.current, 'candidate.hydrated', {
        candidate,
        found: Boolean(state),
      });
      if (state) {
        onProject(state, 'navigate');
        debugLog(debugRef.current, 'candidate.projected', { candidate });
        setCandidate(null);
      }
    }
  }, [candidate, onProject]);

  const statusText = useMemo(() => {
    if (availability === 'checking') return 'Comprobando…';
    if (availability === 'disabled') return 'No habilitado en runtime';
    if (availability === 'unavailable') return 'STT local no disponible';
    if (listeningState === 'connecting') return 'Conectando…';
    if (listeningState === 'listening') return 'Escuchando';
    if (listeningState === 'error') return 'Error; puedes reintentar';
    return 'Listo';
  }, [availability, listeningState]);

  if (availability === 'disabled') return null;

  const isListening = listeningState === 'listening' || listeningState === 'connecting';
  const isOwnMic = selectedTrackId === 'local-mic';

  return (
    <>
      <button
        type="button"
        popoverTarget="voice-scripture-menu"
        className={`flex items-center justify-center p-1.5 text-xs font-semibold rounded border transition-all cursor-pointer ${
          isListening 
            ? isOwnMic
              ? 'bg-blue-600 border-blue-500 text-white'
              : 'bg-gray-800 border-blue-500 text-blue-400'
            : 'bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white'
        }`}
        title="Navegación de referencias por voz"
        aria-label="Abrir menú de referencias por voz"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
      </button>

      <div 
        id="voice-scripture-menu" 
        popover="auto" 
        className="rounded-lg border border-cyan-900/70 bg-cyan-950/90 p-3 text-xs text-gray-200 shadow-xl m-2 ml-auto"
        style={{ top: '60px', right: '10px', position: 'absolute' }}
      >
        <div className="flex flex-col gap-3 min-w-[250px]">
          <div className="flex items-center justify-between gap-4 border-b border-cyan-800 pb-2">
            <span className="font-bold flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              Referencias por Voz
            </span>
            <span className="text-[10px] text-gray-400 font-medium bg-gray-900 px-1.5 py-0.5 rounded">{statusText}</span>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase text-gray-400 font-bold tracking-wider">Fuente de audio</label>
            <select
              value={selectedTrackId}
              onChange={(event) => setSelectedTrackId(event.target.value)}
              disabled={isListening}
              className="min-w-0 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600 outline-none transition-all"
              aria-label="Fuente de voz"
            >
              <option value="">-- Selecciona una voz --</option>
              {tracks.map((track) => <option key={track.id} value={track.id}>{track.label}</option>)}
            </select>
          </div>

          <button
            type="button"
            onClick={isListening ? stop : start}
            disabled={availability !== 'ready' || (!selectedTrackId && !isListening)}
            className={`w-full rounded py-2 font-bold transition-all ${
              isListening
                ? 'bg-red-900 hover:bg-red-800 text-red-100 border border-red-700'
                : 'bg-cyan-800 hover:bg-cyan-700 text-white border border-cyan-600'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {isListening ? 'Detener STT' : 'Iniciar STT'}
          </button>

          {candidate && (
            <div className="mt-1 flex items-center justify-between gap-2 rounded border border-cyan-700 bg-gray-900 p-2 animate-in slide-in-from-top-2 fade-in">
              <span aria-live="polite" className="font-semibold text-cyan-300 flex items-center gap-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
                {candidateLabel(candidate)}
              </span>
              <button 
                type="button" 
                onClick={() => void showCandidate()} 
                className="rounded bg-emerald-700 hover:bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white transition-colors"
              >
                Cargar
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
