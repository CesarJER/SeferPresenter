import type { ReactNode } from 'react';
import type { LiveAudioParticipantRole } from '../../../types/liveAudio';
import { LiveAudioContext } from './LiveAudioContext';
import { useLiveAudio } from './useLiveAudio';

interface LiveAudioProviderProps {
  role: LiveAudioParticipantRole;
  roomSession?: string;
  controlSessionId?: string;
  autoConnect?: boolean;
  children: ReactNode;
}

export const LiveAudioProvider = ({
  role,
  roomSession,
  controlSessionId,
  autoConnect,
  children,
}: LiveAudioProviderProps) => {
  const liveAudio = useLiveAudio({ role, roomSession, controlSessionId, autoConnect });

  return (
    <LiveAudioContext.Provider value={liveAudio}>
      {children}
    </LiveAudioContext.Provider>
  );
};
