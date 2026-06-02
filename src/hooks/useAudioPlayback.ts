import { useEffect, useRef } from 'react';
import type { AudioState, AudioSyncMap } from '../types/audio';
import type { AppMode, Presentation, ScriptureNavState, VideoState } from '../types/presentation';

interface UseAudioPlaybackProps {
  isControlMode: boolean;
  audioState: AudioState;
  audioStateRef: React.MutableRefObject<AudioState>;
  audioSyncMaps: AudioSyncMap[];
  currentSlideIndex: number;
  scriptureState: ScriptureNavState | null;
  // Refs
  audioRef: React.RefObject<HTMLAudioElement>;
  currentPresentationRef: React.MutableRefObject<Presentation | null>;
  currentSlideIndexRef: React.MutableRefObject<number>;
  backgroundLockRef: React.MutableRefObject<boolean>;
  lockedBackgroundValueRef: React.MutableRefObject<string | null>;
  userSelectedBackgroundRef: React.MutableRefObject<string | null>;
  videoStateRef: React.MutableRefObject<VideoState | null>;
  appModeRef: React.MutableRefObject<AppMode>;
  scriptureStateRef: React.MutableRefObject<ScriptureNavState | null>;
  // Callbacks
  setAutoplayBlocked: (blocked: boolean) => void;
  syncState: (opts: {
    presentation: Presentation | null;
    slideIndex: number;
    bgLock: boolean;
    lockedBg: string | null;
    userSelectedBg: string | null;
    videoState?: VideoState | null;
    appMode?: AppMode;
    scriptureState?: ScriptureNavState | null;
    audioState?: AudioState;
  }) => void;
  handleSelectPresentationAndSlide: (p: Presentation | null, idx: number, direction?: 'forward' | 'backward', targetVerse?: string) => void;
}

