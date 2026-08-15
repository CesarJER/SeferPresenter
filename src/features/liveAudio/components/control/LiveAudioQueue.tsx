import React from 'react';
import { LiveAudioParticipantRow, type LiveAudioParticipant } from './LiveAudioParticipantRow';
import { Users } from 'lucide-react';

interface LiveAudioQueueProps {
  participants: LiveAudioParticipant[];
  isControlAuthorized: boolean;
  onGrant: (id: string) => void;
  onKick: (id: string) => void;
  onRescue?: (id: string) => void;
  onBlock?: (id: string) => void;
  onSetAliasSharedVisibility?: (id: string, hidden: boolean) => void;
  onSetActiveListViewPermission?: (id: string, canView: boolean) => void;
  onRemove?: (id: string) => void;
  onMicrophoneConfigChange?: (id: string, config: { volume?: number; musicMode?: boolean }) => void;
}

export const LiveAudioQueue: React.FC<LiveAudioQueueProps> = ({
  participants,
  isControlAuthorized,
  onGrant,
  onKick,
  onRescue,
  onBlock,
  onSetAliasSharedVisibility,
  onSetActiveListViewPermission,
  onRemove,
  onMicrophoneConfigChange
}) => {
  const queue = participants.filter(p => p.speakerState === 'REQUESTED' && !p.isKicked);

  if (queue.length === 0) {
    return null;
  }

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-1">
        <Users size={12} /> Cola de espera ({queue.length})
      </h3>
      <div className="bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
        {queue.map(p => (
          <LiveAudioParticipantRow
            key={p.participantId}
            participant={p}
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
        ))}
      </div>
    </div>
  );
};
