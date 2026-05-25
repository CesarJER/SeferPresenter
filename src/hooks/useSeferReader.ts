import { useCallback, useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';

// ---------------------------------------------------------------------------
// Types (inline — avoids @sefer/core circular dep during bootstrap)
// ---------------------------------------------------------------------------
export interface VerseData {
  bookEs: string;
  bookAbbrevEs: string;
  bookHeb: string;
  chapter: string;
  verse: string;
  verseNikud: string;
  verseNikudClean?: string;
  verseNikudSanitized?: string;
  verseNikudCleanSanitized?: string;
  transliteration: string;
  translation: string;
  DIR?: string;
}

export interface BookMetadata {
  bookHeb: string;
  bookAbbrevEs: string;
  safeFile: string;
  chapters: Record<string, string[]>;
}

export type AppMetadata = Record<string, BookMetadata>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const removeNiqqudFromPlainText = (text: string) =>
  text.replace(/\u05BE/g, ' ').replace(/[\u0591-\u05C7]/g, '').replace(/ \(.+\)/g, '');

const removeNiqqudPreserveHtml = (html: string): string =>
  html.split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') ? part : removeNiqqudFromPlainText(part)))
    .join('');

const sanitizeHtmlLight = (html: string): string => {
  // Simple pass-through — full sanitizer available in @sefer/core
  return html;
};

function parseVerses(source: string): VerseData[] {
  const result = Papa.parse<VerseData>(source, {
    header: true,
    delimiter: '\t',
    skipEmptyLines: true,
  });
  return result.data
    .filter((row) => row.bookEs !== '')
    .map((row) => {
      let verseNikud = (row.verseNikud ?? '')
        .replace(/\{\u05E4\}/g, '<br/>')
        .replace(/\{\u05E1\}/g, '&emsp;&emsp;&emsp;')
        .replace(/\(\u05E4\)/g, '<br/>')
        .replace(/\(\u05E1\)/g, '&emsp;&emsp;&emsp;');

      const verseNikudClean = removeNiqqudPreserveHtml(verseNikud);
      return {
        ...row,
        verseNikud,
        verseNikudClean,
        verseNikudSanitized: sanitizeHtmlLight(verseNikud),
        verseNikudCleanSanitized: sanitizeHtmlLight(verseNikudClean),
      };
    });
}

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------
export interface SeferReaderState {
  bookEs: string;
  bookHeb: string;
  bookAbbrevEs: string;
  chapter: string;
  verse: string;
  verseNikud: string;
  transliteration: string;
  translation: string;
  verseIdx: number;       // index in loaded book data
  totalVerses: number;    // total verses in loaded book
}

interface UseSeferReaderResult {
  metadata: AppMetadata;
  currentVerse: SeferReaderState | null;
  isLoading: boolean;
  isActive: boolean;       // true when ▶️ was pressed — arrows auto-project
  bookList: string[];      // ordered list of book names (bookEs)
  chapters: string[];      // chapters available in current book
  verses: string[];        // verse numbers available in current chapter
  selectedBook: string;
  selectedChapter: string;
  selectedVerse: string;
  setSelectedBook: (book: string) => void;
  setSelectedChapter: (chapter: string) => void;
  setSelectedVerse: (verse: string) => void;
  activate: () => SeferReaderState | null;  // press ▶️ — sets active, returns current verse
  goNext: () => SeferReaderState | null;    // advance verse (active only auto-projects via caller)
  goPrev: () => SeferReaderState | null;    // go back verse
  deactivate: () => void;  // ESC or mode switch
  restoreState: (state: SeferReaderState) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useSeferReader(): UseSeferReaderResult {
  const [metadata, setMetadata] = useState<AppMetadata>({});
  const [bookData, setBookData] = useState<VerseData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const [selectedBook, setSelectedBookState] = useState('');
  const [selectedChapter, setSelectedChapterState] = useState('1');
  const [selectedVerse, setSelectedVerseState] = useState('1');

  const loadedBooksRef = useRef<Map<string, VerseData[]>>(new Map());
  const metadataRef = useRef<AppMetadata>({});

  // ------------------------------------------------------------------
  // Load metadata on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    const base = import.meta.env.BASE_URL ?? '/';
    fetch(`${base}metadata.json`)
      .then((r) => r.json())
      .then((meta: AppMetadata) => {
        setMetadata(meta);
        metadataRef.current = meta;
        const books = Object.keys(meta);
        if (books.length > 0 && !selectedBook) {
          setSelectedBookState(books[0]);
        }
      })
      .catch((e) => console.error('SeferReader: error loading metadata', e));
  }, []);

  // ------------------------------------------------------------------
  // Load book data when selectedBook changes
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!selectedBook || !metadataRef.current[selectedBook]) return;

    const cached = loadedBooksRef.current.get(selectedBook);
    if (cached) {
      setBookData(cached);
      return;
    }

    setIsLoading(true);
    const base = import.meta.env.BASE_URL ?? '/';
    const safeFile = metadataRef.current[selectedBook].safeFile;
    fetch(`${base}books/${safeFile}.tsv`)
      .then((r) => r.text())
      .then((text) => {
        const parsed = parseVerses(text);
        loadedBooksRef.current.set(selectedBook, parsed);
        setBookData(parsed);
      })
      .catch((e) => console.error('SeferReader: error loading book', e))
      .finally(() => setIsLoading(false));
  }, [selectedBook]);

  // ------------------------------------------------------------------
  // Derived lists
  // ------------------------------------------------------------------
  const bookList = Object.keys(metadata);

  const chapters = (() => {
    if (!selectedBook || !metadata[selectedBook]) return [];
    return Object.keys(metadata[selectedBook].chapters).sort((a, b) => Number(a) - Number(b));
  })();

  const verses = (() => {
    if (!selectedBook || !selectedChapter || !metadata[selectedBook]) return [];
    return (metadata[selectedBook].chapters[selectedChapter] ?? []).slice().sort((a, b) => Number(a) - Number(b));
  })();

  // ------------------------------------------------------------------
  // Build SeferReaderState from a VerseData
  // ------------------------------------------------------------------
  const buildState = useCallback((v: VerseData, idx: number, total: number): SeferReaderState => ({
    bookEs: v.bookEs,
    bookHeb: v.bookHeb,
    bookAbbrevEs: v.bookAbbrevEs,
    chapter: v.chapter,
    verse: v.verse,
    verseNikud: v.verseNikudSanitized ?? v.verseNikud,
    transliteration: v.transliteration,
    translation: v.translation,
    verseIdx: idx,
    totalVerses: total,
  }), []);

  // ------------------------------------------------------------------
  // Get current verse by selected book/chapter/verse
  // ------------------------------------------------------------------
  const getCurrentVerseState = useCallback((): SeferReaderState | null => {
    if (!bookData.length) return null;
    const idx = bookData.findIndex(
      (v) => v.chapter === selectedChapter && v.verse === selectedVerse
    );
    if (idx < 0) return null;
    return buildState(bookData[idx], idx, bookData.length);
  }, [bookData, selectedChapter, selectedVerse, buildState]);

  const currentVerse = getCurrentVerseState();

  // ------------------------------------------------------------------
  // Setters with cascade reset
  // ------------------------------------------------------------------
  const setSelectedBook = useCallback((book: string) => {
    setSelectedBookState(book);
    setSelectedChapterState('1');
    setSelectedVerseState('1');
    setIsActive(false); // manual change → requires ▶️
  }, []);

  const setSelectedChapter = useCallback((chapter: string) => {
    setSelectedChapterState(chapter);
    setSelectedVerseState('1');
    setIsActive(false); // manual change → requires ▶️
  }, []);

  const setSelectedVerse = useCallback((verse: string) => {
    setSelectedVerseState(verse);
    setIsActive(false); // manual change → requires ▶️
  }, []);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  const activate = useCallback((): SeferReaderState | null => {
    setIsActive(true);
    return getCurrentVerseState();
  }, [getCurrentVerseState]);

  const deactivate = useCallback(() => {
    setIsActive(false);
  }, []);

  const restoreState = useCallback((state: SeferReaderState) => {
    let resolvedBook = state.bookEs;
    if (resolvedBook && metadataRef.current && !metadataRef.current[resolvedBook]) {
      const found = Object.keys(metadataRef.current).find(
        (k) => metadataRef.current[k].bookAbbrevEs === resolvedBook
      );
      if (found) resolvedBook = found;
    }
    setSelectedBookState(resolvedBook);
    setSelectedChapterState(state.chapter);
    setSelectedVerseState(state.verse);
    setIsActive(true);
  }, []);

  const goNext = useCallback((): SeferReaderState | null => {
    if (!bookData.length) return null;
    const idx = bookData.findIndex(
      (v) => v.chapter === selectedChapter && v.verse === selectedVerse
    );
    const nextIdx = Math.min(idx + 1, bookData.length - 1);
    if (nextIdx === idx) return null; // at the end
    const next = bookData[nextIdx];
    setSelectedChapterState(next.chapter);
    setSelectedVerseState(next.verse);
    // Do NOT call setIsActive(false) — goNext keeps active state
    return buildState(next, nextIdx, bookData.length);
  }, [bookData, selectedChapter, selectedVerse, buildState]);

  const goPrev = useCallback((): SeferReaderState | null => {
    if (!bookData.length) return null;
    const idx = bookData.findIndex(
      (v) => v.chapter === selectedChapter && v.verse === selectedVerse
    );
    const prevIdx = Math.max(idx - 1, 0);
    if (prevIdx === idx) return null; // at the beginning
    const prev = bookData[prevIdx];
    setSelectedChapterState(prev.chapter);
    setSelectedVerseState(prev.verse);
    return buildState(prev, prevIdx, bookData.length);
  }, [bookData, selectedChapter, selectedVerse, buildState]);

  return {
    metadata,
    currentVerse,
    isLoading,
    isActive,
    bookList,
    chapters,
    verses,
    selectedBook,
    selectedChapter,
    selectedVerse,
    setSelectedBook,
    setSelectedChapter,
    setSelectedVerse,
    activate,
    goNext,
    goPrev,
    deactivate,
    restoreState,
  };
}
