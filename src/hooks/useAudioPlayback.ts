import { useEffect, useRef } from 'react';
import type { AudioState, AudioSyncMap } from '../types/audio';
import type { Presentation, ScriptureNavState } from '../types/presentation';
import type { AutoduckState } from '../types/sync';
import { useSmoothVolume } from './useSmoothVolume';
import { useIosAudioBufferPlayer } from './useIosAudioBufferPlayer';

interface UseAudioPlaybackProps {
  isControlMode: boolean;
  allowControlPlayback?: boolean;
  playbackEnabled?: boolean;
  outputEnabled?: boolean;
  audioState: AudioState;
  audioStateRef: React.MutableRefObject<AudioState>;
  audioSyncMaps: AudioSyncMap[];
  currentSlideIndex: number;
  currentPresentationId: string | undefined;
  scriptureState: ScriptureNavState | null;
  autoduckState?: AutoduckState;
  // Refs
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentPresentationRef: React.MutableRefObject<Presentation | null>;
  // Callbacks
  setAutoplayBlocked: (blocked: boolean) => void;
  emitAudioTelemetry: (audioState: AudioState) => void;
  handleSelectPresentationAndSlide: (p: Presentation | null, idx: number, direction?: 'forward' | 'backward', targetVerse?: string) => void;
}

