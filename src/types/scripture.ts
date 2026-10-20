export interface VerseData {
  bookEs: string;
  bookAbbrevEs: string;
  bookHeb: string;
  chapter: string;
  verse: string;
  verseNikud: string;
  verseNikudClean?: string;
  verseNikudSanitized?: string;
  verseNikudCleanSanitized?: string;
  transliteration: string;
  translation: string;
  DIR?: string;
}

export interface SeferReaderState {
  bookEs: string;
  bookHeb: string;
  bookAbbrevEs: string;
  chapter: string;
  verseStart?: string;
  verse: string;
  verseEnd?: string;
  verseNikud: string;
  verseNikudSanitized?: string;
  transliteration: string;
  translation: string;
  verseIdx: number;       // index in loaded book data
  totalVerses: number;    // total verses in loaded book
  scriptureKind?: 'tanaj' | 'sefer';
}
