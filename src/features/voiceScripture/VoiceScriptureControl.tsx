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
}

type Availability = 'checking' | 'disabled' | 'unavailable' | 'ready';
type ListeningState = 'idle' | 'connecting' | 'listening' | 'error';

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

export default function VoiceScriptureControl({ tracks, scriptureState, onProject }: VoiceScriptureControlProps) {
  const [availability, setAvailability] = useState<Availability>('checking');
  const [listeningState, setListeningState] = useState<ListeningState>('idle');
  const [selectedTrackId, setSelectedTrackId] = useState('');
  const [candidate, setCandidate] = useState<VoiceScriptureCandidate | null>(null);
  const metadataRef = useRef<AppMetadata>({});
  const scriptureStateRef = useRef(scriptureState);
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    scriptureStateRef.current = scriptureState;
  }, [scriptureState]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/voice-scripture/status', { headers: { Accept: 'application/json' } }).then((response) => (
        response.ok ? response.json() as Promise<{ enabled?: boolean; available?: boolean }> : null
      )),
      getMetadata(),
    ]).then(([status, metadata]) => {
      if (cancelled) return;
      metadataRef.current = metadata;
      setAvailability(!status?.enabled ? 'disabled' : status.available ? 'ready' : 'unavailable');
    }).catch(() => {
      if (!cancelled) setAvailability('unavailable');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (tracks.length === 1) setSelectedTrackId(tracks[0].id);
    if (selectedTrackId && !tracks.some((track) => track.id === selectedTrackId)) setSelectedTrackId('');
  }, [selectedTrackId, tracks]);

  const stop = useCallback(() => {
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
    const parsed = parseVoiceScriptureCommand(
      transcript,
      makeContext(scriptureStateRef.current),
      metadataRef.current,
    );
    if (parsed) setCandidate(parsed);
  }, []);

  const start = useCallback(async () => {
    const selected = tracks.find((track) => track.id === selectedTrackId);
    if (!selected || availability !== 'ready') return;
    setCandidate(null);
    setListeningState('connecting');

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/voice-scripture/ws`);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener('error', () => reject(new Error('STT unavailable')), { once: true });
      });
      socket.send(JSON.stringify({
        type: 'session.update',
        session: {
          sample_rate: 16000,
          language: 'es-ES',
          automatic_punctuation: true,
          endpointing_ms: 800,
          speech_contexts: [{
            phrases: ['Bereshit', 'Shemot', 'Vayikra', 'Bamidbar', 'Devarim', 'Yeshayahu'],
            boost: 2.5,
          }],
        },
      }));

      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const message = JSON.parse(event.data) as { type?: string; transcript?: string };
          if (
            message.type === 'conversation.item.input_audio_transcription.completed' &&
            typeof message.transcript === 'string'
          ) {
            handleFinalTranscript(message.transcript);
          } else if (message.type === 'error') {
            setListeningState('error');
          }
        } catch {
          setListeningState('error');
        }
      });
      socket.addEventListener('close', () => {
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
        if (socket.readyState === WebSocket.OPEN) socket.send(event.data);
      };
      source.connect(processor).connect(silentOutput).connect(context.destination);
      await context.resume();
      setListeningState('listening');
    } catch {
      socketRef.current?.close();
      socketRef.current = null;
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      setListeningState('error');
    }
  }, [availability, handleFinalTranscript, selectedTrackId, tracks]);

  const showCandidate = useCallback(async () => {
    if (!candidate) return;
    const state = await hydrateCandidate(candidate);
    if (state) {
      onProject(state, 'navigate');
      setCandidate(null);
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

  return (
    <section className="rounded border border-cyan-900/70 bg-cyan-950/20 p-2 text-xs text-gray-200" aria-label="Navegación bíblica por voz">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Navegación bíblica por voz</span>
        <span className="text-[11px] text-gray-400">{statusText}</span>
      </div>
      <div className="mt-2 flex gap-2">
        <select
          value={selectedTrackId}
          onChange={(event) => setSelectedTrackId(event.target.value)}
          disabled={listeningState === 'listening'}
          className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1"
          aria-label="Fuente de voz"
        >
          <option value="">Selecciona una voz</option>
          {tracks.map((track) => <option key={track.id} value={track.id}>{track.label}</option>)}
        </select>
        <button
          type="button"
          onClick={listeningState === 'listening' || listeningState === 'connecting' ? stop : start}
          disabled={availability !== 'ready' || (!selectedTrackId && listeningState === 'idle')}
          className="rounded bg-cyan-800 px-3 py-1 font-semibold text-white disabled:opacity-40"
        >
          {listeningState === 'listening' || listeningState === 'connecting' ? 'Detener' : 'Activar'}
        </button>
      </div>
      {candidate && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded border border-cyan-700 bg-gray-950 p-2">
          <span aria-live="polite">🎙 {candidateLabel(candidate)}</span>
          <button type="button" onClick={() => void showCandidate()} className="rounded bg-emerald-700 px-3 py-1 font-semibold text-white">
            Mostrar
          </button>
        </div>
      )}
    </section>
  );
}
