import { useCallback, useEffect, useRef, useState } from 'react';
import type { SeferReaderState } from '../../hooks/useSeferReader';
import type { ScriptureNavState } from '../../types/presentation';
import { getMetadata, type AppMetadata } from '../../utils/metadataCache';
import { parseVoiceScriptureUtterance, type VoiceScriptureCandidate } from './voiceScriptureParser';
import { candidateLabel, hydrateCandidate, makeContext, makeSpeechContextPhrases } from './voiceScriptureProjection';
import { VoiceScriptureSession, type VoiceSessionPhase } from './voiceScriptureSession';

interface VoiceTrack { id: string; label: string; track: MediaStreamTrack }
interface VoiceScriptureControlProps {
  tracks: VoiceTrack[];
  scriptureState: ScriptureNavState | null;
  onProject: (state: SeferReaderState, command?: 'navigate') => void;
  onStateChange?: (state: 'idle' | 'listening-own' | 'listening-other') => void;
}
const phaseText: Record<VoiceSessionPhase, string> = {
  idle: 'Listo', connecting: 'Conectando…', listening: 'Recibiendo audio', partial: 'Transcribiendo…',
  final: 'Intervención recibida', stopping: 'Deteniendo…', error: 'Error',
};
const projectionKey = (state: ScriptureNavState | null) => JSON.stringify([
  state?.bookAbbrevEs || state?.bookEs, state?.chapter, state?.verse, state?.verseStart, state?.verseEnd, state?.commandId,
]);

