import { translate } from '../../../../i18n/runtime';
import { useUiTranslation } from '../../../../i18n/useUiTranslation';
import React, { useState } from 'react';
import { Users, UserCheck, Mic, MicOff, Volume2, VolumeX, ChevronUp, ChevronDown, ShieldAlert, Loader2 } from 'lucide-react';
import { LiveAudioQueue } from './LiveAudioQueue';
import { LiveAudioSpeakers } from './LiveAudioSpeakers';
import { LiveAudioListeners } from './LiveAudioListeners';
import { LiveAudioParticipantRow, type LiveAudioParticipant } from './LiveAudioParticipantRow';
import type { LiveAudioExternalBroadcastState, MicrophoneTrackState } from '../../../../types/liveAudio';

interface LiveAudioControlPanelProps {
  controllers?: LiveAudioParticipant[];
  selectedVoiceParticipantId?: string;
  voiceSelectableIds?: string[];
  voiceSourceLabel?: string;
  voiceSourceAvailability?: 'none' | 'waiting' | 'available' | 'unavailable';
  onSelectVoice?: (id: string) => void;
  ownVoiceSelected?: boolean;
  onControllerMicrophoneConfigChange?: (id: string, config: { volume?: number; musicMode?: boolean }) => void;
  totalAudience: number;
  activeUsers: number;
  isModeratorMuted: boolean;
  onStartListening: () => void;
  onToggleModeratorMic: () => void;
  listenVolume: number;
  onListenVolumeChange: (volume: number) => void;
  microphoneVolume: number;
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
  onBlock?: (id: string) => void;
  onSetAliasSharedVisibility?: (id: string, hidden: boolean) => void;
  onSetActiveListViewPermission?: (id: string, canView: boolean) => void;
  onRemove?: (id: string) => void;
  onMicrophoneConfigChange?: (id: string, config: { volume?: number; musicMode?: boolean }) => void;
  pendingWordCount: number;
  externalBroadcastState: LiveAudioExternalBroadcastState;
  onExternalBroadcastStateChange: (state: LiveAudioExternalBroadcastState) => void;
  moderationError?: string | null;
  moderatorMicrophoneTrackState?: MicrophoneTrackState;
}

