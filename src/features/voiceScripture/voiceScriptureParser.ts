import type { AppMetadata } from '../../utils/metadataCache';

export interface VoiceScriptureContext {
  book: string;
  chapter: number;
  verse: number;
}

export interface VoiceScriptureCandidate {
  book: string;
  bookAbbrev: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  source: 'voice';
}

const fold = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const EXTRA_BOOK_ALIASES: ReadonlyArray<{ aliases: string[]; targets: string[] }> = [
  { aliases: ['genesis', 'gn', 'bereshit', 'bereshis'], targets: ['genesis', 'gn'] },
  { aliases: ['exodo', 'ex', 'shemot'], targets: ['exodo', 'ex'] },
  { aliases: ['levitico', 'lv', 'vayikra'], targets: ['levitico', 'lv'] },
  { aliases: ['numeros', 'nm', 'bamidbar'], targets: ['numeros', 'nm'] },
  { aliases: ['deuteronomio', 'dt', 'devarim', 'de barim', 'devarin'], targets: ['deuteronomio', 'dt'] },
  { aliases: ['salmos', 'salmo', 'sal', 'tehilim'], targets: ['salmos', 'salmo', 'sal'] },
  { aliases: ['isaias', 'is', 'yeshayahu'], targets: ['isaias', 'is'] },
];

const SMALL_NUMBERS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};

const TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
  ochenta: 80, noventa: 90,
};

interface ParsedNumber {
  value: number;
  consumed: number;
}

const parseNumberAt = (tokens: string[], start: number): ParsedNumber | null => {
  const first = tokens[start];
  if (!first) return null;
  if (/^\d{1,3}$/.test(first)) return { value: Number(first), consumed: 1 };

  let value = 0;
  let index = start;
  if (first === 'cien') return { value: 100, consumed: 1 };
  if (first === 'ciento') {
    value = 100;
    index += 1;
  }

  const tens = TENS[tokens[index]];
  if (tens !== undefined) {
    value += tens;
    index += 1;
    if (tokens[index] === 'y' && SMALL_NUMBERS[tokens[index + 1]] !== undefined) {
      value += SMALL_NUMBERS[tokens[index + 1]];
      index += 2;
    }
    return { value, consumed: index - start };
  }

  const small = SMALL_NUMBERS[tokens[index]];
  if (small !== undefined) {
    value += small;
    index += 1;
    return { value, consumed: index - start };
  }

  return null;
};

const extractNumbers = (tokens: string[]): number[] => {
  const values: number[] = [];
  for (let index = 0; index < tokens.length;) {
    const parsed = parseNumberAt(tokens, index);
    if (!parsed) {
      index += 1;
      continue;
    }
    values.push(parsed.value);
    index += parsed.consumed;
  }
  return values;
};

interface BookMatch {
  book: string;
  start: number;
  length: number;
}

const resolveAliasTarget = (targets: string[], metadata: AppMetadata): string | null => {
  for (const [book, details] of Object.entries(metadata)) {
    const normalized = [fold(book), fold(details.bookAbbrevEs)];
    if (targets.some((target) => normalized.includes(fold(target)))) return book;
  }
  return null;
};

const findBook = (tokens: string[], metadata: AppMetadata): BookMatch | null => {
  const aliases: Array<{ alias: string[]; book: string }> = [];
  for (const [book, details] of Object.entries(metadata)) {
    aliases.push({ alias: fold(book).split(' '), book });
    aliases.push({ alias: fold(details.bookAbbrevEs).split(' '), book });
  }
  for (const definition of EXTRA_BOOK_ALIASES) {
    const book = resolveAliasTarget(definition.targets, metadata);
    if (!book) continue;
    for (const alias of definition.aliases) aliases.push({ alias: fold(alias).split(' '), book });
  }
  aliases.sort((a, b) => b.alias.length - a.alias.length || b.alias.join(' ').length - a.alias.join(' ').length);

  for (const entry of aliases) {
    for (let start = 0; start <= tokens.length - entry.alias.length; start += 1) {
      if (entry.alias.every((token, offset) => tokens[start + offset] === token)) {
        return { book: entry.book, start, length: entry.alias.length };
      }
    }
  }
  return null;
};

