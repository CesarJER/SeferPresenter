import { useCallback, useRef, useEffect } from 'react';
import type { AppMode, Presentation, ScriptureNavState, SeferOnlineRefPayload, Slide, VideoState, PresentationStep } from '../types/presentation';
import type { SeferReaderState } from './useSeferReader';
import { getScriptureChapterVerses } from '../utils/scriptureLookup';
import type { AudioState } from '../types/audio';

interface UseScriptureNavigationProps {
  isControlMode: boolean;
  currentPresentationRef: React.MutableRefObject<Presentation | null>;
  currentSlideIndexRef: React.MutableRefObject<number>;
  backgroundLockRef: React.MutableRefObject<boolean>;
  lockedBackgroundValueRef: React.MutableRefObject<string | null>;
  userSelectedBackgroundRef: React.MutableRefObject<string | null>;
  videoStateRef: React.MutableRefObject<VideoState | null>;
  appModeRef: React.MutableRefObject<AppMode>;
  scriptureStateRef: React.MutableRefObject<ScriptureNavState | null>;
  setAppMode: (mode: AppMode) => void;
  setScriptureState: (state: ScriptureNavState | null) => void;
  syncState: (opts: {
    presentation: Presentation | null;
    slideIndex: number;
    bgLock: boolean;
    lockedBg: string | null;
    userSelectedBg: string | null;
    videoState?: VideoState | null;
    appMode?: AppMode;
    scriptureState?: ScriptureNavState | null;
    audioState?: AudioState;
    stepIndex?: number;
  }) => void;
  handleSelectPresentationAndSlide: (p: Presentation | null, idx: number, direction?: 'forward' | 'backward', targetVerse?: string) => void;
  handleSave: (presentation: Presentation) => void;
  steps: PresentationStep[];
  currentStepIndex: number;
  setCurrentStepIndex: (idx: number) => void;
  slideScriptureStateBeforeManualRef: React.MutableRefObject<ScriptureNavState | null>;
}

