import { useState } from 'react';
import { createPortal } from 'react-dom';
import { LiveAudioControlPanel } from './LiveAudioControlPanel';
import { PrivateControlInbox, type PrivateMessage } from './PrivateControlInbox';
import type { LiveAudioParticipant } from './LiveAudioParticipantRow';
import type { PendingControlAuthorization } from '../../../../types/liveAudio';
import { Bell } from 'lucide-react';
import { useLiveAudioAvailability } from '../../hooks/useLiveAudioAvailability';

export interface LiveAudioControlContainerProps {
  isControlAuthorized: boolean;
  totalAudience: number;
  authorizationRequests?: PendingControlAuthorization[];
  onApproveRequest?: (sessionId: string) => void;
  onRejectRequest?: (sessionId: string) => void;
}

export default function LiveAudioControlContainer({
  isControlAuthorized,
  totalAudience,
  authorizationRequests = [],
  onApproveRequest = () => {},
  onRejectRequest = () => {}
}: LiveAudioControlContainerProps) {
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [isModeratorMuted, setIsModeratorMuted] = useState(true);
  const [moderatorVolume, setModeratorVolume] = useState(100);
  const { availability } = useLiveAudioAvailability();

  if (availability !== 'enabled') {
    return null;
  }

  // In production, this container will use LiveKit hooks to get participants and messages.
  // For now, we render empty lists since we haven't integrated the LiveKit backend yet.
  const participants: LiveAudioParticipant[] = [];
  const messages: PrivateMessage[] = [];
  const activeUsers = 0;
  const pendingWordCount = 0;

  const handleToggleModeratorMic = () => {
    setIsModeratorMuted(!isModeratorMuted);
  };

  const portalTarget = document.getElementById('live-audio-inbox-portal-target');

  const hasUnread = messages.length > 0 || authorizationRequests.length > 0;

  return (
    <>
      {portalTarget && createPortal(
        <div className="relative">
          <button
            onClick={() => setIsInboxOpen(!isInboxOpen)}
            className={`flex items-center justify-center p-2 text-xs font-semibold rounded border transition-all cursor-pointer ${
              hasUnread 
                ? 'bg-red-600 border-red-500 text-white animate-pulse'
                : isInboxOpen 
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white'
            }`}
            title="Bandeja Privada"
          >
            <Bell size={14} />
            {hasUnread && (
              <span className="absolute -top-1 -right-1 bg-white text-red-600 text-[10px] font-bold px-1 rounded-full">
                {messages.length + authorizationRequests.length}
              </span>
            )}
          </button>
          
          <PrivateControlInbox
            isOpen={isInboxOpen}
            isControlAuthorized={isControlAuthorized}
            messages={messages}
            authorizationRequests={authorizationRequests}
            onApproveRequest={onApproveRequest}
            onRejectRequest={onRejectRequest}
            onDismissMessage={() => {}}
          />
        </div>,
        portalTarget
      )}

      <LiveAudioControlPanel
        totalAudience={totalAudience}
        activeUsers={activeUsers}
        isModeratorMuted={isModeratorMuted}
        onToggleModeratorMic={handleToggleModeratorMic}
        moderatorVolume={moderatorVolume}
        onModeratorVolumeChange={setModeratorVolume}
        participants={participants}
        isControlAuthorized={isControlAuthorized}
        onMuteAll={() => {}}
        onGrantAllQueue={() => {}}
        onGrant={() => {}}
        onRevoke={() => {}}
        onMute={() => {}}
        onKick={() => {}}
        onVolumeChange={() => {}}
        pendingWordCount={pendingWordCount}
      />
    </>
  );
}
