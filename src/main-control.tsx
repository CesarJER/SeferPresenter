import { StrictMode, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

import MenuPopup from './components/control/MenuPopup';
import defaultPresentations from '../presentations.json';

import type { AudioState, AudioSyncMap } from './types/audio';
import { DEFAULT_AUDIO_STATE } from './types/audio';
import type { AppMode, Presentation, ScriptureNavState, VideoState } from './types/presentation';
import type { QuizSyncState } from './types/quiz';

import {
  normalizePresentation,
  makeClientId,
} from './utils/normalizePresentation';

import { useSyncState } from './hooks/useSyncState';
import { useBackgroundResolver } from './hooks/useBackgroundResolver';
import { validateAudioSyncMaps, validatePresentationList } from './utils/validation';
import { generateQuizSubslides } from './utils/quizUtils';
import { generatePresentationSteps } from './utils/navigationUtils';
import { makeSyncMessage } from './utils/syncProtocol';

function ControlApp() {
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
  const [audioSyncMaps, setAudioSyncMaps] = useState<AudioSyncMap[]>([]);
  const [availableAudioFiles, setAvailableAudioFiles] = useState<string[]>([]);

  const [appMode, setAppMode] = useState<AppMode>('slides');
  const [scriptureState, setScriptureState] = useState<ScriptureNavState | null>(null);
  const [quizState, setQuizState] = useState<QuizSyncState | null>(null);

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
  const clientIdRef = useRef(makeClientId());

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
  }, [currentPresentation, currentSlideIndex, backgroundLock, lockedBackgroundValue, userSelectedBackground, videoState, audioState, appMode, scriptureState, quizState]);

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

  const { emitCommand, channel } = useSyncState({
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
  });

  const { getActiveBackground } = useBackgroundResolver({
    currentPresentation, currentSlideIndex, backgroundLock,
    lockedBackgroundValue, userSelectedBackground, scriptureState,
    backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef,
    scriptureStateRef,
    setBackgroundLock, setLockedBackgroundValue, setUserSelectedBackground,
    emitDisplayTelemetry: () => {},
  });

  const activeBackground = getActiveBackground();

  const savePresentations = async (updated: Presentation[]) => {
    const normalized = updated.map(normalizePresentation);
    const validation = validatePresentationList(normalized);
    if (!validation.ok || !validation.value) {
      console.error("Refusing to save invalid presentations", validation.errors);
      alert(`No se guardaron las presentaciones porque contienen datos inválidos:\n${validation.errors.slice(0, 5).join('\n')}`);
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
    
    emitCommand({
      command: 'SELECT_PRESENTATION_AND_SLIDE',
      presentation: normalizedPresentation,
      slideIndex: nextIndex,
      direction: 'forward'
    });
  }, [presentations, emitCommand]);

  return (
    <div id="section-app-control-mode" className="w-full h-dvh bg-gray-900 overflow-hidden">
      <MenuPopup
        presentations={presentations}
        backgrounds={backgrounds}
        currentPresentation={currentPresentation}
        currentSlideIndex={currentSlideIndex}
        activeBackground={activeBackground}
        backgroundLock={backgroundLock}
        onToggleBackgroundLock={(locked) => emitCommand({ command: 'TOGGLE_BG_LOCK', locked })}
        onSelectBackgroundOverride={(bg) => emitCommand({ command: 'SELECT_BG_OVERRIDE', bg })}
        onSave={handleSave}
        onResetState={() => emitCommand({ command: 'RESET_STATE' })}
        onSelectPresentation={(p, idx, targetVerse) => emitCommand({ command: 'SELECT_PRESENTATION_AND_SLIDE', presentation: p, slideIndex: idx ?? 0, direction: 'forward', targetVerse })}
        onSelectSlide={(idx) => emitCommand({ command: 'SELECT_PRESENTATION_AND_SLIDE', presentation: currentPresentation, slideIndex: idx, direction: idx < currentSlideIndex ? 'backward' : 'forward' })}
        onImport={(imported) => {
          savePresentations(imported);
          if (imported.length > 0) {
            emitCommand({ command: 'SELECT_PRESENTATION_AND_SLIDE', presentation: imported[0], slideIndex: imported[0].slides.length > 0 ? 0 : -1, direction: 'forward' });
          } else {
            emitCommand({ command: 'SELECT_PRESENTATION_AND_SLIDE', presentation: null, slideIndex: -1, direction: 'forward' });
          }
        }}
        videoState={videoState}
        onVideoStateChange={(s) => emitCommand({ command: 'VIDEO_STATE_CHANGE', state: s })}
        audioState={audioState}
        audioSyncMaps={audioSyncMaps}
        availableAudioFiles={availableAudioFiles}
        onAudioStateChange={(state) => emitCommand({ command: 'AUDIO_STATE_CHANGE', state })}
        onAudioSyncMapsChange={(maps) => {
          const validation = validateAudioSyncMaps(maps);
          if (!validation.ok || !validation.value) {
            console.error('Refusing to save invalid audio sync maps', validation.errors);
            alert(`No se guardaron los mapas de audio porque contienen datos inválidos:\n${validation.errors.slice(0, 5).join('\n')}`);
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
        appMode={appMode}
        scriptureState={scriptureState}
        onUpdateScriptureFontSizes={(sizes) => emitCommand({ command: 'UPDATE_FONT_SIZES', hebrewFontSize: sizes.hebrewFontSize, combinedTextBaseSize: sizes.combinedTextBaseSize })}
        onToggleAppMode={(mode) => emitCommand({ command: 'TOGGLE_APP_MODE', mode })}
        onProjectScripture={(state) => emitCommand({ command: 'SCRIPTURE_PROJECT', state, navCommand: 'navigate' })}
        onAddScriptureSlide={(state, kind) => emitCommand({ command: 'SCRIPTURE_ADD_SLIDE', state, kind })}
        onBoundaryReached={(dir) => emitCommand({ command: 'SCRIPTURE_BOUNDARY', direction: dir })}
        quizSubslides={quizSubslides}
        quizCurrentSubslideIndex={quizState?.currentSubslideIndex ?? 0}
        quizTimerState={quizState?.timerState ?? { status: 'idle', timerStartedAt: null, timerDurationMs: 30000, pausedRemainingMs: null }}
        quizPresenterDemoSelection={activeSlide && quizState?.presenterDemoSelection ? quizState.presenterDemoSelection[activeSlide.id] : null}
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
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ControlApp />
  </StrictMode>,
);
