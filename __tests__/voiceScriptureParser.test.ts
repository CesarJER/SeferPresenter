import { describe, expect, it } from 'vitest';
import type { AppMetadata } from '../src/utils/metadataCache';
import { parseVoiceScriptureCommand } from '../src/features/voiceScripture/voiceScriptureParser';

const chapter = (count: number) => Array.from({ length: count }, (_, index) => String(index + 1));
const metadata: AppMetadata = {
  Génesis: { bookHeb: 'בראשית', bookAbbrevEs: 'Gn', safeFile: 'Genesis', voiceAliases: ['genesis', 'gn', 'bereshit', 'bereshis'], chapters: { '1': chapter(31), '2': chapter(25) } },
  Deuteronomio: { bookHeb: 'דברים', bookAbbrevEs: 'Dt', safeFile: 'Deuteronomio', voiceAliases: ['deuteronomio', 'dt', 'devarim', 'de barim', 'devarin'], chapters: { '6': chapter(25), '7': chapter(26) } },
  Isaías: { bookHeb: 'ישעיהו', bookAbbrevEs: 'Is', safeFile: 'Isaias', voiceAliases: ['isaias', 'is', 'yeshayahu'], chapters: { '53': chapter(12) } },
  Salmos: { bookHeb: 'תהלים', bookAbbrevEs: 'Sal', safeFile: 'Salmos', voiceAliases: ['salmos', 'salmo', 'sal', 'tehilim'], chapters: { '150': chapter(6) } },
};

const compact = (text: string, context = null) => {
  const result = parseVoiceScriptureCommand(text, context, metadata);
  return result && [result.bookAbbrev, result.chapter, result.verseStart, result.verseEnd];
};

describe('parseVoiceScriptureCommand V1', () => {
  it.each([
    ['Génesis uno uno', ['Gn', 1, 1, 1]],
    ['Génesis capítulo uno versículo uno', ['Gn', 1, 1, 1]],
    ['Isaías cincuenta y tres', ['Is', 53, 1, 1]],
    ['Isaías capítulo cincuenta y tres versículo cinco', ['Is', 53, 5, 5]],
    ['Devarim seis cuatro', ['Dt', 6, 4, 4]],
    ['vamos a de barim capítulo seis versículo cuatro', ['Dt', 6, 4, 4]],
    ['Bereshit uno uno', ['Gn', 1, 1, 1]],
    ['Yeshayahu cincuenta y tres cinco', ['Is', 53, 5, 5]],
  ])('resolves %s', (text, expected) => expect(compact(text)).toEqual(expected));

  it.each([
    'Génesis setenta y dos cuatro',
    'Salmo ciento cincuenta ocho',
    'hoy hablaremos de esperanza',
    'ocho personas llegaron',
    'Génesis uno uno dos tres',
  ])('rejects invalid or ambiguous input: %s', (text) => expect(compact(text)).toBeNull());
});

describe('parseVoiceScriptureCommand V2', () => {
  const context = { book: 'Dt', chapter: 6, verse: 4 };

  it.each([
    ['versículo nueve', ['Dt', 6, 9, 9]],
    ['ahora el ocho', ['Dt', 6, 8, 8]],
    ['del cuatro al siete', ['Dt', 6, 4, 7]],
    ['versículos cuatro al siete', ['Dt', 6, 4, 7]],
    ['siguiente versículo', ['Dt', 6, 5, 5]],
    ['versículo anterior', ['Dt', 6, 3, 3]],
    ['siguiente capítulo', ['Dt', 7, 1, 1]],
    ['ahora capítulo siete', ['Dt', 7, 1, 1]],
    ['continúa hasta el diez', ['Dt', 6, 4, 10]],
    ['volvamos al cuatro', ['Dt', 6, 4, 4]],
  ])('uses current scripture context for %s', (text, expected) => {
    expect(compact(text, context)).toEqual(expected);
  });

  it('does not treat a bare number as a contextual command', () => {
    expect(compact('el ocho', context)).toBeNull();
  });
});
