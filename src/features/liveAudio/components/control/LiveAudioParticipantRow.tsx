import React, { useState } from 'react';
import { Hand, MessageSquare, MicOff, Volume2, X, XCircle } from 'lucide-react';
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
  volume: number;
}

interface LiveAudioParticipantRowProps {
  participant: LiveAudioParticipant;
  isControlAuthorized: boolean;
  onGrant?: (id: string) => void;
  onRevoke?: (id: string) => void;
  onMute?: (id: string) => void;
  onKick?: (id: string) => void;
  onVolumeChange?: (id: string, volume: number) => void;
}

export const LiveAudioParticipantRow: React.FC<LiveAudioParticipantRowProps> = ({
  participant,
  isControlAuthorized,
  onGrant,
  onRevoke,
  onMute,
  onKick,
  onVolumeChange,
}) => {
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const isRequested = participant.speakerState === 'REQUESTED' && !participant.isKicked;
  const isGranted = participant.speakerState === 'GRANTED' && !participant.isKicked;
  const isListener = participant.speakerState === 'LISTENER' && participant.isActiveAudience && !participant.isKicked;
  const hasOpenMicrophone = isGranted && participant.isMicrophoneActive && !participant.isMuted;
  const canGrant = Boolean(onGrant && (isRequested || isListener || participant.isKicked));
  const displayAlias = participant.alias.trim() || 'Sin nick';
  const displayName = isControlAuthorized ? displayAlias : 'Usuario anonimo';

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
    <div className="flex items-center justify-between p-2 hover:bg-gray-800 border-b border-gray-800 last:border-0 transition-colors group">
      <div className="flex min-w-0 items-center gap-3">
        <LiveAudioStatusBadge status={badgeStatus} isMuted={participant.isMuted} />
        <span className={`truncate font-medium ${isControlAuthorized ? 'text-gray-200' : 'text-gray-500 italic'}`}>
          {displayName}
        </span>
      </div>

      <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        {canGrant && (
          <button
            onClick={() => onGrant?.(participant.participantId)}
            className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded text-xs"
            title={isRequested ? 'Conceder palabra' : 'Permitir microfono'}
          >
            {isRequested ? <Hand size={14} /> : <MessageSquare size={14} />}
            <span className="hidden sm:inline">{isRequested ? 'Aprobar' : 'Permitir'}</span>
          </button>
        )}

        {hasOpenMicrophone && onMute && (
          <button
            onClick={() => onMute(participant.participantId)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-600 hover:bg-red-500 text-white"
            title="Silenciar micro"
          >
            <MicOff size={14} /> <span className="hidden sm:inline">Silenciar</span>
          </button>
        )}

        {isGranted && !hasOpenMicrophone && (
          <button
            disabled
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-700 text-gray-300 cursor-default"
            title="Orador activo con micro cerrado"
          >
            <MicOff size={14} /> <span className="hidden sm:inline">Silenciado</span>
          </button>
        )}

        {isGranted && onRevoke && (
          <button
            onClick={() => {
              if (window.confirm(`Revocar la palabra a ${displayName}?`)) {
                onRevoke(participant.participantId);
              }
            }}
            className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs"
            title="Revocar palabra"
          >
            <X size={14} className="opacity-60" /> <span className="hidden sm:inline">Revocar</span>
          </button>
        )}

        {onVolumeChange && (
          <div className="relative flex items-center">
            <button
              onClick={() => setIsVolumeOpen(!isVolumeOpen)}
              className={`flex items-center gap-1 p-1 rounded transition-colors ${
                isVolumeOpen ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Ajustar volumen"
            >
              <Volume2 size={16} />
              <span className="text-[10px] w-8 text-left">{participant.volume}%</span>
            </button>
            {isVolumeOpen && (
              <div className="absolute right-8 top-1/2 -translate-y-1/2 bg-gray-800 border border-gray-700 p-2 rounded shadow-xl flex items-center gap-2 z-[100] min-w-32">
                <span className="text-xs font-semibold text-gray-300 w-8">{participant.volume}%</span>
                <input
                  type="range"
                  min="0"
                  max="300"
                  value={participant.volume}
                  onChange={(e) => onVolumeChange(participant.participantId, parseInt(e.target.value, 10))}
                  className="w-24 accent-blue-500 cursor-pointer"
                />
                <button onClick={() => setIsVolumeOpen(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {onKick && (
          <button
            onClick={() => {
              if (window.confirm(`Expulsar a ${displayName}?`)) {
                onKick(participant.participantId);
              }
            }}
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
