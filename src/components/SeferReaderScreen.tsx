import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ScriptureNavState } from '../types/presentation';
import type { VerseData, AppMetadata } from '../hooks/useSeferReader';
import { parseVerses } from '../utils/scriptureParser';
import { SeferFlowView } from './SeferFlowView';
import { VerseSidebar } from './VerseSidebar';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { numberToHebrewNumeral, numberToGreekNumeral } from '../hooks/scriptureNumerals';

interface SeferReaderScreenProps {
  scriptureState: ScriptureNavState;
  onVerseSelected: (payload: any) => void;
  onBoundaryReached?: (direction: 'next' | 'previous') => void;
  onLogoClick?: () => void;
}

export const SeferReaderScreen: React.FC<SeferReaderScreenProps> = ({
  scriptureState,
  onVerseSelected,
  onBoundaryReached,
  onLogoClick,
}) => {
  const [metadata, setMetadata] = useState<AppMetadata>({});
  const [data, setData] = useState<VerseData[]>([]);
  const [selectedVerseIdx, setSelectedVerseIdx] = useState<number | null>(0);
  const [isLoading, setIsLoading] = useState(false);

  const loadedBooksRef = useRef<Map<string, VerseData[]>>(new Map());
  const lastSelectedIdx = useRef<number | null>(0);
  const prevSelectedIdxRef = useRef<number | null>(null);
  const lastProcessedCommandId = useRef<number | undefined>(undefined);

  const { isVerticalLayout, sidePanelSize, handleResizeStart } = useResizablePanel();

  // Load metadata on mount
  useEffect(() => {
    const base = import.meta.env.BASE_URL ?? '/';
    fetch(`${base}metadata.json`)
      .then((r) => r.json())
      .then((meta: AppMetadata) => {
        setMetadata(meta);
      })
      .catch((e) => console.error('SeferReaderScreen: error loading metadata', e));
  }, []);

  // Helper to resolve book name from state
  const resolveBookName = useCallback((token: string, meta: AppMetadata): string | null => {
    if (!token) return null;
    if (meta[token]) return token;
    return Object.keys(meta).find((bookName) => meta[bookName].bookAbbrevEs === token) ?? null;
  }, []);

  // Fetch and load book data when scriptureState.bookEs or bookAbbrevEs changes
  useEffect(() => {
    if (Object.keys(metadata).length === 0) return;

    const targetBook = resolveBookName(scriptureState.bookEs || scriptureState.bookAbbrevEs, metadata);
    if (!targetBook) return;

    const cached = loadedBooksRef.current.get(targetBook);
    if (cached) {
      setData(cached);
      return;
    }

    setIsLoading(true);
    const base = import.meta.env.BASE_URL ?? '/';
    const safeFile = metadata[targetBook].safeFile;
    fetch(`${base}books/${safeFile}.tsv`)
      .then((r) => r.text())
      .then((text) => {
        const parsed = parseVerses(text);
        loadedBooksRef.current.set(targetBook, parsed);
        setData(parsed);
      })
      .catch((e) => console.error('SeferReaderScreen: error loading book', e))
      .finally(() => setIsLoading(false));
  }, [metadata, scriptureState.bookEs, scriptureState.bookAbbrevEs, resolveBookName]);

  const hasVerseRange = !!scriptureState.verseEnd;

  // Sync selected index when data or scriptureState chapter/verse changes
  useEffect(() => {
    if (data.length === 0) return;

    const idx = data.findIndex(
      (v) => v.chapter === scriptureState.chapter && v.verse === scriptureState.verse
    );

    if (idx !== -1) {
      setSelectedVerseIdx(idx);
    }
  }, [data, scriptureState.chapter, scriptureState.verse]);

  const rangeBounds = useMemo(() => {
    if (!hasVerseRange || data.length === 0) {
      return null;
    }

    const startIdx = data.findIndex((v) => v.chapter === scriptureState.chapter && v.verse === scriptureState.verseStart);
    const endIdx = data.findIndex((v) => v.chapter === scriptureState.chapter && v.verse === scriptureState.verseEnd);
    if (startIdx < 0 || endIdx < 0) return null;

    const resolvedStartIdx = Math.min(startIdx, endIdx);
    const resolvedEndIdx = Math.max(startIdx, endIdx);

    return {
      startIdx: resolvedStartIdx,
      endIdx: resolvedEndIdx,
      length: Math.max(1, resolvedEndIdx - resolvedStartIdx + 1),
    };
  }, [data, hasVerseRange, scriptureState.chapter, scriptureState.verseEnd, scriptureState.verseStart]);

  const buildVersePayload = useCallback((verse: VerseData, idx: number) => ({
    book: verse.bookAbbrevEs,
    chapter: Number(verse.chapter),
    verseStart: scriptureState.verseStart,
    verse: Number(verse.verse),
    verseEnd: hasVerseRange ? scriptureState.verseEnd : undefined,
    bookEs: verse.bookEs,
    bookHeb: verse.bookHeb,
    bookAbbrevEs: verse.bookAbbrevEs,
    verseNikud: verse.verseNikudSanitized ?? verse.verseNikud,
    transliteration: verse.transliteration,
    translation: verse.translation,
    verseIdx: hasVerseRange && rangeBounds ? Math.max(0, idx - rangeBounds.startIdx) : idx,
    totalVerses: hasVerseRange && rangeBounds ? rangeBounds.length : data.length,
    scriptureKind: scriptureState.scriptureKind ?? 'sefer',
  }), [data.length, hasVerseRange, rangeBounds, scriptureState.scriptureKind, scriptureState.verseEnd, scriptureState.verseStart]);

  // Handle command (next/previous) changes
  useEffect(() => {
    if (data.length === 0 || scriptureState.commandId === undefined) return;
    if (scriptureState.commandId === lastProcessedCommandId.current) return;

    lastProcessedCommandId.current = scriptureState.commandId;

    if (scriptureState.command === 'next') {
      setSelectedVerseIdx((prev) => {
        if (prev === null) return 0;
        const nextLimit = hasVerseRange && rangeBounds ? rangeBounds.endIdx : data.length - 1;
        const nextIdx = Math.min(prev + 1, nextLimit);
        if (nextIdx === prev) {
          if (hasVerseRange) onBoundaryReached?.('next');
          return prev;
        }
        // Propagate selection back to App so other screens keep up
        const verse = data[nextIdx];
        if (verse) {
          onVerseSelected(buildVersePayload(verse, nextIdx));
        }
        return nextIdx;
      });
    } else if (scriptureState.command === 'previous') {
      setSelectedVerseIdx((prev) => {
        if (prev === null) return 0;
        const prevLimit = hasVerseRange && rangeBounds ? rangeBounds.startIdx : 0;
        const prevIdx = Math.max(prev - 1, prevLimit);
        if (prevIdx === prev) {
          if (hasVerseRange) onBoundaryReached?.('previous');
          return prev;
        }
        // Propagate selection back to App so other screens keep up
        const verse = data[prevIdx];
        if (verse) {
          onVerseSelected(buildVersePayload(verse, prevIdx));
        }
        return prevIdx;
      });
    }
  }, [buildVersePayload, data, hasVerseRange, onBoundaryReached, onVerseSelected, rangeBounds, scriptureState.command, scriptureState.commandId]);

  // Scrolling logic
  const scrollToTarget = useCallback((idx: number) => {
    let targetElement = document.getElementById(`verse-${idx}`);
    if (targetElement) {
      while (
        targetElement &&
        getComputedStyle(targetElement).display === 'contents' &&
        targetElement.firstElementChild
      ) {
        targetElement = targetElement.firstElementChild as HTMLElement;
      }
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  useEffect(() => {
    const targetIdx = selectedVerseIdx ?? lastSelectedIdx.current;
    const isOpening = prevSelectedIdxRef.current === null && selectedVerseIdx !== null;
    const isClosing = prevSelectedIdxRef.current !== null && selectedVerseIdx === null;

    if (isClosing) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (targetIdx !== null) scrollToTarget(targetIdx);
        });
      });
    } else if (!isOpening) {
      requestAnimationFrame(() => {
        if (targetIdx !== null) scrollToTarget(targetIdx);
      });
    }

    prevSelectedIdxRef.current = selectedVerseIdx;
    if (selectedVerseIdx !== null) {
      lastSelectedIdx.current = selectedVerseIdx;
    }
  }, [scrollToTarget, selectedVerseIdx]);

  // Group verses for SeferFlowView
  const groupedVerses = useMemo(() => {
    if (data.length === 0) return [];
    const groups: { type: 'normal' | 'shira'; verses: { verse: VerseData; idxVerse: number }[] }[] = [];
    let currentGroup: { type: 'normal' | 'shira'; verses: { verse: VerseData; idxVerse: number }[] } | null = null;

    data.forEach((verse, idxVerse) => {
      const isShira = (verse.verseNikud || '').includes('brick-');
      const type = isShira ? 'shira' : 'normal';

      if (!currentGroup || currentGroup.type !== type) {
        if (currentGroup) groups.push(currentGroup);
        currentGroup = { type, verses: [{ verse, idxVerse }] };
      } else {
        currentGroup.verses.push({ verse, idxVerse });
      }
    });

    if (currentGroup) groups.push(currentGroup);
    return groups;
  }, [data]);

  const handleVerseClick = useCallback(
    (_e: React.MouseEvent, idx: number) => {
      setSelectedVerseIdx(idx);
      const verse = data[idx];
      if (verse) {
        onVerseSelected(buildVersePayload(verse, idx));
      }
    },
    [buildVersePayload, data, onVerseSelected]
  );

  const handleVerseTouchEnd = useCallback(
    (_e: React.TouchEvent, idx: number) => {
      setSelectedVerseIdx(idx);
      const verse = data[idx];
      if (verse) {
        onVerseSelected(buildVersePayload(verse, idx));
      }
    },
    [buildVersePayload, data, onVerseSelected]
  );

  const currentSelectedVerse = useMemo(() => {
    if (selectedVerseIdx === null || !data[selectedVerseIdx]) return null;
    return data[selectedVerseIdx];
  }, [data, selectedVerseIdx]);

  const combinedText = useMemo(() => {
    if (!currentSelectedVerse) return '';

    let text = '';
    if (currentSelectedVerse.transliteration) {
      text += `<strong>Transliteración:</strong><br/>${currentSelectedVerse.transliteration}<br/><br/>`;
    }
    if (currentSelectedVerse.translation) {
      text += `<strong>Traducción:</strong><br/>${currentSelectedVerse.translation}`;
    }
    return text;
  }, [currentSelectedVerse]);

  const combinedTextBaseSize = useMemo(() => {
    const rawSize = scriptureState.combinedTextBaseSize;
    const parsed = Number(rawSize);
    if (!Number.isFinite(parsed)) return 40;
    return Math.max(12, Math.min(70, parsed));
  }, [scriptureState.combinedTextBaseSize]);

  const isGreek = useMemo(() => {
    const nativeBookName = currentSelectedVerse?.bookHeb || scriptureState?.bookHeb || '';
    return /[\u0370-\u03FF\u1F00-\u1FFF]/.test(nativeBookName);
  }, [currentSelectedVerse?.bookHeb, scriptureState?.bookHeb]);

  const formatReferenceNav = useCallback((bookName: string, useHebrewNumbers = false) => {
    const chapter = Number(scriptureState.chapter);
    const verse = Number(scriptureState.verse);
    const start = Number(scriptureState.verseStart || scriptureState.verse);
    const end = Number(scriptureState.verseEnd || scriptureState.verseStart || scriptureState.verse);
    const n = (value: number) => {
      if (useHebrewNumbers) {
        return isGreek ? numberToGreekNumeral(value) : numberToHebrewNumeral(value);
      }
      return String(value);
    };
    const hasMultiVerseRange = scriptureState.verseEnd && scriptureState.verseStart !== scriptureState.verseEnd;

    if (hasMultiVerseRange) {
      return `${bookName} ${n(chapter)}:${n(start)}-${n(end)} (${n(verse)})`;
    }

    return `${bookName} ${n(chapter)}:${n(verse)}`;
  }, [scriptureState.chapter, scriptureState.verse, scriptureState.verseEnd, scriptureState.verseStart, isGreek]);

  const spanishNavLabel = currentSelectedVerse
    ? formatReferenceNav(currentSelectedVerse.bookEs || scriptureState.bookEs || scriptureState.bookAbbrevEs)
    : '';
  const hebrewNavLabel = currentSelectedVerse
    ? formatReferenceNav(currentSelectedVerse.bookHeb || scriptureState.bookHeb, true)
    : '';

  if (isLoading || Object.keys(metadata).length === 0 || data.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center text-2xl font-hebrew bg-[#fef3c7] text-amber-900">
        Cargando...
      </div>
    );
  }

  const bookDir = data[0]?.DIR?.toLowerCase() || 'rtl';

  return (
    <main className="h-screen flex flex-col md:flex-row bg-[#fef3c7] font-hebrew overflow-hidden">
      <VerseSidebar
        combinedText={combinedText}
        combinedTextBaseSize={combinedTextBaseSize}
        selectedVerseIdx={selectedVerseIdx}
        lastSelectedIdx={lastSelectedIdx}
        scrollToTarget={scrollToTarget}
        isVerticalLayout={isVerticalLayout}
        sidePanelSize={sidePanelSize}
        handleResizeStart={handleResizeStart}
        navLabel={spanishNavLabel}
      />

      <div className="relative flex-1 flex flex-col overflow-hidden">
        <div className="absolute left-0 right-0 top-0 z-40 border-b border-amber-900/20 bg-[#f7e7b6]/95 px-4 py-2 text-5xl font-bold text-amber-950 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <span></span>
            <span className="text-center" dir={bookDir} >{hebrewNavLabel}</span>
            {onLogoClick && (
              <button
                type="button"
                onClick={onLogoClick}
                className="flex h-8 w-8 items-center justify-center rounded border border-amber-900/20 bg-[#fef3c7] hover:bg-amber-100"
                title="Abrir menú"
              >
                <img src="/logo.svg" alt="Abrir menú" className="h-6 w-6" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto flex flex-col justify-start p-8 pt-20 pb-24 scrollable-container touch-pan-y">
          <SeferFlowView
            groupedVerses={groupedVerses}
            selectedVerseIdx={selectedVerseIdx}
            rangeStartVerse={hasVerseRange ? scriptureState.verseStart : undefined}
            rangeEndVerse={hasVerseRange ? scriptureState.verseEnd : undefined}
            onVerseClick={handleVerseClick}
            onVerseTouchEnd={handleVerseTouchEnd}
            bookDir={bookDir}
            hebrewFontSize={scriptureState.hebrewFontSize}
          />
        </div>
      </div>
    </main>
  );
};

export default SeferReaderScreen;

