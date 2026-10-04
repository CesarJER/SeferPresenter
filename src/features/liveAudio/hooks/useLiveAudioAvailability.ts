import { useEffect, useState } from 'react';
import type { LiveAudioAvailability, LiveAudioStatusResponse } from '../../../types/liveAudio';

let cachedAvailability: LiveAudioAvailability | null = null;
let cachedAvailabilityExpiresAt = 0;
let pendingAvailability: Promise<LiveAudioAvailability> | null = null;

const isBrowserSupported = () =>
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  Boolean(navigator.mediaDevices) &&
  typeof RTCPeerConnection !== 'undefined';

const mapStatusToAvailability = (status: LiveAudioStatusResponse): LiveAudioAvailability => {
  if (!isBrowserSupported()) return 'unsupported';
  if (status.enabled === true && status.available === true) return 'enabled';
  if (status.reason && status.reason !== 'disabled') return 'misconfigured';
  return 'disabled';
};

export const getLiveAudioAvailability = async (): Promise<LiveAudioAvailability> => {
  if (cachedAvailability && Date.now() < cachedAvailabilityExpiresAt) return cachedAvailability;
  if (pendingAvailability) return pendingAvailability;

  let temporaryFailure = true;
  pendingAvailability = fetch('/api/livekit/status', { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) return 'misconfigured' as LiveAudioAvailability;
      const status = (await response.json()) as LiveAudioStatusResponse;
      temporaryFailure = status.enabled === true && status.available !== true;
      return mapStatusToAvailability(status);
    })
    .catch(() => 'misconfigured' as LiveAudioAvailability)
    .then((availability) => {
      cachedAvailability = availability;
      cachedAvailabilityExpiresAt = temporaryFailure ? Date.now() + 5000 : Number.POSITIVE_INFINITY;
      pendingAvailability = null;
      return availability;
    });

  return pendingAvailability;
};

export const resetLiveAudioAvailabilityCacheForTests = () => {
  cachedAvailability = null;
  cachedAvailabilityExpiresAt = 0;
  pendingAvailability = null;
};

export const useLiveAudioAvailability = () => {
  const [availability, setAvailability] = useState<LiveAudioAvailability>(
    cachedAvailability ?? (isBrowserSupported() ? 'disabled' : 'unsupported'),
  );
  const [isLoading, setIsLoading] = useState(cachedAvailability === null && isBrowserSupported());

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    if (!isBrowserSupported()) {
      setAvailability('unsupported');
      setIsLoading(false);
      return;
    }

    setIsLoading(cachedAvailability === null);
    const checkAvailability = () => {
      void getLiveAudioAvailability().then((nextAvailability) => {
        if (cancelled) return;
        setAvailability(nextAvailability);
        setIsLoading(false);
        if (nextAvailability === 'misconfigured' && Number.isFinite(cachedAvailabilityExpiresAt)) {
          retryTimer = setTimeout(checkAvailability, Math.max(5000, cachedAvailabilityExpiresAt - Date.now()));
        }
      });
    };
    checkAvailability();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, []);

  return { availability, isLoading };
};
