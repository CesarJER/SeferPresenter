import { createContext, useContext } from 'react';
import type {
  LiveAudioConnectionState,
  LiveAudioConnectionQuality,
  LiveAudioAvailability,
  LiveAudioMicrophoneDiagnostics,
  MicrophoneTrackState,
} from '../../../../types/liveAudio';

export interface AudienceLiveAudioContextValue {
  state: LiveAudioConnectionState;
  connectionQuality: LiveAudioConnectionQuality;
  isMicrophoneActive: boolean;
  microphoneTrackState: MicrophoneTrackState;
  hasAudioStarted: boolean;
  volume: number;
  onVolumeChange: (vol: number) => void;
  microphoneVolume?: number;
  isMusicMode?: boolean;
  onMicrophoneVolumeChange?: (vol: number) => void;
  onMusicModeChange?: (mode: boolean) => void;
  onStartAudio: () => void;
  onRetryAudio: () => void;
  onToggleMicrophone: () => void;
  availability: LiveAudioAvailability;
  microphoneDiagnostics?: LiveAudioMicrophoneDiagnostics;
}

export const AudienceLiveAudioContext = createContext<AudienceLiveAudioContextValue | null>(null);

export const useAudienceLiveAudio = () => useContext(AudienceLiveAudioContext);
