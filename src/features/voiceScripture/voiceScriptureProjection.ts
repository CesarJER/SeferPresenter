import type { SeferReaderState, VerseData } from '../../types/scripture';
import type { ScriptureNavState } from '../../types/presentation';
import { loadBookData, type AppMetadata } from '../../utils/metadataCache';
import { parseVerses } from '../../utils/scriptureParser';
import type { VoiceScriptureCandidate } from './voiceScriptureParser';
export const makeContext = (state: ScriptureNavState | null) => state ? {
  book: state.bookAbbrevEs || state.bookEs,
  chapter: Number(state.chapter),
  verse: Number(state.verse),
  verseStart: state.verseStart ? Number(state.verseStart) : undefined,
  verseEnd: state.verseEnd ? Number(state.verseEnd) : undefined,
} : null;

export const hydrateCandidate = async (candidate: VoiceScriptureCandidate, signal?: AbortSignal): Promise<SeferReaderState | null> => {
  // Cancel this consumer, not the shared metadata cache used by other screens.
  const verses = await new Promise<VerseData[]>((resolve, reject) => {
    const finish = (data?: VerseData[], error?: unknown) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(data!);
    };
    const abort = () => finish(undefined, new DOMException('Projection cancelled', 'AbortError'));
    const timeout = setTimeout(() => finish(undefined, new Error('Book load timeout')), 3_000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    Promise.resolve().then(() => loadBookData(candidate.book, parseVerses)).then(
      (data) => finish(data as VerseData[]), (error: unknown) => finish(undefined, error),
    );
  });
  const startIndex = verses.findIndex((verse) => (
    verse.chapter === String(candidate.chapter) && verse.verse === String(candidate.verseStart)
  ));
  if (startIndex < 0) return null;
  const endIndex = verses.findIndex((verse) => verse.chapter === String(candidate.chapter) && verse.verse === String(candidate.verseEnd));
  if (endIndex < startIndex || endIndex - startIndex !== candidate.verseEnd - candidate.verseStart) return null;
  if (verses.slice(startIndex, endIndex + 1).some((verse, index) => verse.chapter !== String(candidate.chapter)
    || Number(verse.verse) !== candidate.verseStart + index)) return null;
  const activeIndex = verses.findIndex((verse) => verse.chapter === String(candidate.chapter) && verse.verse === String(candidate.verse));
  if (activeIndex < startIndex || activeIndex > endIndex) return null;
  const active = verses[activeIndex];
  const rangeLength = candidate.verseEnd - candidate.verseStart + 1;
  return {
    bookEs: active.bookEs,
    bookHeb: active.bookHeb,
    bookAbbrevEs: active.bookAbbrevEs,
    chapter: String(candidate.chapter),
    verseStart: String(candidate.verseStart),
    verse: String(candidate.verse),
    verseEnd: candidate.verseEnd > candidate.verseStart ? String(candidate.verseEnd) : undefined,
    verseNikud: active.verseNikudSanitized ?? active.verseNikud,
    verseNikudSanitized: active.verseNikudSanitized,
    transliteration: active.transliteration,
    translation: active.translation,
    verseIdx: rangeLength > 1 ? (candidate.verse - candidate.verseStart) : startIndex,
    totalVerses: rangeLength > 1 ? rangeLength : verses.length,
    scriptureKind: 'sefer',
  };
};

export const candidateLabel = (candidate: VoiceScriptureCandidate) => {
  const range = candidate.verseEnd === candidate.verseStart
    ? candidate.verseStart
    : `${candidate.verseStart}-${candidate.verseEnd}`;
  if (candidate.verseEnd !== candidate.verseStart && candidate.verse !== candidate.verseStart) {
    return `${candidate.bookAbbrev} ${candidate.chapter}:${range} (${candidate.verse})`;
  }
  return `${candidate.bookAbbrev} ${candidate.chapter}:${range}`;
};

const CONTEXTUAL_PHRASES = [
  'capítulo', 'versículo', 'siguiente versículo', 'versículo anterior',
  'siguiente capítulo', 'capítulo anterior', 'ahora el', 'volvamos al', 'continúa hasta',
  'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
  'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
  'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa', 'cien', 'ciento'
];

export const makeSpeechContextPhrases = (metadata: AppMetadata) => {
  const entries = Object.entries(metadata);
  return [...new Set([
    ...CONTEXTUAL_PHRASES,
    ...entries.flatMap(([book]) => [book]),
    ...entries.flatMap(([, details]) => details.voiceAliases ?? []),
  ].map((phrase) => phrase.trim()).filter((phrase) => phrase.length > 0 && phrase.length <= 80))].slice(0, 256);
};


