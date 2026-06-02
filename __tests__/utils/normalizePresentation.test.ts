import { describe, expect, it } from 'vitest';
import type { Presentation } from '../../src/types/presentation';
import {
  formatSlideHash,
  normalizePresentation,
  normalizePublicPath,
  parseSlideHash,
  slugify,
} from '../../src/utils/normalizePresentation';

const makePresentation = (overrides: Partial<Presentation> = {}): Presentation => ({
  id: 'p1',
  title: 'Test',
  background: 'public/backgrounds/bg.png',
  mode: 'trilingual',
  slides: [
    {
      id: 's1',
      label: '1',
      lines: ['Linea principal'],
      background: '/backgrounds/slide.png',
    },
  ],
  ...overrides,
});

describe('normalizePresentation utilities', () => {
  it('normalizes public paths for web mode', () => {
    expect(normalizePublicPath('public/backgrounds/a.png')).toBe('/backgrounds/a.png');
    expect(normalizePublicPath('C:\\site\\public\\backgrounds\\a.png')).toBe('/backgrounds/a.png');
  });

  it('formats and parses slide hashes', () => {
    expect(formatSlideHash(3)).toBe('#3');
    expect(formatSlideHash(3, '7')).toBe('#3.7');
    expect(parseSlideHash('#3.7')).toEqual({ slideIndex: 3, verse: '7' });
  });

  it('slugifies human titles', () => {
    expect(slugify('Cántico de Sion!')).toBe('cantico-de-sion');
  });

  it('pads slide lines and sets default font scale', () => {
    const normalized = normalizePresentation(makePresentation());

    expect(normalized.background).toBe('/backgrounds/bg.png');
    expect(normalized.fontScale).toBe(1);
    expect(normalized.slides[0].lines).toEqual(['Linea principal', '-', '-']);
  });

  it('downgrades trilingual mode when all secondary lines are fallback values', () => {
    const normalized = normalizePresentation(makePresentation({
      slides: [
        { id: 's1', label: '1', lines: ['Uno', '-', '-'] },
        { id: 's2', label: '2', lines: ['Dos', '', ''] },
      ],
    }));

    expect(normalized.mode).toBe('standard');
  });
});
