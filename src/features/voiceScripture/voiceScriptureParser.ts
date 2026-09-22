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
      if (!/^(ahora|capitulo|versiculo|versiculos|el|al|del|volvamos|continua|hasta)$/.test(tokens[index])) return [];
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

const findBooks = (tokens: string[], metadata: AppMetadata): BookMatch[] => {
  const aliases: Array<{ alias: string[]; book: string }> = [];
  for (const [book, details] of Object.entries(metadata)) {
    aliases.push({ alias: fold(book).split(' '), book });
    aliases.push({ alias: fold(details.bookAbbrevEs).split(' '), book });
    
    if (details.voiceAliases) {
      for (const alias of details.voiceAliases) {
        aliases.push({ alias: fold(alias).split(' '), book });
      }
    }
  }
  aliases.sort((a, b) => b.alias.length - a.alias.length || b.alias.join(' ').length - a.alias.join(' ').length);

  const matches: BookMatch[] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    const matching = aliases.filter(({ alias }) => alias[0] && alias.every((token, offset) => tokens[start + offset] === token)
      && (alias.length !== 1 || alias[0].length > 1 || parseNumberAt(tokens, start + 1) || tokens[start + 1] === 'capitulo' || tokens[start - 1] === 'de'));
    if (!matching.length) continue;
    const longest = matching.filter((entry) => entry.alias.length === matching[0].alias.length);
    const books = new Set(longest.map((entry) => entry.book));
    matches.push({ book: books.size === 1 ? longest[0].book : '', start, length: longest[0].alias.length });
    start += longest[0].alias.length - 1;
  }
  return matches;
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

