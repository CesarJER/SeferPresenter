import { describe, expect, it, vi } from 'vitest';
import { makeEmptyAudienceAnswer } from '../../src/types/quiz';
import {
  calcMaxBaseCentipunts,
  calcRemainingMs,
  calcResultRanges,
  formatCentipunts,
  generateQuizSubslides,
  getStableOptionOrder,
  parseQuizBlock,
  parseResultProfiles,
  scoreAnswer,
  selectResultProfile,
  serializeQuizToText,
} from '../../src/utils/quizUtils';

const parseOk = (text: string) => {
  const parsed = parseQuizBlock(text);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.errors.map(error => error.message).join('\n'));
  return parsed.data;
};

describe('quiz parser', () => {
  it('uses original defaults when config is omitted', () => {
    const data = parseOk(`P: Que pidio Daniel?
A*: Legumbres
B: Carne`);

    expect(data.question).toBe('Que pidio Daniel?');
    expect(data.timerSeconds).toBe(30);
    expect(data.randomize).toBe(false);
    expect(data.multiSelect).toBe(false);
    expect(data.options).toEqual([
      { id: 'A', text: 'Legumbres', isCorrect: true },
      { id: 'B', text: 'Carne', isCorrect: false },
    ]);
  });

  it('parses original numeric config at the end of P', () => {
    const data = parseOk(`P: Marca dos [45, 1, 1]
A*: Uno
B*: Dos
C: Tres`);

    expect(data.question).toBe('Marca dos');
    expect(data.timerSeconds).toBe(45);
    expect(data.randomize).toBe(true);
    expect(data.multiSelect).toBe(true);
  });

  it('rejects the incorrect word-based prefix dialect', () => {
    const parsed = parseQuizBlock(`P: [45, aleatorio, multi] Marca dos
A*: Uno
B: Dos`);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.errors.map(error => error.message).join('\n')).toContain('debe ir al final');
  });

  it('rejects word-based config at the end', () => {
    const parsed = parseQuizBlock(`P: Marca dos [45, aleatorio, multi]
A*: Uno
B: Dos`);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.errors.map(error => error.message).join('\n')).toContain('Valor aleatorio invalido');
  });

  it('rejects non-binary config values', () => {
    const parsed = parseQuizBlock(`P: Pregunta [45, 2, 0]
A*: Uno
B: Dos`);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.errors.map(error => error.message).join('\n')).toContain('Valor aleatorio invalido');
  });

  it('extracts evaluable and review citations', () => {
    const evaluable = parseOk(`P: Pregunta
A*: Uno
B: Dos
CITA: Dn 1:8`);
    const review = parseOk(`P: Pregunta
A*: Uno
B: Dos
CITA!: Dn 1:1-4`);

    expect(evaluable.citaRef).toBe('Dn 1:8');
    expect(review.citaReviewRef).toBe('Dn 1:1-4');
  });

  it('returns warning but stays ok for unparseable citation references', () => {
    const parsed = parseQuizBlock(`P: Pregunta
A*: Uno
B: Dos
CITA: referencia rota`);

    expect(parsed.ok).toBe(true);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0].message).toContain('no se pudo interpretar');
  });

  it('rejects mixed CITA and CITA! in one block', () => {
    const parsed = parseQuizBlock(`P: Pregunta
A*: Uno
B: Dos
CITA: Dn 1:8
CITA!: Dn 1:1-4`);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.errors.map(error => error.message).join('\n')).toContain('CITA: y CITA!');
  });

  it('serializes quiz data to original numeric quick-edit text', () => {
    const data = parseOk(`P: Marca dos [45, 1, 1]
A*: Uno
B*: Dos
C: Tres
CITA: Dn 1:8`);

    const serialized = serializeQuizToText(data);
    expect(serialized).toContain('P: Marca dos [45, 1, 1]');
    expect(serialized).toContain('A*: Uno');
    expect(serialized).toContain('CITA: Dn 1:8');
  });
});

describe('quiz results and scoring', () => {
  it('scores radio, checkbox, citation and bonus answers', () => {
    const radio = parseOk(`P: Radio
A*: Correcta
B: Incorrecta
CITA: Dn 1:8`);
    const radioAnswer = {
      ...makeEmptyAudienceAnswer('radio'),
      selectedOptionIds: ['A' as const],
      citaBook: 'Dn',
      citaChapter: '1',
      citaVerseStart: '8',
      bonusReadingClaimed: true,
    };

    expect(scoreAnswer(radio, radioAnswer)).toMatchObject({
      optionCentipunts: 50,
      citaCentipunts: 50,
      bonusCentipunts: 25,
      totalCentipunts: 125,
    });

    const checkbox = parseOk(`P: Multi [30, 0, 1]
A*: Uno
B*: Dos
C: Tres`);
    expect(scoreAnswer(checkbox, { ...makeEmptyAudienceAnswer('multi'), selectedOptionIds: ['A', 'B'] })).toMatchObject({
      optionCentipunts: 50,
      citaCentipunts: 0,
      totalCentipunts: 50,
    });
    expect(scoreAnswer(checkbox, { ...makeEmptyAudienceAnswer('multi'), selectedOptionIds: ['A'] }).optionCentipunts).toBe(0);
  });

  it('calculates result ranges and selects matching profile', () => {
    const profiles = parseResultProfiles(`R1: Excelente /// Alto /// Texto 1
R2: Bien /// Medio /// Texto 2
R3: Repasar /// Bajo /// Texto 3`);
    const ranges = calcResultRanges(profiles, 300);

    expect(ranges).toEqual([
      { rank: 1, minCentipunts: 200, maxCentipunts: Infinity },
      { rank: 2, minCentipunts: 100, maxCentipunts: 199 },
      { rank: 3, minCentipunts: 0, maxCentipunts: 99 },
    ]);
    expect(selectResultProfile(250, ranges, profiles)?.rank).toBe(1);
    expect(selectResultProfile(50, ranges, profiles)?.rank).toBe(3);
  });

  it('formats centipunts as decimal points', () => {
    expect(formatCentipunts(50)).toBe('0.50');
    expect(formatCentipunts(125)).toBe('1.25');
  });
});

describe('quiz runtime helpers', () => {
  it('generates stable option order and subslides', () => {
    const data = parseOk(`P: Pregunta [30, 1, 0]
A*: Uno
B: Dos
C: Tres
CITA: Dn 1:1-3`);

    expect(getStableOptionOrder(data.options, 'slide-1')).toEqual(getStableOptionOrder(data.options, 'slide-1'));
    expect(generateQuizSubslides(data).map(subslide => subslide.kind)).toEqual([
      'lectura',
      'pregunta',
      'cita-verse',
      'cita-verse',
      'cita-verse',
      'respuesta',
    ]);
    expect(calcMaxBaseCentipunts([data])).toBe(100);
  });

  it('calculates remaining timer milliseconds from state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:05Z'));
    expect(calcRemainingMs({
      status: 'running',
      timerStartedAt: Date.parse('2026-01-01T00:00:00Z'),
      timerDurationMs: 10_000,
      pausedRemainingMs: null,
    })).toBe(5_000);
    expect(calcRemainingMs({
      status: 'expired',
      timerStartedAt: null,
      timerDurationMs: 10_000,
      pausedRemainingMs: null,
    })).toBe(0);
    vi.useRealTimers();
  });
});
