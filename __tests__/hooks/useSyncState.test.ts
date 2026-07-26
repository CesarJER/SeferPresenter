import { describe, expect, it } from 'vitest';
import { arePresentationsEqual, getProjectionSyncEndpoints } from '../../src/hooks/useSyncState';
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

describe('getProjectionSyncEndpoints', () => {
  it('keeps Audience on the public projection endpoints', () => {
    expect(getProjectionSyncEndpoints(true)).toEqual({
      state: '/api/audience/state',
      events: '/api/audience/events',
    });
  });

  it('keeps Control and Presenter on the protected full-state endpoints', () => {
    expect(getProjectionSyncEndpoints(false)).toEqual({
      state: '/api/state',
      events: '/api/state-events',
    });
  });
});
