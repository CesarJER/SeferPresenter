import { createContext, useContext } from 'react';
import type {
  LiveAudioConnectionState,
  LiveAudioConnectionQuality,
  LiveAudioAvailability,
  LiveAudioMicrophoneDiagnostics,
  LiveAudioExternalBroadcastState,
  MicrophoneTrackState,
} from '../../../../types/liveAudio';

export interface AudienceLiveAudioContextValue {
  state: LiveAudioConnectionState;
  connectionQuality: LiveAudioConnectionQuality;
  isActive: boolean;
  isMicrophoneActive: boolean;
  microphoneTrackState: MicrophoneTrackState;
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
  isAliasVisibleToOthers: boolean;
  onAliasVisibilityChange: (checked: boolean) => void;
  canViewActiveParticipants: boolean;
  visibleParticipants: string[];
  availability: LiveAudioAvailability;
  microphoneDiagnostics?: LiveAudioMicrophoneDiagnostics;
  externalBroadcastState: LiveAudioExternalBroadcastState;
}

export const AudienceLiveAudioContext = createContext<AudienceLiveAudioContextValue | null>(null);

export const useAudienceLiveAudio = () => useContext(AudienceLiveAudioContext);
