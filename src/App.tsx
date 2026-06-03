import { useState, useEffect, useCallback, useRef } from 'react';
import PresenterScreen from './components/presenter/PresenterScreen';
import MenuPopup from './components/control/MenuPopup';
import SeferReaderScreen from './components/presenter/SeferReaderScreen';
import defaultPresentations from '../presentations.json';
import { Music } from 'lucide-react';
import { AudioSyncEditor } from './components/AudioSyncEditor';

import type { AudioState, AudioSyncMap } from './types/audio';
import { DEFAULT_AUDIO_STATE } from './types/audio';
import type { AppMode, Presentation, ScriptureNavState, VideoState } from './types/presentation';

import {
  normalizePresentation,
  normalizePublicPath,
  fallbackBackgrounds,
  makeClientId,
  loadStoredPresenterState,
} from './utils/normalizePresentation';

import { useSyncState } from './hooks/useSyncState';
import { useBackgroundResolver } from './hooks/useBackgroundResolver';
import { useUrlSync } from './hooks/useUrlSync';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useAudioPlayback } from './hooks/useAudioPlayback';
import { useScriptureNavigation } from './hooks/useScriptureNavigation';

function App() {
  const modeParam = new URLSearchParams(window.location.search).get('mode');
  const isControlMode = modeParam === 'control';
  const isAudioEditorMode = modeParam === 'audio-editor';
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

  const [audioState, setAudioState] = useState<AudioState>(DEFAULT_AUDIO_STATE);
  const [audioSyncMaps, setAudioSyncMaps] = useState<AudioSyncMap[]>([]);
  const [availableAudioFiles, setAvailableAudioFiles] = useState<string[]>([]);

  const [appMode, setAppMode] = useState<AppMode>('slides');
  const [scriptureState, setScriptureState] = useState<ScriptureNavState | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);

  const currentPresentationRef = useRef<Presentation | null>(currentPresentation);
  const currentSlideIndexRef = useRef(currentSlideIndex);
  const backgroundLockRef = useRef(backgroundLock);
  const lockedBackgroundValueRef = useRef(lockedBackgroundValue);
  const userSelectedBackgroundRef = useRef(userSelectedBackground);
  const videoStateRef = useRef<VideoState | null>(videoState);
  const audioStateRef = useRef<AudioState>(audioState);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const appModeRef = useRef<AppMode>(appMode);
  const scriptureStateRef = useRef<ScriptureNavState | null>(scriptureState);
  const slideScriptureStateBeforeManualRef = useRef<ScriptureNavState | null>(null);
  const clientIdRef = useRef(makeClientId());

  useEffect(() => {
    currentPresentationRef.current = currentPresentation;
    currentSlideIndexRef.current = currentSlideIndex;
    backgroundLockRef.current = backgroundLock;
    lockedBackgroundValueRef.current = lockedBackgroundValue;
    userSelectedBackgroundRef.current = userSelectedBackground;
    videoStateRef.current = videoState;
    audioStateRef.current = audioState;
    appModeRef.current = appMode;
    scriptureStateRef.current = scriptureState;
  }, [currentPresentation, currentSlideIndex, backgroundLock, lockedBackgroundValue, userSelectedBackground, videoState, audioState, appMode, scriptureState]);

  useEffect(() => {
    if (__APP_MODE__ === 'singlefile') {
      setBackgrounds(fallbackBackgrounds.map(normalizePublicPath));
      const stored = localStorage.getItem('sefer-presenter-presentations');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setPresentations(parsed.map(normalizePresentation));
        } catch (err) {
          console.error("Error parsing stored presentations", err);
          setPresentations((defaultPresentations as Presentation[]).map(normalizePresentation));
        }
      } else {
        setPresentations((defaultPresentations as Presentation[]).map(normalizePresentation));
      }
    } else {
      fetch('/api/backgrounds')
        .then(res => res.json())
        .then(data => setBackgrounds(data))
        .catch(err => console.error("Error loading backgrounds", err));
      fetch('/api/presentations')
        .then(res => res.json())
        .then(data => setPresentations(data.map(normalizePresentation)))
        .catch(err => console.error("Error loading presentations", err));
      fetch('/api/audio')
        .then(res => res.json())
        .then(data => setAvailableAudioFiles(data))
        .catch(err => console.error("Error loading audio files", err));
      fetch('/api/audio-sync')
        .then(res => res.json())
        .then(data => setAudioSyncMaps(data))
        .catch(err => console.error("Error loading audio sync maps", err));
    }
  }, []);

  const { channel, syncState, emitAudioTelemetry, emitVideoTelemetry, emitDisplayTelemetry } = useSyncState({
    isControlMode, clientIdRef,
    currentPresentationRef, currentSlideIndexRef, backgroundLockRef,
    lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef,
    audioStateRef, appModeRef, scriptureStateRef,
    setCurrentPresentation, setCurrentSlideIndex, setBackgroundLock,
    setLockedBackgroundValue, setUserSelectedBackground, setVideoState,
    setAppMode, setScriptureState, setAudioState, setAudioSyncMaps,
  });

  const { getActiveBackground, handleToggleBackgroundLock, handleSelectBackgroundOverride } = useBackgroundResolver({
    currentPresentation, currentSlideIndex, backgroundLock,
    lockedBackgroundValue, userSelectedBackground, scriptureState,
    backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef,
    scriptureStateRef,
    setBackgroundLock, setLockedBackgroundValue, setUserSelectedBackground,
    emitDisplayTelemetry,
  });

  const activeBackground = getActiveBackground();

  type SelectPresentationAndSlideHandler = (
    presentation: Presentation | null,
    slideIndex: number,
    direction?: 'forward' | 'backward',
    targetVerse?: string
  ) => void;

  const handleSelectPresentationAndSlideRef = useRef<SelectPresentationAndSlideHandler | null>(null);
  const handleSaveRef = useRef<((presentation: Presentation) => void) | null>(null);

  const {
    buildScriptureSlideState,
    handleProjectScripture,
    handleUpdateScriptureFontSizes,
    handleSeferOnlineRef,
    handleAddScriptureSlide,
    handleScriptureBoundary,
    handleScriptureEscape,
    handleScriptureArrowNav,
  } = useScriptureNavigation({
    isControlMode, currentPresentationRef, currentSlideIndexRef, backgroundLockRef,
    lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef, appModeRef, scriptureStateRef,
    setAppMode, setScriptureState, syncState, 
    handleSelectPresentationAndSlide: (...args) => handleSelectPresentationAndSlideRef.current?.(...args),
    handleSave: (p) => handleSaveRef.current?.(p), 
    slideScriptureStateBeforeManualRef
  });

  const handleSelectPresentationAndSlide = useCallback((p: Presentation | null, idx: number, direction: 'forward' | 'backward' = 'forward', targetVerse?: string) => {
    const normalizedPresentation = p ? normalizePresentation(p) : null;
    setCurrentPresentation(normalizedPresentation);
    setCurrentSlideIndex(idx);
    setVideoState(null);

    const slide = normalizedPresentation && idx >= 0 ? normalizedPresentation.slides[idx] : null;
    const bgVal = slide?.background ?? '';
    const isIgnored = bgVal === 'Ignorar' || bgVal === 'No cambiar';
    const scriptureSlideState = buildScriptureSlideState(slide, direction, targetVerse);
    const nextAppMode: AppMode = scriptureSlideState ? 'scripture' : 'slides';

    setAppMode(nextAppMode);
    if (scriptureSlideState) {
      setScriptureState(scriptureSlideState);
    }

    if (isIgnored) {
      syncState({
        presentation: normalizedPresentation, slideIndex: idx, bgLock: backgroundLockRef.current,
        lockedBg: lockedBackgroundValueRef.current, userSelectedBg: userSelectedBackgroundRef.current,
        videoState: null, appMode: nextAppMode, scriptureState: scriptureSlideState ?? scriptureStateRef.current
      });
    } else {
      setUserSelectedBackground(null);
      syncState({
        presentation: normalizedPresentation, slideIndex: idx, bgLock: backgroundLockRef.current,
        lockedBg: lockedBackgroundValueRef.current, userSelectedBg: null,
        videoState: null, appMode: nextAppMode, scriptureState: scriptureSlideState ?? scriptureStateRef.current
      });
    }
  }, [syncState, buildScriptureSlideState, backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef, scriptureStateRef]);
  handleSelectPresentationAndSlideRef.current = handleSelectPresentationAndSlide;

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
  };

  const handleSave = useCallback((presentation: Presentation) => {
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
  }, [presentations, handleSelectPresentationAndSlide]);
  handleSaveRef.current = handleSave;

  const handleResetState = useCallback(() => {
    localStorage.removeItem('sefer-presenter-state');
    localStorage.removeItem('sefer-presenter-bg-lock');
    localStorage.removeItem('sefer-presenter-locked-bg');
    setBackgroundLock(false);
    setLockedBackgroundValue(null);
    setUserSelectedBackground(null);
    setCurrentPresentation(null);
    setCurrentSlideIndex(-1);
    setVideoState(null);
    setAppMode('slides');
    setScriptureState(null);

    syncState({ presentation: null, slideIndex: -1, bgLock: false, lockedBg: null, userSelectedBg: null, videoState: null, appMode: 'slides', scriptureState: null });
    window.history.replaceState(null, '', `/${window.location.search}`);
  }, [syncState]);

  useUrlSync({
    presentations, currentPresentation, currentSlideIndex, appMode, scriptureState,
    currentPresentationRef, currentSlideIndexRef, scriptureStateRef, slideScriptureStateBeforeManualRef,
    handleSelectPresentationAndSlide
  });

  useKeyboardNavigation({
    isControlMode, currentPresentation, currentSlideIndex, appModeRef, scriptureStateRef,
    currentPresentationRef, currentSlideIndexRef,
    handleSelectPresentationAndSlide, handleScriptureEscape, handleScriptureArrowNav
  });

  useAudioPlayback({
    isControlMode, audioState, audioStateRef, audioSyncMaps, currentSlideIndex, currentPresentationId: currentPresentation?.id, scriptureState,
    audioRef, currentPresentationRef, setAutoplayBlocked, emitAudioTelemetry,
    handleSelectPresentationAndSlide
  });

  useEffect(() => {
    if (currentPresentation) {
      document.title = `SeferPresenter - ${currentPresentation.title}`;
    } else {
      document.title = `SeferPresenter`;
    }
  }, [currentPresentation]);

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

  const handleVideoStateChange = useCallback((state: VideoState | null) => {
    setVideoState(state);
    emitVideoTelemetry(state);
  }, [emitVideoTelemetry]);

  const handleToggleAppMode = useCallback((mode: AppMode) => {
    if (mode === 'seferManual') {
      if (appModeRef.current !== 'seferManual') {
        slideScriptureStateBeforeManualRef.current = appModeRef.current === 'scripture'
          ? scriptureStateRef.current
          : null;
      }

      const slide = currentPresentationRef.current && currentSlideIndexRef.current >= 0
        ? currentPresentationRef.current.slides[currentSlideIndexRef.current]
        : null;
      const slideState = buildScriptureSlideState(slide, 'forward');
      const sourceState = scriptureStateRef.current ?? slideState;
      const manualState: ScriptureNavState | null = sourceState
        ? {
          ...sourceState,
          verseStart: sourceState.verse,
          verseEnd: undefined,
          scriptureKind: 'sefer',
          command: 'navigate',
          commandId: Date.now(),
        }
        : null;

      if (manualState) {
        setScriptureState(manualState);
      }
      setAppMode('seferManual');
      syncState({
        presentation: currentPresentationRef.current, slideIndex: currentSlideIndexRef.current,
        bgLock: backgroundLockRef.current, lockedBg: lockedBackgroundValueRef.current,
        userSelectedBg: userSelectedBackgroundRef.current, videoState: videoStateRef.current,
        appMode: 'seferManual', scriptureState: manualState ?? scriptureStateRef.current
      });
      return;
    }

    if (mode === 'slides') {
      const fallbackPresentation = currentPresentationRef.current ?? storedPresenterState?.presentation ?? presentations[0] ?? null;
      const fallbackSlideIndex = fallbackPresentation ? (currentSlideIndexRef.current >= 0 && currentPresentationRef.current ? currentSlideIndexRef.current : 0) : -1;

      if (!currentPresentationRef.current && fallbackPresentation) {
        setCurrentPresentation(normalizePresentation(fallbackPresentation));
        setCurrentSlideIndex(fallbackSlideIndex);
      } else if (currentPresentationRef.current && currentSlideIndexRef.current < 0) {
        setCurrentSlideIndex(0);
      }

      if (appModeRef.current === 'seferManual') {
        const slide = currentPresentationRef.current && currentSlideIndexRef.current >= 0
          ? currentPresentationRef.current.slides[currentSlideIndexRef.current]
          : null;
        const restoredState = slideScriptureStateBeforeManualRef.current ?? buildScriptureSlideState(slide, 'forward');
        const returnsToScripture = !!restoredState && !!slide && (slide.type === 'sefer' || slide.type === 'tanaj');
        const nextMode: AppMode = returnsToScripture ? 'scripture' : 'slides';

        if (restoredState) {
          setScriptureState(restoredState);
        }
        setAppMode(nextMode);
        syncState({
          presentation: currentPresentationRef.current ?? storedPresenterState?.presentation ?? presentations[0] ?? null,
          slideIndex: (currentSlideIndexRef.current >= 0 && currentPresentationRef.current) ? currentSlideIndexRef.current : 0,
          bgLock: backgroundLockRef.current, lockedBg: lockedBackgroundValueRef.current,
          userSelectedBg: userSelectedBackgroundRef.current, videoState: videoStateRef.current,
          appMode: nextMode, scriptureState: restoredState ?? scriptureStateRef.current
        });
        return;
      }
    }

    setAppMode(mode);
    syncState({
      presentation: mode === 'slides' ? (currentPresentationRef.current ?? storedPresenterState?.presentation ?? presentations[0] ?? null) : currentPresentationRef.current,
      slideIndex: mode === 'slides' ? ((currentSlideIndexRef.current >= 0 && currentPresentationRef.current) ? currentSlideIndexRef.current : 0) : currentSlideIndexRef.current,
      bgLock: backgroundLockRef.current, lockedBg: lockedBackgroundValueRef.current,
      userSelectedBg: userSelectedBackgroundRef.current, videoState: videoStateRef.current,
      appMode: mode, scriptureState: scriptureStateRef.current
    });
  }, [buildScriptureSlideState, presentations, storedPresenterState, syncState]);

  if (isAudioEditorMode) {
    return (
      <div className="w-screen h-screen bg-gray-900 overflow-hidden">
        <AudioSyncEditor
          isOpen={true}
          onClose={() => window.close()}
          presentations={presentations}
          activePresentationId={currentPresentation?.id || null}
          activeAudioSrc={audioState.audioSrc}
          availableAudioFiles={availableAudioFiles}
          audioSyncMaps={audioSyncMaps}
          onAudioSyncMapsChange={(maps) => {
            setAudioSyncMaps(maps);
            if (__APP_MODE__ !== 'singlefile') {
              fetch('/api/audio-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(maps)
              }).catch(err => console.error('Error saving audio sync maps', err));
            } else {
              localStorage.setItem('sefer-presenter-audio-sync', JSON.stringify(maps));
            }
            channel.postMessage({ type: 'AUDIO_SYNC_MAPS_UPDATE', maps });
          }}
        />
      </div>
    );
  }

  if (isControlMode) {
    return (
      <div id="section-app-control-mode" className="w-full h-screen bg-gray-900 overflow-hidden">
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
          onResetState={handleResetState}
          onSelectPresentation={(p, idx, targetVerse) => handleSelectPresentationAndSlide(p, idx ?? 0, 'forward', targetVerse)}
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
          onVideoStateChange={handleVideoStateChange}
          audioState={audioState}
          audioSyncMaps={audioSyncMaps}
          availableAudioFiles={availableAudioFiles}
          onAudioStateChange={(state) => {
            setAudioState(state);
            syncState({
              presentation: currentPresentation, slideIndex: currentSlideIndex, bgLock: backgroundLock,
              lockedBg: lockedBackgroundValue, userSelectedBg: userSelectedBackground, audioState: state
            });
          }}
          onAudioSyncMapsChange={(maps) => {
            setAudioSyncMaps(maps);
            if (__APP_MODE__ !== 'singlefile') {
              fetch('/api/audio-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(maps)
              }).catch(err => console.error('Error saving audio sync maps', err));
            } else {
              localStorage.setItem('sefer-presenter-audio-sync', JSON.stringify(maps));
            }
          }}
          appMode={appMode}
          scriptureState={scriptureState}
          onUpdateScriptureFontSizes={handleUpdateScriptureFontSizes}
          onToggleAppMode={handleToggleAppMode}
          onProjectScripture={handleProjectScripture}
          onAddScriptureSlide={handleAddScriptureSlide}
          onBoundaryReached={handleScriptureBoundary}
        />
      </div>
    );
  }

  // Presenter (big screen) mode
  return (
    <div className="w-full h-screen overflow-hidden bg-black relative">
      {(appMode === 'seferManual' || (appMode === 'scripture' && scriptureState?.scriptureKind !== 'tanaj')) && scriptureState ? (
        <div id="section-app-scripture-reader-view" className="w-full h-full overflow-hidden">
          <SeferReaderScreen
            scriptureState={scriptureState}
            onVerseSelected={handleSeferOnlineRef}
            onBoundaryReached={handleScriptureBoundary}
            onLogoClick={() => {
              window.open(`${window.location.origin}?mode=control`, 'ControlPanel', 'width=1100,height=800');
            }}
          />
        </div>
      ) : (
        <div id="section-app-presenter-slide-view" className="w-full h-full overflow-hidden relative">
          <PresenterScreen
            background={activeBackground}
            slide={activePresenterSlide}
            presentationTitle={currentPresentation?.title || ''}
            fontScale={currentPresentation?.fontScale ?? 1}
            onLogoClick={() => {
              window.open(`${window.location.origin}?mode=control`, 'ControlPanel', 'width=1100,height=800');
            }}
            videoState={videoState}
            onVideoStateChange={handleVideoStateChange}
          />
        </div>
      )}

      {/* Hidden audio element for karaoke and music sync */}
      <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />

      {/* Autoplay block overlay banner */}
      {autoplayBlocked && (
        <div 
          onClick={() => {
            const audio = audioRef.current;
            if (audio) {
              audio.play()
                .then(() => setAutoplayBlocked(false))
                .catch(err => console.error("Autoplay retry failed:", err));
            }
          }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-yellow-600 hover:bg-yellow-500 text-white font-bold text-xs px-5 py-2.5 rounded-full shadow-xl cursor-pointer flex items-center gap-2 animate-bounce transition-all border border-yellow-400 shadow-yellow-950/30"
          title="Haga clic aquí para habilitar la reproducción de audio en esta pestaña"
        >
          <Music size={13} className="animate-pulse text-white" />
          <span>Haga clic para habilitar sonido</span>
        </div>
      )}
    </div>
  );
}

export default App;
