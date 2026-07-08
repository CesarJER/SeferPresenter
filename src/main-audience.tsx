import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Play } from 'lucide-react';
import AudienceScreen from './components/audience/AudienceScreen';
import { useSyncState } from './hooks/useSyncState';
import { useBackgroundResolver } from './hooks/useBackgroundResolver';
import { useQuizTimer } from './hooks/useQuizTimer';
import { useServerClock } from './hooks/useServerClock';
import { useAudioTimelineApplicator } from './hooks/useAudioTimelineApplicator';
import { generateQuizSubslides, calcMaxBaseCentipunts } from './utils/quizUtils';
import { makeClientId } from './utils/normalizePresentation';
import { DataProtectionLink } from './components/shared/DataProtectionLink';
import { useLiveAudioAvailability } from './features/liveAudio/hooks/useLiveAudioAvailability';
import { useAudienceAudioPlayback } from './hooks/useAudienceAudioPlayback';
import { useAudienceSession } from './hooks/useAudienceSession';
import { useQuizAudio } from './hooks/useQuizAudio';
import { registerScopedServiceWorker } from './utils/pwaUpdate';
import { isMediaPlaybackBlockedError, resumeManagedMediaAudio } from './utils/mediaVolume';

import type { AppMode, Presentation, ScriptureNavState, VideoState } from './types/presentation';
import type { QuizSyncState } from './types/quiz';
import type { AudioState, AudioTimelineState } from './types/audio';
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
  const [audioTimeline, setAudioTimeline] = useState<AudioTimelineState | null>(null);
  const [autoduckState, setAutoduckState] = useState<AutoduckState>({ enabled: false, factor: 0.2 });
  const [mediaPlaybackBlocked, setMediaPlaybackBlocked] = useState(false);
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
  const audioTimelineRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void registerScopedServiceWorker('/audience');
  }, []);

  const handlePlaybackBlocked = useCallback((blocked: boolean) => {
    setMediaPlaybackBlocked(blocked);
  }, []);

  useAudienceAudioPlayback({
    audioState,
    audioRef,
    autoduckState,
    onPlaybackBlocked: handlePlaybackBlocked,
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

  const { wsStatus, wsSend, subscribeToWsMessage } = useSyncState({
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
    onAudioTimelineState: setAudioTimeline,
  });

  const { serverNow } = useServerClock(wsSend, wsStatus, subscribeToWsMessage);
  const audioTimelineApplicatorOptions = useMemo(() => ({
    onPlaybackBlocked: handlePlaybackBlocked,
  }), [handlePlaybackBlocked]);
  useAudioTimelineApplicator(audioTimelineRef, audioTimeline, serverNow, autoduckState, audioTimelineApplicatorOptions);

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

  const handleEnableAudienceMedia = useCallback(async () => {
    await resumeManagedMediaAudio();

    const playAttempts: Promise<unknown>[] = [];
    const queuePlay = (media: HTMLMediaElement | null) => {
      if (!media) return;
      if (!media.currentSrc && !media.getAttribute('src') && !media.srcObject) return;
      try {
        playAttempts.push(media.play());
      } catch (error) {
        playAttempts.push(Promise.reject(error));
      }
    };

    if (audioState.isPlaying) {
      queuePlay(audioRef.current);
    }
    if (audioTimeline?.status === 'playing') {
      queuePlay(audioTimelineRef.current);
    }
    if (videoState?.isPlaying && videoState.mediaSrc) {
      const targetSrc = decodeURIComponent(`${window.location.origin}${encodeURI(videoState.mediaSrc)}`);
      document.querySelectorAll('video').forEach((video) => {
        const currentSrc = decodeURIComponent(video.currentSrc || video.src || '');
        if (currentSrc === targetSrc || currentSrc.endsWith(videoState.mediaSrc ?? '')) {
          queuePlay(video);
        }
      });
    }

    if (playAttempts.length === 0) {
      setMediaPlaybackBlocked(false);
      return;
    }

    const results = await Promise.allSettled(playAttempts);
    setMediaPlaybackBlocked(
      results.some((result) => result.status === 'rejected' && isMediaPlaybackBlockedError(result.reason)),
    );
  }, [
    audioState.isPlaying,
    audioTimeline?.status,
    videoState,
  ]);

  const shouldShowMediaUnlock = mediaPlaybackBlocked && (
    audioState.isPlaying ||
    audioTimeline?.status === 'playing' ||
    videoState?.isPlaying === true
  );

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
      onPlaybackBlocked={handlePlaybackBlocked}
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
      {shouldShowMediaUnlock && (
        <button
          type="button"
          onClick={handleEnableAudienceMedia}
          className="fixed bottom-20 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/20 bg-blue-600/95 px-5 py-3 text-sm font-bold text-white shadow-2xl backdrop-blur-md transition-colors hover:bg-blue-500 pointer-events-auto"
        >
          <Play className="h-4 w-4" />
          <span>Activar audio y video</span>
        </button>
      )}
      
      {/* Hidden audio element for audience audio sync */}
      <audio ref={audioRef} preload="none" style={{ display: 'none' }} />
      <audio ref={audioTimelineRef} preload="none" style={{ display: 'none' }} />

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