const makeCandidate = (
  metadata: AppMetadata,
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd = verseStart,
): VoiceScriptureCandidate | null => {
  const details = metadata[book];
  const verses = details?.chapters[String(chapter)];
  if (!details || !verses || verseStart < 1 || verseEnd < verseStart) return null;
  if (!verses.includes(String(verseStart)) || !verses.includes(String(verseEnd))) return null;
  return {
    book,
    bookAbbrev: details.bookAbbrevEs,
    chapter,
    verseStart,
    verseEnd,
    source: 'voice',
  };
};

const resolveContextBook = (context: VoiceScriptureContext, metadata: AppMetadata): string | null => {
  const wanted = fold(context.book);
  return Object.keys(metadata).find((book) => (
    fold(book) === wanted || fold(metadata[book].bookAbbrevEs) === wanted
  )) ?? null;
};

const moveRelative = (
  direction: 1 | -1,
  unit: 'verse' | 'chapter',
  context: VoiceScriptureContext,
  metadata: AppMetadata,
): VoiceScriptureCandidate | null => {
  const book = resolveContextBook(context, metadata);
  if (!book) return null;
  const chapters = Object.keys(metadata[book].chapters).map(Number).sort((a, b) => a - b);
  if (unit === 'chapter') {
    const index = chapters.indexOf(context.chapter);
    const chapter = chapters[index + direction];
    if (!chapter) return null;
    const verse = Number(metadata[book].chapters[String(chapter)][0]);
    return makeCandidate(metadata, book, chapter, verse);
  }

  const currentVerses = metadata[book].chapters[String(context.chapter)] ?? [];
  const verseIndex = currentVerses.indexOf(String(context.verse));
  const adjacentVerse = currentVerses[verseIndex + direction];
  if (adjacentVerse) return makeCandidate(metadata, book, context.chapter, Number(adjacentVerse));

  const chapterIndex = chapters.indexOf(context.chapter);
  const adjacentChapter = chapters[chapterIndex + direction];
  if (!adjacentChapter) return null;
  const adjacentVerses = metadata[book].chapters[String(adjacentChapter)];
  const verse = direction === 1 ? adjacentVerses[0] : adjacentVerses[adjacentVerses.length - 1];
  return makeCandidate(metadata, book, adjacentChapter, Number(verse));
};

const parseContextual = (
  normalized: string,
  tokens: string[],
  context: VoiceScriptureContext | null,
  metadata: AppMetadata,
): VoiceScriptureCandidate | null => {
  if (!context) return null;
  const book = resolveContextBook(context, metadata);
  if (!book) return null;

  if (/^(siguiente|proximo) versiculo$/.test(normalized)) return moveRelative(1, 'verse', context, metadata);
  if (/^versiculo anterior$/.test(normalized)) return moveRelative(-1, 'verse', context, metadata);
  if (/^(siguiente|proximo) capitulo$/.test(normalized)) return moveRelative(1, 'chapter', context, metadata);
  if (/^capitulo anterior$/.test(normalized)) return moveRelative(-1, 'chapter', context, metadata);

  const numbers = extractNumbers(tokens);
  if (/^(ahora )?capitulo /.test(normalized) && numbers.length === 1) {
    return makeCandidate(metadata, book, numbers[0], 1);
  }
  if (/^(versiculo|ahora el|volvamos al) /.test(normalized) && numbers.length === 1) {
    return makeCandidate(metadata, book, context.chapter, numbers[0]);
  }
  if (/^(versiculos |del )/.test(normalized) && numbers.length === 2) {
    return makeCandidate(metadata, book, context.chapter, numbers[0], numbers[1]);
  }
  if (/^continua hasta /.test(normalized) && numbers.length === 1) {
    return makeCandidate(metadata, book, context.chapter, context.verse, numbers[0]);
  }
  return null;
};

export const parseVoiceScriptureCommand = (
  transcript: string,
  context: VoiceScriptureContext | null,
  metadata: AppMetadata,
): VoiceScriptureCandidate | null => {
  const normalized = fold(transcript);
  if (!normalized || Object.keys(metadata).length === 0) return null;
  const tokens = normalized.split(' ');
  const bookMatch = findBook(tokens, metadata);

  if (!bookMatch) return parseContextual(normalized, tokens, context, metadata);

  const commandTokens = tokens.slice(bookMatch.start + bookMatch.length);
  const numbers = extractNumbers(commandTokens);
  if (numbers.length < 1 || numbers.length > 3) return null;
  const chapter = numbers[0];
  const verseStart = numbers[1] ?? 1;
  const verseEnd = numbers[2] ?? verseStart;
  return makeCandidate(metadata, bookMatch.book, chapter, verseStart, verseEnd);
};

