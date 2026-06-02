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

  // ── Apply incoming remote state (unified for both BroadcastChannel and SSE) ─
  const applyRemoteState = useCallback((data: Record<string, unknown>, persist = true) => {
    const normalizedPresentation = data.presentation
      ? normalizePresentation(data.presentation as Presentation)
      : null;

    if (JSON.stringify(currentPresentationRef.current) !== JSON.stringify(normalizedPresentation)) {
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
    if (data.videoState !== undefined && JSON.stringify(videoStateRef.current) !== JSON.stringify(data.videoState)) {
      setVideoState(data.videoState as VideoState | null);
    }
    if (data.appMode !== undefined && appModeRef.current !== data.appMode) {
      setAppMode(data.appMode as AppMode);
    }
    if (data.scriptureState !== undefined && JSON.stringify(scriptureStateRef.current) !== JSON.stringify(data.scriptureState)) {
      setScriptureState(data.scriptureState as ScriptureNavState | null);
    }
    if (data.audioState !== undefined && JSON.stringify(audioStateRef.current) !== JSON.stringify(data.audioState)) {
      setAudioState(data.audioState as AudioState);
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
    setAppMode, setScriptureState, setAudioState, persistState,
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
    isControlMode, channel, clientIdRef, syncState, applyRemoteState,
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

        const normalizedPresentation = data.presentation
          ? normalizePresentation(data.presentation as Presentation)
          : null;

        const isDifferent =
          !currentPresentationRef.current ||
          currentPresentationRef.current.id !== (normalizedPresentation?.id ?? '') ||
          currentSlideIndexRef.current !== data.slideIndex ||
          backgroundLockRef.current !== data.backgroundLock ||
          lockedBackgroundValueRef.current !== data.lockedBackgroundValue ||
          userSelectedBackgroundRef.current !== data.userSelectedBackground ||
          JSON.stringify(videoStateRef.current) !== JSON.stringify(data.videoState) ||
          appModeRef.current !== data.appMode ||
          JSON.stringify(scriptureStateRef.current) !== JSON.stringify(data.scriptureState) ||
          JSON.stringify(audioStateRef.current) !== JSON.stringify(data.audioState);

        if (isDifferent) {
          applyRemoteState(data);
        }
      } catch (err) {
        console.error('Error parsing network state sync event', err);
      }
    };

    return () => eventSource.close();
  }, [
    clientIdRef, applyRemoteState,
    currentPresentationRef, currentSlideIndexRef, backgroundLockRef,
    lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef,
    appModeRef, scriptureStateRef, audioStateRef,
  ]);

  return { channel, syncState, persistState };
}
