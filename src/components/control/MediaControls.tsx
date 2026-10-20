import React, { useState, useEffect } from 'react';
import type { Slide, VideoState } from '../../types/presentation';
import type { AutoduckState } from '../../types/sync';
import { isImageMedia } from '../../utils/mediaUtils';
import { Mic, MicOff } from 'lucide-react';

interface MediaControlsProps {
  activeSlide: Slide;
  videoState: VideoState | null;
  onVideoStateChange: (state: VideoState | null) => void;
  autoduckState?: AutoduckState;
  onAutoduckStateChange?: (state: AutoduckState) => void;
}

const formatTime = (secs: number | undefined) => {
  if (secs === undefined || isNaN(secs)) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const MediaControls: React.FC<MediaControlsProps> = ({
  activeSlide,
  videoState,
  onVideoStateChange,
  autoduckState,
  onAutoduckStateChange,
}) => {
  const [localTime, setLocalTime] = useState<number>(0);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);

  useEffect(() => {
    if (!isScrubbing) {
      if (videoState) {
        setLocalTime(videoState.currentTime);
      } else {
        setLocalTime(activeSlide?.mediaStart ?? 0);
      }
    }
  }, [videoState, videoState?.currentTime, activeSlide?.id, activeSlide?.mediaStart, isScrubbing]);

  if (activeSlide?.type !== 'media' || isImageMedia(activeSlide.mediaSrc)) return null;

  return (
    <div id="section-video-control" className="rounded-md border border-yellow-800/25 bg-yellow-950/10 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] font-black text-yellow-500 uppercase tracking-wider">Video</span>
        </div>
        <span className="text-[10px] font-black text-gray-400 truncate">
          {activeSlide.mediaSrc?.split('/').pop() || 'Video'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            onVideoStateChange({
              isPlaying: !videoState?.isPlaying,
              currentTime: videoState?.currentTime ?? 0,
              duration: videoState?.duration ?? activeSlide.mediaEnd ?? 0,
              volume: videoState?.volume ?? 0.8,
              speed: videoState?.speed ?? 1.0,
              loop: videoState?.loop ?? true,
              mediaSrc: activeSlide.mediaSrc || null,
              lastUpdatedBy: 'controller',
              timestamp: Date.now(),
              seekId: videoState?.seekId
            });
          }}
          className="control-icon-btn h-8 w-8 rounded-full bg-yellow-600 text-white shadow-md hover:bg-yellow-500"
          title={videoState?.isPlaying ? 'Pausar video' : 'Reproducir video'}
        >
          {videoState?.isPlaying ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          ) : (
            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>

        {onAutoduckStateChange && (
          <button
            type="button"
            onClick={() => onAutoduckStateChange({
              enabled: !autoduckState?.enabled,
              factor: autoduckState?.factor ?? 0.2
            })}
            className={`control-icon-btn h-8 w-8 rounded-full shadow-md flex items-center justify-center ${
              autoduckState?.enabled
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700'
            }`}
            title={autoduckState?.enabled ? 'Autoduck Activado (Baja volumen al hablar)' : 'Activar Autoduck'}
          >
            {autoduckState?.enabled ? <Mic size={14} /> : <MicOff size={14} />}
          </button>
        )}

        <div className="flex items-center gap-2 rounded-sm border border-gray-800 bg-gray-950/60 px-2 py-1">
          <span className="text-[9px] font-black text-gray-500">VOL</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={videoState?.volume ?? 0.8}
            onChange={(e) => {
              onVideoStateChange({
                isPlaying: videoState?.isPlaying ?? false,
                currentTime: videoState?.currentTime ?? 0,
                duration: videoState?.duration ?? activeSlide.mediaEnd ?? 0,
                volume: parseFloat(e.target.value),
                speed: videoState?.speed ?? 1.0,
                loop: videoState?.loop ?? true,
                mediaSrc: activeSlide.mediaSrc || null,
                lastUpdatedBy: 'controller',
                timestamp: Date.now(),
                seekId: videoState?.seekId
              });
            }}
            className="control-range w-16"
          />
        </div>

        <div className="flex items-center gap-1 rounded-sm border border-gray-800 bg-gray-950/60 p-0.5">
          {[0.5, 1, 1.5, 2].map((speedVal) => (
            <button
              key={speedVal}
              type="button"
              onClick={() => {
                onVideoStateChange({
                  isPlaying: videoState?.isPlaying ?? false,
                  currentTime: videoState?.currentTime ?? 0,
                  duration: videoState?.duration ?? activeSlide.mediaEnd ?? 0,
                  volume: videoState?.volume ?? 0.8,
                  speed: speedVal,
                  loop: videoState?.loop ?? true,
                  mediaSrc: activeSlide.mediaSrc || null,
                  lastUpdatedBy: 'controller',
                  timestamp: Date.now(),
                  seekId: videoState?.seekId
                });
              }}
              className={`rounded-sm px-1.5 py-1 text-[9px] font-black ${((videoState?.speed ?? 1) === speedVal) ? 'bg-yellow-600 text-white' : 'text-gray-400 hover:text-gray-200'} cursor-pointer`}
            >
              {speedVal}x
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            onVideoStateChange({
              isPlaying: videoState?.isPlaying ?? false,
              currentTime: videoState?.currentTime ?? 0,
              duration: videoState?.duration ?? activeSlide.mediaEnd ?? 0,
              volume: videoState?.volume ?? 0.8,
              speed: videoState?.speed ?? 1.0,
              loop: !(videoState?.loop ?? true),
              mediaSrc: activeSlide.mediaSrc || null,
              lastUpdatedBy: 'controller',
              timestamp: Date.now(),
              seekId: videoState?.seekId
            });
          }}
          className={`cursor-pointer rounded border px-2 py-1 text-[10px] font-black ${(videoState?.loop ?? true)
            ? 'bg-yellow-600/25 border-yellow-800 text-yellow-500'
            : 'bg-gray-950/60 border-gray-800 text-gray-500 hover:text-gray-300'
            }`}
        >
          BUCLE
        </button>

        <div className="flex-1 flex items-center gap-2.5 min-w-[160px]">
          <span className="font-mono text-gray-400 text-[10px] shrink-0">
            {formatTime(localTime)}
          </span>
          <input
            type="range"
            min="0"
            max={videoState?.duration || activeSlide.mediaEnd || 100}
            step="0.1"
            value={localTime}
            onMouseDown={() => setIsScrubbing(true)}
            onTouchStart={() => setIsScrubbing(true)}
            onMouseUp={() => setIsScrubbing(false)}
            onTouchEnd={() => setIsScrubbing(false)}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setLocalTime(val);
              onVideoStateChange({
                isPlaying: videoState?.isPlaying ?? false,
                currentTime: val,
                duration: videoState?.duration ?? activeSlide.mediaEnd ?? 0,
                volume: videoState?.volume ?? 0.8,
                speed: videoState?.speed ?? 1.0,
                loop: videoState?.loop ?? true,
                mediaSrc: activeSlide.mediaSrc || null,
                lastUpdatedBy: 'controller',
                timestamp: Date.now(),
                seekId: (videoState?.seekId ?? 0) + 1
              });
            }}
            className="control-range-slim min-w-0 flex-1"
          />
          <span className="font-mono text-gray-400 text-[10px] shrink-0">
            {formatTime(videoState?.duration || activeSlide.mediaEnd || 0)}
          </span>
        </div>
      </div>
    </div>
  );
};
