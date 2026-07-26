import React, { useId, useState } from 'react';
import { Users, UserCheck, Mic, MicOff, Volume2, VolumeX, ChevronUp, ChevronDown, ShieldAlert, Circle } from 'lucide-react';
import { LiveAudioQueue } from './LiveAudioQueue';
import { LiveAudioSpeakers } from './LiveAudioSpeakers';
import { LiveAudioListeners } from './LiveAudioListeners';
import type { LiveAudioParticipant } from './LiveAudioParticipantRow';

interface LiveAudioControlPanelProps {
  totalAudience: number;
  activeUsers: number;
  isModeratorMuted: boolean;
  onStartListening: () => void;
  onToggleModeratorMic: () => void;
  listenVolume: number;
  onListenVolumeChange: (volume: number) => void;
  microphoneVolume: number;
  recordingState: 'NOT_RECORDING' | 'RECORDING';
  recordingEpoch: number;
  recordingMutable: boolean;
  onRecordingStateChange: (state: 'NOT_RECORDING' | 'RECORDING') => void;
  onMicrophoneVolumeChange: (volume: number) => void;
  isModeratorMusicMode?: boolean;
  onModeratorMusicModeChange?: (mode: boolean) => void;
  participants: LiveAudioParticipant[];
  isControlAuthorized: boolean;
  onMuteAll: () => void;
  onGrantAllQueue: () => void;
  onGrant: (id: string) => void;
  onRevoke: (id: string) => void;
  onMute: (id: string) => void;
  onKick: (id: string) => void;
  onRescue: (id: string) => void;
  onSetAliasSharedVisibility?: (id: string, hidden: boolean) => void;
  onSetActiveListViewPermission?: (id: string, canView: boolean) => void;
  onRemove?: (id: string) => void;
  onMicrophoneConfigChange?: (id: string, config: { volume?: number; musicMode?: boolean }) => void;
  pendingWordCount: number;
}

