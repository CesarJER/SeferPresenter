/**
 * Quiz Mode — Runtime Types
 *
 * These types describe the live, ephemeral state of a quiz session.
 * They are NOT persisted in presentations.json.
 * The data model types (QuizData, QuizOption, etc.) live in presentation.ts.
 */

import type { QuizOptionId } from './presentation';
export type { QuizOptionId } from './presentation';

// ── Timer ────────────────────────────────────────────────────────────────────

export type QuizTimerStatus = 'idle' | 'running' | 'paused' | 'expired' | 'completed';

/**
 * Timer state designed for future online synchronization.
 * Remaining time is always derived from (timerStartedAt + timerDurationMs - Date.now()),
 * never stored directly — avoiding per-second global state updates.
 */
export interface QuizTimerState {
  status: QuizTimerStatus;
  /** Date.now() when the timer was last started/resumed */
  timerStartedAt: number | null;
  /** Total timer duration in milliseconds */
  timerDurationMs: number;
  /** Remaining ms when paused — used to resume correctly */
  pausedRemainingMs: number | null;
}

export const DEFAULT_QUIZ_TIMER_STATE: QuizTimerState = {
  status: 'idle',
  timerStartedAt: null,
  timerDurationMs: 30_000,
  pausedRemainingMs: null,
};

// ── Subslides ────────────────────────────────────────────────────────────────

/**
 * Internal subslide phases of a single quiz question.
 * 'cita-verse' is repeated for each verse in the citation range.
 */
export type QuizSubslide = {
  kind: 'lectura' | 'pregunta' | 'respuesta' | 'results';
  label: string;
} | {
  kind: 'cita-verse';
  label: string;
  verse: string;
  verseStart: string;
  verseEnd: string;
  bookToken: string;
  chapter: string;
};

// ── Audience Answers ─────────────────────────────────────────────────────────

/** Answer submitted (or being drafted) by an audience member for one quiz slide */
export interface QuizAudienceAnswer {
  slideId: string;
  /** Selected option IDs (1 for radio, N for checkbox) */
  selectedOptionIds: QuizOptionId[];
  /** Citation identified by the audience (for CITA: questions) */
  citaBook?: string;
  citaChapter?: string;
  citaVerseStart?: string;
  citaVerseEnd?: string;
  /** Whether the answer has been finalized (manual or auto on timer expire) */
  submitted: boolean;
  submittedAt: number | null;
  /** Whether the audience member self-reported careful reading (bonus) */
  bonusReadingClaimed: boolean;
}

export const makeEmptyAudienceAnswer = (slideId: string): QuizAudienceAnswer => ({
  slideId,
  selectedOptionIds: [],
  submitted: false,
  submittedAt: null,
  bonusReadingClaimed: false,
});

// ── Audience Session ─────────────────────────────────────────────────────────

/**
 * Full quiz session for one audience member.
 * Keyed by slideId in the answers map.
 */
export interface QuizAudienceSession {
  /** Random UUID generated on first interaction */
  sessionId: string;
  /** Optional display name */
  displayName?: string;
  /** answers keyed by slide.id */
  answers: Record<string, QuizAudienceAnswer>;
}

// ── Presenter Demo ────────────────────────────────────────────────────────────

/**
 * Presenter/controller demo selection — used for public correction display.
 * Intentionally kept SEPARATE from audience answers to avoid contamination.
 */
export interface QuizPresenterDemo {
  slideId: string;
  /** Option selected by presenter for demo/correction after timer expires */
  selectedOptionId: QuizOptionId | null;
}

// ── Score Results ─────────────────────────────────────────────────────────────

/** Score for a single quiz question, in centipunts to avoid floating-point errors */
export interface QuizQuestionScore {
  slideId: string;
  /** 50 if option correct, 0 otherwise */
  optionCentipunts: number;
  /** 50 if cita correct (CITA:), 0 if no cita or CITA!: */
  citaCentipunts: number;
  /** 25 if bonus reading claimed, 0 otherwise */
  bonusCentipunts: number;
  totalCentipunts: number;
}

/** Accumulated score across all quiz slides */
export interface QuizTotalScore {
  totalCentipunts: number;
  maxBaseCentipunts: number;
  /** Per-question breakdown */
  questions: QuizQuestionScore[];
}

// ── Controller Aggregate ──────────────────────────────────────────────────────

/**
 * Aggregated answer stats for the controller's results panel.
 * One entry per result profile rank.
 */
export interface QuizRangeStats {
  rank: number;
  title: string;
  count: number;
  sessionIds: string[];
}

// ── Sync extension (preparatory, optional) ───────────────────────────────────

/**
 * Quiz-specific sync payload — extends SyncStatePayload optionally.
 * Currently used for controller-driven navigation of subslides and timer.
 * Audience answer sync is handled via a separate channel/endpoint.
 */
export interface QuizSyncState {
  /** Current subslide index being displayed */
  currentSubslideIndex: number;
  timerState: QuizTimerState;
  /** Presenter demo selection (for public correction display) */
  presenterDemoSelection: Record<string, QuizOptionId | null>;
  /** Maximum base score for the entire quiz */
  maxBaseCentipunts?: number;
  /** Ephemeral feedback sound trigger */
  feedbackSound?: {
    type: 'applause' | 'mal' | 'bip';
    timestamp: number;
  } | null;
}