export default function VoiceScriptureControl({ tracks, scriptureState, onProject, onStateChange }: VoiceScriptureControlProps) {
  const [availability, setAvailability] = useState<'checking' | 'disabled' | 'unavailable' | 'ready'>('checking');
  const [selectedId, setSelectedId] = useState('');
  const [phase, setPhase] = useState<VoiceSessionPhase>('idle');
  const [detail, setDetail] = useState('');
  const [options, setOptions] = useState<VoiceScriptureCandidate[]>([]);
  const session = useRef<VoiceScriptureSession | null>(null);
  const selectedTrack = useRef<MediaStreamTrack | null>(null);
  const metadata = useRef<AppMetadata>({});
  const active = useRef(false);
  const mounted = useRef(true);
  const operation = useRef(0);
  const availabilityRequest = useRef(0);
  const projectionQueue = useRef(Promise.resolve());
  const hydration = useRef<AbortController | null>(null);
  const pending = useRef<{ candidate: VoiceScriptureCandidate; timer: ReturnType<typeof setTimeout> } | null>(null);
  const current = useRef({ scriptureState, onProject });
  const restart = useRef<() => void>(() => undefined);
  current.current = { scriptureState, onProject };

  const clearPending = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  }, []);
  const stop = useCallback(() => {
    active.current = false;
    operation.current += 1;
    hydration.current?.abort();
    clearPending();
    setOptions([]);
    void session.current?.stop();
  }, [clearPending]);
  const refresh = useCallback(async () => {
    const request = ++availabilityRequest.current;
    setAvailability('checking');
    try {
      const [response, books] = await Promise.all([
        fetch('/api/voice-scripture/status', { signal: AbortSignal.timeout(5_000) }), getMetadata(),
      ]);
      const data: unknown = await response.json();
      if (!mounted.current || request !== availabilityRequest.current) return;
      metadata.current = books;
      const valid = response.ok && data && typeof data === 'object';
      setAvailability(valid && 'enabled' in data && data.enabled === false ? 'disabled'
        : valid && 'available' in data && data.available === true && Object.keys(books).length ? 'ready' : 'unavailable');
    } catch { if (mounted.current && request === availabilityRequest.current) setAvailability('unavailable'); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      active.current = false;
      operation.current += 1;
      hydration.current?.abort();
      availabilityRequest.current += 1;
      clearPending();
      session.current?.dispose();
    };
  }, [clearPending, refresh]);
  useEffect(() => {
    if (!tracks.some((track) => track.id === selectedId)) setSelectedId(tracks.length === 1 ? tracks[0].id : '');
    const track = tracks.find((entry) => entry.id === selectedId)?.track;
    if (active.current && track !== selectedTrack.current) stop();
  }, [tracks, selectedId, stop]);
  useEffect(() => {
    const listening = !['idle', 'error'].includes(phase);
    onStateChange?.(listening ? selectedId === 'local-mic' ? 'listening-own' : 'listening-other' : 'idle');
  }, [phase, selectedId, onStateChange]);
  useEffect(() => () => onStateChange?.('idle'), [onStateChange]);
  useEffect(() => {
    const expected = pending.current?.candidate;
    if (!expected || !scriptureState) return;
    if ((scriptureState.bookAbbrevEs || scriptureState.bookEs) === expected.bookAbbrev
      && Number(scriptureState.chapter) === expected.chapter && Number(scriptureState.verse) === expected.verseStart
      && Number(scriptureState.verseEnd || scriptureState.verse) === expected.verseEnd) {
      clearPending();
      setDetail('Proyección confirmada por el servidor');
    }
  }, [scriptureState, clearPending]);
  const project = useCallback((candidate: VoiceScriptureCandidate) => {
    const id = ++operation.current;
    hydration.current?.abort();
    const controller = new AbortController();
    hydration.current = controller;
    const contextKey = projectionKey(current.current.scriptureState);
    projectionQueue.current = projectionQueue.current.then(async () => {
      if (!active.current || id !== operation.current) return;
      try {
        const hydrated = await hydrateCandidate(candidate, controller.signal);
        if (!active.current || !mounted.current || id !== operation.current) return;
        if (contextKey !== projectionKey(current.current.scriptureState)) {
          setDetail('El contexto cambió; selecciona la referencia de nuevo'); return;
        }
        if (!hydrated) { setDetail('No se pudo cargar la referencia'); return; }
        clearPending();
        pending.current = { candidate, timer: setTimeout(() => {
          if (!mounted.current) return;
          stop();
          setDetail('Sin confirmación del servidor; automatización detenida');
        }, 3_000) };
        current.current.onProject(hydrated, 'navigate');
        setDetail('Esperando confirmación del servidor');
      } catch {
        if (mounted.current && id === operation.current) {
          clearPending();
          setDetail('Error al cargar o proyectar la referencia');
        }
      }
    });
  }, [clearPending, stop]);
  const start = useCallback((preserve = false) => {
    const selected = tracks.find((track) => track.id === selectedId);
    if (!selected || availability !== 'ready' || !mounted.current) return;
    session.current?.dispose();
    active.current = true;
    selectedTrack.current = selected.track;
    if (!preserve) { operation.current += 1; setOptions([]); }
    setDetail('');
    const next = new VoiceScriptureSession(selected.track, makeSpeechContextPhrases(metadata.current), {
      phase: (value, message) => {
        if (!mounted.current || session.current !== next) return;
        if (message === 'rotate' && active.current) { restart.current(); return; }
        setPhase(value);
        if (message) setDetail(message);
        else if ((value === 'partial' || value === 'listening') && !pending.current) setDetail('');
        if (value === 'error') {
          active.current = false; operation.current += 1; hydration.current?.abort(); clearPending(); setOptions([]);
        }
      },
      final: (transcript) => {
        if (!active.current || session.current !== next) return;
        const result = parseVoiceScriptureUtterance(transcript,
          pending.current ? null : makeContext(current.current.scriptureState), metadata.current);
        if (result.references.length) setOptions(result.references);
        if (result.automatic) project(result.automatic);
        else {
          if (result.reason !== 'no-reference') { operation.current += 1; hydration.current?.abort(); }
          setDetail(result.reason === 'no-reference' ? 'Sin referencia reconocida' : 'Referencia rechazada: ambigua, negada o incompleta');
        }
      },
    });
    session.current = next;
    void next.start();
  }, [availability, selectedId, tracks, project, clearPending]);
  restart.current = () => start(true);
  const busy = !['idle', 'error'].includes(phase);
  return <>
    <button type="button" popoverTarget="voice-scripture-menu" aria-label="Abrir menú de referencias por voz"
      className={`rounded border p-1.5 text-xs ${busy ? 'border-blue-500 bg-blue-700 text-white' : 'border-gray-700 bg-gray-800 text-gray-200'}`}>Voz</button>
    <section id="voice-scripture-menu" popover="auto" style={{ top: '60px', right: '10px', left: 'auto', margin: '8px', maxWidth: 'min(480px, 95vw)' }}
      className="rounded border border-cyan-900 bg-gray-900 p-3 text-xs text-gray-200" aria-label="Referencias por voz">
    <div className="font-semibold">Referencias por voz · automática</div>
    <div role="status" className="my-2">{availability === 'ready' ? detail || phaseText[phase]
      : availability === 'checking' ? 'Comprobando…' : availability === 'disabled' ? 'Función no habilitada' : 'STT o metadatos no disponibles'}</div>
    <select aria-label="Fuente de voz" value={selectedId} disabled={busy} onChange={(event) => setSelectedId(event.target.value)} className="rounded bg-gray-800 p-1">
      <option value="">Selecciona una voz</option>
      {tracks.map((track) => <option key={track.id} value={track.id}>{track.label}</option>)}
    </select>
    <button type="button" className="m-1 rounded bg-cyan-800 p-2" disabled={phase === 'stopping' || (!busy && (availability !== 'ready' || !selectedId))} onClick={busy ? stop : () => start()}>
      {busy ? 'Detener' : 'Iniciar escucha automática'}
    </button>
    <button type="button" className="m-1 underline" disabled={busy || availability === 'checking'} onClick={() => void refresh()}>Comprobar disponibilidad</button>
    {options.length > 0 && <div aria-label="Referencias detectadas" className="mt-2 flex flex-wrap gap-2">
      {options.map((candidate, index) => <button type="button" className="rounded bg-emerald-800 p-2" key={`${candidateLabel(candidate)}-${index}`} onClick={() => project(candidate)}>
        {candidateLabel(candidate)}
      </button>)}
    </div>}
  </section></>;
}
