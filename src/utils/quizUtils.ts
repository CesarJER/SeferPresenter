import { translate } from '../i18n/runtime';
/**
 * Quiz Utilities - Pure Functions
 *
 * All functions here are pure and do not import React.
 */

import type { QuizData, QuizOption, QuizOptionId, QuizResultProfile } from '../types/presentation';
import type {
  QuizAudienceAnswer,
  QuizQuestionScore,
  QuizSubslide,
  QuizTimerState,
  QuizTotalScore,
} from '../types/quiz';

export interface QuizParseError {
  line: number;
  message: string;
}

export interface QuizParseWarning {
  line: number;
  message: string;
}

export interface QuizParseSuccess {
  ok: true;
  data: QuizData;
  warnings: QuizParseWarning[];
}

export interface QuizParseFailure {
  ok: false;
  errors: QuizParseError[];
  warnings: QuizParseWarning[];
}

export type QuizParseResult = QuizParseSuccess | QuizParseFailure;

const QUIZ_OPTION_IDS: QuizOptionId[] = ['A', 'B', 'C', 'D'];

export interface CitaParsed {
  bookToken: string;
  chapter: string;
  verseStart: string;
  verseEnd?: string;
}

export function parseCitaRef(citaRef: string): CitaParsed | null {
  const clean = citaRef.trim().replace(/^\[(?:Tanaj|Sefer)\s+/i, '').replace(/\]$/, '');
  const match = clean.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  return {
    bookToken: match[1].trim(),
    chapter: match[2],
    verseStart: match[3],
    verseEnd: match[4],
  };
}

/**
 * Parse a quick-edit quiz block.
 *
 * Canonical format:
 * P: Question text [30, 1, 0]
 *
 * The config block is optional. Defaults are [30, 0, 0].
 */
