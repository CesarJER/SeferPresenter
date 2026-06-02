import { useCallback, useRef } from 'react';
import type { Presentation, ScriptureNavState } from '../types/presentation';

interface UseBackgroundResolverProps {
  currentPresentation: Presentation | null;
  currentSlideIndex: number;
  backgroundLock: boolean;
  lockedBackgroundValue: string | null;
  userSelectedBackground: string | null;
  scriptureState: ScriptureNavState | null;
  // Refs (stable across renders)
  backgroundLockRef: React.MutableRefObject<boolean>;
  lockedBackgroundValueRef: React.MutableRefObject<string | null>;
  userSelectedBackgroundRef: React.MutableRefObject<string | null>;
  currentPresentationRef: React.MutableRefObject<Presentation | null>;
  currentSlideIndexRef: React.MutableRefObject<number>;
  scriptureStateRef: React.MutableRefObject<ScriptureNavState | null>;
  // Setters
  setBackgroundLock: (locked: boolean) => void;
  setLockedBackgroundValue: (bg: string | null) => void;
  setUserSelectedBackground: (bg: string | null) => void;
  // Sync callback
  syncState: (opts: {
    presentation: Presentation | null;
    slideIndex: number;
    bgLock: boolean;
    lockedBg: string | null;
    userSelectedBg: string | null;
  }) => void;
}

export function useBackgroundResolver(props: UseBackgroundResolverProps) {
  const {
    currentPresentation, currentSlideIndex, backgroundLock,
    lockedBackgroundValue, userSelectedBackground,
    backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef,
    currentPresentationRef, currentSlideIndexRef, scriptureStateRef,
    setBackgroundLock, setLockedBackgroundValue, setUserSelectedBackground,
    syncState,
  } = props;

  const lastPhysicalBgRef = useRef<string>('');

  const getActiveBackground = useCallback(() => {
    if (!currentPresentation) return '';

    const updateLastPhysical = (val: string) => {
      if (val && val !== 'Ignorar' && val !== 'No cambiar') {
        lastPhysicalBgRef.current = val;
      }
    };

    // 1. Lock active: return frozen background
    if (backgroundLock) {
      const bg = lockedBackgroundValue || currentPresentation.background;
      updateLastPhysical(bg);
      return bg;
    }

    // 2. Manual override
    if (userSelectedBackground) {
      updateLastPhysical(userSelectedBackground);
      return userSelectedBackground;
    }

    if (currentSlideIndex < 0) {
      const bg = currentPresentation.background;
      updateLastPhysical(bg);
      return bg;
    }

    const activeSlide = currentPresentation.slides[currentSlideIndex];
    if (!activeSlide) {
      const bg = currentPresentation.background;
      updateLastPhysical(bg);
      return bg;
    }

    const verseBgVal = activeSlide.scriptureVerseBackgrounds?.[
      String(scriptureStateRef.current?.verse ?? '')
    ];
    const bgVal = verseBgVal || activeSlide.background;

    // A. Ignorar / No cambiar
    if (bgVal === 'Ignorar' || bgVal === 'No cambiar') {
      return lastPhysicalBgRef.current || currentPresentation.background;
    }

    // B. Principal or unset
    if (!bgVal || bgVal === 'Principal') {
      const bg = currentPresentation.background;
      updateLastPhysical(bg);
      return bg;
    }

    // C. Anterior — walk backwards
    if (bgVal === 'Anterior') {
      let resolvedBg = currentPresentation.background;
      for (let m = currentSlideIndex - 1; m >= 0; m--) {
        const prevSlide = currentPresentation.slides[m];
        if (prevSlide) {
          const prevBg = prevSlide.background;
          if (prevBg && prevBg !== 'Anterior') {
            if (prevBg === 'Ignorar' || prevBg === 'No cambiar') {
              resolvedBg = lastPhysicalBgRef.current || currentPresentation.background;
            } else if (prevBg === 'Principal') {
              resolvedBg = currentPresentation.background;
            } else {
              resolvedBg = prevBg;
            }
            break;
          }
        }
      }
      updateLastPhysical(resolvedBg);
      return resolvedBg;
    }

    // D. Custom path
    updateLastPhysical(bgVal);
    return bgVal;
  }, [
    currentPresentation, currentSlideIndex, backgroundLock,
    lockedBackgroundValue, userSelectedBackground, scriptureStateRef,
  ]);

  const handleToggleBackgroundLock = useCallback((locked: boolean) => {
    const currentBg = getActiveBackground();
    setBackgroundLock(locked);
    setLockedBackgroundValue(locked ? currentBg : null);
    syncState({
      presentation: currentPresentationRef.current,
      slideIndex: currentSlideIndexRef.current,
      bgLock: locked,
      lockedBg: locked ? currentBg : null,
      userSelectedBg: userSelectedBackgroundRef.current,
    });
  }, [
    getActiveBackground, setBackgroundLock, setLockedBackgroundValue,
    syncState, currentPresentationRef, currentSlideIndexRef, userSelectedBackgroundRef,
  ]);

  const handleSelectBackgroundOverride = useCallback((bg: string) => {
    if (backgroundLockRef.current) {
      setLockedBackgroundValue(bg);
      syncState({
        presentation: currentPresentationRef.current,
        slideIndex: currentSlideIndexRef.current,
        bgLock: true,
        lockedBg: bg,
        userSelectedBg: userSelectedBackgroundRef.current,
      });
    } else {
      setUserSelectedBackground(bg);
      syncState({
        presentation: currentPresentationRef.current,
        slideIndex: currentSlideIndexRef.current,
        bgLock: false,
        lockedBg: lockedBackgroundValueRef.current,
        userSelectedBg: bg,
      });
    }
  }, [
    backgroundLockRef, setLockedBackgroundValue, setUserSelectedBackground,
    syncState, currentPresentationRef, currentSlideIndexRef,
    lockedBackgroundValueRef, userSelectedBackgroundRef,
  ]);

  return {
    getActiveBackground,
    handleToggleBackgroundLock,
    handleSelectBackgroundOverride,
    lastPhysicalBgRef,
  };
}
