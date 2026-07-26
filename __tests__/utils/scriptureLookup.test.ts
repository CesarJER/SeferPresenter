import { describe, expect, it } from 'vitest';
import {
  auditQuickScriptureReferences,
  auditSlideScriptureReferences,
  parseScriptureTag,
  scriptureSlideToTag,
  scriptureTagToText,
  scriptureVerseToLines,
  validateScriptureSpec,
} from '../../src/utils/scriptureLookup';
import type { AppMetadata } from '../../src/utils/metadataCache';

const metadata: AppMetadata = {
  Génesis: {
    bookHeb: 'Bereshit',
    bookAbbrevEs: 'Gn',
    safeFile: 'genesis',
    chapters: { '1': ['1', '2', '3'] },
  },
};

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

  it('describes missing books, chapters and verses', () => {
    expect(validateScriptureSpec({ kind: 'sefer', bookToken: 'Gn', chapter: '1', verseStart: '1', verseEnd: '3' }, metadata)).toBeNull();
    expect(validateScriptureSpec({ kind: 'sefer', bookToken: 'Desconocido', chapter: '1', verseStart: '1' }, metadata)).toContain('no existe');
    expect(validateScriptureSpec({ kind: 'sefer', bookToken: 'Gn', chapter: '2', verseStart: '1' }, metadata)).toContain('no tiene el capítulo 2');
    expect(validateScriptureSpec({ kind: 'sefer', bookToken: 'Gn', chapter: '1', verseStart: '4' }, metadata)).toContain('versículos inexistentes: 4');
  });

  it('audits quick-mode Sefer and quiz citations with line numbers', async () => {
    const issues = await auditQuickScriptureReferences([
      '[Sefer Gn 1:1-4]',
      'CITA: Gn 2:1',
      'CITA!: referencia rota',
    ].join('\n'), metadata);

    expect(issues).toHaveLength(3);
    expect(issues[0]).toMatchObject({ location: 'Línea 1' });
    expect(issues[0].message).toContain('versículos inexistentes: 4');
    expect(issues[1].message).toContain('no tiene el capítulo 2');
    expect(issues[2].message).toContain('no tiene el formato');
  });

  it('audits persisted Sefer and quiz slides before save', async () => {
    const issues = await auditSlideScriptureReferences([
      {
        id: 'sefer-1',
        label: 'Sefer',
        lines: ['', '', ''],
        type: 'sefer',
        scriptureBook: 'Gn',
        scriptureChapter: '1',
        scriptureVerseStart: '9',
      },
      {
        id: 'quiz-1',
        label: 'Quiz',
        lines: ['', '', ''],
        type: 'quiz',
        quizData: {
          question: 'Cita',
          options: [],
          timerSeconds: 30,
          randomize: false,
          multiSelect: false,
          citaRef: 'Gn 1:1-3',
        },
      },
    ], metadata);

    expect(issues).toHaveLength(1);
    expect(issues[0].location).toContain('Diapositiva 1');
    expect(issues[0].message).toContain('versículos inexistentes: 9');
  });
});
