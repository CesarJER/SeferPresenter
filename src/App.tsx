import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import PresenterScreen from './components/PresenterScreen'
import MenuPopup from './components/MenuPopup'
import SeferReaderScreen from './components/SeferReaderScreen'
import defaultPresentations from '../presentations.json'
import type { SeferReaderState } from './hooks/useSeferReader'
import { getScriptureChapterVerses } from './utils/scriptureLookup'

export type SeferOnlineRefPayload = {
  book?: string;
  chapter?: number | string;
  verseStart?: number | string;
  verse?: number | string;
  verseEnd?: number | string;
  bookEs?: string;
  bookHeb?: string;
  bookAbbrevEs?: string;
  verseNikud?: string;
  transliteration?: string;
  translation?: string;
  verseIdx?: number;
  totalVerses?: number;
  scriptureKind?: 'tanaj' | 'sefer';
};

export interface Presentation {
  id: string;
  title: string;
  background: string;
  mode: 'standard' | 'trilingual';
  fontScale?: number;
  slides: Slide[];
}

export interface Slide {
  id: string;
  label: string;
  lines: string[]; // 1 line for standard, 3 for trilingual (Hebrew, Translit, Translation)
  background?: string; // Ruta al fondo personalizado para esta diapositiva
  type?: 'text' | 'video' | 'tanaj' | 'sefer'; // 'text' por defecto
  videoSrc?: string;
  videoVolume?: number;
  videoSpeed?: number;
  videoLoop?: boolean;
  videoPresenterNav?: boolean;
  videoStart?: number;
  videoEnd?: number;
  scriptureBook?: string;
  scriptureChapter?: string;
  scriptureVerseStart?: string;
  scriptureVerseEnd?: string;
  scriptureVerseBackgrounds?: Record<string, string>;
}

export interface VideoState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  speed: number;
  loop?: boolean;
  videoSrc: string | null;
  startTime?: number;
  endTime?: number;
  lastUpdatedBy: 'controller' | 'projection';
  timestamp: number;
}

// New: scripture reader state synchronized between controller and presenter
export interface ScriptureNavState {
  bookEs: string;
  bookHeb: string;
  bookAbbrevEs: string;
  chapter: string;
  verseStart: string;
  verse: string;
  verseEnd?: string;
  verseNikud: string;
  transliteration: string;
  translation: string;
  verseIdx: number;
  totalVerses: number;
  scriptureKind?: 'tanaj' | 'sefer';
  command?: 'navigate' | 'next' | 'previous';
  commandId?: number;
  hebrewFontSize?: number;
  combinedTextBaseSize?: number;
}

// App mode: 'slides' is normal presentation, 'scripture' is slide scripture, 'seferManual' is the manual Sefer overlay
export type AppMode = 'slides' | 'scripture' | 'seferManual';
const parseSlideHash = (hash: string) => {
  const clean = hash.replace('#', '');
  const [slidePart, versePart] = clean.split('.');
  const slideIndex = parseInt(slidePart, 10);
  return {
    slideIndex,
    verse: versePart || undefined,
  };
};

const formatSlideHash = (slideIndex: number, verse?: string) =>
  verse ? `#${slideIndex}.${verse}` : `#${slideIndex}`;

const makeClientId = () => {
  const randomPart = Math.random().toString(36).slice(2);
  return `sefer-${Date.now().toString(36)}-${randomPart}`;
};

const normalizePublicPath = (value: string) => {
  if (!value) return '';

  let normalized = value.replace(/\\/g, '/');
  const publicIndex = normalized.lastIndexOf('/public/');
  if (publicIndex >= 0) {
    normalized = normalized.slice(publicIndex + '/public'.length);
  } else if (normalized.startsWith('public/')) {
    normalized = `/${normalized.slice('public/'.length)}`;
  }

  if (__APP_MODE__ === 'singlefile') {
    return normalized.startsWith('/') ? normalized.slice(1) : normalized;
  } else {
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }
};

const normalizePresentation = (presentation: Presentation): Presentation => {
  let mode = presentation.mode || 'standard';
  let slides = presentation.slides || [];

  slides = slides.map((slide) => {
    if ((slide as any).type === 'scripture') {
      return { ...slide, type: 'sefer' as const };
    }
    return slide;
  });

  if (mode === 'trilingual' && slides.length > 0) {
    const allSlidesAreFallback = slides.every(slide => {
      const l1 = slide.lines[1] ?? '';
      const l2 = slide.lines[2] ?? '';
      const isL1Fallback = l1 === '-' || l1 === '>-' || l1 === '';
      const isL2Fallback = l2 === '-' || l2 === '>-' || l2 === '';
      return isL1Fallback && isL2Fallback;
    });

    if (allSlidesAreFallback) {
      mode = 'standard';
    }
  }

  slides = slides.map((slide) => {
    const fallbackVal = '-';
    let l1 = slide.lines[1];
    let l2 = slide.lines[2];

    if (mode === 'standard') {
      l1 = fallbackVal;
      l2 = fallbackVal;
    } else {
      l1 = l1 !== undefined && l1 !== '' ? l1 : fallbackVal;
      l2 = l2 !== undefined && l2 !== '' ? l2 : fallbackVal;
    }

    return {
      ...slide,
      lines: [slide.lines[0] || '', l1, l2]
    };
  });

  return {
    ...presentation,
    mode,
    slides,
    background: normalizePublicPath(presentation.background),
    fontScale: presentation.fontScale ?? 1
  };
};

