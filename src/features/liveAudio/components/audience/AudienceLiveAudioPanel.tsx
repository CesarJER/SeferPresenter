import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Hand, MessageSquare, LogOut, Volume2, VolumeX, Play, RotateCcw, CheckCircle2, Loader2, Users } from 'lucide-react';
import type { LiveAudioConnectionState, LiveAudioMicrophoneDiagnostics } from '../../../../types/liveAudio';
import { ActiveParticipantsPanel } from './ActiveParticipantsPanel';

interface AudienceLiveAudioPanelProps {
  state: LiveAudioConnectionState;
  isActive: boolean;
  isMicrophoneActive: boolean;
  hasAudioStarted: boolean;
  isPendingWord: boolean;
  isWordGranted: boolean;
  isParticipationBlocked: boolean;
  volume: number;
  onVolumeChange: (vol: number) => void;
  microphoneVolume?: number;
  isMusicMode?: boolean;
  onMicrophoneVolumeChange?: (vol: number) => void;
  onMusicModeChange?: (mode: boolean) => void;
  onStartAudio: () => void;
  onRetryAudio: () => void;
  onJoinActive: () => void;
  onLeaveActive: () => void;
  onRequestWord: () => void;
  onCancelRequest: () => void;
  onToggleMicrophone: () => void;
  onOpenMessage: () => void;
  isAliasVisibleToOthers: boolean;
  onAliasVisibilityChange: (checked: boolean) => void;
  canViewActiveParticipants: boolean;
  visibleParticipants: string[];
  microphoneDiagnostics?: LiveAudioMicrophoneDiagnostics;
  recordingState: 'NOT_RECORDING' | 'RECORDING';
  recordingEpoch: number;
  recordingConfirmed: boolean;
  variant?: 'overlay' | 'inline';
}

