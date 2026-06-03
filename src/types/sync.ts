import type { AudioState } from './audio';
import type { AppMode, Presentation, ScriptureNavState, VideoState } from './presentation';

export const SYNC_PROTOCOL_VERSION = 1;

export interface SyncProtocolMeta {
  protocolVersion?: typeof SYNC_PROTOCOL_VERSION;
  timestamp?: number;
}

export interface DisplayTelemetryState {
  backgroundLock: boolean;
  lockedBackgroundValue: string | null;
  userSelectedBackground: string | null;
}

export interface SyncStatePayload {
  clientId: string;
  origin: 'control' | 'presenter';
  presentation: Presentation | null;
  slideIndex: number;
  backgroundLock: boolean;
  lockedBackgroundValue: string | null;
  userSelectedBackground: string | null;
  videoState: VideoState | null;
  appMode: AppMode;
  scriptureState: ScriptureNavState | null;
  audioState: AudioState;
}

export type BroadcastMessage =
  | ({ type: 'SYNC_STATE' } & SyncStatePayload & SyncProtocolMeta)
  | ({ type: 'AUDIO_TELEMETRY'; clientId: string; origin: 'control' | 'presenter'; audioState: AudioState } & SyncProtocolMeta)
  | ({ type: 'VIDEO_TELEMETRY'; clientId: string; origin: 'control' | 'presenter'; videoState: VideoState | null } & SyncProtocolMeta)
  | ({ type: 'DISPLAY_TELEMETRY'; clientId: string; origin: 'control' | 'presenter' } & DisplayTelemetryState & SyncProtocolMeta)
  | ({ type: 'AUDIO_SYNC_MAPS_UPDATE'; maps: unknown[] } & SyncProtocolMeta)
  | ({ type: 'REQUEST_STATE'; clientId?: string } & SyncProtocolMeta);
