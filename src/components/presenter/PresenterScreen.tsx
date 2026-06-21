import React, { useEffect, useState, useRef, Suspense } from 'react';
import { isImageMedia } from '../../utils/mediaUtils';
import type { Slide, VideoState } from '../../types/presentation';
import type { QuizOptionId, QuizSubslide, QuizTimerState } from '../../types/quiz';
import { AnimatePresence, motion } from 'framer-motion';
import AutoResizeText from '../shared/AutoResizeText';
import { QuizPresenterView } from '../quiz/QuizPresenterView';

const LiveAudioPresenter = import.meta.env.VITE_SEFER_LIVE_AUDIO_BUILD !== 'false'
  ? React.lazy(() => import('../../features/liveAudio/components/presenter/LiveAudioPresenter'))
  : null;

interface PresenterScreenProps {
  background: string;
  slide: Slide | null;
  presentationTitle: string;
  fontScale: number;
  onLogoClick: () => void;
  videoState: VideoState | null;
  onVideoStateChange: (state: VideoState | null) => void;
  // Quiz props (optional — only used when slide.type === 'quiz')
  quizSubslides?: QuizSubslide[];
  quizCurrentSubslideIndex?: number;
  quizTimerState?: QuizTimerState;
  quizPresenterDemoSelection?: QuizOptionId | null;
  quizMaxBaseCentipunts?: number;
}

