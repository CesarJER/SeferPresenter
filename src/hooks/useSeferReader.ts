import { useCallback, useEffect, useRef, useState } from 'react';
import { loadBookData, getMetadata } from '../utils/metadataCache';
import { parseVerses } from '../utils/scriptureParser';

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
// State types
// ---------------------------------------------------------------------------
export interface SeferReaderState {
  bookEs: string;
  bookHeb: string;
  bookAbbrevEs: string;
  chapter: string;
  verseStart?: string;
  verse: string;
  verseEnd?: string;
  verseNikud: string;
  verseNikudSanitized?: string;
  transliteration: string;
  translation: string;
  verseIdx: number;       // index in loaded book data
  totalVerses: number;    // total verses in loaded book
  scriptureKind?: 'tanaj' | 'sefer';
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
  goToVerse: (verse: string) => SeferReaderState | null;
  goNext: () => SeferReaderState | null;    // advance verse (active only auto-projects via caller)
  goPrev: () => SeferReaderState | null;    // go back verse
  deactivate: () => void;  // ESC or mode switch
  restoreState: (state: SeferReaderState) => void;
  rangeVerses: string[];
  rangeLabel: string;
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
  const rangeStartVerseRef = useRef<string | null>(null);
  const rangeEndVerseRef = useRef<string | null>(null);
  const scriptureKindRef = useRef<'tanaj' | 'sefer'>('sefer');

  const chapterVerses = bookData.filter((v) => v.chapter === selectedChapter);
  const hasActiveRange = !!rangeStartVerseRef.current && !!rangeEndVerseRef.current;
  const rangeChapterVerses = (() => {
    if (!chapterVerses.length || !hasActiveRange) return chapterVerses;

    const startIdx = chapterVerses.findIndex((v) => v.verse === rangeStartVerseRef.current);
    const endIdx = chapterVerses.findIndex((v) => v.verse === rangeEndVerseRef.current);
    if (startIdx < 0 || endIdx < 0) return chapterVerses;
    const from = Math.min(startIdx, endIdx);
    const to = Math.max(startIdx, endIdx);
    return chapterVerses.slice(from, to + 1);
  })();

  // ------------------------------------------------------------------
  // Load metadata on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    getMetadata()
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

    setIsLoading(true);
    loadBookData(selectedBook, parseVerses)
      .then((parsed) => {
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
  const buildState = useCallback((v: VerseData, idx: number, total: number, verseStart?: string, verseEnd?: string): SeferReaderState => ({
    bookEs: v.bookEs,
    bookHeb: v.bookHeb,
    bookAbbrevEs: v.bookAbbrevEs,
    chapter: v.chapter,
    verseStart: verseStart ?? v.verse,
    verse: v.verse,
    verseEnd,
    verseNikud: v.verseNikudSanitized ?? v.verseNikud,
    verseNikudSanitized: v.verseNikudSanitized,
    transliteration: v.transliteration,
    translation: v.translation,
    verseIdx: idx,
    totalVerses: total,
    scriptureKind: scriptureKindRef.current,
  }), []);

  // ------------------------------------------------------------------
  // Get current verse by selected book/chapter/verse
  // ------------------------------------------------------------------
  const getCurrentVerseState = useCallback((): SeferReaderState | null => {
    if (!chapterVerses.length) return null;
    const idx = chapterVerses.findIndex(
      (v) => v.chapter === selectedChapter && v.verse === selectedVerse
    );
    if (idx < 0) return null;
    const bookIdx = bookData.findIndex((v) => v.chapter === selectedChapter && v.verse === selectedVerse);
    const verseStart = hasActiveRange ? (rangeStartVerseRef.current ?? chapterVerses[idx].verse) : undefined;
    const verseEnd = hasActiveRange ? (rangeEndVerseRef.current ?? verseStart ?? chapterVerses[idx].verse) : undefined;
    return buildState(
      chapterVerses[idx],
      hasActiveRange ? idx : Math.max(0, bookIdx >= 0 ? bookIdx : idx),
      hasActiveRange ? rangeChapterVerses.length : bookData.length,
      verseStart,
      verseEnd
    );
  }, [bookData, buildState, chapterVerses, hasActiveRange, rangeChapterVerses.length, selectedChapter, selectedVerse]);

  const currentVerse = getCurrentVerseState();

  const rangeVerses = (() => {
    if (!chapterVerses.length) return [];
    return hasActiveRange ? rangeChapterVerses.map((v) => v.verse) : chapterVerses.map((v) => v.verse);
  })();

  const rangeLabel = (() => {
    if (!chapterVerses.length) return '';
    const current = currentVerse;
    if (!current) return '';
    if (!hasActiveRange) return `${current.bookAbbrevEs} ${current.chapter}:${current.verse}`;
    const start = chapterVerses.find((v) => v.verse === rangeStartVerseRef.current);
    const end = chapterVerses.find((v) => v.verse === rangeEndVerseRef.current);
    if (!start || !end) return `${current.bookAbbrevEs} ${current.chapter}:${current.verse}`;
    const rangePart = start.verse === end.verse ? start.verse : `${start.verse}-${end.verse}`;
    return `${current.bookAbbrevEs} ${current.chapter}:${rangePart}`;
  })();

  // ------------------------------------------------------------------
  // Setters with cascade reset
  // ------------------------------------------------------------------
  const setSelectedBook = useCallback((book: string) => {
    setSelectedBookState(book);
    setSelectedChapterState('1');
    setSelectedVerseState('1');
    rangeStartVerseRef.current = null;
    rangeEndVerseRef.current = null;
    scriptureKindRef.current = 'sefer';
    setIsActive(false); // manual change → requires ▶️
  }, []);

  const setSelectedChapter = useCallback((chapter: string) => {
    setSelectedChapterState(chapter);
    setSelectedVerseState('1');
    rangeStartVerseRef.current = null;
    rangeEndVerseRef.current = null;
    scriptureKindRef.current = 'sefer';
    setIsActive(false); // manual change → requires ▶️
  }, []);

  const setSelectedVerse = useCallback((verse: string) => {
    setSelectedVerseState(verse);
    rangeStartVerseRef.current = null;
    rangeEndVerseRef.current = null;
    scriptureKindRef.current = 'sefer';
    setIsActive(false); // manual change → requires ▶️
  }, []);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  const activate = useCallback((): SeferReaderState | null => {
    setIsActive(true);
    return getCurrentVerseState();
  }, [getCurrentVerseState]);

  const goToVerse = useCallback((verse: string): SeferReaderState | null => {
    if (!chapterVerses.length) return null;
    const idx = chapterVerses.findIndex((v) => v.verse === verse);
    if (idx < 0) return null;
    const bookIdx = bookData.findIndex((v) => v.chapter === selectedChapter && v.verse === verse);

    setSelectedVerseState(verse);
    setIsActive(true);
    const verseStart = hasActiveRange ? (rangeStartVerseRef.current ?? verse) : undefined;
    const verseEnd = hasActiveRange ? (rangeEndVerseRef.current ?? verseStart ?? verse) : undefined;
    return buildState(
      chapterVerses[idx],
      hasActiveRange ? idx : Math.max(0, bookIdx >= 0 ? bookIdx : idx),
      hasActiveRange ? rangeChapterVerses.length : bookData.length,
      verseStart,
      verseEnd
    );
  }, [bookData, buildState, chapterVerses, hasActiveRange, rangeChapterVerses.length]);

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
    rangeStartVerseRef.current = state.verseEnd ? (state.verseStart ?? state.verse) : null;
    rangeEndVerseRef.current = state.verseEnd ? (state.verseEnd ?? state.verseStart ?? state.verse) : null;
    scriptureKindRef.current = state.scriptureKind ?? 'sefer';
    setIsActive(true);
  }, []);