const loadStoredPresenterState = (): { presentation: Presentation | null; slideIndex: number } | null => {
  try {
    const stored = localStorage.getItem('sefer-presenter-state');
    if (!stored) return null;

    const data = JSON.parse(stored);
    return {
      presentation: data.presentation ? normalizePresentation(data.presentation) : null,
      slideIndex: data.slideIndex
    };
  } catch (err) {
    console.error("Error loading stored presenter state", err);
    return null;
  }
};

const slugify = (text: string) => {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/\s+/g, '-') // replace spaces with -
    .replace(/[^\w-]+/g, '') // remove all non-word chars
    .replace(/--+/g, '-') // replace multiple - with single -
    .replace(/^-+/, '') // trim - from start
    .replace(/-+$/, ''); // trim - from end
};

const fallbackBackgrounds = [
  "/backgrounds/Jerusalem/Jerusalem-0.0Midday.png",
  "/backgrounds/Jerusalem/Jerusalem-0.1AfterMidday.png",
  "/backgrounds/Jerusalem/Jerusalem-0.2Afternoon.png",
  "/backgrounds/Jerusalem/Jerusalem-0.3LateAfternoon.png",
  "/backgrounds/Jerusalem/Jerusalem-0.4Sunset.png",
  "/backgrounds/Jerusalem/Jerusalem-1NewMoon.png",
  "/backgrounds/Jerusalem/Jerusalem-2WaxingCrescentMoon.png",
  "/backgrounds/Jerusalem/Jerusalem-3CrescentQuarterMoon.png",
  "/backgrounds/Jerusalem/Jerusalem-4WaxingGibbousMoon.png",
  "/backgrounds/Jerusalem/Jerusalem-5FullMoon.png",
  "/backgrounds/Jerusalem/Jerusalem-6WaningGibbousMoon.png",
  "/backgrounds/Jerusalem/Jerusalem-7DecrescentQuarterMoon.png",
  "/backgrounds/Jerusalem/Jerusalem-8WaningCrescentMoon.png",
  "/backgrounds/Jerusalem/Jerusalem-9NoMoon.png",
  "/backgrounds/Jerusalem/Jerusalem-Video-pingpong.mp4",
  "/backgrounds/Jerusalem/Jerusalem-Video.mp4",
  "/backgrounds/Zarza/Zarza ardiente-pingpong.mp4",
  "/backgrounds/Zarza/Zarza ardiente.mp4",
  "/backgrounds/Zarza/Zarza ardiente.png"
];

