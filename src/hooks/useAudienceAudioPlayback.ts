import { useEffect, useRef } from 'react';
import type { AudioState } from '../types/audio';
import type { AutoduckState } from '../types/sync';
import { isMediaPlaybackBlockedError } from '../utils/mediaVolume';
import { useSmoothVolume } from './useSmoothVolume';

interface UseAudienceAudioPlaybackProps {
  audioState: AudioState;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  autoduckState?: AutoduckState;
  onPlaybackBlocked?: (blocked: boolean) => void;
}

export function useAudienceAudioPlayback(props: UseAudienceAudioPlaybackProps) {
  const { audioState, audioRef, autoduckState, onPlaybackBlocked } = props;
  const isPerformingSeekRef = useRef<boolean>(false);

  useSmoothVolume(audioRef, audioState.volume, autoduckState);

  // 1. Load/change source
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audioState.audioSrc) {
      const encodedSrc = encodeURI(audioState.audioSrc);
      const targetUrl = window.location.origin + encodedSrc;

      const currentSrcDecoded = decodeURIComponent(audio.src);
      const targetUrlDecoded = decodeURIComponent(targetUrl);

      if (currentSrcDecoded !== targetUrlDecoded && audio.getAttribute('data-src') !== audioState.audioSrc) {
        audio.src = encodedSrc;
        audio.setAttribute('data-src', audioState.audioSrc);
        audio.load();
      }
    } else {
      audio.pause();
      audio.removeAttribute('src');
      audio.setAttribute('data-src', '');
    }
  }, [audioState.audioSrc, audioRef]);

  // 2. Sync playback state and time from telemetry
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioState.audioSrc) return;

    // Volume is handled by useSmoothVolume
    // if (audio.volume !== audioState.volume) {
    //   audio.volume = audioState.volume;
    // }

    // Attempt to keep time synchronized. Skip if currently seeking to avoid judder.
    if (!isPerformingSeekRef.current && Math.abs(audio.currentTime - audioState.currentTime) > 0.8) {
      isPerformingSeekRef.current = true;
      audio.currentTime = audioState.currentTime;

      const handleSeeked = () => {
        isPerformingSeekRef.current = false;
        audio.removeEventListener('seeked', handleSeeked);
      };
      audio.addEventListener('seeked', handleSeeked);

      // Fallback to clear the flag in case seeked doesn't fire
      setTimeout(() => {
        if (isPerformingSeekRef.current) {
          isPerformingSeekRef.current = false;
          audio.removeEventListener('seeked', handleSeeked);
        }
      }, 500);
    }

    // Apply play/pause state
    if (audioState.isPlaying && audio.paused) {
      audio.play().then(() => {
        onPlaybackBlocked?.(false);
      }).catch((err) => {
        if (isMediaPlaybackBlockedError(err)) {
          onPlaybackBlocked?.(true);
        }
        console.error('[Audience] Error playing audio (autoplay policy may block this):', err);
      });
    } else if (!audioState.isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [audioState.isPlaying, audioState.currentTime, audioState.volume, audioState.audioSrc, audioRef, onPlaybackBlocked]);
}
