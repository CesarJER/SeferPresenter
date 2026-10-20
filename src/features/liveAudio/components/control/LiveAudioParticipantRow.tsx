import { translate } from '../../../../i18n/runtime';
import { useUiTranslation } from '../../../../i18n/useUiTranslation';
import React, { useState } from 'react';
import { Eye, EyeOff, Hand, MessageSquare, Mic, MicOff, RotateCcw, Trash2, UserCheck, UserX, Volume2, X, XCircle, Loader2 } from 'lucide-react';
import type { LiveAudioConnectionState, MicrophoneTrackState, SpeakerState } from '../../../../types/liveAudio';
import { LiveAudioStatusBadge, type ParticipantStatus } from '../shared/LiveAudioStatusBadge';

export interface LiveAudioParticipant {
  participantId: string;
  alias: string;
  speakerState: SpeakerState;
  isMuted: boolean;
  isMicrophoneActive: boolean;
  microphoneTrackState?: MicrophoneTrackState;
  liveAudioConnectionState?: LiveAudioConnectionState;
  isActiveAudience: boolean;
  isKicked: boolean;
  isAliasVisibleToActiveParticipants?: boolean;
  isAliasHiddenByControl?: boolean;
  canViewActiveParticipants?: boolean;
  microphoneVolume?: number;
  isMusicMode?: boolean;
}

interface LiveAudioParticipantRowProps {
  participant: LiveAudioParticipant;
  voiceSelected?: boolean;
  voiceSelectable?: boolean;
  onSelectVoice?: (id: string) => void;
  isControlAuthorized: boolean;
  onGrant?: (id: string) => void;
  onRevoke?: (id: string) => void;
  onMute?: (id: string) => void;
  onKick?: (id: string) => void;
  onRescue?: (id: string) => void;
  onBlock?: (id: string) => void;
  onSetAliasSharedVisibility?: (id: string, hidden: boolean) => void;
  onSetActiveListViewPermission?: (id: string, canView: boolean) => void;
  onRemove?: (id: string) => void;
  onMicrophoneConfigChange?: (
    id: string,
    config: { volume?: number; musicMode?: boolean }
  ) => void;
}