export function parseQuizBlock(text: string): QuizParseResult {
  const rawLines = text.split('\n');
  const errors: QuizParseError[] = [];
  const warnings: QuizParseWarning[] = [];

  let questionLine = -1;
  let question = '';
  let timerSeconds = 30;
  let randomize = false;
  let multiSelect = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;
    if (!line.toUpperCase().startsWith('P:')) continue;

    questionLine = i;
    const rest = line.slice(2).trim();
    const configMatch = rest.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);

    if (rest.startsWith('[')) {
      errors.push({ line: i, message: translate("common:diagnostic.quizSettingsMustFollowTheQuestionPQuestionSecondsRandomMulti", "La configuracion del quiz debe ir al final de la pregunta: P: Pregunta [seg, aleatorio, multi].") });
      question = '';
    } else if (configMatch) {
      question = configMatch[1].trim();
      const parts = configMatch[2].split(',').map(p => p.trim());

      if (parts.length !== 3) {
        errors.push({ line: i, message: translate("common:diagnostic.thePSecondsRandomMultiSettingsBlockMustContainExactly3Parameters", "El bloque de configuracion P: [seg, aleatorio, multi] debe tener exactamente 3 parametros.") });
      } else {
        if (!/^\d+$/.test(parts[0])) {
          errors.push({ line: i, message: translate("common:diagnostic.invalidTimeValue1MustBeAnInteger1", "Tiempo invalido: \"{{value1}}\". Debe ser un numero entero >= 1.", { value1: parts[0] }) });
        } else {
          const secs = Number(parts[0]);
          if (secs < 1) {
            errors.push({ line: i, message: translate("common:diagnostic.invalidTimeValue1MustBeAnInteger1", "Tiempo invalido: \"{{value1}}\". Debe ser un numero entero >= 1.", { value1: parts[0] }) });
          } else {
            timerSeconds = secs;
          }
        }

        if (parts[1] !== '0' && parts[1] !== '1') {
          errors.push({ line: i, message: translate("common:diagnostic.invalidRandomValueValue1MustBe0Or1", "Valor aleatorio invalido: \"{{value1}}\". Debe ser 0 o 1.", { value1: parts[1] }) });
        } else {
          randomize = parts[1] === '1';
        }

        if (parts[2] !== '0' && parts[2] !== '1') {
          errors.push({ line: i, message: translate("common:diagnostic.invalidMultiValueValue1MustBe0Or1", "Valor multi invalido: \"{{value1}}\". Debe ser 0 o 1.", { value1: parts[2] }) });
        } else {
          multiSelect = parts[2] === '1';
        }
      }
    } else {
      question = rest;
    }
    break;
  }

  if (questionLine === -1) {
    return { ok: false, errors: [{ line: 0, message: translate("common:diagnostic.theBlockDoesNotStartWithPItIsNotAQuiz", "El bloque no empieza con \"P:\". No es un quiz.") }], warnings };
  }

  if (!question) {
    errors.push({ line: questionLine, message: translate("common:diagnostic.thePQuestionIsEmpty", "La pregunta P: esta vacia.") });
  }

  const options: QuizOption[] = [];
  let citaRef: string | undefined;
  let citaReviewRef: string | undefined;
  const seenIds = new Set<string>();

  for (let i = questionLine + 1; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    const optionMatch = line.match(/^([A-Da-d])(\**):\s*([\s\S]*)$/);
    if (optionMatch) {
      const rawId = optionMatch[1].toUpperCase() as QuizOptionId;
      const isCorrect = optionMatch[2].length > 0;
      const optText = optionMatch[3].trim();

      if (!QUIZ_OPTION_IDS.includes(rawId)) {
        errors.push({ line: i, message: translate("common:diagnostic.invalidOptionIdValue1OnlyABCDAreAllowed", "ID de opcion invalido: \"{{value1}}\". Solo se permiten A, B, C, D.", { value1: rawId }) });
        continue;
      }
      if (seenIds.has(rawId)) {
        errors.push({ line: i, message: translate("common:diagnostic.duplicateOptionValue1", "Opcion \"{{value1}}\" duplicada.", { value1: rawId }) });
        continue;
      }

      seenIds.add(rawId);
      options.push({ id: rawId, text: optText, isCorrect });
      continue;
    }

    const citaEvalMatch = line.match(/^CITA:\s*([\s\S]+)$/i);
    if (citaEvalMatch) {
      if (citaReviewRef) {
        errors.push({ line: i, message: translate("common:diagnostic.citaAndCitaCannotBeUsedTogether", "No se puede tener CITA: y CITA!: a la vez.") });
      } else {
        citaRef = citaEvalMatch[1].trim();
        if (!parseCitaRef(citaRef)) {
          warnings.push({ line: i, message: translate("common:diagnostic.couldNotInterpretCitaReferenceValue1", "La referencia CITA no se pudo interpretar: \"{{value1}}\".", { value1: citaRef }) });
        }
      }
      continue;
    }

    const citaReviewMatch = line.match(/^CITA!:\s*([\s\S]+)$/i);
    if (citaReviewMatch) {
      if (citaRef) {
        errors.push({ line: i, message: translate("common:diagnostic.citaAndCitaCannotBeUsedTogether", "No se puede tener CITA: y CITA!: a la vez.") });
      } else {
        citaReviewRef = citaReviewMatch[1].trim();
        if (!parseCitaRef(citaReviewRef)) {
          warnings.push({ line: i, message: translate("common:diagnostic.couldNotInterpretCitaReferenceValue1", "La referencia CITA! no se pudo interpretar: \"{{value1}}\".", { value1: citaReviewRef }) });
        }
      }
    }
  }

  if (options.length < 2) {
    errors.push({ line: questionLine, message: translate("common:diagnostic.atLeast2OptionsAreRequiredFoundOnlyValue1", "Se necesitan al menos 2 opciones. Solo se encontraron {{value1}}.", { value1: options.length }) });
  }
  if (options.length > 4) {
    errors.push({ line: questionLine, message: translate("common:diagnostic.atMost4OptionsAreAllowedFoundValue1", "Maximo 4 opciones permitidas. Se encontraron {{value1}}.", { value1: options.length }) });
  }
  if (options.length >= 2 && !options.some(o => o.isCorrect)) {
    errors.push({ line: questionLine, message: translate("common:diagnostic.atLeastOneOptionMustBeCorrectUse", "Al menos una opcion debe ser correcta (usar *).") });
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  return {
    ok: true,
    data: {
      question,
      options,
      timerSeconds,
      randomize,
      multiSelect,
      citaRef,
      citaReviewRef,
    },
    warnings,
  };
}

export function looksLikeQuizBlock(text: string): boolean {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    return t.toUpperCase().startsWith('P:');
  }
  return false;
}

