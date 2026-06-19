import React from 'react';
import { Mic, MicOff, Hand, MessageSquare, LogOut, Volume2, Play } from 'lucide-react';
import type { LiveAudioConnectionState } from '../../../../types/liveAudio';

interface AudienceLiveAudioPanelProps {
  state: LiveAudioConnectionState;
  isActive: boolean;
  isMicrophoneActive: boolean;
  hasAudioStarted: boolean;
  isPendingWord: boolean;
  isWordGranted: boolean;
  onStartAudio: () => void;
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
  onStartAudio,
  onJoinActive,
  onLeaveActive,
  onRequestWord,
  onCancelRequest,
  onToggleMicrophone,
  onOpenMessage,
}) => {
  if (state !== 'connected' && state !== 'reconnecting') {
    return null; // Don't show if disconnected or unavailable
  }

  // Passive Mode
  if (!isActive) {
    return (
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
        {!hasAudioStarted && (
          <button
            onClick={onStartAudio}
            className="flex items-center gap-2 bg-blue-600/90 hover:bg-blue-500/90 text-white px-4 py-2 rounded-full shadow-lg backdrop-blur-sm transition-all"
          >
            <Play className="w-4 h-4" />
            <span className="text-sm font-medium">Escuchar en vivo</span>
          </button>
        )}
        <button
          onClick={onJoinActive}
          className="bg-gray-800/80 hover:bg-gray-700/80 border border-gray-600/50 text-gray-200 p-3 rounded-full shadow-lg backdrop-blur-md transition-all animate-pulse"
          title="Participar"
        >
          <Mic className="w-5 h-5" />
        </button>
      </div>
    );
  }

  // Active Mode (Glassmorphism bar)
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-2 bg-gray-900/60 backdrop-blur-lg border border-white/10 p-2 rounded-2xl shadow-2xl">
        
        {/* Toggle Mic / Request Word */}
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

        {/* Message to Control */}
        <button
          onClick={onOpenMessage}
          className="flex items-center justify-center p-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          title="Mensaje Privado a Control"
        >
          <MessageSquare className="w-6 h-6" />
        </button>

        {/* Volume (Placeholder for MVP, full implement later if needed) */}
        <div className="flex items-center justify-center p-3 rounded-xl bg-gray-700 text-gray-300">
          <Volume2 className="w-6 h-6" />
        </div>

        <div className="w-[1px] h-8 bg-white/20 mx-1"></div>

        {/* Leave Active Mode */}
        <button
          onClick={onLeaveActive}
          className="flex items-center justify-center p-3 rounded-xl bg-red-900/50 hover:bg-red-800/60 text-red-300 transition-colors"
          title="Salir del Modo Activo"
        >
          <LogOut className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
