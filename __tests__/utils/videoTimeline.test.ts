import { describe, it, expect } from 'vitest';
import { calcExpectedVideoTime } from '../../src/utils/videoTimeline';
import type { VideoState } from '../../src/types/presentation';

describe('videoTimeline', () => {
  describe('calcExpectedVideoTime', () => {
    const baseVideoState: VideoState = {
      isPlaying: true,
      currentTime: 10,
      duration: 100,
      volume: 1,
      speed: 1,
      loop: false,
      mediaSrc: 'test.mp4',
      lastUpdatedBy: 'projection',
      timestamp: 1000000,
      startTime: 0,
    };

    it('1. returns current time when paused', () => {
      const state = { ...baseVideoState, isPlaying: false };
      expect(calcExpectedVideoTime({ videoState: state, nowMs: 1005000 })).toBe(10);
    });

    it('2. calculates normal progression with 1x speed', () => {
      expect(calcExpectedVideoTime({ videoState: baseVideoState, nowMs: 1005000 })).toBe(15);
    });

    it('3. calculates accelerated progression with 2x speed', () => {
      const state = { ...baseVideoState, speed: 2 };
      expect(calcExpectedVideoTime({ videoState: state, nowMs: 1005000 })).toBe(20);
    });

    it('4. clamps to endTime when looping is disabled', () => {
      const state = { ...baseVideoState, endTime: 20, loop: false };
      // 15 seconds elapsed -> expected 25, clamped to 20
      expect(calcExpectedVideoTime({ videoState: state, nowMs: 1015000 })).toBe(20);
    });

    it('5. wraps around startTime when endTime exceeded and looping is enabled', () => {
      const state = { ...baseVideoState, startTime: 5, endTime: 20, loop: true };
      // 15 seconds elapsed -> expected 25. Duration is 15.
      // Modulo: (25 - 5) % 15 = 20 % 15 = 5. Start + 5 = 10.
      expect(calcExpectedVideoTime({ videoState: state, nowMs: 1015000 })).toBe(10);
    });

    it('6. clamps to duration when no endTime provided and looping is disabled', () => {
      const state = { ...baseVideoState, duration: 20, loop: false };
      // 15 seconds elapsed -> expected 25, clamped to 20
      expect(calcExpectedVideoTime({ videoState: state, nowMs: 1015000 })).toBe(20);
    });

    it('7. wraps around 0 when no endTime provided, duration exceeded, and looping is enabled', () => {
      const state = { ...baseVideoState, duration: 20, loop: true };
      // 15 seconds elapsed -> expected 25. Modulo 20: 5.
      expect(calcExpectedVideoTime({ videoState: state, nowMs: 1015000 })).toBe(5);
    });

    it('8. handles negative elapsed time gracefully (returns current time)', () => {
      // Clock drift backwards or invalid timestamp
      expect(calcExpectedVideoTime({ videoState: baseVideoState, nowMs: 900000 })).toBe(10);
    });

    it('9. handles zero duration loop gracefully (does not divide by zero)', () => {
      const state = { ...baseVideoState, startTime: 10, endTime: 10, loop: true };
      expect(calcExpectedVideoTime({ videoState: state, nowMs: 1005000 })).toBe(10);
    });

    it('10. handles missing startTime defaults to 0 for loop calculation', () => {
      const state = { ...baseVideoState, startTime: undefined, endTime: 20, loop: true };
      // 15 seconds elapsed -> expected 25. (25 - 0) % 20 = 5.
      expect(calcExpectedVideoTime({ videoState: state, nowMs: 1015000 })).toBe(5);
    });
  });
});
