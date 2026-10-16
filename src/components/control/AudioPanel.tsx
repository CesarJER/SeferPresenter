import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
import React from 'react';
import { Play, Pause, Music, Volume2, Repeat2, ArrowUp, ArrowUpDown, Settings, Mic, MicOff } from 'lucide-react';
import type { Presentation } from '../../types/presentation';
import type { AudioState, AudioSyncMap, AudioTimelineAction } from '../../types/audio';

interface AudioPanelProps {
  audioState: AudioState;
  onAudioStateChange: (state: AudioState) => void;
  audioSyncMaps: AudioSyncMap[];
  availableAudioFiles: string[];
  presentations: Presentation[];
  currentPresentation: Presentation | null;
  onSelectPresentation: (p: Presentation) => void;
  handleOpenAudioEditor: () => void;
  dispatchAction?: (action: AudioTimelineAction) => void;
  estimatedPositionSec?: number;
  loop?: boolean;
  autoduckState?: import('../../types/sync').AutoduckState;
  onAutoduckStateChange?: (state: import('../../types/sync').AutoduckState) => void;
}

const formatTime = (secs: number | undefined) => {
  if (secs === undefined || isNaN(secs)) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const SCRUBBER_STALE_DRAG_RESYNC_MS = 1800;
const OPTIMISTIC_SEEK_HOLD_MS = 1800;
const OPTIMISTIC_SEEK_TICK_MS = 250;
const OPTIMISTIC_RECONNECT_TOLERANCE_SEC = 0.3;

interface OptimisticSeekState {
  positionSec: number;
  startedAtMs: number;
  isPlaying: boolean;
}

const clampAudioPosition = (positionSec: number, durationSec: number): number => {
  const safePositionSec = Number.isFinite(positionSec) ? Math.max(0, positionSec) : 0;
  return Number.isFinite(durationSec) && durationSec > 0
    ? Math.min(safePositionSec, durationSec)
    : safePositionSec;
};

const estimateOptimisticSeekPosition = (state: OptimisticSeekState, nowMs: number): number => {
  if (!state.isPlaying) return state.positionSec;
  return Math.max(0, state.positionSec + (nowMs - state.startedAtMs) / 1000);
};

export const AudioPanel: React.FC<AudioPanelProps> = ({
  audioState,
  onAudioStateChange,
  audioSyncMaps,
  availableAudioFiles,
  presentations,
  currentPresentation,
  onSelectPresentation,
  handleOpenAudioEditor,
  dispatchAction,
  estimatedPositionSec,
  loop = false,
  autoduckState,
  onAutoduckStateChange,
}) => {
  useUiTranslation('control');
  const [dragPosition, setDragPosition] = React.useState<number | null>(null);
  const [optimisticSeek, setOptimisticSeek] = React.useState<OptimisticSeekState | null>(null);
  const [optimisticNowMs, setOptimisticNowMs] = React.useState(() => Date.now());
  const dragPositionRef = React.useRef<number | null>(null);

  const setPendingDragPosition = React.useCallback((position: number | null) => {
    dragPositionRef.current = position;
    setDragPosition(position);
  }, []);

  const commitDragPosition = React.useCallback(() => {
    const pendingPosition = dragPositionRef.current;
    if (pendingPosition === null) return;

    const seekPositionSec = clampAudioPosition(pendingPosition, audioState.duration);
    if (dispatchAction && Number.isFinite(pendingPosition)) {
      dispatchAction({ type: 'SEEK', positionSec: seekPositionSec });
      const nowMs = Date.now();
      setOptimisticNowMs(nowMs);
      setOptimisticSeek({
        positionSec: seekPositionSec,
        startedAtMs: nowMs,
        isPlaying: audioState.isPlaying,
      });
    }
    setPendingDragPosition(null);
  }, [audioState.duration, audioState.isPlaying, dispatchAction, setPendingDragPosition]);

  React.useEffect(() => {
    setPendingDragPosition(null);
    setOptimisticSeek(null);
  }, [audioState.audioSrc, setPendingDragPosition]);

  React.useEffect(() => {
    if (!dispatchAction || dragPosition === null) return;

    const timeoutId = window.setTimeout(() => setPendingDragPosition(null), SCRUBBER_STALE_DRAG_RESYNC_MS);
    return () => window.clearTimeout(timeoutId);
  }, [dispatchAction, dragPosition, setPendingDragPosition]);

  React.useEffect(() => {
    if (!dispatchAction || dragPosition === null) return;

    window.addEventListener('mouseup', commitDragPosition);
    window.addEventListener('pointerup', commitDragPosition);
    window.addEventListener('pointercancel', commitDragPosition);
    window.addEventListener('touchend', commitDragPosition);
    window.addEventListener('blur', commitDragPosition);

    return () => {
      window.removeEventListener('mouseup', commitDragPosition);
      window.removeEventListener('pointerup', commitDragPosition);
      window.removeEventListener('pointercancel', commitDragPosition);
      window.removeEventListener('touchend', commitDragPosition);
      window.removeEventListener('blur-sm', commitDragPosition);
    };
  }, [commitDragPosition, dispatchAction, dragPosition]);

  React.useEffect(() => {
    if (!optimisticSeek) return;

    setOptimisticNowMs(Date.now());
    const tickId = window.setInterval(() => setOptimisticNowMs(Date.now()), OPTIMISTIC_SEEK_TICK_MS);
    const timeoutId = window.setTimeout(() => setOptimisticSeek(null), OPTIMISTIC_SEEK_HOLD_MS);

    return () => {
      window.clearInterval(tickId);
      window.clearTimeout(timeoutId);
    };
  }, [optimisticSeek]);

  const authoritativePosition = estimatedPositionSec !== undefined && estimatedPositionSec !== null
    ? estimatedPositionSec
    : audioState.currentTime;
  const optimisticPosition = optimisticSeek
    ? clampAudioPosition(estimateOptimisticSeekPosition(optimisticSeek, optimisticNowMs), audioState.duration)
    : null;

  React.useEffect(() => {
    if (!optimisticSeek || optimisticPosition === null) return;

    if (Math.abs(authoritativePosition - optimisticPosition) <= OPTIMISTIC_RECONNECT_TOLERANCE_SEC) {
      setOptimisticSeek(null);
    }
  }, [authoritativePosition, optimisticPosition, optimisticSeek]);

  const currentPosition = dragPosition !== null
    ? dragPosition
    : (optimisticPosition !== null ? optimisticPosition : authoritativePosition);
  const matchedSyncMap = audioState.audioSrc
    ? audioSyncMaps.find(m => m.audioSrc === audioState.audioSrc)
    : undefined;

  const handleSelectAudioTrack = (src: string) => {
    const newMatchedMap = src ? audioSyncMaps.find(m => m.audioSrc === src) : undefined;

    if (dispatchAction) {
      const presentationId = newMatchedMap?.presentationId || currentPresentation?.id || '';
      const audioSrc = src;
      const syncMapId = newMatchedMap?.id;
      dispatchAction({
        type: 'SET_TRACK',
        presentationId,
        audioSrc,
        syncMapId,
        syncMode: newMatchedMap?.defaultSyncMode ?? 'none',
        volume: newMatchedMap?.defaultVolume ?? audioState.volume,
      });
    } else {
      onAudioStateChange({
        ...audioState,
        audioSrc: src || null,
        currentTime: 0,
        duration: 0,
        isPlaying: false,
        activeSyncMapId: newMatchedMap ? newMatchedMap.id : null,
        syncMode: newMatchedMap ? (newMatchedMap.defaultSyncMode || 'none') : 'none',
        volume: newMatchedMap && newMatchedMap.defaultVolume !== undefined ? newMatchedMap.defaultVolume : audioState.volume,
        lastUpdatedBy: 'controller',
        changeType: 'track',
        timestamp: Date.now()
      });
    }
  };

  const togglePlayback = () => {
    if (dispatchAction) {
      dispatchAction({ type: audioState.isPlaying ? 'PAUSE' : 'PLAY' });
    } else {
      onAudioStateChange({
        ...audioState,
        isPlaying: !audioState.isPlaying,
        lastUpdatedBy: 'controller',
        changeType: 'playState',
        timestamp: Date.now(),
      });
    }
  };

  const toggleMute = () => {
    if (dispatchAction) {
      const nextVolume = audioState.volume > 0 ? 0 : 0.7;
      dispatchAction({ type: 'SET_VOLUME', volume: nextVolume });
    } else {
      onAudioStateChange({
        ...audioState,
        volume: audioState.volume > 0 ? 0 : 0.7,
        lastUpdatedBy: 'controller',
        changeType: 'volume',
        timestamp: Date.now(),
      });
    }
  };

  return (
    <div className="shrink-0 border-b border-gray-700 bg-gray-950/80 p-3.5 flex flex-col md:flex-row md:items-end justify-between gap-3 text-xs">
      {/* Left: Track Select & Playback control */}
      <div className="flex flex-wrap items-end gap-3 flex-1 md:flex-none">
        <div className="flex flex-col gap-1 w-full sm:w-56">
          <label className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">{translate("control:AudioPanel.audioTrack", "Pista de Audio")}</label>
          <select
            value={audioState.audioSrc || ''}
            onChange={(e) => handleSelectAudioTrack(e.target.value)}
            className="w-full rounded-sm border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-white outline-hidden focus:border-yellow-500 cursor-pointer"
          >
            <option value="">{translate("control:AudioPanel.noMusicSilence", "-- Sin Música / Silencio --")}</option>
            {availableAudioFiles.map((file) => {
              const hasSync = audioSyncMaps.some(m => m.audioSrc === file);
              return (
                <option key={file} value={file}>
                  {decodeURIComponent(file.split('/').pop() || '')}{hasSync ? ' 🎼' : ''}
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {/* Linked Presentation Button */}
          {matchedSyncMap && (
            <button
              type="button"
              onClick={() => {
                const linkedPres = presentations.find(p => p.id === matchedSyncMap.presentationId);
                if (linkedPres) {
                  onSelectPresentation(linkedPres);
                }
                if (dispatchAction) {
                  dispatchAction({
                    type: 'SET_SYNC_MODE',
                    mode: matchedSyncMap.defaultSyncMode || 'unilateral',
                  });
                  if (matchedSyncMap.defaultVolume !== undefined) {
                    dispatchAction({
                      type: 'SET_VOLUME',
                      volume: matchedSyncMap.defaultVolume,
                    });
                  }
                } else {
                  onAudioStateChange({
                    ...audioState,
                    activeSyncMapId: matchedSyncMap.id,
                    syncMode: matchedSyncMap.defaultSyncMode || 'unilateral',
                    volume: matchedSyncMap.defaultVolume !== undefined ? matchedSyncMap.defaultVolume : audioState.volume,
                    lastUpdatedBy: 'controller',
                    changeType: 'syncMode',
                    timestamp: Date.now(),
                  });
                }
              }}
              className={`audio-panel-btn border border-sky-600 bg-sky-700 hover:bg-sky-650 ${
                audioState.syncMode === 'none' || currentPresentation?.id !== matchedSyncMap.presentationId
                  ? 'animate-pulse hover:animate-none'
                  : ''
              }`}
              title={translate("control:AudioPanel.openLinkedPresentationAndEnableSynchronization", "Abrir presentación vinculada \"{{value1}}\" y activar sincronización", { value1: presentations.find(p => p.id === matchedSyncMap.presentationId)?.title || '' })}
            >
              <span>🎼</span>
            </button>
          )}

          {/* Play/Pause Button */}
          <button
            type="button"
            onClick={togglePlayback}
            disabled={!audioState.audioSrc}
            className="audio-panel-btn bg-yellow-600 hover:bg-yellow-500 disabled:hover:bg-yellow-600"
            title={audioState.isPlaying ? translate("control:AudioPanel.pause", "Pausar") : translate("control:AudioPanel.play", "Reproducir")}
          >
            {audioState.isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>

          {/* Mute/Volume Button */}
          <button
            type="button"
            onClick={toggleMute}
            disabled={!audioState.audioSrc}
            className={`audio-panel-btn ${audioState.volume === 0
                ? 'bg-red-650 text-white animate-pulse border border-red-500'
                : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
              }`}
            title={audioState.volume === 0 ? translate("control:AudioPanel.enableSound", "Activar Sonido") : translate("control:AudioPanel.mute", "Silenciar")}
          >
            {audioState.volume === 0 ? (
              <div className="relative">
                <Music size={14} className="text-red-200" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-red-300 font-extrabold text-sm select-none pointer-events-none" style={{ transform: 'rotate(45deg)' }}>/</span>
                </div>
              </div>
            ) : (
              <Volume2 size={14} />
            )}
          </button>

          {/* Autoduck Button */}
          {onAutoduckStateChange && (
            <button
              type="button"
              onClick={() => onAutoduckStateChange({
                enabled: !autoduckState?.enabled,
                factor: autoduckState?.factor ?? 0.2
              })}
              disabled={!audioState.audioSrc}
              className={`audio-panel-btn ${
                autoduckState?.enabled
                  ? 'bg-blue-600 hover:bg-blue-500 text-white border border-blue-500'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700'
              }`}
              title={autoduckState?.enabled ? translate("control:AudioPanel.autoduckEnabledReducesVolumeWhileSpeaking", "Autoduck Activado (Baja volumen al hablar)") : translate("control:AudioPanel.enableAutoduck", "Activar Autoduck")}
            >
              {autoduckState?.enabled ? <Mic size={14} /> : <MicOff size={14} />}
            </button>
          )}

          {/* Volume Slider */}
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={audioState.volume}
            aria-label={translate("control:AudioPanel.audioVolume", "Volumen de audio")}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (dispatchAction) {
                dispatchAction({ type: 'SET_VOLUME', volume: val });
              } else {
                onAudioStateChange({
                  ...audioState,
                  volume: val,
                  lastUpdatedBy: 'controller',
                  changeType: 'volume',
                  timestamp: Date.now(),
                });
              }
            }}
            disabled={!audioState.audioSrc}
            className="control-range-slim w-16"
          />

          <button
            type="button"
            onClick={() => {
              if (dispatchAction) {
                dispatchAction({ type: 'SET_LOOP', loop: !loop });
              }
            }}
            disabled={!audioState.audioSrc || !dispatchAction}
            className={`audio-panel-btn ${
              loop
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500'
                : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
            }`}
            title={loop ? translate("control:AudioPanel.loopEnabled", "Bucle activado") : translate("control:AudioPanel.enableLoop", "Activar bucle")}
            aria-label={loop ? translate("control:AudioPanel.disableAudioLoop", "Desactivar bucle de audio") : translate("control:AudioPanel.enableAudioLoop", "Activar bucle de audio")}
          >
            <Repeat2 size={14} />
          </button>
        </div>
      </div>

      {/* Center: Scrubber ProgressBar */}
      <div className="flex-1 flex items-center gap-2.5 w-full min-w-0">
        <span className="font-mono text-gray-400 text-[11px] shrink-0">{formatTime(currentPosition)}</span>
        <input
          type="range"
          min="0"
          max={audioState.duration || 100}
          step="0.1"
          value={currentPosition}
          aria-label={translate("control:AudioPanel.audioPosition", "Posicion de audio")}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (dispatchAction) {
              setPendingDragPosition(val);
            } else {
              onAudioStateChange({
                ...audioState,
                currentTime: val,
                lastUpdatedBy: 'controller',
                changeType: 'seek',
                timestamp: Date.now(),
              });
            }
          }}
          onMouseUp={commitDragPosition}
          onTouchEnd={commitDragPosition}
          onPointerUp={commitDragPosition}
          onPointerCancel={commitDragPosition}
          onKeyUp={commitDragPosition}
          onBlur={commitDragPosition}
          disabled={!audioState.audioSrc}
          className="control-range-slim min-w-0 flex-1"
        />
        <span className="font-mono text-gray-400 text-[11px] shrink-0">{formatTime(audioState.duration)}</span>
      </div>

      {/* Right: Sync Mode & Editor Window Trigger */}
      <div className="flex items-end gap-3 w-full md:w-auto">
        <div className="flex flex-col gap-1 w-full sm:w-52">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">{translate("control:AudioPanel.synchronization", "Sincronización")}</label>
            <div className="relative group/tooltip">
              <button
                type="button"
                className="text-gray-400 hover:text-white cursor-pointer select-none text-[10px] bg-gray-800 hover:bg-gray-700 h-4 w-4 rounded-full flex items-center justify-center font-bold"
              >
                ?
              </button>
              <div className="absolute end-0 bottom-full mb-2 w-64 bg-gray-900 border border-gray-700 text-gray-200 text-xs p-3 rounded-lg shadow-xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 z-50 pointer-events-none">
                <p className="font-bold text-yellow-500 mb-1">{translate("control:AudioPanel.audioSynchronization", "Sincronización de Audio:")}</p>
                <p className="mb-2 text-gray-300">{translate("control:AudioPanel.aTrackCanOnlyBeSynchronizedWithOnePresentation", "Una melodía solo puede estar sincronizada a una única presentación, pero una presentación puede tener asociadas varias melodías.")}</p>
                <hr className="border-gray-800 my-1.5" />
                <div className="flex flex-col gap-1 text-[11px] text-gray-300">
                  <div><strong className="text-white">{translate("control:AudioPanel.background", "Fondo (🎼):")}</strong>  {translate("control:AudioPanel.normalBackgroundMusicWithoutSynchronization", "Música de fondo normal sin sincronizar.")}</div>
                  <div><strong className="text-sky-400">{translate("control:AudioPanel.oneWay", "Unilateral (🎼 ⬆️):")}</strong>  {translate("control:AudioPanel.musicAutomaticallyAdvancesSlides", "La música avanza automáticamente las diapositivas.")}</div>
                  <div><strong className="text-emerald-400">{translate("control:AudioPanel.twoWay", "Bilateral (🎼 ↕️):")}</strong>  {translate("control:AudioPanel.bidirectionalSlideAndAudioSynchronization", "Sincronización bidireccional de diapositivas y audio.")}</div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center bg-gray-900 border border-gray-700 rounded-sm p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => {
                if (dispatchAction) {
                  dispatchAction({ type: 'SET_SYNC_MODE', mode: 'none' });
                } else {
                  onAudioStateChange({
                    ...audioState,
                    syncMode: 'none',
                    lastUpdatedBy: 'controller',
                    changeType: 'syncMode',
                    timestamp: Date.now(),
                  });
                }
              }}
              disabled={!audioState.audioSrc}
              className={`audio-sync-btn ${
                audioState.syncMode === 'none'
                  ? 'bg-gray-700 text-white font-bold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
              title={translate("control:AudioPanel.backgroundMusicNoSynchronization", "Música de Fondo (Sin sincronización)")}
            >
              <Music size={11} />
              <span>{translate("control:AudioPanel.background_8c069b", "Fondo")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (dispatchAction) {
                  dispatchAction({ type: 'SET_SYNC_MODE', mode: 'unilateral' });
                } else {
                  onAudioStateChange({
                    ...audioState,
                    syncMode: 'unilateral',
                    lastUpdatedBy: 'controller',
                    changeType: 'syncMode',
                    timestamp: Date.now(),
                  });
                }
              }}
              disabled={!audioState.audioSrc}
              className={`audio-sync-btn ${
                audioState.syncMode === 'unilateral'
                  ? 'bg-sky-600 text-white font-bold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
              title={translate("control:AudioPanel.oneWaySynchronizationMusicChangesSlides", "Sincronización Unilateral (Música cambia diapositivas)")}
            >
              <Music size={11} />
              <ArrowUp size={10} className="stroke-3" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (dispatchAction) {
                  dispatchAction({ type: 'SET_SYNC_MODE', mode: 'bilateral' });
                } else {
                  onAudioStateChange({
                    ...audioState,
                    syncMode: 'bilateral',
                    lastUpdatedBy: 'controller',
                    changeType: 'syncMode',
                    timestamp: Date.now(),
                  });
                }
              }}
              disabled={!audioState.audioSrc}
              className={`audio-sync-btn ${
                audioState.syncMode === 'bilateral'
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
              title={translate("control:AudioPanel.twoWaySynchronization", "Sincronización Bilateral (Sincro Bidireccional)")}
            >
              <Music size={11} />
              <ArrowUpDown size={10} className="stroke-3" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleOpenAudioEditor}
          className="flex items-center gap-1 py-1.5 px-3 rounded-sm bg-gray-900 border border-gray-700 hover:bg-gray-800 text-yellow-500 font-bold transition-all cursor-pointer shadow-xs shrink-0 whitespace-nowrap h-[28px]"
          title={translate("control:AudioPanel.openSynchronizationEditorInAnExternalWindow", "Abrir Editor de Sincronización en ventana externa (🎼)")}
        >
          <Settings size={13} />
          <span>🎼</span>
        </button>
      </div>
    </div>
  );
};
