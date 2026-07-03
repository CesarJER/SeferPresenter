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
});
