import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import PresenterScreen from './components/presenter/PresenterScreen';
import MenuPopup from './components/control/MenuPopup';
import SeferReaderScreen from './components/presenter/SeferReaderScreen';
import AudienceScreen from './components/audience/AudienceScreen';
import defaultPresentations from '../presentations.json';
import { Music } from 'lucide-react';
import { AudioSyncEditor } from './components/AudioSyncEditor';


import type { AudioState, AudioSyncMap } from './types/audio';
import { DEFAULT_AUDIO_STATE } from './types/audio';
import type { AppMode, Presentation, ScriptureNavState, Slide, VideoState, QuizData } from './types/presentation';
import type { QuizOptionId, QuizSyncState } from './types/quiz';

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
import { useScriptureNavigation } from './hooks/useScriptureNavigation';
import { useQuizAudio } from './hooks/useQuizAudio';
import { useQuizTimer } from './hooks/useQuizTimer';
import { validateAudioSyncMaps, validatePresentationList } from './utils/validation';
import { makeSyncMessage } from './utils/syncProtocol';
import { generateQuizSubslides, calcMaxBaseCentipunts } from './utils/quizUtils';

function App() {
  const routeName = window.location.pathname.split('/').filter(Boolean)[0] || 'presenter';
  const isControlMode = routeName === 'control';
  const isAudioEditorMode = routeName === 'audio-editor';
  const isAudienceMode = routeName === 'audience';
  const storedPresenterState = loadStoredPresenterState();

  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [currentPresentation, setCurrentPresentation] = useState<Presentation | null>(storedPresenterState?.presentation ?? null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(storedPresenterState?.slideIndex ?? -1);
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
  const [audioSyncMaps, setAudioSyncMaps] = useState<AudioSyncMap[]>([]);
  const [availableAudioFiles, setAvailableAudioFiles] = useState<string[]>([]);

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
  const appModeRef = useRef<AppMode>(appMode);
  const scriptureStateRef = useRef<ScriptureNavState | null>(scriptureState);
  const slideScriptureStateBeforeManualRef = useRef<ScriptureNavState | null>(null);
  const quizStateRef = useRef<QuizSyncState | null>(null);
  const clientIdRef = useRef(makeClientId());
  const navigatedSlideIdRef = useRef<string | undefined>(undefined);
  const lastActiveSlideIdRef = useRef<string | undefined>(undefined);

  const activeSlide = currentPresentation && currentSlideIndex >= 0 ? currentPresentation.slides[currentSlideIndex] : null;
  const activeQuizData = activeSlide?.type === 'quiz' ? activeSlide.quizData : undefined;
  const quizSubslides = useMemo(
    () => activeQuizData ? generateQuizSubslides(activeQuizData) : [],
    [activeQuizData],
  );
  const [quizCurrentSubslideIndex, setQuizCurrentSubslideIndex] = useState(0);
  const [quizPresenterDemoSelection, setQuizPresenterDemoSelection] = useState<QuizOptionId | null>(null);
  const quizTimer = useQuizTimer({
    timerSeconds: activeQuizData?.timerSeconds ?? 30,
  });
  const makeInitialQuizState = useCallback((slide: Slide | null, direction: 'forward' | 'backward' = 'forward'): QuizSyncState | null => {
    const quizData = slide?.type === 'quiz' ? slide.quizData : undefined;
    if (!quizData || !slide) return null;
    
    let initialIndex = 0;
    if (direction === 'backward') {
      const subslides = generateQuizSubslides(quizData);
      if (subslides.length > 0) initialIndex = subslides.length - 1;
    }

    return {
      currentSubslideIndex: initialIndex,
      timerState: {
        status: 'idle',
        timerStartedAt: null,
        timerDurationMs: quizData.timerSeconds * 1000,
        pausedRemainingMs: null,
      },
      presenterDemoSelection: {
        [slide.id]: null,
      },
    };
  }, []);
  const quizAudio = useQuizAudio({
    isPresenterOrControl: !isAudienceMode && !isControlMode,
    timerStatus: quizTimer.timerState.status,
    isQuestionSubslide: quizSubslides[quizCurrentSubslideIndex]?.kind === 'pregunta',
  });
  const activeQuizState = useMemo<QuizSyncState | null>(() => {
    if (!activeQuizData || !activeSlide) return null;
    return {
      currentSubslideIndex: quizCurrentSubslideIndex,
      timerState: quizTimer.timerState,
      presenterDemoSelection: {
        [activeSlide.id]: quizPresenterDemoSelection,
      },
    };
  }, [activeQuizData, activeSlide, quizCurrentSubslideIndex, quizTimer.timerState, quizPresenterDemoSelection]);

  const applyRemoteQuizState = useCallback((state: QuizSyncState | null) => {
    if (!state) {
      quizStateRef.current = null;
      setQuizCurrentSubslideIndex(0);
      setQuizPresenterDemoSelection(null);
      quizTimer.resetTimer((activeQuizData?.timerSeconds ?? 30) * 1000);
      return;
    }

    const rawIndex = Number.isFinite(state.currentSubslideIndex)
      ? Math.max(0, Math.floor(state.currentSubslideIndex))
      : 0;
    const fallbackSelection = Object.values(state.presenterDemoSelection ?? {})[0] ?? null;

    setQuizCurrentSubslideIndex(rawIndex);
    quizTimer.setTimerState(state.timerState);
    setQuizPresenterDemoSelection(activeSlide ? state.presenterDemoSelection?.[activeSlide.id] ?? fallbackSelection : fallbackSelection);
  }, [activeQuizData?.timerSeconds, activeSlide, quizTimer.resetTimer, quizTimer.setTimerState]);

  useEffect(() => {
    if (isControlMode && quizSubslides[quizCurrentSubslideIndex]?.kind === 'pregunta' && quizTimer.timerState.status === 'idle') {
      quizTimer.startTimer();
    }
  }, [isControlMode, quizSubslides, quizCurrentSubslideIndex, quizTimer.timerState.status, quizTimer.startTimer]);

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
    quizStateRef.current = activeQuizState;
  }, [currentPresentation, currentSlideIndex, backgroundLock, lockedBackgroundValue, userSelectedBackground, videoState, audioState, appMode, scriptureState, activeQuizState]);

  useEffect(() => {
    fetch('/api/backgrounds')
      .then(res => res.json())
      .then(data => setBackgrounds(data))
      .catch(err => console.error("Error loading backgrounds", err));
    fetch('/api/presentations')
      .then(res => res.json())
      .then(data => {
        const validation = validatePresentationList(data);
        if (validation.ok && validation.value) {
          setPresentations(validation.value.map(normalizePresentation));
        } else {
          console.error("Invalid presentations payload", validation.errors);
          setPresentations((defaultPresentations as Presentation[]).map(normalizePresentation));
        }
      })
      .catch(err => {
        console.error("Error loading presentations", err);
        setPresentations((defaultPresentations as Presentation[]).map(normalizePresentation));
      });
    fetch('/api/audio')
      .then(res => res.json())
      .then(data => setAvailableAudioFiles(data))
      .catch(err => console.error("Error loading audio files", err));
    fetch('/api/audio-sync')
      .then(res => res.json())
      .then(data => {
        const validation = validateAudioSyncMaps(data);
        if (validation.ok && validation.value) {
          setAudioSyncMaps(validation.value);
        } else {
          console.error("Invalid audio sync payload", validation.errors);
        }
      })
      .catch(err => console.error("Error loading audio sync maps", err));
  }, []);

  const { channel, syncState, emitAudioTelemetry, emitVideoTelemetry, emitDisplayTelemetry } = useSyncState({
    isControlMode, clientIdRef,
    currentPresentationRef, currentSlideIndexRef, backgroundLockRef,
    lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef,
    audioStateRef, appModeRef, scriptureStateRef, quizStateRef,
    setCurrentPresentation, setCurrentSlideIndex, setBackgroundLock,
    setLockedBackgroundValue, setUserSelectedBackground, setVideoState,
    setAppMode, setScriptureState, setAudioState, setAudioSyncMaps,
    setQuizState: applyRemoteQuizState,
  });

  useEffect(() => {
    if (!isControlMode) return;
    syncState({
      presentation: currentPresentationRef.current,
      slideIndex: currentSlideIndexRef.current,
      bgLock: backgroundLockRef.current,
      lockedBg: lockedBackgroundValueRef.current,
      userSelectedBg: userSelectedBackgroundRef.current,
      videoState: videoStateRef.current,
      appMode: appModeRef.current,
      scriptureState: scriptureStateRef.current,
      audioState: audioStateRef.current,
      quizState: activeQuizState,
    });
  }, [isControlMode, activeQuizState, syncState]);

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
    if (!isControlMode) return;
    
    const isNewSlide = activeSlide?.id !== lastActiveSlideIdRef.current;
    lastActiveSlideIdRef.current = activeSlide?.id;

    if (isNewSlide && activeSlide?.id !== navigatedSlideIdRef.current) {
      // Intentionally NOT resetting quizCurrentSubslideIndex here. 
      // handleSelectPresentationAndSlide already sets the correct initialIndex (0 for forward, N for backward).
      setQuizPresenterDemoSelection(null);
    }
    quizTimer.resetTimer((activeQuizData?.timerSeconds ?? 30) * 1000);
  }, [isControlMode, activeSlide?.id, activeQuizData?.timerSeconds, quizTimer.resetTimer]);

  type SelectPresentationAndSlideHandler = (
    presentation: Presentation | null,
    slideIndex: number,
    direction?: 'forward' | 'backward',
    targetVerse?: string
  ) => void;

  const handleSelectPresentationAndSlideRef = useRef<SelectPresentationAndSlideHandler | null>(null);
  const handleSaveRef = useRef<((presentation: Presentation) => void) | null>(null);

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
    handleSelectPresentationAndSlide: (...args) => handleSelectPresentationAndSlideRef.current?.(...args),
    handleSave: (p) => handleSaveRef.current?.(p), 
    slideScriptureStateBeforeManualRef
  });

  const handleSelectPresentationAndSlide = useCallback((p: Presentation | null, idx: number, direction: 'forward' | 'backward' = 'forward', targetVerse?: string) => {
    const normalizedPresentation = p ? normalizePresentation(p) : null;
    setCurrentPresentation(normalizedPresentation);
    setCurrentSlideIndex(idx);
    setVideoState(null);

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
      quizTimer.resetTimer(slide.quizData.timerSeconds * 1000);
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
      });
    } else {
      setUserSelectedBackground(null);
      syncState({
        presentation: normalizedPresentation, slideIndex: idx, bgLock: backgroundLockRef.current,
        lockedBg: lockedBackgroundValueRef.current, userSelectedBg: null,
        videoState: null, appMode: nextAppMode, scriptureState: scriptureSlideState ?? scriptureStateRef.current,
        quizState: nextQuizState,
      });
    }
  }, [syncState, buildScriptureSlideState, makeInitialQuizState, quizTimer.resetTimer, backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef, scriptureStateRef]);
  handleSelectPresentationAndSlideRef.current = handleSelectPresentationAndSlide;

  const savePresentations = async (updated: Presentation[]) => {
    const normalized = updated.map(normalizePresentation);
    const validation = validatePresentationList(normalized);
    if (!validation.ok || !validation.value) {
      console.error("Refusing to save invalid presentations", validation.errors);
      alert(`No se guardaron las presentaciones porque contienen datos inv\u00e1lidos:\n${validation.errors.slice(0, 5).join('\n')}`);
      return;
    }
    setPresentations(normalized);
    try {
      await fetch('/api/presentations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized)
      });
    } catch (err) {
      console.error("Error saving presentations", err);
    }
  };

  const handleSave = useCallback((presentation: Presentation) => {
    const normalizedPresentation = normalizePresentation(presentation);
    const existing = presentations.findIndex(p => p.id === normalizedPresentation.id);
    const updated = [...presentations];
    if (existing >= 0) {
      updated[existing] = normalizedPresentation;
    } else {
      updated.push(normalizedPresentation);
    }
    savePresentations(updated);
    const nextIndex = existing >= 0
      ? Math.min(currentSlideIndexRef.current, normalizedPresentation.slides.length - 1)
      : normalizedPresentation.slides.length > 0 ? 0 : -1;
    handleSelectPresentationAndSlide(normalizedPresentation, nextIndex);
  }, [presentations, handleSelectPresentationAndSlide]);
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

  useUrlSync({
    presentations, currentPresentation, currentSlideIndex, appMode, scriptureState,
    currentPresentationRef, currentSlideIndexRef, scriptureStateRef, slideScriptureStateBeforeManualRef,
    handleSelectPresentationAndSlide,
    enabled: !isControlMode && !isAudioEditorMode && !isAudienceMode,
    routeBase: '/presenter',
  });

  useKeyboardNavigation({
    isControlMode, currentPresentation, currentSlideIndex, appModeRef, scriptureStateRef,
    currentPresentationRef, currentSlideIndexRef,
    handleSelectPresentationAndSlide, handleScriptureEscape, handleScriptureArrowNav,
    enabled: !isAudienceMode,
    quizCurrentSubslideIndex,
    quizSubslideCount: quizSubslides.length,
    onQuizSubslideSelect: setQuizCurrentSubslideIndex,
  });

  useAudioPlayback({
    isControlMode, audioState, audioStateRef, audioSyncMaps, currentSlideIndex, currentPresentationId: currentPresentation?.id, scriptureState,
    audioRef, currentPresentationRef, setAutoplayBlocked, emitAudioTelemetry,
    handleSelectPresentationAndSlide
  });

  useEffect(() => {
    if (currentPresentation) {
      document.title = `SeferPresenter - ${currentPresentation.title}`;
    } else {
      document.title = `SeferPresenter`;
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
  const handleVideoStateChange = useCallback((state: VideoState | null) => {
    setVideoState(state);
    emitVideoTelemetry(state);
  }, [emitVideoTelemetry]);

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

  if (isAudienceMode) {
    return (
      <AudienceScreen
        appMode={appMode}
        background={activeBackground}
        fontScale={currentPresentation?.fontScale ?? 1}
        presentationTitle={currentPresentation?.title || ''}
        scriptureState={scriptureState}
        slide={activePresenterSlide}
        videoState={videoState}
        quizSubslides={quizSubslides}
        quizCurrentSubslideIndex={quizCurrentSubslideIndex}
        quizTimerState={quizTimer.timerState}
      />
    );
  }

  if (isAudioEditorMode) {
    return (
      <div className="w-screen h-screen bg-gray-900 overflow-hidden">
        <AudioSyncEditor
          isOpen={true}
          onClose={() => window.close()}
          presentations={presentations}
          activePresentationId={currentPresentation?.id || null}
          activeAudioSrc={audioState.audioSrc}
          availableAudioFiles={availableAudioFiles}
          audioSyncMaps={audioSyncMaps}
          onAudioSyncMapsChange={(maps) => {
            const validation = validateAudioSyncMaps(maps);
            if (!validation.ok || !validation.value) {
              console.error('Refusing to save invalid audio sync maps', validation.errors);
              alert(`No se guardaron los mapas de audio porque contienen datos inv\u00e1lidos:\n${validation.errors.slice(0, 5).join('\n')}`);
              return;
            }
            setAudioSyncMaps(validation.value);
            fetch('/api/audio-sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(validation.value)
            }).catch(err => console.error('Error saving audio sync maps', err));
            channel.postMessage(makeSyncMessage({ type: 'AUDIO_SYNC_MAPS_UPDATE', maps: validation.value }));
          }}
        />
      </div>
    );
  }

  if (isControlMode) {
    return (
      <div id="section-app-control-mode" className="w-full h-screen bg-gray-900 overflow-hidden">
        <MenuPopup
          presentations={presentations}
          backgrounds={backgrounds}
          currentPresentation={currentPresentation}
          currentSlideIndex={currentSlideIndex}
          activeBackground={activeBackground}
          backgroundLock={backgroundLock}
          onToggleBackgroundLock={handleToggleBackgroundLock}
          onSelectBackgroundOverride={handleSelectBackgroundOverride}
          onSave={handleSave}
          onResetState={handleResetState}
          onSelectPresentation={(p, idx, targetVerse) => handleSelectPresentationAndSlide(p, idx ?? 0, 'forward', targetVerse)}
          onSelectSlide={(idx) => handleSelectPresentationAndSlide(currentPresentation, idx, idx < currentSlideIndex ? 'backward' : 'forward')}
          onImport={(imported) => {
            savePresentations(imported);
            if (imported.length > 0) {
              handleSelectPresentationAndSlide(imported[0], imported[0].slides.length > 0 ? 0 : -1);
            } else {
              handleSelectPresentationAndSlide(null, -1);
            }
          }}
          videoState={videoState}
          onVideoStateChange={handleVideoStateChange}
          audioState={audioState}
          audioSyncMaps={audioSyncMaps}
          availableAudioFiles={availableAudioFiles}
          onAudioStateChange={(state) => {
            setAudioState(state);
            syncState({
              presentation: currentPresentation, slideIndex: currentSlideIndex, bgLock: backgroundLock,
              lockedBg: lockedBackgroundValue, userSelectedBg: userSelectedBackground, audioState: state
            });
          }}
          onAudioSyncMapsChange={(maps) => {
            const validation = validateAudioSyncMaps(maps);
            if (!validation.ok || !validation.value) {
              console.error('Refusing to save invalid audio sync maps', validation.errors);
              alert(`No se guardaron los mapas de audio porque contienen datos inv\u00e1lidos:\n${validation.errors.slice(0, 5).join('\n')}`);
              return;
            }
            setAudioSyncMaps(validation.value);
            fetch('/api/audio-sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(validation.value)
            }).catch(err => console.error('Error saving audio sync maps', err));
          }}
          appMode={appMode}
          scriptureState={scriptureState}
          onUpdateScriptureFontSizes={handleUpdateScriptureFontSizes}
          onToggleAppMode={handleToggleAppMode}
          onProjectScripture={handleProjectScripture}
          onAddScriptureSlide={handleAddScriptureSlide}
          onBoundaryReached={handleScriptureBoundary}
          quizSubslides={quizSubslides}
          quizCurrentSubslideIndex={quizCurrentSubslideIndex}
          quizTimerState={quizTimer.timerState}
          quizPresenterDemoSelection={quizPresenterDemoSelection}
          onQuizSubslideSelect={setQuizCurrentSubslideIndex}
          onQuizStartTimer={quizTimer.startTimer}
          onQuizPauseTimer={quizTimer.pauseTimer}
          onQuizResumeTimer={quizTimer.resumeTimer}
          onQuizResetTimer={() => quizTimer.resetTimer((activeQuizData?.timerSeconds ?? 30) * 1000)}
          onQuizComplete={() => {
            quizTimer.completeTimer();
            const answerIndex = quizSubslides.findIndex(subslide => subslide.kind === 'respuesta');
            if (answerIndex >= 0) setQuizCurrentSubslideIndex(answerIndex);
          }}
          onQuizDemoSelect={(optionId) => {
            setQuizPresenterDemoSelection(optionId);
            const selected = activeQuizData?.options.find(option => option.id === optionId);
            if (selected?.isCorrect) quizAudio.playApplause();
            if (selected && !selected.isCorrect) quizAudio.playMal();
          }}
          onQuizPlayApplause={quizAudio.playApplause}
          onQuizPlayMal={quizAudio.playMal}
        />
      </div>
    );
  }

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

  // Presenter (big screen) mode
  return (
    <div className="w-full h-screen overflow-hidden bg-black relative">
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
            quizTimerState={quizTimer.timerState}
            quizPresenterDemoSelection={quizPresenterDemoSelection}
            quizMaxBaseCentipunts={calcMaxBaseCentipunts(currentPresentation?.slides.map(s => s.quizData).filter(Boolean) as QuizData[] || [])}
          />
        </div>
      )}

      {/* Hidden audio element for karaoke and music sync */}
      <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />

      {/* Autoplay block overlay banner */}

      {autoplayBlocked && (
        <div 
          onClick={() => {
            const audio = audioRef.current;
            if (audio) {
              audio.play()
                .then(() => setAutoplayBlocked(false))
                .catch(err => console.error("Autoplay retry failed:", err));
            }
          }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-yellow-600 hover:bg-yellow-500 text-white font-bold text-xs px-5 py-2.5 rounded-full shadow-xl cursor-pointer flex items-center gap-2 animate-bounce transition-all border border-yellow-400 shadow-yellow-950/30"
          title="Haga clic aquí para habilitar la reproducción de audio en esta pestaña"
        >
          <Music size={13} className="animate-pulse text-white" />
          <span>Haga clic para habilitar sonido</span>
        </div>
      )}
    </div>
  );
}

export default App;
