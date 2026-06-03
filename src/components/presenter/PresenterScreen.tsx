import React, { useEffect, useState, useRef } from 'react';
import type { Slide, VideoState } from '../../types/presentation';
import { AnimatePresence, motion } from 'framer-motion';
import AutoResizeText from '../shared/AutoResizeText';

interface PresenterScreenProps {
  background: string;
  slide: Slide | null;
  presentationTitle: string;
  fontScale: number;
  onLogoClick: () => void;
  videoState: VideoState | null;
  onVideoStateChange: (state: VideoState | null) => void;
}

const PresenterScreen: React.FC<PresenterScreenProps> = ({
  background,
  slide,
  presentationTitle,
  fontScale,
  onLogoClick,
  videoState,
  onVideoStateChange
}) => {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  // Sync prop callback to a ref to avoid stale closures in event listeners/intervals
  const onVideoStateChangeRef = useRef(onVideoStateChange);
  useEffect(() => {
    onVideoStateChangeRef.current = onVideoStateChange;
  }, [onVideoStateChange]);

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

    // Apply Scrubbing Time (allow a tiny deviation buffer)
    if (Math.abs(videoElement.currentTime - videoState.currentTime) > 0.6) {
      videoElement.currentTime = videoState.currentTime;
    }

    // Apply Play/Pause
    if (videoState.isPlaying && videoElement.paused) {
      // Check if we are at the end (natural end or custom end)
      const endTime = slide?.videoEnd;
      const isAtEnd = videoElement.ended || (endTime !== undefined && videoElement.currentTime >= endTime);
      if (isAtEnd) {
        videoElement.currentTime = slide?.videoStart ?? 0;
      }
      videoElement.play().catch(err => console.error("Error auto-playing projection video:", err));
    } else if (!videoState.isPlaying && !videoElement.paused) {
      videoElement.pause();
    }
  }, [videoState, slide, videoElement]);

  // 2. Slide change listener: Setup dedicated slide video when slide transitions
  const videoSrc = slide?.type === 'video' ? slide.videoSrc : null;
  useEffect(() => {
    if (!videoElement || !slide || slide.type !== 'video' || !videoSrc) return;

    // Refresh media and apply default slide settings
    videoElement.load();
    const defaultVol = slide.videoVolume ?? 0.8;
    const defaultSpeed = slide.videoSpeed ?? 1.0;
    const defaultStart = slide.videoStart ?? 0;
    const defaultLoop = slide.videoLoop !== false;

    videoElement.volume = defaultVol;
    videoElement.playbackRate = defaultSpeed;
    videoElement.currentTime = defaultStart;
    videoElement.loop = defaultLoop;

    // Broadcast the initial video stats immediately
    onVideoStateChange({
      isPlaying: false,
      currentTime: defaultStart,
      duration: Number.isFinite(videoElement.duration) ? videoElement.duration : 0,
      volume: defaultVol,
      speed: defaultSpeed,
      loop: defaultLoop,
      videoSrc: videoSrc,
      startTime: slide.videoStart,
      endTime: slide.videoEnd,
      lastUpdatedBy: 'projection',
      timestamp: Date.now()
    });
  }, [
    onVideoStateChange,
    slide,
    videoSrc,
    slide?.id,
    slide?.videoEnd,
    slide?.videoLoop,
    slide?.videoSpeed,
    slide?.videoStart,
    slide?.videoVolume,
    videoElement,
  ]);

  // 3. Playback timeupdate & loadedmetadata event listeners for bidirectional telemetry
  useEffect(() => {
    if (!videoElement || !slide || slide.type !== 'video') return;

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
          videoSrc: slide.videoSrc || null,
          startTime: slide.videoStart,
          endTime: slide.videoEnd,
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

        const startTime = slide.videoStart ?? 0;
        const endTime = slide.videoEnd;

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
  }, [slide, videoSrc, slide?.id, slide?.videoSrc, slide?.videoStart, slide?.videoEnd, videoElement]);

  const isVideoBg = /\.(mp4|webm)$/i.test(background);
  const isFallback1x = slide?.lines.length === 3 && slide.lines[1] === '-' && slide.lines[2] === '-';
  const isTrilingual = slide?.lines.length === 3 && !isFallback1x;
  const slideLabel = slide?.label && slide.label !== 'Título' ? slide.label : '';
  const titleText = presentationTitle || slide?.label || '';
  const scaleStyle = { '--font-scale': fontScale } as React.CSSProperties;

  // Hiding overlays based on special image slide content ([IMAGE]) or dedicated video slides
  const isImageSlide = slide?.lines[0]?.trim() === '[IMAGE]';
  const isVideoSlide = slide?.type === 'video';
  const isPhotoSlide = isImageSlide;
  const presenterNavVisible = !(isVideoSlide || isPhotoSlide) || slide?.videoPresenterNav !== false;
  const hideLyricsOverlay = isPhotoSlide || isVideoSlide;

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950 text-white">
      <AnimatePresence mode="wait">
        <motion.div
          key={(slide?.type === 'video' ? slide.videoSrc : background) || 'empty-background'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="absolute inset-0"
        >
          {slide?.type === 'video' && slide.videoSrc ? (
            /* Dedicated Slide Video Player */
            <video
              ref={setVideoElement}
              src={slide.videoSrc}
              autoPlay
              loop={slide.videoLoop !== false}
              playsInline
              className="h-full w-full object-cover"
            />
          ) : background ? (
            isVideoBg ? (
              <video
                src={background}
                autoPlay
                loop
                muted
                playsInline
                className="h-full w-full object-cover"
              />
            ) : (
              <img src={background} alt="" className="h-full w-full object-cover" />
            )
          ) : (
            <div className="h-full w-full bg-[radial-gradient(circle_at_30%_20%,#29415f,#09111f_55%,#020617)]" />
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
          <div className="grid h-full w-[min(88vw,920px)] grid-rows-[minmax(0,1fr)_auto] gap-[3vh] lg:w-[min(58vw,920px)]">
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
            </main>

            <footer
              className={`group/nav grid h-[7vh] min-h-14 max-h-20 w-full grid-cols-[1.25fr_0.5fr_auto] gap-2 text-center font-bold transition-opacity duration-200 ${presenterNavVisible ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}
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
                className="glass-panel-button flex aspect-square h-full min-w-0 cursor-pointer items-center justify-center p-2"
                title="Abrir Menú"
              >
                <img src="/logo.svg" alt="La operador" className="object-contain h-full w-auto" />
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default PresenterScreen;

