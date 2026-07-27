import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Eye } from 'lucide-react';
import type { Slide, ScriptureNavState, AppMode, VideoState } from '../../types/presentation';
import type { QuizSubslide } from '../../types/quiz';
import type { RemoteCommandPayload, AutoduckState } from '../../types/sync';
import { sanitizeSlideHtml } from '../../utils/hebrewText';
import { useSmoothVolume } from '../../hooks/useSmoothVolume';
import { findScriptureRange } from '../../utils/scriptureLookup';
import { isImageMedia } from '../../utils/mediaUtils';

interface SlideVisualizerProps {
  slide: Slide | null;
  appMode: AppMode;
  scriptureState: ScriptureNavState | null;
  quizSubslide?: QuizSubslide;
  children?: React.ReactNode;
  videoState?: VideoState | null;
  onVideoStateChange?: (state: VideoState | null) => void;
  isMediaMaster?: boolean;
  emitVideoTelemetry?: (state: VideoState) => void;
  emitCommand?: (payload: RemoteCommandPayload) => void;
  autoduckState?: AutoduckState;
}

const containsHebrew = (text: string): boolean => {
  return /[\u0590-\u05FF]/.test(text);
};

const SlideVisualizer: React.FC<SlideVisualizerProps> = ({
  slide,
  appMode,
  scriptureState,
  quizSubslide,
  children,
  videoState,
  isMediaMaster,
  emitVideoTelemetry,
  autoduckState,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [quizVerseLines, setQuizVerseLines] = useState<string[]>([]);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const lastSeekIdRef = React.useRef<number | undefined>(undefined);

  useSmoothVolume(videoRef, videoState?.volume ?? 1.0, autoduckState);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = !isMediaMaster;
    }
  }, [isMediaMaster]);

  // 1. Listen to incoming videoState (from controller or projection)
  useEffect(() => {
    if (!videoRef.current || slide?.type !== 'media' || !videoState) return;

    const vid = videoRef.current;

    // If we are the Master, we ONLY apply state if it comes from the controller explicitly
    if (isMediaMaster && videoState.lastUpdatedBy !== 'controller') return;

    if (vid.playbackRate !== (videoState.speed ?? 1.0)) {
      vid.playbackRate = videoState.speed ?? 1.0;
    }
    
    if (videoState.loop !== undefined && vid.loop !== videoState.loop) {
      vid.loop = videoState.loop;
    }

    // Volume is handled by useSmoothVolume
    // if (videoState.volume !== undefined && vid.volume !== videoState.volume) {
    //   vid.volume = videoState.volume;
    // }

    // Apply Scrubbing Time (ONLY if requested a seek via seekId, or if slave and out of sync)
    const shouldSeek = isMediaMaster 
      ? (videoState.seekId !== undefined && videoState.seekId !== lastSeekIdRef.current)
      : Math.abs(vid.currentTime - videoState.currentTime) > 0.6;

    if (shouldSeek) {
      if (Math.abs(vid.currentTime - videoState.currentTime) > 0.6) {
        vid.currentTime = videoState.currentTime;
      }
      if (isMediaMaster) lastSeekIdRef.current = videoState.seekId;
    }

    if (videoState.isPlaying && vid.paused) {
      vid.play().catch(() => {});
    } else if (!videoState.isPlaying && !vid.paused) {
      vid.pause();
    }
  }, [videoState, slide, isMediaMaster]);

  // 2. Media Master Mode: loop logic and telemetry emission
  useEffect(() => {
    if (!videoRef.current || slide?.type !== 'media' || !isMediaMaster) return;

    const vid = videoRef.current;

    // Ensure it starts playing if it's the first time and we have no state, or if we just mounted
    // but only if videoState doesn't explicitly say isPlaying: false.
    // Actually, we rely on the above useEffect to handle play/pause if videoState exists.
    // If no videoState yet, we auto-play.
    if (!videoState && vid.paused) {
      vid.play().catch(() => {});
    }

    const emitTelemetry = () => {
      if (!emitVideoTelemetry) return;
      emitVideoTelemetry({
        isPlaying: !vid.paused,
        currentTime: vid.currentTime,
        duration: Number.isFinite(vid.duration) ? vid.duration : 0,
        volume: videoState?.volume ?? slide.mediaVolume ?? 1.0,
        speed: vid.playbackRate,
        loop: vid.loop,
        mediaSrc: slide.mediaSrc || null,
        startTime: slide.mediaStart,
        endTime: slide.mediaEnd,
        lastUpdatedBy: 'projection',
        timestamp: Date.now()
      });
    };

    const intervalId = setInterval(() => {
      if (!vid) return;

      const startTime = slide.mediaStart ?? 0;
      const endTime = slide.mediaEnd;

      if (endTime && vid.currentTime >= endTime) {
        if (slide.mediaLoop !== false) {
          vid.currentTime = startTime;
          vid.play().catch(() => {});
        } else {
          vid.pause();
        }
      } else if (vid.currentTime < startTime) {
        vid.currentTime = startTime;
      }

      emitTelemetry();
    }, 250);

    const handleEnded = () => {
      emitTelemetry();
    };

    vid.addEventListener('play', emitTelemetry);
    vid.addEventListener('pause', emitTelemetry);
    vid.addEventListener('seeked', emitTelemetry);
    vid.addEventListener('ended', handleEnded);

    return () => {
      clearInterval(intervalId);
      vid.removeEventListener('play', emitTelemetry);
      vid.removeEventListener('pause', emitTelemetry);
      vid.removeEventListener('seeked', emitTelemetry);
      vid.removeEventListener('ended', handleEnded);
    };
  }, [slide, isMediaMaster, emitVideoTelemetry, videoState]);

  // Auto expand when switching to scripture mode
  useEffect(() => {
    if (appMode === 'scripture') {
      setIsCollapsed(false);
    }
  }, [appMode]);

  // Fetch quiz verse content if needed
  useEffect(() => {
    if (slide?.type === 'quiz' && quizSubslide?.kind === 'cita-verse' && quizSubslide.bookToken && quizSubslide.chapter && quizSubslide.verse) {
      findScriptureRange(quizSubslide.bookToken, quizSubslide.chapter, quizSubslide.verse)
        .then(verses => {
          if (verses && verses.length > 0) {
            const v = verses[0];
            setQuizVerseLines([
              v.verseNikud || '',
              v.transliteration || '',
              v.translation || ''
            ]);
          } else {
            setQuizVerseLines([]);
          }
        })
        .catch(err => {
          console.error("Error fetching quiz verse", err);
          setQuizVerseLines([]);
        });
    } else {
      setQuizVerseLines([]);
    }
  }, [slide, quizSubslide]);

  // If in manual mode, the manual control panel handles its own visualizer
  if (appMode === 'seferManual') {
    return null;
  }

  // Determine lines to display
  let lines: string[] = [];
  let labelText = '';

  let hideTextBlocks = false;

  if (appMode === 'scripture' && scriptureState) {
    lines = [
      scriptureState.verseNikud || '',
      scriptureState.transliteration || '',
      scriptureState.translation || '',
    ];
    labelText = `${scriptureState.bookAbbrevEs || scriptureState.bookEs} ${scriptureState.chapter}:${scriptureState.verse}`;
  } else if (slide?.type === 'quiz') {
    if (quizSubslide?.kind === 'cita-verse') {
      lines = quizVerseLines;
      labelText = quizSubslide.label || '';
    } else {
      hideTextBlocks = true;
      labelText = slide.label || '';
    }
  } else if (slide) {
    lines = slide.lines || [];
    labelText = slide.label || '';
    if (slide.type === 'media' || lines[0]?.trim() === '[IMAGE]' || lines[0]?.trim() === '[MEDIA]') {
      hideTextBlocks = true;
    }
  }

  const isMediaSlide = slide?.type === 'media' || slide?.lines?.[0]?.trim() === '[IMAGE]' || slide?.lines?.[0]?.trim() === '[MEDIA]';
  const hasContent = (lines.length > 0 && lines.some(l => l && l.trim() !== '' && l.trim() !== '-')) || !!children || isMediaSlide;

  if (!hasContent) {
    return (
      <div className="px-4 py-2 text-xs text-gray-500 italic bg-gray-950/40 border-b border-gray-800 text-center">
        No hay diapositiva o versículo proyectado
      </div>
    );
  }

  const line0 = lines[0] || '';
  const safeLine0 = sanitizeSlideHtml(line0);
  const line1 = lines[1] || '';
  const line2 = lines[2] || '';

  const isFallback1x = lines.length === 3 && line1 === '-' && line2 === '-';
  const isTrilingual = lines.length === 3 && !isFallback1x && (line1.trim() !== '' || line2.trim() !== '');

  // Detect direction of the first line (Hebrew vs Greek/Latin)
  const isRtl = containsHebrew(line0);
  const textDir = isRtl ? 'rtl' : 'ltr';
  const textAlignment = isRtl ? 'text-right' : 'text-left';

  return (
    <div id="section-slide-visualizer" className="bg-gray-950/80 border-b border-gray-800 flex flex-col transition-all">
      {/* Header / Toggle Panel */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900/40 text-[11px] font-bold text-gray-400 border-b border-gray-800/40 select-none">
        <div className="flex items-center gap-1.5">
          <Eye size={12} className="text-yellow-500" />
          <span>PREVISUALIZACIÓN DE PROYECCIÓN</span>
          {labelText && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-800 text-yellow-400 font-mono">
              {labelText}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 rounded hover:bg-gray-800 hover:text-white transition-colors cursor-pointer"
          title={isCollapsed ? "Expandir previsualización" : "Colapsar previsualización"}
        >
          {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {/* Main View Area */}
      {!isCollapsed && (
        <div className={`p-2.5 md:p-3 relative overflow-hidden ${slide?.type === 'media' && slide.mediaSrc ? 'min-h-[10rem]' : 'min-h-[60px]'}`}>
          {slide?.type === 'media' && slide.mediaSrc && isImageMedia(slide.mediaSrc) && (
            <img src={slide.mediaSrc} className={`absolute inset-0 w-full h-full object-contain z-0`} alt="" />
          )}
          {slide?.type === 'media' && slide.mediaSrc && !isImageMedia(slide.mediaSrc) && (
            <video 
              ref={videoRef} 
              src={slide.mediaSrc} 
              muted={!isMediaMaster} 
              playsInline 
              preload="metadata"
              className={`absolute inset-0 w-full h-full object-contain z-0`} 
              onLoadedMetadata={() => {
                if (isMediaMaster && videoRef.current) {
                  videoRef.current.volume = slide.mediaVolume ?? 1.0;
                }
              }}
            />
          )}

          <div className="relative z-10">
            {!hideTextBlocks && (
              isTrilingual ? (
                <div className="rounded-lg bg-gray-900/60 border border-gray-800/60 p-2.5 space-y-2">
                  {/* Line 0 (Hebrew/Greek) */}
                  <div
                    dir={textDir}
                    lang={isRtl ? 'he' : undefined}
                    className={`text-sm md:text-base leading-relaxed text-[#f3c96a] font-bold ${textAlignment}`}
                    style={{ fontFamily: isRtl ? "'Frank Ruhl Libre', 'SBL Hebrew', serif" : 'inherit' }}
                    dangerouslySetInnerHTML={{ __html: safeLine0 }}
                  />

                  {/* Transliteration & Translation */}
                  <div className="flex flex-col gap-1 mt-1.5 pt-1.5 border-t border-gray-800/60 text-xs">
                    {line1 && line1 !== '-' && (
                      <p className="text-sky-300 leading-relaxed">
                        {line1}
                      </p>
                    )}
                    {line2 && line2 !== '-' && (
                      <p className="text-gray-300 leading-relaxed">
                        {line2}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                /* Monolingual View - Shows only line 0 */
                <div className="rounded-lg bg-gray-900/60 border border-gray-800/60 p-2.5">
                  <div
                    dir={textDir}
                    lang={isRtl ? 'he' : undefined}
                    className={`text-sm md:text-base leading-relaxed text-white font-bold ${textAlignment}`}
                    style={{ fontFamily: isRtl ? "'Frank Ruhl Libre', 'SBL Hebrew', serif" : 'inherit' }}
                    dangerouslySetInnerHTML={{ __html: safeLine0 }}
                  />
                </div>
              )
            )}
            {children}
          </div>
        </div>
      )}
    </div>
  );
};

export default SlideVisualizer;
