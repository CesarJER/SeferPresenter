import React, { useState, useEffect } from 'react';
import { Mic, MicOff, Hand, MessageSquare, LogOut, Volume2, VolumeX, Play, RotateCcw, CheckCircle2, Loader2 } from 'lucide-react';
import type { LiveAudioConnectionState } from '../../../../types/liveAudio';

interface AudienceLiveAudioPanelProps {
  state: LiveAudioConnectionState;
  isActive: boolean;
  isMicrophoneActive: boolean;
  hasAudioStarted: boolean;
  isPendingWord: boolean;
  isWordGranted: boolean;
  volume: number;
  onVolumeChange: (vol: number) => void;
  onStartAudio: () => void;
  onRetryAudio: () => void;
  onJoinActive: () => void;
  onLeaveActive: () => void;
  onRequestWord: () => void;
  onCancelRequest: () => void;
  onToggleMicrophone: () => void;
  onOpenMessage: () => void;
}

export const AudienceLiveAudioPanel: React.FC<AudienceLiveAudioPanelProps> = ({
  state,
  isActive,
  isMicrophoneActive,
  hasAudioStarted,
  isPendingWord,
  isWordGranted,
  volume,
  onVolumeChange,
  onStartAudio,
  onRetryAudio,
  onJoinActive,
  onLeaveActive,
  onRequestWord,
  onCancelRequest,
  onToggleMicrophone,
  onOpenMessage,
}) => {
  const [isVisible, setIsVisible] = useState(true);

  const hasAudioStartedRef = React.useRef(hasAudioStarted);
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

  // Randomly reappear passive button to act as a reminder if the user has hidden it
  useEffect(() => {
    if (isActive || isVisible) return;

    // Randomly reappear between 2 and 5 minutes (120000 ms - 300000 ms)
    const timeout = setTimeout(() => {
      setIsVisible(true);
    }, 120000 + Math.random() * 180000);
    return () => clearTimeout(timeout);
  }, [isActive, isVisible]);

  // Listen to outside clicks to toggle panel
  useEffect(() => {
    const handleGlobalClick = () => {
      setIsVisible(v => !v);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  if (state !== 'connected' && state !== 'reconnecting' && state !== 'reconnected' && state !== 'reconnectFailed') {
    return null;
  }

  if (!isVisible) return null;

  const handlePanelClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const wrapperClass = "flex items-end justify-center w-full h-full pointer-events-none z-[60]";
  const panelClass = "h-[7vh] min-h-14 max-h-20 flex items-center gap-1.5 sm:gap-2 pointer-events-auto";
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
      <div className={wrapperClass} onClick={handlePanelClick}>
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
            className="flex items-center gap-2 h-full bg-yellow-500 hover:bg-yellow-400 border border-yellow-300 text-black px-4 rounded-full shadow-[0_0_15px_rgba(234,179,8,0.6)] backdrop-blur-md transition-all animate-pulse"
            title="Participar"
          >
            <Hand className="w-5 h-5" />
            <span className="font-bold text-sm pr-1">Participa</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={wrapperClass} onClick={handlePanelClick}>
      <div className={`${panelClass} bg-gray-900/70 backdrop-blur-lg border border-white/10 px-2 rounded-2xl shadow-2xl`}>
        {reconnectStatus}
        
        {isWordGranted ? (
          <button
            onClick={onToggleMicrophone}
            className={`flex items-center justify-center p-3 rounded-xl transition-colors ${
              isMicrophoneActive 
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)]' 
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
            title={isMicrophoneActive ? "Desactivar Micrófono" : "Activar Micrófono"}
          >
            {isMicrophoneActive ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </button>
        ) : (
          <button
            onClick={isPendingWord ? onCancelRequest : onRequestWord}
            className={`flex items-center justify-center p-3 rounded-xl transition-colors ${
              isPendingWord 
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

        <div className="group relative flex items-center justify-center p-3 rounded-xl bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors cursor-pointer">
          {volume === 0 ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
          
          <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity bg-gray-800 p-3 rounded-xl shadow-xl border border-gray-700">
            <input 
              type="range" 
              min="0" max="1" step="0.05" 
              value={volume} 
              onChange={e => onVolumeChange(parseFloat(e.target.value))} 
              className="w-24 h-2 accent-blue-500 cursor-pointer"
              title="Volumen del audio en vivo"
            />
          </div>
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
