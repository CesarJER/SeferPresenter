import { useEffect } from 'react';
import type { AudioTimelineState } from '../types/audio';

export function useAudioTimelineApplicator(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  timeline: AudioTimelineState | null,
  serverNow: () => number,
): void {
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !timeline) return;

    // 1. Source change
    if (timeline.audioSrc) {
      const encodedSrc = encodeURI(timeline.audioSrc);
      const targetUrl = window.location.origin + encodedSrc;
      const currentSrcDecoded = decodeURIComponent(audio.src);
      const targetUrlDecoded = decodeURIComponent(targetUrl);

      if (currentSrcDecoded !== targetUrlDecoded && audio.getAttribute('data-timeline-src') !== timeline.audioSrc) {
        audio.src = encodedSrc;
        audio.setAttribute('data-timeline-src', timeline.audioSrc);
        audio.load();
      }
    }

    // 2. Playing status
    if (timeline.status === 'playing' && audio.paused) {
      const pos = timeline.basePositionSec + (serverNow() - timeline.baseServerTimeMs) / 1000 * timeline.playbackRate;
      if (Math.abs(audio.currentTime - pos) > 0.3) {
        audio.currentTime = pos;
      }
      audio.play().catch(e => console.error("TimelineApplicator play error", e));
    } else if (timeline.status === 'paused' && !audio.paused) {
      // 3. Paused status
      audio.pause();
      if (Math.abs(audio.currentTime - timeline.basePositionSec) > 0.3) {
        audio.currentTime = timeline.basePositionSec;
      }
    }

    // 4. Volume
    if (Math.abs(audio.volume - timeline.volume) > 0.01) {
      audio.volume = timeline.volume;
    }

    // 5. Playback rate
    if (audio.playbackRate !== timeline.playbackRate) {
      audio.playbackRate = timeline.playbackRate;
    }
  }, [timeline, serverNow, audioRef]);
}
