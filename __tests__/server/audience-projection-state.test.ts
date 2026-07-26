import { describe, expect, it } from 'vitest';
import { deriveAudienceProjectionState } from '../../server/audience-projection-state.mjs';

describe('deriveAudienceProjectionState', () => {
  it('exposes only the current slide and omits catalogue metadata', () => {
    const state = deriveAudienceProjectionState({
      presentation: {
        id: 'presentation-1',
        title: 'Public title',
        background: '/background.webp',
        mode: 'standard',
        tags: ['private-editor-tag'],
        slides: [
          { id: 'future', label: 'Future', lines: ['Do not disclose'] },
          {
            id: 'current',
            label: 'Current',
            lines: ['Visible now'],
            type: 'media',
            mediaSrc: '/media/current.mp4',
            editorOnly: 'omit',
          },
        ],
      },
      slideIndex: 1,
      backgroundLock: false,
      lockedBackgroundValue: null,
      userSelectedBackground: null,
      videoState: null,
      appMode: 'slides',
      scriptureState: null,
      audioState: {
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        volume: 0.7,
        audioSrc: null,
        activeSyncMapId: null,
        syncMode: 'none',
        lastUpdatedBy: 'controller',
        timestamp: 0,
      },
      quizState: null,
      autoduckState: { enabled: false, factor: 0.2 },
      stepIndex: 2,
    });

    expect(state.slideIndex).toBe(0);
    expect(state.presentation?.slides).toEqual([{
      id: 'current',
      label: 'Current',
      lines: ['Visible now'],
      type: 'media',
      mediaSrc: '/media/current.mp4',
    }]);
    expect(state.presentation).not.toHaveProperty('tags');
    expect(JSON.stringify(state)).not.toContain('Do not disclose');
    expect(JSON.stringify(state)).not.toContain('editorOnly');
  });

  it('returns an empty projection when no slide is selected', () => {
    const state = deriveAudienceProjectionState({
      presentation: {
        id: 'presentation-1',
        title: 'Title',
        background: '',
        mode: 'standard',
        slides: [{ id: 's1', label: 'Slide', lines: ['Hidden'] }],
      },
      slideIndex: -1,
    });

    expect(state.slideIndex).toBe(-1);
    expect(state.presentation?.slides).toEqual([]);
    expect(JSON.stringify(state)).not.toContain('Hidden');
  });
});