export function useAudioPlayback(props: UseAudioPlaybackProps) {
  const {
    isControlMode,
    audioState,
    audioStateRef,
    audioSyncMaps,
    currentSlideIndex,
    scriptureState,
    audioRef,
    currentPresentationRef,
    currentSlideIndexRef,
    backgroundLockRef,
    lockedBackgroundValueRef,
    userSelectedBackgroundRef,
    videoStateRef,
    appModeRef,
    scriptureStateRef,
    setAutoplayBlocked,
    syncState,
    handleSelectPresentationAndSlide,
  } = props;

  const lastSyncCueRef = useRef<number>(-1);

  // 1. Load/change source
  useEffect(() => {
    if (isControlMode) return;
    const audio = audioRef.current;
    if (!audio) return;

    if (audioState.audioSrc) {
      const encodedSrc = encodeURI(audioState.audioSrc);
      const targetUrl = window.location.origin + encodedSrc;

      const currentSrcDecoded = decodeURIComponent(audio.src);
      const targetUrlDecoded = decodeURIComponent(targetUrl);

      if (currentSrcDecoded !== targetUrlDecoded && audio.getAttribute('data-src') !== audioState.audioSrc) {
        audio.src = encodedSrc;
        audio.setAttribute('data-src', audioState.audioSrc);
        audio.load();
        lastSyncCueRef.current = -1;
      }
    } else {
      audio.pause();
      audio.removeAttribute('src');
      audio.setAttribute('data-src', '');
    }
  }, [audioState.audioSrc, isControlMode, audioRef]);

  // 2. Sync playback settings from controller (play/pause/volume/currentTime)
  useEffect(() => {
    if (isControlMode) return;
    const audio = audioRef.current;
    if (!audio || !audioState.audioSrc) return;
    if (audioState.lastUpdatedBy !== 'controller') return;

    if (audioState.changeType === 'volume') {
      if (audio.volume !== audioState.volume) {
        audio.volume = audioState.volume;
      }
    } else if (audioState.changeType === 'seek') {
      if (Math.abs(audio.currentTime - audioState.currentTime) > 0.8) {
        audio.currentTime = audioState.currentTime;
      }
    } else if (audioState.changeType === 'playState') {
      if (audioState.isPlaying && audio.paused) {
        audio.play()
          .then(() => setAutoplayBlocked(false))
          .catch((err) => {
            console.error('[App] Error playing audio:', err);
            if (err.name === 'NotAllowedError') {
              setAutoplayBlocked(true);
            }
          });
      } else if (!audioState.isPlaying && !audio.paused) {
        audio.pause();
      }
    } else if (audioState.changeType === 'track') {
      if (audio.volume !== audioState.volume) {
        audio.volume = audioState.volume;
      }
      if (Math.abs(audio.currentTime - audioState.currentTime) > 0.8) {
        audio.currentTime = audioState.currentTime;
      }
      if (audioState.isPlaying && audio.paused) {
        audio.play().then(() => setAutoplayBlocked(false)).catch(() => {});
      } else if (!audioState.isPlaying && !audio.paused) {
        audio.pause();
      }
    }
  }, [audioState, isControlMode, audioRef, setAutoplayBlocked]);

  // 3. Telemetry emission back to the controller
  useEffect(() => {
    if (isControlMode) return;
    const audio = audioRef.current;
    if (!audio) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let lastTimeEmitted = -1;

    const emitAudioTelemetry = (force = false) => {
      const current = audioStateRef.current;
      if (!current) return;

      // Throttle telemetry to reduce network traffic
      const isSignificantJump = Math.abs(audio.currentTime - lastTimeEmitted) > 2.0;
      const isPeriodicTick = !audio.paused && (Math.floor(audio.currentTime) % 5 === 0) && (Math.floor(audio.currentTime) !== Math.floor(lastTimeEmitted));

      if (!force && !isSignificantJump && !isPeriodicTick) {
        return;
      }

      lastTimeEmitted = audio.currentTime;

      syncState({
        presentation: currentPresentationRef.current,
        slideIndex: currentSlideIndexRef.current,
        bgLock: backgroundLockRef.current,
        lockedBg: lockedBackgroundValueRef.current,
        userSelectedBg: userSelectedBackgroundRef.current,
        videoState: videoStateRef.current,
        appMode: appModeRef.current,
        scriptureState: scriptureStateRef.current,
        audioState: {
          ...current,
          isPlaying: !audio.paused,
          currentTime: audio.currentTime,
          duration: Number.isFinite(audio.duration) ? audio.duration : 0,
          volume: audio.volume,
          lastUpdatedBy: 'projection',
          timestamp: Date.now(),
        },
      });
    };

    const handlePlay = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => emitAudioTelemetry(false), 500);
      emitAudioTelemetry(true);
    };

    const handlePause = () => {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      emitAudioTelemetry(true);
    };

    const handleEnded = () => {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      emitAudioTelemetry(true);
    };

    const handleLoadedMetadata = () => emitAudioTelemetry(true);

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      if (intervalId) clearInterval(intervalId);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [
    isControlMode, syncState, audioRef, audioStateRef,
    currentPresentationRef, currentSlideIndexRef, backgroundLockRef,
    lockedBackgroundValueRef, userSelectedBackgroundRef, videoStateRef,
    appModeRef, scriptureStateRef,
  ]);

  // 4. Drive slide/verse navigation from audio cues (Unilateral / Bilateral)
  useEffect(() => {
    if (isControlMode) return;
    const audio = audioRef.current;
    if (!audio || !audioState.audioSrc || !audioState.isPlaying) return;
    if (audioState.syncMode === 'none') return;

    const syncMap = audioSyncMaps.find((m) => m.id === audioState.activeSyncMapId);
    if (!syncMap || syncMap.cues.length === 0) return;

    const intervalId = setInterval(() => {
      const currentTime = audio.currentTime;
      let activeCueIdx = -1;
      for (let i = syncMap.cues.length - 1; i >= 0; i--) {
        if (currentTime >= syncMap.cues[i].timeSec) {
          activeCueIdx = i;
          break;
        }
      }

      if (activeCueIdx >= 0 && activeCueIdx !== lastSyncCueRef.current) {
        lastSyncCueRef.current = activeCueIdx;
        const cue = syncMap.cues[activeCueIdx];

        // Trigger slide/verse change on projection
        handleSelectPresentationAndSlide(
          currentPresentationRef.current,
          cue.slideIndex,
          'forward',
          cue.verse
        );
      }
    }, 200);

    return () => clearInterval(intervalId);
  }, [
    audioState.audioSrc,
    audioState.isPlaying,
    audioState.syncMode,
    audioState.activeSyncMapId,
    audioSyncMaps,
    isControlMode,
    handleSelectPresentationAndSlide,
    audioRef,
    currentPresentationRef,
  ]);

  // 5. Bilateral sync: Seek audio on manual slide/verse changes
  useEffect(() => {
    if (isControlMode) return;
    const audio = audioRef.current;
    if (!audio || !audioState.audioSrc) return;
    if (audioState.syncMode !== 'bilateral') return;

    const syncMap = audioSyncMaps.find((m) => m.id === audioState.activeSyncMapId);
    if (!syncMap || syncMap.cues.length === 0) return;

    // Find cue matching current slide and verse
    const currentVerse = scriptureState?.verse;

    // Find matching cue
    const matchingCue = syncMap.cues.find((cue) => {
      if (cue.slideIndex !== currentSlideIndex) return false;
      if (cue.verse || currentVerse) {
        return cue.verse === currentVerse;
      }
      return true;
    });

    if (matchingCue) {
      if (Math.abs(audio.currentTime - matchingCue.timeSec) > 1.0) {
        audio.currentTime = matchingCue.timeSec;

        // Emit updated time to controller
        syncState({
          presentation: currentPresentationRef.current,
          slideIndex: currentSlideIndexRef.current,
          bgLock: backgroundLockRef.current,
          lockedBg: lockedBackgroundValueRef.current,
          userSelectedBg: userSelectedBackgroundRef.current,
          videoState: videoStateRef.current,
          appMode: appModeRef.current,
          scriptureState: scriptureStateRef.current,
          audioState: {
            ...audioStateRef.current,
            currentTime: matchingCue.timeSec,
            lastUpdatedBy: 'projection',
            timestamp: Date.now(),
          },
        });
      }
    }
  }, [
    currentSlideIndex,
    scriptureState?.verse,
    audioState.syncMode,
    audioState.activeSyncMapId,
    audioState.audioSrc,
    audioSyncMaps,
    isControlMode,
    syncState,
    audioRef,
    audioStateRef,
    currentPresentationRef,
    currentSlideIndexRef,
    backgroundLockRef,
    lockedBackgroundValueRef,
    userSelectedBackgroundRef,
    videoStateRef,
    appModeRef,
    scriptureStateRef,
  ]);
}