function App() {
  // Detect if we are in control panel mode based on URL query
  const isControlMode = new URLSearchParams(window.location.search).get('mode') === 'control';
  const storedPresenterState = loadStoredPresenterState();

  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [currentPresentation, setCurrentPresentation] = useState<Presentation | null>(storedPresenterState?.presentation ?? null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(storedPresenterState?.slideIndex ?? -1);
  const [backgrounds, setBackgrounds] = useState<string[]>([]);

  const [backgroundLock, setBackgroundLock] = useState<boolean>(() => {
    return localStorage.getItem('sefer-presenter-bg-lock') === 'true';
  });
  const [lockedBackgroundValue, setLockedBackgroundValue] = useState<string | null>(() => {
    return localStorage.getItem('sefer-presenter-locked-bg') ?? null;
  });
  const [userSelectedBackground, setUserSelectedBackground] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<VideoState | null>(null);

  // Scripture reader state
  const [appMode, setAppMode] = useState<AppMode>('slides');
  const [scriptureState, setScriptureState] = useState<ScriptureNavState | null>(null);

  const currentPresentationRef = useRef<Presentation | null>(currentPresentation);
  const currentSlideIndexRef = useRef(currentSlideIndex);
  const backgroundLockRef = useRef(backgroundLock);
  const lockedBackgroundValueRef = useRef(lockedBackgroundValue);
  const userSelectedBackgroundRef = useRef(userSelectedBackground);
  const videoStateRef = useRef<VideoState | null>(null);
  const lastPhysicalBgRef = useRef<string>('');
  const appModeRef = useRef<AppMode>(appMode);
  const scriptureStateRef = useRef<ScriptureNavState | null>(scriptureState);
  const scriptureCommandIdRef = useRef(0);
  const slideScriptureStateBeforeManualRef = useRef<ScriptureNavState | null>(null);
  const clientIdRef = useRef(makeClientId());

  useEffect(() => {
    videoStateRef.current = videoState;
  }, [videoState]);

  useEffect(() => {
    appModeRef.current = appMode;
    scriptureStateRef.current = scriptureState;
  }, [appMode, scriptureState]);

  const channel = useMemo(() => new BroadcastChannel('sefer-presenter'), []);

  const persistState = useCallback((
    presentation: Presentation | null,
    slideIndex: number,
    bgLock: boolean,
    lockedBg: string | null
  ) => {
    localStorage.setItem('sefer-presenter-state', JSON.stringify({
      presentation: presentation ? normalizePresentation(presentation) : null,
      slideIndex
    }));
    localStorage.setItem('sefer-presenter-bg-lock', String(bgLock));
    if (lockedBg) {
      localStorage.setItem('sefer-presenter-locked-bg', lockedBg);
    } else {
      localStorage.removeItem('sefer-presenter-locked-bg');
    }
  }, []);

  const syncState = useCallback((
    presentation: Presentation | null,
    slideIndex: number,
    bgLock: boolean,
    lockedBg: string | null,
    userSelectedBg: string | null,
    vState?: VideoState | null,
    aMode?: AppMode,
    scrState?: ScriptureNavState | null
  ) => {
    const activeVideoState = vState !== undefined ? vState : videoStateRef.current;
    const activeAppMode = aMode !== undefined ? aMode : appModeRef.current;
    const activeScriptureState = scrState !== undefined ? scrState : scriptureStateRef.current;

    console.log("[App] syncState - isControlMode:", isControlMode, "currentTime:", activeVideoState?.currentTime, "lastUpdatedBy:", activeVideoState?.lastUpdatedBy);

    // Synchronize local React state
    setVideoState(activeVideoState);

    persistState(presentation, slideIndex, bgLock, lockedBg);
    channel.postMessage({
      type: 'SYNC_STATE',
      clientId: clientIdRef.current,
      origin: isControlMode ? 'control' : 'presenter',
      presentation,
      slideIndex,
      backgroundLock: bgLock,
      lockedBackgroundValue: lockedBg,
      userSelectedBackground: userSelectedBg,
      videoState: activeVideoState,
      appMode: activeAppMode,
      scriptureState: activeScriptureState,
    });

    if (__APP_MODE__ !== 'singlefile') {
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientIdRef.current,
          origin: isControlMode ? 'control' : 'presenter',
          presentation,
          slideIndex,
          backgroundLock: bgLock,
          lockedBackgroundValue: lockedBg,
          userSelectedBackground: userSelectedBg,
          videoState: activeVideoState,
          appMode: activeAppMode,
          scriptureState: activeScriptureState,
        })
      }).catch(err => console.error("Error syncing state to network", err));
    }
  }, [channel, isControlMode, persistState]);

  const handleSelectPresentationAndSlide = useCallback((p: Presentation | null, idx: number, direction: 'forward' | 'backward' = 'forward', targetVerse?: string) => {
    const normalizedPresentation = p ? normalizePresentation(p) : null;
    setCurrentPresentation(normalizedPresentation);
    setCurrentSlideIndex(idx);
    setVideoState(null); // Reset video state on slide transition

    // Check if the clicked slide background is Ignorar / No cambiar
    const slide = normalizedPresentation && idx >= 0 ? normalizedPresentation.slides[idx] : null;
    const bgVal = slide?.background ?? '';
    const isIgnored = bgVal === 'Ignorar' || bgVal === 'No cambiar';
    const scriptureSlideState: ScriptureNavState | null = buildScriptureSlideState(slide, direction, targetVerse);
    const nextAppMode: AppMode = scriptureSlideState ? 'scripture' : 'slides';

    setAppMode(nextAppMode);
    if (scriptureSlideState) {
      setScriptureState(scriptureSlideState);
    }

    if (isIgnored) {
      // Ignorar: preserve userSelectedBackground override
      syncState(
        normalizedPresentation,
        idx,
        backgroundLockRef.current,
        lockedBackgroundValueRef.current,
        userSelectedBackgroundRef.current,
        null, // Reset video state in projection
        nextAppMode,
        scriptureSlideState ?? scriptureStateRef.current
      );
    } else {
      // Not ignored: reset manual override
      setUserSelectedBackground(null);
      syncState(
        normalizedPresentation,
        idx,
        backgroundLockRef.current,
        lockedBackgroundValueRef.current,
        null,
        null, // Reset video state in projection
        nextAppMode,
        scriptureSlideState ?? scriptureStateRef.current
      );
    }
  }, [syncState]);

  useEffect(() => {
    currentPresentationRef.current = currentPresentation;
    currentSlideIndexRef.current = currentSlideIndex;
    backgroundLockRef.current = backgroundLock;
    lockedBackgroundValueRef.current = lockedBackgroundValue;
    userSelectedBackgroundRef.current = userSelectedBackground;
    appModeRef.current = appMode;
    scriptureStateRef.current = scriptureState;
  }, [currentPresentation, currentSlideIndex, backgroundLock, lockedBackgroundValue, userSelectedBackground, appMode, scriptureState]);

  const parseUrlAndSync = useCallback(() => {
    if (presentations.length === 0) return;

    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    if (pathSegments.length === 0) return;

    const urlTitle = decodeURIComponent(pathSegments[0]);
    const matched = presentations.find(p => slugify(p.title) === slugify(urlTitle));

    if (matched) {
      const { slideIndex, verse } = parseSlideHash(window.location.hash);
      const targetIndex = !isNaN(slideIndex) && slideIndex >= 0 && slideIndex < matched.slides.length ? slideIndex : 0;
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
  }, [presentations, handleSelectPresentationAndSlide]);

  // Sync URL when state changes
  useEffect(() => {
    if (currentPresentation) {
      const slug = slugify(currentPresentation.title);
      const activeSlide = currentSlideIndex >= 0 ? currentPresentation.slides[currentSlideIndex] : null;
      const isScriptureSlide = activeSlide?.type === 'sefer' || activeSlide?.type === 'tanaj';
      const hashVerse = appMode === 'seferManual'
        ? slideScriptureStateBeforeManualRef.current?.verse
        : scriptureState?.verse;
      const hash = currentSlideIndex >= 0
        ? formatSlideHash(currentSlideIndex, isScriptureSlide ? hashVerse : undefined)
        : '';
      const search = window.location.search;
      const normalizedPath = window.location.pathname.replace(/\/$/, '');
      const targetPath = `/${slug}${search}${hash}`;
      if (normalizedPath !== `/${slug}` || window.location.hash !== hash) {
        window.history.replaceState(null, '', targetPath);
      }
    }
  }, [appMode, currentPresentation, currentSlideIndex, scriptureState]);

  // Dynamic document title update based on current presentation
  useEffect(() => {
    if (currentPresentation) {
      document.title = `SeferPresenter - ${currentPresentation.title}`;
    } else {
      document.title = `SeferPresenter`;
    }
  }, [currentPresentation]);

  // Handle URL parsing on presentations load
  useEffect(() => {
    parseUrlAndSync();
  }, [presentations, parseUrlAndSync]);

  // Handle popstate & hashchange events (manually entered URLs or back button)
  useEffect(() => {
    const handlePopState = () => {
      parseUrlAndSync();
    };
    const handleHashChange = () => {
      parseUrlAndSync();
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [parseUrlAndSync]);

  useEffect(() => {
    if (__APP_MODE__ === 'singlefile') {
      // Cargar fondos locales estáticos
      setBackgrounds(fallbackBackgrounds.map(normalizePublicPath));

      // Cargar presentaciones de localStorage o fallback a defaultPresentations
      const stored = localStorage.getItem('sefer-presenter-presentations');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setPresentations(parsed.map(normalizePresentation));
        } catch (err) {
          console.error("Error parsing stored presentations, falling back to defaults", err);
          setPresentations((defaultPresentations as Presentation[]).map(normalizePresentation));
        }
      } else {
        setPresentations((defaultPresentations as Presentation[]).map(normalizePresentation));
      }
    } else {
      // Modo web estándar
      fetch('/api/backgrounds')
        .then(res => res.json())
        .then(data => setBackgrounds(data))
        .catch(err => console.error("Error loading backgrounds", err));

      fetch('/api/presentations')
        .then(res => res.json())
        .then(data => setPresentations(data.map(normalizePresentation)))
        .catch(err => console.error("Error loading presentations", err));
    }
  }, []);

  useEffect(() => {
    if (!isControlMode) {
      // Presenter Screen Mode: Listen for changes from the control panel
      const handleMessage = (event: MessageEvent) => {
        const data = event.data;
        if (data?.clientId === clientIdRef.current) return;
        console.log("[Presenter App] BroadcastChannel message received:", data.type, "videoState currentTime:", data.videoState?.currentTime);
        if (data.type === 'SYNC_STATE') {
          const normalizedPresentation = data.presentation ? normalizePresentation(data.presentation) : null;

          if (JSON.stringify(currentPresentationRef.current) !== JSON.stringify(normalizedPresentation)) {
            setCurrentPresentation(normalizedPresentation);
          }
          if (currentSlideIndexRef.current !== data.slideIndex) {
            setCurrentSlideIndex(data.slideIndex);
          }
          if (data.backgroundLock !== undefined && backgroundLockRef.current !== data.backgroundLock) {
            setBackgroundLock(data.backgroundLock);
          }
          if (data.lockedBackgroundValue !== undefined && lockedBackgroundValueRef.current !== data.lockedBackgroundValue) {
            setLockedBackgroundValue(data.lockedBackgroundValue);
          }
          if (data.userSelectedBackground !== undefined && userSelectedBackgroundRef.current !== data.userSelectedBackground) {
            setUserSelectedBackground(data.userSelectedBackground);
          }
          if (data.videoState !== undefined && JSON.stringify(videoStateRef.current) !== JSON.stringify(data.videoState)) {
            setVideoState(data.videoState);
          }
          if (data.appMode !== undefined && appModeRef.current !== data.appMode) {
            setAppMode(data.appMode);
          }
          if (data.scriptureState !== undefined && JSON.stringify(scriptureStateRef.current) !== JSON.stringify(data.scriptureState)) {
            setScriptureState(data.scriptureState);
          }

          persistState(
            normalizedPresentation,
            data.slideIndex,
            data.backgroundLock ?? backgroundLockRef.current,
            data.lockedBackgroundValue ?? lockedBackgroundValueRef.current
          );
        }
      };
      channel.addEventListener('message', handleMessage);

      // Ask for current state when opened
      channel.postMessage({ type: 'REQUEST_STATE' });

      return () => channel.removeEventListener('message', handleMessage);
    } else {
      // Control Panel Mode: Listen for requests from new presenter screens
      const handleMessage = (event: MessageEvent) => {
        console.log("[Control App] BroadcastChannel message received:", event.data.type, "videoState currentTime:", event.data.videoState?.currentTime);
        if (event.data?.clientId === clientIdRef.current) return;
        if (event.data.type === 'REQUEST_STATE') {
          syncState(
            currentPresentationRef.current,
            currentSlideIndexRef.current,
            backgroundLockRef.current,
            lockedBackgroundValueRef.current,
            userSelectedBackgroundRef.current,
            videoStateRef.current,
            appModeRef.current,
            scriptureStateRef.current
          );
        } else if (event.data.type === 'SYNC_STATE') {
          const normalizedPresentation = event.data.presentation ? normalizePresentation(event.data.presentation) : null;

          if (JSON.stringify(currentPresentationRef.current) !== JSON.stringify(normalizedPresentation)) {
            setCurrentPresentation(normalizedPresentation);
          }
          if (currentSlideIndexRef.current !== event.data.slideIndex) {
            setCurrentSlideIndex(event.data.slideIndex);
          }
          if (event.data.backgroundLock !== undefined && backgroundLockRef.current !== event.data.backgroundLock) {
            setBackgroundLock(event.data.backgroundLock);
          }
          if (event.data.lockedBackgroundValue !== undefined && lockedBackgroundValueRef.current !== event.data.lockedBackgroundValue) {
            setLockedBackgroundValue(event.data.lockedBackgroundValue);
          }
          if (event.data.userSelectedBackground !== undefined && userSelectedBackgroundRef.current !== event.data.userSelectedBackground) {
            setUserSelectedBackground(event.data.userSelectedBackground);
          }
          if (event.data.videoState !== undefined && JSON.stringify(videoStateRef.current) !== JSON.stringify(event.data.videoState)) {
            setVideoState(event.data.videoState);
          }
          if (event.data.appMode !== undefined && appModeRef.current !== event.data.appMode) {
            setAppMode(event.data.appMode);
          }
          if (event.data.scriptureState !== undefined && JSON.stringify(scriptureStateRef.current) !== JSON.stringify(event.data.scriptureState)) {
            setScriptureState(event.data.scriptureState);
          }

          persistState(
            normalizedPresentation,
            event.data.slideIndex,
            event.data.backgroundLock ?? backgroundLockRef.current,
            event.data.lockedBackgroundValue ?? lockedBackgroundValueRef.current
          );
        }
      };
      channel.addEventListener('message', handleMessage);
      return () => channel.removeEventListener('message', handleMessage);
    }
  }, [isControlMode, channel, persistState, syncState]);

  // Listen for state synchronization events from local network (SSE)
  useEffect(() => {
    if (__APP_MODE__ === 'singlefile') return;

    const eventSource = new EventSource('/api/state-events');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data) return;
        if (data.clientId === clientIdRef.current) return;

        const normalizedPresentation = data.presentation ? normalizePresentation(data.presentation) : null;
        const currentRef = currentPresentationRef.current;
        const currentIdxRef = currentSlideIndexRef.current;

        const isDifferent = !currentRef ||
          currentRef.id !== (normalizedPresentation?.id ?? '') ||
          currentIdxRef !== data.slideIndex ||
          backgroundLockRef.current !== data.backgroundLock ||
          lockedBackgroundValueRef.current !== data.lockedBackgroundValue ||
          userSelectedBackgroundRef.current !== data.userSelectedBackground ||
          JSON.stringify(videoStateRef.current) !== JSON.stringify(data.videoState) ||
          appModeRef.current !== data.appMode ||
          JSON.stringify(scriptureStateRef.current) !== JSON.stringify(data.scriptureState);

        if (isDifferent) {
          setCurrentPresentation(normalizedPresentation);
          setCurrentSlideIndex(data.slideIndex);
          if (data.backgroundLock !== undefined) {
            setBackgroundLock(data.backgroundLock);
          }
          if (data.lockedBackgroundValue !== undefined) {
            setLockedBackgroundValue(data.lockedBackgroundValue);
          }
          if (data.userSelectedBackground !== undefined) {
            setUserSelectedBackground(data.userSelectedBackground);
          }
          if (data.videoState !== undefined) {
            setVideoState(data.videoState);
          }
          if (data.appMode !== undefined) {
            setAppMode(data.appMode);
          }
          if (data.scriptureState !== undefined) {
            setScriptureState(data.scriptureState);
          }
          persistState(
            normalizedPresentation,
            data.slideIndex,
            data.backgroundLock ?? backgroundLockRef.current,
            data.lockedBackgroundValue ?? lockedBackgroundValueRef.current
          );
        }
      } catch (err) {
        console.error("Error parsing network state sync event", err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [persistState]);

  const savePresentations = async (updated: Presentation[]) => {
    const normalized = updated.map(normalizePresentation);
    setPresentations(normalized);
    if (__APP_MODE__ === 'singlefile') {
      localStorage.setItem('sefer-presenter-presentations', JSON.stringify(normalized));
    } else {
      try {
        await fetch('/api/presentations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(normalized)
        });
      } catch (err) {
        console.error("Error saving presentations", err);
      }
    }
  }

  const handleSave = (presentation: Presentation) => {
    const normalizedPresentation = normalizePresentation(presentation);
    const existing = presentations.findIndex(p => p.id === normalizedPresentation.id);
    const updated = [...presentations];
    if (existing >= 0) {
      updated[existing] = normalizedPresentation;
    } else {
      updated.push(normalizedPresentation);
    }
    savePresentations(updated);
    const nextIndex = existing >= 0
      ? Math.min(currentSlideIndexRef.current, normalizedPresentation.slides.length - 1)
      : normalizedPresentation.slides.length > 0 ? 0 : -1;
    handleSelectPresentationAndSlide(normalizedPresentation, nextIndex);
  }

  const buildScriptureSlideState = useCallback((slide: Slide | null, direction: 'forward' | 'backward' = 'forward', targetVerse?: string): ScriptureNavState | null => {
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
  }, []);

  // Handle keyboard navigation from both the control panel and the presenter window.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't navigate if user is typing in the editor or focusing a select element
      const targetTag = (e.target as HTMLElement).tagName.toUpperCase();
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return;

      if (appModeRef.current === 'scripture') {
        if (e.key === 'Escape') {
          e.preventDefault();
          setAppMode('slides');
          syncState(
            currentPresentationRef.current,
            currentSlideIndexRef.current,
            backgroundLockRef.current,
            lockedBackgroundValueRef.current,
            userSelectedBackgroundRef.current,
            videoStateRef.current,
            'slides',
            scriptureStateRef.current
          );
          return;
        }

        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          // If in control mode, SeferControlPanel handles navigation locally to update dropdowns directly
          if (isControlMode) return;

          e.preventDefault();
          const currentScripture = scriptureStateRef.current;
          if (!currentScripture) return;

          const navState: ScriptureNavState = {
            ...currentScripture,
            command: e.key === 'ArrowRight' ? 'next' : 'previous',
            commandId: ++scriptureCommandIdRef.current,
          };
          setScriptureState(navState);
          syncState(
            currentPresentationRef.current,
            currentSlideIndexRef.current,
            backgroundLockRef.current,
            lockedBackgroundValueRef.current,
            userSelectedBackgroundRef.current,
            videoStateRef.current,
            'scripture',
            navState
          );
          return;
        }
      }

      if (!currentPresentation || currentPresentation.slides.length === 0) return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextIdx = Math.min(currentSlideIndex + 1, currentPresentation.slides.length - 1);
        handleSelectPresentationAndSlide(currentPresentation, nextIdx, 'forward');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevIdx = Math.max(currentSlideIndex - 1, 0);
        handleSelectPresentationAndSlide(currentPresentation, prevIdx, 'backward');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPresentation, currentSlideIndex, handleSelectPresentationAndSlide, syncState, isControlMode]);

  const getActiveBackground = useCallback(() => {
    if (!currentPresentation) return '';

    const updateLastPhysical = (val: string) => {
      if (val && val !== 'Ignorar' && val !== 'No cambiar') {
        lastPhysicalBgRef.current = val;
      }
    };

    // 1. Candado activo: Retorna el fondo congelado en proyección
    if (backgroundLock) {
      const bg = lockedBackgroundValue || currentPresentation.background;
      updateLastPhysical(bg);
      return bg;
    }

    // 2. Cambio manual temporal (override)
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

    const verseBgVal = activeSlide.scriptureVerseBackgrounds?.[String(scriptureStateRef.current?.verse ?? '')];
    // 3. Flujo secuencial de diapositivas
    const bgVal = verseBgVal || activeSlide.background;

    // A. Ignorar explicitly (comportamiento de candado)
    if (bgVal === 'Ignorar' || bgVal === 'No cambiar') {
      return lastPhysicalBgRef.current || currentPresentation.background;
    }

    // B. Principal o no configurado (por defecto Principal)
    if (!bgVal || bgVal === 'Principal') {
      const bg = currentPresentation.background;
      updateLastPhysical(bg);
      return bg;
    }

    // C. Anterior
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

    // D. Ruta de fondo personalizada
    updateLastPhysical(bgVal);
    return bgVal;
  }, [currentPresentation, currentSlideIndex, backgroundLock, lockedBackgroundValue, userSelectedBackground, scriptureState]);

  const activeBackground = getActiveBackground();

  const handleToggleBackgroundLock = useCallback((locked: boolean) => {
    const currentBg = getActiveBackground();
    setBackgroundLock(locked);
    setLockedBackgroundValue(locked ? currentBg : null);
    syncState(
      currentPresentationRef.current,
      currentSlideIndexRef.current,
      locked,
      locked ? currentBg : null,
      userSelectedBackgroundRef.current
    );
  }, [syncState, getActiveBackground]);

  const handleSelectBackgroundOverride = useCallback((bg: string) => {
    if (backgroundLockRef.current) {
      setLockedBackgroundValue(bg);
      syncState(
        currentPresentationRef.current,
        currentSlideIndexRef.current,
        true,
        bg,
        userSelectedBackgroundRef.current
      );
    } else {
      setUserSelectedBackground(bg);
      syncState(
        currentPresentationRef.current,
        currentSlideIndexRef.current,
        false,
        lockedBackgroundValueRef.current,
        bg
      );
    }
  }, [syncState]);

  const activeSlide = currentPresentation && currentSlideIndex >= 0 ? currentPresentation.slides[currentSlideIndex] : null;
  const activePresenterSlide = scriptureState?.scriptureKind === 'tanaj'
    ? {
      id: activeSlide?.id || `tanaj-${scriptureState.bookAbbrevEs}-${scriptureState.chapter}-${scriptureState.verse}`,
      label: `${scriptureState.bookAbbrevEs} ${scriptureState.chapter}:${scriptureState.verse}`,
      lines: [
        scriptureState.verseNikud,
        scriptureState.transliteration,
        scriptureState.translation,
      ],
      type: 'tanaj' as const,
      background: activeBackground,
    }
    : activeSlide;

  useEffect(() => {
    if (!scriptureState || !activeSlide || (activeSlide.type !== 'sefer' && activeSlide.type !== 'tanaj')) return;
    if (appModeRef.current === 'seferManual') return;

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
        syncState(
          currentPresentationRef.current,
          currentSlideIndexRef.current,
          backgroundLockRef.current,
          lockedBackgroundValueRef.current,
          userSelectedBackgroundRef.current,
          videoStateRef.current,
          'scripture',
          hydratedState
        );
      })
      .catch((err) => console.error('Error hydrating scripture verse', err));

    return () => {
      cancelled = true;
    };
  }, [
    activeSlide,
    scriptureState?.bookAbbrevEs,
    scriptureState?.bookEs,
    scriptureState?.chapter,
    scriptureState?.scriptureKind,
    scriptureState?.translation,
    scriptureState?.transliteration,
    scriptureState?.verse,
    scriptureState?.verseNikud,
    syncState,
  ]);

  // Helper: project a scripture verse (called from MenuPopup/SeferControlPanel)
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
    syncState(
      currentPresentationRef.current,
      currentSlideIndexRef.current,
      backgroundLockRef.current,
      lockedBackgroundValueRef.current,
      userSelectedBackgroundRef.current,
      videoStateRef.current,
      nextMode,
      navState
    );
    if (appModeRef.current !== nextMode) setAppMode(nextMode);
  }, [isControlMode, syncState]);

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
    syncState(
      currentPresentationRef.current,
      currentSlideIndexRef.current,
      backgroundLockRef.current,
      lockedBackgroundValueRef.current,
      userSelectedBackgroundRef.current,
      videoStateRef.current,
      appModeRef.current,
      nextState
    );
  }, [syncState]);

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

    if (JSON.stringify(previous) === JSON.stringify(navState)) return;

    const nextMode: AppMode = appModeRef.current === 'seferManual' ? 'seferManual' : 'scripture';
    setScriptureState(navState);
    syncState(
      currentPresentationRef.current,
      currentSlideIndexRef.current,
      backgroundLockRef.current,
      lockedBackgroundValueRef.current,
      userSelectedBackgroundRef.current,
      videoStateRef.current,
      nextMode,
      navState
    );
  }, [syncState]);

  const handleAddScriptureSlide = useCallback((state: SeferReaderState, kind: 'sefer' | 'tanaj' = 'sefer') => {
    const presentation = currentPresentationRef.current;
    if (!presentation) return;
    const verseStart = state.verseStart || state.verse;
    const verseEnd = state.verseEnd || verseStart;
    const rangeLabel = verseEnd !== verseStart ? `${verseStart}-${verseEnd}` : verseStart;
    const newSlide: Slide = {
      id: `slide-${kind}-${Date.now()}`,
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
  }, [handleSave]);

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
  }, [handleSelectPresentationAndSlide]);

  if (isControlMode) {
    return (
      <div className="w-full h-screen bg-gray-900 overflow-hidden">
        <MenuPopup
          presentations={presentations}
          backgrounds={backgrounds}
          currentPresentation={currentPresentation}
          currentSlideIndex={currentSlideIndex}
          activeBackground={activeBackground}
          backgroundLock={backgroundLock}
          onToggleBackgroundLock={handleToggleBackgroundLock}
          onSelectBackgroundOverride={handleSelectBackgroundOverride}
          onSave={handleSave}
          onSelectPresentation={(p, slideIndex) => {
            const targetIdx = slideIndex !== undefined ? slideIndex : (p.slides.length > 0 ? 0 : -1);
            handleSelectPresentationAndSlide(p, targetIdx);
          }}
          onSelectSlide={(idx) => handleSelectPresentationAndSlide(currentPresentation, idx)}
          onImport={(imported) => {
            savePresentations(imported);
            if (imported.length > 0) {
              handleSelectPresentationAndSlide(imported[0], imported[0].slides.length > 0 ? 0 : -1);
            } else {
              handleSelectPresentationAndSlide(null, -1);
            }
          }}
          videoState={videoState}
          onVideoStateChange={(state) => syncState(currentPresentation, currentSlideIndex, backgroundLock, lockedBackgroundValue, userSelectedBackground, state)}
          appMode={appMode}
          scriptureState={scriptureState}
          onUpdateScriptureFontSizes={handleUpdateScriptureFontSizes}
          onToggleAppMode={(mode: AppMode) => {
            if (mode === 'seferManual') {
              if (appModeRef.current !== 'seferManual') {
                slideScriptureStateBeforeManualRef.current = appModeRef.current === 'scripture'
                  ? scriptureStateRef.current
                  : null;
              }

              const activeSlide = currentPresentationRef.current && currentSlideIndexRef.current >= 0
                ? currentPresentationRef.current.slides[currentSlideIndexRef.current]
                : null;
              const slideState = buildScriptureSlideState(activeSlide, 'forward');
              const sourceState = scriptureStateRef.current ?? slideState;
              const manualState: ScriptureNavState | null = sourceState
                ? {
                  ...sourceState,
                  verseStart: sourceState.verse,
                  verseEnd: undefined,
                  scriptureKind: 'sefer',
                  command: 'navigate',
                  commandId: ++scriptureCommandIdRef.current,
                }
                : null;

              if (manualState) {
                setScriptureState(manualState);
              }
              setAppMode('seferManual');
              syncState(
                currentPresentationRef.current,
                currentSlideIndexRef.current,
                backgroundLockRef.current,
                lockedBackgroundValueRef.current,
                userSelectedBackgroundRef.current,
                videoStateRef.current,
                'seferManual',
                manualState ?? scriptureStateRef.current
              );
              return;
            }

            if (mode === 'slides') {
              const fallbackPresentation =
                currentPresentationRef.current ??
                storedPresenterState?.presentation ??
                presentations[0] ??
                null;
              const fallbackSlideIndex =
                fallbackPresentation
                  ? (currentSlideIndexRef.current >= 0 && currentPresentationRef.current
                    ? currentSlideIndexRef.current
                    : 0)
                  : -1;

              if (!currentPresentationRef.current && fallbackPresentation) {
                setCurrentPresentation(normalizePresentation(fallbackPresentation));
                setCurrentSlideIndex(fallbackSlideIndex);
              } else if (currentPresentationRef.current && currentSlideIndexRef.current < 0) {
                setCurrentSlideIndex(0);
              }

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
                syncState(
                  currentPresentationRef.current ?? storedPresenterState?.presentation ?? presentations[0] ?? null,
                  (currentSlideIndexRef.current >= 0 && currentPresentationRef.current) ? currentSlideIndexRef.current : 0,
                  backgroundLockRef.current,
                  lockedBackgroundValueRef.current,
                  userSelectedBackgroundRef.current,
                  videoStateRef.current,
                  nextMode,
                  restoredState ?? scriptureStateRef.current
                );
                return;
              }
            }

            setAppMode(mode);
            syncState(
              mode === 'slides'
                ? (currentPresentationRef.current ?? storedPresenterState?.presentation ?? presentations[0] ?? null)
                : currentPresentationRef.current,
              mode === 'slides'
                ? ((currentSlideIndexRef.current >= 0 && currentPresentationRef.current) ? currentSlideIndexRef.current : 0)
                : currentSlideIndexRef.current,
              backgroundLockRef.current,
              lockedBackgroundValueRef.current,
              userSelectedBackgroundRef.current,
              videoStateRef.current,
              mode,
              scriptureStateRef.current
            );
          }}
          onProjectScripture={handleProjectScripture}
          onAddScriptureSlide={handleAddScriptureSlide}
          onBoundaryReached={handleScriptureBoundary}
        />
      </div>
    );
  }

  // Presenter (big screen) mode
  if ((appMode === 'seferManual' || (appMode === 'scripture' && scriptureState?.scriptureKind !== 'tanaj')) && scriptureState) {
    return (
      <div className="w-full h-screen overflow-hidden">
        <SeferReaderScreen
          scriptureState={scriptureState}
          onVerseSelected={handleSeferOnlineRef}
          onBoundaryReached={handleScriptureBoundary}
          onLogoClick={() => {
            window.open(`${window.location.origin}?mode=control`, 'ControlPanel', 'width=1100,height=800');
          }}
        />
      </div>
    );
  }

  return (
    <div className="w-full h-screen overflow-hidden bg-black relative">
      <PresenterScreen
        background={activeBackground}
        slide={activePresenterSlide}
        presentationTitle={currentPresentation?.title || ''}
        fontScale={currentPresentation?.fontScale ?? 1}
        onLogoClick={() => {
          window.open(`${window.location.origin}?mode=control`, 'ControlPanel', 'width=1100,height=800');
        }}
        videoState={videoState}
        onVideoStateChange={(state) => syncState(currentPresentation, currentSlideIndex, backgroundLock, lockedBackgroundValue, userSelectedBackground, state)}
      />
    </div>
  )
}

export default App

