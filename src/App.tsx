import { translate } from './i18n/runtime';
import { useUiTranslation } from './i18n/useUiTranslation';
import { loadCatalog, presentationCatalogOptions } from './utils/catalogApi';
import { useCatalogSave } from './hooks/useCatalogSave';
import { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from 'react';
import PresenterScreen from './components/presenter/PresenterScreen';
import SeferReaderScreen from './components/presenter/SeferReaderScreen';
import DataProtectionPage from './components/shared/DataProtectionPage';
import { Music } from 'lucide-react';

const LiveAudioPresenter = import.meta.env.VITE_SEFER_LIVE_AUDIO_BUILD !== 'false'
  ? lazy(() => import('./features/liveAudio/components/presenter/LiveAudioPresenter'))
  : null;

import type { AudioState, AudioSyncMap, AudioTimelineState } from './types/audio';
import { DEFAULT_AUDIO_STATE } from './types/audio';
import type { AppMode, Presentation, ScriptureNavState, Slide, VideoState } from './types/presentation';
import type { QuizOptionId, QuizSyncState } from './types/quiz';
import type { RemoteCommandPayload, AutoduckState } from './types/sync';

import {
  normalizePresentation,
  makeClientId,
  loadStoredPresenterState,
} from './utils/normalizePresentation';

import { useSyncState } from './hooks/useSyncState';
import { useBackgroundResolver } from './hooks/useBackgroundResolver';
import { useUrlSync } from './hooks/useUrlSync';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useAudioPlayback } from './hooks/useAudioPlayback';
import { useServerClock } from './hooks/useServerClock';
import { useAudioTimeline } from './hooks/useAudioTimeline';
import { useAudioTimelineApplicator } from './hooks/useAudioTimelineApplicator';
import { useScriptureNavigation } from './hooks/useScriptureNavigation';
import { useQuizAudio } from './hooks/useQuizAudio';
import type { SeferReaderState } from './types/scripture';
import { useQuizTimer } from './hooks/useQuizTimer';
import { validateAudioSyncMaps, validatePresentationList } from './utils/validation';
import { generateQuizSubslides, calcMaxBaseCentipunts } from './utils/quizUtils';
import { generatePresentationSteps } from './utils/navigationUtils';
import type { PresentationStep } from './types/presentation';