const parseCompactNumericReference = (
  commandTokens: string[],
  metadata: AppMetadata,
  book: string,
): VoiceScriptureCandidate | null => {
  if (commandTokens.length !== 1 || !/^\d{2,4}$/.test(commandTokens[0])) return null;

  const compact = commandTokens[0];
  const candidates = Array.from({ length: compact.length - 1 }, (_, index) => {
    const splitAt = index + 1;
    if (compact[0] === '0' || compact[splitAt] === '0') return null;
    return makeCandidate(
      metadata,
      book,
      Number(compact.slice(0, splitAt)),
      Number(compact.slice(splitAt)),
    );
  }).filter((candidate): candidate is VoiceScriptureCandidate => candidate !== null);

  return candidates.length === 1 ? candidates[0] : null;
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
  if (!makeCandidate(metadata, book, context.chapter, context.verse)) return null;
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
  if (/\b(al|el|hasta|del|capitulo|versiculo|versiculos)$/.test(normalized)) {
    // Relative forms ending in a unit are handled below; numeric commands must be complete.
    if (!/^(siguiente|proximo) (versiculo|capitulo)$/.test(normalized)) return null;
  }
  const book = resolveContextBook(context, metadata);
  if (!book) return null;
  if (!makeCandidate(metadata, book, context.chapter, context.verse)) return null;

  if (/^(siguiente|proximo) versiculo$/.test(normalized)) return moveRelative(1, 'verse', context, metadata);
  if (/^versiculo anterior$/.test(normalized)) return moveRelative(-1, 'verse', context, metadata);
  if (/^(siguiente|proximo) capitulo$/.test(normalized)) return moveRelative(1, 'chapter', context, metadata);
  if (/^capitulo anterior$/.test(normalized)) return moveRelative(-1, 'chapter', context, metadata);

  const numbers = extractNumbers(tokens);
  if (/^(ahora )?capitulo /.test(normalized)) {
    if (numbers.length === 2) return makeCandidate(metadata, book, numbers[0], numbers[1]);
    return null;
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

export interface VoiceScriptureResult {
  references: VoiceScriptureCandidate[];
  automatic: VoiceScriptureCandidate | null;
  reason: 'accepted' | 'no-reference' | 'invalid-or-ambiguous' | 'negated' | 'too-long';
}

// Roman tokens are read only in the numeric suffix of an explicit book mention.
const romanNumber = (token: string): number | null => {
  if (!token || !/^(?:c{0,1})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/.test(token)) return null;
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  return [...token].reduce((sum, ch, index) => sum + (values[ch] < (values[token[index + 1]] ?? 0) ? -values[ch] : values[ch]), 0);
};

const numericSuffix = (tokens: string[]) => {
  const numbers: number[] = [];
  const consumedTokens: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    if (/^(capitulo|versiculo|versiculos|del|al|hasta|el)$/.test(tokens[index])) {
      consumedTokens.push(tokens[index++]);
      continue;
    }
    const parsed = parseNumberAt(tokens, index);
    const roman = parsed ? null : romanNumber(tokens[index]);
    if (!parsed && roman === null) break;
    numbers.push(parsed?.value ?? roman!);
    const length = parsed?.consumed ?? 1;
    consumedTokens.push(...tokens.slice(index, index + length));
    index += length;
  }
  return { numbers, consumedTokens, index };
};

const explicitReference = (tokens: string[], book: string, metadata: AppMetadata) => {
  const { numbers, consumedTokens } = numericSuffix(tokens);
  if (/^(capitulo|versiculo|versiculos|del|al|hasta|el)$/.test(consumedTokens.at(-1) ?? '')) return null;
  if (numbers.length === 1) return parseCompactNumericReference(consumedTokens, metadata, book);
  if (numbers.length < 2 || numbers.length > 3) return null;
  return makeCandidate(metadata, book, numbers[0], numbers[1], numbers[2] ?? numbers[1]);
};

const precedingReference = (tokens: string[], book: string, metadata: AppMetadata) => {
  let start = tokens.length;
  while (start > 0 && (/^(capitulo|versiculo|versiculos|del|al|hasta|el|y)$/.test(tokens[start - 1])
    || parseNumberAt(tokens, start - 1) || romanNumber(tokens[start - 1]) !== null)) start -= 1;
  const span = tokens.slice(start);
  return span.length > 0 && numericSuffix(span).index === span.length ? explicitReference(span, book, metadata) : null;
};

/** One bounded final utterance; no partial hypotheses or transcript history. */
export const parseVoiceScriptureUtterance = (
  transcript: string,
  context: VoiceScriptureContext | null,
  metadata: AppMetadata,
): VoiceScriptureResult => {
  const empty = (reason: VoiceScriptureResult['reason']): VoiceScriptureResult => ({ references: [], automatic: null, reason });
  if (transcript.length > 1600) return empty('too-long');
  const tokens = fold(transcript.replace(/(\d)\s*[-–]\s*(\d)/g, '$1 al $2')).split(' ').filter(Boolean);
  if (tokens.length > 100) return empty('too-long');
  if (!tokens.length || !Object.keys(metadata).length) return empty('no-reference');
  const matches = findBooks(tokens, metadata);
  const references: VoiceScriptureCandidate[] = [];
  let ambiguous = false;
  let negated = false;
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const previousEnd = i ? matches[i - 1].start + matches[i - 1].length : 0;
    const prefix = tokens.slice(previousEnd, match.start);
    const suffix = tokens.slice(match.start + match.length, matches[i + 1]?.start ?? tokens.length);
    if (prefix.some((token) => /^(no|nunca|tampoco)$/.test(token))) { negated = true; continue; }
    if (!match.book) { ambiguous = true; continue; }
    let candidate = explicitReference(suffix, match.book, metadata);
    if (!candidate && prefix.at(-1) === 'de') candidate = precedingReference(prefix.slice(0, -1), match.book, metadata);
    const correction = suffix.findIndex((token) => /^(perdon|corrijo|rectifico)$/.test(token));
    if (correction >= 0) {
      const corrected = suffix.slice(correction + 1);
      if (matches[i + 1] && (!corrected.length || tokens[matches[i + 1].start - 1] === 'de')) continue;
      candidate = explicitReference(corrected, match.book, metadata);
      if (!candidate) ambiguous = true;
    }
    // A negation following the numeric span invalidates this mention as well.
    const tail = suffix.slice(numericSuffix(suffix).index);
    if (correction < 0 && tail[0] === 'no') { negated = true; continue; }
    if (candidate) references.push(candidate);
    else ambiguous = true;
  }
  if (!matches.length) {
    if (tokens.some((token) => /^(no|nunca|tampoco|perdon|corrijo|rectifico)$/.test(token))) return empty('negated');
    // Strip narrative prefixes, but only feed bounded command vocabulary to the contextual parser.
    for (let start = 0; start < tokens.length; start += 1) {
      if (!/^(siguiente|proximo|versiculo|versiculos|capitulo|ahora|volvamos|continua|del)$/.test(tokens[start])) continue;
      let end = start;
      while (end < tokens.length) {
        if (/^(siguiente|proximo|anterior|versiculo|versiculos|capitulo|ahora|volvamos|continua|hasta|del|al|el)$/.test(tokens[end])) { end += 1; continue; }
        const number = parseNumberAt(tokens, end);
        if (!number) break;
        end += number.consumed;
      }
      const command = tokens.slice(start, end);
      const candidate = parseContextual(command.join(' '), command, context, metadata);
      if (candidate) references.push(candidate);
      else ambiguous = true;
      start = Math.max(start, end - 1);
    }
  }
  const automatic = !ambiguous ? references.at(-1) ?? null : null;
  return { references, automatic, reason: ambiguous ? 'invalid-or-ambiguous' : automatic ? 'accepted' : negated ? 'negated' : 'no-reference' };
};

// Compatibility for callers that need just the selected reference.
export const parseVoiceScriptureCommand = (transcript: string, context: VoiceScriptureContext | null, metadata: AppMetadata) =>
  parseVoiceScriptureUtterance(transcript, context, metadata).automatic;

