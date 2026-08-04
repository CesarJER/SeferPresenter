import { describe, expect, it } from 'vitest';
import { arePresentationsEqual, getStateSyncPaths } from '../../src/hooks/useSyncState';
import type { Presentation } from '../../src/types/presentation';

const presentation: Presentation = {
  id: 'p1',
  title: 'Presentation',
  background: '/background.webp',
  mode: 'trilingual',
  tags: ['public'],
  slides: [{
    id: 's1',
    label: 'Slide',
    lines: ['One', 'Two', 'Three'],
    mediaFit: 'cover',
    mediaShowBg: true,
    scriptureVerses: [['Verse', 'Transliteration', 'Translation']],
  }],
};

describe('arePresentationsEqual', () => {
  it('observes every serialized presentation field', () => {
    expect(arePresentationsEqual(presentation, structuredClone(presentation))).toBe(true);
    expect(arePresentationsEqual(presentation, { ...structuredClone(presentation), tags: ['private'] })).toBe(false);
    expect(arePresentationsEqual(presentation, {
      ...structuredClone(presentation),
      slides: [{ ...structuredClone(presentation.slides[0]), mediaFit: 'contain' }],
    })).toBe(false);
    expect(arePresentationsEqual(presentation, {
      ...structuredClone(presentation),
      slides: [{ ...structuredClone(presentation.slides[0]), mediaShowBg: false }],
    })).toBe(false);
    expect(arePresentationsEqual(presentation, {
      ...structuredClone(presentation),
      slides: [{ ...structuredClone(presentation.slides[0]), scriptureVerses: [['Changed']] }],
    })).toBe(false);
  });
});

describe('getStateSyncPaths', () => {
  it('keeps Audience on the public minimized state endpoints', () => {
    expect(getStateSyncPaths(false, false)).toEqual([
      '/api/audience/state',
      '/api/audience/events',
    ]);
    expect(getStateSyncPaths(true, false)).toEqual(['/api/state', '/api/state-events']);
    expect(getStateSyncPaths(false, true)).toEqual(['/api/state', '/api/state-events']);
  });
});
