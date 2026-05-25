import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ScriptureNavState } from '../App';
import type { VerseData, AppMetadata } from '../hooks/useSeferReader';
import { parseVerses } from '../utils/scriptureParser';
import { SeferFlowView } from './SeferFlowView';
import { VerseSidebar } from './VerseSidebar';
import { useResizablePanel } from '../hooks/useResizablePanel';

interface SeferReaderScreenProps {
  scriptureState: ScriptureNavState;
  onVerseSelected: (payload: any) => void;
}

export const SeferReaderScreen: React.FC<SeferReaderScreenProps> = ({
  scriptureState,
  onVerseSelected,
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

  // Handle command (next/previous) changes
  useEffect(() => {
    if (data.length === 0 || scriptureState.commandId === undefined) return;
    if (scriptureState.commandId === lastProcessedCommandId.current) return;

    lastProcessedCommandId.current = scriptureState.commandId;

    if (scriptureState.command === 'next') {
      setSelectedVerseIdx((prev) => {
        if (prev === null) return 0;
        const nextIdx = Math.min(prev + 1, data.length - 1);
        // Propagate selection back to App so other screens keep up
        const verse = data[nextIdx];
        if (verse) {
          onVerseSelected({
            book: verse.bookAbbrevEs,
            chapter: Number(verse.chapter),
            verse: Number(verse.verse),
            bookEs: verse.bookEs,
            bookHeb: verse.bookHeb,
            bookAbbrevEs: verse.bookAbbrevEs,
            verseNikud: verse.verseNikudSanitized ?? verse.verseNikud,
            transliteration: verse.transliteration,
            translation: verse.translation,
            verseIdx: nextIdx,
            totalVerses: data.length,
          });
        }
        return nextIdx;
      });
    } else if (scriptureState.command === 'previous') {
      setSelectedVerseIdx((prev) => {
        if (prev === null) return 0;
        const prevIdx = Math.max(prev - 1, 0);
        // Propagate selection back to App so other screens keep up
        const verse = data[prevIdx];
        if (verse) {
          onVerseSelected({
            book: verse.bookAbbrevEs,
            chapter: Number(verse.chapter),
            verse: Number(verse.verse),
            bookEs: verse.bookEs,
            bookHeb: verse.bookHeb,
            bookAbbrevEs: verse.bookAbbrevEs,
            verseNikud: verse.verseNikudSanitized ?? verse.verseNikud,
            transliteration: verse.transliteration,
            translation: verse.translation,
            verseIdx: prevIdx,
            totalVerses: data.length,
          });
        }
        return prevIdx;
      });
    }
  }, [data, scriptureState.command, scriptureState.commandId, onVerseSelected]);

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

  // Combined text for sidebar
  const combinedText = useMemo(() => {
    if (selectedVerseIdx === null || !data[selectedVerseIdx]) return '';
    const verse = data[selectedVerseIdx];
    let text = '';
    if (verse.transliteration) {
      text += `<strong>Transliteración:</strong><br/>${verse.transliteration}<br/><br/>`;
    }
    if (verse.translation) {
      text += `<strong>Traducción:</strong><br/>${verse.translation}`;
    }
    return text;
  }, [data, selectedVerseIdx]);

  const handleVerseClick = useCallback(
    (_e: React.MouseEvent, idx: number) => {
      setSelectedVerseIdx(idx);
      const verse = data[idx];
      if (verse) {
        onVerseSelected({
          book: verse.bookAbbrevEs,
          chapter: Number(verse.chapter),
          verse: Number(verse.verse),
          bookEs: verse.bookEs,
          bookHeb: verse.bookHeb,
          bookAbbrevEs: verse.bookAbbrevEs,
          verseNikud: verse.verseNikudSanitized ?? verse.verseNikud,
          transliteration: verse.transliteration,
          translation: verse.translation,
          verseIdx: idx,
          totalVerses: data.length,
        });
      }
    },
    [data, onVerseSelected]
  );

  const handleVerseTouchEnd = useCallback(
    (_e: React.TouchEvent, idx: number) => {
      setSelectedVerseIdx(idx);
      const verse = data[idx];
      if (verse) {
        onVerseSelected({
          book: verse.bookAbbrevEs,
          chapter: Number(verse.chapter),
          verse: Number(verse.verse),
          bookEs: verse.bookEs,
          bookHeb: verse.bookHeb,
          bookAbbrevEs: verse.bookAbbrevEs,
          verseNikud: verse.verseNikudSanitized ?? verse.verseNikud,
          transliteration: verse.transliteration,
          translation: verse.translation,
          verseIdx: idx,
          totalVerses: data.length,
        });
      }
    },
    [data, onVerseSelected]
  );

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
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto flex flex-col justify-start p-8 pt-16 pb-24 scrollable-container touch-pan-y">
          <SeferFlowView
            groupedVerses={groupedVerses}
            selectedVerseIdx={selectedVerseIdx}
            onVerseClick={handleVerseClick}
            onVerseTouchEnd={handleVerseTouchEnd}
            bookDir={bookDir}
          />
        </div>
      </div>

      <VerseSidebar
        combinedText={combinedText}
        selectedVerseIdx={selectedVerseIdx}
        lastSelectedIdx={lastSelectedIdx}
        scrollToTarget={scrollToTarget}
        isVerticalLayout={isVerticalLayout}
        sidePanelSize={sidePanelSize}
        handleResizeStart={handleResizeStart}
      />
    </main>
  );
};

export default SeferReaderScreen;
