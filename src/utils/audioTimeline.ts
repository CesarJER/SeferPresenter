import type { AudioSyncMode, AudioSyncCue } from '../types/audio';

export interface AudioTimelineState {
  timelineId: string;
  version: number;
  presentationId: string | null;
  audioSrc: string | null;
  syncMapId: string | null;
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended';
  basePositionSec: number;
  baseServerTimeMs: number;
  playbackRate: number;
  volume: number;
  durationSec: number | null;
  loop: boolean;
  syncMode: AudioSyncMode;
  activeCueIndex: number | null;
  nextCueIndex: number | null;
  updatedBy: 'control' | 'presenter' | 'server';
}

export type AudioTimelineAction =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SEEK'; positionSec: number }
  | { type: 'SET_VOLUME'; volume: number }
  | { type: 'SET_RATE'; rate: number }
  | { type: 'SET_DURATION'; durationSec: number | null }
  | { type: 'SET_LOOP'; loop: boolean }
  | { type: 'SET_SYNC_MODE'; syncMode?: AudioSyncMode; mode?: AudioSyncMode; syncMapId?: string | null; presentationId?: string | null }
  | { type: 'END'; positionSec?: number }
  | { type: 'SET_TRACK'; presentationId: string | null; audioSrc: string | null; syncMapId: string | null }
  | { type: 'STOP' };

function normalizeTimelinePosition(positionSec: number, durationSec: number | null, loop: boolean): number {
  const safePositionSec = Math.max(0, positionSec);
  if (!Number.isFinite(durationSec) || durationSec === null || durationSec <= 0) return safePositionSec;
  if (loop) return safePositionSec % durationSec;
  return Math.min(safePositionSec, durationSec);
}

export function calcCurrentPositionSec(timeline: AudioTimelineState, nowMs: number): number {
  if (timeline.status !== 'playing') {
    return normalizeTimelinePosition(timeline.basePositionSec, timeline.durationSec, timeline.loop);
  }
  const elapsedSec = (nowMs - timeline.baseServerTimeMs) / 1000;
  return normalizeTimelinePosition(
    timeline.basePositionSec + elapsedSec * timeline.playbackRate,
    timeline.durationSec,
    timeline.loop,
  );
}

export type AudioTimelineCorrectionAction = 'none' | 'nudge' | 'seek';

export interface AudioTimelineCorrectionInput {
  audioCurrentTimeSec: number;
  timelineBasePositionSec: number;
  timelineBaseServerTimeMs: number;
  timelinePlaybackRate: number;
  timelineDurationSec?: number | null;
  timelineLoop?: boolean;
  nowMs: number;
  nudgeThresholdSec?: number;
  seekThresholdSec?: number;
  maxRateNudge?: number;
}