const PresenterScreen: React.FC<PresenterScreenProps> = ({
  background,
  slide,
  presentationTitle,
  fontScale,
  onLogoClick,
  videoState,
  onVideoStateChange,
  quizSubslides,
  quizCurrentSubslideIndex = 0,
  quizTimerState,
  quizPresenterDemoSelection = null,
  quizMaxBaseCentipunts = 0,
}) => {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  // Sync prop callback to a ref to avoid stale closures in event listeners/intervals
  const onVideoStateChangeRef = useRef(onVideoStateChange);
  useEffect(() => {
    onVideoStateChangeRef.current = onVideoStateChange;
  }, [onVideoStateChange]);

  const lastSeekIdRef = useRef<number | undefined>(undefined);

  // 1. Symmetrical network synchronization: Listen to controller state updates
  useEffect(() => {
    if (!videoElement || !videoState || videoState.lastUpdatedBy !== 'controller') return;

    // Apply Volume
    if (videoElement.volume !== videoState.volume) {
      videoElement.volume = videoState.volume;
    }

    // Apply Playback Speed
    if (videoElement.playbackRate !== videoState.speed) {
      videoElement.playbackRate = videoState.speed;
    }

    // Apply Loop
    if (videoState.loop !== undefined && videoElement.loop !== videoState.loop) {
      videoElement.loop = videoState.loop;
    }

    // Apply Scrubbing Time (ONLY if controller explicitly requested a seek via seekId)
    if (videoState.seekId !== undefined && videoState.seekId !== lastSeekIdRef.current) {
      if (Math.abs(videoElement.currentTime - videoState.currentTime) > 0.6) {
        videoElement.currentTime = videoState.currentTime;
      }
      lastSeekIdRef.current = videoState.seekId;
    }

    // Apply Play/Pause
    if (videoState.isPlaying && videoElement.paused) {
      // Check if we are at the end (natural end or custom end)
      const endTime = slide?.mediaEnd;
      const isAtEnd = videoElement.ended || (endTime !== undefined && videoElement.currentTime >= endTime);
      if (isAtEnd) {
        videoElement.currentTime = slide?.mediaStart ?? 0;
      }
      videoElement.play().catch(err => console.error("Error auto-playing projection video:", err));
    } else if (!videoState.isPlaying && !videoElement.paused) {
      videoElement.pause();
    }
  }, [videoState, slide?.mediaStart, slide?.mediaEnd, videoElement]);

  // 2. Slide change listener: Setup dedicated slide video when slide transitions
  const mediaSrc = slide?.type === 'media' ? slide.mediaSrc : null;
  
  // 2A. Initialization: Load video and set start time (only when slide or media source changes)
  useEffect(() => {
    if (!videoElement || !slide || slide.type !== 'media' || !mediaSrc) return;

    // Refresh media and apply default slide settings
    videoElement.load();
    const defaultVol = slide.mediaVolume ?? 0.8;
    const defaultSpeed = slide.mediaSpeed ?? 1.0;
    const defaultStart = slide.mediaStart ?? 0;
    const defaultLoop = slide.mediaLoop !== false;

    videoElement.volume = defaultVol;
    videoElement.playbackRate = defaultSpeed;
    videoElement.currentTime = defaultStart;
    videoElement.loop = defaultLoop;

    // Broadcast the initial video stats immediately
    if (onVideoStateChangeRef.current) {
      onVideoStateChangeRef.current({
        isPlaying: false,
        currentTime: defaultStart,
        duration: Number.isFinite(videoElement.duration) ? videoElement.duration : 0,
        volume: defaultVol,
        speed: defaultSpeed,
        loop: defaultLoop,
        mediaSrc: mediaSrc,
        startTime: slide.mediaStart,
        endTime: slide.mediaEnd,
        lastUpdatedBy: 'projection',
        timestamp: Date.now()
      });
    }
  }, [
    videoElement,
    slide?.id,
    mediaSrc,
  ]);

  // 2B. Live parameter updates: Apply volume, speed, loop without resetting time
  useEffect(() => {
    if (!videoElement || !slide || slide.type !== 'media' || !mediaSrc) return;

    const vol = slide.mediaVolume ?? 0.8;
    const speed = slide.mediaSpeed ?? 1.0;
    const loop = slide.mediaLoop !== false;

    if (videoElement.volume !== vol) videoElement.volume = vol;
    if (videoElement.playbackRate !== speed) videoElement.playbackRate = speed;
    if (videoElement.loop !== loop) videoElement.loop = loop;
  }, [
    videoElement,
    mediaSrc,
    slide?.mediaVolume,
    slide?.mediaSpeed,
    slide?.mediaLoop,
  ]);

  // 3. Playback timeupdate & loadedmetadata event listeners for bidirectional telemetry
  useEffect(() => {
    if (!videoElement || !slide || slide.type !== 'media') return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const emitTelemetry = () => {
      if (onVideoStateChangeRef.current) {
        onVideoStateChangeRef.current({
          isPlaying: !videoElement.paused,
          currentTime: videoElement.currentTime,
          duration: Number.isFinite(videoElement.duration) ? videoElement.duration : 0,
          volume: videoElement.volume,
          speed: videoElement.playbackRate,
          loop: videoElement.loop,
          mediaSrc: slide.mediaSrc || null,
          startTime: slide.mediaStart,
          endTime: slide.mediaEnd,
          lastUpdatedBy: 'projection',
          timestamp: Date.now()
        });
      }
    };

    const handlePlay = () => {
      // Clear the existing interval to prevent duplicates
      if (intervalId) {
        clearInterval(intervalId);
      }
      // Periodic telemetry updates during playback.
      intervalId = setInterval(() => {
        if (!videoElement) return;

        const startTime = slide.mediaStart ?? 0;
        const endTime = slide.mediaEnd;

        // Loop boundaries check
        if (endTime !== undefined && videoElement.currentTime >= endTime) {
          if (videoElement.loop) {
            videoElement.currentTime = startTime;
          } else {
            videoElement.pause();
          }
        }

        emitTelemetry();
      }, 1000);
    };

    const handlePause = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      emitTelemetry();
    };

    const handleEnded = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      emitTelemetry();
    };

    const handleLoadedMetadata = () => {
      emitTelemetry();
    };

    const handleDurationChange = () => {
      emitTelemetry();
    };

    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);
    videoElement.addEventListener('ended', handleEnded);
    videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoElement.addEventListener('durationchange', handleDurationChange);

    // Sync state immediately upon setup (useful if metadata/duration is already loaded or we are paused)
    emitTelemetry();

    if (!videoElement.paused) {
      handlePlay();
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (videoElement) {
        videoElement.removeEventListener('play', handlePlay);
        videoElement.removeEventListener('pause', handlePause);
        videoElement.removeEventListener('ended', handleEnded);
        videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
        videoElement.removeEventListener('durationchange', handleDurationChange);
      }
    };
  }, [slide, mediaSrc, slide?.id, slide?.mediaSrc, slide?.mediaStart, slide?.mediaEnd, videoElement]);

  const isVideoBg = /\.(mp4|webm)$/i.test(background);
  const isFallback1x = slide?.lines.length === 3 && slide.lines[1] === '-' && slide.lines[2] === '-';
  const isTrilingual = slide?.lines.length === 3 && !isFallback1x;
  const slideLabel = slide?.label && slide.label !== 'Título' ? slide.label : '';
  const titleText = presentationTitle || slide?.label || '';
  const scaleStyle = { '--font-scale': fontScale } as React.CSSProperties;

  // Hiding overlays based on special image slide content ([IMAGE]) or dedicated video slides
  const isImageSlide = slide?.lines[0]?.trim() === '[IMAGE]';
  const isVideoSlide = slide?.type === 'media';
  const isQuizSlide = slide?.type === 'quiz' && !!slide.quizData;
  const isPhotoSlide = isImageSlide;
  const presenterNavVisible = !(isVideoSlide || isPhotoSlide) || slide?.mediaPresenterNav !== false;
  const isResultsSlide = isQuizSlide && quizSubslides?.[quizCurrentSubslideIndex]?.kind === 'results';
  const hideLyricsOverlay = isPhotoSlide || isVideoSlide || isQuizSlide;
  

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950 text-white">
      <AnimatePresence mode="wait">
        <motion.div
          key={(slide?.type === 'media' ? slide.mediaSrc : background) || 'empty-background'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="absolute inset-0"
        >
          {/* 1. Fondo base (sólo se dibuja si no es imagen pura/media, o si mediaShowBg es true) */}
          {((slide?.type !== 'media' && slide?.lines[0]?.trim() !== '[IMAGE]') || slide?.mediaShowBg === true) && (
            background ? (
              isVideoBg ? (
                <video
                  src={background}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <img src={background} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )
            ) : (
              <div className="absolute inset-0 h-full w-full bg-[radial-gradient(circle_at_30%_20%,#29415f,#09111f_55%,#020617)]" />
            )
          )}

          {/* 2. Capa Multimedia encima (Imagen o Video de la diapositiva) */}
          {slide?.type === 'media' && slide.mediaSrc && (
            isImageMedia(slide.mediaSrc) ? (
              <img
                src={slide.mediaSrc}
                className={`absolute inset-0 h-full w-full object-${slide.mediaFit || 'cover'} z-10`}
                alt="Slide Media"
              />
            ) : (
              <video
                ref={setVideoElement}
                src={slide.mediaSrc}
                autoPlay
                loop={slide.mediaLoop !== false}
                playsInline
                className={`absolute inset-0 h-full w-full object-${slide.mediaFit || 'cover'} z-10`}
              />
            )
          )}
        </motion.div>
      </AnimatePresence>

      {!isVideoSlide && !isPhotoSlide && (
        <>
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-black/22 pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/78 via-black/12 to-black/28 pointer-events-none" />
        </>
      )}

      {!slide ? (
        <div className="relative z-20 flex h-full items-center justify-center">
          <button
            onClick={onLogoClick}
            className="rounded-full bg-white/12 p-8 shadow-2xl backdrop-blur-md transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white/70 cursor-pointer"
            title="Abrir Menú"
          >
            <img src="/logo.svg" alt="La operador" className="h-48 w-auto md:h-64" />
          </button>
        </div>
      ) : (
        <div className="relative z-20 h-full w-full px-[6vw] pt-[7vh] pb-[9vh]" style={scaleStyle}>
          <div className={`grid h-full transition-all duration-500 ease-in-out ${isResultsSlide ? 'w-full' : 'md:grid-cols-[minmax(0,min(58vw,920px))_1fr] md:gap-[3vw]'}`}>
            <div className={`grid h-full grid-rows-[minmax(0,1fr)_auto] gap-[3vh] transition-all duration-500 ease-in-out ${isResultsSlide ? 'w-full' : 'w-[min(88vw,920px)] md:w-auto lg:w-full'}`}>
              <main className="flex min-w-0 items-center h-full max-h-full">
                {!hideLyricsOverlay && (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={slide.id}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -14 }}
                      transition={{ duration: 0.28, ease: 'easeOut' }}
                      className="w-full flex flex-col justify-center max-h-full h-full min-h-0"
                    >
                      {isTrilingual ? (
                        <div className="flex flex-col w-full h-full max-h-full gap-[2.4vh] min-h-0">
                          {slide.lines.map((line, idx) => (
                            <section
                              key={idx}
                              className="glass-panel flex min-h-0 min-h-[12vh] flex-1 flex-col px-[3vw] py-[2.4vh]"
                            >
                              <div className="flex-1 overflow-hidden">
                                <AutoResizeText
                                  text={line}
                                  html={true}
                                  fontScale={fontScale}
                                  className={`drop-shadow-2xl font-semibold ${idx === 0
                                      ? 'hebrew-text text-[#f3c96a] text-[calc(clamp(1.8rem,4vw,5.8rem)*var(--font-scale))]'
                                      : idx === 1
                                        ? 'text-sky-200 text-[calc(clamp(1.2rem,2.2vw,3rem)*var(--font-scale))]'
                                        : 'text-white text-[calc(clamp(1rem,2vw,2.6rem)*var(--font-scale))]'
                                    }`}
                                />
                              </div>
                            </section>
                          ))}
                        </div>
                      ) : (
                        <section className="glass-panel flex min-h-0 min-h-[40vh] w-full flex-1 flex-col px-[4vw] py-[5vh]">
                          <div className="flex-1 overflow-hidden">
                            <AutoResizeText
                              text={slide.lines[0]}
                              html={true}
                              fontScale={fontScale}
                              className="font-bold text-white drop-shadow-2xl text-[calc(clamp(2rem,4.8vw,7rem)*var(--font-scale))]"
                            />
                          </div>
                        </section>
                      )}
                    </motion.div>
                  </AnimatePresence>
                )}
                {/* Quiz overlay */}
                {isQuizSlide && slide.quizData && quizSubslides && quizTimerState && (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`quiz-${slide.id}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="w-full flex flex-col justify-center max-h-full h-full min-h-0"
                    >
                      <QuizPresenterView
                        slide={slide}
                        quizData={slide.quizData}
                        subslides={quizSubslides}
                        currentSubslideIndex={quizCurrentSubslideIndex}
                        timerState={quizTimerState}
                        presenterDemoSelection={quizPresenterDemoSelection}
                        maxBaseCentipunts={quizMaxBaseCentipunts}
                        fontScale={fontScale}
                      />
                    </motion.div>
                  </AnimatePresence>
                )}
              </main>

              <footer
                className={`group/nav grid h-[7vh] min-h-14 max-h-20 w-full grid-cols-[1.25fr_0.5fr_clamp(3.5rem,7vh,5rem)] gap-2 text-center font-bold transition-opacity duration-200 ${presenterNavVisible ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}
              >
                <div className="glass-panel-nav flex min-w-0 items-center justify-center px-3 text-[clamp(0.72rem,1vw,1.18rem)] sm:px-4">
                  {titleText}
                </div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={slideLabel}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="glass-panel-nav flex min-w-0 items-center justify-center px-3 text-[clamp(0.72rem,1vw,1.18rem)] sm:px-4"
                  >
                    {slideLabel}
                  </motion.div>
                </AnimatePresence>
                <button
                  onClick={onLogoClick}
                  className="glass-panel-button flex aspect-square h-full min-w-0 cursor-pointer items-center justify-center p-2 pointer-events-auto"
                  title="Abrir Menú"
                >
                  <img src="/logo.svg" alt="La operador" className="object-contain h-full w-full max-h-full max-w-full" />
                </button>
              </footer>
            </div>

            {/* Injected Audio Panel from Audience Screen */}
            {!isResultsSlide && (
              <div id="audience-audio-portal" className="flex items-end justify-center fixed bottom-[4vh] left-1/2 -translate-x-1/2 md:static md:translate-x-0 md:bottom-auto md:left-auto w-full md:w-auto z-[60] pointer-events-none"></div>
            )}
          </div>
        </div>
      )}

      {LiveAudioPresenter && (
        <Suspense fallback={null}>
          <LiveAudioPresenter />
        </Suspense>
      )}
    </div>
  );
};

export default PresenterScreen;

