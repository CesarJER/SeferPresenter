import { UiLocaleProvider } from './i18n/UiLocaleProvider';
import { translate } from './i18n/runtime';
import { useUiTranslation } from './i18n/useUiTranslation';
import { loadCatalog, saveCatalog } from './utils/catalogApi';
import { StrictMode, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

import MenuPopup from './components/control/MenuPopup';
import { DataProtectionLink } from './components/shared/DataProtectionLink';
import { PwaRestartButton } from './components/shared/PwaRestartButton';
import { LiveAudioControlAuthorization } from './components/control/LiveAudioControlAuthorization';
import { useLiveAudioAvailability } from './features/liveAudio/hooks/useLiveAudioAvailability';

import type { AudioState, AudioSyncMap, AudioTimelineState } from './types/audio';
import { DEFAULT_AUDIO_STATE } from './types/audio';
import type { AppMode, Presentation, ScriptureNavState, Slide, VideoState } from './types/presentation';
import type { SeferReaderState } from './hooks/useSeferReader';
import type { QuizSyncState } from './types/quiz';
import type { AutoduckState } from './types/sync';

import {
  normalizePresentation,
  makeClientId,
} from './utils/normalizePresentation';

import { useSyncState } from './hooks/useSyncState';
import { useAudioPlayback } from './hooks/useAudioPlayback';
import { useControlAuthorization } from './hooks/useControlAuthorization';
import { useBackgroundResolver } from './hooks/useBackgroundResolver';
import { useServerClock } from './hooks/useServerClock';
import { useAudioTimeline } from './hooks/useAudioTimeline';
import { useAudioTimelineApplicator } from './hooks/useAudioTimelineApplicator';
import { useProgramAudioPreference } from './hooks/useProgramAudioPreference';
import { useAudioDevices } from './hooks/useAudioDevices';
import { validateAudioSyncMaps, validatePresentationList } from './utils/validation';
import { generateQuizSubslides } from './utils/quizUtils';
import { generatePresentationSteps } from './utils/navigationUtils';
import { registerScopedServiceWorker } from './utils/pwaUpdate';

function ControlApp() {
  useUiTranslation('control');
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [currentPresentation, setCurrentPresentation] = useState<Presentation | null>(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(-1);
  const [backgrounds, setBackgrounds] = useState<string[]>([]);

  const [backgroundLock, setBackgroundLock] = useState<boolean>(() => {
    return localStorage.getItem('sefer-presenter-bg-lock') === 'true';
  });
  const [lockedBackgroundValue, setLockedBackgroundValue] = useState<string | null>(() => {
    return localStorage.getItem('sefer-presenter-locked-bg') ?? null;
  });
  const [userSelectedBackground, setUserSelectedBackground] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<VideoState | null>(null);

  const [audioState, setAudioState] = useState<AudioState>(DEFAULT_AUDIO_STATE);
  const [audioTimeline, setAudioTimeline] = useState<AudioTimelineState | null>(null);
  const [audioTimelineDuration, setAudioTimelineDuration] = useState(0);
  const [audioSyncMaps, setAudioSyncMaps] = useState<AudioSyncMap[]>([]);
  const [availableAudioFiles, setAvailableAudioFiles] = useState<string[]>([]);

  const [appMode, setAppMode] = useState<AppMode>('slides');
  const [scriptureState, setScriptureState] = useState<ScriptureNavState | null>(null);
  const [quizState, setQuizState] = useState<QuizSyncState | null>(null);
  const [autoduckState, setAutoduckState] = useState<AutoduckState>({ enabled: false, factor: 0.2 });

  const currentPresentationRef = useRef<Presentation | null>(currentPresentation);
  const currentSlideIndexRef = useRef(currentSlideIndex);
  const currentStepIndexRef = useRef(0);
  const backgroundLockRef = useRef(backgroundLock);
  const lockedBackgroundValueRef = useRef(lockedBackgroundValue);
  const userSelectedBackgroundRef = useRef(userSelectedBackground);
  const videoStateRef = useRef<VideoState | null>(videoState);
  const audioStateRef = useRef<AudioState>(audioState);
  const appModeRef = useRef<AppMode>(appMode);
  const scriptureStateRef = useRef<ScriptureNavState | null>(scriptureState);
  const quizStateRef = useRef<QuizSyncState | null>(quizState);
  const autoduckStateRef = useRef<AutoduckState>(autoduckState);
  const clientIdRef = useRef(makeClientId());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioTimelineRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void registerScopedServiceWorker('/control');
  }, []);

  const steps = useMemo(() => {
    return currentPresentation ? generatePresentationSteps(currentPresentation) : [];
  }, [currentPresentation]);

  const activeSlide = currentPresentation && currentSlideIndex >= 0 && currentSlideIndex < currentPresentation.slides.length 
    ? currentPresentation.slides[currentSlideIndex] 
    : null;
  const activeQuizData = activeSlide?.type === 'quiz' ? activeSlide.quizData : undefined;
  const quizSubslides = useMemo(
    () => activeQuizData ? generateQuizSubslides(activeQuizData) : [],
    [activeQuizData],
  );

  useEffect(() => {
    currentPresentationRef.current = currentPresentation;
    currentSlideIndexRef.current = currentSlideIndex;
    backgroundLockRef.current = backgroundLock;
    lockedBackgroundValueRef.current = lockedBackgroundValue;
    userSelectedBackgroundRef.current = userSelectedBackground;
    videoStateRef.current = videoState;
    audioStateRef.current = audioState;
    appModeRef.current = appMode;
    scriptureStateRef.current = scriptureState;
    quizStateRef.current = quizState;
    autoduckStateRef.current = autoduckState;
  }, [currentPresentation, currentSlideIndex, backgroundLock, lockedBackgroundValue, userSelectedBackground, videoState, audioState, appMode, scriptureState, quizState, autoduckState]);

  useEffect(() => {
    const fetchMedia = () => {
      fetch('/api/backgrounds')
        .then(res => res.json())
        .then(data => setBackgrounds(data))
        .catch(err => console.error("Error loading backgrounds", err));
      fetch('/api/audio')
        .then(res => res.json())
        .then(data => setAvailableAudioFiles(data))
        .catch(err => console.error("Error loading audio files", err));
    };

    fetchMedia();

    loadCatalog<Presentation>('/api/presentations', normalizePresentation)
      .then(data => {
        const validation = validatePresentationList(data);
        if (validation.ok && validation.value) {
          setPresentations(data);
        } else {
          console.error("Invalid presentations payload", validation.errors);
          setPresentations([]);
        }
      })
      .catch(err => {
        console.error("Error loading presentations", err);
        setPresentations([]);
      });
      
    loadCatalog<AudioSyncMap>('/api/audio-sync')
      .then(data => {
        const validation = validateAudioSyncMaps(data);
        if (validation.ok && validation.value) {
          setAudioSyncMaps(data);
        } else {
          console.error("Invalid audio sync payload", validation.errors);
        }
      })
      .catch(err => console.error("Error loading audio sync maps", err));

    window.addEventListener('focus', fetchMedia);
    return () => window.removeEventListener('focus', fetchMedia);
  }, []);

  const { emitCommand, wsStatus, wsSend, subscribeToWsMessage, isMediaMaster, emitVideoTelemetry, emitAudioTelemetry } = useSyncState({
    isControlMode: true,
    isPresenterMode: false,
    clientIdRef,
    currentPresentationRef,
    currentSlideIndexRef,
    currentStepIndexRef,
    backgroundLockRef,
    lockedBackgroundValueRef,
    userSelectedBackgroundRef,
    videoStateRef,
    audioStateRef,
    appModeRef,
    scriptureStateRef,
    quizStateRef,
    autoduckStateRef,
    setCurrentPresentation,
    setCurrentSlideIndex,
    setCurrentStepIndex: (idx) => { currentStepIndexRef.current = idx; },
    setBackgroundLock,
    setLockedBackgroundValue,
    setUserSelectedBackground,
    setVideoState,
    setAppMode,
    setScriptureState,
    setAudioState,
    setAudioSyncMaps,
    setQuizState,
    setAutoduckState,
    onAudioTimelineState: setAudioTimeline,
  });
  const [programAudioEnabled, setProgramAudioEnabled] = useProgramAudioPreference(isMediaMaster);
  const { programOutputId } = useAudioDevices();

  const { serverNow } = useServerClock(wsSend, wsStatus, subscribeToWsMessage);
  const audioTimelineControls = useAudioTimeline(audioTimeline, serverNow, wsSend);
  const dispatchAudioTimelineAction = audioTimelineControls.dispatchAction;
  const audioTimelineApplicatorOptions = useMemo(() => ({
    onDurationChange: (durationSec: number | null) => {
      setAudioTimelineDuration(durationSec ?? 0);
      dispatchAudioTimelineAction({ type: 'SET_DURATION', durationSec });
    },
    onEnded: (positionSec: number) => {
      dispatchAudioTimelineAction({ type: 'END', positionSec });
    },
  }), [dispatchAudioTimelineAction]);
  useAudioTimelineApplicator(audioTimelineRef, audioTimeline, serverNow, autoduckState, audioTimelineApplicatorOptions, programAudioEnabled);

  useEffect(() => {
    const audio = audioTimelineRef.current;
    if (!audio || !audioTimeline?.audioSrc) {
      setAudioTimelineDuration(0);
      return;
    }

    const updateDuration = () => {
      setAudioTimelineDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };

    updateDuration();
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('durationchange', updateDuration);
    return () => {
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('durationchange', updateDuration);
    };
  }, [audioTimeline?.audioSrc, audioTimeline?.timelineId]);

  useEffect(() => {
    applySinkId(audioRef, programOutputId);
    applySinkId(audioTimelineRef, programOutputId);
  }, [programOutputId]);

  const audioPanelState = useMemo<AudioState>(() => {
    if (!audioTimeline) return audioState;

    return {
      ...DEFAULT_AUDIO_STATE,
      isPlaying: audioTimeline.status === 'playing',
      currentTime: audioTimelineControls.estimatedPositionSec,
      duration: audioTimelineDuration || audioTimeline.durationSec || audioState.duration,
      volume: audioTimeline.volume,
      audioSrc: audioTimeline.audioSrc,
      activeSyncMapId: audioTimeline.syncMapId,
      syncMode: audioTimeline.syncMode,
      lastUpdatedBy: audioTimeline.updatedBy === 'control' ? 'controller' : 'projection',
      timestamp: audioTimeline.baseServerTimeMs,
    };
  }, [audioState, audioTimeline, audioTimelineControls.estimatedPositionSec, audioTimelineDuration]);

  useAudioPlayback({
    isControlMode: !isMediaMaster,
    allowControlPlayback: true,
    playbackEnabled: isMediaMaster || !audioTimeline?.audioSrc,
    outputEnabled: programAudioEnabled,
    audioState,
    audioStateRef,
    audioSyncMaps,
    currentSlideIndex,
    currentPresentationId: currentPresentation?.id,
    scriptureState,
    audioRef,
    currentPresentationRef,
    autoduckState,
    setAutoplayBlocked: () => {},
    emitAudioTelemetry,
    handleSelectPresentationAndSlide: (p, idx, direction, targetVerse) => {
      setCurrentPresentation(p);
      setCurrentSlideIndex(idx);
      emitCommand({
        command: 'SELECT_PRESENTATION_AND_SLIDE',
        presentation: p,
        slideIndex: idx,
        direction: direction ?? 'forward',
        targetVerse,
      });
    },
  });

  const controlAuthorization = useControlAuthorization({
    wsStatus,
    sendMessage: wsSend,
    subscribeToWsMessage,
  });
  const liveAudioAvailability = useLiveAudioAvailability();

  const { getActiveBackground } = useBackgroundResolver({
    currentPresentation, currentSlideIndex, backgroundLock,
    lockedBackgroundValue, userSelectedBackground, scriptureState,
    backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef,
    scriptureStateRef,
    setBackgroundLock, setLockedBackgroundValue, setUserSelectedBackground,
    emitDisplayTelemetry: () => {},
  });

  const activeBackground = getActiveBackground();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If we are in scripture mode or seferManual, SeferControlPanel(Mini) handles arrow keys
      if (appModeRef.current === 'scripture' || appModeRef.current === 'seferManual') return;
      
      const targetTag = (e.target as HTMLElement).tagName.toUpperCase();
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return;

      if (e.key === 'ArrowRight') {
        const p = currentPresentationRef.current;
        if (!p) return;
        e.preventDefault();
        const stepsList = generatePresentationSteps(p);
        const nextStepIdx = Math.min(currentStepIndexRef.current + 1, stepsList.length - 1);
        if (nextStepIdx > currentStepIndexRef.current) {
          emitCommand({ command: 'SELECT_STEP', stepIndex: nextStepIdx });
        }
      } else if (e.key === 'ArrowLeft') {
        const p = currentPresentationRef.current;
        if (!p) return;
        e.preventDefault();
        const prevStepIdx = Math.max(currentStepIndexRef.current - 1, 0);
        if (prevStepIdx < currentStepIndexRef.current) {
          emitCommand({ command: 'SELECT_STEP', stepIndex: prevStepIdx });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [emitCommand]);

  const savePresentations = useCallback(async (updated: Presentation[]) => {
    const normalized = updated.map(normalizePresentation);
    const validation = validatePresentationList(normalized);
    if (!validation.ok || !validation.value) {
      console.error("Refusing to save invalid presentations", validation.errors);
      alert(translate("control:main_control.presentationsWereNotSavedBecauseTheyContainInvalidData", "No se guardaron las presentaciones porque contienen datos inválidos:\n{{value1}}", { value1: validation.errors.slice(0, 5).join('\n') }));
      return;
    }
    try {
      await saveCatalog('/api/presentations', normalized, presentations);
      setPresentations(normalized);
      return true;
    } catch (err) {
      alert(err instanceof Error ? err.message : translate("control:main_control.couldNotSavePresentationsYourDraftIsPreserved", "No se pudieron guardar las presentaciones. El borrador se conserva."));
      return false;
    }
  }, [presentations]);

  const handleSave = useCallback(async (presentation: Presentation) => {
    const normalizedPresentation = normalizePresentation(presentation);
    const existing = presentations.findIndex(p => p.id === normalizedPresentation.id);
    const updated = [...presentations];
    if (existing >= 0) {
      updated[existing] = normalizedPresentation;
    } else {
      updated.push(normalizedPresentation);
    }
    if (!await savePresentations(updated)) return;
    const nextIndex = existing >= 0
      ? Math.min(currentSlideIndexRef.current, normalizedPresentation.slides.length - 1)
      : normalizedPresentation.slides.length > 0 ? 0 : -1;
    
    emitCommand({
      command: 'SELECT_PRESENTATION_AND_SLIDE',
      presentation: normalizedPresentation,
      slideIndex: nextIndex,
      direction: 'forward'
    });
  }, [presentations, emitCommand, savePresentations]);

  const handleAddScriptureSlide = useCallback((state: SeferReaderState, kind: 'sefer' | 'tanaj' = 'sefer') => {
    const presentation = currentPresentationRef.current;
    if (!presentation) {
      alert(translate("control:main_control.selectAPresentationBeforeAddingASacredTextSlide", "Selecciona una presentación antes de añadir una diapositiva de texto sagrado."));
      return;
    }

    const verseStart = state.verseStart || state.verse;
    const verseEnd = state.verseEnd || verseStart;
    const rangeLabel = verseEnd !== verseStart ? `${verseStart}-${verseEnd}` : verseStart;
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const newSlide: Slide = {
      id: `slide-${kind}-${state.bookAbbrevEs || state.bookEs}-${state.chapter}-${rangeLabel}-${Date.now()}-${randomSuffix}`,
      label: `${state.bookAbbrevEs || state.bookEs} ${state.chapter}:${rangeLabel}`,
      lines: [state.verseNikud, state.transliteration, state.translation],
      type: kind,
      scriptureBook: state.bookAbbrevEs || state.bookEs,
      scriptureChapter: state.chapter,
      scriptureVerseStart: verseStart,
      scriptureVerseEnd: verseEnd,
    };
    const insertAt = currentSlideIndexRef.current >= 0
      ? currentSlideIndexRef.current + 1
      : presentation.slides.length;
    const updatedPresentation: Presentation = {
      ...presentation,
      mode: 'trilingual',
      slides: [
        ...presentation.slides.slice(0, insertAt),
        newSlide,
        ...presentation.slides.slice(insertAt),
      ],
    };
    handleSave(updatedPresentation);
  }, [handleSave]);

  return (
    <div id="section-app-control-mode" className="w-full h-dvh bg-gray-900 overflow-hidden relative">
      <MenuPopup
        isMediaMaster={isMediaMaster}
        programAudioEnabled={programAudioEnabled}
        onProgramAudioEnabledChange={setProgramAudioEnabled}
        presentations={presentations}
        backgrounds={backgrounds}
        currentPresentation={currentPresentation}
        currentSlideIndex={currentSlideIndex}
        activeBackground={activeBackground}
        backgroundLock={backgroundLock}
        onToggleBackgroundLock={(locked) => emitCommand({ command: 'TOGGLE_BG_LOCK', locked })}
        onSelectBackgroundOverride={(bg) => emitCommand({ command: 'SELECT_BG_OVERRIDE', bg })}
        onSave={handleSave}
        onResetState={(clearSession, hardRefresh) => {
          emitCommand({ command: 'RESET_STATE', clearSession, hardRefresh });
        }}
        onSelectPresentation={(p, idx, targetVerse) => {
          setCurrentPresentation(p);
          setCurrentSlideIndex(idx ?? 0);
          emitCommand({ command: 'SELECT_PRESENTATION_AND_SLIDE', presentation: p, slideIndex: idx ?? 0, direction: 'forward', targetVerse });
        }}
        onSelectSlide={(idx) => {
          setCurrentSlideIndex(idx);
          emitCommand({ command: 'SELECT_PRESENTATION_AND_SLIDE', presentation: currentPresentation, slideIndex: idx, direction: idx < currentSlideIndex ? 'backward' : 'forward' });
        }}
        onImport={async (imported) => {
          if (!await savePresentations(imported)) return;
          if (imported.length > 0) {
            emitCommand({ command: 'SELECT_PRESENTATION_AND_SLIDE', presentation: imported[0], slideIndex: imported[0].slides.length > 0 ? 0 : -1, direction: 'forward' });
          } else {
            emitCommand({ command: 'SELECT_PRESENTATION_AND_SLIDE', presentation: null, slideIndex: -1, direction: 'forward' });
          }
        }}
        videoState={videoState}
        onVideoStateChange={(s) => {
          emitCommand({ command: 'VIDEO_STATE_CHANGE', state: s });
          if (isMediaMaster) {
            setVideoState(s);
          }
        }}
        audioOutputId={programOutputId}
        emitVideoTelemetry={emitVideoTelemetry}
        emitCommand={emitCommand}
        audioState={audioPanelState}
        audioSyncMaps={audioSyncMaps}
        availableAudioFiles={availableAudioFiles}
        onAudioStateChange={(state) => {
          emitCommand({ command: 'AUDIO_STATE_CHANGE', state });
          if (isMediaMaster) {
            setAudioState(state);
            emitAudioTelemetry(state);
          }
        }}
        audioDispatchAction={wsStatus === 'open' ? audioTimelineControls.dispatchAction : undefined}
        audioEstimatedPositionSec={audioTimeline ? audioTimelineControls.estimatedPositionSec : undefined}
        audioLoop={audioTimeline?.loop ?? false}
        autoduckState={autoduckState}
        onAutoduckStateChange={(state) => {
          emitCommand({ command: 'SET_AUTODUCK_STATE', state });
          if (isMediaMaster) {
            setAutoduckState(state);
          }
        }}
        onAudioSyncMapsChange={async (maps, baseMaps = audioSyncMaps) => {
          const validation = validateAudioSyncMaps(maps);
          if (!validation.ok || !validation.value) throw new Error(translate("control:main_control.invalidAudioMaps", "Mapas de audio inválidos"));
          await saveCatalog('/api/audio-sync', maps, baseMaps);
          setAudioSyncMaps(maps);
        }}
        appMode={appMode}
        scriptureState={scriptureState}
        onUpdateScriptureFontSizes={(sizes) => emitCommand({ command: 'UPDATE_FONT_SIZES', hebrewFontSize: sizes.hebrewFontSize, combinedTextBaseSize: sizes.combinedTextBaseSize })}
        onToggleAppMode={(mode) => {
          setAppMode(mode);
          emitCommand({ command: 'TOGGLE_APP_MODE', mode });
        }}
        onProjectScripture={(state, command = 'navigate') => {
          emitCommand({ command: 'SCRIPTURE_PROJECT', state, navCommand: command });
        }}
        onAddScriptureSlide={handleAddScriptureSlide}
        onBoundaryReached={(dir) => emitCommand({ command: 'SCRIPTURE_BOUNDARY', direction: dir })}
        quizSubslides={quizSubslides}
        quizCurrentSubslideIndex={quizState?.currentSubslideIndex ?? 0}
        quizTimerState={quizState?.timerState ?? { status: 'idle', timerStartedAt: null, timerDurationMs: 30000, pausedRemainingMs: null }}
        quizPresenterDemoSelection={activeSlide && quizState?.presenterDemoSelection ? quizState.presenterDemoSelection[activeSlide.id] : null}
        quizMaxBaseCentipunts={quizState?.maxBaseCentipunts}
        onQuizSubslideSelect={(idx) => {
          const foundIdx = steps.findIndex(
            (s) => s.slideIndex === currentSlideIndex && s.type === 'quiz' && s.subslideIndex === idx
          );
          if (foundIdx >= 0) {
            emitCommand({ command: 'SELECT_STEP', stepIndex: foundIdx });
          } else {
            emitCommand({ command: 'QUIZ_SELECT_SUBSLIDE', index: idx });
          }
        }}
        onQuizStartTimer={() => emitCommand({ command: 'QUIZ_START_TIMER' })}
        onQuizPauseTimer={() => emitCommand({ command: 'QUIZ_PAUSE_TIMER' })}
        onQuizResumeTimer={() => emitCommand({ command: 'QUIZ_RESUME_TIMER' })}
        onQuizResetTimer={() => emitCommand({ command: 'QUIZ_RESET_TIMER' })}
        onQuizComplete={() => {
          const answerIndex = quizSubslides.findIndex(subslide => subslide.kind === 'respuesta');
          if (answerIndex >= 0) {
            const foundIdx = steps.findIndex(
              (s) => s.slideIndex === currentSlideIndex && s.type === 'quiz' && s.subslideIndex === answerIndex
            );
            if (foundIdx >= 0) {
              emitCommand({ command: 'SELECT_STEP', stepIndex: foundIdx });
              return;
            }
          }
          emitCommand({ command: 'QUIZ_COMPLETE' });
        }}
        onQuizDemoSelect={(optionId) => emitCommand({ command: 'QUIZ_DEMO_SELECT', optionId })}
        onQuizPlayApplause={() => emitCommand({ command: 'QUIZ_PLAY_APPLAUSE' })}
        onQuizPlayMal={() => emitCommand({ command: 'QUIZ_PLAY_MAL' })}
        onQuizAdjustTimer={(seconds) => emitCommand({ command: 'QUIZ_ADJUST_TIMER', seconds })}
        controlAuthorization={{
          role: controlAuthorization.controlState === 'PRINCIPAL' ? 'principal' : 
                controlAuthorization.controlState === 'AUTHORIZED' ? 'delegated' : 'pending',
          verificationCode: controlAuthorization.verificationCode ?? undefined,
          pendingControls: controlAuthorization.pendingControls,
          controlState: controlAuthorization.controlState
        }}
        onApproveControlRequest={controlAuthorization.approveControl}
        onRejectControlRequest={controlAuthorization.rejectControl}
        wsSend={wsSend}
        subscribeToWsMessage={subscribeToWsMessage}
        wsStatus={wsStatus}
        controlSessionId={controlAuthorization.controlSessionId}
      />
      <div className="absolute bottom-2 start-2 z-50">
        <DataProtectionLink />
      </div>
      {liveAudioAvailability.availability !== 'enabled' && (
        <div className="absolute bottom-2 end-2 z-50">
          <PwaRestartButton className="border-gray-700 bg-gray-950/70 text-gray-300 hover:bg-gray-900 hover:text-white" />
        </div>
      )}
      <div className="absolute top-2 end-2 z-50">
        <LiveAudioControlAuthorization authorization={controlAuthorization} />
      </div>

      {/* Hidden audio element for Pista de Audio */}
      <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />
      {/* Hidden audio element for karaoke and music sync */}
      <audio ref={audioTimelineRef} preload="auto" style={{ display: 'none' }} />
    </div>
  );
}

function applySinkId(ref: React.RefObject<HTMLAudioElement | null>, sinkId: string) {
  const audio = ref.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (audio && typeof audio.setSinkId === 'function') {
    audio.setSinkId(sinkId === 'default' ? '' : sinkId).catch(err => console.warn('setSinkId error:', err));
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><UiLocaleProvider role="control">
    <ControlApp />
  </UiLocaleProvider></StrictMode>,
);