export function useAudioPlayback(props: UseAudioPlaybackProps) {
  const {
    isControlMode,
    allowControlPlayback = false,
    playbackEnabled = true,
    outputEnabled = true,
    audioState,
    audioStateRef,
    audioSyncMaps,
    currentSlideIndex,
    currentPresentationId,
    scriptureState,
    audioRef,
    currentPresentationRef,
    setAutoplayBlocked,
    emitAudioTelemetry,
    handleSelectPresentationAndSlide,
    autoduckState,
  } = props;

  const lastSyncCueRef = useRef<number>(-1);
  const isPerformingBilateralSeekRef = useRef<boolean>(false);
  const currentSlideIndexRef = useRef<number>(currentSlideIndex);
  const scriptureStateRef = useRef<ScriptureNavState | null>(scriptureState);
  const { isIos, player: iosPlayer } = useIosAudioBufferPlayer(
    audioRef,
    audioState.volume,
    autoduckState,
    !isControlMode || allowControlPlayback,
    outputEnabled,
  );

  useEffect(() => {
    if (props.outputEnabled !== undefined && audioRef.current) {
      audioRef.current.muted = !outputEnabled;
    }
  }, [audioRef, outputEnabled, props.outputEnabled]);

  useEffect(() => {
    currentSlideIndexRef.current = currentSlideIndex;
    scriptureStateRef.current = scriptureState;
  }, [currentSlideIndex, scriptureState]);

  useSmoothVolume(audioRef, audioState.volume, autoduckState, 300, !isIos);

  // 1. Load/change source
  useEffect(() => {
    if (isControlMode && !allowControlPlayback) return;
    if (isIos && !iosPlayer) return;
    const audio = iosPlayer ?? audioRef.current;
    if (!audio) return;

    if (!playbackEnabled) {
      audio.pause();
      audio.removeAttribute('src');
      audio.setAttribute('data-src', '');
      return;
    }

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
  }, [audioState.audioSrc, isControlMode, allowControlPlayback, playbackEnabled, audioRef, isIos, iosPlayer]);

  // 2. Sync playback settings from controller (play/pause/volume/currentTime)
  useEffect(() => {
    if (isControlMode && !allowControlPlayback) return;
    if (isIos && !iosPlayer) return;
    const audio = iosPlayer ?? audioRef.current;
    if (!audio || !audioState.audioSrc || !playbackEnabled) return;
    if (isControlMode && audioState.lastUpdatedBy !== 'controller') {
      if (Math.abs(audio.currentTime - audioState.currentTime) > 0.8) audio.currentTime = audioState.currentTime;
      if (audioState.isPlaying && audio.paused) audio.play().catch(() => {});
      else if (!audioState.isPlaying && !audio.paused) audio.pause();
      return;
    }
    if (audioState.lastUpdatedBy !== 'controller') return;

    if (audioState.changeType === 'volume') {
      // Volume is handled by useSmoothVolume, we only update state.
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
      // Volume is handled by useSmoothVolume
      if (Math.abs(audio.currentTime - audioState.currentTime) > 0.8) {
        audio.currentTime = audioState.currentTime;
      }
      if (audioState.isPlaying && audio.paused) {
        audio.play().then(() => setAutoplayBlocked(false)).catch(() => {});
      } else if (!audioState.isPlaying && !audio.paused) {
        audio.pause();
      }
    }
  }, [audioState, isControlMode, allowControlPlayback, playbackEnabled, audioRef, isIos, iosPlayer, setAutoplayBlocked]);

  // 3. Telemetry emission back to the controller
  useEffect(() => {
    if (isControlMode) return;
    if (isIos && !iosPlayer) return;
    const audio = iosPlayer ?? audioRef.current;
    if (!audio) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let lastTimeEmitted = -1;

    const emitCurrentAudioTelemetry = (force = false) => {
      const current = audioStateRef.current;
      if (!current) return;

      const hasTimeAdvanced = Math.abs(audio.currentTime - lastTimeEmitted) >= 0.25;

      if (!force && !hasTimeAdvanced) {
        return;
      }

      lastTimeEmitted = audio.currentTime;

      emitAudioTelemetry({
        ...current,
        isPlaying: !audio.paused,
        currentTime: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        volume: current.volume,
        lastUpdatedBy: 'projection',
        changeType: 'seek',
        timestamp: Date.now(),
      });
    };

    const handlePlay = () => {
      setAutoplayBlocked(false);
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => emitCurrentAudioTelemetry(false), 1000);
      emitCurrentAudioTelemetry(true);
    };

    const handlePause = () => {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      emitCurrentAudioTelemetry(true);
    };

    const handleEnded = () => {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      emitCurrentAudioTelemetry(true);
    };

    const handleLoadedMetadata = () => emitCurrentAudioTelemetry(true);

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
    isControlMode, emitAudioTelemetry, audioRef, audioStateRef, isIos, iosPlayer, setAutoplayBlocked,
  ]);

  // 4. Drive slide/verse navigation from audio cues (Unilateral / Bilateral)
  useEffect(() => {
    if (isControlMode) return;
    if (isIos && !iosPlayer) return;
    const audio = iosPlayer ?? audioRef.current;
    if (!audio || !audioState.audioSrc || !audioState.isPlaying) return;
    if (audioState.syncMode === 'none') return;

    const syncMap = audioSyncMaps.find((m) => m.id === audioState.activeSyncMapId);
    if (!syncMap || syncMap.cues.length === 0) return;
    if (currentPresentationRef.current?.id !== syncMap.presentationId) return;

    const intervalId = setInterval(() => {
      if (isPerformingBilateralSeekRef.current) return;

      const currentTime = audio.currentTime;
      let activeCueIdx = -1;
      for (let i = syncMap.cues.length - 1; i >= 0; i--) {
        if (currentTime >= syncMap.cues[i].timeSec) {
          activeCueIdx = i;
          break;
        }
      }

      if (activeCueIdx >= 0 && activeCueIdx !== lastSyncCueRef.current) {
        const cue = syncMap.cues[activeCueIdx];
        const isDifferentSlide = cue.slideIndex !== currentSlideIndexRef.current;
        const isDifferentVerse = cue.verse !== scriptureStateRef.current?.verse;

        if (isDifferentSlide || isDifferentVerse) {
          lastSyncCueRef.current = activeCueIdx;
          // Trigger slide/verse change on projection
          handleSelectPresentationAndSlide(
            currentPresentationRef.current,
            cue.slideIndex,
            'forward',
            cue.verse
          );
        } else {
          lastSyncCueRef.current = activeCueIdx;
        }
      }
    }, 200);

    return () => clearInterval(intervalId);
  }, [
    audioState.audioSrc,
    audioState.isPlaying,
    audioState.syncMode,
    audioState.activeSyncMapId,
    audioSyncMaps,
    currentPresentationId,
    isControlMode,
    handleSelectPresentationAndSlide,
    audioRef,
    isIos,
    iosPlayer,
    currentPresentationRef,
  ]);

  // 5. Bilateral sync: Seek audio on manual slide/verse changes
  useEffect(() => {
    if (isControlMode) return;
    if (isIos && !iosPlayer) return;
    const audio = iosPlayer ?? audioRef.current;
    if (!audio || !audioState.audioSrc) return;
    if (audioState.syncMode !== 'bilateral') return;

    const syncMap = audioSyncMaps.find((m) => m.id === audioState.activeSyncMapId);
    if (!syncMap || syncMap.cues.length === 0) return;
    if (currentPresentationRef.current?.id !== syncMap.presentationId) return;

    // Find cue matching current slide and verse
    const currentVerse = scriptureState?.verse;

    let cueIndex = -1;
    const matchingCue = syncMap.cues.find((cue, idx) => {
      if (cue.slideIndex !== currentSlideIndex) return false;
      
      // If both define a verse, they must match exactly
      if (cue.verse && currentVerse) {
        if (cue.verse !== currentVerse) return false;
      }
      
      // If cue requires a verse, but we don't have one (e.g. root of the slide), don't match this specific verse cue
      if (cue.verse && !currentVerse) return false;
      
      // If cue is generic (no verse) but we are on a specific verse, it's a valid fallback match!
      
      cueIndex = idx;
      return true;
    });

    if (matchingCue) {
      if (Math.abs(audio.currentTime - matchingCue.timeSec) > 1.0) {
        isPerformingBilateralSeekRef.current = true;
        audio.currentTime = matchingCue.timeSec;
        lastSyncCueRef.current = cueIndex; // Evitar que la Sección 4 detecte este salto como un evento nuevo

        emitAudioTelemetry({
          ...audioStateRef.current,
          currentTime: matchingCue.timeSec,
          duration: Number.isFinite(audio.duration) ? audio.duration : audioStateRef.current.duration,
          isPlaying: !audio.paused,
          volume: audioStateRef.current.volume,
          lastUpdatedBy: 'projection',
          changeType: 'seek',
          timestamp: Date.now(),
        });

        const handleSeeked = () => {
          isPerformingBilateralSeekRef.current = false;
          audio.removeEventListener('seeked', handleSeeked);
        };
        audio.addEventListener('seeked', handleSeeked);

        setTimeout(() => {
          if (isPerformingBilateralSeekRef.current) {
            isPerformingBilateralSeekRef.current = false;
            audio.removeEventListener('seeked', handleSeeked);
          }
        }, 500);
      }
    }
  }, [
    currentSlideIndex,
    scriptureState?.verse,
    audioState.syncMode,
    audioState.activeSyncMapId,
    audioState.audioSrc,
    audioSyncMaps,
    currentPresentationId,
    isControlMode,
    emitAudioTelemetry,
    audioRef,
    isIos,
    iosPlayer,
    audioStateRef,
    currentPresentationRef,
  ]);
}
