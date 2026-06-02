import React, { useState, useEffect } from 'react';
import type { Slide, VideoState } from '../../types/presentation';

interface VideoControlsProps {
  activeSlide: Slide;
  videoState: VideoState | null;
  onVideoStateChange: (state: VideoState | null) => void;
}

export const VideoControls: React.FC<VideoControlsProps> = ({
  activeSlide,
  videoState,
  onVideoStateChange
}) => {
  const [localTime, setLocalTime] = useState<number>(0);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);

  useEffect(() => {
    if (!isScrubbing) {
      if (videoState) {
        setLocalTime(videoState.currentTime);
      } else {
        setLocalTime(activeSlide?.videoStart ?? 0);
      }
    }
  }, [videoState?.currentTime, activeSlide?.id, isScrubbing]);

  if (activeSlide?.type !== 'video') return null;

  return (
    <div id="section-video-control" className="rounded-md border border-yellow-800/25 bg-yellow-950/10 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] font-black text-yellow-500 uppercase tracking-wider">Video</span>
        </div>
        <span className="text-[10px] font-black text-gray-400 truncate">
          {activeSlide.videoSrc?.split('/').pop() || 'Video'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            onVideoStateChange({
              isPlaying: !videoState?.isPlaying,
              currentTime: videoState?.currentTime ?? 0,
              duration: videoState?.duration ?? activeSlide.videoEnd ?? 0,
              volume: videoState?.volume ?? 0.8,
              speed: videoState?.speed ?? 1.0,
              loop: videoState?.loop ?? true,
              videoSrc: activeSlide.videoSrc || null,
              lastUpdatedBy: 'controller',
              timestamp: Date.now()
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

        <div className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/60 px-2 py-1">
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
                duration: videoState?.duration ?? activeSlide.videoEnd ?? 0,
                volume: parseFloat(e.target.value),
                speed: videoState?.speed ?? 1.0,
                loop: videoState?.loop ?? true,
                videoSrc: activeSlide.videoSrc || null,
                lastUpdatedBy: 'controller',
                timestamp: Date.now()
              });
            }}
            className="control-range w-16"
          />
        </div>

        <div className="flex items-center gap-1 rounded border border-gray-800 bg-gray-950/60 p-0.5">
          {[0.5, 1, 1.5, 2].map((speedVal) => (
            <button
              key={speedVal}
              type="button"
              onClick={() => {
                onVideoStateChange({
                  isPlaying: videoState?.isPlaying ?? false,
                  currentTime: videoState?.currentTime ?? 0,
                  duration: videoState?.duration ?? activeSlide.videoEnd ?? 0,
                  volume: videoState?.volume ?? 0.8,
                  speed: speedVal,
                  loop: videoState?.loop ?? true,
                  videoSrc: activeSlide.videoSrc || null,
                  lastUpdatedBy: 'controller',
                  timestamp: Date.now()
                });
              }}
              className={`rounded px-1.5 py-1 text-[9px] font-black ${((videoState?.speed ?? 1) === speedVal) ? 'bg-yellow-600 text-white' : 'text-gray-400 hover:text-gray-200'} cursor-pointer`}
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
              duration: videoState?.duration ?? activeSlide.videoEnd ?? 0,
              volume: videoState?.volume ?? 0.8,
              speed: videoState?.speed ?? 1.0,
              loop: !(videoState?.loop ?? true),
              videoSrc: activeSlide.videoSrc || null,
              lastUpdatedBy: 'controller',
              timestamp: Date.now()
            });
          }}
          className={`cursor-pointer rounded border px-2 py-1 text-[10px] font-black ${(videoState?.loop ?? true)
            ? 'bg-yellow-600/25 border-yellow-800 text-yellow-500'
            : 'bg-gray-950/60 border-gray-800 text-gray-500 hover:text-gray-300'
            }`}
        >
          BUCLE
        </button>

        <input
          type="range"
          min="0"
          max={videoState?.duration || activeSlide.videoEnd || 100}
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
              duration: videoState?.duration ?? activeSlide.videoEnd ?? 0,
              volume: videoState?.volume ?? 0.8,
              speed: videoState?.speed ?? 1.0,
              loop: videoState?.loop ?? true,
              videoSrc: activeSlide.videoSrc || null,
              lastUpdatedBy: 'controller',
              timestamp: Date.now()
            });
          }}
          className="control-range min-w-[160px] flex-1"
        />
      </div>
    </div>
  );
};