export interface AudioTimelineCorrection {
  expectedPositionSec: number;
  driftSec: number;
  action: AudioTimelineCorrectionAction;
  playbackRate: number;
  seekPositionSec?: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function computeAudioTimelineCorrection({
  audioCurrentTimeSec,
  timelineBasePositionSec,
  timelineBaseServerTimeMs,
  timelinePlaybackRate,
  timelineDurationSec = null,
  timelineLoop = false,
  nowMs,
  nudgeThresholdSec = 0.12,
  seekThresholdSec = 0.65,
  maxRateNudge = 0.08,
}: AudioTimelineCorrectionInput): AudioTimelineCorrection {
  const baseRate = Number.isFinite(timelinePlaybackRate) && timelinePlaybackRate > 0
    ? timelinePlaybackRate
    : 1;
  const safeBasePosition = Number.isFinite(timelineBasePositionSec)
    ? Math.max(0, timelineBasePositionSec)
    : 0;
  const safeBaseServerTime = Number.isFinite(timelineBaseServerTimeMs)
    ? timelineBaseServerTimeMs
    : nowMs;
  const safeAudioPosition = Number.isFinite(audioCurrentTimeSec)
    ? Math.max(0, audioCurrentTimeSec)
    : 0;
  const elapsedSec = Math.max(0, (nowMs - safeBaseServerTime) / 1000);
  const expectedPositionSec = normalizeTimelinePosition(
    safeBasePosition + elapsedSec * baseRate,
    timelineDurationSec,
    timelineLoop,
  );
  const driftSec = expectedPositionSec - safeAudioPosition;
  const absDriftSec = Math.abs(driftSec);

  if (absDriftSec >= seekThresholdSec) {
    return {
      expectedPositionSec,
      driftSec,
      action: 'seek',
      playbackRate: baseRate,
      seekPositionSec: expectedPositionSec,
    };
  }

  if (absDriftSec >= nudgeThresholdSec) {
    const rateNudge = clamp(driftSec * 0.1, -maxRateNudge, maxRateNudge);
    return {
      expectedPositionSec,
      driftSec,
      action: 'nudge',
      playbackRate: clamp(baseRate + rateNudge, 0.25, 4),
    };
  }

  return {
    expectedPositionSec,
    driftSec,
    action: 'none',
    playbackRate: baseRate,
  };
}

export function calcActiveCueIndex(positionSec: number, cues: AudioSyncCue[]): number {
  if (!cues || cues.length === 0) return -1;
  let activeCueIdx = -1;
  for (let i = cues.length - 1; i >= 0; i--) {
    if (positionSec >= cues[i].timeSec) {
      activeCueIdx = i;
      break;
    }
  }
  return activeCueIdx;
}

export function applyTimelineAction(
  timeline: AudioTimelineState,
  action: AudioTimelineAction,
  serverTimeMs: number,
  updatedBy: AudioTimelineState['updatedBy'] = 'control'
): AudioTimelineState {
  const currentPos = calcCurrentPositionSec(timeline, serverTimeMs);
  
  switch (action.type) {
    case 'PLAY':
      return {
        ...timeline,
        version: timeline.version + 1,
        status: 'playing',
        basePositionSec: currentPos,
        baseServerTimeMs: serverTimeMs,
        updatedBy
      };
      
    case 'PAUSE':
      return {
        ...timeline,
        version: timeline.version + 1,
        status: 'paused',
        basePositionSec: currentPos,
        baseServerTimeMs: serverTimeMs,
        updatedBy
      };

    case 'SEEK':
      return {
        ...timeline,
        version: timeline.version + 1,
        basePositionSec: Math.max(0, action.positionSec),
        baseServerTimeMs: serverTimeMs,
        updatedBy
      };

    case 'SET_VOLUME':
      return {
        ...timeline,
        version: timeline.version + 1,
        volume: Math.max(0, Math.min(1, action.volume)),
        updatedBy
      };

    case 'SET_DURATION':
      return {
        ...timeline,
        version: timeline.version + 1,
        durationSec: Number.isFinite(action.durationSec) && action.durationSec !== null && action.durationSec > 0
          ? action.durationSec
          : null,
        updatedBy
      };

    case 'SET_LOOP':
      return {
        ...timeline,
        version: timeline.version + 1,
        loop: action.loop,
        updatedBy
      };

    case 'SET_RATE':
      return {
        ...timeline,
        version: timeline.version + 1,
        playbackRate: action.rate,
        basePositionSec: currentPos,
        baseServerTimeMs: serverTimeMs,
        updatedBy
      };

    case 'SET_SYNC_MODE':
      return {
        ...timeline,
        version: timeline.version + 1,
        syncMode: action.syncMode ?? action.mode ?? 'none',
        updatedBy
      };

    case 'SET_TRACK':
      return {
        ...timeline,
        version: timeline.version + 1,
        presentationId: action.presentationId,
        audioSrc: action.audioSrc,
        syncMapId: action.syncMapId,
        status: action.audioSrc ? 'loading' : 'idle',
        basePositionSec: 0,
        baseServerTimeMs: serverTimeMs,
        durationSec: null,
        loop: false,
        activeCueIndex: -1,
        nextCueIndex: -1,
        updatedBy
      };

    case 'END':
      return {
        ...timeline,
        version: timeline.version + 1,
        status: 'ended',
        basePositionSec: Number.isFinite(action.positionSec)
          ? Math.max(0, action.positionSec ?? 0)
          : currentPos,
        baseServerTimeMs: serverTimeMs,
        updatedBy
      };

    case 'STOP':
      return {
        ...timeline,
        version: timeline.version + 1,
        status: 'idle',
        basePositionSec: 0,
        baseServerTimeMs: serverTimeMs,
        activeCueIndex: -1,
        nextCueIndex: -1,
        updatedBy
      };

    default:
      return timeline;
  }
}

export function estimateClientOffset(pingMs: number, pongMs: number, serverMs: number): number {
  const rtt = pongMs - pingMs;
  const serverTimeAtClientReceipt = serverMs + (rtt / 2);
  return serverTimeAtClientReceipt - pongMs;
}
