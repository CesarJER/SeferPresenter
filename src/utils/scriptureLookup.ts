import { translate } from '../i18n/runtime';
import type { Slide } from '../types/presentation';
import { parseCitaRef } from './quizUtils';
import { getMetadata, loadBookData, resolveBookName, type AppMetadata } from './metadataCache';
import { parseVerses } from './scriptureParser';

export interface ScriptureVerse {
  bookEs: string;
  bookAbbrevEs: string;
  bookHeb: string;
  chapter: string;
  verse: string;
  verseNikud: string;
  verseNikudSanitized?: string;
  verseNikudCleanSanitized?: string;
  transliteration: string;
  translation: string;
}

export type ScriptureSlideKind = 'tanaj' | 'sefer';

export interface ScriptureTagSpec {
  kind: ScriptureSlideKind;
  bookToken: string;
  chapter: string;
  verseStart: string;
  verseEnd?: string;
}

export interface ScriptureSlideDraft {
  id: string;
  label: string;
  lines: string[];
  type: ScriptureSlideKind;
  scriptureBook: string;
  scriptureChapter: string;
  scriptureVerseStart: string;
  scriptureVerseEnd?: string;
}

export interface ScriptureAuditIssue {
  location: string;
  message: string;
}

const formatAvailableNumbers = (values: string[]) => {
  const numeric = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (numeric.length === 0) return 'ninguno';
  if (numeric.length === 1) return String(numeric[0]);
  return `${numeric[0]}-${numeric[numeric.length - 1]}`;
};

export const validateScriptureSpec = (
  spec: ScriptureTagSpec,
  metadata: AppMetadata,
): string | null => {
  const bookName = resolveBookName(spec.bookToken, metadata);
  if (!bookName) {
    return `El libro "${spec.bookToken}" no existe en la biblioteca.`;
  }

  const chapterVerses = metadata[bookName]?.chapters[String(spec.chapter)];
  if (!chapterVerses) {
    const availableChapters = Object.keys(metadata[bookName]?.chapters ?? {});
    return `El libro "${bookName}" no tiene el capítulo ${spec.chapter}. Capítulos disponibles: ${formatAvailableNumbers(availableChapters)}.`;
  }

  const start = Number(spec.verseStart);
  const end = Number(spec.verseEnd ?? spec.verseStart);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
    return `El rango ${spec.verseStart}${spec.verseEnd ? `-${spec.verseEnd}` : ''} debe contener números de versículo enteros y positivos.`;
  }
  if (end < start) {
    return `El rango ${start}-${end} está invertido; el versículo final debe ser igual o posterior al inicial.`;
  }

  const available = new Set(chapterVerses.map(String));
  const missing: number[] = [];
  let truncated = false;
  for (let verse = start; verse <= end; verse += 1) {
    if (!available.has(String(verse))) missing.push(verse);
    if (missing.length >= 10) {
      truncated = verse < end;
      break;
    }
  }
  if (missing.length > 0) {
    const suffix = truncated ? ' (y más)' : '';
    return `La cita ${bookName} ${spec.chapter}:${start}${end !== start ? `-${end}` : ''} contiene versículos inexistentes: ${missing.join(', ')}${suffix}. Versículos disponibles en el capítulo: ${formatAvailableNumbers(chapterVerses)}.`;
  }

  return null;
};

const auditParsedSpec = (
  spec: ScriptureTagSpec,
  metadata: AppMetadata,
  location: string,
): ScriptureAuditIssue | null => {
  const message = validateScriptureSpec(spec, metadata);
  return message ? { location, message } : null;
};

export const auditQuickScriptureReferences = async (
  text: string,
  suppliedMetadata?: AppMetadata,
): Promise<ScriptureAuditIssue[]> => {
  const metadata = suppliedMetadata ?? await getMetadata();
  const issues: ScriptureAuditIssue[] = [];

  text.split('\n').forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const location = `Línea ${index + 1}`;

    if (/^\[(?:Tanaj|Sefer)\b/i.test(line)) {
      const spec = parseScriptureTag(line);
      if (!spec) {
        issues.push({
          location,
          message: translate("common:diagnostic.referenceValue1DoesNotFollowSeferBookChapterVerseOrTanajBook", "La referencia \"{{value1}}\" no tiene el formato [Sefer Libro capítulo:versículo] o [Tanaj Libro capítulo:inicio-fin].", { value1: line }),
        });
        return;
      }
      const issue = auditParsedSpec(spec, metadata, location);
      if (issue) issues.push(issue);
      return;
    }

    const citationMatch = line.match(/^CITA(!?):\s*(.*)$/i);
    if (!citationMatch) return;
    const citation = citationMatch[2].trim();
    const parsed = parseCitaRef(citation);
    if (!parsed) {
      issues.push({
        location,
        message: translate("common:diagnostic.referenceValue1Value2DoesNotFollowBookChapterVerseOrBookChapter", "La referencia {{value1}} \"{{value2}}\" no tiene el formato Libro capítulo:versículo o Libro capítulo:inicio-fin.", { value1: citationMatch[1] ? 'CITA!' : 'CITA', value2: citation || '(vacía)' }),
      });
      return;
    }
    const issue = auditParsedSpec({ kind: 'sefer', ...parsed }, metadata, location);
    if (issue) issues.push(issue);
  });

  return issues;
};