export const AudienceLiveAudioPanel: React.FC<AudienceLiveAudioPanelProps> = ({
  state,
  isActive,
  isMicrophoneActive,
  hasAudioStarted,
  isPendingWord,
  isWordGranted,
  isParticipationBlocked,
  volume,
  onVolumeChange,
  microphoneVolume,
  isMusicMode,
  onMicrophoneVolumeChange,
  onMusicModeChange,
  onStartAudio,
  onRetryAudio,
  onJoinActive,
  onLeaveActive,
  onRequestWord,
  onCancelRequest,
  onToggleMicrophone,
  onOpenMessage,
  isAliasVisibleToOthers,
  onAliasVisibilityChange,
  canViewActiveParticipants,
  visibleParticipants,
  microphoneDiagnostics,
  recordingState,
  recordingEpoch,
  recordingConfirmed,
  variant = 'overlay',
}) => {
  const [isVisible, setIsVisibleState] = useState<boolean>(() => {
    const stored = sessionStorage.getItem('sefer_presenter_audio_panel_visible');
    return stored === null ? true : stored === 'true';
  });
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const hasAudioStartedRef = useRef(hasAudioStarted);
  const panelRootRef = useRef<HTMLDivElement>(null);
  const isFirstMountRef = useRef(true);

  const setIsVisible = (val: boolean | ((prev: boolean) => boolean)) => {
    setIsVisibleState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      sessionStorage.setItem('sefer_presenter_audio_panel_visible', next ? 'true' : 'false');
      if (!next) {
        const storedReappear = sessionStorage.getItem('sefer_presenter_audio_panel_reappear_at');
        if (!storedReappear) {
          const delay = 120000 + Math.random() * 180000;
          const reappearAt = Date.now() + delay;
          sessionStorage.setItem('sefer_presenter_audio_panel_reappear_at', reappearAt.toString());
        }
      } else {
        sessionStorage.removeItem('sefer_presenter_audio_panel_reappear_at');
      }
      return next;
    });
  };

  useEffect(() => {
    hasAudioStartedRef.current = hasAudioStarted;
  }, [hasAudioStarted]);

  // First interaction anywhere starts audio
  useEffect(() => {
    const handleFirstInteraction = () => {
      if (!hasAudioStartedRef.current) {
        onStartAudio();
      }
    };
    window.addEventListener('click', handleFirstInteraction, true);
    window.addEventListener('touchstart', handleFirstInteraction, true);
    return () => {
      window.removeEventListener('click', handleFirstInteraction, true);
      window.removeEventListener('touchstart', handleFirstInteraction, true);
    };
  }, [onStartAudio]);

  // Randomly reappear passive button to act as a reminder if the user has hidden it (slide-persistent)
  useEffect(() => {
    if (isActive || isVisible) return;

    let timeoutId: NodeJS.Timeout | undefined;

    const checkReappear = () => {
      const storedReappear = sessionStorage.getItem('sefer_presenter_audio_panel_reappear_at');
      if (storedReappear) {
        const reappearAt = parseInt(storedReappear, 10);
        if (Date.now() >= reappearAt) {
          setIsVisible(true);
        } else {
          const remaining = reappearAt - Date.now();
          timeoutId = setTimeout(() => {
            setIsVisible(true);
          }, remaining);
        }
      } else {
        const delay = 120000 + Math.random() * 180000;
        const reappearAt = Date.now() + delay;
        sessionStorage.setItem('sefer_presenter_audio_panel_reappear_at', reappearAt.toString());
        timeoutId = setTimeout(() => {
          setIsVisible(true);
        }, delay);
      }
    };

    checkReappear();
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isActive, isVisible]);

  // Reset visibility immediately upon state changes so user always sees updates (skipping initial slide mount)
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }
    setIsVisible(true);
  }, [isActive, state, isWordGranted, isPendingWord, isParticipationBlocked]);

  // Close only the volume popover and selectively hide panel on outside clicks (not on buttons/interactive elements)
  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      if (panelRootRef.current?.contains(target)) return;

      setIsVolumeOpen(false);

      // Check if we clicked on a button or other interactive element
      let current: Node | null = target;
      let clickedInteractive = false;
      while (current) {
        if (current instanceof Element) {
          const tagName = current.tagName.toUpperCase();
          if (
            tagName === 'BUTTON' ||
            tagName === 'HTMLBUTTONELEMENT' ||
            tagName === 'A' ||
            tagName === 'INPUT' ||
            tagName === 'SELECT' ||
            tagName === 'TEXTAREA' ||
            current.getAttribute('role') === 'button'
          ) {
            clickedInteractive = true;
            break;
          }
        }
        current = current.parentNode;
      }

      if (!clickedInteractive) {
        setIsVisible(prev => !prev);
      }
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  if (state !== 'connected' && state !== 'reconnecting' && state !== 'reconnected' && state !== 'reconnectFailed') {
    return null;
  }

  const handlePanelClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const wrapperClass = variant === 'inline'
    ? "flex items-center justify-center w-full pointer-events-none z-[60]"
    : "flex items-end justify-center w-full h-full pointer-events-none z-[60]";

  if (!isVisible) return null;

  /* Pill buttons toggle panel visibility - TODO: Replantear en el futuro
  if (!isVisible) {
    return (
      <div ref={panelRootRef} className={wrapperClass} onClick={handlePanelClick}>
        <button
          onClick={() => setIsVisible(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-900/85 hover:bg-gray-800 border border-white/10 shadow-lg pointer-events-auto backdrop-blur-md transition-all duration-200 text-xs font-semibold cursor-pointer select-none"
          title="Mostrar controles de participación"
        >
          {isActive ? (
            <>
              <Mic className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
              <span className="text-blue-300">Audio Activo</span>
            </>
          ) : (
            <>
              <Hand className="w-3.5 h-3.5 text-yellow-500" />
              <span className="text-yellow-400">Participa</span>
            </>
          )}
        </button>
      </div>
    );
  }
  */

  const panelClass = "h-[7vh] min-h-14 max-h-20 flex items-center gap-1.5 sm:gap-2 pointer-events-auto";
  const diagnostics = microphoneDiagnostics ? (
    <div className="hidden absolute bottom-full left-1/2 mb-2 w-[min(92vw,22rem)] -translate-x-1/2 rounded-md border border-white/10 bg-gray-950/95 px-3 py-2 text-[10px] leading-4 text-gray-300 shadow-xl">
      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        <span className="text-gray-500">secureContext</span>
        <span>{microphoneDiagnostics.secureContext ? 'true' : 'false'}</span>
        <span className="text-gray-500">mediaDevices</span>
        <span>{microphoneDiagnostics.mediaDevicesAvailable ? 'disponible' : 'no disponible'}</span>
        <span className="text-gray-500">permission</span>
        <span>{microphoneDiagnostics.permissionState}</span>
        {microphoneDiagnostics.lastErrorName && (
          <>
            <span className="text-gray-500">error.name</span>
            <span>{microphoneDiagnostics.lastErrorName}</span>
          </>
        )}
        {microphoneDiagnostics.lastErrorMessage && (
          <>
            <span className="text-gray-500">error.message</span>
            <span>{microphoneDiagnostics.lastErrorMessage}</span>
          </>
        )}
      </div>
    </div>
  ) : null;
  const reconnectStatus = state === 'reconnecting'
    ? (
      <div className="flex items-center gap-2 h-full bg-orange-600/90 text-white px-3 rounded-full shadow-lg backdrop-blur-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-xs font-semibold">Reconectando</span>
      </div>
    )
    : state === 'reconnected'
      ? (
        <div className="flex items-center gap-2 h-full bg-emerald-600/90 text-white px-3 rounded-full shadow-lg backdrop-blur-sm">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-xs font-semibold">Reconectado</span>
        </div>
      )
      : state === 'reconnectFailed'
        ? (
          <button
            onClick={onRetryAudio}
            className="flex items-center gap-2 h-full bg-red-600/90 hover:bg-red-500/90 text-white px-3 rounded-full shadow-lg backdrop-blur-sm transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="text-xs font-semibold">Reintentar audio</span>
          </button>
        )
        : null;

  if (!isActive) {
    return (
      <div ref={panelRootRef} className={wrapperClass} onClick={handlePanelClick} id="audience-bottom-panel">
        <div className={panelClass}>
          {reconnectStatus}
          {!hasAudioStarted && (
            <button
              onClick={onStartAudio}
              className="flex items-center gap-2 h-full bg-blue-600/90 hover:bg-blue-500/90 text-white px-4 rounded-full shadow-lg backdrop-blur-sm transition-all"
            >
              <Play className="w-5 h-5" />
              <span className="text-sm font-medium">Escuchar en vivo</span>
            </button>
          )}
          <button
            onClick={onJoinActive}
            disabled={isParticipationBlocked}
            className={`flex items-center gap-2 h-full border px-4 rounded-full backdrop-blur-md transition-all ${isParticipationBlocked
              ? 'bg-gray-700 border-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-yellow-500 hover:bg-yellow-400 border-yellow-300 text-black shadow-[0_0_15px_rgba(234,179,8,0.6)] animate-pulse'
              }`}
            title={isParticipationBlocked ? "Participacion bloqueada por Control" : "Participar"}
          >
            <Hand className="w-5 h-5" />
            <span className="font-bold text-sm pr-1">Participa</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={panelRootRef} className={wrapperClass} onClick={handlePanelClick}>
      <div className={`${panelClass} relative bg-gray-900/70 backdrop-blur-lg border border-white/10 px-2 rounded-2xl shadow-2xl`}>
        {diagnostics}
        {isParticipantsOpen && (
          <div className="absolute bottom-full mb-3 left-0 right-0" onClick={(event) => event.stopPropagation()}>
            <ActiveParticipantsPanel
              isAuthorized={canViewActiveParticipants}
              participants={visibleParticipants}
              isAliasVisible={isAliasVisibleToOthers}
              onAliasVisibilityChange={onAliasVisibilityChange}
              onClose={() => setIsParticipantsOpen(false)}
            />
          </div>
        )}
        {reconnectStatus}

        {isWordGranted ? (
          <div className="flex h-full flex-col items-center justify-center gap-0.5">
          <button
            onClick={onToggleMicrophone}
            className={`flex items-center justify-center p-3 rounded-xl transition-colors ${isMicrophoneActive
              ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)]'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              }`}
            title={isMicrophoneActive ? "Desactivar Micrófono" : "Activar Micrófono"}
          >
            {isMicrophoneActive ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </button>
          {recordingState === 'RECORDING' && (
            <span className="max-w-24 text-center text-[9px] font-bold leading-tight text-red-200">
              ⬤ Grabación activa · época {recordingEpoch}
              {!recordingConfirmed ? ' · confirma antes de hablar' : ''}
            </span>
          )}
          </div>
        ) : (
          <button
            onClick={isPendingWord ? onCancelRequest : onRequestWord}
            className={`flex items-center justify-center p-3 rounded-xl transition-colors ${isPendingWord
              ? 'bg-yellow-600/80 hover:bg-yellow-500/80 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              }`}
            title={isPendingWord ? "Cancelar Petición" : "Pedir Palabra"}
          >
            <Hand className="w-6 h-6" />
          </button>
        )}

        <button
          onClick={onOpenMessage}
          className="flex items-center justify-center p-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          title="Mensaje Privado a Control"
        >
          <MessageSquare className="w-6 h-6" />
        </button>

        <button
          onClick={() => setIsParticipantsOpen((current) => !current)}
          className="flex items-center justify-center p-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          title="Participantes"
        >
          <Users className="w-6 h-6" />
        </button>

        <div
          className="relative flex items-center justify-center p-3 rounded-xl bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors cursor-pointer"
          onClick={() => setIsVolumeOpen((current) => !current)}
        >
          {volume === 0 ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}

          {isVolumeOpen && (
            <div
              className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-gray-800 p-3 rounded-xl shadow-xl border border-gray-700 flex flex-col gap-3 min-w-[8rem]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex flex-col gap-1 items-center">
                <span className="text-[10px] text-gray-400 font-bold uppercase">Volumen {Math.round(volume * 100)}%</span>
                <input
                  type="range"
                  min="0" max="1" step="0.05"
                  value={volume}
                  onChange={e => onVolumeChange(parseFloat(e.target.value))}
                  className="w-24 h-2 accent-blue-500 cursor-pointer"
                  title="Volumen del audio en vivo"
                />
              </div>

              {isWordGranted && microphoneVolume !== undefined && onMicrophoneVolumeChange && (
                <div className="flex flex-col gap-1 items-center pt-3 border-t border-gray-700">
                  <span className="text-[10px] text-gray-400 font-bold uppercase">Micro {Math.round(microphoneVolume)}%</span>
                  <input
                    type="range"
                    min="0" max="300" step="5"
                    value={microphoneVolume}
                    onChange={e => onMicrophoneVolumeChange(parseFloat(e.target.value))}
                    className="w-24 h-2 accent-green-500 cursor-pointer"
                    title="Volumen del micrófono (%)"
                  />
                  {isMusicMode !== undefined && onMusicModeChange && (
                    <label className="flex items-center gap-2 mt-2 cursor-pointer hover:bg-gray-700 p-1 rounded transition-colors w-full justify-center" title="Modo Música (Desactiva filtro de ruido)">
                      <input
                        type="checkbox"
                        checked={isMusicMode}
                        onChange={(e) => onMusicModeChange(e.target.checked)}
                        className="accent-purple-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-sm">🎵</span>
                    </label>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="w-[1px] h-8 bg-white/20 mx-1"></div>

        <button
          onClick={onLeaveActive}
          className="flex items-center justify-center p-3 rounded-xl bg-red-900/60 hover:bg-red-800/80 text-red-300 transition-colors"
          title="Salir del Modo Activo"
        >
          <LogOut className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
