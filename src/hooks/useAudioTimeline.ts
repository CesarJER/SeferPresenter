import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioTimelineState, AudioTimelineAction } from '../types/audio';

export interface UseAudioTimelineResult {
  estimatedPositionSec: number;
  timeline: AudioTimelineState | null;
  dispatchAction: (action: AudioTimelineAction) => void;
}

export function useAudioTimeline(
  timeline: AudioTimelineState | null,
  serverNow: () => number,
  sendMessage: (type: string, payload?: Record<string, unknown>) => boolean,
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

    let reqId: number;
    const updatePosition = () => {
      const pos = timeline.basePositionSec + (serverNow() - timeline.baseServerTimeMs) / 1000 * timeline.playbackRate;
      setEstimatedPositionSec(pos);
      reqId = requestAnimationFrame(updatePosition);
    };

    reqId = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(reqId);
  }, [timeline, serverNow]);

  const dispatchAction = useCallback((action: AudioTimelineAction) => {
    sendMessageRef.current('AUDIO_TIMELINE_ACTION', { action } as unknown as Record<string, unknown>);
  }, []);

  return { estimatedPositionSec, timeline, dispatchAction };
}
