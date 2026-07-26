import { describe, expect, it } from 'vitest';
import {
  parseScriptureTag,
  scriptureSlideToTag,
  scriptureTagToText,
  scriptureVerseToLines,
} from '../../src/utils/scriptureLookup';

describe('scriptureLookup utilities', () => {
  it('parses Sefer and Tanaj tags', () => {
    expect(parseScriptureTag('[Sefer Gn 1:1-3]')).toEqual({
      kind: 'sefer',
      bookToken: 'Gn',
      chapter: '1',
      verseStart: '1',
      verseEnd: '3',
    });

    expect(parseScriptureTag('[Tanaj Salmos 23:1]')).toEqual({
      kind: 'tanaj',
      bookToken: 'Salmos',
      chapter: '23',
      verseStart: '1',
      verseEnd: undefined,
    });
  });

  it('serializes tags and slides consistently', () => {
    expect(scriptureTagToText({
      kind: 'sefer',
      bookToken: 'Gn',
      chapter: '1',
      verseStart: '1',
      verseEnd: '3',
    })).toBe('[Sefer Gn 1:1-3]');

    expect(scriptureSlideToTag({
      type: 'tanaj',
      scriptureBook: 'Sal',
      scriptureChapter: '23',
      scriptureVerseStart: '1',
      scriptureVerseEnd: '1',
    })).toBe('[Tanaj Sal 23:1]');
  });

  it('maps verse fields to slide lines', () => {
    expect(scriptureVerseToLines({
      bookEs: 'Genesis',
      bookAbbrevEs: 'Gn',
      bookHeb: 'Bereshit',
      chapter: '1',
      verse: '1',
      verseNikud: 'Texto hebreo',
      transliteration: 'Transliteracion',
      translation: 'Traduccion',
    })).toEqual(['Texto hebreo', 'Transliteracion', 'Traduccion']);
  });
});
