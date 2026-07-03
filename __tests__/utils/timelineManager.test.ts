import { beforeEach, describe, expect, it } from 'vitest';
import { applyAction, reset } from '../../server/timelineManager.mjs';

describe('timelineManager', () => {
  beforeEach(() => {
    reset();
  });

  it('applies track defaults to canonical timeline state', () => {
    const state = applyAction({
      type: 'SET_TRACK',
      presentationId: 'p1',
      audioSrc: '/audio/lectura.mp3',
      syncMapId: 'a1',
      syncMode: 'unilateral',
      volume: 0.65,
    });

    expect(state.presentationId).toBe('p1');
    expect(state.audioSrc).toBe('/audio/lectura.mp3');
    expect(state.syncMapId).toBe('a1');
    expect(state.syncMode).toBe('unilateral');
    expect(state.volume).toBe(0.65);
    expect(state.durationSec).toBeNull();
    expect(state.loop).toBe(false);
    expect(state.status).toBe('idle');
  });

  it('normalizes empty track values and clamps track volume', () => {
    const state = applyAction({
      type: 'SET_TRACK',
      presentationId: '',
      audioSrc: '',
      syncMapId: '',
      syncMode: 'invalid',
      volume: 2,
    });

    expect(state.presentationId).toBeNull();
    expect(state.audioSrc).toBeNull();
    expect(state.syncMapId).toBeNull();
    expect(state.syncMode).toBe('none');
    expect(state.volume).toBe(1);
  });

  it('stores duration and loop state canonically', () => {
    applyAction({
      type: 'SET_TRACK',
      presentationId: 'p1',
      audioSrc: '/audio/lectura.mp3',
      syncMapId: 'a1',
    });

    const withDuration = applyAction({ type: 'SET_DURATION', durationSec: 12 });
    expect(withDuration.durationSec).toBe(12);

    const withLoop = applyAction({ type: 'SET_LOOP', loop: true });
    expect(withLoop.loop).toBe(true);
  });

  it('marks the timeline ended when non-loop playback reaches the end', () => {
    applyAction({
      type: 'SET_TRACK',
      presentationId: 'p1',
      audioSrc: '/audio/lectura.mp3',
      syncMapId: 'a1',
    });
    applyAction({ type: 'SET_DURATION', durationSec: 12 });
    applyAction({ type: 'PLAY' });

    const ended = applyAction({ type: 'END', positionSec: 12 });

    expect(ended.status).toBe('ended');
    expect(ended.basePositionSec).toBe(12);
  });

  it('ignores END while loop is enabled', () => {
    applyAction({
      type: 'SET_TRACK',
      presentationId: 'p1',
      audioSrc: '/audio/lectura.mp3',
      syncMapId: 'a1',
    });
    applyAction({ type: 'SET_DURATION', durationSec: 12 });
    applyAction({ type: 'SET_LOOP', loop: true });
    const playing = applyAction({ type: 'PLAY' });

    const afterEnd = applyAction({ type: 'END', positionSec: 12 });

    expect(afterEnd).toBe(playing);
    expect(afterEnd.status).toBe('playing');
  });
});
