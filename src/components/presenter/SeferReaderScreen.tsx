import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ScriptureNavState, SeferOnlineRefPayload } from '../../types/presentation';
import type { VerseData, AppMetadata } from '../../hooks/useSeferReader';
import { parseVerses } from '../../utils/scriptureParser';
import { getMetadata, loadBookData, resolveBookName } from '../../utils/metadataCache';
import { SeferFlowView } from './SeferFlowView';
import { VerseSidebar } from './VerseSidebar';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { numberToHebrewNumeral, numberToGreekNumeral } from '../../hooks/scriptureNumerals';
import AutoResizeText from '../shared/AutoResizeText';
import { applyNeutralBrandingFallback } from '../../utils/branding';

interface SeferReaderScreenProps {
  scriptureState: ScriptureNavState;
  onVerseSelected: (payload: SeferOnlineRefPayload) => void;
  onBoundaryReached?: (direction: 'next' | 'previous') => void;
  onLogoClick?: () => void;
  liveAudioPanel?: React.ReactNode;
  interactive?: boolean;
}

export const SeferReaderScreen: React.FC<SeferReaderScreenProps> = ({
  scriptureState,
  onVerseSelected,
  onBoundaryReached,
  onLogoClick,
  liveAudioPanel,
  interactive = true,
}) => {
  useUiTranslation('presenter');
  const [metadata, setMetadata] = useState<AppMetadata>({});
  const [data, setData] = useState<VerseData[]>([]);
  const [selectedVerseIdx, setSelectedVerseIdx] = useState<number | null>(0);
  const [isLoading, setIsLoading] = useState(false);

  const lastSelectedIdx = useRef<number | null>(0);
  const prevSelectedIdxRef = useRef<number | null>(null);
  const lastProcessedCommandId = useRef<number | undefined>(undefined);

  const { isVerticalLayout, sidePanelSize, handleResizeStart } = useResizablePanel();

  // Load metadata on mount
  useEffect(() => {
    getMetadata()
      .then((meta: AppMetadata) => {
        setMetadata(meta);
      })
      .catch((e) => console.error('SeferReaderScreen: error loading metadata', e));
  }, []);

  const currentLoadedBookRef = useRef<string | null>(null);

  // Fetch and load book data when scriptureState.bookEs or bookAbbrevEs changes
  useEffect(() => {
    if (Object.keys(metadata).length === 0) return;

    const targetBook = resolveBookName(scriptureState.bookEs || scriptureState.bookAbbrevEs, metadata);
    if (!targetBook) return;

    if (currentLoadedBookRef.current === targetBook && data.length > 0) return;

    setIsLoading(true);
    loadBookData(targetBook, parseVerses)
      .then((parsed) => {
        setData(parsed);
        currentLoadedBookRef.current = targetBook;
      })
      .catch((e) => console.error('SeferReaderScreen: error loading book', e))
      .finally(() => setIsLoading(false));
  }, [metadata, scriptureState.bookEs, scriptureState.bookAbbrevEs, data.length]);

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
    if (!interactive || data.length === 0 || scriptureState.commandId === undefined) return;
    if (scriptureState.commandId === lastProcessedCommandId.current) return;

    lastProcessedCommandId.current = scriptureState.commandId;

    const direction = scriptureState.command;
    if (direction !== 'next' && direction !== 'previous') return;
    const baseIdx = data.findIndex(v => v.chapter === scriptureState.chapter && v.verse === scriptureState.verse);
    if (baseIdx < 0) return;
    const limit = direction === 'next'
      ? (hasVerseRange && rangeBounds ? rangeBounds.endIdx : data.length - 1)
      : (hasVerseRange && rangeBounds ? rangeBounds.startIdx : 0);
    const nextIdx = direction === 'next' ? Math.min(baseIdx + 1, limit) : Math.max(baseIdx - 1, limit);
    if (nextIdx === baseIdx) {
      if (hasVerseRange) onBoundaryReached?.(direction);
      return;
    }
    setSelectedVerseIdx(nextIdx);
    onVerseSelected(buildVersePayload(data[nextIdx], nextIdx));
  }, [interactive, buildVersePayload, data, hasVerseRange, onBoundaryReached, onVerseSelected, rangeBounds, scriptureState.command, scriptureState.commandId, scriptureState.chapter, scriptureState.verse]);

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
      const scrollContainer = document.querySelector('.scrollable-container');
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        const targetTop = scrollContainer.scrollTop + (targetRect.top - containerRect.top) - (containerRect.height / 2) + (targetRect.height / 2);
        
        scrollContainer.scrollTo({
          top: targetTop,
          behavior: 'smooth'
        });
      }
    }
  }, []);

  useEffect(() => {
    const targetIdx = selectedVerseIdx ?? lastSelectedIdx.current;
    
    let timer: NodeJS.Timeout | undefined;
    if (targetIdx !== null) {
      timer = setTimeout(() => {
        scrollToTarget(targetIdx);
      }, 80);
    }

    prevSelectedIdxRef.current = selectedVerseIdx;
    if (selectedVerseIdx !== null) {
      lastSelectedIdx.current = selectedVerseIdx;
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
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
      if (!interactive) return;
      setSelectedVerseIdx(idx);
      const verse = data[idx];
      if (verse) {
        onVerseSelected(buildVersePayload(verse, idx));
      }
    },
    [interactive, buildVersePayload, data, onVerseSelected]
  );

  const handleVerseTouchEnd = useCallback(
    (_e: React.TouchEvent, idx: number) => {
      if (!interactive) return;
      setSelectedVerseIdx(idx);
      const verse = data[idx];
      if (verse) {
        onVerseSelected(buildVersePayload(verse, idx));
      }
    },
    [interactive, buildVersePayload, data, onVerseSelected]
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
    const nativeBookName = currentSelectedVerse?.bookHeb || scriptureState.bookHeb || '';
    return /[\u0370-\u03FF\u1F00-\u1FFF]/.test(nativeBookName);
  }, [currentSelectedVerse?.bookHeb, scriptureState.bookHeb]);

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
  const originalNavLabel = currentSelectedVerse
    ? formatReferenceNav(currentSelectedVerse.bookHeb || scriptureState.bookHeb, true)
    : '';

  const activeHebrewFontSize = useMemo(() => {
    const baseSize = scriptureState.hebrewFontSize ?? 42;
    return isVerticalLayout ? Math.max(18, Math.round(baseSize * 0.65)) : baseSize;
  }, [scriptureState.hebrewFontSize, isVerticalLayout]);

  if (isLoading || Object.keys(metadata).length === 0 || data.length === 0) {
    return (
      <div className="h-dvh flex items-center justify-center text-2xl font-hebrew bg-[#fef3c7] text-amber-900">
        {translate("presenter:SeferReaderScreen.loading", "Cargando...")}</div>
    );
  }

  const bookDir = data[0]?.DIR?.toLowerCase() || 'rtl';

  return (
    <main className="h-dvh flex flex-col md:flex-row bg-[#fef3c7] font-hebrew overflow-hidden">
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

      <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
        <div className="flex-none h-12 md:h-16 border-b border-amber-900/20 bg-[#f7e7b6]/95 px-4 py-2 shadow-xs flex items-center justify-between gap-3">
          <div className="w-8" />
          <div className="flex-1 h-full min-w-0">
            <AutoResizeText
              text={originalNavLabel}
              allowGrow={true}
              maxFontSize={isVerticalLayout ? 28 : 48}
              minFontSize={12}
              className="whitespace-nowrap font-bold text-amber-950 text-center"
              html={false}
            />
          </div>
          {onLogoClick ? (
            <button
              type="button"
              onClick={onLogoClick}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-sm border border-amber-900/20 bg-[#fef3c7] hover:bg-amber-100 pointer-events-auto"
              title={translate("presenter:SeferReaderScreen.openMenu", "Abrir menú")}
            >
              <img
                src="/api/branding/logo.svg"
                alt={translate("presenter:SeferReaderScreen.openMenu", "Abrir menú")}
                className="h-6 w-6"
                onError={applyNeutralBrandingFallback}
              />
            </button>
          ) : (
            <div className="w-8" />
          )}
        </div>
        <div className="flex-1 overflow-y-auto flex flex-col justify-start px-4 md:px-8 scrollable-container touch-pan-y pb-24">
          <SeferFlowView
            groupedVerses={groupedVerses}
            selectedVerseIdx={selectedVerseIdx}
            rangeStartVerse={hasVerseRange ? scriptureState.verseStart : undefined}
            rangeEndVerse={hasVerseRange ? scriptureState.verseEnd : undefined}
            onVerseClick={handleVerseClick}
            onVerseTouchEnd={handleVerseTouchEnd}
            bookDir={bookDir}
            hebrewFontSize={activeHebrewFontSize}
          />
        </div>
        {liveAudioPanel && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-60 pointer-events-auto flex justify-center w-full max-w-full px-4">
            {liveAudioPanel}
          </div>
        )}
      </div>
    </main>
  );
};

export default SeferReaderScreen;

