import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScriptureNavState } from '../types/presentation';
import { useSeferReader } from './useSeferReader';
import type { SeferReaderState } from '../types/scripture';

type SeferCommand = 'navigate' | 'next' | 'previous';
type SeferNavigationMode = 'manual' | 'projected';

interface UseSeferControlLogicProps {
  keyboardMode: SeferNavigationMode | null;
  onProject: (state: SeferReaderState, command?: SeferCommand) => void;
  onDeactivate?: () => void;
  onAddSlide?: (state: SeferReaderState, kind?: 'sefer' | 'tanaj') => void;
  onBoundaryReached?: (direction: 'next' | 'previous') => void;
  restoredState?: ScriptureNavState | null;
  onUpdateFontSizes?: (sizes: { hebrewFontSize: number; combinedTextBaseSize: number }) => void;
}

const makeStateKey = (state: Pick<SeferReaderState, 'bookEs' | 'chapter' | 'verse'> & { verseEnd?: string }) =>
  `${state.bookEs}-${state.chapter}-${state.verse}-${state.verseEnd || ''}`;

const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function useSeferControlLogic({
  keyboardMode,
  onProject,
  onDeactivate,
  onAddSlide,
  onBoundaryReached,
  restoredState,
  onUpdateFontSizes,
}: UseSeferControlLogicProps) {
  const lastSyncedStateRef = useRef<string | null>(null);
  const [hasStarted, setHasStarted] = useState(keyboardMode !== null);
  const [endVerse, setEndVerse] = useState('');
  const [hebrewFontSize, setHebrewFontSize] = useState<number>(() => {
    const val = localStorage.getItem('sefer-presenter-font-hebrew');
    return val ? Number(val) : 42;
  });
  const [combinedTextBaseSize, setCombinedTextBaseSize] = useState<number>(() => {
    const val = localStorage.getItem('sefer-presenter-font-combined');
    return val ? Number(val) : 40;
  });

  // Load on first use, then retain the reader independently of its widgets.
  useEffect(() => {
    if (keyboardMode !== null) setHasStarted(true);
  }, [keyboardMode]);

  const reader = useSeferReader(hasStarted);
  const {
    currentVerse,
    isActive,
    selectedVerse,
    goToVerse,
    goNext,
    goPrev,
    restoreState,
    rangeVerses,
    deactivate,
  } = reader;

  useEffect(() => {
    const restoredHebrewSize = restoredState?.hebrewFontSize;
    if (typeof restoredHebrewSize === 'number' && Number.isFinite(restoredHebrewSize)) {
      const clamped = clampNumber(restoredHebrewSize, 20, 72);
      if (clamped !== hebrewFontSize) {
        setHebrewFontSize(clamped);
      }
    }

    const restoredBaseSize = restoredState?.combinedTextBaseSize;
    if (typeof restoredBaseSize === 'number' && Number.isFinite(restoredBaseSize)) {
      const clamped = clampNumber(restoredBaseSize, 12, 70);
      if (clamped !== combinedTextBaseSize) {
        setCombinedTextBaseSize(clamped);
      }
    }
  }, [restoredState, combinedTextBaseSize, hebrewFontSize]);

  useEffect(() => {
    if (!hasStarted || !restoredState) return;
    const stateKey = makeStateKey(restoredState);
    if (stateKey !== lastSyncedStateRef.current) {
      lastSyncedStateRef.current = stateKey;
      restoreState(restoredState);
      
      if (restoredState.verseEnd && restoredState.verseEnd !== restoredState.verse) {
        setEndVerse(restoredState.verseEnd);
      } else {
        setEndVerse('');
      }
    }
  }, [hasStarted, restoreState, restoredState]);

  useEffect(() => {
    if (endVerse && Number(endVerse) < Number(selectedVerse)) {
      setEndVerse('');
    }
  }, [endVerse, selectedVerse]);

  const updateHebrewFontSize = useCallback((value: number) => {
    const clamped = clampNumber(value, 20, 72);
    setHebrewFontSize(clamped);
    localStorage.setItem('sefer-presenter-font-hebrew', String(clamped));
    onUpdateFontSizes?.({ hebrewFontSize: clamped, combinedTextBaseSize });
  }, [combinedTextBaseSize, onUpdateFontSizes]);

  const updateCombinedTextBaseSize = useCallback((value: number) => {
    const clamped = clampNumber(value, 12, 70);
    setCombinedTextBaseSize(clamped);
    localStorage.setItem('sefer-presenter-font-combined', String(clamped));
    onUpdateFontSizes?.({ hebrewFontSize, combinedTextBaseSize: clamped });
  }, [hebrewFontSize, onUpdateFontSizes]);

  const markAndProject = useCallback((state: SeferReaderState, command: SeferCommand) => {
    lastSyncedStateRef.current = makeStateKey(state);
    onProject(state, command);
  }, [onProject]);

  const handleActivate = useCallback(() => {
    if (isActive) {
      deactivate();
      onDeactivate?.();
      return;
    }
    if (!currentVerse) return;

    const finalState: SeferReaderState = {
      ...currentVerse,
      verseStart: endVerse ? currentVerse.verse : undefined,
      verseEnd: endVerse || undefined,
      totalVerses: endVerse
        ? Math.max(1, Math.abs(Number(endVerse) - Number(currentVerse.verse)) + 1)
        : currentVerse.totalVerses,
    };

    restoreState(finalState);
    markAndProject(finalState, 'navigate');
  }, [currentVerse, deactivate, endVerse, isActive, markAndProject, onDeactivate, restoreState]);

  const handleVerseSelect = useCallback((verse: string, command: SeferCommand = 'navigate') => {
    const state = goToVerse(verse);
    if (state) {
      markAndProject(state, command);
    }
  }, [goToVerse, markAndProject]);

  const hasActiveRange = !!currentVerse?.verseEnd;
  const currentVerseIndex = currentVerse ? rangeVerses.indexOf(currentVerse.verse) : -1;

  const handleNext = useCallback((mode: SeferNavigationMode) => {
    if (currentVerse && hasActiveRange) {
      if (currentVerseIndex >= 0 && currentVerseIndex < rangeVerses.length - 1) {
        handleVerseSelect(rangeVerses[currentVerseIndex + 1], 'next');
        return;
      }
      if (isActive && mode === 'projected') {
        onBoundaryReached?.('next');
      }
      return;
    }

    const state = goNext();
    if (state) {
      lastSyncedStateRef.current = makeStateKey(state);
      if (mode === 'projected' || isActive) {
        onProject(state, 'next');
      }
    }
  }, [
    currentVerse, currentVerseIndex, goNext, handleVerseSelect, hasActiveRange,
    isActive, onBoundaryReached, onProject, rangeVerses,
  ]);

  const handlePrev = useCallback((mode: SeferNavigationMode) => {
    if (currentVerse && hasActiveRange) {
      if (currentVerseIndex > 0) {
        handleVerseSelect(rangeVerses[currentVerseIndex - 1], 'previous');
        return;
      }
      if (isActive && mode === 'projected') {
        onBoundaryReached?.('previous');
      }
      return;
    }

    const state = goPrev();
    if (state) {
      lastSyncedStateRef.current = makeStateKey(state);
      if (mode === 'projected' || isActive) {
        onProject(state, 'previous');
      }
    }
  }, [
    currentVerse, currentVerseIndex, goPrev, handleVerseSelect, hasActiveRange,
    isActive, onBoundaryReached, onProject, rangeVerses,
  ]);

  const handleAddSlide = useCallback((kind: 'sefer' | 'tanaj') => {
    if (!currentVerse || !onAddSlide) return;

    const normalizedEnd = endVerse || currentVerse.verse;
    const slideState: SeferReaderState = {
      ...currentVerse,
      verseStart: currentVerse.verse,
      verseEnd: normalizedEnd,
      totalVerses: normalizedEnd
        ? Math.max(1, Math.abs(Number(normalizedEnd) - Number(currentVerse.verse)) + 1)
        : 1,
    };
    markAndProject(slideState, 'navigate');
    onAddSlide(slideState, kind);
  }, [currentVerse, endVerse, markAndProject, onAddSlide]);

  useEffect(() => {
    if (keyboardMode === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement).tagName.toUpperCase();
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext(keyboardMode);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev(keyboardMode);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev, keyboardMode]);

  const handleSetEndVerse = useCallback((value: string) => {
    setEndVerse(value);
    if (isActive) {
      deactivate();
    }
  }, [isActive, deactivate]);

  const handleActiveRangeChange = useCallback((startVerse: string, endVerse: string) => {
    const state = reader.updateActiveRange(startVerse, endVerse);
    if (state && isActive) {
      markAndProject(state, 'navigate');
    }
  }, [isActive, markAndProject, reader]);

  return {
    ...reader,
    hebrewFontSize,
    combinedTextBaseSize,
    updateHebrewFontSize,
    updateCombinedTextBaseSize,
    endVerse,
    setEndVerse: handleSetEndVerse,
    handleActivate,
    handleActiveRangeChange,
    handleNext,
    handlePrev,
    handleVerseSelect,
    handleAddSlide,
    hasActiveRange,
    currentVerseIndex,
    canAdjustFont: restoredState?.scriptureKind !== 'tanaj',
  };
}

export type SeferControlController = ReturnType<typeof useSeferControlLogic>;
