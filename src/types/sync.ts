import type { AudioState } from './audio';
import type { AppMode, Presentation, ScriptureNavState, VideoState } from './presentation';
import type { QuizSyncState } from './quiz';
import type { SeferReaderState } from '../hooks/useSeferReader';

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
  quizState?: QuizSyncState | null;
}

export type RemoteCommandPayload =
  | { command: 'SELECT_PRESENTATION_AND_SLIDE'; presentation: Presentation | null; slideIndex: number; direction?: 'forward' | 'backward'; targetVerse?: string }
  | { command: 'TOGGLE_APP_MODE'; mode: AppMode }
  | { command: 'TOGGLE_BG_LOCK'; }
  | { command: 'SELECT_BG_OVERRIDE'; bg: string | null }
  | { command: 'QUIZ_START_TIMER' }
  | { command: 'QUIZ_PAUSE_TIMER' }
  | { command: 'QUIZ_RESUME_TIMER' }
  | { command: 'QUIZ_RESET_TIMER' }
  | { command: 'QUIZ_COMPLETE' }
  | { command: 'QUIZ_SELECT_SUBSLIDE'; index: number }
  | { command: 'QUIZ_DEMO_SELECT'; optionId: string | null }
  | { command: 'QUIZ_PLAY_APPLAUSE' }
  | { command: 'QUIZ_PLAY_MAL' }
  | { command: 'SCRIPTURE_PROJECT'; state: SeferReaderState; navCommand?: 'navigate' | 'next' | 'previous' }
  | { command: 'SCRIPTURE_ADD_SLIDE'; state: SeferReaderState; kind?: 'tanaj' | 'sefer' }
  | { command: 'SCRIPTURE_BOUNDARY'; direction: 'next' | 'previous' }
  | { command: 'SCRIPTURE_ESCAPE' }
  | { command: 'SCRIPTURE_ARROW_NAV'; direction: 'up' | 'down' }
  | { command: 'UPDATE_FONT_SIZES'; hebrewFontSize?: number; combinedTextBaseSize?: number }
  | { command: 'VIDEO_STATE_CHANGE'; state: VideoState | null }
  | { command: 'AUDIO_STATE_CHANGE'; state: AudioState }
  | { command: 'RESET_STATE' };

export type BroadcastMessage =
  | ({ type: 'SYNC_STATE' } & SyncStatePayload & SyncProtocolMeta)
  | ({ type: 'AUDIO_TELEMETRY'; clientId: string; origin: 'control' | 'presenter'; audioState: AudioState } & SyncProtocolMeta)
  | ({ type: 'VIDEO_TELEMETRY'; clientId: string; origin: 'control' | 'presenter'; videoState: VideoState | null } & SyncProtocolMeta)
  | ({ type: 'DISPLAY_TELEMETRY'; clientId: string; origin: 'control' | 'presenter' } & DisplayTelemetryState & SyncProtocolMeta)
  | ({ type: 'AUDIO_SYNC_MAPS_UPDATE'; maps: unknown[] } & SyncProtocolMeta)
  | ({ type: 'REQUEST_STATE'; clientId?: string } & SyncProtocolMeta)
  | ({ type: 'REMOTE_COMMAND'; clientId: string; payload: RemoteCommandPayload } & SyncProtocolMeta);
