import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  validateAudioSyncPayload,
  validatePresentationsPayload,
} from '../server/content-validation.mjs';

const validPresentation = () => ({
  id: 'presentation-1',
  title: 'Presentation',
  background: '/backgrounds/default.jpg',
  mode: 'standard',
  slides: [{ id: 'slide-1', label: '1', lines: ['Line'] }],
});

const validAudioMap = () => ({
  id: 'audio-1',
  name: 'Audio map',
  audioSrc: '/audio/example.mp3',
  presentationId: 'presentation-1',
  defaultSyncMode: 'bilateral',
  defaultVolume: 0.7,
  cues: [
    { timeSec: 0, slideIndex: 0 },
    { timeSec: 4.5, slideIndex: 1, verse: '2' },
  ],
});

describe('server content validation', () => {
  it('accepts valid presentation and audio-sync payloads', () => {
    expect(validatePresentationsPayload([validPresentation()]).ok).toBe(true);
    expect(validateAudioSyncPayload([validAudioMap()]).ok).toBe(true);
  });

  it('rejects duplicate presentation and slide identifiers', () => {
    const presentation = validPresentation();
    presentation.slides.push({ id: 'slide-1', label: '2', lines: ['Duplicate'] });
    const result = validatePresentationsPayload([presentation, validPresentation()]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.stringContaining('presentations[1].id is duplicated'),
        expect.stringContaining('slides[1].id is duplicated'),
      ]));
    }
  });

  it('rejects malformed nested slide, scripture, media, and quiz data', () => {
    const presentation = validPresentation();
    presentation.slides = [{
      id: 'quiz-1',
      label: 'Quiz',
      lines: [],
      type: 'quiz',
      mediaStart: 20,
      mediaEnd: 10,
      scriptureVerses: [['valid'], [42]],
      quizData: {
        question: 'Question',
        options: [
          { id: 'A', text: 'One', isCorrect: true },
          { id: 'A', text: 'Two', isCorrect: false },
        ],
        timerSeconds: 0,
        randomize: true,
        multiSelect: false,
      },
    }] as never;

    const result = validatePresentationsPayload([presentation]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/mediaEnd/);
      expect(result.errors.join('\n')).toMatch(/scriptureVerses/);
      expect(result.errors.join('\n')).toMatch(/duplicated/);
      expect(result.errors.join('\n')).toMatch(/timerSeconds/);
    }
  });

  it('rejects oversized collections before persistence', () => {
    const oversized = Array.from({ length: LIMITS.presentations + 1 }, validPresentation);
    expect(validatePresentationsPayload(oversized).ok).toBe(false);
  });

  it('rejects duplicate audio IDs, invalid ranges, and unsorted cues', () => {
    const invalid = validAudioMap();
    invalid.defaultVolume = 2;
    invalid.cues = [
      { timeSec: 5, slideIndex: 0 },
      { timeSec: 2, slideIndex: LIMITS.slidesPerPresentation },
    ];
    const result = validateAudioSyncPayload([invalid, validAudioMap()]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/id is duplicated/);
      expect(result.errors.join('\n')).toMatch(/defaultVolume/);
      expect(result.errors.join('\n')).toMatch(/ascending order/);
      expect(result.errors.join('\n')).toMatch(/slideIndex/);
    }
  });
});
