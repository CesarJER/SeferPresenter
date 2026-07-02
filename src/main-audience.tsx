import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import AudienceScreen from './components/audience/AudienceScreen';
import { useSyncState } from './hooks/useSyncState';
import { useBackgroundResolver } from './hooks/useBackgroundResolver';
import { useQuizTimer } from './hooks/useQuizTimer';
import { generateQuizSubslides, calcMaxBaseCentipunts } from './utils/quizUtils';
import { makeClientId } from './utils/normalizePresentation';
import { DataProtectionLink } from './components/shared/DataProtectionLink';
import { useLiveAudioAvailability } from './features/liveAudio/hooks/useLiveAudioAvailability';
import { useAudienceAudioPlayback } from './hooks/useAudienceAudioPlayback';
import { useAudienceSession } from './hooks/useAudienceSession';
import { useQuizAudio } from './hooks/useQuizAudio';
import { registerScopedServiceWorker } from './utils/pwaUpdate';

import type { AppMode, Presentation, ScriptureNavState, VideoState } from './types/presentation';
import type { QuizSyncState } from './types/quiz';
import type { AudioState } from './types/audio';
import type { AutoduckState } from './types/sync';
import { DEFAULT_AUDIO_STATE } from './types/audio';

import './index.css';

const LiveAudioContainer = React.lazy(() => import('./features/liveAudio/components/audience/LiveAudioAudienceContainer'));