export function serializeQuizToText(data: QuizData): string {
  const parts: string[] = [];
  const config = `[${data.timerSeconds}, ${data.randomize ? '1' : '0'}, ${data.multiSelect ? '1' : '0'}]`;
  parts.push(`P: ${data.question} ${config}`);

  for (const opt of data.options) {
    const correctMark = opt.isCorrect ? '*' : '';
    parts.push(`${opt.id}${correctMark}: ${opt.text}`);
  }

  if (data.citaRef) parts.push(`CITA: ${data.citaRef}`);
  if (data.citaReviewRef) parts.push(`CITA!: ${data.citaReviewRef}`);

  return parts.join('\n');
}

export function parseResultProfiles(text: string): QuizResultProfile[] {
  const profiles: QuizResultProfile[] = [];
  let rank = 1;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const match = trimmed.match(/^R\d+:\s*([\s\S]+)$/i);
    if (!match) continue;

    const parts = match[1].split('///').map(p => p.trim());
    profiles.push({
      rank,
      title: parts[0] || '',
      description: parts[1] || '',
      giftText: parts[2] || '',
    });
    rank++;
  }

  return profiles;
}

export function serializeResultProfiles(profiles: QuizResultProfile[]): string {
  return profiles
    .sort((a, b) => a.rank - b.rank)
    .map(p => `R${p.rank}: ${p.title} /// ${p.description} /// ${p.giftText}`)
    .join('\n');
}

