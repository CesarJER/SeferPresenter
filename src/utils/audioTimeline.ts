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
  syncMode: AudioSyncMode;
  activeCueIndex: number;
  nextCueIndex: number;
  updatedBy: 'control' | 'presenter' | 'server';
}

export type AudioTimelineAction =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SEEK'; positionSec: number }
  | { type: 'SET_VOLUME'; volume: number }
  | { type: 'SET_RATE'; rate: number }
  | { type: 'SET_SYNC_MODE'; syncMode: AudioSyncMode }
  | { type: 'SET_TRACK'; presentationId: string | null; audioSrc: string | null; syncMapId: string | null }
  | { type: 'STOP' };

export function calcCurrentPositionSec(timeline: AudioTimelineState, nowMs: number): number {
  if (timeline.status !== 'playing') {
    return Math.max(0, timeline.basePositionSec);
  }
  const elapsedSec = (nowMs - timeline.baseServerTimeMs) / 1000;
  return Math.max(0, timeline.basePositionSec + elapsedSec * timeline.playbackRate);
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
        syncMode: action.syncMode,
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
        activeCueIndex: -1,
        nextCueIndex: -1,
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
