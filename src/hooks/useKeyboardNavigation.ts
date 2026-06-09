import { useEffect } from 'react';
import type { AppMode, Presentation, ScriptureNavState } from '../types/presentation';

interface UseKeyboardNavigationProps {
  isControlMode: boolean;
  enabled?: boolean;
  currentPresentation: Presentation | null;
  currentSlideIndex: number;
  appModeRef: React.MutableRefObject<AppMode>;
  scriptureStateRef: React.MutableRefObject<ScriptureNavState | null>;
  currentPresentationRef: React.MutableRefObject<Presentation | null>;
  currentSlideIndexRef: React.MutableRefObject<number>;
  handleSelectPresentationAndSlide: (
    p: Presentation | null,
    idx: number,
    direction?: 'forward' | 'backward'
  ) => void;
  handleScriptureEscape: () => void;
  handleScriptureArrowNav: (direction: 'next' | 'previous') => void;
  quizCurrentSubslideIndex?: number;
  quizSubslideCount?: number;
  onQuizSubslideSelect?: (idx: number) => void;
}

export function useKeyboardNavigation(props: UseKeyboardNavigationProps) {
  const {
    isControlMode,
    enabled = true,
    currentPresentation,
    currentSlideIndex,
    appModeRef,
    scriptureStateRef,
    handleSelectPresentationAndSlide,
    handleScriptureEscape,
    handleScriptureArrowNav,
    quizCurrentSubslideIndex = 0,
    quizSubslideCount = 0,
    onQuizSubslideSelect,
  } = props;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't navigate if user is typing in the editor or focusing a select element
      const targetTag = (e.target as HTMLElement).tagName.toUpperCase();
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return;

      if (appModeRef.current === 'scripture' || appModeRef.current === 'seferManual') {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleScriptureEscape();
          return;
        }

        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          // If in control mode, SeferControlPanel handles navigation locally
          if (isControlMode) return;

          e.preventDefault();
          const currentScripture = scriptureStateRef.current;
          if (!currentScripture) return;

          handleScriptureArrowNav(e.key === 'ArrowRight' ? 'next' : 'previous');
          return;
        }
      }

      if (!currentPresentation || currentPresentation.slides.length === 0) return;
      const currentSlide = currentPresentation.slides[currentSlideIndex];
      const isQuizSlide = currentSlide?.type === 'quiz' && !!currentSlide.quizData && quizSubslideCount > 0;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (isQuizSlide && onQuizSubslideSelect && quizCurrentSubslideIndex < quizSubslideCount - 1) {
          onQuizSubslideSelect(quizCurrentSubslideIndex + 1);
          return;
        }
        const nextIdx = Math.min(currentSlideIndex + 1, currentPresentation.slides.length - 1);
        handleSelectPresentationAndSlide(currentPresentation, nextIdx, 'forward');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (isQuizSlide && onQuizSubslideSelect && quizCurrentSubslideIndex > 0) {
          onQuizSubslideSelect(quizCurrentSubslideIndex - 1);
          return;
        }
        const prevIdx = Math.max(currentSlideIndex - 1, 0);
        handleSelectPresentationAndSlide(currentPresentation, prevIdx, 'backward');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    currentPresentation,
    enabled,
    currentSlideIndex,
    quizCurrentSubslideIndex,
    quizSubslideCount,
    onQuizSubslideSelect,
    handleSelectPresentationAndSlide,
    handleScriptureEscape,
    handleScriptureArrowNav,
    isControlMode,
    appModeRef,
    scriptureStateRef,
  ]);
}