function seededRng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getStableOptionOrder(options: QuizOption[], slideId: string): QuizOption[] {
  const arr = [...options];
  const rng = seededRng(hashString(slideId));
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function getDisplayOptions(data: QuizData, slideId: string): QuizOption[] {
  if (!data.randomize) return data.options;
  return getStableOptionOrder(data.options, slideId);
}

export function calcRemainingMs(state: QuizTimerState): number {
  if (state.status === 'expired' || state.status === 'completed') return 0;
  if (state.status === 'idle') return state.timerDurationMs;
  if (state.status === 'paused') return state.pausedRemainingMs ?? state.timerDurationMs;
  if (state.status === 'running' && state.timerStartedAt !== null) {
    const elapsed = Date.now() - state.timerStartedAt;
    return Math.max(0, state.timerDurationMs - elapsed);
  }
  return state.timerDurationMs;
}

export function calcRemainingFraction(state: QuizTimerState): number {
  if (state.timerDurationMs <= 0) return 0;
  return calcRemainingMs(state) / state.timerDurationMs;
}

export function generateQuizSubslides(data: QuizData): QuizSubslide[] {
  const subslides: QuizSubslide[] = [];

  // Results slide only has one subslide
  if (data.isResultsSlide) {
    subslides.push({ kind: 'results', label: 'Resultados' });
    return subslides;
  }

  // Lectura ALWAYS appears (for reading the question/options before starting the timer)
  subslides.push({ kind: 'lectura', label: 'Lectura' });

  subslides.push({ kind: 'pregunta', label: 'Pregunta' });

  if (data.citaRef) {
    const parsed = parseCitaRef(data.citaRef);
    if (parsed) {
      const start = parseInt(parsed.verseStart, 10);
      const end = parsed.verseEnd ? parseInt(parsed.verseEnd, 10) : start;
      for (let v = start; v <= end; v++) {
        // Prompt: con Dn 1:1-4, controller debe ver [Dn 1:1] [2] [3] [4].
        const label = v === start ? `${parsed.bookToken} ${parsed.chapter}:${v}` : String(v);
        subslides.push({
          kind: 'cita-verse',
          label,
          verse: String(v),
          verseStart: String(start),
          verseEnd: String(end),
          bookToken: parsed.bookToken,
          chapter: String(parsed.chapter)
        });
      }
    }
  }

  subslides.push({ kind: 'respuesta', label: 'Respuesta' });
  return subslides;
}

export function scoreAnswer(data: QuizData, answer: QuizAudienceAnswer): QuizQuestionScore {
  let optionCentipunts = 0;
  let citaCentipunts = 0;
  let bonusCentipunts = 0;

  const correctIds = data.options.filter(o => o.isCorrect).map(o => o.id);

  if (!data.multiSelect) {
    if (answer.selectedOptionIds.length === 1 && correctIds.includes(answer.selectedOptionIds[0])) {
      optionCentipunts = 50;
    }
  } else {
    const selected = new Set(answer.selectedOptionIds);
    const correct = new Set(correctIds);
    const isExact =
      selected.size === correct.size &&
      [...selected].every(id => correct.has(id as QuizOptionId));
    if (isExact) optionCentipunts = 50;
  }

  if (data.citaRef && !data.citaReviewRef) {
    const expected = parseCitaRef(data.citaRef);
    if (expected && answer.citaBook && answer.citaChapter && answer.citaVerseStart) {
      const bookMatch = answer.citaBook.trim().toLowerCase() === expected.bookToken.toLowerCase();
      const chapterMatch = answer.citaChapter.trim() === expected.chapter;
      const verseStartMatch = answer.citaVerseStart.trim() === expected.verseStart;
      const verseEndMatch = !expected.verseEnd || (answer.citaVerseEnd?.trim() === expected.verseEnd);

      if (bookMatch && chapterMatch && verseStartMatch && verseEndMatch) {
        citaCentipunts = 50;
      }
    }
  }

  if (answer.bonusReadingClaimed) {
    bonusCentipunts = 25;
  }

  const totalCentipunts = optionCentipunts + citaCentipunts + bonusCentipunts;

  return {
    slideId: answer.slideId,
    optionCentipunts,
    citaCentipunts,
    bonusCentipunts,
    totalCentipunts,
  };
}

export function calcMaxBaseCentipunts(quizSlides: QuizData[]): number {
  return quizSlides.reduce((acc, data) => {
    if (data.isResultsSlide) return acc;
    let max = 50;
    if (data.citaRef) max += 50;
    return acc + max;
  }, 0);
}

export function calcTotalScore(scores: QuizQuestionScore[]): QuizTotalScore {
  const total = scores.reduce((sum, s) => sum + s.totalCentipunts, 0);
  return {
    totalCentipunts: total,
    maxBaseCentipunts: 0,
    questions: scores,
  };
}

export interface QuizRange {
  rank: number;
  minCentipunts: number;
  maxCentipunts: number;
}

export function calcResultRanges(profiles: QuizResultProfile[], maxBaseCentipunts: number): QuizRange[] {
  if (profiles.length === 0) return [];

  const sorted = [...profiles].sort((a, b) => a.rank - b.rank);
  const count = sorted.length;
  const rangeSize = Math.floor(maxBaseCentipunts / count);
  const ranges: QuizRange[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const rank = sorted[i].rank;
    const reverseIdx = count - 1 - i;
    const min = reverseIdx === 0 ? 0 : reverseIdx * rangeSize;
    const max = reverseIdx === count - 1 ? Infinity : (reverseIdx + 1) * rangeSize - 1;
    ranges.push({ rank, minCentipunts: min, maxCentipunts: max });
  }

  return ranges;
}

export function selectResultProfile(
  totalCentipunts: number,
  ranges: QuizRange[],
  profiles: QuizResultProfile[],
): QuizResultProfile | null {
  const matching = ranges.find(r => totalCentipunts >= r.minCentipunts && totalCentipunts <= r.maxCentipunts);
  if (!matching) return null;
  return profiles.find(p => p.rank === matching.rank) ?? null;
}

export function formatCentipunts(centipunts: number): string {
  const whole = Math.floor(centipunts / 100);
  const cents = centipunts % 100;
  return `${whole}.${String(cents).padStart(2, '0')}`;
}

export function formatRemainingTime(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  return String(seconds);
}

export function makeDefaultQuizData(): QuizData {
  return {
    question: '',
    options: [
      { id: 'A', text: '', isCorrect: true },
      { id: 'B', text: '', isCorrect: false },
      { id: 'C', text: '', isCorrect: false },
      { id: 'D', text: '', isCorrect: false },
    ],
    timerSeconds: 30,
    randomize: false,
    multiSelect: false,
  };
}

export function makeDefaultResultsQuizData(): QuizData {
  return {
    question: '',
    options: [],
    timerSeconds: 30,
    randomize: false,
    multiSelect: false,
    isResultsSlide: true,
    resultProfiles: [
      { rank: 1, title: 'Excelente', description: 'Has respondido brillantemente.', giftText: '' },
      { rank: 2, title: 'Muy bien', description: 'Buen conocimiento.', giftText: '' },
      { rank: 3, title: 'Bien', description: 'Sigue estudiando.', giftText: '' },
    ],
  };
}
