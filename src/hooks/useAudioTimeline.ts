import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioTimelineState, AudioTimelineAction } from '../types/audio';
import { calcCurrentPositionSec } from '../utils/audioTimeline';

export interface UseAudioTimelineResult {
  estimatedPositionSec: number;
  timeline: AudioTimelineState | null;
  dispatchAction: (action: AudioTimelineAction) => void;
}

export function useAudioTimeline(
  timeline: AudioTimelineState | null,
  serverNow: () => number,
  sendMessage: (type: string, payload?: Record<string, unknown>) => boolean,
  trackEstimatedPosition = true,
): UseAudioTimelineResult {
  const [estimatedPositionSec, setEstimatedPositionSec] = useState(timeline?.basePositionSec ?? 0);
  const sendMessageRef = useRef(sendMessage);
  
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  useEffect(() => {
    if (!timeline) {
      setEstimatedPositionSec(0);
      return;
    }

    if (timeline.status !== 'playing') {
      setEstimatedPositionSec(timeline.basePositionSec);
      return;
    }

    if (!trackEstimatedPosition) {
      setEstimatedPositionSec(timeline.basePositionSec);
      return;
    }

    const updatePosition = () => {
      setEstimatedPositionSec(calcCurrentPositionSec(timeline, serverNow()));
    };

    updatePosition();
    const intervalId = window.setInterval(updatePosition, 250);
    return () => window.clearInterval(intervalId);
  }, [timeline, serverNow, trackEstimatedPosition]);

  const dispatchAction = useCallback((action: AudioTimelineAction) => {
    sendMessageRef.current('AUDIO_TIMELINE_ACTION', { action } as unknown as Record<string, unknown>);
  }, []);

  return { estimatedPositionSec, timeline, dispatchAction };
}
