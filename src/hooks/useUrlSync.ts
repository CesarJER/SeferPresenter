import { useCallback, useEffect } from 'react';
import type { AppMode, Presentation, ScriptureNavState } from '../types/presentation';
import { formatSlideHash, parseSlideHash, slugify } from '../utils/normalizePresentation';

interface UseUrlSyncProps {
  presentations: Presentation[];
  currentPresentation: Presentation | null;
  currentSlideIndex: number;
  appMode: AppMode;
  scriptureState: ScriptureNavState | null;
  // Refs
  currentPresentationRef: React.MutableRefObject<Presentation | null>;
  currentSlideIndexRef: React.MutableRefObject<number>;
  scriptureStateRef: React.MutableRefObject<ScriptureNavState | null>;
  slideScriptureStateBeforeManualRef: React.MutableRefObject<ScriptureNavState | null>;
  // Callbacks
  handleSelectPresentationAndSlide: (
    p: Presentation | null,
    idx: number,
    direction?: 'forward' | 'backward',
    targetVerse?: string
  ) => void;
}

export function useUrlSync(props: UseUrlSyncProps) {
  const {
    presentations,
    currentPresentation,
    currentSlideIndex,
    appMode,
    scriptureState,
    currentPresentationRef,
    currentSlideIndexRef,
    scriptureStateRef,
    slideScriptureStateBeforeManualRef,
    handleSelectPresentationAndSlide,
  } = props;

  const parseUrlAndSync = useCallback(() => {
    if (presentations.length === 0) return;

    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    if (pathSegments.length === 0) return;

    const urlTitle = decodeURIComponent(pathSegments[0]);
    const matched = presentations.find((p) => slugify(p.title) === slugify(urlTitle));

    if (matched) {
      const { slideIndex, verse } = parseSlideHash(window.location.hash);
      const targetIndex =
        !isNaN(slideIndex) && slideIndex >= 0 && slideIndex < matched.slides.length
          ? slideIndex
          : 0;
      const currentVerse = scriptureStateRef.current?.verse;

      if (
        !currentPresentationRef.current ||
        currentPresentationRef.current.id !== matched.id ||
        currentSlideIndexRef.current !== targetIndex ||
        (!!verse && currentVerse !== verse)
      ) {
        handleSelectPresentationAndSlide(matched, targetIndex, 'forward', verse);
      }
    }
  }, [
    presentations,
    handleSelectPresentationAndSlide,
    currentPresentationRef,
    currentSlideIndexRef,
    scriptureStateRef,
  ]);

  // Sync URL when state changes
  useEffect(() => {
    if (currentPresentation) {
      const slug = slugify(currentPresentation.title);
      const activeSlide =
        currentSlideIndex >= 0 ? currentPresentation.slides[currentSlideIndex] : null;
      const isScriptureSlide = activeSlide?.type === 'sefer' || activeSlide?.type === 'tanaj';
      const hashVerse =
        appMode === 'seferManual'
          ? slideScriptureStateBeforeManualRef.current?.verse
          : scriptureState?.verse;
      const hash =
        currentSlideIndex >= 0
          ? formatSlideHash(currentSlideIndex, isScriptureSlide ? hashVerse : undefined)
          : '';
      const search = window.location.search;
      const normalizedPath = window.location.pathname.replace(/\/$/, '');
      const targetPath = `/${slug}${search}${hash}`;
      if (normalizedPath !== `/${slug}` || window.location.hash !== hash) {
        window.history.replaceState(null, '', targetPath);
      }
    } else {
      // Clear path and hash when no presentation is active
      const search = window.location.search;
      const targetPath = `/${search}`;
      if (window.location.pathname !== '/' || window.location.hash !== '') {
        window.history.replaceState(null, '', targetPath);
      }
    }
  }, [
    appMode,
    currentPresentation,
    currentSlideIndex,
    scriptureState,
    slideScriptureStateBeforeManualRef,
  ]);

  // Handle URL parsing on presentations load
  useEffect(() => {
    parseUrlAndSync();
  }, [presentations, parseUrlAndSync]);

  // Handle popstate & hashchange events (manually entered URLs or back button)
  useEffect(() => {
    const handlePopState = () => parseUrlAndSync();
    const handleHashChange = () => parseUrlAndSync();
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [parseUrlAndSync]);
}
