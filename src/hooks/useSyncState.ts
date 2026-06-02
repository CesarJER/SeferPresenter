import { useCallback, useEffect, useMemo } from 'react';
import type { AudioState, AudioSyncMap } from '../types/audio';
import type { AppMode, Presentation, ScriptureNavState, VideoState } from '../types/presentation';
import { normalizePresentation } from '../utils/normalizePresentation';

interface SyncStateOptions {
  presentation: Presentation | null;
  slideIndex: number;
  bgLock: boolean;
  lockedBg: string | null;
  userSelectedBg: string | null;
  videoState?: VideoState | null;
  appMode?: AppMode;
  scriptureState?: ScriptureNavState | null;
  audioState?: AudioState;
}

interface UseSyncStateProps {
  isControlMode: boolean;
  clientIdRef: React.MutableRefObject<string>;
  // Refs to current state (to read inside message handlers without stale closures)
  currentPresentationRef: React.MutableRefObject<Presentation | null>;
  currentSlideIndexRef: React.MutableRefObject<number>;
  backgroundLockRef: React.MutableRefObject<boolean>;
  lockedBackgroundValueRef: React.MutableRefObject<string | null>;
  userSelectedBackgroundRef: React.MutableRefObject<string | null>;
  videoStateRef: React.MutableRefObject<VideoState | null>;
  audioStateRef: React.MutableRefObject<AudioState>;
  appModeRef: React.MutableRefObject<AppMode>;
  scriptureStateRef: React.MutableRefObject<ScriptureNavState | null>;
  // State setters
  setCurrentPresentation: (p: Presentation | null) => void;
  setCurrentSlideIndex: (idx: number) => void;
  setBackgroundLock: (locked: boolean) => void;
  setLockedBackgroundValue: (bg: string | null) => void;
  setUserSelectedBackground: (bg: string | null) => void;
  setVideoState: (state: VideoState | null) => void;
  setAppMode: (mode: AppMode) => void;
  setScriptureState: (state: ScriptureNavState | null) => void;
  setAudioState: (state: AudioState) => void;
  setAudioSyncMaps: (maps: AudioSyncMap[]) => void;
}

const areStringArraysEqual = (left: string[] = [], right: string[] = []) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const areRecordsEqual = (left?: Record<string, string>, right?: Record<string, string>) => {
  const leftEntries = Object.entries(left ?? {});
  const rightRecord = right ?? {};
  return (
    leftEntries.length === Object.keys(rightRecord).length &&
    leftEntries.every(([key, value]) => rightRecord[key] === value)
  );
};

const arePresentationsEqual = (left: Presentation | null, right: Presentation | null) => {
  if (left === right) return true;
  if (!left || !right) return false;
  if (
    left.id !== right.id ||
    left.title !== right.title ||
    left.background !== right.background ||
    left.mode !== right.mode ||
    left.fontScale !== right.fontScale ||
    left.slides.length !== right.slides.length
  ) {
    return false;
  }

  return left.slides.every((leftSlide, index) => {
    const rightSlide = right.slides[index];
    return (
      leftSlide.id === rightSlide.id &&
      leftSlide.label === rightSlide.label &&
      leftSlide.background === rightSlide.background &&
      leftSlide.type === rightSlide.type &&
      leftSlide.videoSrc === rightSlide.videoSrc &&
      leftSlide.videoVolume === rightSlide.videoVolume &&
      leftSlide.videoSpeed === rightSlide.videoSpeed &&
      leftSlide.videoLoop === rightSlide.videoLoop &&
      leftSlide.videoPresenterNav === rightSlide.videoPresenterNav &&
      leftSlide.videoStart === rightSlide.videoStart &&
      leftSlide.videoEnd === rightSlide.videoEnd &&
      leftSlide.scriptureBook === rightSlide.scriptureBook &&
      leftSlide.scriptureChapter === rightSlide.scriptureChapter &&
      leftSlide.scriptureVerseStart === rightSlide.scriptureVerseStart &&
      leftSlide.scriptureVerseEnd === rightSlide.scriptureVerseEnd &&
      areStringArraysEqual(leftSlide.lines, rightSlide.lines) &&
      areRecordsEqual(leftSlide.scriptureVerseBackgrounds, rightSlide.scriptureVerseBackgrounds)
    );
  });
};

const areVideoStatesEqual = (left: VideoState | null, right: VideoState | null) => {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.isPlaying === right.isPlaying &&
    left.currentTime === right.currentTime &&
    left.duration === right.duration &&
    left.volume === right.volume &&
    left.speed === right.speed &&
    left.loop === right.loop &&
    left.videoSrc === right.videoSrc &&
    left.startTime === right.startTime &&
    left.endTime === right.endTime &&
    left.lastUpdatedBy === right.lastUpdatedBy &&
    left.timestamp === right.timestamp
  );
};

