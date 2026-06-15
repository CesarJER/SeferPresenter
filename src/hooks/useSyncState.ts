import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { AudioState, AudioSyncMap } from '../types/audio';
import type { AppMode, Presentation, ScriptureNavState, VideoState } from '../types/presentation';
import type { QuizSyncState } from '../types/quiz';
import type { RemoteCommandPayload, DisplayTelemetryState } from '../types/sync';
import { normalizePresentation } from '../utils/normalizePresentation';
import { makeSyncMessage } from '../utils/syncProtocol';
import { validateRemoteStatePayload, validateSyncMessage } from '../utils/validation';

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
  quizState?: QuizSyncState | null;
  stepIndex?: number;
}

interface UseSyncStateProps {
  isControlMode: boolean;
  isPresenterMode: boolean;
  onRemoteCommand?: (payload: RemoteCommandPayload) => void;
  clientIdRef: React.MutableRefObject<string>;
  // Refs to current state (to read inside message handlers without stale closures)
  currentPresentationRef: React.MutableRefObject<Presentation | null>;
  currentSlideIndexRef: React.MutableRefObject<number>;
  currentStepIndexRef: React.MutableRefObject<number>;
  backgroundLockRef: React.MutableRefObject<boolean>;
  lockedBackgroundValueRef: React.MutableRefObject<string | null>;
  userSelectedBackgroundRef: React.MutableRefObject<string | null>;
  videoStateRef: React.MutableRefObject<VideoState | null>;
  audioStateRef: React.MutableRefObject<AudioState>;
  appModeRef: React.MutableRefObject<AppMode>;
  scriptureStateRef: React.MutableRefObject<ScriptureNavState | null>;
  quizStateRef?: React.MutableRefObject<QuizSyncState | null>;
  // State setters
  setCurrentPresentation: (p: Presentation | null) => void;
  setCurrentSlideIndex: (idx: number) => void;
  setCurrentStepIndex: (idx: number) => void;
  setBackgroundLock: (locked: boolean) => void;
  setLockedBackgroundValue: (bg: string | null) => void;
  setUserSelectedBackground: (bg: string | null) => void;
  setVideoState: (state: VideoState | null) => void;
  setAppMode: (mode: AppMode) => void;
  setScriptureState: (state: ScriptureNavState | null) => void;
  setAudioState: (state: AudioState) => void;
  setAudioSyncMaps: (maps: AudioSyncMap[]) => void;
  setQuizState?: (state: QuizSyncState | null) => void;
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

const areJsonEqual = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

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
      leftSlide.mediaSrc === rightSlide.mediaSrc &&
      leftSlide.mediaVolume === rightSlide.mediaVolume &&
      leftSlide.mediaSpeed === rightSlide.mediaSpeed &&
      leftSlide.mediaLoop === rightSlide.mediaLoop &&
      leftSlide.mediaPresenterNav === rightSlide.mediaPresenterNav &&
      leftSlide.mediaStart === rightSlide.mediaStart &&
      leftSlide.mediaEnd === rightSlide.mediaEnd &&
      leftSlide.scriptureBook === rightSlide.scriptureBook &&
      leftSlide.scriptureChapter === rightSlide.scriptureChapter &&
      leftSlide.scriptureVerseStart === rightSlide.scriptureVerseStart &&
      leftSlide.scriptureVerseEnd === rightSlide.scriptureVerseEnd &&
      areStringArraysEqual(leftSlide.lines, rightSlide.lines) &&
      areRecordsEqual(leftSlide.scriptureVerseBackgrounds, rightSlide.scriptureVerseBackgrounds) &&
      areJsonEqual(leftSlide.quizData, rightSlide.quizData)
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
    left.mediaSrc === right.mediaSrc &&
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
    isControlMode, isPresenterMode, onRemoteCommand, clientIdRef,
    currentPresentationRef, currentSlideIndexRef, currentStepIndexRef, backgroundLockRef,
    lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef,
    audioStateRef, appModeRef, scriptureStateRef,
    quizStateRef,
    setCurrentPresentation, setCurrentSlideIndex, setCurrentStepIndex, setBackgroundLock,
    setLockedBackgroundValue, setUserSelectedBackground, setVideoState,
    setAppMode, setScriptureState, setAudioState, setAudioSyncMaps,
    setQuizState,
  } = props;

  const channel = useMemo(() => new BroadcastChannel('sefer-presenter'), []);
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

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
      videoState, appMode, scriptureState, audioState, quizState,
      stepIndex,
    } = opts;

    const activeVideoState = videoState !== undefined ? videoState : videoStateRef.current;
    const activeAppMode = appMode !== undefined ? appMode : appModeRef.current;
    const activeScriptureState = scriptureState !== undefined ? scriptureState : scriptureStateRef.current;
    const activeAudioState = audioState !== undefined ? audioState : audioStateRef.current;
    const activeQuizState = quizState !== undefined ? quizState : quizStateRef?.current ?? null;
    const activeStepIndex = stepIndex !== undefined ? stepIndex : currentStepIndexRef.current;

    // Update local refs immediately (avoid stale reads before React re-renders)
    if (videoState !== undefined) videoStateRef.current = activeVideoState;
    if (audioState !== undefined) audioStateRef.current = activeAudioState;
    if (quizState !== undefined && quizStateRef) quizStateRef.current = activeQuizState;

    persistState(presentation, slideIndex, bgLock, lockedBg);

    const payload = makeSyncMessage({
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
      quizState: activeQuizState,
      stepIndex: activeStepIndex,
    });

    channel.postMessage(payload);

    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(err => console.error('Error syncing state to network', err));
  }, [channel, isControlMode, persistState, videoStateRef, appModeRef, scriptureStateRef, audioStateRef, quizStateRef, currentStepIndexRef, clientIdRef]);

  const emitCommand = useCallback((payload: RemoteCommandPayload) => {
    const message = makeSyncMessage({
      type: 'REMOTE_COMMAND' as const,
      clientId: clientIdRef.current,
      payload,
    });
    channel.postMessage(message);
    fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    }).catch(err => console.error('Error syncing command to network', err));
  }, [channel, clientIdRef]);

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

    const payload = makeSyncMessage({
      type: 'AUDIO_TELEMETRY' as const,
      clientId: clientIdRef.current,
      origin: isControlMode ? 'control' as const : 'presenter' as const,
      audioState,
    });

    channel.postMessage(payload);

    fetch('/api/audio-telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(err => console.error('Error syncing audio telemetry to network', err));
  }, [audioStateRef, channel, clientIdRef, isControlMode]);

  const emitVideoTelemetry = useCallback((incomingVideoState: VideoState | null) => {
    videoStateRef.current = incomingVideoState;

    const payload = makeSyncMessage({
      type: 'VIDEO_TELEMETRY' as const,
      clientId: clientIdRef.current,
      origin: isControlMode ? 'control' as const : 'presenter' as const,
      videoState: incomingVideoState,
    });

    channel.postMessage(payload);

    fetch('/api/video-telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(err => console.error('Error syncing video telemetry to network', err));
  }, [videoStateRef, channel, clientIdRef, isControlMode]);

  const applyDisplayTelemetry = useCallback((displayState: DisplayTelemetryState) => {
    if (backgroundLockRef.current !== displayState.backgroundLock) {
      backgroundLockRef.current = displayState.backgroundLock;
      setBackgroundLock(displayState.backgroundLock);
      localStorage.setItem('sefer-presenter-bg-lock', String(displayState.backgroundLock));
    }

    if (lockedBackgroundValueRef.current !== displayState.lockedBackgroundValue) {
      lockedBackgroundValueRef.current = displayState.lockedBackgroundValue;
      setLockedBackgroundValue(displayState.lockedBackgroundValue);
      if (displayState.lockedBackgroundValue) {
        localStorage.setItem('sefer-presenter-locked-bg', displayState.lockedBackgroundValue);
      } else {
        localStorage.removeItem('sefer-presenter-locked-bg');
      }
    }

    if (userSelectedBackgroundRef.current !== displayState.userSelectedBackground) {
      userSelectedBackgroundRef.current = displayState.userSelectedBackground;
      setUserSelectedBackground(displayState.userSelectedBackground);
    }
  }, [
    backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef,
    setBackgroundLock, setLockedBackgroundValue, setUserSelectedBackground,
  ]);

  const emitDisplayTelemetry = useCallback((displayState: DisplayTelemetryState) => {
    backgroundLockRef.current = displayState.backgroundLock;
    lockedBackgroundValueRef.current = displayState.lockedBackgroundValue;
    userSelectedBackgroundRef.current = displayState.userSelectedBackground;
    localStorage.setItem('sefer-presenter-bg-lock', String(displayState.backgroundLock));
    if (displayState.lockedBackgroundValue) {
      localStorage.setItem('sefer-presenter-locked-bg', displayState.lockedBackgroundValue);
    } else {
      localStorage.removeItem('sefer-presenter-locked-bg');
    }

    const payload = makeSyncMessage({
      type: 'DISPLAY_TELEMETRY' as const,
      clientId: clientIdRef.current,
      origin: isControlMode ? 'control' as const : 'presenter' as const,
      ...displayState,
    });

    channel.postMessage(payload);

    fetch('/api/display-telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(err => console.error('Error syncing display telemetry to network', err));
  }, [
    backgroundLockRef, lockedBackgroundValueRef, userSelectedBackgroundRef,
    channel, clientIdRef, isControlMode,
  ]);

  // ── Apply incoming remote state (unified for both BroadcastChannel and SSE) ─
  const applyRemoteState = useCallback((data: Record<string, unknown>, persist = true, alreadyValidated = false) => {
    const validation = alreadyValidated ? null : validateRemoteStatePayload(data);
    if (validation && (!validation.ok || !validation.value)) {
      console.error('Ignoring invalid remote state payload', validation.errors);
      return;
    }

    const safeData = validation?.value ? { ...data, ...validation.value } : data;
    const normalizedPresentation = safeData.presentation
      ? normalizePresentation(safeData.presentation as Presentation)
      : null;

    if (!arePresentationsEqual(currentPresentationRef.current, normalizedPresentation)) {
      setCurrentPresentation(normalizedPresentation);
    }
    if (safeData.slideIndex !== undefined && currentSlideIndexRef.current !== safeData.slideIndex) {
      setCurrentSlideIndex(safeData.slideIndex as number);
    }
    if (safeData.backgroundLock !== undefined && backgroundLockRef.current !== safeData.backgroundLock) {
      setBackgroundLock(safeData.backgroundLock as boolean);
    }
    if (safeData.lockedBackgroundValue !== undefined && lockedBackgroundValueRef.current !== safeData.lockedBackgroundValue) {
      setLockedBackgroundValue(safeData.lockedBackgroundValue as string | null);
    }
    if (safeData.userSelectedBackground !== undefined && userSelectedBackgroundRef.current !== safeData.userSelectedBackground) {
      setUserSelectedBackground(safeData.userSelectedBackground as string | null);
    }
    if (safeData.videoState !== undefined && !areVideoStatesEqual(videoStateRef.current, safeData.videoState as VideoState | null)) {
      if (videoStateRef) videoStateRef.current = safeData.videoState as VideoState | null;
      setVideoState(safeData.videoState as VideoState | null);
    }
    if (safeData.appMode !== undefined && appModeRef.current !== safeData.appMode) {
      setAppMode(safeData.appMode as AppMode);
    }
    if (safeData.scriptureState !== undefined && !areScriptureStatesEqual(scriptureStateRef.current, safeData.scriptureState as ScriptureNavState | null)) {
      setScriptureState(safeData.scriptureState as ScriptureNavState | null);
    }
    if (safeData.audioState !== undefined) {
      applyAudioTelemetry(safeData.audioState as AudioState);
    }
    if (safeData.quizState !== undefined && quizStateRef && setQuizState) {
      const incomingQuizState = safeData.quizState as QuizSyncState | null;
      quizStateRef.current = incomingQuizState;
      setQuizState(incomingQuizState);
    }
    if (safeData.stepIndex !== undefined && currentStepIndexRef.current !== safeData.stepIndex) {
      setCurrentStepIndex(safeData.stepIndex as number);
    }

    if (persist && safeData.slideIndex !== undefined) {
      persistState(
        normalizedPresentation,
        safeData.slideIndex as number,
        (safeData.backgroundLock ?? backgroundLockRef.current) as boolean,
        (safeData.lockedBackgroundValue ?? lockedBackgroundValueRef.current) as string | null
      );
    }
  }, [
    currentPresentationRef, currentSlideIndexRef, currentStepIndexRef, backgroundLockRef,
    lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef,
    appModeRef, scriptureStateRef,
    setCurrentPresentation, setCurrentSlideIndex, setCurrentStepIndex, setBackgroundLock,
    setLockedBackgroundValue, setUserSelectedBackground,
    setAppMode, setScriptureState, applyAudioTelemetry, persistState,
    quizStateRef, setQuizState, setVideoState,
  ]);

  // Use refs for callbacks so event listeners don't re-bind constantly
  const applyRemoteStateRef = useRef(applyRemoteState);
  const onRemoteCommandRef = useRef(onRemoteCommand);
  const applyAudioTelemetryRef = useRef(applyAudioTelemetry);
  const applyDisplayTelemetryRef = useRef(applyDisplayTelemetry);
  const setVideoStateRef = useRef(setVideoState);
  const setAudioSyncMapsRef = useRef(setAudioSyncMaps);

  useEffect(() => {
    applyRemoteStateRef.current = applyRemoteState;
    onRemoteCommandRef.current = onRemoteCommand;
    applyAudioTelemetryRef.current = applyAudioTelemetry;
    applyDisplayTelemetryRef.current = applyDisplayTelemetry;
    setVideoStateRef.current = setVideoState;
    setAudioSyncMapsRef.current = setAudioSyncMaps;
  }, [applyRemoteState, onRemoteCommand, applyAudioTelemetry, applyDisplayTelemetry, setVideoState, setAudioSyncMaps]);

  // ── BroadcastChannel listener ─────────────────────────────────────
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const rawData = event.data;
      if (rawData?.clientId === clientIdRef.current) return;

      const validation = validateSyncMessage(rawData);
      if (!validation.ok || !validation.value) {
        console.error('Ignoring invalid sync message', validation.errors);
        return;
      }

      const data = validation.value;

      if (data.messageId) {
        if (processedMessageIdsRef.current.has(data.messageId)) return;
        processedMessageIdsRef.current.add(data.messageId);
        if (processedMessageIdsRef.current.size > 100) {
          const first = processedMessageIdsRef.current.values().next().value;
          if (first) processedMessageIdsRef.current.delete(first);
        }
      }

      if (data.type === 'AUDIO_SYNC_MAPS_UPDATE') {
        setAudioSyncMapsRef.current(data.maps as AudioSyncMap[]);
        return;
      }

      if (data.type === 'AUDIO_TELEMETRY') {
        applyAudioTelemetryRef.current(data.audioState as AudioState);
        return;
      }

      if (data.type === 'VIDEO_TELEMETRY') {
        if (videoStateRef) videoStateRef.current = data.videoState as VideoState | null;
        setVideoStateRef.current(data.videoState as VideoState | null);
        return;
      }

      if (data.type === 'DISPLAY_TELEMETRY') {
        applyDisplayTelemetryRef.current(data as DisplayTelemetryState);
        return;
      }

      if (data.type === 'REQUEST_STATE') {
        if (!isPresenterMode) return; // only presenter responds
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
          quizState: quizStateRef?.current ?? null,
        });
        return;
      }

      if (data.type === 'REMOTE_COMMAND') {
        if (!isPresenterMode) return; // only presenter processes commands
        onRemoteCommandRef.current?.(data.payload as RemoteCommandPayload);
        return;
      }

      if (data.type === 'SYNC_STATE') {
        applyRemoteStateRef.current(data as unknown as Record<string, unknown>, true, true);
      }
    };

    channel.addEventListener('message', handleMessage);

    // Clients ask for current state on open (except Presenter, who is the source of truth)
    if (!isPresenterMode) {
      channel.postMessage(makeSyncMessage({ type: 'REQUEST_STATE', clientId: clientIdRef.current }));
    }

    return () => channel.removeEventListener('message', handleMessage);
  }, [
    isPresenterMode, channel, clientIdRef, syncState
  ]);

  // ── SSE listener (web mode only) ──────────────────────────────────
  useEffect(() => {
    const eventSource = new EventSource('/api/state-events');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data || data.clientId === clientIdRef.current) return;

        if (data.type) {
          const validation = validateSyncMessage(data);
          if (!validation.ok || !validation.value) {
            console.error('Ignoring invalid network sync message', validation.errors);
            return;
          }

          const safeData = validation.value;

          if (safeData.messageId) {
            if (processedMessageIdsRef.current.has(safeData.messageId)) return;
            processedMessageIdsRef.current.add(safeData.messageId);
            if (processedMessageIdsRef.current.size > 100) {
              const first = processedMessageIdsRef.current.values().next().value;
              if (first) processedMessageIdsRef.current.delete(first);
            }
          }

          if (safeData.type === 'AUDIO_TELEMETRY') {
            applyAudioTelemetryRef.current(safeData.audioState as AudioState);
            return;
          }

          if (safeData.type === 'VIDEO_TELEMETRY') {
            if (videoStateRef) videoStateRef.current = safeData.videoState as VideoState | null;
            setVideoStateRef.current(safeData.videoState as VideoState | null);
            return;
          }

          if (safeData.type === 'DISPLAY_TELEMETRY') {
            applyDisplayTelemetryRef.current(safeData as DisplayTelemetryState);
            return;
          }

          if (safeData.type === 'REMOTE_COMMAND') {
            if (!isPresenterMode) return;
            onRemoteCommandRef.current?.(safeData.payload as RemoteCommandPayload);
            return;
          }

          applyRemoteStateRef.current(safeData as unknown as Record<string, unknown>, true, true);
          return;
        }

        applyRemoteStateRef.current(data);
      } catch (err) {
        console.error('Error parsing network state sync event', err);
      }
    };

    return () => eventSource.close();
  }, [
    clientIdRef, isPresenterMode
  ]);

  return { channel, syncState, emitCommand, persistState, emitAudioTelemetry, emitVideoTelemetry, emitDisplayTelemetry };
}
