import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import PresenterScreen from './components/PresenterScreen'
import MenuPopup from './components/MenuPopup'
import SeferOnlineIframeScreen from './components/SeferOnlineIframeScreen'
import defaultPresentations from '../presentations.json'
import type { SeferReaderState } from './hooks/useSeferReader'
import type { SeferOnlineRefPayload } from './components/SeferOnlineIframeScreen'

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
  type?: 'text' | 'video' | 'scripture'; // 'text' por defecto
  videoSrc?: string;
  videoVolume?: number;
  videoSpeed?: number;
  videoLoop?: boolean;
  videoStart?: number;
  videoEnd?: number;
  scriptureBook?: string;
  scriptureChapter?: string;
  scriptureVerseStart?: string;
  scriptureVerseEnd?: string;
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
  verse: string;
  verseNikud: string;
  transliteration: string;
  translation: string;
  verseIdx: number;
  totalVerses: number;
  command?: 'navigate' | 'next' | 'previous';
  commandId?: number;
}

// App mode: 'slides' is normal presentation, 'scripture' is live biblical reader
export type AppMode = 'slides' | 'scripture';

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

const normalizePresentation = (presentation: Presentation): Presentation => ({
  ...presentation,
  background: normalizePublicPath(presentation.background),
  fontScale: presentation.fontScale ?? 1
});

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
  }, [channel, persistState]);

  const handleSelectPresentationAndSlide = useCallback((p: Presentation | null, idx: number) => {
    const normalizedPresentation = p ? normalizePresentation(p) : null;
    setCurrentPresentation(normalizedPresentation);
    setCurrentSlideIndex(idx);
    setVideoState(null); // Reset video state on slide transition
    
    // Check if the clicked slide background is Ignorar / No cambiar
    const slide = normalizedPresentation && idx >= 0 ? normalizedPresentation.slides[idx] : null;
    const bgVal = slide?.background ?? '';
    const isIgnored = bgVal === 'Ignorar' || bgVal === 'No cambiar';
    const scriptureSlideState: ScriptureNavState | null = slide?.type === 'scripture'
      ? {
          bookEs: slide.scriptureBook || 'Gn',
          bookHeb: '',
          bookAbbrevEs: slide.scriptureBook || 'Gn',
          chapter: slide.scriptureChapter || '1',
          verse: slide.scriptureVerseStart || '1',
          verseNikud: '',
          transliteration: '',
          translation: '',
          verseIdx: 0,
          totalVerses: 0,
          command: 'navigate',
          commandId: ++scriptureCommandIdRef.current,
        }
      : null;
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
      const hash = window.location.hash.replace('#', '');
      const slideIndex = parseInt(hash, 10);
      const targetIndex = !isNaN(slideIndex) && slideIndex >= 0 && slideIndex < matched.slides.length ? slideIndex : 0;

      if (
        !currentPresentationRef.current ||
        currentPresentationRef.current.id !== matched.id ||
        currentSlideIndexRef.current !== targetIndex
      ) {
        handleSelectPresentationAndSlide(matched, targetIndex);
      }
    }
  }, [presentations, handleSelectPresentationAndSlide]);

  // Sync URL when state changes
  useEffect(() => {
    if (currentPresentation) {
      const slug = slugify(currentPresentation.title);
      const hash = currentSlideIndex >= 0 ? `#${currentSlideIndex}` : '';
      const search = window.location.search;
      const normalizedPath = window.location.pathname.replace(/\/$/, '');
      const targetPath = `/${slug}${search}${hash}`;
      if (normalizedPath !== `/${slug}` || window.location.hash !== hash) {
        window.history.replaceState(null, '', targetPath);
      }
    }
  }, [currentPresentation, currentSlideIndex]);

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

  // Handle keyboard navigation from both the control panel and the presenter window.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't navigate if user is typing in the editor
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

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
          const currentScripture = scriptureStateRef.current;
          if (!currentScripture) return;

          e.preventDefault();
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
        handleSelectPresentationAndSlide(currentPresentation, nextIdx);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevIdx = Math.max(currentSlideIndex - 1, 0);
        handleSelectPresentationAndSlide(currentPresentation, prevIdx);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPresentation, currentSlideIndex, handleSelectPresentationAndSlide, syncState]);

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

    // 3. Flujo secuencial de diapositivas
    const bgVal = activeSlide.background;

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
  }, [currentPresentation, currentSlideIndex, backgroundLock, lockedBackgroundValue, userSelectedBackground]);

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

  // Helper: project a scripture verse (called from MenuPopup/SeferControlPanel)
  const handleProjectScripture = useCallback((
    state: SeferReaderState,
    command: ScriptureNavState['command'] = 'navigate'
  ) => {
    const navState: ScriptureNavState = {
      bookEs: state.bookEs,
      bookHeb: state.bookHeb,
      bookAbbrevEs: state.bookAbbrevEs,
      chapter: state.chapter,
      verse: state.verse,
      verseNikud: state.verseNikud,
      transliteration: state.transliteration,
      translation: state.translation,
      verseIdx: state.verseIdx,
      totalVerses: state.totalVerses,
      command,
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
    if (appMode !== 'scripture') setAppMode('scripture');
  }, [syncState, appMode]);

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
      verse: String(payload.verse ?? previous?.verse ?? '1'),
      verseNikud: String(payload.verseNikud ?? previous?.verseNikud ?? ''),
      transliteration: String(payload.transliteration ?? previous?.transliteration ?? ''),
      translation: String(payload.translation ?? previous?.translation ?? ''),
      verseIdx: numberOrFallback(payload.verseIdx, previous?.verseIdx ?? 0),
      totalVerses: numberOrFallback(payload.totalVerses, previous?.totalVerses ?? 0),
      command: undefined,
      commandId: previous?.commandId,
    };

    if (JSON.stringify(previous) === JSON.stringify(navState)) return;

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
  }, [syncState]);

  // Helper: add current scripture verse as a trilingual slide to the active presentation
  const handleAddScriptureSlide = useCallback((state: SeferReaderState) => {
    if (!currentPresentation) return;
    const newSlide: Slide = {
      id: `slide-scripture-${Date.now()}`,
      label: `${state.bookAbbrevEs} ${state.chapter}:${state.verse}`,
      lines: [
        state.verseNikud,
        state.transliteration,
        state.translation,
      ],
      type: 'text',
    };
    // Insert after currentSlideIndex (or at end)
    const insertAt = currentSlideIndex >= 0 ? currentSlideIndex + 1 : currentPresentation.slides.length;
    const updatedSlides = [
      ...currentPresentation.slides.slice(0, insertAt),
      newSlide,
      ...currentPresentation.slides.slice(insertAt),
    ];
    const updatedPresentation: Presentation = { ...currentPresentation, mode: 'trilingual', slides: updatedSlides };
    handleSave(updatedPresentation);
  }, [currentPresentation, currentSlideIndex, handleSave]);

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
          onToggleAppMode={(mode: AppMode) => {
            setAppMode(mode);
            syncState(
              currentPresentationRef.current,
              currentSlideIndexRef.current,
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
        />
      </div>
    );
  }

  // Presenter (big screen) mode
  if (appMode === 'scripture' && scriptureState) {
    return (
      <div className="w-full h-screen overflow-hidden">
        <SeferOnlineIframeScreen
          scriptureState={scriptureState}
          onVerseChanged={handleSeferOnlineRef}
          onVerseSelected={handleSeferOnlineRef}
        />
      </div>
    );
  }

  return (
    <div className="w-full h-screen overflow-hidden bg-black relative">
      <PresenterScreen 
        background={activeBackground} 
        slide={activeSlide} 
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
