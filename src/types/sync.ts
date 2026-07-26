import type { AudioState, AudioTimelineAction, AudioTimelineState } from './audio';
import type { LiveAudioBroadcastMessage, LiveAudioControlState } from './liveAudio';
import type { AppMode, Presentation, ScriptureNavState, VideoState } from './presentation';
import type { QuizSyncState } from './quiz';
import type { SeferReaderState } from '../hooks/useSeferReader';
import type {
  AudienceAccessDecisionMessage,
  AudienceAccessRequestMessage,
  AudienceAccessStateMessage,
  SessionAccessPolicyMessage,
} from './audienceAccess';

export const SYNC_PROTOCOL_VERSION = 1;

export interface SyncProtocolMeta {
  protocolVersion?: typeof SYNC_PROTOCOL_VERSION;
  timestamp?: number;
  messageId?: string;
}

export interface DisplayTelemetryState {
  backgroundLock: boolean;
  lockedBackgroundValue: string | null;
  userSelectedBackground: string | null;
}

export interface AutoduckState {
  enabled: boolean;
  factor: number;
}

export interface AudiencePublicState {
  presentation: Presentation | null;
  slideIndex: number;
  stepIndex: number;
  backgroundLock: boolean;
  lockedBackgroundValue: string | null;
  userSelectedBackground: string | null;
  videoState: VideoState | null;
  appMode: AppMode;
  scriptureState: ScriptureNavState | null;
  audioState: AudioState;
  quizState: QuizSyncState | null;
  autoduckState: AutoduckState;
  updatedAt: number;
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
  stepIndex?: number;
  autoduckState?: AutoduckState;
}

export type RemoteCommandPayload =
  | { command: 'SELECT_STEP'; stepIndex: number }
  | { command: 'SELECT_PRESENTATION_AND_SLIDE'; presentation: Presentation | null; slideIndex: number; direction?: 'forward' | 'backward'; targetVerse?: string }
  | { command: 'TOGGLE_APP_MODE'; mode: AppMode }
  | { command: 'TOGGLE_BG_LOCK'; locked: boolean }
  | { command: 'SELECT_BG_OVERRIDE'; bg: string | null }
  | { command: 'QUIZ_START_TIMER' }
  | { command: 'QUIZ_PAUSE_TIMER' }
  | { command: 'QUIZ_RESUME_TIMER' }
  | { command: 'QUIZ_RESET_TIMER' }
  | { command: 'QUIZ_ADJUST_TIMER'; seconds: number }
  | { command: 'QUIZ_COMPLETE' }
  | { command: 'QUIZ_RECALCULATE_RESULTS'; slideIds: string[] }
  | { command: 'QUIZ_CLEAR_QUESTION_RESULTS'; slideId: string }
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
  | { command: 'SET_AUTODUCK_STATE'; state: AutoduckState }
  | { command: 'RESET_STATE'; clearSession?: boolean };

export type BroadcastMessage =
  | ({ type: 'SYNC_STATE' } & SyncStatePayload & SyncProtocolMeta)
  | ({ type: 'AUDIO_TELEMETRY'; clientId: string; origin: 'control' | 'presenter'; audioState: AudioState } & SyncProtocolMeta)
  | ({ type: 'VIDEO_TELEMETRY'; clientId: string; origin: 'control' | 'presenter'; videoState: VideoState | null } & SyncProtocolMeta)
  | ({ type: 'DISPLAY_TELEMETRY'; clientId: string; origin: 'control' | 'presenter' } & DisplayTelemetryState & SyncProtocolMeta)
  | ({ type: 'AUDIO_SYNC_MAPS_UPDATE'; maps: unknown[] } & SyncProtocolMeta)
  | ({ type: 'REQUEST_STATE'; clientId?: string } & SyncProtocolMeta)
  | ({ type: 'REMOTE_COMMAND'; clientId: string; payload: RemoteCommandPayload } & SyncProtocolMeta)
  | ({ type: 'WELCOME'; clientId: string; serverTimeMs: number; role?: 'presenter' | 'control' | 'audience' | 'unknown'; presentationSessionId?: string; controlSessionId?: string; controlState?: LiveAudioControlState; controlResumeCredential?: string } & SyncProtocolMeta)
  | ({ type: 'PRESENTATION_SESSION_ROTATED'; presentationSessionId: string } & SyncProtocolMeta)
  | ({ type: 'SERVER_TIME_PING'; clientSentAtMs: number } & SyncProtocolMeta)
  | ({ type: 'SERVER_TIME_PONG'; clientSentAtMs: number; serverTimeMs: number } & SyncProtocolMeta)
  | ({ type: 'AUDIO_TIMELINE_ACTION'; action: AudioTimelineAction } & SyncProtocolMeta)
  | ({ type: 'AUDIO_TIMELINE_STATE'; timeline: AudioTimelineState } & SyncProtocolMeta)
  | ({ type: 'AUDIO_PRESENTATION_CLOCK'; timelineId: string; estimatedPositionSec: number; serverTimeMs: number } & SyncProtocolMeta)
  | ({ type: 'AUDIENCE_STATE_UPDATE'; state: AudiencePublicState } & SyncProtocolMeta)
  | (LiveAudioBroadcastMessage & SyncProtocolMeta)
  | ((AudienceAccessStateMessage | AudienceAccessRequestMessage | AudienceAccessDecisionMessage | SessionAccessPolicyMessage) & SyncProtocolMeta)
  | ({ type: 'ERROR'; code: string; message: string } & SyncProtocolMeta);