function App() {
  useUiTranslation('presenter');
  const isControlMode = false;
  const isAudioEditorMode = false;
  const isAudienceMode = false;
  const isPresenterMode = true;
  const storedPresenterState = loadStoredPresenterState();
  const isMediaMasterRef = useRef(false);

  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const { save: savePresentationCatalog, dialog: presentationConflicts } = useCatalogSave('/api/presentations', presentationCatalogOptions);
  const [currentPresentation, setCurrentPresentation] = useState<Presentation | null>(storedPresenterState?.presentation ?? null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(storedPresenterState?.slideIndex ?? -1);

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
  const [audioSyncMaps, setAudioSyncMaps] = useState<AudioSyncMap[]>([]);
  const [autoduckState, setAutoduckState] = useState<AutoduckState>({ enabled: false, factor: 0.2 });

  const [appMode, setAppMode] = useState<AppMode>('slides');
  const [scriptureState, setScriptureState] = useState<ScriptureNavState | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);

  const currentPresentationRef = useRef<Presentation | null>(currentPresentation);
  const currentSlideIndexRef = useRef(currentSlideIndex);
  const backgroundLockRef = useRef(backgroundLock);
  const lockedBackgroundValueRef = useRef(lockedBackgroundValue);
  const userSelectedBackgroundRef = useRef(userSelectedBackground);
  const videoStateRef = useRef<VideoState | null>(videoState);
  const audioStateRef = useRef<AudioState>(audioState);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioTimelineRef = useRef<HTMLAudioElement | null>(null);
  const appModeRef = useRef<AppMode>(appMode);
  const scriptureStateRef = useRef<ScriptureNavState | null>(scriptureState);
  const slideScriptureStateBeforeManualRef = useRef<ScriptureNavState | null>(null);
  const quizStateRef = useRef<QuizSyncState | null>(null);
  const autoduckStateRef = useRef<AutoduckState>(autoduckState);
  const clientIdRef = useRef(makeClientId());
  const navigatedSlideIdRef = useRef<string | undefined>(undefined);
  const lastActiveSlideIdRef = useRef<string | undefined>(undefined);

  const steps = useMemo(() => {
    return currentPresentation ? generatePresentationSteps(currentPresentation) : [];
  }, [currentPresentation]);

  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const currentStepIndexRef = useRef(currentStepIndex);

  const activeSlide = currentPresentation && currentSlideIndex >= 0 ? currentPresentation.slides[currentSlideIndex] : null;
  const activeQuizData = activeSlide?.type === 'quiz' ? activeSlide.quizData : undefined;
  const quizSubslides = useMemo(
    () => activeQuizData ? generateQuizSubslides(activeQuizData) : [],
    [activeQuizData],
  );
  const [quizCurrentSubslideIndex, setQuizCurrentSubslideIndex] = useState(0);
  const [quizPresenterDemoSelection, setQuizPresenterDemoSelection] = useState<QuizOptionId | null>(null);
  const [incomingFeedbackSound, setIncomingFeedbackSound] = useState<QuizSyncState['feedbackSound']>(null);
  const [quizCompletedSlideIds, setQuizCompletedSlideIds] = useState<string[]>([]);
  const [quizResultSlideIds, setQuizResultSlideIds] = useState<string[] | undefined>(undefined);
  const [quizScoreRequestId, setQuizScoreRequestId] = useState(0);
  const [syncedQuizMaxBaseCentipunts, setSyncedQuizMaxBaseCentipunts] = useState<number | undefined>(undefined);
  const quizTimer = useQuizTimer({
    timerSeconds: activeQuizData?.timerSeconds ?? 30,
  });
  const {
    timerState: quizTimerState,
    startTimer: startQuizTimer,
    pauseTimer: pauseQuizTimer,
    resumeTimer: resumeQuizTimer,
    resetTimer: resetQuizTimer,
    setTimerState: setQuizTimerState,
    completeTimer: completeQuizTimer,
    adjustTimer: adjustQuizTimer,
  } = quizTimer;
  const activeQuizSubslide = quizSubslides[quizCurrentSubslideIndex];
  const isQuizCitaVerse = activeQuizSubslide?.kind === 'cita-verse';
  const quizScriptureState = useMemo<ScriptureNavState | null>(() => {
    if (!isQuizCitaVerse || !activeQuizSubslide.bookToken) return null;
    return {
      bookEs: activeQuizSubslide.bookToken,
      bookHeb: '',
      bookAbbrevEs: activeQuizSubslide.bookToken,
      chapter: activeQuizSubslide.chapter,
      verseStart: activeQuizSubslide.verseStart,
      verse: activeQuizSubslide.verse,
      verseEnd: activeQuizSubslide.verseEnd,
      verseNikud: '',
      transliteration: '',
      translation: '',
      verseIdx: Number(activeQuizSubslide.verse) - 1,
      totalVerses: 100,
      scriptureKind: 'sefer',
    };
  }, [isQuizCitaVerse, activeQuizSubslide]);

  const getFirstStepIndexForSlide = useCallback((slideIdx: number, stepList: PresentationStep[]) => {
    return stepList.findIndex(s => s.slideIndex === slideIdx);
  }, []);

  const applyStepIndex = useCallback((idx: number) => {
    if (idx < 0 || idx >= steps.length) return;
    setCurrentStepIndex(idx);

    const step = steps[idx];
    if (step.slideIndex !== currentSlideIndexRef.current) {
      setCurrentSlideIndex(step.slideIndex);
    }

    if (step.type === 'normal') {
      setAppMode('slides');
      setVideoState(null);
    } else if (step.type === 'quiz') {
      setAppMode('slides');
      setVideoState(null);
      setQuizCurrentSubslideIndex(step.subslideIndex);
      const slide = currentPresentationRef.current?.slides[step.slideIndex];
      const subslides = slide?.quizData ? generateQuizSubslides(slide.quizData) : [];
      if (subslides[step.subslideIndex]?.kind === 'respuesta') {
        completeQuizTimer();
      }
    } else if (step.type === 'scripture') {
      setAppMode('scripture');
      const slide = currentPresentationRef.current?.slides[step.slideIndex];
      if (slide) {
        setScriptureState({
          bookEs: step.book,
          bookHeb: '',
          bookAbbrevEs: step.book,
          chapter: step.chapter,
          verseStart: slide.scriptureVerseStart || step.verse,
          verse: step.verse,
          verseEnd: slide.scriptureVerseEnd,
          verseNikud: '',
          transliteration: '',
          translation: '',
          verseIdx: Number(step.verse) - 1,
          totalVerses: 100, // hydrated by SeferReaderScreen
          scriptureKind: slide.type === 'tanaj' ? 'tanaj' : 'sefer',
        });
      }
    }
  }, [completeQuizTimer, steps]);

  const applyStepIndexRef = useRef(applyStepIndex);
  useEffect(() => {
    applyStepIndexRef.current = applyStepIndex;
  }, [applyStepIndex]);

  const makeInitialQuizState = useCallback((slide: Slide | null, direction: 'forward' | 'backward' = 'forward'): QuizSyncState | null => {
    const quizData = slide?.type === 'quiz' ? slide.quizData : undefined;
    if (!quizData || !slide) return null;
    
    let initialIndex = 0;
    if (direction === 'backward') {
      const subslides = generateQuizSubslides(quizData);
      if (subslides.length > 0) initialIndex = subslides.length - 1;
    }

    const previous = quizStateRef.current;
    const presentationId = currentPresentationRef.current?.id;
    const canPreserveRun = Boolean(presentationId && previous?.presentationId === presentationId);
    return {
      presentationId,
      currentSubslideIndex: initialIndex,
      timerState: {
        status: 'idle',
        timerStartedAt: null,
        timerDurationMs: quizData.timerSeconds * 1000,
        pausedRemainingMs: null,
      },
      presenterDemoSelection: {
        ...(canPreserveRun ? previous?.presenterDemoSelection : {}),
        [slide.id]: null,
      },
      completedQuizSlideIds: canPreserveRun ? previous?.completedQuizSlideIds ?? [] : [],
      resultQuizSlideIds: canPreserveRun ? previous?.resultQuizSlideIds : undefined,
      scoreRequestId: canPreserveRun ? previous?.scoreRequestId ?? 0 : 0,
      maxBaseCentipunts: canPreserveRun ? previous?.maxBaseCentipunts : undefined,
    };
  }, []);
  const quizAudio = useQuizAudio({
    isPresenterOrControl: !isAudienceMode && !isControlMode,
    timerStatus: quizTimerState.status,
    isQuestionSubslide: quizSubslides[quizCurrentSubslideIndex]?.kind === 'pregunta',
    feedbackSound: incomingFeedbackSound,
    isMediaMaster: isMediaMasterRef.current,
  });
  const maxBaseCentipunts = useMemo(() => {
    if (!currentPresentation) return 0;
    const allQuizData = currentPresentation.slides
      .filter(s => s.type === 'quiz' && s.quizData)
      .map(s => s.quizData!);
    return calcMaxBaseCentipunts(allQuizData);
  }, [currentPresentation]);
  const effectiveMaxBaseCentipunts = syncedQuizMaxBaseCentipunts ?? maxBaseCentipunts;

  const activeQuizState = useMemo<QuizSyncState | null>(() => {
    if (!activeQuizData || !activeSlide) return null;
    return {
      currentSubslideIndex: quizCurrentSubslideIndex,
      timerState: quizTimerState,
      presenterDemoSelection: {
        [activeSlide.id]: quizPresenterDemoSelection,
      },
      presentationId: currentPresentation?.id,
      completedQuizSlideIds: quizCompletedSlideIds,
      resultQuizSlideIds: quizResultSlideIds,
      scoreRequestId: quizScoreRequestId,
      maxBaseCentipunts: effectiveMaxBaseCentipunts,
    };
  }, [activeQuizData, activeSlide, quizCurrentSubslideIndex, quizTimerState, quizPresenterDemoSelection, currentPresentation?.id, quizCompletedSlideIds, quizResultSlideIds, quizScoreRequestId, effectiveMaxBaseCentipunts]);

  const applyRemoteQuizState = useCallback((state: QuizSyncState | null) => {
    if (!state) {
      quizStateRef.current = null;
      setQuizCurrentSubslideIndex(0);
      setQuizPresenterDemoSelection(null);
      setIncomingFeedbackSound(null);
      setQuizCompletedSlideIds([]);
      setQuizResultSlideIds(undefined);
      setQuizScoreRequestId(0);
      setSyncedQuizMaxBaseCentipunts(undefined);
      resetQuizTimer((activeQuizData?.timerSeconds ?? 30) * 1000);
      return;
    }

    const rawIndex = Number.isFinite(state.currentSubslideIndex)
      ? Math.max(0, Math.floor(state.currentSubslideIndex))
      : 0;
    const fallbackSelection = Object.values(state.presenterDemoSelection ?? {})[0] ?? null;

    setQuizCurrentSubslideIndex(rawIndex);
    setQuizTimerState(state.timerState);
    setQuizPresenterDemoSelection(activeSlide ? state.presenterDemoSelection?.[activeSlide.id] ?? fallbackSelection : fallbackSelection);
    setIncomingFeedbackSound(state.feedbackSound ?? null);
    setQuizCompletedSlideIds(state.completedQuizSlideIds ?? []);
    setQuizResultSlideIds(state.resultQuizSlideIds);
    setQuizScoreRequestId(state.scoreRequestId ?? 0);
    setSyncedQuizMaxBaseCentipunts(state.maxBaseCentipunts);
  }, [activeQuizData?.timerSeconds, activeSlide, resetQuizTimer, setQuizTimerState, setIncomingFeedbackSound]);

  useEffect(() => {
    currentPresentationRef.current = currentPresentation;
    currentSlideIndexRef.current = currentSlideIndex;
    currentStepIndexRef.current = currentStepIndex;
    backgroundLockRef.current = backgroundLock;
    lockedBackgroundValueRef.current = lockedBackgroundValue;
    userSelectedBackgroundRef.current = userSelectedBackground;
    videoStateRef.current = videoState;
    audioStateRef.current = audioState;
    appModeRef.current = appMode;
    scriptureStateRef.current = scriptureState;
    quizStateRef.current = activeQuizState;
    autoduckStateRef.current = autoduckState;
  }, [currentPresentation, currentSlideIndex, currentStepIndex, backgroundLock, lockedBackgroundValue, userSelectedBackground, videoState, audioState, appMode, scriptureState, activeQuizState, autoduckState]);



  useEffect(() => {
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
  }, []);

  const handleRemoteCommand = useCallback((payload: RemoteCommandPayload) => {
    switch (payload.command) {
      case 'SELECT_STEP':
        applyStepIndexRef.current?.(payload.stepIndex);
        break;
      case 'SELECT_PRESENTATION_AND_SLIDE':
        handleSelectPresentationAndSlideRef.current?.(payload.presentation, payload.slideIndex, payload.direction, payload.targetVerse);
        break;
      case 'TOGGLE_APP_MODE':
        handleToggleAppModeRef.current?.(payload.mode);
        break;
      case 'TOGGLE_BG_LOCK':
        handleToggleBackgroundLockRef.current?.(payload.locked);
        break;
      case 'SELECT_BG_OVERRIDE':
        if (payload.bg !== null) {
          handleSelectBackgroundOverrideRef.current?.(payload.bg);
        }
        break;
      case 'QUIZ_START_TIMER':
        startQuizTimer();
        break;
      case 'QUIZ_PAUSE_TIMER':
        pauseQuizTimer();
        break;
      case 'QUIZ_RESUME_TIMER':
        resumeQuizTimer();
        break;
      case 'QUIZ_RESET_TIMER':
        resetQuizTimer(activeQuizData?.timerSeconds ? activeQuizData.timerSeconds * 1000 : 30000);
        break;
      case 'QUIZ_ADJUST_TIMER':
        adjustQuizTimer(payload.seconds);
        break;
      case 'QUIZ_COMPLETE': {
        completeQuizTimer();
        const subslides = activeQuizData ? generateQuizSubslides(activeQuizData) : [];
        const answerIndex = subslides.findIndex(s => s.kind === 'respuesta');
        if (answerIndex >= 0) {
          setQuizCurrentSubslideIndex(answerIndex);
          const foundIdx = steps.findIndex(
            (s) => s.slideIndex === currentSlideIndexRef.current && s.type === 'quiz' && s.subslideIndex === answerIndex
          );
          if (foundIdx >= 0) {
            setCurrentStepIndex(foundIdx);
          }
        }
        break;
      }
      case 'QUIZ_SELECT_SUBSLIDE': {
        const subslides = activeQuizData ? generateQuizSubslides(activeQuizData) : [];
        if (subslides[payload.index]?.kind === 'respuesta') {
          completeQuizTimer();
        }
        setQuizCurrentSubslideIndex(payload.index);
        const foundIdx = steps.findIndex(
          (s) => s.slideIndex === currentSlideIndexRef.current && s.type === 'quiz' && s.subslideIndex === payload.index
        );
        if (foundIdx >= 0) {
          setCurrentStepIndex(foundIdx);
        }
        break;
      }
      case 'QUIZ_DEMO_SELECT':
        setQuizPresenterDemoSelection(payload.optionId as QuizOptionId | null);
        if (payload.optionId) {
          const selected = activeQuizData?.options.find(o => o.id === payload.optionId);
          if (selected?.isCorrect) quizAudio.playApplause();
          if (selected && !selected.isCorrect) quizAudio.playMal();
        }
        break;
      case 'QUIZ_PLAY_APPLAUSE':
        quizAudio.playApplause();
        break;
      case 'QUIZ_PLAY_MAL':
        quizAudio.playMal();
        break;
      case 'SCRIPTURE_PROJECT':
        if (handleProjectScriptureRef.current) handleProjectScriptureRef.current(payload.state, payload.navCommand);
        break;
      case 'SCRIPTURE_ADD_SLIDE':
        if (handleAddScriptureSlideRef.current) handleAddScriptureSlideRef.current(payload.state, payload.kind);
        break;
      case 'SCRIPTURE_BOUNDARY':
        if (handleScriptureBoundaryRef.current) handleScriptureBoundaryRef.current(payload.direction);
        break;
      case 'SCRIPTURE_ESCAPE':
        if (handleScriptureEscapeRef.current) handleScriptureEscapeRef.current();
        break;
      case 'SCRIPTURE_ARROW_NAV':
        if (handleScriptureArrowNavRef.current) handleScriptureArrowNavRef.current(payload.direction === 'up' ? 'previous' : 'next');
        break;
      case 'UPDATE_FONT_SIZES':
        if (handleUpdateScriptureFontSizesRef.current) handleUpdateScriptureFontSizesRef.current({ hebrewFontSize: payload.hebrewFontSize ?? 42, combinedTextBaseSize: payload.combinedTextBaseSize ?? 50 });
        break;
      case 'VIDEO_STATE_CHANGE':
        handleVideoStateChangeRef.current?.(payload.state);
        break;
      case 'AUDIO_STATE_CHANGE':
        setAudioState(payload.state);
        break;
      case 'SET_AUTODUCK_STATE':
        setAutoduckState(payload.state);
        break;
      case 'RESET_STATE':
        handleResetStateRef.current?.();
        if (payload.hardRefresh) {
          // Delay to ensure the WebSocket message is flushed before reloading
          setTimeout(() => window.location.reload(), 150);
        }
        break;
    }
  }, [activeQuizData, adjustQuizTimer, completeQuizTimer, pauseQuizTimer, quizAudio, resetQuizTimer, resumeQuizTimer, startQuizTimer, steps]);

  const { syncState, emitCommand, emitAudioTelemetry, emitVideoTelemetry, emitDisplayTelemetry, wsStatus, wsSend, subscribeToWsMessage, isMediaMaster } = useSyncState({
    isControlMode, isPresenterMode, onRemoteCommand: handleRemoteCommand, clientIdRef,
    currentPresentationRef, currentSlideIndexRef, currentStepIndexRef, backgroundLockRef,
    lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef,
    audioStateRef, appModeRef, scriptureStateRef, quizStateRef, autoduckStateRef,
    setCurrentPresentation, setCurrentSlideIndex, setCurrentStepIndex, setBackgroundLock,
    setLockedBackgroundValue, setUserSelectedBackground, setVideoState,
    setAppMode, setScriptureState, setAudioState, setAudioSyncMaps,
    setQuizState: applyRemoteQuizState,
    setAutoduckState,
    onAudioTimelineState: setAudioTimeline,
  });
  isMediaMasterRef.current = isMediaMaster;

  const { serverNow } = useServerClock(wsSend, wsStatus, subscribeToWsMessage);
  // Presenter only dispatches actions here; it does not render the estimated
  // position, so avoid subscribing the root to a playback ticker.
  const audioTimelineControls = useAudioTimeline(audioTimeline, serverNow, wsSend, false);
  const dispatchAudioTimelineAction = audioTimelineControls.dispatchAction;
  const audioTimelineApplicatorOptions = useMemo(() => ({
    onPlaybackBlocked: setAutoplayBlocked,
    onDurationChange: (durationSec: number | null) => {
      dispatchAudioTimelineAction({ type: 'SET_DURATION', durationSec });
    },
    onEnded: (positionSec: number) => {
      dispatchAudioTimelineAction({ type: 'END', positionSec });
    },
  }), [dispatchAudioTimelineAction]);
  useAudioTimelineApplicator(audioTimelineRef, audioTimeline, serverNow, autoduckState, audioTimelineApplicatorOptions);

  const { getActiveBackground, handleToggleBackgroundLock, handleSelectBackgroundOverride } = useBackgroundResolver({
    currentPresentation, currentSlideIndex, backgroundLock,
    lockedBackgroundValue, userSelectedBackground, scriptureState,
    backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef,
    scriptureStateRef,
    setBackgroundLock, setLockedBackgroundValue, setUserSelectedBackground,
    emitDisplayTelemetry,
  });

  const activeBackground = getActiveBackground();

  useEffect(() => {
    if (!isPresenterMode) return;
    
    const isNewSlide = activeSlide?.id !== lastActiveSlideIdRef.current;
    lastActiveSlideIdRef.current = activeSlide?.id;

    if (isNewSlide && activeSlide?.id !== navigatedSlideIdRef.current) {
      setQuizPresenterDemoSelection(null);
    }
    resetQuizTimer((activeQuizData?.timerSeconds ?? 30) * 1000);
  }, [isPresenterMode, activeSlide?.id, activeQuizData?.timerSeconds, resetQuizTimer]);

  type SelectPresentationAndSlideHandler = (
    presentation: Presentation | null,
    slideIndex: number,
    direction?: 'forward' | 'backward',
    targetVerse?: string
  ) => void;

  const handleSelectPresentationAndSlideRef = useRef<SelectPresentationAndSlideHandler | null>(null);
  const handleSaveRef = useRef<((presentation: Presentation) => void) | null>(null);

  const handleProjectScriptureRef = useRef<((state: SeferReaderState, command?: ScriptureNavState['command']) => void) | null>(null);
  const handleUpdateScriptureFontSizesRef = useRef<((sizes: { hebrewFontSize: number; combinedTextBaseSize: number }) => void) | null>(null);
  const handleAddScriptureSlideRef = useRef<((state: SeferReaderState, kind?: 'sefer' | 'tanaj') => void) | null>(null);
  const handleScriptureBoundaryRef = useRef<((direction: 'next' | 'previous') => void) | null>(null);
  const handleScriptureEscapeRef = useRef<(() => void) | null>(null);
  const handleScriptureArrowNavRef = useRef<((direction: 'next' | 'previous') => void) | null>(null);



  const {
    buildScriptureSlideState,
    handleProjectScripture,
    handleUpdateScriptureFontSizes,
    handleSeferOnlineRef,
    handleAddScriptureSlide,
    handleScriptureBoundary,
    handleScriptureEscape,
    handleScriptureArrowNav,
  } = useScriptureNavigation({
    isControlMode, currentPresentationRef, currentSlideIndexRef, backgroundLockRef,
    lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef, appModeRef, scriptureStateRef,
    setAppMode, setScriptureState, syncState, 
    handleSelectPresentationAndSlide: (p: Presentation | null, idx: number, direction?: 'forward' | 'backward', targetVerse?: string) => handleSelectPresentationAndSlideRef.current?.(p, idx, direction, targetVerse),
    handleSave: (p: Presentation) => handleSaveRef.current?.(p), 
    steps,
    currentStepIndex,
    setCurrentStepIndex,
    slideScriptureStateBeforeManualRef
  });

  handleProjectScriptureRef.current = handleProjectScripture;
  handleUpdateScriptureFontSizesRef.current = handleUpdateScriptureFontSizes;
  handleAddScriptureSlideRef.current = handleAddScriptureSlide;
  handleScriptureBoundaryRef.current = handleScriptureBoundary;
  handleScriptureEscapeRef.current = handleScriptureEscape;
  handleScriptureArrowNavRef.current = handleScriptureArrowNav;

  const handleSelectPresentationAndSlide = useCallback((p: Presentation | null, idx: number, direction: 'forward' | 'backward' = 'forward', targetVerse?: string) => {
    const normalizedPresentation = p ? normalizePresentation(p) : null;
    setCurrentPresentation(normalizedPresentation);
    setCurrentSlideIndex(idx);
    setVideoState(null);

    const stepList = normalizedPresentation ? generatePresentationSteps(normalizedPresentation) : [];
    let stepIdx = 0;
    if (idx >= 0 && stepList.length > 0) {
      if (targetVerse) {
        const found = stepList.findIndex(s => s.slideIndex === idx && s.type === 'scripture' && s.verse === targetVerse);
        stepIdx = found >= 0 ? found : getFirstStepIndexForSlide(idx, stepList);
      } else if (direction === 'backward') {
        const foundLast = [...stepList].reverse().findIndex(s => s.slideIndex === idx);
        stepIdx = foundLast >= 0 ? stepList.length - 1 - foundLast : getFirstStepIndexForSlide(idx, stepList);
      } else {
        stepIdx = getFirstStepIndexForSlide(idx, stepList);
      }
    }
    setCurrentStepIndex(stepIdx >= 0 ? stepIdx : 0);

    const slide = normalizedPresentation && idx >= 0 ? normalizedPresentation.slides[idx] : null;
    const bgVal = slide?.background ?? '';
    const isIgnored = bgVal === 'Ignorar' || bgVal === 'No cambiar';
    const scriptureSlideState = buildScriptureSlideState(slide, direction, targetVerse);
    const nextAppMode: AppMode = scriptureSlideState ? 'scripture' : 'slides';
    navigatedSlideIdRef.current = slide?.id;
    const nextQuizState = makeInitialQuizState(slide, direction);

    quizStateRef.current = nextQuizState;
    setQuizCurrentSubslideIndex(nextQuizState?.currentSubslideIndex ?? 0);
    setQuizPresenterDemoSelection(null);
    if (slide?.type === 'quiz' && slide.quizData) {
      resetQuizTimer(slide.quizData.timerSeconds * 1000);
    }

    setAppMode(nextAppMode);
    if (scriptureSlideState) {
      setScriptureState(scriptureSlideState);
    }

    if (isIgnored) {
      syncState({
        presentation: normalizedPresentation, slideIndex: idx, bgLock: backgroundLockRef.current,
        lockedBg: lockedBackgroundValueRef.current, userSelectedBg: userSelectedBackgroundRef.current,
        videoState: null, appMode: nextAppMode, scriptureState: scriptureSlideState ?? scriptureStateRef.current,
        quizState: nextQuizState,
        stepIndex: stepIdx >= 0 ? stepIdx : 0,
      });
    } else {
      setUserSelectedBackground(null);
      syncState({
        presentation: normalizedPresentation, slideIndex: idx, bgLock: backgroundLockRef.current,
        lockedBg: lockedBackgroundValueRef.current, userSelectedBg: null,
        videoState: null, appMode: nextAppMode, scriptureState: scriptureSlideState ?? scriptureStateRef.current,
        quizState: nextQuizState,
        stepIndex: stepIdx >= 0 ? stepIdx : 0,
      });
    }
  }, [syncState, buildScriptureSlideState, makeInitialQuizState, resetQuizTimer, backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef, scriptureStateRef, getFirstStepIndexForSlide]);
  handleSelectPresentationAndSlideRef.current = handleSelectPresentationAndSlide;

  const savePresentations = useCallback(async (updated: Presentation[]) => {
    const normalized = updated.map(normalizePresentation);
    const validation = validatePresentationList(normalized);
    if (!validation.ok || !validation.value) {
      console.error("Refusing to save invalid presentations", validation.errors);
      alert(translate("presenter:App.presentationsWereNotSavedBecauseTheyContainInvalidData", "No se guardaron las presentaciones porque contienen datos inválidos:\n{{value1}}", { value1: validation.errors.slice(0, 5).join('\n') }));
      return;
    }
    try {
      const saved = await savePresentationCatalog(normalized, presentations);
      setPresentations(saved);
      return saved;
    } catch (err) {
      alert(err instanceof Error ? err.message : translate("presenter:App.couldNotSavePresentationsYourDraftIsPreserved", "No se pudieron guardar las presentaciones. El borrador se conserva."));
      return false;
    }
  }, [presentations, savePresentationCatalog]);

  const handleSave = useCallback(async (presentation: Presentation) => {
    let normalizedPresentation = normalizePresentation(presentation);
    const existing = presentations.findIndex(p => p.id === normalizedPresentation.id);
    const updated = [...presentations];
    if (existing >= 0) {
      updated[existing] = normalizedPresentation;
    } else {
      updated.push(normalizedPresentation);
    }
    const saved = await savePresentations(updated);
    if (!saved) return;
    const selected = saved.find(item => item.id === normalizedPresentation.id);
    if (!selected) return null;
    normalizedPresentation = selected;
    const nextIndex = existing >= 0
      ? Math.min(currentSlideIndexRef.current, normalizedPresentation.slides.length - 1)
      : normalizedPresentation.slides.length > 0 ? 0 : -1;
    if (isControlMode) {
      emitCommand({
        command: 'SELECT_PRESENTATION_AND_SLIDE',
        presentation: normalizedPresentation,
        slideIndex: nextIndex,
        direction: 'forward'
      });
    } else {
      handleSelectPresentationAndSlide(normalizedPresentation, nextIndex);
    }
    return normalizedPresentation;
  }, [presentations, handleSelectPresentationAndSlide, isControlMode, emitCommand, savePresentations]);
  handleSaveRef.current = handleSave;

  const handleResetState = useCallback(() => {
    localStorage.removeItem('sefer-presenter-state');
    localStorage.removeItem('sefer-presenter-bg-lock');
    localStorage.removeItem('sefer-presenter-locked-bg');
    setBackgroundLock(false);
    setLockedBackgroundValue(null);
    setUserSelectedBackground(null);
    setCurrentPresentation(null);
    setCurrentSlideIndex(-1);
    setVideoState(null);
    setAppMode('slides');
    setScriptureState(null);

    syncState({ presentation: null, slideIndex: -1, bgLock: false, lockedBg: null, userSelectedBg: null, videoState: null, appMode: 'slides', scriptureState: null, quizState: null });
    window.history.replaceState(null, '', '/presenter');
  }, [syncState]);
  const handleResetStateRef = useRef<(() => void) | null>(null);
  handleResetStateRef.current = handleResetState;
  useUrlSync({
    presentations, currentPresentation, currentSlideIndex, appMode, scriptureState,
    currentPresentationRef, currentSlideIndexRef, scriptureStateRef, slideScriptureStateBeforeManualRef,
    handleSelectPresentationAndSlide,
    enabled: !isControlMode && !isAudioEditorMode && !isAudienceMode && window.location.pathname !== '/proteccion-datos',
    routeBase: '/presenter',
  });

  useKeyboardNavigation({
    isControlMode,
    steps,
    currentStepIndex,
    onStepIndexChange: (idx) => {
      if (isControlMode) {
        emitCommand({ command: 'SELECT_STEP', stepIndex: idx });
      } else {
        applyStepIndex(idx);
      }
    },
    appModeRef,
    scriptureStateRef,
    handleScriptureEscape: () => {
      if (isControlMode) {
        emitCommand({ command: 'SCRIPTURE_ESCAPE' });
      } else {
        handleScriptureEscape();
      }
    },
    handleScriptureArrowNav: (direction) => {
      if (isControlMode) {
        emitCommand({ command: 'SCRIPTURE_ARROW_NAV', direction: direction === 'next' ? 'down' : 'up' });
      } else {
        handleScriptureArrowNav(direction);
      }
    },
    enabled: !isAudienceMode,
  });

  useAudioPlayback({
    isControlMode, audioState, audioStateRef, audioSyncMaps, currentSlideIndex, currentPresentationId: currentPresentation?.id, scriptureState,
    audioRef, currentPresentationRef, setAutoplayBlocked, emitAudioTelemetry,
    handleSelectPresentationAndSlide,
    autoduckState
  });

  useEffect(() => {
    if (currentPresentation) {
      document.title = `Presentador — ${currentPresentation.title} — SeferPresenter`;
    } else {
      document.title = 'Presentador — SeferPresenter';
    }
  }, [currentPresentation]);

  const activePresenterSlide = useMemo(() => scriptureState?.scriptureKind === 'tanaj'
    ? {
      id: activeSlide?.id || `tanaj-${scriptureState.bookAbbrevEs}-${scriptureState.chapter}-${scriptureState.verse}`,
      label: `${scriptureState.bookAbbrevEs} ${scriptureState.chapter}:${scriptureState.verse}`,
      lines: [
        scriptureState.verseNikud,
        scriptureState.transliteration,
        scriptureState.translation,
      ],
      type: 'tanaj' as const,
      background: activeBackground,
    }
    : activeSlide, [activeBackground, activeSlide, scriptureState]);
  const handleVideoStateChangeRef = useRef<((state: VideoState | null) => void) | null>(null);
  const handleVideoStateChange = useCallback((state: VideoState | null) => {
    setVideoState(state);
    emitVideoTelemetry(state);
  }, [emitVideoTelemetry]);
  handleVideoStateChangeRef.current = handleVideoStateChange;

  const handleToggleBackgroundLockRef = useRef<((locked: boolean) => void) | null>(null);
  handleToggleBackgroundLockRef.current = handleToggleBackgroundLock;
  const handleSelectBackgroundOverrideRef = useRef<((bg: string) => void) | null>(null);
  handleSelectBackgroundOverrideRef.current = handleSelectBackgroundOverride;
  const handleToggleAppModeRef = useRef<((mode: AppMode) => void) | null>(null);

  const handleToggleAppMode = useCallback((mode: AppMode) => {
    if (mode === 'seferManual') {
      if (appModeRef.current !== 'seferManual') {
        slideScriptureStateBeforeManualRef.current = appModeRef.current === 'scripture'
          ? scriptureStateRef.current
          : null;
      }

      const slide = currentPresentationRef.current && currentSlideIndexRef.current >= 0
        ? currentPresentationRef.current.slides[currentSlideIndexRef.current]
        : null;
      const slideState = buildScriptureSlideState(slide, 'forward');
      const sourceState = scriptureStateRef.current ?? slideState;
      const manualState: ScriptureNavState | null = sourceState
        ? {
          ...sourceState,
          verseStart: sourceState.verse,
          verseEnd: undefined,
          scriptureKind: 'sefer',
          command: 'navigate',
          commandId: Date.now(),
        }
        : null;

      if (manualState) {
        setScriptureState(manualState);
      }
      appModeRef.current = 'seferManual';
      setAppMode('seferManual');
      syncState({
        presentation: currentPresentationRef.current, slideIndex: currentSlideIndexRef.current,
        bgLock: backgroundLockRef.current, lockedBg: lockedBackgroundValueRef.current,
        userSelectedBg: userSelectedBackgroundRef.current, videoState: videoStateRef.current,
        appMode: 'seferManual', scriptureState: manualState ?? scriptureStateRef.current
      });
      return;
    }

    if (mode === 'slides') {
      const fallbackPresentation = currentPresentationRef.current ?? storedPresenterState?.presentation ?? presentations[0] ?? null;
      const fallbackSlideIndex = fallbackPresentation ? (currentSlideIndexRef.current >= 0 && currentPresentationRef.current ? currentSlideIndexRef.current : 0) : -1;

      if (!currentPresentationRef.current && fallbackPresentation) {
        setCurrentPresentation(normalizePresentation(fallbackPresentation));
        setCurrentSlideIndex(fallbackSlideIndex);
      } else if (currentPresentationRef.current && currentSlideIndexRef.current < 0) {
        setCurrentSlideIndex(0);
      }

      if (appModeRef.current === 'seferManual') {
        const slide = currentPresentationRef.current && currentSlideIndexRef.current >= 0
          ? currentPresentationRef.current.slides[currentSlideIndexRef.current]
          : null;
        const restoredState = slideScriptureStateBeforeManualRef.current ?? buildScriptureSlideState(slide, 'forward');
        const returnsToScripture = !!restoredState && !!slide && (slide.type === 'sefer' || slide.type === 'tanaj');
        const nextMode: AppMode = returnsToScripture ? 'scripture' : 'slides';

        if (restoredState) {
          setScriptureState(restoredState);
        }
        setAppMode(nextMode);
        syncState({
          presentation: currentPresentationRef.current ?? storedPresenterState?.presentation ?? presentations[0] ?? null,
          slideIndex: (currentSlideIndexRef.current >= 0 && currentPresentationRef.current) ? currentSlideIndexRef.current : 0,
          bgLock: backgroundLockRef.current, lockedBg: lockedBackgroundValueRef.current,
          userSelectedBg: userSelectedBackgroundRef.current, videoState: videoStateRef.current,
          appMode: nextMode, scriptureState: restoredState ?? scriptureStateRef.current
        });
        return;
      }
    }

    setAppMode(mode);
    syncState({
      presentation: mode === 'slides' ? (currentPresentationRef.current ?? storedPresenterState?.presentation ?? presentations[0] ?? null) : currentPresentationRef.current,
      slideIndex: mode === 'slides' ? ((currentSlideIndexRef.current >= 0 && currentPresentationRef.current) ? currentSlideIndexRef.current : 0) : currentSlideIndexRef.current,
      bgLock: backgroundLockRef.current, lockedBg: lockedBackgroundValueRef.current,
      userSelectedBg: userSelectedBackgroundRef.current, videoState: videoStateRef.current,
      appMode: mode, scriptureState: scriptureStateRef.current
    });
  }, [buildScriptureSlideState, presentations, storedPresenterState, syncState]);
  handleToggleAppModeRef.current = handleToggleAppMode;





  // Ruta pública de privacidad
  if (window.location.pathname === '/proteccion-datos') {
    return <DataProtectionPage />;
  }

  // Presenter (big screen) mode
  return (
    <div className="w-full h-dvh overflow-hidden bg-black relative">
      {presentationConflicts}
      {quizScriptureState ? (
        <div id="section-app-scripture-reader-view" className="w-full h-full overflow-hidden">
          <SeferReaderScreen
            scriptureState={quizScriptureState}
            onVerseSelected={handleSeferOnlineRef}
            onBoundaryReached={handleScriptureBoundary}
            onLogoClick={() => {
              window.open(`${window.location.origin}/control`, 'ControlPanel', 'width=1100,height=800');
            }}
          />
        </div>
      ) : (appMode === 'seferManual' || (appMode === 'scripture' && scriptureState?.scriptureKind !== 'tanaj')) && scriptureState ? (
        <div id="section-app-scripture-reader-view" className="w-full h-full overflow-hidden">
          <SeferReaderScreen
            scriptureState={scriptureState}
            onVerseSelected={handleSeferOnlineRef}
            onBoundaryReached={handleScriptureBoundary}
            onLogoClick={() => {
              window.open(`${window.location.origin}/control`, 'ControlPanel', 'width=1100,height=800');
            }}
          />
        </div>
      ) : (
        <div id="section-app-presenter-slide-view" className="w-full h-full overflow-hidden relative">
          <PresenterScreen
            background={activeBackground}
            slide={activePresenterSlide}
            presentationTitle={currentPresentation?.title || ''}
            fontScale={currentPresentation?.fontScale ?? 1}
            onLogoClick={() => {
              window.open(`${window.location.origin}/control`, 'ControlPanel', 'width=1100,height=800');
            }}
            videoState={videoState}
            onVideoStateChange={handleVideoStateChange}
            quizSubslides={quizSubslides}
            quizCurrentSubslideIndex={quizCurrentSubslideIndex}
            quizTimerState={quizTimerState}
            quizPresenterDemoSelection={quizPresenterDemoSelection}
            quizMaxBaseCentipunts={effectiveMaxBaseCentipunts}
            autoduckState={autoduckState}
            serverNow={serverNow}
          />
        </div>
      )}

      {/* Hidden audio element for Pista de Audio */}
      <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />
      {/* Hidden audio element for karaoke and music sync */}
      <audio ref={audioTimelineRef} preload="auto" style={{ display: 'none' }} />

      {/* Autoplay block overlay banner */}

      {autoplayBlocked && (
        <div 
          onClick={() => {
            const timelineAudio = audioTimelineRef.current;
            const audio = (audioTimeline?.status === 'playing' && audioTimeline.audioSrc && timelineAudio)
              ? timelineAudio
              : (audioRef.current?.src ? audioRef.current : timelineAudio || audioRef.current);
            if (audio) {
              audio.play()
                .then(() => setAutoplayBlocked(false))
                .catch(err => console.error("Autoplay retry failed:", err));
            }
          }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-yellow-600 hover:bg-yellow-500 text-white font-bold text-xs px-5 py-2.5 rounded-full shadow-xl cursor-pointer flex items-center gap-2 animate-bounce transition-all border border-yellow-400 shadow-yellow-950/30"
          title={translate("presenter:App.clickHereToEnableAudioPlaybackInThisTab", "Haga clic aquí para habilitar la reproducción de audio en esta pestaña")}
        >
          <Music size={13} className="animate-pulse text-white" />
          <span>{translate("presenter:App.clickToEnableSound", "Haga clic para habilitar sonido")}</span>
        </div>
      )}
      {LiveAudioPresenter && (
        <Suspense fallback={null}>
          <LiveAudioPresenter />
        </Suspense>
      )}
    </div>
  );
}

export default App;
