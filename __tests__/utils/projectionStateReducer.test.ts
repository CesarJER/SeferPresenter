import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO_STATE } from '../../src/types/audio';
import { validateSyncMessage } from '../../src/utils/validation';
import {
  makeProjectionSyncStateMessage,
  reduceProjectionCommand,
} from '../../server/projection-state-reducer.mjs';

const quizData = {
  question: 'Pregunta',
  options: [
    { id: 'A', text: 'Uno', isCorrect: true },
    { id: 'B', text: 'Dos', isCorrect: false },
  ],
  timerSeconds: 45,
  randomize: false,
  multiSelect: false,
};

const presentation = {
  id: 'p1',
  title: 'Servicio',
  background: '/backgrounds/bg.png',
  mode: 'trilingual',
  slides: [
    {
      id: 's1',
      label: 'Inicio',
      lines: ['Linea 1'],
      type: 'text',
    },
    {
      id: 'sf1',
      label: 'Gn 1:1',
      lines: ['Hebreo', 'Trans', 'Trad'],
      type: 'sefer',
      scriptureBook: 'Gn',
      scriptureChapter: '1',
      scriptureVerseStart: '1',
      scriptureVerseEnd: '2',
    },
    {
      id: 'q1',
      label: 'Quiz',
      lines: ['P: Pregunta'],
      type: 'quiz',
      quizData,
    },
    {
      id: 'results',
      label: 'Resultados',
      lines: ['Resultados'],
      type: 'quiz',
      quizData: {
        ...quizData,
        question: '',
        options: [],
        isResultsSlide: true,
        resultProfiles: [
          { rank: 1, title: 'Alto', description: '', giftText: '' },
          { rank: 2, title: 'Bajo', description: '', giftText: '' },
        ],
      },
    },
  ],
};

const baseState = {
  type: 'SYNC_STATE',
  clientId: 'server',
  origin: 'control',
  presentation,
  slideIndex: 0,
  backgroundLock: false,
  lockedBackgroundValue: null,
  userSelectedBackground: null,
  videoState: null,
  appMode: 'slides',
  scriptureState: null,
  audioState: DEFAULT_AUDIO_STATE,
  quizState: null,
  stepIndex: 0,
};