export const auditSlideScriptureReferences = async (
  slides: Slide[],
  suppliedMetadata?: AppMetadata,
): Promise<ScriptureAuditIssue[]> => {
  const metadata = suppliedMetadata ?? await getMetadata();
  const issues: ScriptureAuditIssue[] = [];

  slides.forEach((slide, index) => {
    const location = `Diapositiva ${index + 1} (${slide.label || 'sin etiqueta'})`;
    if (slide.type === 'quiz' && slide.quizData) {
      const citations = [
        ['CITA', slide.quizData.citaRef],
        ['CITA!', slide.quizData.citaReviewRef],
      ] as const;
      citations.forEach(([kind, citation]) => {
        if (!citation) return;
        const parsed = parseCitaRef(citation);
        if (!parsed) {
          issues.push({ location, message: translate("common:diagnostic.value1Value2DoesNotHaveARecognizableFormat", "{{value1}} \"{{value2}}\" no tiene un formato reconocible.", { value1: kind, value2: citation }) });
          return;
        }
        const issue = auditParsedSpec({ kind: 'sefer', ...parsed }, metadata, `${location}, ${kind}`);
        if (issue) issues.push(issue);
      });
    }

    if (slide.type !== 'sefer' && slide.type !== 'tanaj') return;
    if (!slide.scriptureBook || !slide.scriptureChapter || !slide.scriptureVerseStart) {
      issues.push({
        location,
        message: translate("common:diagnostic.theSacredTextSlideIsMissingACompleteBookChapterAndFirst", "La diapositiva de texto sagrado no tiene libro, capítulo y versículo inicial completos."),
      });
      return;
    }
    const issue = auditParsedSpec({
      kind: slide.type,
      bookToken: slide.scriptureBook,
      chapter: slide.scriptureChapter,
      verseStart: slide.scriptureVerseStart,
      verseEnd: slide.scriptureVerseEnd,
    }, metadata, location);
    if (issue) issues.push(issue);
  });

  return issues;
};

const loadBook = async (bookToken: string) => {
  const metadata = await getMetadata();
  const bookName = resolveBookName(bookToken, metadata);
  if (!bookName) throw new Error(`Libro no encontrado: ${bookToken}`);

  return loadBookData(bookName, (text) =>
    parseVerses(text).filter((row) => row.bookEs && row.chapter && row.verse)
  );
};

export const findScriptureRange = async (
  bookToken: string,
  chapter: string,
  verseStart: string,
  verseEnd?: string
) => {
  const book = await loadBook(bookToken);
  const start = Number(verseStart);
  const end = Number(verseEnd || verseStart);

  return book.filter((row) => {
    if (row.chapter !== String(chapter)) return false;
    const verse = Number(row.verse);
    return verse >= start && verse <= end;
  });
};

export const getScriptureChapterVerses = async (bookToken: string, chapter: string) => {
  const book = await loadBook(bookToken);
  return book.filter((row) => row.chapter === String(chapter));
};

export const scriptureVerseToLines = (verse: ScriptureVerse) => [
  verse.verseNikud,
  verse.transliteration,
  verse.translation,
];

export const parseScriptureTag = (text: string): ScriptureTagSpec | null => {
  const clean = text.trim();
  const match = clean.match(/^\[(Tanaj|Sefer)\s+(.+?)\s+(\d+):(\d+)(?:-(\d+))?\]$/i);
  if (!match) return null;

  const kind = match[1].toLowerCase() === 'sefer' ? 'sefer' : 'tanaj';
  const bookToken = match[2].trim();
  const chapter = match[3];
  const verseStart = match[4];
  const verseEnd = match[5];

  return {
    kind,
    bookToken,
    chapter,
    verseStart,
    verseEnd: verseEnd && verseEnd !== verseStart ? verseEnd : undefined,
  };
};

