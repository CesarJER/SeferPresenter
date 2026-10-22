import type { LiveAudioConnectionState, LiveAudioConnectionQuality, LiveAudioControlState, LiveAudioExternalBroadcastState, LiveAudioParticipantStatusMessage, MicrophoneTrackState } from '../../../../types/liveAudio';
import type { ScriptureNavState } from '../../../../types/presentation';
import type { SeferReaderState } from '../../../../types/scripture';
import type { VoiceScriptureCandidate } from '../../../voiceScripture/voiceScriptureParser';
import type { VoiceSessionPhase } from '../../../voiceScripture/voiceScriptureSession';
import type { LiveAudioParticipant } from './LiveAudioParticipantRow';

export interface ControlMediaState {
  state: LiveAudioConnectionState;
  connectionQuality: LiveAudioConnectionQuality;
  participantId: string | null;
  isMicrophoneActive: boolean;
  microphoneTrackState: MicrophoneTrackState;
  microphoneVolume: number;
  isMusicMode: boolean;
  listenVolume: number;
  controllers: LiveAudioParticipant[];
  voiceSelectableIds: string[];
  voiceSourceLabel: string;
  voiceSourceAvailability: 'none' | 'available' | 'waiting' | 'unavailable';
  onSelectVoice: (id: string) => void;
  onStartListening: () => void;
  onToggleMicrophone: () => void;
  onListenVolumeChange: (volume: number) => void;
  onMicrophoneVolumeChange: (volume: number) => void;
  onMusicModeChange: (mode: boolean) => void;
  applyConfig: (data: Record<string, unknown>) => void;
}

export interface ControlRtcModel {
  isControlAuthorized: boolean;
  controlSessionId?: string | null;
  controlState?: LiveAudioControlState | null;
  operatorNick: string;
  externalBroadcastState: LiveAudioExternalBroadcastState;
  externalBroadcastRevision: number;
  participantsMap: Record<string, LiveAudioParticipantStatusMessage>;
  participantAliases: Record<string, string>;
  participantMicrophoneConfigs: Record<string, { volume: number; musicMode: boolean }>;
  selectedVoiceParticipantId: string;
  onSharedVoiceSource: (id: string | null) => void;
  remoteVoiceState?: { options: VoiceScriptureCandidate[]; detail: string; phase: VoiceSessionPhase };
  onLocalVoiceOptions: (options: VoiceScriptureCandidate[], detail: string, phase: VoiceSessionPhase) => void;
  scriptureState: ScriptureNavState | null;
  voiceSuggestionsTarget?: HTMLElement | null;
  onProjectScripture: (state: SeferReaderState, command?: 'navigate') => void;
}
