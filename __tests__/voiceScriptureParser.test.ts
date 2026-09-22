import { describe, expect, it } from 'vitest';
import type { AppMetadata } from '../src/utils/metadataCache';
import { parseVoiceScriptureCommand, parseVoiceScriptureUtterance } from '../src/features/voiceScripture/voiceScriptureParser';

const chapter = (count: number) => Array.from({ length: count }, (_, index) => String(index + 1));
const metadata: AppMetadata = {
  'Colección Alfa': { bookHeb: 'א', bookAbbrevEs: 'A', safeFile: 'alfa', voiceAliases: ['alfa', 'aleph'], chapters: { '1': chapter(31), '2': chapter(25), '4': chapter(25) } },
  'Colección Beta': { bookHeb: 'ב', bookAbbrevEs: 'B', safeFile: 'beta', voiceAliases: ['beta', 'bet', 'be ta'], chapters: { '6': chapter(25), '7': chapter(26) } },
  'Colección Gamma': { bookHeb: 'ג', bookAbbrevEs: 'G', safeFile: 'gamma', voiceAliases: ['gamma', 'gimel'], chapters: { '53': chapter(12) } },
  'Colección Delta': { bookHeb: 'ד', bookAbbrevEs: 'D', safeFile: 'delta', voiceAliases: ['delta', 'dalet'], chapters: { '150': chapter(6) } },
};

const compact = (text: string, context = null) => {
  const result = parseVoiceScriptureCommand(text, context, metadata);
  return result && [result.bookAbbrev, result.chapter, result.verseStart, result.verseEnd];
};

describe('continuous utterance extraction', () => {
  it.each([
    ['Vamos a leer Alfa dos V para comentarlo', ['A', 2, 5, 5]],
    ['Alfa uno tres al cinco', ['A', 1, 3, 5]],
    ['Alfa 1:3-5', ['A', 1, 3, 5]],
    ['Alfa dos cinco, perdón, dos seis', ['A', 2, 6, 6]],
    ['Alfa uno tres, perdón, Beta seis cuatro', ['B', 6, 4, 4]],
    ['Primero Alfa uno tres y después Beta seis cuatro para leer', ['B', 6, 4, 4]],
  ])('extracts %s', (text, expected) => expect(compact(text)).toEqual(expected));
  it.each([
    'No vayamos a Alfa dos cinco', 'Nunca leeremos Alfa dos cinco',
    'Alfa dos cinco, perdón, dos', 'Alfa dos cinco no', 'Alfa uno tres al',
    'Alfa dos cinco y Beta seis', 'Alfa dos V Alfa III el 48 Beta 48 Gamma 44 y una conversación',
    `${'conversación '.repeat(101)}Alfa uno uno`,
  ])('abstains on %s', (text) => expect(compact(text)).toBeNull());
  it('keeps ordered manual choices when the last mention is invalid', () => {
    const result = parseVoiceScriptureUtterance('Alfa uno tres y Beta seis', null, metadata);
    expect(result.references).toHaveLength(1);
    expect(result.automatic).toBeNull();
    expect(result.reason).toBe('invalid-or-ambiguous');
  });
  it('retains all valid mentions, automatically choosing the last', () => {
    const result = parseVoiceScriptureUtterance('Alfa uno tres y Beta seis cuatro', null, metadata);
    expect(result.references.map((r) => r.bookAbbrev)).toEqual(['A', 'B']);
    expect(result.automatic).toEqual(result.references[1]);
  });
  it('rejects colliding aliases', () => {
    const books = { ...metadata, Other: { ...metadata['Colección Alfa'], voiceAliases: ['alfa'] } };
    expect(parseVoiceScriptureUtterance('alfa uno tres', null, books).automatic).toBeNull();
  });
  it('uses only a valid projected context for relative commands in discourse', () => {
    expect(compact('Leamos ahora el ocho para continuar', { book: 'B', chapter: 6, verse: 4 })).toEqual(['B', 6, 8, 8]);
    expect(compact('siguiente versículo', { book: 'B', chapter: 99, verse: 1 })).toBeNull();
    expect(compact('siguiente versículo')).toBeNull();
  });
});

