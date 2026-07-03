import { useEffect, useRef, useState } from 'react';
import type { AutoduckState } from '../types/sync';

const clamp01 = (value: number) => Math.max(0, Math.min(value, 1));

/**
 * Hook to smoothly transition the volume of a media element.
 * @param mediaRef Reference to the HTMLMediaElement (audio or video).
 * @param baseVolume The desired base volume (0.0 to 1.0).
 * @param autoduckState The Autoduck state to apply ducking if active.
 * @param durationMs Duration of the transition in milliseconds.
 */
export function useSmoothVolume(
  mediaRef: React.RefObject<HTMLMediaElement | null>,
  baseVolume: number,
  autoduckState?: AutoduckState,
  durationMs: number = 300
) {
  const requestRef = useRef<number | null>(null);
  const targetVolumeRef = useRef(baseVolume);
  const [isDucking, setIsDucking] = useState(false);

  useEffect(() => {
    const handleAutoduck = (e: Event) => {
      const customEvent = e as CustomEvent<{ active?: boolean; isDuckingActive?: boolean }>;
      const active = customEvent.detail.active ?? customEvent.detail.isDuckingActive ?? false;
      setIsDucking(active);
    };

    window.addEventListener('sefer-autoduck', handleAutoduck);
    return () => window.removeEventListener('sefer-autoduck', handleAutoduck);
  }, []);

  useEffect(() => {
    const safeBaseVolume = Number.isFinite(baseVolume) ? clamp01(baseVolume) : 1;
    const rawFactor = autoduckState?.factor ?? 0.2;
    const safeFactor = Number.isFinite(rawFactor) ? clamp01(rawFactor) : 0.2;

    // Calculate actual target volume based on ducking state
    let finalTargetVolume = safeBaseVolume;
    if (autoduckState?.enabled && isDucking) {
      finalTargetVolume = safeBaseVolume * safeFactor;
    }

    targetVolumeRef.current = finalTargetVolume;
    const media = mediaRef.current;
    if (!media) return;

    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }

    const startVolume = media.volume;
    const delta = finalTargetVolume - startVolume;
    
    // If the difference is negligible or duration is 0, set immediately
    if (Math.abs(delta) < 0.01 || durationMs <= 0) {
      media.volume = finalTargetVolume;
      return;
    }

    const startTime = performance.now();

    const animateVolume = (time: number) => {
      if (!mediaRef.current) return;
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      
      // Simple linear interpolation
      const newVolume = startVolume + delta * progress;
      // Clamp between 0 and 1
      mediaRef.current.volume = Math.max(0, Math.min(newVolume, 1));

      if (progress < 1 && mediaRef.current.volume !== targetVolumeRef.current) {
        requestRef.current = requestAnimationFrame(animateVolume);
      } else {
        requestRef.current = null;
      }
    };

    requestRef.current = requestAnimationFrame(animateVolume);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [baseVolume, durationMs, mediaRef, autoduckState, isDucking]);
}