describe('projectionStateReducer', () => {
  it('reduces SELECT_PRESENTATION_AND_SLIDE from Control into canonical state', () => {
    const result = reduceProjectionCommand(
      baseState,
      {
        command: 'SELECT_PRESENTATION_AND_SLIDE',
        presentation,
        slideIndex: 1,
        direction: 'forward',
      },
      { clientId: 'control-1', now: 1000 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const syncState = makeProjectionSyncStateMessage(result.state, {
      clientId: 'control-1',
      origin: 'control',
      now: 1000,
      messageId: 'm1',
    });

    expect(syncState.type).toBe('SYNC_STATE');
    expect(syncState.origin).toBe('control');
    expect(syncState.slideIndex).toBe(1);
    expect(syncState.appMode).toBe('scripture');
    expect(syncState.scriptureState?.bookAbbrevEs).toBe('Gn');
    const validation = validateSyncMessage(syncState);
    expect(validation.ok, validation.errors.join('\n')).toBe(true);
  });

  it('can enter manual Sefer mode without Presenter state reduction', () => {
    const selected = reduceProjectionCommand(baseState, {
      command: 'SELECT_PRESENTATION_AND_SLIDE',
      presentation,
      slideIndex: 1,
      direction: 'forward',
    }, { now: 1000 });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;

    const manual = reduceProjectionCommand(selected.state, {
      command: 'TOGGLE_APP_MODE',
      mode: 'seferManual',
    }, { now: 2000 });

    expect(manual.ok).toBe(true);
    if (!manual.ok) return;
    expect(manual.state.appMode).toBe('seferManual');
    expect(manual.state.scriptureState?.scriptureKind).toBe('sefer');
    expect(manual.state.scriptureState?.command).toBe('navigate');
  });

  it('reduces quiz subslide and timer commands into quizState', () => {
    const selected = reduceProjectionCommand(baseState, {
      command: 'SELECT_PRESENTATION_AND_SLIDE',
      presentation,
      slideIndex: 2,
      direction: 'forward',
    }, { now: 1000 });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;

    const subslide = reduceProjectionCommand(selected.state, {
      command: 'QUIZ_SELECT_SUBSLIDE',
      index: 1,
    }, { now: 1500 });
    expect(subslide.ok).toBe(true);
    if (!subslide.ok) return;
    expect(subslide.state.quizState?.currentSubslideIndex).toBe(1);

    const running = reduceProjectionCommand(subslide.state, {
      command: 'QUIZ_START_TIMER',
    }, { now: 2000 });
    expect(running.ok).toBe(true);
    if (!running.ok) return;
    expect(running.state.quizState?.timerState.status).toBe('running');
    expect(running.state.quizState?.timerState.timerStartedAt).toBe(2000);
  });

  it('recalculates result ranges from only completed quiz slides', () => {
    const selected = reduceProjectionCommand(baseState, {
      command: 'SELECT_PRESENTATION_AND_SLIDE',
      presentation,
      slideIndex: 2,
      direction: 'forward',
    }, { now: 1000 });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;

    const completed = reduceProjectionCommand(selected.state, {
      command: 'QUIZ_COMPLETE',
    }, { now: 1500 });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.state.quizState?.completedQuizSlideIds).toEqual(['q1']);

    const results = reduceProjectionCommand(completed.state, {
      command: 'SELECT_PRESENTATION_AND_SLIDE',
      presentation,
      slideIndex: 3,
      direction: 'forward',
    }, { now: 2000 });
    expect(results.ok).toBe(true);
    if (!results.ok) return;

    const recalculated = reduceProjectionCommand(results.state, {
      command: 'QUIZ_RECALCULATE_RESULTS',
      slideIds: ['q1', 'results', 'missing'],
    }, { now: 2500 });
    expect(recalculated.ok).toBe(true);
    if (!recalculated.ok) return;
    expect(recalculated.state.quizState?.resultQuizSlideIds).toEqual(['q1']);
    expect(recalculated.state.quizState?.maxBaseCentipunts).toBe(50);
    expect(recalculated.state.quizState?.scoreRequestId).toBe(1);

    const requestedAgain = reduceProjectionCommand(recalculated.state, {
      command: 'QUIZ_RECALCULATE_RESULTS',
      slideIds: ['q1'],
    }, { now: 2600 });
    expect(requestedAgain.ok).toBe(true);
    if (!requestedAgain.ok) return;
    expect(requestedAgain.state.quizState?.scoreRequestId).toBe(2);

    const cleared = reduceProjectionCommand(requestedAgain.state, {
      command: 'QUIZ_CLEAR_QUESTION_RESULTS',
      slideId: 'q1',
    }, { now: 2700 });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.state.quizState?.completedQuizSlideIds).toEqual([]);
    expect(cleared.state.quizState?.resultQuizSlideIds).toEqual([]);
    expect(cleared.state.quizState?.maxBaseCentipunts).toBe(0);
    expect(cleared.state.quizState?.scoreRequestId).toBe(3);
  });

  it('rejects malformed commands before producing state', () => {
    const result = reduceProjectionCommand(baseState, {
      command: 'SELECT_STEP',
      stepIndex: -1,
    }, { now: 1000 });

    expect(result.ok).toBe(false);

    const messageValidation = validateSyncMessage({
      type: 'REMOTE_COMMAND',
      clientId: 'control-1',
      payload: {
        command: 'SELECT_STEP',
        stepIndex: -1,
      },
    });

    expect(messageValidation.ok).toBe(false);

    const invalidRecalculation = validateSyncMessage({
      type: 'REMOTE_COMMAND',
      clientId: 'control-1',
      payload: { command: 'QUIZ_RECALCULATE_RESULTS', slideIds: ['q1', 2] },
    });
    expect(invalidRecalculation.ok).toBe(false);

    const invalidClear = validateSyncMessage({
      type: 'REMOTE_COMMAND',
      clientId: 'control-1',
      payload: { command: 'QUIZ_CLEAR_QUESTION_RESULTS', slideId: 2 },
    });
    expect(invalidClear.ok).toBe(false);
  });

  it('reduces autoduck commands into validated canonical state', () => {
    const result = reduceProjectionCommand(baseState, {
      command: 'SET_AUTODUCK_STATE',
      state: { enabled: true, factor: 0.35 },
    }, { now: 1000 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.autoduckState).toEqual({ enabled: true, factor: 0.35 });

    const syncState = makeProjectionSyncStateMessage(result.state, {
      clientId: 'control-1',
      origin: 'control',
      now: 1000,
      messageId: 'm-autoduck',
    });

    const validation = validateSyncMessage(syncState);
    expect(validation.ok, validation.errors.join('\n')).toBe(true);
  });

  it('rejects invalid autoduck factors before state reduction', () => {
    const result = reduceProjectionCommand(baseState, {
      command: 'SET_AUTODUCK_STATE',
      state: { enabled: true, factor: 1.5 },
    }, { now: 1000 });

    expect(result.ok).toBe(false);
  });
});
