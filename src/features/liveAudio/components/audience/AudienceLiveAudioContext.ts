import { createContext, useContext } from 'react';
import type { LiveAudioConnectionState, LiveAudioAvailability } from '../../../../types/liveAudio';

export interface AudienceLiveAudioContextValue {
  state: LiveAudioConnectionState;
  isActive: boolean;
  isMicrophoneActive: boolean;
  hasAudioStarted: boolean;
  isPendingWord: boolean;
  isWordGranted: boolean;
  isParticipationBlocked: boolean;
  volume: number;
  onVolumeChange: (vol: number) => void;
  microphoneVolume?: number;
  isMusicMode?: boolean;
  onMicrophoneVolumeChange?: (vol: number) => void;
  onMusicModeChange?: (mode: boolean) => void;
  onStartAudio: () => void;
  onRetryAudio: () => void;
  onJoinActive: () => void;
  onLeaveActive: () => void;
  onRequestWord: () => void;
  onCancelRequest: () => void;
  onToggleMicrophone: () => void;
  onOpenMessage: () => void;
  availability: LiveAudioAvailability;
}

export const AudienceLiveAudioContext = createContext<AudienceLiveAudioContextValue | null>(null);

export const useAudienceLiveAudio = () => useContext(AudienceLiveAudioContext);