  const goNext = useCallback((): SeferReaderState | null => {
    const versesSource = hasActiveRange ? rangeChapterVerses : bookData;
    if (!versesSource.length) return null;
    const idx = hasActiveRange
      ? rangeChapterVerses.findIndex((v) => v.verse === selectedVerse && v.chapter === selectedChapter)
      : bookData.findIndex((v) => v.chapter === selectedChapter && v.verse === selectedVerse);
    if (idx < 0) return null;
    const nextIdx = Math.min(idx + 1, versesSource.length - 1);
    if (nextIdx === idx) return null; // at the end
    const next = versesSource[nextIdx];
    setSelectedChapterState(next.chapter);
    setSelectedVerseState(next.verse);
    const verseStart = hasActiveRange ? (rangeStartVerseRef.current ?? next.verse) : undefined;
    const verseEnd = hasActiveRange ? (rangeEndVerseRef.current ?? verseStart ?? next.verse) : undefined;
    return buildState(
      next,
      nextIdx,
      versesSource.length,
      verseStart,
      verseEnd
    );
  }, [bookData, buildState, chapterVerses, hasActiveRange, rangeChapterVerses, selectedChapter, selectedVerse]);

  const goPrev = useCallback((): SeferReaderState | null => {
    const versesSource = hasActiveRange ? rangeChapterVerses : bookData;
    if (!versesSource.length) return null;
    const idx = hasActiveRange
      ? rangeChapterVerses.findIndex((v) => v.verse === selectedVerse && v.chapter === selectedChapter)
      : bookData.findIndex((v) => v.chapter === selectedChapter && v.verse === selectedVerse);
    if (idx < 0) return null;
    const prevIdx = Math.max(idx - 1, 0);
    if (prevIdx === idx) return null; // at the beginning
    const prev = versesSource[prevIdx];
    setSelectedChapterState(prev.chapter);
    setSelectedVerseState(prev.verse);
    const verseStart = hasActiveRange ? (rangeStartVerseRef.current ?? prev.verse) : undefined;
    const verseEnd = hasActiveRange ? (rangeEndVerseRef.current ?? verseStart ?? prev.verse) : undefined;
    return buildState(
      prev,
      prevIdx,
      versesSource.length,
      verseStart,
      verseEnd
    );
  }, [bookData, buildState, chapterVerses, hasActiveRange, rangeChapterVerses, selectedChapter, selectedVerse]);

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
    goToVerse,
    goNext,
    goPrev,
    deactivate,
    restoreState,
    rangeVerses,
    rangeLabel,
  };
}
