import Papa from 'papaparse';

export interface ScriptureVerse {
  bookEs: string;
  bookAbbrevEs: string;
  bookHeb: string;
  chapter: string;
  verse: string;
  verseNikud: string;
  transliteration: string;
  translation: string;
}

interface BookMetadata {
  bookAbbrevEs: string;
  safeFile: string;
}

type AppMetadata = Record<string, BookMetadata>;

export type ScriptureSlideKind = 'tanaj' | 'sefer';

export interface ScriptureTagSpec {
  kind: ScriptureSlideKind;
  bookToken: string;
  chapter: string;
  verseStart: string;
  verseEnd?: string;
}

export interface ScriptureSlideDraft {
  id: string;
  label: string;
  lines: string[];
  type: ScriptureSlideKind;
  scriptureBook: string;
  scriptureChapter: string;
  scriptureVerseStart: string;
  scriptureVerseEnd?: string;
}

const loadedBooks = new Map<string, ScriptureVerse[]>();
let metadataPromise: Promise<AppMetadata> | null = null;

const getBaseUrl = () => import.meta.env.BASE_URL ?? '/';

const getMetadata = async () => {
  if (!metadataPromise) {
    metadataPromise = fetch(`${getBaseUrl()}metadata.json`).then((response) => {
      if (!response.ok) throw new Error(`No se pudo cargar metadata.json (${response.status})`);
      return response.json() as Promise<AppMetadata>;
    });
  }
  return metadataPromise;
};

const resolveBookName = (bookToken: string, metadata: AppMetadata) => {
  if (metadata[bookToken]) return bookToken;
  return Object.keys(metadata).find((bookName) => metadata[bookName].bookAbbrevEs === bookToken) ?? null;
};

const loadBook = async (bookToken: string) => {
  const metadata = await getMetadata();
  const bookName = resolveBookName(bookToken, metadata);
  if (!bookName) throw new Error(`Libro no encontrado: ${bookToken}`);

  const cached = loadedBooks.get(bookName);
  if (cached) return cached;

  const safeFile = metadata[bookName]?.safeFile;
  if (!safeFile) throw new Error(`No hay TSV para el libro: ${bookToken}`);

  const response = await fetch(`${getBaseUrl()}books/${safeFile}.tsv`);
  if (!response.ok) throw new Error(`No se pudo cargar ${safeFile}.tsv (${response.status})`);

  const text = await response.text();
  const parsed = Papa.parse<ScriptureVerse>(text, {
    header: true,
    delimiter: '\t',
    skipEmptyLines: true,
  }).data.filter((row) => row.bookEs && row.chapter && row.verse);

  loadedBooks.set(bookName, parsed);
  return parsed;
};

export const findScriptureRange = async (
  bookToken: string,
  chapter: string,
  verseStart: string,
  verseEnd?: string
) => {
  const book = await loadBook(bookToken);
  const start = Number(verseStart);
  const end = Number(verseEnd || verseStart);

  return book.filter((row) => {
    if (row.chapter !== String(chapter)) return false;
    const verse = Number(row.verse);
    return verse >= start && verse <= end;
  });
};

export const getScriptureChapterVerses = async (bookToken: string, chapter: string) => {
  const book = await loadBook(bookToken);
  return book.filter((row) => row.chapter === String(chapter));
};

export const scriptureVerseToLines = (verse: ScriptureVerse) => [
  verse.verseNikud,
  verse.transliteration,
  verse.translation,
];

export const parseScriptureTag = (text: string): ScriptureTagSpec | null => {
  const clean = text.trim();
  const match = clean.match(/^\[(Tanaj|Sefer)\s+(.+?)\s+(\d+):(\d+)(?:-(\d+))?\]$/i);
  if (!match) return null;

  const kind = match[1].toLowerCase() === 'sefer' ? 'sefer' : 'tanaj';
  const bookToken = match[2].trim();
  const chapter = match[3];
  const verseStart = match[4];
  const verseEnd = match[5];

  return {
    kind,
    bookToken,
    chapter,
    verseStart,
    verseEnd: verseEnd && verseEnd !== verseStart ? verseEnd : undefined,
  };
};

export const scriptureTagToText = (spec: ScriptureTagSpec) => {
  const range = spec.verseEnd ? `${spec.verseStart}-${spec.verseEnd}` : spec.verseStart;
  return `[${spec.kind === 'sefer' ? 'Sefer' : 'Tanaj'} ${spec.bookToken} ${spec.chapter}:${range}]`;
};

export const scriptureSlideToTag = (slide: {
  type?: string;
  scriptureBook?: string;
  scriptureChapter?: string;
  scriptureVerseStart?: string;
  scriptureVerseEnd?: string;
}) => {
  if (!slide.scriptureBook || !slide.scriptureChapter || !slide.scriptureVerseStart) return null;

  const kind = slide.type === 'sefer' || slide.type === 'scripture' ? 'sefer' : 'tanaj';
  return scriptureTagToText({
    kind,
    bookToken: slide.scriptureBook,
    chapter: slide.scriptureChapter,
    verseStart: slide.scriptureVerseStart,
    verseEnd: slide.scriptureVerseEnd && slide.scriptureVerseEnd !== slide.scriptureVerseStart
      ? slide.scriptureVerseEnd
      : undefined,
  });
};

export const materializeScriptureSlides = async (spec: ScriptureTagSpec): Promise<ScriptureSlideDraft[]> => {
  const verses = await findScriptureRange(spec.bookToken, spec.chapter, spec.verseStart, spec.verseEnd);
  if (verses.length === 0) return [];

  const baseLabel = `${spec.bookToken} ${spec.chapter}:${spec.verseStart}${spec.verseEnd ? `-${spec.verseEnd}` : ''}`;

  const first = verses[0];
  return [{
    id: `slide-scripture-${Date.now()}-${spec.kind}`,
    label: baseLabel,
    lines: scriptureVerseToLines(first),
    type: spec.kind,
    scriptureBook: first.bookAbbrevEs || spec.bookToken,
    scriptureChapter: first.chapter,
    scriptureVerseStart: spec.verseStart,
    scriptureVerseEnd: spec.verseEnd ?? spec.verseStart,
  }];
};

export const expandScriptureRangeToSlides = async (spec: ScriptureTagSpec): Promise<ScriptureSlideDraft[]> => {
  const verses = await findScriptureRange(spec.bookToken, spec.chapter, spec.verseStart, spec.verseEnd);
  if (verses.length === 0) return [];

  const titleLabel = `${spec.bookToken} ${spec.chapter}:${spec.verseEnd ? `${spec.verseStart}-${spec.verseEnd}` : spec.verseStart}`;
  const titleSlide: ScriptureSlideDraft = {
    id: `slide-scripture-title-${Date.now()}`,
    label: titleLabel,
    lines: [titleLabel],
    type: spec.kind,
    scriptureBook: verses[0].bookAbbrevEs || spec.bookToken,
    scriptureChapter: spec.chapter,
    scriptureVerseStart: spec.verseStart,
    scriptureVerseEnd: spec.verseEnd ?? spec.verseStart,
  };

  const verseSlides = verses.map((verse, idx) => ({
    id: `slide-scripture-${Date.now()}-${idx}`,
    label: verse.verse,
    lines: scriptureVerseToLines(verse),
    type: spec.kind,
    scriptureBook: verse.bookAbbrevEs || spec.bookToken,
    scriptureChapter: verse.chapter,
    scriptureVerseStart: verse.verse,
    scriptureVerseEnd: verse.verse,
  }));

  return [titleSlide, ...verseSlides];
};