export function useScriptureNavigation(props: UseScriptureNavigationProps) {
  const {
    isControlMode,
    currentPresentationRef,
    currentSlideIndexRef,
    backgroundLockRef,
    lockedBackgroundValueRef,
    userSelectedBackgroundRef,
    videoStateRef,
    appModeRef,
    scriptureStateRef,
    setAppMode,
    setScriptureState,
    syncState,
    handleSelectPresentationAndSlide,
    handleSave,
    steps,
    currentStepIndex,
    setCurrentStepIndex,
    slideScriptureStateBeforeManualRef,
  } = props;

  const scriptureCommandIdRef = useRef(0);

  const buildScriptureSlideState = useCallback((
    slide: Slide | null,
    direction: 'forward' | 'backward' = 'forward',
    targetVerse?: string
  ): ScriptureNavState | null => {
    if (!slide || (slide.type !== 'sefer' && slide.type !== 'tanaj' && !slide.scriptureBook)) return null;

    const verseStart = slide.scriptureVerseStart || '1';
    const verseEnd = slide.scriptureVerseEnd || verseStart;
    const startNum = Number(verseStart);
    const endNum = Number(verseEnd || verseStart);
    const totalVerses = Number.isFinite(startNum) && Number.isFinite(endNum)
      ? Math.max(1, Math.abs(endNum - startNum) + 1)
      : 1;
    const enteringAtEnd = direction === 'backward';
    const targetNum = Number(targetVerse);
    const hasTargetVerse = !!targetVerse && Number.isFinite(targetNum) && Number.isFinite(startNum) && Number.isFinite(endNum);
    const targetInsideRange = hasTargetVerse
      && targetNum >= Math.min(startNum, endNum)
      && targetNum <= Math.max(startNum, endNum);
    const activeVerse = targetInsideRange ? String(targetVerse) : enteringAtEnd ? verseEnd : verseStart;
    const activeVerseIdx = targetInsideRange
      ? Math.abs(targetNum - startNum)
      : enteringAtEnd ? totalVerses - 1 : 0;

    return {
      bookEs: slide.scriptureBook || 'Gn',
      bookHeb: '',
      bookAbbrevEs: slide.scriptureBook || 'Gn',
      chapter: slide.scriptureChapter || '1',
      verseStart,
      verse: activeVerse,
      verseEnd,
      verseNikud: slide.lines[0] || '',
      transliteration: slide.lines[1] || '',
      translation: slide.lines[2] || '',
      verseIdx: activeVerseIdx,
      totalVerses,
      scriptureKind: slide.type === 'tanaj' ? 'tanaj' : 'sefer',
      command: 'navigate',
      commandId: ++scriptureCommandIdRef.current,
      hebrewFontSize: scriptureStateRef.current?.hebrewFontSize ?? 42,
      combinedTextBaseSize: scriptureStateRef.current?.combinedTextBaseSize ?? 50,
    };
  }, [scriptureStateRef]);

  const handleProjectScripture = useCallback((
    state: SeferReaderState,
    command: ScriptureNavState['command'] = 'navigate'
  ) => {
    const projectedCommand: ScriptureNavState['command'] = isControlMode ? 'navigate' : command;
    const verseStart = state.verseStart ?? state.verse;
    const verseEnd = state.verseEnd || undefined;
    const navState: ScriptureNavState = {
      bookEs: state.bookEs,
      bookHeb: state.bookHeb,
      bookAbbrevEs: state.bookAbbrevEs,
      chapter: state.chapter,
      verseStart,
      verse: state.verse,
      verseEnd,
      verseNikud: state.verseNikud,
      transliteration: state.transliteration,
      translation: state.translation,
      verseIdx: state.verseIdx,
      totalVerses: state.totalVerses,
      scriptureKind: state.scriptureKind ?? 'sefer',
      command: projectedCommand,
      commandId: ++scriptureCommandIdRef.current,
      hebrewFontSize: scriptureStateRef.current?.hebrewFontSize ?? 42,
      combinedTextBaseSize: scriptureStateRef.current?.combinedTextBaseSize ?? 50,
    };
    const nextMode: AppMode = appModeRef.current === 'seferManual' ? 'seferManual' : 'scripture';
    setScriptureState(navState);
    syncState({
      presentation: currentPresentationRef.current,
      slideIndex: currentSlideIndexRef.current,
      bgLock: backgroundLockRef.current,
      lockedBg: lockedBackgroundValueRef.current,
      userSelectedBg: userSelectedBackgroundRef.current,
      videoState: videoStateRef.current,
      appMode: nextMode,
      scriptureState: navState,
    });
    if (appModeRef.current !== nextMode) setAppMode(nextMode);
  }, [isControlMode, syncState, currentPresentationRef, currentSlideIndexRef, backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef, appModeRef, setAppMode, setScriptureState, scriptureStateRef]);

  const handleUpdateScriptureFontSizes = useCallback((sizes: {
    hebrewFontSize: number;
    combinedTextBaseSize: number;
  }) => {
    const previous = scriptureStateRef.current;
    if (
      previous?.hebrewFontSize === sizes.hebrewFontSize &&
      previous?.combinedTextBaseSize === sizes.combinedTextBaseSize
    ) {
      return;
    }

    const nextState: ScriptureNavState = {
      ...(previous ?? {
        bookEs: '',
        bookHeb: '',
        bookAbbrevEs: '',
        chapter: '1',
        verseStart: '1',
        verse: '1',
        verseEnd: undefined,
        verseNikud: '',
        transliteration: '',
        translation: '',
        verseIdx: 0,
        totalVerses: 0,
      }),
      ...sizes,
    };

    setScriptureState(nextState);
    syncState({
      presentation: currentPresentationRef.current,
      slideIndex: currentSlideIndexRef.current,
      bgLock: backgroundLockRef.current,
      lockedBg: lockedBackgroundValueRef.current,
      userSelectedBg: userSelectedBackgroundRef.current,
      videoState: videoStateRef.current,
      appMode: appModeRef.current,
      scriptureState: nextState,
    });
  }, [syncState, currentPresentationRef, currentSlideIndexRef, backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef, appModeRef, setScriptureState, scriptureStateRef]);

  const handleSeferOnlineRef = useCallback((payload: SeferOnlineRefPayload) => {
    const previous = scriptureStateRef.current;
    const numberOrFallback = (value: unknown, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const bookAbbrevEs = String(payload.bookAbbrevEs ?? payload.book ?? previous?.bookAbbrevEs ?? '');
    if (!bookAbbrevEs && !payload.bookEs && !previous) return;

    const navState: ScriptureNavState = {
      bookEs: String(payload.bookEs ?? previous?.bookEs ?? bookAbbrevEs),
      bookHeb: String(payload.bookHeb ?? previous?.bookHeb ?? ''),
      bookAbbrevEs,
      chapter: String(payload.chapter ?? previous?.chapter ?? '1'),
      verseStart: String(payload.verseStart ?? previous?.verseStart ?? payload.verse ?? previous?.verse ?? '1'),
      verse: String(payload.verse ?? previous?.verse ?? '1'),
      verseEnd: payload.verseEnd !== undefined ? String(payload.verseEnd) || undefined : undefined,
      verseNikud: String(payload.verseNikud ?? previous?.verseNikud ?? ''),
      transliteration: String(payload.transliteration ?? previous?.transliteration ?? ''),
      translation: String(payload.translation ?? previous?.translation ?? ''),
      verseIdx: numberOrFallback(payload.verseIdx, previous?.verseIdx ?? 0),
      totalVerses: numberOrFallback(payload.totalVerses, previous?.totalVerses ?? 0),
      scriptureKind: payload.scriptureKind ?? previous?.scriptureKind ?? 'sefer',
      command: undefined,
      commandId: previous?.commandId,
      hebrewFontSize: previous?.hebrewFontSize ?? 42,
      combinedTextBaseSize: previous?.combinedTextBaseSize ?? 50,
    };

    const normalizeBook = (b?: string) => b ? b.toLowerCase().replace(/\s+/g, '') : '';
    const targetBookNorm = normalizeBook(navState.bookEs || navState.bookAbbrevEs);

    let matchingStepIndex: number | undefined;
    if (steps && steps.length > 0 && targetBookNorm) {
      const foundIdx = steps.findIndex(
        (s) =>
          s.slideIndex === currentSlideIndexRef.current &&
          s.type === 'scripture' &&
          normalizeBook(s.book) === targetBookNorm &&
          s.chapter === navState.chapter &&
          s.verse === navState.verse
      );
      if (foundIdx >= 0) {
        matchingStepIndex = foundIdx;
        if (foundIdx !== currentStepIndex) {
          setCurrentStepIndex(foundIdx);
        }
      }
    }

    if (JSON.stringify(previous) === JSON.stringify(navState)) return;

    const nextMode: AppMode = appModeRef.current === 'seferManual' ? 'seferManual' : 'scripture';
    setScriptureState(navState);
    syncState({
      presentation: currentPresentationRef.current,
      slideIndex: currentSlideIndexRef.current,
      bgLock: backgroundLockRef.current,
      lockedBg: lockedBackgroundValueRef.current,
      userSelectedBg: userSelectedBackgroundRef.current,
      videoState: videoStateRef.current,
      appMode: nextMode,
      scriptureState: navState,
      stepIndex: appModeRef.current !== 'seferManual' ? matchingStepIndex : undefined,
    });
  }, [syncState, currentPresentationRef, currentSlideIndexRef, backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef, appModeRef, setScriptureState, scriptureStateRef, steps, currentStepIndex, setCurrentStepIndex]);

  const handleAddScriptureSlide = useCallback((state: SeferReaderState, kind: 'sefer' | 'tanaj' = 'sefer') => {
    const presentation = currentPresentationRef.current;
    if (!presentation) return;
    const verseStart = state.verseStart || state.verse;
    const verseEnd = state.verseEnd || verseStart;
    const rangeLabel = verseEnd !== verseStart ? `${verseStart}-${verseEnd}` : verseStart;
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const newSlide: Slide = {
      id: `slide-${kind}-${state.bookAbbrevEs || state.bookEs}-${state.chapter}-${rangeLabel}-${Date.now()}-${randomSuffix}`,
      label: `${state.bookAbbrevEs} ${state.chapter}:${rangeLabel}`,
      lines: [
        state.verseNikud,
        state.transliteration,
        state.translation,
      ],
      type: kind,
      scriptureBook: state.bookAbbrevEs || state.bookEs,
      scriptureChapter: state.chapter,
      scriptureVerseStart: verseStart,
      scriptureVerseEnd: verseEnd,
    };
    const insertAt = currentSlideIndexRef.current >= 0 ? currentSlideIndexRef.current + 1 : presentation.slides.length;
    const updatedSlides = [
      ...presentation.slides.slice(0, insertAt),
      newSlide,
      ...presentation.slides.slice(insertAt),
    ];
    const updatedPresentation: Presentation = { ...presentation, mode: 'trilingual', slides: updatedSlides };
    handleSave(updatedPresentation);
  }, [handleSave, currentPresentationRef, currentSlideIndexRef]);

  const handleScriptureBoundary = useCallback((direction: 'next' | 'previous') => {
    const presentation = currentPresentationRef.current;
    if (!presentation || presentation.slides.length === 0) return;

    const nextIndex = direction === 'next'
      ? currentSlideIndexRef.current + 1
      : currentSlideIndexRef.current - 1;

    if (nextIndex < 0 || nextIndex >= presentation.slides.length) return;

    handleSelectPresentationAndSlide(
      presentation,
      nextIndex,
      direction === 'next' ? 'forward' : 'backward'
    );
  }, [handleSelectPresentationAndSlide, currentPresentationRef, currentSlideIndexRef]);

  const handleScriptureEscape = useCallback(() => {
    if (appModeRef.current === 'seferManual') {
      const activeSlide = currentPresentationRef.current && currentSlideIndexRef.current >= 0
        ? currentPresentationRef.current.slides[currentSlideIndexRef.current]
        : null;
      const restoredState = slideScriptureStateBeforeManualRef.current ?? buildScriptureSlideState(activeSlide, 'forward');
      const returnsToScripture = !!restoredState && !!activeSlide && (activeSlide.type === 'sefer' || activeSlide.type === 'tanaj');
      const nextMode: AppMode = returnsToScripture ? 'scripture' : 'slides';

      if (restoredState) {
        setScriptureState(restoredState);
      }
      setAppMode(nextMode);
      syncState({
        presentation: currentPresentationRef.current,
        slideIndex: currentSlideIndexRef.current,
        bgLock: backgroundLockRef.current,
        lockedBg: lockedBackgroundValueRef.current,
        userSelectedBg: userSelectedBackgroundRef.current,
        videoState: videoStateRef.current,
        appMode: nextMode,
        scriptureState: restoredState ?? scriptureStateRef.current,
      });
    } else {
      const activeSlide = currentPresentationRef.current && currentSlideIndexRef.current >= 0
        ? currentPresentationRef.current.slides[currentSlideIndexRef.current]
        : null;
      const isScriptureSlide = activeSlide && (activeSlide.type === 'sefer' || activeSlide.type === 'tanaj');
      if (isScriptureSlide) {
        return;
      }

      setAppMode('slides');
      syncState({
        presentation: currentPresentationRef.current,
        slideIndex: currentSlideIndexRef.current,
        bgLock: backgroundLockRef.current,
        lockedBg: lockedBackgroundValueRef.current,
        userSelectedBg: userSelectedBackgroundRef.current,
        videoState: videoStateRef.current,
        appMode: 'slides',
        scriptureState: scriptureStateRef.current,
      });
    }
  }, [appModeRef, slideScriptureStateBeforeManualRef, buildScriptureSlideState, currentPresentationRef, currentSlideIndexRef, setScriptureState, setAppMode, syncState, backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef, scriptureStateRef]);

  const handleScriptureArrowNav = useCallback((direction: 'next' | 'previous') => {
    const currentScripture = scriptureStateRef.current;
    if (!currentScripture) return;

    const navState: ScriptureNavState = {
      ...currentScripture,
      command: direction,
      commandId: ++scriptureCommandIdRef.current,
    };
    setScriptureState(navState);
    syncState({
      presentation: currentPresentationRef.current,
      slideIndex: currentSlideIndexRef.current,
      bgLock: backgroundLockRef.current,
      lockedBg: lockedBackgroundValueRef.current,
      userSelectedBg: userSelectedBackgroundRef.current,
      videoState: videoStateRef.current,
      appMode: appModeRef.current,
      scriptureState: navState,
    });
  }, [scriptureStateRef, setScriptureState, syncState, currentPresentationRef, currentSlideIndexRef, backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef, appModeRef]);

  const scriptureStateForHydration = scriptureStateRef.current;
  const activeSlideForHydration = currentPresentationRef.current && currentSlideIndexRef.current >= 0
    ? currentPresentationRef.current.slides[currentSlideIndexRef.current]
    : null;
  const appModeForHydration = appModeRef.current;

  // Scripture Hydration Effect
  useEffect(() => {
    const scriptureState = scriptureStateForHydration;
    const activeSlide = activeSlideForHydration;
      
    if (!scriptureState || !activeSlide || (activeSlide.type !== 'sefer' && activeSlide.type !== 'tanaj')) return;
    if (appModeForHydration === 'seferManual') return;

    let cancelled = false;
    getScriptureChapterVerses(scriptureState.bookAbbrevEs || scriptureState.bookEs, scriptureState.chapter)
      .then((verses) => {
        if (cancelled) return;
        const verse = verses.find((row) => row.verse === scriptureState.verse);
        if (!verse) return;

        const hydratedState: ScriptureNavState = {
          ...scriptureState,
          bookEs: verse.bookEs,
          bookHeb: verse.bookHeb,
          bookAbbrevEs: verse.bookAbbrevEs,
          chapter: verse.chapter,
          verse: verse.verse,
          verseNikud: verse.verseNikud,
          transliteration: verse.transliteration,
          translation: verse.translation,
          scriptureKind: activeSlide.type === 'tanaj' ? 'tanaj' : 'sefer',
        };

        if (
          hydratedState.verseNikud === scriptureState.verseNikud &&
          hydratedState.transliteration === scriptureState.transliteration &&
          hydratedState.translation === scriptureState.translation &&
          hydratedState.scriptureKind === scriptureState.scriptureKind
        ) {
          return;
        }

        setScriptureState(hydratedState);
      })
      .catch((err) => console.error('Error hydrating scripture verse', err));

    return () => {
      cancelled = true;
    };
  }, [
    scriptureStateForHydration,
    activeSlideForHydration,
    appModeForHydration,
    isControlMode,
    syncState,
    setScriptureState,
    backgroundLockRef,
    lockedBackgroundValueRef,
    userSelectedBackgroundRef,
    videoStateRef,
    currentPresentationRef,
    currentSlideIndexRef,
  ]);

  return {
    buildScriptureSlideState,
    handleProjectScripture,
    handleUpdateScriptureFontSizes,
    handleSeferOnlineRef,
    handleAddScriptureSlide,
    handleScriptureBoundary,
    handleScriptureEscape,
    handleScriptureArrowNav,
  };
}
