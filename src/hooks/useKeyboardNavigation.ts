import { useEffect } from 'react';
import type { AppMode, PresentationStep, ScriptureNavState } from '../types/presentation';

interface UseKeyboardNavigationProps {
  isControlMode: boolean;
  enabled?: boolean;
  steps: PresentationStep[];
  currentStepIndex: number;
  onStepIndexChange: (idx: number) => void;
  appModeRef: React.MutableRefObject<AppMode>;
  scriptureStateRef: React.MutableRefObject<ScriptureNavState | null>;
  handleScriptureEscape: () => void;
  handleScriptureArrowNav: (direction: 'next' | 'previous') => void;
}

export function useKeyboardNavigation(props: UseKeyboardNavigationProps) {
  const {
    isControlMode,
    enabled = true,
    steps,
    currentStepIndex,
    onStepIndexChange,
    appModeRef,
    scriptureStateRef,
    handleScriptureEscape,
    handleScriptureArrowNav,
  } = props;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't navigate if user is typing in the editor or focusing a select element
      const targetTag = (e.target as HTMLElement).tagName.toUpperCase();
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return;

      // Escape key exits scripture/manual mode
      if (e.key === 'Escape') {
        if (appModeRef.current === 'scripture' || appModeRef.current === 'seferManual') {
          e.preventDefault();
          handleScriptureEscape();
          return;
        }
      }

      // If in manual scripture browsing mode (no presentation steps), navigate the database
      if (appModeRef.current === 'seferManual') {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          // In control mode, SeferControlPanel's own listeners handle keypresses locally
          if (isControlMode) return;

          e.preventDefault();
          handleScriptureArrowNav(e.key === 'ArrowRight' ? 'next' : 'previous');
          return;
        }
      }

      // Otherwise, we are in standard presentation mode: navigate through the flat step index
      if (steps.length === 0) return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextIdx = Math.min(currentStepIndex + 1, steps.length - 1);
        if (nextIdx !== currentStepIndex) {
          onStepIndexChange(nextIdx);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevIdx = Math.max(currentStepIndex - 1, 0);
        if (prevIdx !== currentStepIndex) {
          onStepIndexChange(prevIdx);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    enabled,
    steps,
    currentStepIndex,
    onStepIndexChange,
    handleScriptureEscape,
    handleScriptureArrowNav,
    isControlMode,
    appModeRef,
    scriptureStateRef,
  ]);
}