export const LiveAudioParticipantRow: React.FC<LiveAudioParticipantRowProps> = ({
  participant,
  voiceSelected,
  voiceSelectable,
  onSelectVoice,
  isControlAuthorized,
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
}) => {
  useUiTranslation('liveAudio');
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);

  const isRequested = participant.speakerState === 'REQUESTED' && !participant.isKicked;
  const isGranted = participant.speakerState === 'GRANTED' && !participant.isKicked;
  const audioReady = participant.liveAudioConnectionState === 'connected' || participant.liveAudioConnectionState === 'reconnected';
  const isListener =
    participant.speakerState === 'LISTENER' &&
    participant.isActiveAudience &&
    !participant.isKicked;

  const hasOpenMicrophone =
    isGranted && participant.isMicrophoneActive && participant.microphoneTrackState === 'published' && !participant.isMuted;

  const volume = participant.microphoneVolume ?? 100;
  const displayAlias = participant.alias.trim() || 'Sin nick';
  const displayName = isControlAuthorized ? displayAlias : translate("liveAudio:LiveAudioParticipantRow.anonymousUser", "Usuario anónimo");

  const badgeStatus: ParticipantStatus = participant.isKicked
    ? 'kicked'
    : participant.microphoneTrackState === 'publishing'
      ? 'publishing'
      : participant.microphoneTrackState === 'error'
        ? 'microphone-error'
        : hasOpenMicrophone && participant.microphoneTrackState === 'published'
          ? 'microphone-published'
      : isRequested
        ? 'permission-requested'
        : isGranted
          ? 'permission-granted'
          : 'connected';

  return (
    <div className="flex items-center justify-between p-2 hover:bg-gray-800 border-b border-gray-800 last:border-0 transition-colors group">
      <div className="flex min-w-0 items-center gap-3">
        {onSelectVoice ? <button type="button" aria-label={translate("liveAudio:LiveAudioParticipantRow.voiceCommands", "Comandos de voz: {{value1}}", { value1: displayName })}
          aria-pressed={!!voiceSelected} disabled={!voiceSelectable && !voiceSelected}
          onClick={() => onSelectVoice(participant.participantId)}
          className={`rounded-full p-1.5 disabled:opacity-40 ${
            hasOpenMicrophone ? 'bg-blue-500/20' : ''
          } ${
            voiceSelected ? 'ring-2 ring-yellow-400' : ''
          } ${
            participant.microphoneTrackState === 'publishing'
              ? 'text-orange-400'
              : voiceSelected
                ? 'text-yellow-300'
                : hasOpenMicrophone
                  ? 'text-blue-400'
                  : 'text-gray-400'
          }`}>
          {participant.microphoneTrackState === 'publishing' ? <Loader2 size={16} className="animate-spin" /> : hasOpenMicrophone ? <Mic size={16} /> : <MicOff size={16} />}
        </button> : <LiveAudioStatusBadge status={badgeStatus} isMuted={participant.isMuted} />}

        <span
          className={`truncate font-medium ${isControlAuthorized ? 'text-gray-200' : 'text-gray-500 italic'
            }`}
        >
          {displayName}
        </span>
      </div>

      <div className="flex items-center gap-2 opacity-100 md:max-w-0 md:opacity-0 md:group-hover:max-w-full md:group-hover:opacity-100 transition-all">
        {isRequested && onGrant && (
          <button
            onClick={() => onGrant(participant.participantId)}
            disabled={!audioReady}
            className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded-sm text-xs"
            title={audioReady ? translate("liveAudio:LiveAudioParticipantRow.grantSpeakingTurn", "Conceder palabra") : translate("liveAudio:LiveAudioParticipantRow.waitingForAudioConnectionAudienceMustRetryAudio", "Esperando conexión de audio; Audience debe reintentar el audio")}
          >
            <Hand size={14} />
            <span className="hidden sm:inline">{translate("liveAudio:LiveAudioParticipantRow.approve", "Aprobar")}</span>
          </button>
        )}

        {isListener && onGrant && (
          <button
            onClick={() => onGrant(participant.participantId)}
            disabled={!audioReady}
            className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded-sm text-xs"
            title={audioReady ? translate("liveAudio:LiveAudioParticipantRow.allowMicrophone", "Permitir micrófono") : translate("liveAudio:LiveAudioParticipantRow.waitingForAudioConnectionAudienceMustRetryAudio", "Esperando conexión de audio; Audience debe reintentar el audio")}
          >
            <MessageSquare size={14} />
            <span className="hidden sm:inline">{translate("liveAudio:LiveAudioParticipantRow.allow", "Permitir")}</span>
          </button>
        )}

        {isGranted && onMute && (
          <button
            onClick={() => onMute(participant.participantId)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${hasOpenMicrophone
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-gray-600 text-gray-300'
              }`}
            title={hasOpenMicrophone ? translate("liveAudio:LiveAudioParticipantRow.muteTrack", "Silenciar track") : translate("liveAudio:LiveAudioParticipantRow.microphoneClosedOrMuted", "Micro cerrado o silenciado")}
          >
            <MicOff size={14} />
            <span className="hidden sm:inline">
              {hasOpenMicrophone ? translate("liveAudio:LiveAudioParticipantRow.mute", "Silenciar") : translate("liveAudio:LiveAudioParticipantRow.muted", "Silenciado")}
            </span>
          </button>
        )}

        {isGranted && onRevoke && (
          <button
            onClick={() => {
              if (window.confirm(translate("liveAudio:LiveAudioParticipantRow.revokeSSpeakingTurn", "¿Revocar la palabra a {{value1}}?", { value1: displayName }))) {
                onRevoke(participant.participantId);
              }
            }}
            className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded-sm text-xs"
            title={translate("liveAudio:LiveAudioParticipantRow.revokeSpeakingTurn", "Revocar palabra")}
          >
            <X size={14} className="opacity-50" />
            <span className="hidden sm:inline">{translate("liveAudio:LiveAudioParticipantRow.revoke", "Revocar")}</span>
          </button>
        )}

        {onMicrophoneConfigChange && !participant.isKicked && (
          <div className="relative flex items-center">
            <button
              onClick={() => setIsVolumeOpen(!isVolumeOpen)}
              className={`flex items-center gap-1 p-1 rounded transition-colors ${isVolumeOpen
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              title={translate("liveAudio:LiveAudioParticipantRow.adjustRemoteMicrophone", "Ajustar micro remoto")}
            >
              <Volume2 size={16} />
              <span className="text-[10px] w-8 text-start">{volume}%</span>
            </button>

            {isVolumeOpen && (
              <div className="absolute end-8 top-1/2 -translate-y-1/2 bg-gray-800 border border-gray-700 p-2 rounded-sm shadow-xl flex items-center gap-2 z-100 min-w-48">
                <span className="text-xs font-semibold text-gray-300 w-10">
                  {volume}%
                </span>

                <input
                  type="range"
                  min="0"
                  max="300"
                  step="5"
                  value={volume}
                  onChange={(e) =>
                    onMicrophoneConfigChange(participant.participantId, {
                      volume: parseInt(e.target.value, 10),
                    })
                  }
                  className="w-24 accent-blue-500 cursor-pointer"
                />

                <label
                  className={`flex items-center justify-center gap-1 px-2 py-1 rounded cursor-pointer text-[10px] ${participant.isMusicMode
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-900 text-gray-300 hover:bg-gray-700'
                    }`}
                  title={translate("liveAudio:LiveAudioParticipantRow.musicMode", "Modo música")}
                >
                  <input
                    type="checkbox"
                    checked={participant.isMusicMode ?? false}
                    onChange={(e) =>
                      onMicrophoneConfigChange(participant.participantId, {
                        musicMode: e.target.checked,
                      })
                    }
                    className="hidden"
                  />
                  <span>🎵</span>
                </label>

                <button
                  onClick={() => setIsVolumeOpen(false)}
                  className="text-gray-500 hover:text-white transition-colors"
                  title={translate("liveAudio:LiveAudioParticipantRow.close", "Cerrar")}
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {onSetAliasSharedVisibility && (
          <button
            onClick={() => {
              if (!participant.isAliasVisibleToActiveParticipants) return;
              onSetAliasSharedVisibility(
                participant.participantId,
                !participant.isAliasHiddenByControl,
              );
            }}
            disabled={!participant.isAliasVisibleToActiveParticipants}
            className={`p-1 rounded transition-colors ${!participant.isAliasVisibleToActiveParticipants
              ? 'text-gray-600 cursor-not-allowed'
              : participant.isAliasHiddenByControl
                ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                : 'text-green-400 hover:text-white hover:bg-gray-700'
              }`}
            title={
              !participant.isAliasVisibleToActiveParticipants
                ? translate("liveAudio:LiveAudioParticipantRow.userDidNotAuthorizeSharingTheirAlias", "Usuario no autorizo compartir alias")
                : participant.isAliasHiddenByControl
                  ? translate("liveAudio:LiveAudioParticipantRow.hiddenClickToMakeVisible", "Incognito, clic para hacer visible")
                  : translate("liveAudio:LiveAudioParticipantRow.visibleToOthersClickToHide", "Visible para otros, clic para ocultar")
            }
          >
            {participant.isAliasHiddenByControl ? <UserX size={16} /> : <UserCheck size={16} />}
          </button>
        )}

        {onSetActiveListViewPermission && (
          <button
            onClick={() =>
              onSetActiveListViewPermission(
                participant.participantId,
                !participant.canViewActiveParticipants,
              )
            }
            className={`p-1 rounded transition-colors ${participant.canViewActiveParticipants
              ? 'text-blue-400 hover:text-white hover:bg-gray-700'
              : 'text-gray-500 hover:text-white hover:bg-gray-700'
              }`}
            title={
              participant.canViewActiveParticipants
                ? translate("liveAudio:LiveAudioParticipantRow.canViewListClickToRevoke", "Puede ver lista, clic para revocar")
                : translate("liveAudio:LiveAudioParticipantRow.cannotViewListClickToAllow", "No puede ver lista, clic para conceder")
            }
          >
            {participant.canViewActiveParticipants ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        )}

        {participant.isKicked && onRescue && (
          <button
            onClick={() => onRescue(participant.participantId)}
            className="flex items-center gap-1 bg-blue-700 hover:bg-blue-600 text-white px-2 py-1 rounded-sm text-xs"
            title={translate("liveAudio:LiveAudioParticipantRow.restoreActiveStatusAllowsRequestingAnotherTurn", "Restablecer como activo (permite volver a pedir turno)")}
          >
            <RotateCcw size={14} />
            <span className="hidden sm:inline">{translate("liveAudio:LiveAudioParticipantRow.reset", "Restablecer")}</span>
          </button>
        )}

        {participant.isKicked && onRemove && (
          <button
            onClick={() => {
              if (window.confirm(translate("liveAudio:LiveAudioParticipantRow.removeFromTheRoomTheyCanRequestEntryAgain", "¿Expulsar a {{value1}} de la sala? Podrá volver a solicitar entrada si lo desea.", { value1: displayName }))) {
                onRemove(participant.participantId);
              }
            }}
            className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-gray-200 px-2 py-1 rounded-sm text-xs transition-colors"
            title={translate("liveAudio:LiveAudioParticipantRow.removeToEntranceDoesNotBlockReEntry", "Expulsar a la puerta (no bloquea, puede volver)")}
          >
            <Trash2 size={13} />
            <span className="hidden sm:inline">{translate("liveAudio:LiveAudioParticipantRow.remove", "Expulsar")}</span>
          </button>
        )}

        {participant.isKicked && onBlock && (
          <button
            onClick={() => {
              if (window.confirm(translate("liveAudio:LiveAudioParticipantRow.completelyBlockAndBan", "¿Bloquear y vetar totalmente a {{value1}}?", { value1: displayName }))) {
                onBlock(participant.participantId);
              }
            }}
            className="flex items-center gap-1 bg-red-800 hover:bg-red-700 text-white px-2 py-1 rounded-sm text-xs transition-colors"
            title={translate("liveAudio:LiveAudioParticipantRow.blockAccessCompletely", "Bloquear acceso totalmente")}
          >
            <XCircle size={13} />
            <span className="hidden sm:inline">{translate("liveAudio:LiveAudioParticipantRow.block", "Bloquear")}</span>
          </button>
        )}

        {onKick && !participant.isKicked && (
          <button
            onClick={() => {
              if (window.confirm(translate("liveAudio:LiveAudioParticipantRow.restrictTheyWillBeMutedAndTheirSpeakingTurn", "¿Restringir a {{value1}}? Se silenciará y bloqueará su turno.", { value1: displayName }))) {
                onKick(participant.participantId);
              }
            }}
            className="text-gray-500 hover:text-amber-500 p-1 transition-colors"
            title={translate("liveAudio:LiveAudioParticipantRow.restrictParticipation", "Restringir participación")}
            aria-label={translate("liveAudio:LiveAudioParticipantRow.restrict", "Restringir a {{value1}}", { value1: displayName })}
          >
            <XCircle size={16} />
          </button>
        )}
      </div>
    </div>
  );
};
