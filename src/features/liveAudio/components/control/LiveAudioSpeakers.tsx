import React from 'react';
import { LiveAudioParticipantRow, type LiveAudioParticipant } from './LiveAudioParticipantRow';
import { Mic2 } from 'lucide-react';

interface LiveAudioSpeakersProps {
  participants: LiveAudioParticipant[];
  isControlAuthorized: boolean;
  onRevoke: (id: string) => void;
  onMute: (id: string) => void;
  onKick: (id: string) => void;
  onRescue?: (id: string) => void;
  onSetAliasSharedVisibility?: (id: string, hidden: boolean) => void;
  onSetActiveListViewPermission?: (id: string, canView: boolean) => void;
  onRemove?: (id: string) => void;
  onMicrophoneConfigChange?: (id: string, config: { volume?: number; musicMode?: boolean }) => void;
}

export const LiveAudioSpeakers: React.FC<LiveAudioSpeakersProps> = ({
  participants,
  isControlAuthorized,
  onRevoke,
  onMute,
  onKick,
  onRescue,
  onSetAliasSharedVisibility,
  onSetActiveListViewPermission,
  onRemove,
  onMicrophoneConfigChange
}) => {
  const speakers = participants.filter(p => p.speakerState === 'GRANTED' && !p.isKicked);

  if (speakers.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        No hay oradores activos en este momento.
      </div>
    );
  }

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-1">
        <Mic2 size={12} /> Oradores activos ({speakers.length})
      </h3>
      <div className="bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
        {speakers.map(p => (
          <LiveAudioParticipantRow
            key={p.participantId}
            participant={p}
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
        ))}
      </div>
    </div>
  );
};