function AudienceApp() {
  const [currentPresentation, setCurrentPresentation] = useState<Presentation | null>(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(-1);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [backgroundLock, setBackgroundLock] = useState<boolean>(false);
  const [lockedBackgroundValue, setLockedBackgroundValue] = useState<string | null>(null);
  const [userSelectedBackground, setUserSelectedBackground] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<VideoState | null>(null);
  const [audioState, setAudioState] = useState<AudioState>(DEFAULT_AUDIO_STATE);
  const [autoduckState, setAutoduckState] = useState<AutoduckState>({ enabled: false, factor: 0.2 });
  const [appMode, setAppMode] = useState<AppMode>('slides');
  const [scriptureState, setScriptureState] = useState<ScriptureNavState | null>(null);

  const clientIdRef = useRef(makeClientId());
  const currentPresentationRef = useRef<Presentation | null>(currentPresentation);
  const currentSlideIndexRef = useRef(currentSlideIndex);
  const currentStepIndexRef = useRef(currentStepIndex);
  const backgroundLockRef = useRef(backgroundLock);
  const lockedBackgroundValueRef = useRef(lockedBackgroundValue);
  const userSelectedBackgroundRef = useRef(userSelectedBackground);
  const videoStateRef = useRef<VideoState | null>(videoState);
  const audioStateRef = useRef<AudioState>(audioState);
  const appModeRef = useRef<AppMode>(appMode);
  const scriptureStateRef = useRef<ScriptureNavState | null>(scriptureState);
  const quizStateRef = useRef<QuizSyncState | null>(null);
  const autoduckStateRef = useRef<AutoduckState>(autoduckState);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void registerScopedServiceWorker('/audience');
  }, []);

  useAudienceAudioPlayback({
    audioState,
    audioRef,
    autoduckState,
  });

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
    autoduckStateRef.current = autoduckState;
  }, [
    currentPresentation, currentSlideIndex, currentStepIndex, backgroundLock,
    lockedBackgroundValue, userSelectedBackground, videoState, audioState,
    appMode, scriptureState, autoduckState
  ]);

  const [quizCurrentSubslideIndex, setQuizCurrentSubslideIndex] = useState(0);
  const [quizState, setQuizState] = useState<QuizSyncState | null>(null);
  const quizTimer = useQuizTimer({ timerSeconds: 30 }); // Initialized dummy

  const activeSlide = currentPresentation && currentSlideIndex >= 0 ? currentPresentation.slides[currentSlideIndex] : null;
  const activeQuizData = activeSlide?.type === 'quiz' ? activeSlide.quizData : undefined;
  const quizSubslides = useMemo(() => activeQuizData ? generateQuizSubslides(activeQuizData) : [], [activeQuizData]);

  const applyRemoteQuizState = (state: QuizSyncState | null) => {
    quizStateRef.current = state;
    setQuizState(state);
    if (!state) {
      setQuizCurrentSubslideIndex(0);
      quizTimer.resetTimer((activeQuizData?.timerSeconds ?? 30) * 1000);
      return;
    }
    const rawIndex = Number.isFinite(state.currentSubslideIndex) ? Math.floor(state.currentSubslideIndex) : 0;
    setQuizCurrentSubslideIndex(rawIndex);
    quizTimer.setTimerState(state.timerState);
  };

  useQuizAudio({
    isPresenterOrControl: true, // Play quiz sounds on audience devices too
    timerStatus: quizTimer.timerState.status,
    isQuestionSubslide: quizSubslides[quizCurrentSubslideIndex]?.kind === 'pregunta',
    feedbackSound: quizState?.feedbackSound,
    isMediaMaster: false,
  });

  const { wsSend, subscribeToWsMessage } = useSyncState({
    isControlMode: false,
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
    setCurrentStepIndex,
    setBackgroundLock,
    setLockedBackgroundValue,
    setUserSelectedBackground,
    setVideoState,
    setAppMode,
    setScriptureState,
    setAudioState,
    setAudioSyncMaps: () => {},
    setQuizState: applyRemoteQuizState,
    autoduckStateRef,
    setAutoduckState,
  });

  const liveAudioAvailability = useLiveAudioAvailability();
  const audienceSession = useAudienceSession({ subscribeToWsMessage });

  const { getActiveBackground } = useBackgroundResolver({
    currentPresentation, currentSlideIndex, backgroundLock, lockedBackgroundValue, userSelectedBackground, scriptureState,
    backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef, scriptureStateRef,
    setBackgroundLock, setLockedBackgroundValue, setUserSelectedBackground,
    emitDisplayTelemetry: () => {},
  });

  const activeBackground = getActiveBackground();

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

  const maxBaseCentipunts = useMemo(() => {
    if (!currentPresentation) return 0;
    const allQuizData = currentPresentation.slides
      .filter(s => s.type === 'quiz' && s.quizData)
      .map(s => s.quizData!);
    return calcMaxBaseCentipunts(allQuizData);
  }, [currentPresentation]);

  const audienceScreenElement = (
    <AudienceScreen
      appMode={appMode}
      background={activeBackground}
      fontScale={currentPresentation?.fontScale ?? 1}
      presentationTitle={currentPresentation?.title || ''}
      scriptureState={quizScriptureState || scriptureState}
      slide={activePresenterSlide}
      videoState={videoState}
      quizSubslides={quizSubslides}
      quizCurrentSubslideIndex={quizCurrentSubslideIndex}
      quizTimerState={quizTimer.timerState}
      quizMaxBaseCentipunts={maxBaseCentipunts}
      autoduckState={autoduckState}
    />
  );

  return (
    <>
      <React.Suspense fallback={audienceScreenElement}>
        <LiveAudioContainer
          availability={liveAudioAvailability.availability}
          wsSend={wsSend}
          subscribeToWsMessage={subscribeToWsMessage}
          clientId={clientIdRef.current}
          audienceSession={audienceSession}
        >
          {audienceScreenElement}
        </LiveAudioContainer>
      </React.Suspense>
      
      {/* Hidden audio element for audience audio sync */}
      <audio ref={audioRef} preload="none" style={{ display: 'none' }} />

      <div className="fixed bottom-2 right-2 z-50 opacity-50 hover:opacity-100 transition-opacity">
        <DataProtectionLink className="text-[10px] text-white/70 hover:text-white flex items-center gap-1" />
      </div>
    </>
  );
}

import DataProtectionPage from './components/shared/DataProtectionPage';

const rootElement = document.getElementById('root');
if (rootElement) {
  if (window.location.pathname === '/proteccion-datos') {
    createRoot(rootElement).render(
      <React.StrictMode>
        <DataProtectionPage />
      </React.StrictMode>
    );
  } else {
    createRoot(rootElement).render(
      <React.StrictMode>
        <AudienceApp />
      </React.StrictMode>
    );
  }
}
