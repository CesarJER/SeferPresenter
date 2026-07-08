import { useEffect } from 'react';
import type { AudioTimelineState } from '../types/audio';
import type { AutoduckState } from '../types/sync';
import { computeAudioTimelineCorrection } from '../utils/audioTimeline';
import { isMediaPlaybackBlockedError } from '../utils/mediaVolume';
import { useSmoothVolume } from './useSmoothVolume';

const INITIAL_SEEK_THRESHOLD_SEC = 0.3;
const DRIFT_CHECK_INTERVAL_MS = 250;
const PLAY_RETRY_INTERVAL_MS = 2000;

const seekAudio = (audio: HTMLAudioElement, positionSec: number): void => {
  if (!Number.isFinite(positionSec)) return;

  const safePositionSec = Math.max(0, positionSec);
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime = Math.min(safePositionSec, audio.duration);
    return;
  }

  audio.currentTime = safePositionSec;
};

const applyPlaybackRate = (audio: HTMLAudioElement, playbackRate: number): void => {
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) return;
  if (Math.abs(audio.playbackRate - playbackRate) > 0.005) {
    audio.playbackRate = playbackRate;
  }
};

const playTimelineAudio = (
  audio: HTMLAudioElement,
  logErrors: boolean,
  onPlaybackBlocked?: (blocked: boolean) => void,
): void => {
  audio.play().then(() => {
    onPlaybackBlocked?.(false);
  }).catch(error => {
    if (isMediaPlaybackBlockedError(error)) {
      onPlaybackBlocked?.(true);
    }
    if (logErrors) {
      console.error('TimelineApplicator play error', error);
    }
  });
};

interface AudioTimelineApplicatorOptions {
  onDurationChange?: (durationSec: number | null) => void;
  onEnded?: (positionSec: number) => void;
  onPlaybackBlocked?: (blocked: boolean) => void;
}

const defaultAudioTimelineApplicatorOptions: AudioTimelineApplicatorOptions = {};

export function useAudioTimelineApplicator(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  timeline: AudioTimelineState | null,
  serverNow: () => number,
  autoduckState?: AutoduckState,
  options: AudioTimelineApplicatorOptions = defaultAudioTimelineApplicatorOptions,
): void {
  useSmoothVolume(audioRef, timeline?.volume ?? 1, autoduckState);

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
    } else {
      audio.pause();
      audio.loop = false;
      audio.removeAttribute('src');
      audio.setAttribute('data-timeline-src', '');
      audio.load();
      return;
    }

    audio.loop = timeline.loop;

    // 2. Playback status
    if (timeline.status === 'playing') {
      const correction = computeAudioTimelineCorrection({
        audioCurrentTimeSec: audio.currentTime,
        timelineBasePositionSec: timeline.basePositionSec,
        timelineBaseServerTimeMs: timeline.baseServerTimeMs,
        timelinePlaybackRate: timeline.playbackRate,
        timelineDurationSec: timeline.durationSec,
        timelineLoop: timeline.loop,
        nowMs: serverNow(),
        nudgeThresholdSec: INITIAL_SEEK_THRESHOLD_SEC,
        seekThresholdSec: INITIAL_SEEK_THRESHOLD_SEC,
      });

      if (correction.action === 'seek' && correction.seekPositionSec !== undefined) {
        seekAudio(audio, correction.seekPositionSec);
      }

      if (audio.paused) {
        playTimelineAudio(audio, true, options.onPlaybackBlocked);
      }
    } else if (timeline.status === 'paused') {
      // 3. Paused status
      if (!audio.paused) {
        audio.pause();
      }
      if (Math.abs(audio.currentTime - timeline.basePositionSec) > 0.3) {
        seekAudio(audio, timeline.basePositionSec);
      }
    } else if ((timeline.status === 'idle' || timeline.status === 'ended') && !audio.paused) {
      audio.pause();
    }

    // 4. Playback rate
    applyPlaybackRate(audio, timeline.playbackRate);
  }, [timeline, serverNow, audioRef, options]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !timeline?.audioSrc || timeline.status !== 'playing') return;

    let lastPlayAttemptMs = 0;

    const correctLocalPlayback = () => {
      const correction = computeAudioTimelineCorrection({
        audioCurrentTimeSec: audio.currentTime,
        timelineBasePositionSec: timeline.basePositionSec,
        timelineBaseServerTimeMs: timeline.baseServerTimeMs,
        timelinePlaybackRate: timeline.playbackRate,
        timelineDurationSec: timeline.durationSec,
        timelineLoop: timeline.loop,
        nowMs: serverNow(),
      });

      if (correction.action === 'seek' && correction.seekPositionSec !== undefined) {
        seekAudio(audio, correction.seekPositionSec);
      }
      applyPlaybackRate(audio, correction.playbackRate);

      if (audio.paused) {
        const nowClientMs = Date.now();
        if (nowClientMs - lastPlayAttemptMs >= PLAY_RETRY_INTERVAL_MS) {
          lastPlayAttemptMs = nowClientMs;
          playTimelineAudio(audio, false, options.onPlaybackBlocked);
        }
      }
    };

    correctLocalPlayback();
    const intervalId = setInterval(correctLocalPlayback, DRIFT_CHECK_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      applyPlaybackRate(audio, timeline.playbackRate);
    };
  }, [
    audioRef,
    timeline?.audioSrc,
    timeline?.basePositionSec,
    timeline?.baseServerTimeMs,
    timeline?.durationSec,
    timeline?.loop,
    timeline?.playbackRate,
    timeline?.status,
    timeline?.timelineId,
    serverNow,
    options,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !timeline?.audioSrc) return;

    const reportDuration = () => {
      options.onDurationChange?.(
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null,
      );
    };

    const reportEnded = () => {
      if (audio.loop || timeline.loop) return;
      options.onEnded?.(
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : audio.currentTime,
      );
    };

    reportDuration();
    audio.addEventListener('loadedmetadata', reportDuration);
    audio.addEventListener('durationchange', reportDuration);
    audio.addEventListener('ended', reportEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', reportDuration);
      audio.removeEventListener('durationchange', reportDuration);
      audio.removeEventListener('ended', reportEnded);
    };
  }, [
    audioRef,
    options,
    timeline?.audioSrc,
    timeline?.loop,
    timeline?.timelineId,
  ]);
}
