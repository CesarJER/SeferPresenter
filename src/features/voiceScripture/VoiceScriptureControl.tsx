import { useCallback, useEffect, useRef, useState } from 'react';
import type { SeferReaderState } from '../../hooks/useSeferReader';
import type { ScriptureNavState } from '../../types/presentation';
import { getMetadata, type AppMetadata } from '../../utils/metadataCache';
import { parseVoiceScriptureUtterance, type VoiceScriptureCandidate } from './voiceScriptureParser';
import { createPortal } from 'react-dom';
import { VoiceScriptureSuggestions } from './VoiceScriptureSuggestions';
import { hydrateCandidate, makeContext, makeSpeechContextPhrases } from './voiceScriptureProjection';
import { VoiceScriptureSession, type VoiceSessionPhase } from './voiceScriptureSession';

interface VoiceTrack { id: string; label: string; track: MediaStreamTrack }
interface VoiceScriptureControlProps {
  tracks: VoiceTrack[];
  selectedId: string;
  onSelectionChange: (id: string) => void;
  canTranscribe?: boolean;
  onAvailabilityChange?: (ready: boolean) => void;
  suggestionsTarget?: HTMLElement | null;
  scriptureState: ScriptureNavState | null;
  onProject: (state: SeferReaderState, command?: 'navigate') => void;
}
const phaseText: Record<VoiceSessionPhase, string> = {
  idle: 'Listo', connecting: 'Conectando…', listening: 'Recibiendo audio', partial: 'Transcribiendo…',
  final: 'Intervención recibida', stopping: 'Deteniendo…', error: 'Error',
};
const projectionKey = (state: ScriptureNavState | null) => JSON.stringify([
  state?.bookAbbrevEs || state?.bookEs, state?.chapter, state?.verse, state?.verseStart, state?.verseEnd, state?.commandId,
]);

export default function VoiceScriptureControl({ tracks, scriptureState, onProject, selectedId, onSelectionChange, canTranscribe = true, onAvailabilityChange, suggestionsTarget }: VoiceScriptureControlProps) {
  const [availability, setAvailability] = useState<'checking' | 'disabled' | 'unavailable' | 'ready'>('checking');
  const [phase, setPhase] = useState<VoiceSessionPhase>('idle');
  const [detail, setDetail] = useState('');
  const [options, setOptions] = useState<VoiceScriptureCandidate[]>([]);
  const session = useRef<VoiceScriptureSession | null>(null);
  const closing = useRef(Promise.resolve());
  const metadata = useRef<AppMetadata>({});
  const active = useRef(false);
  const mounted = useRef(true);
  const operation = useRef(0);
  const availabilityRequest = useRef(0);
  const projectionQueue = useRef(Promise.resolve());
  const hydration = useRef<AbortController | null>(null);
  const pending = useRef<{ candidate: VoiceScriptureCandidate; timer: ReturnType<typeof setTimeout> } | null>(null);
  const current = useRef({ scriptureState, onProject, onSelectionChange });
  const restart = useRef<() => void>(() => undefined);
  current.current = { scriptureState, onProject, onSelectionChange };

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
    current.current.onSelectionChange('');
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
  const start = useCallback(() => {
    const selected = tracks.find((track) => track.id === selectedId);
    if (!canTranscribe || !selected || availability !== 'ready' || !mounted.current) return;
    session.current?.dispose();
    active.current = true;
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
  }, [availability, canTranscribe, selectedId, tracks, project, clearPending]);
  restart.current = start;
  const source = tracks.find((entry) => entry.id === selectedId)?.track;
  useEffect(() => {
    onAvailabilityChange?.(availability === 'ready' && phase !== 'error');
  }, [availability, phase, onAvailabilityChange]);
  useEffect(() => {
    if (availability === 'ready') return;
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [availability, refresh]);
  useEffect(() => {
    const generation = operation.current;
    if (canTranscribe && source && availability === 'ready') {
      void closing.current.then(() => {
        if (mounted.current && generation === operation.current) restart.current();
      });
    }
    return () => {
      active.current = false;
      operation.current += 1;
      hydration.current?.abort();
      clearPending();
      const previous = session.current;
      session.current = null;
      closing.current = previous?.stop() || Promise.resolve();
      setOptions([]);
      setPhase('idle');
    };
  }, [canTranscribe, source, selectedId, availability, clearPending]);
  useEffect(() => {
    if (!canTranscribe || phase !== 'error' || !source || !selectedId || source.readyState !== 'live') return;
    const timer = setTimeout(() => restart.current(), 5_000);
    return () => clearTimeout(timer);
  }, [canTranscribe, phase, source, selectedId]);
  const view = <VoiceScriptureSuggestions
    status={availability === 'ready' ? (!canTranscribe && selectedId ? 'Origen compartido · transcripción en Control principal'
      : (phase === 'error' && selectedId ? `${detail} · reconectando…` : detail) || (selectedId ? phaseText[phase] : 'Voz desactivada · selecciona un micrófono'))
      : availability === 'checking' ? 'Comprobando voz…' : availability === 'disabled' ? 'Voz no habilitada' : 'Motor de voz no disponible · reintentando…'}
    options={options} onProject={project} />;
  return suggestionsTarget === undefined ? view : suggestionsTarget ? createPortal(view, suggestionsTarget) : null;
}
