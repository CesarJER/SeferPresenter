import { useEffect, useRef, useState } from 'react';
import type { AutoduckState } from '../types/sync';
import { getMediaOutputVolume, setMediaOutputVolume } from '../utils/mediaVolume';

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
  durationMs: number = 300,
  enabled: boolean = true,
) {
  const requestRef = useRef<number | null>(null);
  const targetVolumeRef = useRef(baseVolume);
  const isApplyingVolumeRef = useRef(false);
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
    if (!enabled) return;
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

    const outputTargetVolume = media.muted ? 0 : finalTargetVolume;

    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }

    const startVolume = getMediaOutputVolume(media);
    const delta = outputTargetVolume - startVolume;
    
    // If the difference is negligible or duration is 0, set immediately
    if (Math.abs(delta) < 0.01 || durationMs <= 0) {
      isApplyingVolumeRef.current = true;
      setMediaOutputVolume(media, outputTargetVolume);
      isApplyingVolumeRef.current = false;
      return;
    }

    const startTime = performance.now();

    const animateVolume = (time: number) => {
      if (!mediaRef.current) return;
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      
      // Simple linear interpolation
      const newVolume = startVolume + delta * progress;
      isApplyingVolumeRef.current = true;
      setMediaOutputVolume(mediaRef.current, newVolume);
      isApplyingVolumeRef.current = false;

      if (progress < 1 && Math.abs(getMediaOutputVolume(mediaRef.current) - outputTargetVolume) > 0.005) {
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
  }, [baseVolume, durationMs, mediaRef, autoduckState, isDucking, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const media = mediaRef.current;
    if (!media) return;

    const applyMutedState = () => {
      if (isApplyingVolumeRef.current) return;
      setMediaOutputVolume(media, media.muted ? 0 : targetVolumeRef.current);
    };

    applyMutedState();
    media.addEventListener('volumechange', applyMutedState);

    return () => {
      media.removeEventListener('volumechange', applyMutedState);
    };
  }, [enabled, mediaRef]);
}
