import type { AudioState } from './audio';
import type { AppMode, Presentation, ScriptureNavState, VideoState } from './presentation';

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
  | ({ type: 'SYNC_STATE' } & SyncStatePayload)
  | { type: 'AUDIO_TELEMETRY'; clientId: string; origin: 'control' | 'presenter'; audioState: AudioState }
  | { type: 'AUDIO_SYNC_MAPS_UPDATE'; maps: unknown[] };