export const LiveAudioControlPanel: React.FC<LiveAudioControlPanelProps> = ({
  totalAudience,
  activeUsers,
  isModeratorMuted,
  onStartListening,
  onToggleModeratorMic,
  listenVolume,
  onListenVolumeChange,
  microphoneVolume,
  recordingState,
  recordingEpoch,
  recordingMutable,
  onRecordingStateChange,
  onMicrophoneVolumeChange,
  isModeratorMusicMode,
  onModeratorMusicModeChange,
  participants,
  isControlAuthorized,
  onMuteAll,
  onGrantAllQueue,
  onGrant,
  onRevoke,
  onMute,
  onKick,
  onRescue,
  onSetAliasSharedVisibility,
  onSetActiveListViewPermission,
  onRemove,
  onMicrophoneConfigChange,
  pendingWordCount
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isListenVolOpen, setIsListenVolOpen] = useState(false);
  const [isMicVolOpen, setIsMicVolOpen] = useState(false);
  const drawerId = useId();
  const listenVolumeId = useId();
  const microphoneVolumeId = useId();

  return (
    <div className="fixed bottom-0 right-0 md:bottom-4 md:right-4 w-full md:w-[400px] flex flex-col z-40">
      
      {/* Drawer Panel (Expanded) */}
      {isExpanded && (
      <div
        id={drawerId}
        className="h-[60vh] max-h-[calc(100vh-80px)] md:h-[450px] bg-gray-900 border border-gray-700 md:rounded-t-lg shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          <div
            role="status"
            className={`rounded-lg border p-3 text-sm ${
              recordingState === 'RECORDING'
                ? 'border-red-500 bg-red-950/60 text-red-100'
                : 'border-slate-600 bg-slate-800 text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-bold">
                <Circle
                  aria-hidden="true"
                  className={`h-3 w-3 ${
                    recordingState === 'RECORDING'
                      ? 'fill-red-400 text-red-400'
                      : 'text-slate-300'
                  }`}
                />
                {recordingState === 'RECORDING'
                  ? `Se está grabando (época ${recordingEpoch})`
                  : 'No se está grabando'}
              </span>
              <button
                type="button"
                disabled={!recordingMutable}
                onClick={() => onRecordingStateChange(
                  recordingState === 'RECORDING' ? 'NOT_RECORDING' : 'RECORDING',
                )}
                className="rounded bg-slate-950 px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {recordingState === 'RECORDING' ? 'Finalizar' : 'Declarar grabación'}
              </button>
            </div>
            <p className="mt-1 text-xs">
              Estado declarativo: SeferPresenter no controla un grabador externo.
            </p>
          </div>
          
          {/* Global Actions */}
          <div className="flex gap-2 shrink-0">
            <button 
              onClick={onMuteAll}
              className="flex-1 bg-red-900/50 hover:bg-red-800 text-red-200 py-2 rounded text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <MicOff size={16} /> Silenciar a Todos
            </button>
            <button 
              onClick={onGrantAllQueue}
              className="flex-1 bg-green-900/50 hover:bg-green-800 text-green-200 py-2 rounded text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <UserCheck size={16} /> Permitir a Todos
            </button>
          </div>

          {!isControlAuthorized && (
            <div className="bg-orange-900/30 border border-orange-800 p-2 rounded text-xs text-orange-300 flex items-start gap-2 shrink-0">
              <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              <span>Modo seguro: Alias ocultos y acciones destructivas limitadas porque no eres un Control Autorizado.</span>
            </div>
          )}

          {/* Queue & Speakers */}
          <div className="flex-1">
            <LiveAudioQueue 
              participants={participants} 
              isControlAuthorized={isControlAuthorized}
              onGrant={onGrant}
              onKick={onKick}
              onRescue={onRescue}
              onSetAliasSharedVisibility={onSetAliasSharedVisibility}
              onSetActiveListViewPermission={onSetActiveListViewPermission}
              onRemove={onRemove}
              onMicrophoneConfigChange={onMicrophoneConfigChange}
            />
            <LiveAudioSpeakers 
              participants={participants}
              isControlAuthorized={isControlAuthorized}
              onRevoke={onRevoke}
              onMute={onMute}
              onKick={onKick}
              onRescue={onRescue}
              onSetAliasSharedVisibility={onSetAliasSharedVisibility}
              onSetActiveListViewPermission={onSetActiveListViewPermission}
              onRemove={onRemove}
              onMicrophoneConfigChange={onMicrophoneConfigChange}
            />
            <LiveAudioListeners 
              participants={participants}
              isControlAuthorized={isControlAuthorized}
              onGrant={onGrant}
              onKick={onKick}
              onRescue={onRescue}
              onSetAliasSharedVisibility={onSetAliasSharedVisibility}
              onSetActiveListViewPermission={onSetActiveListViewPermission}
              onRemove={onRemove}
              onMicrophoneConfigChange={onMicrophoneConfigChange}
            />
          </div>
        </div>
      </div>
      )}

      {/* Bottom Bar (Always visible) */}
      <div className="bg-gray-800 border-t border-l border-r border-gray-700 md:rounded-b-lg shadow-xl p-2 flex items-center justify-between">
        
        {/* Stats */}
        <div className="flex items-center gap-3 text-sm font-semibold text-gray-300 bg-gray-900 px-3 py-1.5 rounded-md border border-gray-700">
          <div className="flex items-center gap-1" title="Audiencia total (Activos + Pasivos + Staff)">
            <Users size={16} className="text-gray-400" /> {totalAudience}
          </div>
          <div className="w-px h-4 bg-gray-600"></div>
          {pendingWordCount > 0 ? (
             <div className="flex items-center gap-1 text-yellow-400 motion-safe:animate-pulse" title="Manos levantadas">
               <UserCheck size={16} /> {pendingWordCount}
             </div>
          ) : (
             <div className="flex items-center gap-1" title="Usuarios activos">
               <span className="w-2 h-2 rounded-full bg-green-500"></span> {activeUsers}
             </div>
          )}
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {pendingWordCount === 0
            ? 'No hay solicitudes de palabra'
            : `${pendingWordCount} ${pendingWordCount === 1 ? 'solicitud' : 'solicitudes'} de palabra`}
        </p>

        {/* Moderator Controls */}
        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <button
              onClick={() => {
                onStartListening();
                setIsListenVolOpen(!isListenVolOpen);
              }}
              aria-expanded={isListenVolOpen}
              aria-controls={listenVolumeId}
              aria-label={`Ajustar volumen de escucha. Valor actual ${listenVolume} por ciento`}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-lg ${
                listenVolume === 0 ? 'bg-gray-700 text-gray-400' : 'bg-gray-900 text-blue-200 border border-gray-700'
              }`}
              title="Regular volumen de escucha"
            >
              {listenVolume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>

            {isListenVolOpen && (
              <div
                id={listenVolumeId}
                role="group"
                aria-label="Volumen de escucha"
                className="absolute bottom-full mb-2 -left-6 bg-gray-800 border border-gray-700 p-3 rounded shadow-xl flex flex-col items-center gap-2 z-[100]"
                onClick={e => e.stopPropagation()}
              >
                <span className="text-xs font-semibold text-gray-300">{listenVolume}%</span>
                <div className="h-32 w-8 flex items-center justify-center">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={listenVolume}
                    onChange={(e) => onListenVolumeChange(parseInt(e.target.value, 10))}
                    aria-label="Volumen de escucha"
                    aria-valuetext={`${listenVolume} por ciento`}
                    className="w-32 h-1 -rotate-90 origin-center accent-blue-500 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onToggleModeratorMic}
            aria-pressed={!isModeratorMuted}
            aria-label={isModeratorMuted ? 'Abrir tu micrófono' : 'Silenciar tu micrófono'}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shadow-lg
              ${isModeratorMuted ? 'bg-gray-600 text-gray-300' : 'bg-blue-600 text-white'}`}
            title={isModeratorMuted ? "Abrir tu micrófono" : "Silenciar tu micrófono"}
          >
            {isModeratorMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>

          <div className="relative flex items-center">
            <button
              type="button"
              className="flex items-center bg-gray-900 border border-gray-700 rounded px-2 h-10 cursor-pointer"
              onClick={() => setIsMicVolOpen(!isMicVolOpen)}
              aria-expanded={isMicVolOpen}
              aria-controls={microphoneVolumeId}
              aria-label={`Ajustar volumen de salida del micrófono. Valor actual ${microphoneVolume} por ciento`}
            >
              <span className="text-white text-xs w-10 text-center font-semibold">{microphoneVolume}%</span>
            </button>

            {isMicVolOpen && (
              <div
                id={microphoneVolumeId}
                role="group"
                aria-label="Configuración del micrófono de Control"
                className="absolute bottom-full mb-2 -right-4 bg-gray-800 border border-gray-700 p-3 rounded shadow-xl flex flex-col items-center gap-2 z-[100]"
                onClick={e => e.stopPropagation()}
              >
                {onModeratorMusicModeChange && (
                  <label className="flex items-center gap-1 cursor-pointer bg-gray-900 px-2 py-1 rounded w-full justify-center" title="Modo Música">
                    <input 
                      type="checkbox" 
                      checked={isModeratorMusicMode} 
                      onChange={(e) => onModeratorMusicModeChange(e.target.checked)}
                      aria-label="Modo música del micrófono de Control"
                      className="accent-purple-500 w-3 h-3"
                    />
                    <span className="text-[10px]">🎵</span>
                  </label>
                )}
                <span className="text-xs font-semibold text-gray-300">{microphoneVolume}%</span>
                <div className="h-32 w-8 flex items-center justify-center">
                  <input
                    type="range"
                    min="0"
                    max="300"
                    value={microphoneVolume}
                    onChange={(e) => onMicrophoneVolumeChange(parseInt(e.target.value, 10))}
                    aria-label="Volumen de salida del micrófono de Control"
                    aria-valuetext={`${microphoneVolume} por ciento`}
                    className="w-32 h-1 -rotate-90 origin-center accent-blue-500 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Expand Toggle */}
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          aria-controls={drawerId}
          aria-label={isExpanded ? 'Cerrar panel de usuarios' : 'Abrir panel de usuarios'}
          className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded transition-colors flex items-center gap-1 text-sm font-semibold"
          title="Ver panel de usuarios"
        >
          <Users size={16} />
          {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>

    </div>
  );
};