export const LiveAudioControlPanel: React.FC<LiveAudioControlPanelProps> = ({
  controllers = [],
  selectedVoiceParticipantId,
  voiceSelectableIds,
  voiceSourceLabel,
  voiceSourceAvailability = 'none',
  onSelectVoice,
  ownVoiceSelected,
  onControllerMicrophoneConfigChange,
  totalAudience,
  activeUsers,
  isModeratorMuted,
  onStartListening,
  onToggleModeratorMic,
  listenVolume,
  onListenVolumeChange,
  microphoneVolume,
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
  onBlock,
  onSetAliasSharedVisibility,
  onSetActiveListViewPermission,
  onRemove,
  onMicrophoneConfigChange,
  pendingWordCount,
  externalBroadcastState,
  onExternalBroadcastStateChange,
  moderationError,
  moderatorMicrophoneTrackState,
}) => {
  useUiTranslation('liveAudio');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isListenVolOpen, setIsListenVolOpen] = useState(false);
  const [isMicVolOpen, setIsMicVolOpen] = useState(false);

  const externalPermission = (import.meta.env.VITE_SEFER_PUBLICABLE_PERMISSION || 'RECORDING').toUpperCase();
  const voiceSourceStatus = voiceSourceAvailability === 'none' ? translate("liveAudio:LiveAudioControlPanel.noVoiceSource", "Sin origen de voz")
    : `${voiceSourceLabel || translate("liveAudio:LiveAudioControlPanel.selectedParticipant", "Participante seleccionado")} · ${
      voiceSourceAvailability === 'available' ? translate("liveAudio:LiveAudioControlPanel.available", "Disponible")
        : voiceSourceAvailability === 'waiting' ? translate("liveAudio:LiveAudioControlPanel.waitingForMicrophone", "Esperando micrófono")
          : translate("liveAudio:LiveAudioControlPanel.microphoneUnavailable", "Micrófono no disponible")
    }`;

  return (
    <div className="fixed bottom-0 end-0 md:bottom-4 md:end-4 w-full md:w-[400px] flex flex-col z-40">
      
      {/* Drawer Panel (Expanded) */}
      <div 
        className={`bg-gray-900 border border-gray-700 md:rounded-t-lg shadow-2xl transition-all duration-300 overflow-hidden flex flex-col
          ${isExpanded ? 'h-[60vh] max-h-[calc(100vh-80px)] md:h-[450px] opacity-100' : 'h-0 max-h-0 opacity-0 border-none'}`}
      >
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {moderationError && (
            <div role="alert" className="rounded-sm border border-red-700 bg-red-950/70 px-3 py-2 text-sm text-red-100">
              {translate("liveAudio:LiveAudioControlPanel.couldNotApplyModeration", "No se pudo aplicar la moderación:")} {moderationError}
            </div>
          )}
          {externalPermission !== 'NONE' && (
            <label className="flex flex-col gap-1 rounded-sm border border-gray-700 bg-gray-950/60 p-2 text-xs text-gray-300">
              <span className="font-semibold">{translate("liveAudio:LiveAudioControlPanel.declaredExternalStatus", "Estado externo declarado")}</span>
              <select
                value={externalBroadcastState}
                disabled={!isControlAuthorized}
                onChange={(event) => onExternalBroadcastStateChange(event.target.value as LiveAudioExternalBroadcastState)}
                className="rounded-sm border border-gray-600 bg-gray-900 px-2 py-1.5 text-white disabled:opacity-50"
                aria-label={translate("liveAudio:LiveAudioControlPanel.externalBroadcastAndRecordingStatus", "Estado externo de retransmisión y grabación")}
              >
                <option value="off">{translate("liveAudio:LiveAudioControlPanel.notBroadcasting", "Sin retransmisión")}</option>
                <option value="live">{translate("liveAudio:LiveAudioControlPanel.live", "En directo")}</option>
                {externalPermission === 'RECORDING' && (
                  <option value="recording">{translate("liveAudio:LiveAudioControlPanel.liveAndRecording", "En directo y grabando")}</option>
                )}
              </select>
              <span className="text-[10px] text-gray-500">
                {translate("liveAudio:LiveAudioControlPanel.mustBeChangedBeforeStartingOrStoppingTheExternal", "Debe cambiarse antes de iniciar o detener la herramienta externa.")}</span>
            </label>
          )}
          
          {/* Global Actions */}
          <div className="flex gap-2 shrink-0">
            <button 
              onClick={onMuteAll}
              className="flex-1 bg-red-900/50 hover:bg-red-800 text-red-200 py-2 rounded-sm text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <MicOff size={16} />  {translate("liveAudio:LiveAudioControlPanel.muteAll", "Silenciar a Todos")}</button>
            <button 
              onClick={onGrantAllQueue}
              className="flex-1 bg-green-900/50 hover:bg-green-800 text-green-200 py-2 rounded-sm text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <UserCheck size={16} />  {translate("liveAudio:LiveAudioControlPanel.allowAll", "Permitir a Todos")}</button>
          </div>

          {!isControlAuthorized && (
            <div className="bg-orange-900/30 border border-orange-800 p-2 rounded-sm text-xs text-orange-300 flex items-start gap-2 shrink-0">
              <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              <span>{translate("liveAudio:LiveAudioControlPanel.safeModeAliasesAreHiddenAndDestructiveActionsAre", "Modo seguro: Alias ocultos y acciones destructivas limitadas porque no eres un Control Autorizado.")}</span>
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
              onBlock={onBlock}
              onSetAliasSharedVisibility={onSetAliasSharedVisibility}
              onSetActiveListViewPermission={onSetActiveListViewPermission}
              onRemove={onRemove}
              onMicrophoneConfigChange={onMicrophoneConfigChange}
            />
            {controllers.length > 0 && <details open className="mb-3 rounded-sm border border-gray-800">
              <summary className="cursor-pointer px-2 py-1 text-xs text-gray-400">{translate("liveAudio:LiveAudioControlPanel.controls", "Controles (")}{controllers.length})</summary>
              {controllers.map(p => <LiveAudioParticipantRow key={p.participantId} participant={p}
                isControlAuthorized={isControlAuthorized} onMicrophoneConfigChange={onControllerMicrophoneConfigChange}
                voiceSelected={selectedVoiceParticipantId === p.participantId}
                voiceSelectable={voiceSelectableIds?.includes(p.participantId)} onSelectVoice={onSelectVoice} />)}
            </details>}
            <LiveAudioSpeakers
              selectedVoiceParticipantId={selectedVoiceParticipantId}
              voiceSelectableIds={voiceSelectableIds}
              onSelectVoice={onSelectVoice}
              participants={participants} 
              isControlAuthorized={isControlAuthorized}
              onRevoke={onRevoke}
              onMute={onMute}
              onKick={onKick}
              onRescue={onRescue}
              onBlock={onBlock}
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
              onBlock={onBlock}
              onSetAliasSharedVisibility={onSetAliasSharedVisibility}
              onSetActiveListViewPermission={onSetActiveListViewPermission}
              onRemove={onRemove}
              onMicrophoneConfigChange={onMicrophoneConfigChange}
            />
          </div>
        </div>
      </div>

      {/* Bottom Bar (Always visible) */}
      <div className="bg-gray-800 border-t border-l border-r border-gray-700 md:rounded-b-lg shadow-xl p-2 flex items-center justify-between">
        <div className="min-w-0 max-w-[45%] truncate text-xs text-gray-300" title={translate("liveAudio:LiveAudioControlPanel.voiceSource", "Origen de voz: {{value1}}", { value1: voiceSourceStatus })}>
          <span className="font-semibold">{translate("liveAudio:LiveAudioControlPanel.voice", "Voz:")} </span>{voiceSourceStatus}
        </div>
        
        {/* Stats */}
        <div className="flex items-center gap-3 text-sm font-semibold text-gray-300 bg-gray-900 px-3 py-1.5 rounded-md border border-gray-700">
          <div className="flex items-center gap-1" title={translate("liveAudio:LiveAudioControlPanel.totalAudienceActivePassiveStaff", "Audiencia total (Activos + Pasivos + Staff)")}>
            <Users size={16} className="text-gray-400" /> {totalAudience}
          </div>
          <div className="w-px h-4 bg-gray-600"></div>
          {pendingWordCount > 0 ? (
             <div className="flex items-center gap-1 text-yellow-400 animate-pulse" title={translate("liveAudio:LiveAudioControlPanel.raisedHands", "Manos levantadas")}>
               <UserCheck size={16} /> {pendingWordCount}
             </div>
          ) : (
             <div className="flex items-center gap-1" title={translate("liveAudio:LiveAudioControlPanel.activeUsers", "Usuarios activos")}>
               <span className="w-2 h-2 rounded-full bg-green-500"></span> {activeUsers}
             </div>
          )}
        </div>

        {/* Moderator Controls */}
        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <button
              onClick={() => {
                onStartListening();
                setIsListenVolOpen(!isListenVolOpen);
              }}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-lg ${
                listenVolume === 0 ? 'bg-gray-700 text-gray-400' : 'bg-gray-900 text-blue-200 border border-gray-700'
              }`}
              title={translate("liveAudio:LiveAudioControlPanel.adjustListeningVolume", "Regular volumen de escucha")}
            >
              {listenVolume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>

            {isListenVolOpen && (
              <div
                className="absolute bottom-full mb-2 -start-6 bg-gray-800 border border-gray-700 p-3 rounded-sm shadow-xl flex flex-col items-center gap-2 z-100"
                onClick={e => e.stopPropagation()}
              >
                <span className="text-xs font-semibold text-gray-300">{listenVolume}%</span>
                <div className="h-32 w-8 flex items-center justify-center">
                  <input
                    type="range"
                    aria-label={translate("liveAudio:LiveAudioControlPanel.listeningVolume", "Volumen de escucha")}
                    min="0"
                    max="100"
                    value={listenVolume}
                    onChange={(e) => onListenVolumeChange(parseInt(e.target.value, 10))}
                    className="w-32 h-1 -rotate-90 origin-center accent-blue-500 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onToggleModeratorMic}
            disabled={moderatorMicrophoneTrackState === 'publishing'}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shadow-lg
              ${ownVoiceSelected ? 'ring-2 ring-yellow-400 ring-offset-2 ring-offset-gray-800' : ''} 
              ${moderatorMicrophoneTrackState === 'publishing' ? 'bg-orange-600 text-white shadow-[0_0_15px_rgba(234,88,12,0.5)]' 
              : moderatorMicrophoneTrackState === 'error' ? 'bg-red-700 hover:bg-red-600 text-white'
              : isModeratorMuted ? 'bg-gray-600 text-gray-300' : 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)]'}`}
            title={moderatorMicrophoneTrackState === 'publishing' ? translate("liveAudio:LiveAudioControlPanel.enablingMicrophone", "Activando micrófono") : moderatorMicrophoneTrackState === 'error' ? translate("liveAudio:LiveAudioControlPanel.microphoneErrorPressToRetry", "Error de micrófono; pulsar para reintentar") : isModeratorMuted ? translate("liveAudio:LiveAudioControlPanel.openYourMicrophone", "Abrir tu micrófono") : translate("liveAudio:LiveAudioControlPanel.muteYourMicrophone", "Silenciar tu micrófono")}
          >
            {moderatorMicrophoneTrackState === 'publishing' ? <Loader2 className="w-5 h-5 animate-spin" /> : isModeratorMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>

          <div className="relative flex items-center">
            <button
              type="button"
              aria-label={translate("liveAudio:LiveAudioControlPanel.adjustYourMicrophoneOutputVolume", "Regular volumen de salida de tu micro")}
              aria-expanded={isMicVolOpen}
              className="flex items-center bg-gray-900 border border-gray-700 rounded-sm px-2 h-10 cursor-pointer"
              onClick={() => setIsMicVolOpen(!isMicVolOpen)}
              title={translate("liveAudio:LiveAudioControlPanel.adjustYourMicrophoneOutputVolume", "Regular volumen de salida de tu micro")}
            >
              <span className="text-white text-xs w-10 text-center font-semibold">{microphoneVolume}%</span>
            </button>

            {isMicVolOpen && (
              <div
                className="absolute bottom-full mb-2 -end-4 bg-gray-800 border border-gray-700 p-3 rounded-sm shadow-xl flex flex-col items-center gap-2 z-100"
              >
                {onModeratorMusicModeChange && (
                  <label className="flex items-center gap-1 cursor-pointer bg-gray-900 px-2 py-1 rounded-sm w-full justify-center" title={translate("liveAudio:LiveAudioControlPanel.musicMode", "Modo Música")}>
                    <input 
                      type="checkbox" 
                      checked={isModeratorMusicMode} 
                      onChange={(e) => onModeratorMusicModeChange(e.target.checked)}
                      className="accent-purple-500 w-3 h-3"
                    />
                    <span className="text-[10px]">🎵</span>
                  </label>
                )}
                <span className="text-xs font-semibold text-gray-300">{microphoneVolume}%</span>
                <div className="h-32 w-8 flex items-center justify-center">
                  <input
                    type="range"
                    aria-label={translate("liveAudio:LiveAudioControlPanel.yourMicrophoneOutputVolume", "Volumen de salida de tu micro")}
                    min="0"
                    max="300"
                    value={microphoneVolume}
                    onChange={(e) => onMicrophoneVolumeChange(parseInt(e.target.value, 10))}
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
          className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-sm transition-colors flex items-center gap-1 text-sm font-semibold"
          title={translate("liveAudio:LiveAudioControlPanel.viewUsersPanel", "Ver panel de usuarios")}
        >
          <Users size={16} />
          {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>

    </div>
  );
};
