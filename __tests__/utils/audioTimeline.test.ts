import { describe, it, expect } from 'vitest';
import {
  calcCurrentPositionSec,
  calcActiveCueIndex,
  applyTimelineAction,
  computeAudioTimelineCorrection,
  estimateClientOffset,
  AudioTimelineState
} from '../../src/utils/audioTimeline';
import type { AudioSyncCue } from '../../src/types/audio';

describe('audioTimeline utils', () => {
  describe('calcCurrentPositionSec', () => {
    it('returns basePositionSec when not playing', () => {
      const state: AudioTimelineState = {
        timelineId: '1', version: 1, presentationId: null, audioSrc: null, syncMapId: null,
        status: 'paused', basePositionSec: 10, baseServerTimeMs: 1000, playbackRate: 1,
        volume: 1, syncMode: 'none', activeCueIndex: -1, nextCueIndex: -1, updatedBy: 'control'
      };
      expect(calcCurrentPositionSec(state, 5000)).toBe(10);
    });

    it('calculates position based on elapsed time and playback rate when playing', () => {
      const state: AudioTimelineState = {
        timelineId: '1', version: 1, presentationId: null, audioSrc: null, syncMapId: null,
        status: 'playing', basePositionSec: 10, baseServerTimeMs: 1000, playbackRate: 1.5,
        volume: 1, syncMode: 'none', activeCueIndex: -1, nextCueIndex: -1, updatedBy: 'control'
      };
      // elapsed = 2000ms = 2s. 2s * 1.5 = 3s. base 10 + 3 = 13.
      expect(calcCurrentPositionSec(state, 3000)).toBe(13);
    });

    it('never returns a negative position', () => {
      const state: AudioTimelineState = {
        timelineId: '1', version: 1, presentationId: null, audioSrc: null, syncMapId: null,
        status: 'playing', basePositionSec: -5, baseServerTimeMs: 1000, playbackRate: 1,
        volume: 1, syncMode: 'none', activeCueIndex: -1, nextCueIndex: -1, updatedBy: 'control'
      };
      expect(calcCurrentPositionSec(state, 1000)).toBe(0);
    });
  });

  describe('calcActiveCueIndex', () => {
    const cues: AudioSyncCue[] = [
      { timeSec: 0, slideIndex: 0 },
      { timeSec: 10, slideIndex: 1 },
      { timeSec: 20, slideIndex: 2 }
    ];

    it('returns -1 if no cues match', () => {
      expect(calcActiveCueIndex(-1, cues)).toBe(-1);
    });

    it('returns correct cue index', () => {
      expect(calcActiveCueIndex(5, cues)).toBe(0);
      expect(calcActiveCueIndex(10, cues)).toBe(1);
      expect(calcActiveCueIndex(15, cues)).toBe(1);
      expect(calcActiveCueIndex(25, cues)).toBe(2);
    });
    
    it('returns -1 for empty cues array', () => {
      expect(calcActiveCueIndex(10, [])).toBe(-1);
    });
  });

  describe('computeAudioTimelineCorrection', () => {
    it('does not adjust playback when local audio is within drift tolerance', () => {
      const correction = computeAudioTimelineCorrection({
        audioCurrentTimeSec: 12.04,
        timelineBasePositionSec: 10,
        timelineBaseServerTimeMs: 1000,
        timelinePlaybackRate: 1,
        nowMs: 3000,
      });

      expect(correction.expectedPositionSec).toBe(12);
      expect(correction.action).toBe('none');
      expect(correction.playbackRate).toBe(1);
    });

    it('nudges playback faster when local audio is behind the server timeline', () => {
      const correction = computeAudioTimelineCorrection({
        audioCurrentTimeSec: 11.7,
        timelineBasePositionSec: 10,
        timelineBaseServerTimeMs: 1000,
        timelinePlaybackRate: 1,
        nowMs: 3000,
      });

      expect(correction.action).toBe('nudge');
      expect(correction.playbackRate).toBeGreaterThan(1);
      expect(correction.playbackRate).toBeLessThanOrEqual(1.08);
    });

    it('nudges playback slower when local audio is ahead of the server timeline', () => {
      const correction = computeAudioTimelineCorrection({
        audioCurrentTimeSec: 12.3,
        timelineBasePositionSec: 10,
        timelineBaseServerTimeMs: 1000,
        timelinePlaybackRate: 1,
        nowMs: 3000,
      });

      expect(correction.action).toBe('nudge');
      expect(correction.playbackRate).toBeLessThan(1);
      expect(correction.playbackRate).toBeGreaterThanOrEqual(0.92);
    });

    it('seeks when drift is too large to correct smoothly', () => {
      const correction = computeAudioTimelineCorrection({
        audioCurrentTimeSec: 10,
        timelineBasePositionSec: 10,
        timelineBaseServerTimeMs: 1000,
        timelinePlaybackRate: 1,
        nowMs: 3000,
      });

      expect(correction.action).toBe('seek');
      expect(correction.seekPositionSec).toBe(12);
      expect(correction.playbackRate).toBe(1);
    });
  });

  describe('applyTimelineAction', () => {
    const baseState: AudioTimelineState = {
      timelineId: '1', version: 1, presentationId: 'p1', audioSrc: '/test.mp3', syncMapId: 'sm1',
      status: 'paused', basePositionSec: 10, baseServerTimeMs: 1000, playbackRate: 1,
      volume: 1, syncMode: 'none', activeCueIndex: -1, nextCueIndex: -1, updatedBy: 'control'
    };

    it('applies PLAY action', () => {
      const newState = applyTimelineAction(baseState, { type: 'PLAY' }, 2000, 'presenter');
      expect(newState.status).toBe('playing');
      expect(newState.version).toBe(2);
      expect(newState.baseServerTimeMs).toBe(2000);
      expect(newState.basePositionSec).toBe(10); // currentPos when paused is basePositionSec
      expect(newState.updatedBy).toBe('presenter');
    });

    it('applies PAUSE action while playing', () => {
      const playingState: AudioTimelineState = { ...baseState, status: 'playing' };
      const newState = applyTimelineAction(playingState, { type: 'PAUSE' }, 3000);
      expect(newState.status).toBe('paused');
      // elapsed = 2000ms => +2s
      expect(newState.basePositionSec).toBe(12);
      expect(newState.version).toBe(2);
    });

    it('applies SEEK action', () => {
      const playingState: AudioTimelineState = { ...baseState, status: 'playing' };
      const newState = applyTimelineAction(playingState, { type: 'SEEK', positionSec: 50 }, 3000);
      expect(newState.basePositionSec).toBe(50);
      expect(newState.baseServerTimeMs).toBe(3000);
      expect(newState.version).toBe(2);
    });

    it('applies SET_VOLUME action', () => {
      const newState = applyTimelineAction(baseState, { type: 'SET_VOLUME', volume: 0.5 }, 2000);
      expect(newState.volume).toBe(0.5);
      expect(newState.version).toBe(2);
    });

    it('applies SET_RATE action', () => {
      const newState = applyTimelineAction(baseState, { type: 'SET_RATE', rate: 1.5 }, 2000);
      expect(newState.playbackRate).toBe(1.5);
      expect(newState.version).toBe(2);
    });

    it('applies SET_SYNC_MODE action', () => {
      const newState = applyTimelineAction(baseState, { type: 'SET_SYNC_MODE', syncMode: 'bilateral' }, 2000);
      expect(newState.syncMode).toBe('bilateral');
      expect(newState.version).toBe(2);
    });

    it('applies SET_TRACK action', () => {
      const newState = applyTimelineAction(baseState, {
        type: 'SET_TRACK', presentationId: 'p2', audioSrc: '/new.mp3', syncMapId: 'sm2'
      }, 2000);
      expect(newState.presentationId).toBe('p2');
      expect(newState.audioSrc).toBe('/new.mp3');
      expect(newState.syncMapId).toBe('sm2');
      expect(newState.status).toBe('loading');
      expect(newState.basePositionSec).toBe(0);
      expect(newState.baseServerTimeMs).toBe(2000);
      expect(newState.version).toBe(2);
    });

    it('applies STOP action', () => {
      const newState = applyTimelineAction(baseState, { type: 'STOP' }, 2000);
      expect(newState.status).toBe('idle');
      expect(newState.basePositionSec).toBe(0);
      expect(newState.baseServerTimeMs).toBe(2000);
      expect(newState.version).toBe(2);
    });
  });

  describe('estimateClientOffset', () => {
    it('estimates server time offset correctly', () => {
      // client sends at 100, server responds at 150 (server time 5000), client receives at 200.
      // RTT = 100ms. Oneway = 50ms.
      // Server time when client received pong = 5000 + 50 = 5050.
      // Offset = 5050 - 200 = 4850.
      const offset = estimateClientOffset(100, 200, 5000);
      expect(offset).toBe(4850);
      // to get server time from current client time: currentClientTime + offset
      expect(200 + offset).toBe(5050);
    });
  });
});
