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

export const scriptureVerseToLines = (verse: ScriptureVerse) => [
  verse.verseNikud,
  verse.transliteration,
  verse.translation,
];