export const scriptureTagToText = (spec: ScriptureTagSpec) => {
  const range = spec.verseEnd ? `${spec.verseStart}-${spec.verseEnd}` : spec.verseStart;
  return `[${spec.kind === 'sefer' ? 'Sefer' : 'Tanaj'} ${spec.bookToken} ${spec.chapter}:${range}]`;
};

export const scriptureSlideToTag = (slide: {
  type?: string;
  scriptureBook?: string;
  scriptureChapter?: string;
  scriptureVerseStart?: string;
  scriptureVerseEnd?: string;
}) => {
  if (!slide.scriptureBook || !slide.scriptureChapter || !slide.scriptureVerseStart) return null;

  const kind = slide.type === 'sefer' || slide.type === 'scripture' ? 'sefer' : 'tanaj';
  return scriptureTagToText({
    kind,
    bookToken: slide.scriptureBook,
    chapter: slide.scriptureChapter,
    verseStart: slide.scriptureVerseStart,
    verseEnd: slide.scriptureVerseEnd && slide.scriptureVerseEnd !== slide.scriptureVerseStart
      ? slide.scriptureVerseEnd
      : undefined,
  });
};

export const materializeScriptureSlides = async (spec: ScriptureTagSpec): Promise<ScriptureSlideDraft[]> => {
  const verses = await findScriptureRange(spec.bookToken, spec.chapter, spec.verseStart, spec.verseEnd);
  if (verses.length === 0) return [];

  const baseLabel = `${spec.bookToken} ${spec.chapter}:${spec.verseStart}${spec.verseEnd ? `-${spec.verseEnd}` : ''}`;
  const randomSuffix = Math.random().toString(36).substring(2, 9);
  const cleanRange = `${spec.bookToken}-${spec.chapter}-${spec.verseStart}${spec.verseEnd ? `-${spec.verseEnd}` : ''}`;

  const first = verses[0];
  return [{
    id: `slide-scripture-${cleanRange}-${Date.now()}-${randomSuffix}-${spec.kind}`,
    label: baseLabel,
    lines: scriptureVerseToLines(first),
    type: spec.kind,
    scriptureBook: first.bookAbbrevEs || spec.bookToken,
    scriptureChapter: first.chapter,
    scriptureVerseStart: spec.verseStart,
    scriptureVerseEnd: spec.verseEnd ?? spec.verseStart,
  }];
};

export const expandScriptureRangeToSlides = async (spec: ScriptureTagSpec): Promise<ScriptureSlideDraft[]> => {
  const verses = await findScriptureRange(spec.bookToken, spec.chapter, spec.verseStart, spec.verseEnd);
  if (verses.length === 0) return [];

  const titleLabel = `${spec.bookToken} ${spec.chapter}:${spec.verseEnd ? `${spec.verseStart}-${spec.verseEnd}` : spec.verseStart}`;
  const randomSuffix = Math.random().toString(36).substring(2, 9);
  const cleanRange = `${spec.bookToken}-${spec.chapter}-${spec.verseStart}${spec.verseEnd ? `-${spec.verseEnd}` : ''}`;

  const titleSlide: ScriptureSlideDraft = {
    id: `slide-scripture-title-${cleanRange}-${Date.now()}-${randomSuffix}`,
    label: titleLabel,
    lines: [titleLabel, '-', '-'],
    type: spec.kind,
    scriptureBook: verses[0].bookAbbrevEs || spec.bookToken,
    scriptureChapter: spec.chapter,
    scriptureVerseStart: spec.verseStart,
    scriptureVerseEnd: spec.verseEnd ?? spec.verseStart,
  };

  const verseSlides = verses.map((verse, idx) => {
    const verseRandomSuffix = Math.random().toString(36).substring(2, 9);
    return {
      id: `slide-scripture-${spec.bookToken}-${spec.chapter}-${verse.verse}-${idx}-${Date.now()}-${verseRandomSuffix}-${spec.kind}`,
      label: verse.verse,
      lines: scriptureVerseToLines(verse),
      type: spec.kind,
      scriptureBook: verse.bookAbbrevEs || spec.bookToken,
      scriptureChapter: verse.chapter,
      scriptureVerseStart: verse.verse,
      scriptureVerseEnd: verse.verse,
    };
  });

  return [titleSlide, ...verseSlides];
};
