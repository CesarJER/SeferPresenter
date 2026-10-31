import { translate } from '../../../../i18n/runtime';
import { useUiTranslation } from '../../../../i18n/useUiTranslation';
import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Hand, MessageSquare, LogOut, Volume2, VolumeX, Play, RotateCcw, CheckCircle2, Loader2, Users } from 'lucide-react';
import type { LiveAudioConnectionState, LiveAudioExternalBroadcastState, LiveAudioMicrophoneDiagnostics, MicrophoneTrackState } from '../../../../types/liveAudio';
import { ActiveParticipantsPanel } from './ActiveParticipantsPanel';

interface AudienceLiveAudioPanelProps {
  state: LiveAudioConnectionState;
  mediaAvailable?: boolean;
  socialReady?: boolean;
  isActive: boolean;
  isMicrophoneActive: boolean;
  microphoneTrackState: MicrophoneTrackState;
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
  externalBroadcastState: LiveAudioExternalBroadcastState;
  variant?: 'overlay' | 'inline';
}

export const AudienceLiveAudioPanel: React.FC<AudienceLiveAudioPanelProps> = ({
  state,
  mediaAvailable = true,
  socialReady = true,
  isActive,
  isMicrophoneActive,
  microphoneTrackState,
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
  externalBroadcastState,
  variant = 'overlay',
}) => {
  useUiTranslation('liveAudio');
  const [isVisible, setIsVisibleState] = useState<boolean>(() => {
    const stored = sessionStorage.getItem('sefer_presenter_audio_panel_visible');
    return stored === null ? true : stored === 'true';
  });
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const panelRootRef = useRef<HTMLDivElement>(null);
  const isFirstMountRef = useRef(true);

  const setIsVisible = (val: boolean | ((prev: boolean) => boolean)) => {
    setIsVisibleState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      sessionStorage.setItem('sefer_presenter_audio_panel_visible', next ? "true" : "false");
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

  const handlePanelClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const wrapperClass = variant === 'inline'
    ? "flex items-center justify-center w-full pointer-events-none z-60"
    : "flex items-end justify-center w-full h-full pointer-events-none z-60";

  if (!isVisible) return <div className={wrapperClass}>
    <button type="button" onClick={() => setIsVisible(true)}
      className="pointer-events-auto rounded-full bg-gray-900/95 px-4 py-2 text-white shadow-lg focus-visible:outline-2 focus-visible:outline-blue-400"
      aria-label={translate('liveAudio:AudienceLiveAudioPanel.showParticipation', 'Mostrar controles de participación')}>
      <Hand className="h-5 w-5" />
    </button>
  </div>;

  const panelClass = "h-[7vh] min-h-14 max-h-20 flex items-center gap-1.5 sm:gap-2 pointer-events-auto [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-blue-400";
  const diagnostics = microphoneDiagnostics ? (
    <div className="hidden absolute bottom-full left-1/2 mb-2 w-[min(92vw,22rem)] -translate-x-1/2 rounded-md border border-white/10 bg-gray-950/95 px-3 py-2 text-[10px] leading-4 text-gray-300 shadow-xl">
      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        <span className="text-gray-500">{"secureContext"}</span>
        <span>{microphoneDiagnostics.secureContext ? "true" : "false"}</span>
        <span className="text-gray-500">{"mediaDevices"}</span>
        <span>{microphoneDiagnostics.mediaDevicesAvailable ? translate("liveAudio:AudienceLiveAudioPanel.available", "disponible") : translate("liveAudio:AudienceLiveAudioPanel.unavailable", "no disponible")}</span>
        <span className="text-gray-500">{"permission"}</span>
        <span>{microphoneDiagnostics.permissionState}</span>
        {microphoneDiagnostics.lastErrorName && (
          <>
            <span className="text-gray-500">{"error.name"}</span>
            <span>{microphoneDiagnostics.lastErrorName}</span>
          </>
        )}
        {microphoneDiagnostics.lastErrorMessage && (
          <>
            <span className="text-gray-500">{"error.message"}</span>
            <span>{microphoneDiagnostics.lastErrorMessage}</span>
          </>
        )}
      </div>
    </div>
  ) : null;
  const reconnectStatus = !mediaAvailable ? null : state === 'reconnecting'
    ? (
      <div className="flex items-center gap-2 h-full bg-orange-600/90 text-white px-3 rounded-full shadow-lg backdrop-blur-xs">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-xs font-semibold">{translate("liveAudio:AudienceLiveAudioPanel.reconnecting", "Reconectando")}</span>
      </div>
    )
    : state === 'reconnected'
      ? (
        <div className="flex items-center gap-2 h-full bg-emerald-600/90 text-white px-3 rounded-full shadow-lg backdrop-blur-xs">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-xs font-semibold">{translate("liveAudio:AudienceLiveAudioPanel.reconnected", "Reconectado")}</span>
        </div>
      )
      : state === 'reconnectFailed'
        ? (
          <button
            onClick={onRetryAudio}
            className="flex items-center gap-2 h-full bg-red-600/90 hover:bg-red-500/90 text-white px-3 rounded-full shadow-lg backdrop-blur-xs transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="text-xs font-semibold">{translate("liveAudio:AudienceLiveAudioPanel.retryAudio", "Reintentar audio")}</span>
          </button>
        )
        : null;
  const externalBroadcastNotice = externalBroadcastState === 'off'
    ? null
    : (
      <div
        role="status"
        className={`flex h-full items-center rounded-full px-3 text-xs font-bold text-white shadow-lg ${
          externalBroadcastState === 'recording' ? 'bg-red-600/95' : 'bg-orange-600/95'
        }`}
        title={translate("liveAudio:AudienceLiveAudioPanel.statusDeclaredByControlForTheExternalTool", "Estado declarado por Control para la herramienta externa")}
      >
        {externalBroadcastState === 'recording' ? translate("liveAudio:AudienceLiveAudioPanel.liveAndRecording", "● En directo y grabando") : translate("liveAudio:AudienceLiveAudioPanel.live", "● En directo")}
      </div>
    );

  if (!isActive) {
    return (
      <div ref={panelRootRef} className={wrapperClass} onClick={handlePanelClick} id="audience-bottom-panel">
        <div className={panelClass}>
          {externalBroadcastNotice}
          {reconnectStatus}
          {mediaAvailable && !hasAudioStarted && (
            <button
              onClick={onStartAudio}
              className="flex items-center gap-2 h-full bg-blue-600/90 hover:bg-blue-500/90 text-white px-4 rounded-full shadow-lg backdrop-blur-xs transition-all"
            >
              <Play className="w-5 h-5" />
              <span className="text-sm font-medium">{translate("liveAudio:AudienceLiveAudioPanel.listenLive", "Escuchar en vivo")}</span>
            </button>
          )}
          <button
            onClick={onJoinActive}
            disabled={isParticipationBlocked || !socialReady}
            className={`flex items-center gap-2 h-full border px-4 rounded-full backdrop-blur-md transition-all ${isParticipationBlocked
              ? 'bg-gray-700 border-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-yellow-500 hover:bg-yellow-400 border-yellow-300 text-black shadow-[0_0_15px_rgba(234,179,8,0.6)] animate-pulse'
              }`}
            title={isParticipationBlocked ? translate("liveAudio:AudienceLiveAudioPanel.participationBlockedByControl", "Participacion bloqueada por Control") : translate("liveAudio:AudienceLiveAudioPanel.participate", "Participar")}
          >
            <Hand className="w-5 h-5" />
            <span className="font-bold text-sm pe-1">{translate("liveAudio:AudienceLiveAudioPanel.joinIn", "Participa")}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={panelRootRef} className={wrapperClass} onClick={handlePanelClick}>
      <div className={`${panelClass} relative bg-gray-900/70 backdrop-blur-lg border border-white/10 px-2 rounded-2xl shadow-2xl`}>
        {externalBroadcastNotice}
        {diagnostics}
        {isParticipantsOpen && (
          <div className="absolute bottom-full mb-3 start-0 end-0" onClick={(event) => event.stopPropagation()}>
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
          <div className="relative">
            {microphoneTrackState === 'error' && (
              <div role="alert" className="absolute bottom-full left-1/2 mb-2 w-64 -translate-x-1/2 rounded-sm bg-red-950 px-3 py-2 text-xs text-red-100 shadow-lg">
                {translate("liveAudio:AudienceLiveAudioPanel.couldNotEnableTheMicrophonePressAgainToRetry", "No se pudo activar el micrófono. Pulsa de nuevo para reintentar.")}</div>
            )}
            <button
              onClick={onToggleMicrophone}
              disabled={!socialReady || microphoneTrackState === 'publishing'}
              className={`flex items-center justify-center p-3 rounded-xl transition-colors ${microphoneTrackState === 'publishing'
                ? 'bg-orange-600 text-white shadow-[0_0_15px_rgba(234,88,12,0.5)]'
                : microphoneTrackState === 'error'
                  ? 'bg-red-700 hover:bg-red-600 text-white'
                  : isMicrophoneActive
                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)]'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}
              title={microphoneTrackState === 'publishing'
                ? translate("liveAudio:AudienceLiveAudioPanel.enablingMicrophone", "Activando micrófono")
                : microphoneTrackState === 'error'
                  ? translate("liveAudio:AudienceLiveAudioPanel.microphoneErrorPressToRetry", "Error de micrófono; pulsar para reintentar")
                  : isMicrophoneActive ? translate("liveAudio:AudienceLiveAudioPanel.disableMicrophone", "Desactivar Micrófono") : translate("liveAudio:AudienceLiveAudioPanel.enableMicrophone", "Activar Micrófono")}
            >
              {microphoneTrackState === 'publishing'
                ? <Loader2 className="w-6 h-6 animate-spin" />
                : isMicrophoneActive ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
            </button>
          </div>
        ) : (
          <button
            onClick={isPendingWord ? onCancelRequest : onRequestWord}
            disabled={!socialReady || isParticipationBlocked}
            className={`flex items-center justify-center p-3 rounded-xl transition-colors ${isPendingWord
              ? 'bg-yellow-600/80 hover:bg-yellow-500/80 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              }`}
            title={isPendingWord ? translate("liveAudio:AudienceLiveAudioPanel.cancelRequest", "Cancelar Petición") : translate("liveAudio:AudienceLiveAudioPanel.requestToSpeak", "Pedir Palabra")}
          >
            <Hand className="w-6 h-6" />
          </button>
        )}

        <button
          onClick={onOpenMessage}
          disabled={!socialReady || isParticipationBlocked}
          className="flex items-center justify-center p-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          title={translate("liveAudio:AudienceLiveAudioPanel.privateMessageToControl", "Mensaje Privado a Control")}
        >
          <MessageSquare className="w-6 h-6" />
        </button>

        <button
          onClick={() => setIsParticipantsOpen((current) => !current)}
          aria-expanded={isParticipantsOpen}
          className="flex items-center justify-center p-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          title={translate("liveAudio:AudienceLiveAudioPanel.participants", "Participantes")}
        >
          <Users className="w-6 h-6" />
        </button>

        {mediaAvailable && <div className="relative">
          <button type="button" onClick={() => setIsVolumeOpen((current) => !current)}
            aria-expanded={isVolumeOpen}
            aria-label={translate("liveAudio:AudienceLiveAudioPanel.liveAudioVolume", "Volumen del audio en vivo")}
            className="flex items-center justify-center p-3 rounded-xl bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">
            {volume === 0 ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
          </button>

          {isVolumeOpen && (
            <div
              className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-gray-800 p-3 rounded-xl shadow-xl border border-gray-700 flex flex-col gap-3 min-w-32"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex flex-col gap-1 items-center">
                <span className="text-[10px] text-gray-400 font-bold uppercase">{translate("liveAudio:AudienceLiveAudioPanel.volume", "Volumen")} {Math.round(volume * 100)}%</span>
                <input
                  type="range"
                  min="0" max="1" step="0.05"
                  value={volume}
                  onChange={e => onVolumeChange(parseFloat(e.target.value))}
                  className="w-24 h-2 accent-blue-500 cursor-pointer"
                  title={translate("liveAudio:AudienceLiveAudioPanel.liveAudioVolume", "Volumen del audio en vivo")}
                />
              </div>

              {isWordGranted && microphoneVolume !== undefined && onMicrophoneVolumeChange && (
                <div className="flex flex-col gap-1 items-center pt-3 border-t border-gray-700">
                  <span className="text-[10px] text-gray-400 font-bold uppercase">{translate("liveAudio:AudienceLiveAudioPanel.mic", "Micro")} {Math.round(microphoneVolume)}%</span>
                  <input
                    type="range"
                    min="0" max="300" step="5"
                    value={microphoneVolume}
                    onChange={e => onMicrophoneVolumeChange(parseFloat(e.target.value))}
                    className="w-24 h-2 accent-green-500 cursor-pointer"
                    title={translate("liveAudio:AudienceLiveAudioPanel.microphoneVolume", "Volumen del micrófono (%)")}
                  />
                  {isMusicMode !== undefined && onMusicModeChange && (
                    <label className="flex items-center gap-2 mt-2 cursor-pointer hover:bg-gray-700 p-1 rounded-sm transition-colors w-full justify-center" title={translate("liveAudio:AudienceLiveAudioPanel.musicModeDisablesNoiseFiltering", "Modo Música (Desactiva filtro de ruido)")}>
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
        </div>}

        <div className="w-px h-8 bg-white/20 mx-1"></div>

        <button
          onClick={onLeaveActive}
          className="flex items-center justify-center p-3 rounded-xl bg-red-900/60 hover:bg-red-800/80 text-red-300 transition-colors"
          title={translate("liveAudio:AudienceLiveAudioPanel.leaveActiveMode", "Salir del Modo Activo")}
        >
          <LogOut className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
