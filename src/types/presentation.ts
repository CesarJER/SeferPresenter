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
  slides: Slide[];
}

export interface Slide {
  id: string;
  label: string;
  lines: string[];
  background?: string;
  type?: 'text' | 'video' | 'tanaj' | 'sefer';
  videoSrc?: string;
  videoVolume?: number;
  videoSpeed?: number;
  videoLoop?: boolean;
  videoPresenterNav?: boolean;
  videoStart?: number;
  videoEnd?: number;
  scriptureBook?: string;
  scriptureChapter?: string;
  scriptureVerseStart?: string;
  scriptureVerseEnd?: string;
  scriptureVerseBackgrounds?: Record<string, string>;
}

export interface VideoState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  speed: number;
  loop?: boolean;
  videoSrc: string | null;
  startTime?: number;
  endTime?: number;
  lastUpdatedBy: 'controller' | 'projection';
  timestamp: number;
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