describe('book-last references', () => {
  it.each([
    ['cuatro cuatro de Alfa', ['A', 4, 4, 4]],
    ['4 4 de Alfa', ['A', 4, 4, 4]],
    ['capítulo seis versículo cuatro de Beta', ['B', 6, 4, 4]],
    ['capítulo 6 versículo 4 de Beta', ['B', 6, 4, 4]],
    ['capítulo seis versículos cuatro al siete de Beta', ['B', 6, 4, 7]],
    ['capítulo 6 versículos 4 al 7 de Beta', ['B', 6, 4, 7]],
    ['6:4-7 de Beta', ['B', 6, 4, 7]],
    ['esto está escrito en seis cuatro de Beta', ['B', 6, 4, 4]],
    ['vamos a leer capítulo seis versículo cuatro de Beta', ['B', 6, 4, 4]],
    ['hoy somos cuatro y leeremos capítulo seis versículo cuatro de Beta', ['B', 6, 4, 4]],
    ['seis cuatro de Be Ta', ['B', 6, 4, 4]],
    ['uno cuatro de Aleph', ['A', 1, 4, 4]],
    ['6 4 de B', ['B', 6, 4, 4]],
    ['64 de Beta', ['B', 6, 4, 4]],
  ])('extracts %s', (text, expected) => expect(compact(text)).toEqual(expected));

  it.each([
    'capítulo seis de Beta', 'versículo cuatro de Beta', 'capítulo seis versículo de Beta',
    'capítulo seis versículos cuatro al de Beta', 'seis de Beta',
    'ocho personas estaban leyendo de Beta', 'hoy hablamos de Beta',
    'capítulo 999 versículo 4 de Beta', 'capítulo 6 versículo 999 de Beta',
    'capítulo 6 versículos 4 al 999 de Beta', 'seis cuatro de Bet no',
    'no seis cuatro de Beta', 'nunca leeremos seis cuatro de Beta',
  ])('abstains on %s', (text) => expect(compact(text)).toBeNull());

  it.each([
    ['seis cuatro de Beta, perdón, seis cinco de Beta', ['B', 6, 5, 5]],
    ['Beta seis cuatro, perdón, capítulo seis versículo cinco de Beta', ['B', 6, 5, 5]],
  ])('keeps the correction in %s', (text, expected) => expect(compact(text)).toEqual(expected));

  it.each([
    ['Alfa uno tres y después seis cuatro de Beta', ['A', 'B']],
    ['uno tres de Alfa y después Beta seis cuatro', ['A', 'B']],
    ['uno tres de Alfa y después seis cuatro de Beta', ['A', 'B']],
  ])('retains ordered references in %s', (text, books) => {
    const result = parseVoiceScriptureUtterance(text, null, metadata);
    expect(result.references.map((reference) => reference.bookAbbrev)).toEqual(books);
    expect(result.automatic).toEqual(result.references[1]);
  });

  it('keeps an earlier valid choice but abstains when the later book-last mention is invalid', () => {
    const result = parseVoiceScriptureUtterance('Alfa uno tres y después capítulo seis de Beta', null, metadata);
    expect(result.references.map((reference) => reference.bookAbbrev)).toEqual(['A']);
    expect(result.automatic).toBeNull();
  });

  it('rejects colliding book-last aliases', () => {
    const books = { ...metadata, Other: { ...metadata['Colección Alfa'], voiceAliases: ['alfa'] } };
    expect(parseVoiceScriptureUtterance('uno tres de alfa', null, books).automatic).toBeNull();
  });

  it('rejects ambiguous compact splits with the same corpus validation', () => {
    const books: AppMetadata = { Ambiguous: { ...metadata['Colección Alfa'], voiceAliases: ['ambigua'], chapters: { '1': chapter(11), '11': chapter(1) } } };
    expect(parseVoiceScriptureCommand('111 de ambigua', null, books)).toBeNull();
  });
});

describe('parseVoiceScriptureCommand V1', () => {
  it.each([
    ['Alfa uno uno', ['A', 1, 1, 1]],
    ['Colección Alfa capítulo uno versículo uno', ['A', 1, 1, 1]],
    ['Gimel capítulo cincuenta y tres versículo cinco', ['G', 53, 5, 5]],
    ['Beta seis cuatro', ['B', 6, 4, 4]],
    ['Beta 64', ['B', 6, 4, 4]],
    ['vamos a be ta capítulo seis versículo cuatro', ['B', 6, 4, 4]],
    ['Aleph uno uno', ['A', 1, 1, 1]],
    ['Gamma cincuenta y tres cinco', ['G', 53, 5, 5]],
  ])('resolves %s', (text, expected) => expect(compact(text)).toEqual(expected));

  it('rejects compact digits when more than one corpus-valid split exists', () => {
    const ambiguousMetadata: AppMetadata = {
      'Colección Ambigua': {
        bookHeb: 'א',
        bookAbbrevEs: 'X',
        safeFile: 'ambigua',
        voiceAliases: ['ambigua'],
        chapters: { '1': chapter(11), '11': chapter(1) },
      },
    };
    expect(parseVoiceScriptureCommand('Ambigua 111', null, ambiguousMetadata)).toBeNull();
  });

  it('does not split digits introduced as an explicit chapter', () => {
    expect(compact('Beta capítulo 64')).toBeNull();
  });

  it('does not navigate when a book and chapter omit the verse', () => {
    expect(compact('Gamma cincuenta y tres')).toBeNull();
  });

  it.each([
    'Alfa setenta y dos cuatro',
    'Delta ciento cincuenta ocho',
    'hoy hablaremos de esperanza',
    'ocho personas llegaron',
    'Alfa uno uno dos tres',
  ])('rejects invalid or ambiguous input: %s', (text) => expect(compact(text)).toBeNull());
});

describe('parseVoiceScriptureCommand V2', () => {
  const context = { book: 'B', chapter: 6, verse: 4 };

  it.each([
    ['versículo nueve', ['B', 6, 9, 9]],
    ['ahora el ocho', ['B', 6, 8, 8]],
    ['del cuatro al siete', ['B', 6, 4, 7]],
    ['versículos cuatro al siete', ['B', 6, 4, 7]],
    ['siguiente versículo', ['B', 6, 5, 5]],
    ['versículo anterior', ['B', 6, 3, 3]],
    ['siguiente capítulo', ['B', 7, 1, 1]],
    ['continúa hasta el diez', ['B', 6, 4, 10]],
    ['volvamos al cuatro', ['B', 6, 4, 4]],
  ])('uses current scripture context for %s', (text, expected) => {
    expect(compact(text, context)).toEqual(expected);
  });

  it('does not treat a bare number as a contextual command', () => {
    expect(compact('el ocho', context)).toBeNull();
  });

  it('does not navigate from a contextual chapter without a verse', () => {
    expect(compact('ahora capítulo siete', context)).toBeNull();
  });
  it.each(['versículo anterior ocho', 'del cuatro al', 'ahora el ocho al', 'capítulo seis anterior cuatro'])('rejects malformed contextual syntax: %s', (text) => {
    expect(compact(text, context)).toBeNull();
  });
});
