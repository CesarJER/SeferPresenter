const DEFAULT_AUDIO_STATE = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  audioSrc: null,
  activeSyncMapId: null,
  syncMode: 'none',
  lastUpdatedBy: 'controller',
  timestamp: 0,
};

const DEFAULT_STATE = {
  clientId: 'server',
  origin: 'control',
  presentation: null,
  slideIndex: -1,
  stepIndex: 0,
  backgroundLock: false,
  lockedBackgroundValue: null,
  userSelectedBackground: null,
  videoState: null,
  appMode: 'slides',
  scriptureState: null,
  audioState: DEFAULT_AUDIO_STATE,
  quizState: null,
  autoduckState: { enabled: false, factor: 0.2 },
};

const APP_MODES = new Set(['slides', 'scripture', 'seferManual']);
const DIRECTIONS = new Set(['forward', 'backward']);
const SCRIPTURE_BOUNDARIES = new Set(['next', 'previous']);
const SCRIPTURE_ARROWS = new Set(['up', 'down']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isInteger = (value) => Number.isInteger(value);
const isNullableString = (value) => value === null || typeof value === 'string';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const clone = (value) => {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const makeError = (message) => ({ ok: false, error: message });
const makeOk = (state) => ({ ok: true, state });

export const getDefaultProjectionState = () => clone(DEFAULT_STATE);

const normalizeAutoduckState = (value) => {
  const source = isRecord(value) ? value : {};
  const factor = isFiniteNumber(source.factor) ? source.factor : DEFAULT_STATE.autoduckState.factor;
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_STATE.autoduckState.enabled,
    factor: clamp(factor, 0, 1),
  };
};

export const normalizeProjectionState = (state = {}) => {
  const source = isRecord(state) ? state : {};
  const audioState = isRecord(source.audioState) ? source.audioState : DEFAULT_AUDIO_STATE;
  return {
    ...clone(DEFAULT_STATE),
    ...clone(source),
    clientId: typeof source.clientId === 'string' ? source.clientId : DEFAULT_STATE.clientId,
    origin: source.origin === 'presenter' || source.origin === 'control' ? source.origin : DEFAULT_STATE.origin,
    presentation: isRecord(source.presentation) || source.presentation === null ? clone(source.presentation) : null,
    slideIndex: isFiniteNumber(source.slideIndex) ? source.slideIndex : -1,
    stepIndex: isFiniteNumber(source.stepIndex) ? source.stepIndex : 0,
    backgroundLock: typeof source.backgroundLock === 'boolean' ? source.backgroundLock : false,
    lockedBackgroundValue: isNullableString(source.lockedBackgroundValue) ? source.lockedBackgroundValue : null,
    userSelectedBackground: isNullableString(source.userSelectedBackground) ? source.userSelectedBackground : null,
    videoState: source.videoState === null || isRecord(source.videoState) ? clone(source.videoState) : null,
    appMode: APP_MODES.has(source.appMode) ? source.appMode : 'slides',
    scriptureState: source.scriptureState === null || isRecord(source.scriptureState) ? clone(source.scriptureState) : null,
    audioState: { ...clone(DEFAULT_AUDIO_STATE), ...clone(audioState) },
    quizState: source.quizState === null || isRecord(source.quizState) ? clone(source.quizState) : null,
    autoduckState: normalizeAutoduckState(source.autoduckState),
  };
};

const makeSyncState = (state, metadata = {}) => ({
  type: 'SYNC_STATE',
  clientId: typeof metadata.clientId === 'string' ? metadata.clientId : state.clientId,
  origin: metadata.origin === 'presenter' ? 'presenter' : 'control',
  presentation: state.presentation,
  slideIndex: state.slideIndex,
  backgroundLock: state.backgroundLock,
  lockedBackgroundValue: state.lockedBackgroundValue,
  userSelectedBackground: state.userSelectedBackground,
  videoState: state.videoState,
  appMode: state.appMode,
  scriptureState: state.scriptureState,
  audioState: state.audioState,
  quizState: state.quizState,
  autoduckState: state.autoduckState,
  stepIndex: state.stepIndex,
  protocolVersion: 1,
  timestamp: metadata.now || Date.now(),
  messageId: metadata.messageId || `${metadata.now || Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
});

export const makeProjectionSyncStateMessage = (state, metadata = {}) =>
  makeSyncState(normalizeProjectionState(state), metadata);

const getSlides = (presentation) => Array.isArray(presentation?.slides) ? presentation.slides : [];

const getActiveSlide = (state) => {
  const slides = getSlides(state.presentation);
  return state.slideIndex >= 0 && state.slideIndex < slides.length ? slides[state.slideIndex] : null;
};

const parseCitaRef = (citaRef) => {
  if (typeof citaRef !== 'string') return null;
  const clean = citaRef.trim().replace(/^\[(?:Tanaj|Sefer)\s+/i, '').replace(/\]$/, '');
  const match = clean.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  return {
    bookToken: match[1].trim(),
    chapter: match[2],
    verseStart: match[3],
    verseEnd: match[4],
  };
};

const generateQuizSubslides = (quizData) => {
  if (!isRecord(quizData)) return [];
  if (quizData.isResultsSlide === true) return [{ kind: 'results', label: 'Resultados' }];

  const subslides = [
    { kind: 'lectura', label: 'Lectura' },
    { kind: 'pregunta', label: 'Pregunta' },
  ];

  const parsed = parseCitaRef(quizData.citaRef);
  if (parsed) {
    const start = Number.parseInt(parsed.verseStart, 10);
    const end = parsed.verseEnd ? Number.parseInt(parsed.verseEnd, 10) : start;
    if (Number.isFinite(start) && Number.isFinite(end)) {
      for (let verse = start; verse <= end; verse += 1) {
        subslides.push({
          kind: 'cita-verse',
          label: verse === start ? `${parsed.bookToken} ${parsed.chapter}:${verse}` : String(verse),
          verse: String(verse),
          verseStart: String(start),
          verseEnd: String(end),
          bookToken: parsed.bookToken,
          chapter: String(parsed.chapter),
        });
      }
    }
  }

  subslides.push({ kind: 'respuesta', label: 'Respuesta' });
  return subslides;
};

const generatePresentationSteps = (presentation) => {
  const steps = [];
  getSlides(presentation).forEach((slide, slideIndex) => {
    if (slide?.type === 'quiz' && slide.quizData) {
      generateQuizSubslides(slide.quizData).forEach((_, subslideIndex) => {
        steps.push({ type: 'quiz', slideIndex, subslideIndex });
      });
      return;
    }

    if (
      (slide?.type === 'sefer' || slide?.type === 'tanaj') &&
      slide.scriptureBook &&
      slide.scriptureChapter &&
      slide.scriptureVerseStart
    ) {
      const start = Number.parseInt(slide.scriptureVerseStart, 10);
      const end = slide.scriptureVerseEnd ? Number.parseInt(slide.scriptureVerseEnd, 10) : start;
      const resolvedStart = Number.isFinite(start) ? start : 1;
      const resolvedEnd = Number.isFinite(end) ? end : resolvedStart;
      for (let verse = resolvedStart; verse <= resolvedEnd; verse += 1) {
        steps.push({
          type: 'scripture',
          slideIndex,
          book: slide.scriptureBook,
          chapter: slide.scriptureChapter,
          verse: String(verse),
        });
      }
      return;
    }

    steps.push({ type: 'normal', slideIndex });
  });
  return steps;
};

const getFirstStepIndexForSlide = (slideIndex, steps) => steps.findIndex((step) => step.slideIndex === slideIndex);

const calcMaxBaseCentipunts = (presentation) =>
  getSlides(presentation).reduce((total, slide) => {
    const quizData = slide?.type === 'quiz' ? slide.quizData : null;
    if (!quizData || quizData.isResultsSlide === true) return total;
    return total + (quizData.citaRef ? 100 : 50);
  }, 0);

const makeInitialQuizState = (slide, direction = 'forward', presentation = null) => {
  const quizData = slide?.type === 'quiz' ? slide.quizData : null;
  if (!quizData || !slide) return null;
  const subslides = generateQuizSubslides(quizData);
  const initialIndex = direction === 'backward' && subslides.length > 0 ? subslides.length - 1 : 0;
  return {
    currentSubslideIndex: initialIndex,
    timerState: {
      status: 'idle',
      timerStartedAt: null,
      timerDurationMs: Math.max(1, Number(quizData.timerSeconds) || 30) * 1000,
      pausedRemainingMs: null,
    },
    presenterDemoSelection: {
      [slide.id]: null,
    },
    maxBaseCentipunts: calcMaxBaseCentipunts(presentation),
  };
};

const buildScriptureSlideState = (slide, currentScripture, direction = 'forward', targetVerse, now = Date.now()) => {
  if (!slide || (slide.type !== 'sefer' && slide.type !== 'tanaj' && !slide.scriptureBook)) return null;

  const verseStart = String(slide.scriptureVerseStart || '1');
  const verseEnd = String(slide.scriptureVerseEnd || verseStart);
  const startNum = Number(verseStart);
  const endNum = Number(verseEnd);
  const totalVerses = Number.isFinite(startNum) && Number.isFinite(endNum)
    ? Math.max(1, Math.abs(endNum - startNum) + 1)
    : 1;
  const targetNum = Number(targetVerse);
  const hasTargetVerse = targetVerse !== undefined && Number.isFinite(targetNum) && Number.isFinite(startNum) && Number.isFinite(endNum);
  const targetInsideRange = hasTargetVerse && targetNum >= Math.min(startNum, endNum) && targetNum <= Math.max(startNum, endNum);
  const activeVerse = targetInsideRange ? String(targetVerse) : direction === 'backward' ? verseEnd : verseStart;
  const activeVerseIdx = targetInsideRange ? Math.abs(targetNum - startNum) : direction === 'backward' ? totalVerses - 1 : 0;

  return {
    bookEs: String(slide.scriptureBook || 'Gn'),
    bookHeb: '',
    bookAbbrevEs: String(slide.scriptureBook || 'Gn'),
    chapter: String(slide.scriptureChapter || '1'),
    verseStart,
    verse: activeVerse,
    verseEnd,
    verseNikud: String(slide.lines?.[0] || ''),
    transliteration: String(slide.lines?.[1] || ''),
    translation: String(slide.lines?.[2] || ''),
    verseIdx: activeVerseIdx,
    totalVerses,
    scriptureKind: slide.type === 'tanaj' ? 'tanaj' : 'sefer',
    command: 'navigate',
    commandId: now,
    hebrewFontSize: currentScripture?.hebrewFontSize ?? 42,
    combinedTextBaseSize: currentScripture?.combinedTextBaseSize ?? 50,
  };
};

const applySlideSelection = (state, presentation, slideIndex, direction = 'forward', targetVerse, now = Date.now()) => {
  const next = normalizeProjectionState({
    ...state,
    presentation: presentation === undefined ? state.presentation : presentation,
    slideIndex,
    videoState: null,
  });
  const steps = generatePresentationSteps(next.presentation);
  let stepIndex = 0;

  if (slideIndex >= 0 && steps.length > 0) {
    if (targetVerse) {
      const found = steps.findIndex((step) =>
        step.slideIndex === slideIndex && step.type === 'scripture' && step.verse === String(targetVerse)
      );
      stepIndex = found >= 0 ? found : getFirstStepIndexForSlide(slideIndex, steps);
    } else if (direction === 'backward') {
      const reversedIndex = [...steps].reverse().findIndex((step) => step.slideIndex === slideIndex);
      stepIndex = reversedIndex >= 0 ? steps.length - 1 - reversedIndex : getFirstStepIndexForSlide(slideIndex, steps);
    } else {
      stepIndex = getFirstStepIndexForSlide(slideIndex, steps);
    }
  }

  next.stepIndex = stepIndex >= 0 ? stepIndex : 0;
  const slide = getActiveSlide(next);
  const scriptureState = buildScriptureSlideState(slide, state.scriptureState, direction, targetVerse, now);
  next.appMode = scriptureState ? 'scripture' : 'slides';
  next.scriptureState = scriptureState ?? state.scriptureState;
  next.quizState = makeInitialQuizState(slide, direction, next.presentation);

  const bgValue = slide?.background ?? '';
  if (bgValue !== 'Ignorar' && bgValue !== 'No cambiar') {
    next.userSelectedBackground = null;
  }

  return next;
};

const calcRemainingMs = (timerState, now) => {
  if (!timerState) return 30_000;
  if (timerState.status === 'expired' || timerState.status === 'completed') return 0;
  if (timerState.status === 'idle') return timerState.timerDurationMs;
  if (timerState.status === 'paused') return timerState.pausedRemainingMs ?? timerState.timerDurationMs;
  if (timerState.status === 'running' && timerState.timerStartedAt !== null) {
    return Math.max(0, timerState.timerDurationMs - (now - timerState.timerStartedAt));
  }
  return timerState.timerDurationMs;
};

const getQuizTimerState = (state) => {
  const activeSlide = getActiveSlide(state);
  return state.quizState?.timerState ?? {
    status: 'idle',
    timerStartedAt: null,
    timerDurationMs: Math.max(1, Number(activeSlide?.quizData?.timerSeconds) || 30) * 1000,
    pausedRemainingMs: null,
  };
};

const updateQuizState = (state, updater) => {
  const activeSlide = getActiveSlide(state);
  if (!activeSlide || activeSlide.type !== 'quiz' || !activeSlide.quizData) return state;
  const base = state.quizState ?? makeInitialQuizState(activeSlide, 'forward', state.presentation);
  return {
    ...state,
    quizState: updater(base, activeSlide),
  };
};

const findQuizStepIndex = (presentation, slideIndex, subslideIndex) =>
  generatePresentationSteps(presentation).findIndex((step) =>
    step.slideIndex === slideIndex && step.type === 'quiz' && step.subslideIndex === subslideIndex
  );

const selectQuizSubslide = (state, index, now = Date.now()) => updateQuizState(state, (quizState, activeSlide) => {
  const subslides = generateQuizSubslides(activeSlide.quizData);
  const safeIndex = Math.max(0, Math.min(index, Math.max(0, subslides.length - 1)));
  
  let nextTimerState = quizState.timerState;
  if (subslides[safeIndex]?.kind === 'respuesta') {
    nextTimerState = { ...quizState.timerState, status: 'completed' };
  } else if (subslides[safeIndex]?.kind === 'pregunta' && quizState.timerState.status !== 'running') {
    nextTimerState = {
      ...quizState.timerState,
      status: 'running',
      timerStartedAt: now,
      pausedRemainingMs: null,
    };
  }

  const stepIndex = findQuizStepIndex(state.presentation, state.slideIndex, safeIndex);
  state.stepIndex = stepIndex >= 0 ? stepIndex : state.stepIndex;
  return {
    ...quizState,
    currentSubslideIndex: safeIndex,
    timerState: nextTimerState,
  };
});

const validateCommandPayload = (payload) => {
  if (!isRecord(payload) || typeof payload.command !== 'string') return makeError('REMOTE_COMMAND payload must include command');

  switch (payload.command) {
    case 'SELECT_PRESENTATION_AND_SLIDE':
      if (payload.presentation !== null && !isRecord(payload.presentation)) return makeError('presentation must be an object or null');
      if (!isFiniteNumber(payload.slideIndex)) return makeError('slideIndex must be a number');
      if (payload.direction !== undefined && !DIRECTIONS.has(payload.direction)) return makeError('direction must be forward or backward');
      if (payload.targetVerse !== undefined && typeof payload.targetVerse !== 'string') return makeError('targetVerse must be text');
      break;
    case 'SELECT_STEP':
      if (!isInteger(payload.stepIndex) || payload.stepIndex < 0) return makeError('stepIndex must be an integer >= 0');
      break;
    case 'TOGGLE_APP_MODE':
      if (!APP_MODES.has(payload.mode)) return makeError('mode is not valid');
      break;
    case 'TOGGLE_BG_LOCK':
      if (typeof payload.locked !== 'boolean') return makeError('locked must be boolean');
      break;
    case 'SELECT_BG_OVERRIDE':
      if (!isNullableString(payload.bg)) return makeError('bg must be text or null');
      break;
    case 'SCRIPTURE_PROJECT':
      if (!isRecord(payload.state)) return makeError('state must be an object');
      if (payload.navCommand !== undefined && !SCRIPTURE_BOUNDARIES.has(payload.navCommand) && payload.navCommand !== 'navigate') {
        return makeError('navCommand is not valid');
      }
      break;
    case 'SCRIPTURE_ADD_SLIDE':
      if (!isRecord(payload.state)) return makeError('state must be an object');
      if (payload.kind !== undefined && payload.kind !== 'tanaj' && payload.kind !== 'sefer') return makeError('kind must be tanaj or sefer');
      break;
    case 'SCRIPTURE_BOUNDARY':
      if (!SCRIPTURE_BOUNDARIES.has(payload.direction)) return makeError('direction must be next or previous');
      break;
    case 'SCRIPTURE_ARROW_NAV':
      if (!SCRIPTURE_ARROWS.has(payload.direction)) return makeError('direction must be up or down');
      break;
    case 'UPDATE_FONT_SIZES':
      if (payload.hebrewFontSize !== undefined && !isFiniteNumber(payload.hebrewFontSize)) return makeError('hebrewFontSize must be a number');
      if (payload.combinedTextBaseSize !== undefined && !isFiniteNumber(payload.combinedTextBaseSize)) return makeError('combinedTextBaseSize must be a number');
      break;
    case 'VIDEO_STATE_CHANGE':
      if (payload.state !== null && !isRecord(payload.state)) return makeError('video state must be an object or null');
      break;
    case 'AUDIO_STATE_CHANGE':
      if (!isRecord(payload.state)) return makeError('audio state must be an object');
      break;
    case 'SET_AUTODUCK_STATE':
      if (!isRecord(payload.state)) return makeError('autoduck state must be an object');
      if (typeof payload.state.enabled !== 'boolean') return makeError('enabled must be boolean');
      if (!isFiniteNumber(payload.state.factor) || payload.state.factor < 0 || payload.state.factor > 1) return makeError('factor must be between 0 and 1');
      break;
    case 'QUIZ_SELECT_SUBSLIDE':
      if (!isInteger(payload.index) || payload.index < 0) return makeError('index must be an integer >= 0');
      break;
    case 'QUIZ_ADJUST_TIMER':
      if (!isFiniteNumber(payload.seconds) || payload.seconds < 1) return makeError('seconds must be a number >= 1');
      break;
    case 'QUIZ_DEMO_SELECT':
      if (payload.optionId !== null && typeof payload.optionId !== 'string') return makeError('optionId must be text or null');
      break;
    case 'QUIZ_START_TIMER':
    case 'QUIZ_PAUSE_TIMER':
    case 'QUIZ_RESUME_TIMER':
    case 'QUIZ_RESET_TIMER':
    case 'QUIZ_COMPLETE':
    case 'QUIZ_PLAY_APPLAUSE':
    case 'QUIZ_PLAY_MAL':
    case 'SCRIPTURE_ESCAPE':
    case 'RESET_STATE':
      break;
    default:
      return makeError(`Unsupported REMOTE_COMMAND: ${payload.command}`);
  }

  return { ok: true };
};

export const validateProjectionCommandPayload = (payload) => validateCommandPayload(payload);

export const reduceProjectionCommand = (currentState, payload, metadata = {}) => {
  const validation = validateCommandPayload(payload);
  if (!validation.ok) return validation;

  const now = metadata.now || Date.now();
  const state = normalizeProjectionState(currentState);

  switch (payload.command) {
    case 'SELECT_PRESENTATION_AND_SLIDE':
      return makeOk(applySlideSelection(
        state,
        payload.presentation,
        payload.slideIndex,
        payload.direction || 'forward',
        payload.targetVerse,
        now,
      ));

    case 'SELECT_STEP': {
      const steps = generatePresentationSteps(state.presentation);
      const step = steps[payload.stepIndex];
      if (!step) return makeError('stepIndex is outside the current presentation');

      if (step.type === 'normal') {
        return makeOk({
          ...state,
          slideIndex: step.slideIndex,
          stepIndex: payload.stepIndex,
          appMode: 'slides',
          videoState: null,
          quizState: null,
        });
      }

      if (step.type === 'quiz') {
        const next = {
          ...state,
          slideIndex: step.slideIndex,
          stepIndex: payload.stepIndex,
          appMode: 'slides',
          videoState: null,
        };
        return makeOk(selectQuizSubslide(next, step.subslideIndex, now));
      }

      const slide = getSlides(state.presentation)[step.slideIndex] || null;
      return makeOk({
        ...state,
        slideIndex: step.slideIndex,
        stepIndex: payload.stepIndex,
        appMode: 'scripture',
        videoState: null,
        scriptureState: buildScriptureSlideState(slide, state.scriptureState, 'forward', step.verse, now),
        quizState: null,
      });
    }

    case 'TOGGLE_APP_MODE': {
      if (payload.mode === 'seferManual') {
        const slide = getActiveSlide(state);
        const source = state.scriptureState ?? buildScriptureSlideState(slide, state.scriptureState, 'forward', undefined, now);
        return makeOk({
          ...state,
          appMode: 'seferManual',
          scriptureState: source ? {
            ...source,
            verseStart: source.verse,
            verseEnd: undefined,
            scriptureKind: 'sefer',
            command: 'navigate',
            commandId: now,
          } : state.scriptureState,
        });
      }

      if (payload.mode === 'slides') {
        const slide = getActiveSlide(state);
        const restored = buildScriptureSlideState(slide, state.scriptureState, 'forward', undefined, now);
        const returnsToScripture = Boolean(restored && (slide?.type === 'sefer' || slide?.type === 'tanaj'));
        return makeOk({
          ...state,
          appMode: returnsToScripture ? 'scripture' : 'slides',
          scriptureState: restored ?? state.scriptureState,
        });
      }

      return makeOk({ ...state, appMode: payload.mode });
    }

    case 'TOGGLE_BG_LOCK':
      return makeOk({ ...state, backgroundLock: payload.locked });

    case 'SELECT_BG_OVERRIDE':
      return makeOk({ ...state, userSelectedBackground: payload.bg });

    case 'SCRIPTURE_PROJECT': {
      const projected = payload.state;
      const verseStart = projected.verseStart ?? projected.verse;
      return makeOk({
        ...state,
        appMode: state.appMode === 'seferManual' ? 'seferManual' : 'scripture',
        scriptureState: {
          bookEs: String(projected.bookEs ?? ''),
          bookHeb: String(projected.bookHeb ?? ''),
          bookAbbrevEs: String(projected.bookAbbrevEs ?? projected.bookEs ?? ''),
          chapter: String(projected.chapter ?? '1'),
          verseStart: String(verseStart ?? '1'),
          verse: String(projected.verse ?? verseStart ?? '1'),
          verseEnd: projected.verseEnd !== undefined ? String(projected.verseEnd) || undefined : undefined,
          verseNikud: String(projected.verseNikud ?? ''),
          transliteration: String(projected.transliteration ?? ''),
          translation: String(projected.translation ?? ''),
          verseIdx: isFiniteNumber(projected.verseIdx) ? projected.verseIdx : 0,
          totalVerses: isFiniteNumber(projected.totalVerses) ? projected.totalVerses : 0,
          scriptureKind: projected.scriptureKind === 'tanaj' ? 'tanaj' : 'sefer',
          command: payload.navCommand || 'navigate',
          commandId: now,
          hebrewFontSize: state.scriptureState?.hebrewFontSize ?? 42,
          combinedTextBaseSize: state.scriptureState?.combinedTextBaseSize ?? 50,
        },
      });
    }

    case 'SCRIPTURE_ADD_SLIDE':
      return makeOk(state);

    case 'SCRIPTURE_BOUNDARY': {
      if (!state.presentation) return makeOk(state);
      const nextIndex = payload.direction === 'next' ? state.slideIndex + 1 : state.slideIndex - 1;
      const slides = getSlides(state.presentation);
      if (nextIndex < 0 || nextIndex >= slides.length) return makeOk(state);
      return makeOk(applySlideSelection(
        state,
        state.presentation,
        nextIndex,
        payload.direction === 'next' ? 'forward' : 'backward',
        undefined,
        now,
      ));
    }

    case 'SCRIPTURE_ESCAPE': {
      if (state.appMode === 'seferManual') {
        const slide = getActiveSlide(state);
        const restored = buildScriptureSlideState(slide, state.scriptureState, 'forward', undefined, now);
        const returnsToScripture = Boolean(restored && (slide?.type === 'sefer' || slide?.type === 'tanaj'));
        return makeOk({
          ...state,
          appMode: returnsToScripture ? 'scripture' : 'slides',
          scriptureState: restored ?? state.scriptureState,
        });
      }
      const slide = getActiveSlide(state);
      if (slide?.type === 'sefer' || slide?.type === 'tanaj') return makeOk(state);
      return makeOk({ ...state, appMode: 'slides' });
    }

    case 'SCRIPTURE_ARROW_NAV':
      if (!state.scriptureState) return makeOk(state);
      return makeOk({
        ...state,
        scriptureState: {
          ...state.scriptureState,
          command: payload.direction === 'up' ? 'previous' : 'next',
          commandId: now,
        },
      });

    case 'UPDATE_FONT_SIZES': {
      const previous = state.scriptureState ?? {
        bookEs: '',
        bookHeb: '',
        bookAbbrevEs: '',
        chapter: '1',
        verseStart: '1',
        verse: '1',
        verseNikud: '',
        transliteration: '',
        translation: '',
        verseIdx: 0,
        totalVerses: 0,
      };
      return makeOk({
        ...state,
        scriptureState: {
          ...previous,
          hebrewFontSize: payload.hebrewFontSize ?? 42,
          combinedTextBaseSize: payload.combinedTextBaseSize ?? 50,
        },
      });
    }

    case 'VIDEO_STATE_CHANGE':
      return makeOk({ ...state, videoState: clone(payload.state) });

    case 'AUDIO_STATE_CHANGE':
      return makeOk({ ...state, audioState: { ...state.audioState, ...clone(payload.state) } });

    case 'SET_AUTODUCK_STATE':
      return makeOk({ ...state, autoduckState: normalizeAutoduckState(payload.state) });

    case 'QUIZ_START_TIMER':
      return makeOk(updateQuizState(state, (quizState) => ({
        ...quizState,
        timerState: {
          ...quizState.timerState,
          status: 'running',
          timerStartedAt: now,
          pausedRemainingMs: null,
        },
      })));

    case 'QUIZ_PAUSE_TIMER':
      return makeOk(updateQuizState(state, (quizState) => {
        if (quizState.timerState.status !== 'running') return quizState;
        return {
          ...quizState,
          timerState: {
            ...quizState.timerState,
            status: 'paused',
            timerStartedAt: null,
            pausedRemainingMs: calcRemainingMs(quizState.timerState, now),
          },
        };
      }));

    case 'QUIZ_RESUME_TIMER':
      return makeOk(updateQuizState(state, (quizState) => {
        if (quizState.timerState.status !== 'paused') return quizState;
        const remaining = quizState.timerState.pausedRemainingMs ?? quizState.timerState.timerDurationMs;
        return {
          ...quizState,
          timerState: {
            ...quizState.timerState,
            status: 'running',
            timerStartedAt: now,
            timerDurationMs: remaining,
            pausedRemainingMs: null,
          },
        };
      }));

    case 'QUIZ_RESET_TIMER':
      return makeOk(updateQuizState(state, (quizState, activeSlide) => ({
        ...quizState,
        timerState: {
          status: 'idle',
          timerStartedAt: null,
          timerDurationMs: Math.max(1, Number(activeSlide.quizData.timerSeconds) || 30) * 1000,
          pausedRemainingMs: null,
        },
      })));

    case 'QUIZ_ADJUST_TIMER':
      return makeOk(updateQuizState(state, (quizState) => {
        const ms = payload.seconds * 1000;
        if (quizState.timerState.status === 'paused') {
          return { ...quizState, timerState: { ...quizState.timerState, pausedRemainingMs: ms } };
        }
        if (quizState.timerState.status === 'idle') {
          return { ...quizState, timerState: { ...quizState.timerState, timerDurationMs: ms } };
        }
        return quizState;
      }));

    case 'QUIZ_COMPLETE': {
      const activeSlide = getActiveSlide(state);
      const subslides = generateQuizSubslides(activeSlide?.quizData);
      const answerIndex = subslides.findIndex((subslide) => subslide.kind === 'respuesta');
      const next = updateQuizState(state, (quizState) => ({
        ...quizState,
        timerState: { ...getQuizTimerState(state), status: 'completed' },
      }));
      return makeOk(answerIndex >= 0 ? selectQuizSubslide(next, answerIndex, now) : next);
    }

    case 'QUIZ_SELECT_SUBSLIDE':
      return makeOk(selectQuizSubslide(state, payload.index, now));

    case 'QUIZ_DEMO_SELECT':
      return makeOk(updateQuizState(state, (quizState, activeSlide) => {
        const optionId = payload.optionId;
        const selected = activeSlide?.quizData?.options?.find(o => o.id === optionId);
        const feedbackType = selected ? (selected.isCorrect ? 'applause' : 'mal') : null;
        return {
          ...quizState,
          presenterDemoSelection: {
            ...(quizState.presenterDemoSelection ?? {}),
            [activeSlide.id]: optionId,
          },
          ...(feedbackType ? {
            feedbackSound: {
              type: feedbackType,
              timestamp: now,
            }
          } : {}),
        };
      }));

    case 'QUIZ_PLAY_APPLAUSE':
      return makeOk(updateQuizState(state, (quizState) => ({
        ...quizState,
        feedbackSound: {
          type: 'applause',
          timestamp: now,
        },
      })));

    case 'QUIZ_PLAY_MAL':
      return makeOk(updateQuizState(state, (quizState) => ({
        ...quizState,
        feedbackSound: {
          type: 'mal',
          timestamp: now,
        },
      })));

    case 'RESET_STATE':
      return makeOk({
        ...clone(DEFAULT_STATE),
        clientId: state.clientId,
        origin: state.origin,
        audioState: { ...clone(DEFAULT_AUDIO_STATE), timestamp: now },
      });

    default:
      return makeError(`Unsupported REMOTE_COMMAND: ${payload.command}`);
  }
};

