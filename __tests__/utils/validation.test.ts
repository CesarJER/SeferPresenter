import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO_STATE } from '../../src/types/audio';
import { sanitizeSlideHtml } from '../../src/utils/hebrewText';
import {
  validateAudioSyncMaps,
  validatePresentationList,
  validateSyncMessage,
} from '../../src/utils/validation';

const validPresentation = {
  id: 'p1',
  title: 'Servicio',
  background: '/backgrounds/bg.png',
  mode: 'trilingual',
  customField: 'preserved',
  slides: [
    {
      id: 's1',
      label: '1',
      lines: ['<span>Texto</span>', 'Trans', 'Trad'],
      type: 'sefer',
      scriptureBook: 'Gn',
      scriptureChapter: '1',
      scriptureVerseStart: '1',
      scriptureVerseEnd: '3',
    },
  ],
};

const validAudioMap = {
  id: 'a1',
  name: 'Lectura',
  audioSrc: '/audio/lectura.mp3',
  presentationId: 'p1',
  defaultSyncMode: 'unilateral',
  defaultVolume: 0.7,
  cues: [
    { timeSec: 0, slideIndex: 0 },
    { timeSec: 3.5, slideIndex: 0, verse: '2' },
  ],
};

describe('runtime validation', () => {
  it('accepts valid presentations and preserves safe unknown fields', () => {
    const result = validatePresentationList([validPresentation]);

    expect(result.ok).toBe(true);
    expect(result.value?.[0].slides[0].type).toBe('sefer');
    expect((result.value?.[0] as typeof validPresentation | undefined)?.customField).toBe('preserved');
  });

  it('rejects malformed presentation and slide payloads', () => {
    const result = validatePresentationList([
      { ...validPresentation, slides: [{ id: 's1', label: '1', lines: [1] }] },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('lines');
  });

  it('accepts quiz result slides without answer options', () => {
    const result = validatePresentationList([
      {
        ...validPresentation,
        slides: [
          {
            id: 'r1',
            label: 'Resultados',
            lines: ['R1: Excelente /// Alto /// Texto', '-', '-'],
            type: 'quiz',
            quizData: {
              question: 'Resultados',
              options: [],
              timerSeconds: 30,
              randomize: false,
              multiSelect: false,
              isResultsSlide: true,
              resultProfiles: [
                { rank: 1, title: 'Excelente', description: 'Alto', giftText: 'Texto' },
              ],
            },
          },
        ],
      },
    ]);

    expect(result.ok).toBe(true);
  });

  it('still rejects normal quiz slides with fewer than two options', () => {
    const result = validatePresentationList([
      {
        ...validPresentation,
        slides: [
          {
            id: 'q1',
            label: 'Pregunta',
            lines: ['P: Pregunta [30, 0, 0]', '-', '-'],
            type: 'quiz',
            quizData: {
              question: 'Pregunta',
              options: [{ id: 'A', text: 'Uno', isCorrect: true }],
              timerSeconds: 30,
              randomize: false,
              multiSelect: false,
            },
          },
        ],
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('entre 2 y 4 opciones');
  });

  it('accepts valid audio sync maps and rejects bad cues', () => {
    expect(validateAudioSyncMaps([validAudioMap]).ok).toBe(true);

    const result = validateAudioSyncMaps([
      { ...validAudioMap, cues: [{ timeSec: -1, slideIndex: 0 }] },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('timeSec');
  });

  it('rejects incomplete sync state messages', () => {
    const result = validateSyncMessage({
      type: 'SYNC_STATE',
      clientId: 'c1',
      origin: 'control',
      presentation: validPresentation,
      slideIndex: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('audioState');
  });

  it('accepts complete sync state messages', () => {
    const result = validateSyncMessage({
      type: 'SYNC_STATE',
      clientId: 'c1',
      origin: 'control',
      presentation: validPresentation,
      slideIndex: 0,
      backgroundLock: false,
      lockedBackgroundValue: null,
      userSelectedBackground: null,
      videoState: null,
      appMode: 'slides',
      scriptureState: null,
      audioState: DEFAULT_AUDIO_STATE,
    });

    expect(result.ok).toBe(true);
  });
});

describe('slide HTML sanitizing', () => {
  it('keeps allowed formatting and removes unsafe markup', () => {
    const clean = sanitizeSlideHtml('<span class="hebrew" onclick="bad()">Shalom</span><br><script>bad()</script><img src=x>');

    expect(clean).toContain('<span class="hebrew">Shalom</span>');
    expect(clean).toMatch(/<br\s*\/?>/);
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('<img');
  });
});