const areScriptureStatesEqual = (left: ScriptureNavState | null, right: ScriptureNavState | null) => {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.bookEs === right.bookEs &&
    left.bookHeb === right.bookHeb &&
    left.bookAbbrevEs === right.bookAbbrevEs &&
    left.chapter === right.chapter &&
    left.verseStart === right.verseStart &&
    left.verse === right.verse &&
    left.verseEnd === right.verseEnd &&
    left.verseNikud === right.verseNikud &&
    left.transliteration === right.transliteration &&
    left.translation === right.translation &&
    left.verseIdx === right.verseIdx &&
    left.totalVerses === right.totalVerses &&
    left.scriptureKind === right.scriptureKind &&
    left.command === right.command &&
    left.commandId === right.commandId &&
    left.hebrewFontSize === right.hebrewFontSize &&
    left.combinedTextBaseSize === right.combinedTextBaseSize
  );
};

export function useSyncState(props: UseSyncStateProps) {
  const {
    isControlMode, clientIdRef,
    currentPresentationRef, currentSlideIndexRef, backgroundLockRef,
    lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef,
    audioStateRef, appModeRef, scriptureStateRef,
    setCurrentPresentation, setCurrentSlideIndex, setBackgroundLock,
    setLockedBackgroundValue, setUserSelectedBackground, setVideoState,
    setAppMode, setScriptureState, setAudioState, setAudioSyncMaps,
  } = props;

  const channel = useMemo(() => new BroadcastChannel('sefer-presenter'), []);

  // ── Persist to localStorage ───────────────────────────────────────
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

  // ── Broadcast + API sync ──────────────────────────────────────────
  const syncState = useCallback((opts: SyncStateOptions) => {
    const {
      presentation, slideIndex, bgLock, lockedBg, userSelectedBg,
      videoState, appMode, scriptureState, audioState,
    } = opts;

    const activeVideoState = videoState !== undefined ? videoState : videoStateRef.current;
    const activeAppMode = appMode !== undefined ? appMode : appModeRef.current;
    const activeScriptureState = scriptureState !== undefined ? scriptureState : scriptureStateRef.current;
    const activeAudioState = audioState !== undefined ? audioState : audioStateRef.current;

    // Update local refs immediately (avoid stale reads before React re-renders)
    if (videoState !== undefined) videoStateRef.current = activeVideoState;
    if (audioState !== undefined) audioStateRef.current = activeAudioState;

    persistState(presentation, slideIndex, bgLock, lockedBg);

    const payload = {
      type: 'SYNC_STATE' as const,
      clientId: clientIdRef.current,
      origin: isControlMode ? 'control' as const : 'presenter' as const,
      presentation,
      slideIndex,
      backgroundLock: bgLock,
      lockedBackgroundValue: lockedBg,
      userSelectedBackground: userSelectedBg,
      videoState: activeVideoState,
      appMode: activeAppMode,
      scriptureState: activeScriptureState,
      audioState: activeAudioState,
    };

    channel.postMessage(payload);

    if (__APP_MODE__ !== 'singlefile') {
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => console.error('Error syncing state to network', err));
    }
  }, [channel, isControlMode, persistState, videoStateRef, appModeRef, scriptureStateRef, audioStateRef, clientIdRef]);

  const applyAudioTelemetry = useCallback((incomingAudioState: AudioState) => {
    const currentAudioState = audioStateRef.current;
    const isDifferent =
      currentAudioState.isPlaying !== incomingAudioState.isPlaying ||
      Math.abs(currentAudioState.currentTime - incomingAudioState.currentTime) > 0.05 ||
      currentAudioState.duration !== incomingAudioState.duration ||
      currentAudioState.volume !== incomingAudioState.volume ||
      currentAudioState.audioSrc !== incomingAudioState.audioSrc ||
      currentAudioState.activeSyncMapId !== incomingAudioState.activeSyncMapId ||
      currentAudioState.syncMode !== incomingAudioState.syncMode ||
      currentAudioState.lastUpdatedBy !== incomingAudioState.lastUpdatedBy ||
      currentAudioState.changeType !== incomingAudioState.changeType;

    if (isDifferent) {
      audioStateRef.current = incomingAudioState;
      setAudioState(incomingAudioState);
    }
  }, [audioStateRef, setAudioState]);

  const emitAudioTelemetry = useCallback((audioState: AudioState) => {
    audioStateRef.current = audioState;

    const payload = {
      type: 'AUDIO_TELEMETRY' as const,
      clientId: clientIdRef.current,
      origin: isControlMode ? 'control' as const : 'presenter' as const,
      audioState,
    };

    channel.postMessage(payload);

    if (__APP_MODE__ !== 'singlefile') {
      fetch('/api/audio-telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => console.error('Error syncing audio telemetry to network', err));
    }
  }, [audioStateRef, channel, clientIdRef, isControlMode]);

  // ── Apply incoming remote state (unified for both BroadcastChannel and SSE) ─
  const applyRemoteState = useCallback((data: Record<string, unknown>, persist = true) => {
    const normalizedPresentation = data.presentation
      ? normalizePresentation(data.presentation as Presentation)
      : null;

    if (!arePresentationsEqual(currentPresentationRef.current, normalizedPresentation)) {
      setCurrentPresentation(normalizedPresentation);
    }
    if (currentSlideIndexRef.current !== data.slideIndex) {
      setCurrentSlideIndex(data.slideIndex as number);
    }
    if (data.backgroundLock !== undefined && backgroundLockRef.current !== data.backgroundLock) {
      setBackgroundLock(data.backgroundLock as boolean);
    }
    if (data.lockedBackgroundValue !== undefined && lockedBackgroundValueRef.current !== data.lockedBackgroundValue) {
      setLockedBackgroundValue(data.lockedBackgroundValue as string | null);
    }
    if (data.userSelectedBackground !== undefined && userSelectedBackgroundRef.current !== data.userSelectedBackground) {
      setUserSelectedBackground(data.userSelectedBackground as string | null);
    }
    if (data.videoState !== undefined && !areVideoStatesEqual(videoStateRef.current, data.videoState as VideoState | null)) {
      setVideoState(data.videoState as VideoState | null);
    }
    if (data.appMode !== undefined && appModeRef.current !== data.appMode) {
      setAppMode(data.appMode as AppMode);
    }
    if (data.scriptureState !== undefined && !areScriptureStatesEqual(scriptureStateRef.current, data.scriptureState as ScriptureNavState | null)) {
      setScriptureState(data.scriptureState as ScriptureNavState | null);
    }
    if (data.audioState !== undefined) {
      applyAudioTelemetry(data.audioState as AudioState);
    }

    if (persist) {
      persistState(
        normalizedPresentation,
        data.slideIndex as number,
        (data.backgroundLock ?? backgroundLockRef.current) as boolean,
        (data.lockedBackgroundValue ?? lockedBackgroundValueRef.current) as string | null
      );
    }
  }, [
    currentPresentationRef, currentSlideIndexRef, backgroundLockRef,
    lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef,
    appModeRef, scriptureStateRef, audioStateRef,
    setCurrentPresentation, setCurrentSlideIndex, setBackgroundLock,
    setLockedBackgroundValue, setUserSelectedBackground, setVideoState,
    setAppMode, setScriptureState, applyAudioTelemetry, persistState,
  ]);

  // ── BroadcastChannel listener ─────────────────────────────────────
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.clientId === clientIdRef.current) return;

      if (data.type === 'AUDIO_SYNC_MAPS_UPDATE') {
        setAudioSyncMaps(data.maps);
        return;
      }

      if (data.type === 'AUDIO_TELEMETRY') {
        applyAudioTelemetry(data.audioState as AudioState);
        return;
      }

      if (data.type === 'REQUEST_STATE') {
        if (!isControlMode) return; // only control responds
        syncState({
          presentation: currentPresentationRef.current,
          slideIndex: currentSlideIndexRef.current,
          bgLock: backgroundLockRef.current,
          lockedBg: lockedBackgroundValueRef.current,
          userSelectedBg: userSelectedBackgroundRef.current,
          videoState: videoStateRef.current,
          appMode: appModeRef.current,
          scriptureState: scriptureStateRef.current,
          audioState: audioStateRef.current,
        });
        return;
      }

      if (data.type === 'SYNC_STATE') {
        applyRemoteState(data);
      }
    };

    channel.addEventListener('message', handleMessage);

    // Presenter asks for current state on open
    if (!isControlMode) {
      channel.postMessage({ type: 'REQUEST_STATE' });
    }

    return () => channel.removeEventListener('message', handleMessage);
  }, [
    isControlMode, channel, clientIdRef, syncState, applyRemoteState, applyAudioTelemetry,
    setAudioSyncMaps, currentPresentationRef, currentSlideIndexRef,
    backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef,
    videoStateRef, appModeRef, scriptureStateRef, audioStateRef,
  ]);

  // ── SSE listener (web mode only) ──────────────────────────────────
  useEffect(() => {
    if (__APP_MODE__ === 'singlefile') return;

    const eventSource = new EventSource('/api/state-events');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data || data.clientId === clientIdRef.current) return;

        if (data.type === 'AUDIO_TELEMETRY') {
          applyAudioTelemetry(data.audioState as AudioState);
          return;
        }

        applyRemoteState(data);
      } catch (err) {
        console.error('Error parsing network state sync event', err);
      }
    };

    return () => eventSource.close();
  }, [
    clientIdRef, applyRemoteState, applyAudioTelemetry,
  ]);

  return { channel, syncState, persistState, emitAudioTelemetry };
}
