import { describe, expect, it } from 'vitest';
import { numberToGreekNumeral, numberToHebrewNumeral } from '../../src/hooks/scriptureNumerals';

describe('scripture numerals', () => {
  it('returns empty strings for invalid or zero values', () => {
    expect(numberToHebrewNumeral(0)).toBe('');
    expect(numberToGreekNumeral(0)).toBe('');
  });

  it('returns stable non-empty markers for positive values', () => {
    expect(numberToHebrewNumeral(1)).not.toBe('');
    expect(numberToHebrewNumeral(15)).not.toContain('15');
    expect(numberToGreekNumeral(23)).not.toBe('');
  });
});
