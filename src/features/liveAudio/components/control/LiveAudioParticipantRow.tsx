import React, { useId, useState } from 'react';
import { Eye, EyeOff, Hand, MessageSquare, MicOff, RotateCcw, Trash2, UserCheck, UserX, Volume2, X, XCircle } from 'lucide-react';
import type { SpeakerState } from '../../../../types/liveAudio';
import { LiveAudioStatusBadge, type ParticipantStatus } from '../shared/LiveAudioStatusBadge';

export interface LiveAudioParticipant {
  participantId: string;
  alias: string;
  speakerState: SpeakerState;
  isMuted: boolean;
  isMicrophoneActive: boolean;
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
  isControlAuthorized: boolean;
  onGrant?: (id: string) => void;
  onRevoke?: (id: string) => void;
  onMute?: (id: string) => void;
  onKick?: (id: string) => void;
  onRescue?: (id: string) => void;
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
  isControlAuthorized,
  onGrant,
  onRevoke,
  onMute,
  onKick,
  onRescue,
  onSetAliasSharedVisibility,
  onSetActiveListViewPermission,
  onRemove,
  onMicrophoneConfigChange,
}) => {
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const microphoneConfigId = useId();

  const isRequested = participant.speakerState === 'REQUESTED' && !participant.isKicked;
  const isGranted = participant.speakerState === 'GRANTED' && !participant.isKicked;
  const isListener =
    participant.speakerState === 'LISTENER' &&
    participant.isActiveAudience &&
    !participant.isKicked;

  const hasOpenMicrophone =
    isGranted && participant.isMicrophoneActive && !participant.isMuted;

  const volume = participant.microphoneVolume ?? 100;
  const displayAlias = participant.alias.trim() || 'Sincronizando alias…';
  const displayName = isControlAuthorized ? displayAlias : 'Usuario anónimo';

  const badgeStatus: ParticipantStatus = participant.isKicked
    ? 'kicked'
    : hasOpenMicrophone
      ? 'talking'
      : isRequested
        ? 'permission-requested'
        : isGranted
          ? 'permission-granted'
          : 'connected';

  return (
    <div
      role="group"
      aria-label={`Controles de ${displayName}`}
      className="flex items-center justify-between p-2 hover:bg-gray-800 focus-within:bg-gray-800 border-b border-gray-800 last:border-0 transition-colors group"
    >
      <div className="flex min-w-0 items-center gap-3">
        <LiveAudioStatusBadge status={badgeStatus} isMuted={participant.isMuted} />

        <span
          className={`truncate font-medium ${isControlAuthorized ? 'text-gray-200' : 'text-gray-500 italic'
            }`}
        >
          {displayName}
        </span>
      </div>

      <div className="flex items-center gap-2 opacity-100 md:max-w-0 md:opacity-0 md:group-hover:max-w-full md:group-hover:opacity-100 md:group-focus-within:max-w-full md:group-focus-within:opacity-100 transition-all">
        {isRequested && onGrant && (
          <button
            onClick={() => onGrant(participant.participantId)}
            aria-label={`Conceder la palabra a ${displayName}`}
            className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded text-xs"
            title="Conceder palabra"
          >
            <Hand size={14} />
            <span className="hidden sm:inline">Aprobar</span>
          </button>
        )}

        {isListener && onGrant && (
          <button
            onClick={() => onGrant(participant.participantId)}
            aria-label={`Permitir micrófono a ${displayName}`}
            className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs"
            title="Permitir micrófono"
          >
            <MessageSquare size={14} />
            <span className="hidden sm:inline">Permitir</span>
          </button>
        )}

        {isGranted && onMute && (
          <button
            onClick={() => onMute(participant.participantId)}
            aria-label={hasOpenMicrophone ? `Silenciar a ${displayName}` : `${displayName} ya está silenciado`}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${hasOpenMicrophone
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-gray-600 text-gray-300'
              }`}
            title={hasOpenMicrophone ? 'Silenciar track' : 'Micro cerrado o silenciado'}
          >
            <MicOff size={14} />
            <span className="hidden sm:inline">
              {hasOpenMicrophone ? 'Silenciar' : 'Silenciado'}
            </span>
          </button>
        )}

        {isGranted && onRevoke && (
          <button
            onClick={() => {
              if (window.confirm(`¿Revocar la palabra a ${displayName}?`)) {
                onRevoke(participant.participantId);
              }
            }}
            aria-label={`Revocar la palabra a ${displayName}`}
            className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs"
            title="Revocar palabra"
          >
            <X size={14} className="opacity-50" />
            <span className="hidden sm:inline">Revocar</span>
          </button>
        )}

        {onMicrophoneConfigChange && !participant.isKicked && (
          <div className="relative flex items-center">
            <button
              onClick={() => setIsVolumeOpen(!isVolumeOpen)}
              aria-expanded={isVolumeOpen}
              aria-controls={microphoneConfigId}
              aria-label={`Ajustar micrófono de ${displayName}. Volumen actual ${volume} por ciento`}
              className={`flex items-center gap-1 p-1 rounded transition-colors ${isVolumeOpen
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              title="Ajustar micro remoto"
            >
              <Volume2 size={16} />
              <span className="text-[10px] w-8 text-left">{volume}%</span>
            </button>

            {isVolumeOpen && (
              <div
                id={microphoneConfigId}
                role="group"
                aria-label={`Configuración del micrófono de ${displayName}`}
                className="absolute right-8 top-1/2 -translate-y-1/2 bg-gray-800 border border-gray-700 p-2 rounded shadow-xl flex items-center gap-2 z-[100] min-w-48"
              >
                <span className="text-xs font-semibold text-gray-300 w-10">
                  {volume}%
                </span>

                <input
                  type="range"
                  min="0"
                  max="300"
                  step="5"
                  value={volume}
                  aria-label={`Volumen del micrófono de ${displayName}`}
                  aria-valuetext={`${volume} por ciento`}
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
                  title="Modo música"
                >
                  <input
                    type="checkbox"
                    checked={participant.isMusicMode ?? false}
                    onChange={(e) =>
                      onMicrophoneConfigChange(participant.participantId, {
                        musicMode: e.target.checked,
                      })
                    }
                    aria-label={`Modo música del micrófono de ${displayName}`}
                    className="sr-only"
                  />
                  <span>🎵</span>
                </label>

                <button
                  onClick={() => setIsVolumeOpen(false)}
                  className="text-gray-500 hover:text-white transition-colors"
                  title="Cerrar"
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
            aria-pressed={participant.isAliasVisibleToActiveParticipants && !participant.isAliasHiddenByControl}
            aria-label={
              participant.isAliasVisibleToActiveParticipants
                ? `${participant.isAliasHiddenByControl ? 'Mostrar' : 'Ocultar'} alias de ${displayName} a otros participantes`
                : `${displayName} no autorizó compartir su alias`
            }
            className={`p-1 rounded transition-colors ${!participant.isAliasVisibleToActiveParticipants
                ? 'text-gray-600 cursor-not-allowed'
                : participant.isAliasHiddenByControl
                  ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                  : 'text-green-400 hover:text-white hover:bg-gray-700'
              }`}
            title={
              !participant.isAliasVisibleToActiveParticipants
                ? 'Usuario no autorizo compartir alias'
                : participant.isAliasHiddenByControl
                  ? 'Incognito, clic para hacer visible'
                  : 'Visible para otros, clic para ocultar'
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
            aria-pressed={participant.canViewActiveParticipants === true}
            aria-label={`${participant.canViewActiveParticipants ? 'Revocar' : 'Conceder'} a ${displayName} permiso para ver participantes`}
            className={`p-1 rounded transition-colors ${participant.canViewActiveParticipants
                ? 'text-blue-400 hover:text-white hover:bg-gray-700'
                : 'text-gray-500 hover:text-white hover:bg-gray-700'
              }`}
            title={
              participant.canViewActiveParticipants
                ? 'Puede ver lista, clic para revocar'
                : 'No puede ver lista, clic para conceder'
            }
          >
            {participant.canViewActiveParticipants ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        )}

        {participant.isKicked && onRescue && (
          <button
            onClick={() => onRescue(participant.participantId)}
            aria-label={`Rescatar a ${displayName} como participante activo`}
            className="flex items-center gap-1 bg-blue-700 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs"
            title="Rescatar como activo sin abrir micrófono"
          >
            <RotateCcw size={14} />
            <span className="hidden sm:inline">Rescatar</span>
          </button>
        )}

        {participant.isKicked && onRemove && (
          <button
            onClick={() => {
              if (window.confirm(`Eliminar a ${displayName} de la sesion activa? Podra volver a unirse.`)) {
                onRemove(participant.participantId);
              }
            }}
            aria-label={`Eliminar a ${displayName} de participantes activos`}
            className="text-gray-500 hover:text-red-400 p-1 transition-colors"
            title="Eliminar de activos (no bloquea, puede volver)"
          >
            <Trash2 size={16} />
          </button>
        )}

        {onKick && !participant.isKicked && (
          <button
            onClick={() => {
              if (window.confirm(`¿Expulsar a ${displayName}?`)) {
                onKick(participant.participantId);
              }
            }}
            aria-label={`Bloquear a ${displayName}`}
            className="text-gray-500 hover:text-red-500 p-1"
            title="Expulsar"
          >
            <XCircle size={16} />
          </button>
        )}
      </div>
    </div>
  );
};
