export type SeferOnlineRefPayload = {
  book?: string;
  chapter?: number | string;
  verseStart?: number | string;
  verse?: number | string;
  verseEnd?: number | string;
  bookEs?: string;
  bookHeb?: string;
  bookAbbrevEs?: string;
  verseNikud?: string;
  transliteration?: string;
  translation?: string;
  verseIdx?: number;
  totalVerses?: number;
  scriptureKind?: 'tanaj' | 'sefer';
};

export interface Presentation {
  id: string;
  title: string;
  background: string;
  mode: 'standard' | 'trilingual';
  fontScale?: number;
  tags?: string[];
  slides: Slide[];
}

// ── Quiz types ──────────────────────────────────────────────────────────────

/** Stable option ID — never changes across renders/shuffles */
export type QuizOptionId = 'A' | 'B' | 'C' | 'D';

export interface QuizOption {
  /** Stable ID — used as key for correctness evaluation, never positional */
  id: QuizOptionId;
  text: string;
  isCorrect: boolean;
}

export interface QuizResultProfile {
  /** Rank 1 = best result, higher number = lower */
  rank: number;
  title: string;
  description: string;
  /** Biblical gift text displayed in the audience diploma */
  giftText: string;
  // color?: string; // reserved for future customization
}

export interface QuizData {
  question: string;
  options: QuizOption[];            // 2–4 options, IDs A–D
  timerSeconds: number;             // default 30
  randomize: boolean;               // stable shuffle per slide.id seed
  multiSelect: boolean;             // false=radio (any correct), true=checkbox (exact set)
  /**
   * CITA: — evaluable citation. Audience must identify it.
   * Contributes +0.5 pts. Format: "Dn 1:8" or "Dn 1:1-4"
   */
  citaRef?: string;
  /**
   * CITA!: — review-only citation, NOT evaluated.
   * Shown as reading material. Contributes 0 pts.
   */
  citaReviewRef?: string;
  /**
   * Result profiles for the results slide (R1–R9).
   * Present only on slides that act as results aggregators.
   * Ranges are auto-calculated from quiz slides in the presentation.
   */
  resultProfiles?: QuizResultProfile[];
  /**
   * If true, this slide is a results aggregator — no question is asked.
   * It shows the leaderboard/diploma based on accumulated scores.
   */
  isResultsSlide?: boolean;
}

// ── Slide & Presentation ────────────────────────────────────────────────────

export interface Slide {
  id: string;
  label: string;
  lines: string[];
  background?: string;
  type?: 'text' | 'media' | 'tanaj' | 'sefer' | 'quiz';
  mediaSrc?: string;
  mediaFit?: 'cover' | 'contain' | 'fill';
  mediaShowBg?: boolean;
  mediaVolume?: number;
  mediaSpeed?: number;
  mediaLoop?: boolean;
  mediaPresenterNav?: boolean;
  mediaStart?: number;
  mediaEnd?: number;
  scriptureBook?: string;
  scriptureChapter?: string;
  scriptureVerseStart?: string;
  scriptureVerseEnd?: string;
  scriptureVerses?: string[][];
  scriptureVerseBackgrounds?: Record<string, string>;
  /** Present only when type === 'quiz' */
  quizData?: QuizData;
}

export interface VideoState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  speed: number;
  loop?: boolean;
  mediaSrc: string | null;
  startTime?: number;
  endTime?: number;
  lastUpdatedBy: 'controller' | 'projection';
  timestamp: number;
  seekId?: number;
}

export interface ScriptureNavState {
  bookEs: string;
  bookHeb: string;
  bookAbbrevEs: string;
  chapter: string;
  verseStart: string;
  verse: string;
  verseEnd?: string;
  verseNikud: string;
  transliteration: string;
  translation: string;
  verseIdx: number;
  totalVerses: number;
  scriptureKind?: 'tanaj' | 'sefer';
  command?: 'navigate' | 'next' | 'previous';
  commandId?: number;
  hebrewFontSize?: number;
  combinedTextBaseSize?: number;
}

export type AppMode = 'slides' | 'scripture' | 'seferManual';

export type PresentationStep =
  | { type: 'normal'; slideIndex: number }
  | { type: 'quiz'; slideIndex: number; subslideIndex: number }
  | { type: 'scripture'; slideIndex: number; book: string; chapter: string; verse: string };