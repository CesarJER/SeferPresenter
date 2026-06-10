import type { AudioState, AudioSyncMap, AudioSyncMode } from '../types/audio';
import type { AppMode, Presentation, ScriptureNavState, Slide, VideoState } from '../types/presentation';
import type { QuizSyncState } from '../types/quiz';
import type { BroadcastMessage, DisplayTelemetryState, SyncStatePayload } from '../types/sync';

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value, errors: [] });
const fail = <T>(errors: string[]): ValidationResult<T> => ({ ok: false, errors });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStringOrUndefined = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

const isBooleanOrUndefined = (value: unknown): value is boolean | undefined =>
  value === undefined || typeof value === 'boolean';

const isStringRecordOrUndefined = (value: unknown): value is Record<string, string> | undefined =>
  value === undefined || (isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string'));

const slideTypes = new Set(['text', 'media', 'tanaj', 'sefer', 'quiz']);
const quizOptionIds = new Set(['A', 'B', 'C', 'D']);
const presentationModes = new Set(['standard', 'trilingual']);
const appModes = new Set(['slides', 'scripture', 'seferManual']);
const origins = new Set(['control', 'presenter']);
const audioSyncModes = new Set<AudioSyncMode>(['none', 'unilateral', 'bilateral']);
const audioChangeTypes = new Set(['track', 'volume', 'playState', 'seek', 'syncMode']);

// ── Quiz validators ──────────────────────────────────────────────────────────

const validateQuizOption = (value: unknown, path: string): ValidationResult<unknown> => {
  if (!isRecord(value)) return fail([`${path} debe ser un objeto.`]);
  const errors: string[] = [];
  if (typeof value.id !== 'string' || !quizOptionIds.has(value.id)) errors.push(`${path}.id debe ser A, B, C o D.`);
  if (typeof value.text !== 'string') errors.push(`${path}.text debe ser texto.`);
  if (typeof value.isCorrect !== 'boolean') errors.push(`${path}.isCorrect debe ser booleano.`);
  return errors.length > 0 ? fail(errors) : ok(value);
};

const validateQuizData = (value: unknown, path: string): ValidationResult<unknown> => {
  if (!isRecord(value)) return fail([`${path} debe ser un objeto.`]);
  const errors: string[] = [];
  const isResultsSlide = value.isResultsSlide === true;

  if (typeof value.question !== 'string') errors.push(`${path}.question debe ser texto.`);
  if (!Array.isArray(value.options)) {
    errors.push(`${path}.options debe ser un array.`);
  } else if (isResultsSlide) {
    if (value.options.length !== 0) errors.push(`${path}.options debe estar vacio en una diapositiva de resultados.`);
  } else if (value.options.length < 2 || value.options.length > 4) {
    errors.push(`${path}.options debe tener entre 2 y 4 opciones.`);
  } else {
    value.options.forEach((opt: unknown, i: number) => {
      const r = validateQuizOption(opt, `${path}.options[${i}]`);
      if (!r.ok) errors.push(...r.errors);
    });
  }
  if (typeof value.timerSeconds !== 'number' || !Number.isFinite(value.timerSeconds) || value.timerSeconds < 1) {
    errors.push(`${path}.timerSeconds debe ser un numero >= 1.`);
  }
  if (typeof value.randomize !== 'boolean') errors.push(`${path}.randomize debe ser booleano.`);
  if (typeof value.multiSelect !== 'boolean') errors.push(`${path}.multiSelect debe ser booleano.`);
  if (!isStringOrUndefined(value.citaRef)) errors.push(`${path}.citaRef debe ser texto.`);
  if (!isStringOrUndefined(value.citaReviewRef)) errors.push(`${path}.citaReviewRef debe ser texto.`);
  if (value.citaRef && value.citaReviewRef) errors.push(`${path}: no se puede tener CITA: y CITA!: a la vez.`);
  if (!isBooleanOrUndefined(value.isResultsSlide)) errors.push(`${path}.isResultsSlide debe ser booleano.`);
  if (isResultsSlide && !Array.isArray(value.resultProfiles)) {
    errors.push(`${path}.resultProfiles debe ser un array en una diapositiva de resultados.`);
  }

  return errors.length > 0 ? fail(errors) : ok(value);
};

// ── Slide validator ───────────────────────────────────────────────────────────

const validateSlideValue = (value: unknown, path: string): ValidationResult<Slide> => {
  if (!isRecord(value)) return fail([`${path} debe ser un objeto.`]);

  const errors: string[] = [];
  if (typeof value.id !== 'string' || value.id.trim() === '') errors.push(`${path}.id debe ser texto no vacio.`);
  if (typeof value.label !== 'string') errors.push(`${path}.label debe ser texto.`);
  if (!Array.isArray(value.lines) || !value.lines.every((line) => typeof line === 'string')) {
    errors.push(`${path}.lines debe ser un array de textos.`);
  }
  if (!isStringOrUndefined(value.background)) errors.push(`${path}.background debe ser texto.`);
  if (value.type !== undefined && (typeof value.type !== 'string' || !slideTypes.has(value.type))) {
    errors.push(`${path}.type no es valido.`);
  }
  if (!isStringOrUndefined(value.mediaSrc)) errors.push(`${path}.mediaSrc debe ser texto.`);
  if (!isStringOrUndefined(value.mediaFit)) errors.push(`${path}.mediaFit debe ser texto.`);
  if (value.mediaVolume !== undefined && !isFiniteNumber(value.mediaVolume)) errors.push(`${path}.mediaVolume debe ser numero.`);
  if (value.mediaSpeed !== undefined && !isFiniteNumber(value.mediaSpeed)) errors.push(`${path}.mediaSpeed debe ser numero.`);
  if (!isBooleanOrUndefined(value.mediaLoop)) errors.push(`${path}.mediaLoop debe ser booleano.`);
  if (!isBooleanOrUndefined(value.mediaPresenterNav)) errors.push(`${path}.mediaPresenterNav debe ser booleano.`);
  if (!isBooleanOrUndefined(value.mediaShowBg)) errors.push(`${path}.mediaShowBg debe ser booleano.`);
  if (value.mediaStart !== undefined && !isFiniteNumber(value.mediaStart)) errors.push(`${path}.mediaStart debe ser numero.`);
  if (value.mediaEnd !== undefined && !isFiniteNumber(value.mediaEnd)) errors.push(`${path}.mediaEnd debe ser numero.`);
  if (!isStringOrUndefined(value.scriptureBook)) errors.push(`${path}.scriptureBook debe ser texto.`);
  if (!isStringOrUndefined(value.scriptureChapter)) errors.push(`${path}.scriptureChapter debe ser texto.`);
  if (!isStringOrUndefined(value.scriptureVerseStart)) errors.push(`${path}.scriptureVerseStart debe ser texto.`);
  if (!isStringOrUndefined(value.scriptureVerseEnd)) errors.push(`${path}.scriptureVerseEnd debe ser texto.`);
  if (!isStringRecordOrUndefined(value.scriptureVerseBackgrounds)) {
    errors.push(`${path}.scriptureVerseBackgrounds debe ser un objeto texto/texto.`);
  }

  // Validate quizData if present
  if (value.quizData !== undefined) {
    const qr = validateQuizData(value.quizData, `${path}.quizData`);
    if (!qr.ok) errors.push(...qr.errors);
  }

  if (errors.length > 0) return fail(errors);

  const slide: Slide = {
    ...(value as Record<string, unknown>),
    id: value.id as string,
    label: value.label as string,
    lines: value.lines as string[],
  } as Slide;

  return ok(slide);
};

const validatePresentationValue = (value: unknown, path: string): ValidationResult<Presentation> => {
  if (!isRecord(value)) return fail([`${path} debe ser un objeto.`]);

  const errors: string[] = [];
  if (typeof value.id !== 'string' || value.id.trim() === '') errors.push(`${path}.id debe ser texto no vacio.`);
  if (typeof value.title !== 'string') errors.push(`${path}.title debe ser texto.`);
  if (value.background !== undefined && typeof value.background !== 'string') errors.push(`${path}.background debe ser texto.`);
  if (value.mode !== undefined && (typeof value.mode !== 'string' || !presentationModes.has(value.mode))) {
    errors.push(`${path}.mode no es valido.`);
  }
  if (value.fontScale !== undefined && !isFiniteNumber(value.fontScale)) errors.push(`${path}.fontScale debe ser numero.`);
  if (!Array.isArray(value.slides)) {
    errors.push(`${path}.slides debe ser un array.`);
  }

  const slides: Slide[] = [];
  if (Array.isArray(value.slides)) {
    value.slides.forEach((slide, index) => {
      const result = validateSlideValue(slide, `${path}.slides[${index}]`);
      if (result.ok && result.value) {
        slides.push(result.value);
      } else {
        errors.push(...result.errors);
      }
    });
  }

  if (errors.length > 0) return fail(errors);

  return ok({
    ...(value as Record<string, unknown>),
    id: value.id as string,
    title: value.title as string,
    background: typeof value.background === 'string' ? value.background : '',
    mode: (typeof value.mode === 'string' ? value.mode : 'standard') as Presentation['mode'],
    fontScale: isFiniteNumber(value.fontScale) ? value.fontScale : undefined,
    slides,
  } as Presentation);
};

export const validatePresentationList = (value: unknown): ValidationResult<Presentation[]> => {
  if (!Array.isArray(value)) return fail(['El valor debe ser un array de presentaciones.']);

  const errors: string[] = [];
  const presentations: Presentation[] = [];
  value.forEach((presentation, index) => {
    const result = validatePresentationValue(presentation, `presentations[${index}]`);
    if (result.ok && result.value) {
      presentations.push(result.value);
    } else {
      errors.push(...result.errors);
    }
  });

  return errors.length > 0 ? fail(errors) : ok(presentations);
};

export const validatePresentation = (value: unknown): ValidationResult<Presentation> =>
  validatePresentationValue(value, 'presentation');

const validateAudioSyncCue = (value: unknown, path: string): ValidationResult<AudioSyncMap['cues'][number]> => {
  if (!isRecord(value)) return fail([`${path} debe ser un objeto.`]);

  const errors: string[] = [];
  if (!isFiniteNumber(value.timeSec) || value.timeSec < 0) errors.push(`${path}.timeSec debe ser numero >= 0.`);
  if (!Number.isInteger(value.slideIndex) || (value.slideIndex as number) < 0) errors.push(`${path}.slideIndex debe ser entero >= 0.`);
  if (!isStringOrUndefined(value.verse)) errors.push(`${path}.verse debe ser texto.`);

  const cue: AudioSyncMap['cues'][number] = {
    ...(value as Record<string, unknown>),
    timeSec: value.timeSec as number,
    slideIndex: value.slideIndex as number,
  } as AudioSyncMap['cues'][number];

  return errors.length > 0 ? fail(errors) : ok(cue);
};

const validateAudioSyncMap = (value: unknown, path: string): ValidationResult<AudioSyncMap> => {
  if (!isRecord(value)) return fail([`${path} debe ser un objeto.`]);

  const errors: string[] = [];
  if (typeof value.id !== 'string' || value.id.trim() === '') errors.push(`${path}.id debe ser texto no vacio.`);
  if (typeof value.name !== 'string') errors.push(`${path}.name debe ser texto.`);
  if (typeof value.audioSrc !== 'string' || value.audioSrc.trim() === '') errors.push(`${path}.audioSrc debe ser texto no vacio.`);
  if (typeof value.presentationId !== 'string' || value.presentationId.trim() === '') errors.push(`${path}.presentationId debe ser texto no vacio.`);
  if (typeof value.defaultSyncMode !== 'string' || !audioSyncModes.has(value.defaultSyncMode as AudioSyncMode)) {
    errors.push(`${path}.defaultSyncMode no es valido.`);
  }
  if (!isFiniteNumber(value.defaultVolume) || value.defaultVolume < 0 || value.defaultVolume > 1) {
    errors.push(`${path}.defaultVolume debe estar entre 0 y 1.`);
  }
  if (!Array.isArray(value.cues)) errors.push(`${path}.cues debe ser un array.`);

  const cues: AudioSyncMap['cues'] = [];
  if (Array.isArray(value.cues)) {
    value.cues.forEach((cue, index) => {
      const result = validateAudioSyncCue(cue, `${path}.cues[${index}]`);
      if (result.ok && result.value) {
        cues.push(result.value);
      } else {
        errors.push(...result.errors);
      }
    });
  }

  return errors.length > 0
    ? fail(errors)
    : ok({ ...(value as Record<string, unknown>), cues } as AudioSyncMap);
};

export const validateAudioSyncMaps = (value: unknown): ValidationResult<AudioSyncMap[]> => {
  if (!Array.isArray(value)) return fail(['El valor debe ser un array de mapas de audio.']);

  const errors: string[] = [];
  const maps: AudioSyncMap[] = [];
  value.forEach((map, index) => {
    const result = validateAudioSyncMap(map, `audioSyncMaps[${index}]`);
    if (result.ok && result.value) {
      maps.push(result.value);
    } else {
      errors.push(...result.errors);
    }
  });

  return errors.length > 0 ? fail(errors) : ok(maps);
};

const validateVideoState = (value: unknown, path: string): ValidationResult<VideoState | null> => {
  if (value === null) return ok(null);
  if (!isRecord(value)) return fail([`${path} debe ser objeto o null.`]);

  const errors: string[] = [];
  if (typeof value.isPlaying !== 'boolean') errors.push(`${path}.isPlaying debe ser booleano.`);
  if (!isFiniteNumber(value.currentTime)) errors.push(`${path}.currentTime debe ser numero.`);
  if (!isFiniteNumber(value.duration)) errors.push(`${path}.duration debe ser numero.`);
  if (!isFiniteNumber(value.volume)) errors.push(`${path}.volume debe ser numero.`);
  if (!isFiniteNumber(value.speed)) errors.push(`${path}.speed debe ser numero.`);
  if (value.mediaSrc !== null && typeof value.mediaSrc !== 'string' && value.mediaSrc !== undefined) errors.push(`${path}.mediaSrc debe ser texto o null.`);
  if (value.videoSrc !== null && typeof value.videoSrc !== 'string' && value.videoSrc !== undefined) errors.push(`${path}.videoSrc debe ser texto o null.`);
  if (value.lastUpdatedBy !== 'controller' && value.lastUpdatedBy !== 'projection') errors.push(`${path}.lastUpdatedBy no es valido.`);
  if (!isFiniteNumber(value.timestamp)) errors.push(`${path}.timestamp debe ser numero.`);
  if (!isBooleanOrUndefined(value.loop)) errors.push(`${path}.loop debe ser booleano.`);
  if (value.startTime !== undefined && !isFiniteNumber(value.startTime)) errors.push(`${path}.startTime debe ser numero.`);
  if (value.endTime !== undefined && !isFiniteNumber(value.endTime)) errors.push(`${path}.endTime debe ser numero.`);

  return errors.length > 0 ? fail(errors) : ok(value as unknown as VideoState);
};

const validateAudioState = (value: unknown, path: string): ValidationResult<AudioState> => {
  if (!isRecord(value)) return fail([`${path} debe ser un objeto.`]);

  const errors: string[] = [];
  if (typeof value.isPlaying !== 'boolean') errors.push(`${path}.isPlaying debe ser booleano.`);
  if (!isFiniteNumber(value.currentTime)) errors.push(`${path}.currentTime debe ser numero.`);
  if (!isFiniteNumber(value.duration)) errors.push(`${path}.duration debe ser numero.`);
  if (!isFiniteNumber(value.volume) || value.volume < 0 || value.volume > 1) errors.push(`${path}.volume debe estar entre 0 y 1.`);
  if (value.audioSrc !== null && typeof value.audioSrc !== 'string') errors.push(`${path}.audioSrc debe ser texto o null.`);
  if (value.activeSyncMapId !== null && typeof value.activeSyncMapId !== 'string') errors.push(`${path}.activeSyncMapId debe ser texto o null.`);
  if (typeof value.syncMode !== 'string' || !audioSyncModes.has(value.syncMode as AudioSyncMode)) errors.push(`${path}.syncMode no es valido.`);
  if (value.lastUpdatedBy !== 'controller' && value.lastUpdatedBy !== 'projection') errors.push(`${path}.lastUpdatedBy no es valido.`);
  if (value.changeType !== undefined && (typeof value.changeType !== 'string' || !audioChangeTypes.has(value.changeType))) {
    errors.push(`${path}.changeType no es valido.`);
  }
  if (!isFiniteNumber(value.timestamp)) errors.push(`${path}.timestamp debe ser numero.`);

  return errors.length > 0 ? fail(errors) : ok(value as unknown as AudioState);
};

const validateScriptureState = (value: unknown, path: string): ValidationResult<ScriptureNavState | null> => {
  if (value === null) return ok(null);
  if (!isRecord(value)) return fail([`${path} debe ser objeto o null.`]);

  const requiredStrings = [
    'bookEs', 'bookHeb', 'bookAbbrevEs', 'chapter', 'verseStart', 'verse',
    'verseNikud', 'transliteration', 'translation',
  ];
  const errors = requiredStrings
    .filter((key) => typeof value[key] !== 'string')
    .map((key) => `${path}.${key} debe ser texto.`);

  if (!isFiniteNumber(value.verseIdx)) errors.push(`${path}.verseIdx debe ser numero.`);
  if (!isFiniteNumber(value.totalVerses)) errors.push(`${path}.totalVerses debe ser numero.`);
  if (!isStringOrUndefined(value.verseEnd)) errors.push(`${path}.verseEnd debe ser texto.`);
  if (value.scriptureKind !== undefined && value.scriptureKind !== 'tanaj' && value.scriptureKind !== 'sefer') errors.push(`${path}.scriptureKind no es valido.`);
  if (value.command !== undefined && value.command !== 'navigate' && value.command !== 'next' && value.command !== 'previous') errors.push(`${path}.command no es valido.`);
  if (value.commandId !== undefined && !isFiniteNumber(value.commandId)) errors.push(`${path}.commandId debe ser numero.`);
  if (value.hebrewFontSize !== undefined && !isFiniteNumber(value.hebrewFontSize)) errors.push(`${path}.hebrewFontSize debe ser numero.`);
  if (value.combinedTextBaseSize !== undefined && !isFiniteNumber(value.combinedTextBaseSize)) errors.push(`${path}.combinedTextBaseSize debe ser numero.`);

  return errors.length > 0 ? fail(errors) : ok(value as unknown as ScriptureNavState);
};

const validateDisplayState = (value: Record<string, unknown>, path: string): ValidationResult<DisplayTelemetryState> => {
  const errors: string[] = [];
  if (typeof value.backgroundLock !== 'boolean') errors.push(`${path}.backgroundLock debe ser booleano.`);
  if (value.lockedBackgroundValue !== null && typeof value.lockedBackgroundValue !== 'string') errors.push(`${path}.lockedBackgroundValue debe ser texto o null.`);
  if (value.userSelectedBackground !== null && typeof value.userSelectedBackground !== 'string') errors.push(`${path}.userSelectedBackground debe ser texto o null.`);

  return errors.length > 0 ? fail(errors) : ok(value as unknown as DisplayTelemetryState);
};

export const validateRemoteStatePayload = (value: unknown): ValidationResult<Partial<SyncStatePayload>> => {
  if (!isRecord(value)) return fail(['El payload remoto debe ser un objeto.']);

  const errors: string[] = [];
  const next: Mutable<Partial<SyncStatePayload>> = {};

  if (value.presentation !== undefined) {
    if (value.presentation === null) {
      next.presentation = null;
    } else {
      const result = validatePresentationValue(value.presentation, 'remote.presentation');
      if (result.ok) next.presentation = result.value;
      else errors.push(...result.errors);
    }
  }
  if (value.slideIndex !== undefined) {
    if (isFiniteNumber(value.slideIndex)) next.slideIndex = value.slideIndex;
    else errors.push('remote.slideIndex debe ser numero.');
  }
  if (value.backgroundLock !== undefined) {
    if (typeof value.backgroundLock === 'boolean') next.backgroundLock = value.backgroundLock;
    else errors.push('remote.backgroundLock debe ser booleano.');
  }
  if (value.lockedBackgroundValue !== undefined) {
    const lockedBg = value.lockedBackgroundValue;
    if (lockedBg === null || typeof lockedBg === 'string') {
      next.lockedBackgroundValue = lockedBg as string | null;
    } else {
      errors.push('remote.lockedBackgroundValue debe ser texto o null.');
    }
  }
  if (value.userSelectedBackground !== undefined) {
    const userBg = value.userSelectedBackground;
    if (userBg === null || typeof userBg === 'string') {
      next.userSelectedBackground = userBg as string | null;
    } else {
      errors.push('remote.userSelectedBackground debe ser texto o null.');
    }
  }
  if (value.videoState !== undefined) {
    const result = validateVideoState(value.videoState, 'remote.videoState');
    if (result.ok) next.videoState = result.value;
    else errors.push(...result.errors);
  }
  if (value.appMode !== undefined) {
    if (typeof value.appMode === 'string' && appModes.has(value.appMode)) next.appMode = value.appMode as AppMode;
    else errors.push('remote.appMode no es valido.');
  }
  if (value.scriptureState !== undefined) {
    const result = validateScriptureState(value.scriptureState, 'remote.scriptureState');
    if (result.ok) next.scriptureState = result.value;
    else errors.push(...result.errors);
  }
  if (value.audioState !== undefined) {
    const result = validateAudioState(value.audioState, 'remote.audioState');
    if (result.ok) next.audioState = result.value;
    else errors.push(...result.errors);
  }
  if (value.quizState !== undefined) {
    if (value.quizState === null || isRecord(value.quizState)) {
      next.quizState = value.quizState as QuizSyncState | null;
    } else {
      errors.push('remote.quizState debe ser objeto o null.');
    }
  }
  if (value.clientId !== undefined) {
    if (typeof value.clientId === 'string') {
      next.clientId = value.clientId;
    } else {
      errors.push('remote.clientId debe ser texto.');
    }
  }
  if (value.origin !== undefined) {
    if (typeof value.origin === 'string' && origins.has(value.origin)) {
      next.origin = value.origin as 'control' | 'presenter';
    } else {
      errors.push('remote.origin no es valido.');
    }
  }

  return errors.length > 0 ? fail(errors) : ok(next);
};

export const validateSyncMessage = (value: unknown): ValidationResult<BroadcastMessage> => {
  if (!isRecord(value) || typeof value.type !== 'string') return fail(['El mensaje de sync debe incluir type.']);

  const baseErrors: string[] = [];
  if (value.protocolVersion !== undefined && value.protocolVersion !== 1) baseErrors.push('protocolVersion no soportado.');
  if (value.timestamp !== undefined && !isFiniteNumber(value.timestamp)) baseErrors.push('timestamp debe ser numero.');

  if (value.type === 'REQUEST_STATE') {
    if (value.clientId !== undefined && typeof value.clientId !== 'string') baseErrors.push('clientId debe ser texto.');
    return baseErrors.length > 0 ? fail(baseErrors) : ok(value as unknown as BroadcastMessage);
  }

  if (value.type === 'AUDIO_SYNC_MAPS_UPDATE') {
    const result = validateAudioSyncMaps(value.maps);
    return baseErrors.length || !result.ok
      ? fail([...baseErrors, ...result.errors])
      : ok({ ...value, maps: result.value } as unknown as BroadcastMessage);
  }

  if (value.type === 'AUDIO_TELEMETRY') {
    const audio = validateAudioState(value.audioState, 'audioState');
    if (typeof value.clientId !== 'string') baseErrors.push('clientId debe ser texto.');
    if (typeof value.origin !== 'string' || !origins.has(value.origin)) baseErrors.push('origin no es valido.');
    return baseErrors.length || !audio.ok ? fail([...baseErrors, ...audio.errors]) : ok({ ...value, audioState: audio.value } as unknown as BroadcastMessage);
  }

  if (value.type === 'VIDEO_TELEMETRY') {
    const video = validateVideoState(value.videoState, 'videoState');
    if (typeof value.clientId !== 'string') baseErrors.push('clientId debe ser texto.');
    if (typeof value.origin !== 'string' || !origins.has(value.origin)) baseErrors.push('origin no es valido.');
    return baseErrors.length || !video.ok ? fail([...baseErrors, ...video.errors]) : ok({ ...value, videoState: video.value } as unknown as BroadcastMessage);
  }

  if (value.type === 'DISPLAY_TELEMETRY') {
    const display = validateDisplayState(value, 'display');
    if (typeof value.clientId !== 'string') baseErrors.push('clientId debe ser texto.');
    if (typeof value.origin !== 'string' || !origins.has(value.origin)) baseErrors.push('origin no es valido.');
    return baseErrors.length || !display.ok ? fail([...baseErrors, ...display.errors]) : ok(value as unknown as BroadcastMessage);
  }

  if (value.type === 'SYNC_STATE') {
    const remote = validateRemoteStatePayload(value);
    const errors = [...baseErrors, ...remote.errors];
    if (typeof value.clientId !== 'string') errors.push('clientId debe ser texto.');
    if (typeof value.origin !== 'string' || !origins.has(value.origin)) errors.push('origin no es valido.');
    if (value.presentation === undefined) errors.push('presentation es requerido.');
    if (value.slideIndex === undefined) errors.push('slideIndex es requerido.');
    if (value.backgroundLock === undefined) errors.push('backgroundLock es requerido.');
    if (value.lockedBackgroundValue === undefined) errors.push('lockedBackgroundValue es requerido.');
    if (value.userSelectedBackground === undefined) errors.push('userSelectedBackground es requerido.');
    if (value.videoState === undefined) errors.push('videoState es requerido.');
    if (value.appMode === undefined) errors.push('appMode es requerido.');
    if (value.scriptureState === undefined) errors.push('scriptureState es requerido.');
    if (value.audioState === undefined) errors.push('audioState es requerido.');
    return errors.length > 0 ? fail(errors) : ok({ ...value, ...remote.value } as unknown as BroadcastMessage);
  }

  if (value.type === 'REMOTE_COMMAND') {
    if (typeof value.clientId !== 'string') baseErrors.push('clientId debe ser texto.');
    if (!isRecord(value.payload)) {
      baseErrors.push('payload debe ser un objeto.');
    } else if (typeof value.payload.command !== 'string') {
      baseErrors.push('payload.command debe ser texto.');
    } else {
      // Basic semantic checks on known commands
      const payload = value.payload as Record<string, unknown>;
      switch (payload.command) {
        case 'TOGGLE_APP_MODE':
          if (!appModes.has(payload.mode as string)) baseErrors.push(`Modo invalido: ${payload.mode}`);
          break;
        case 'SELECT_BG_OVERRIDE':
          if (payload.bg !== null && typeof payload.bg !== 'string') baseErrors.push('bg debe ser texto o null');
          break;
        case 'QUIZ_SELECT_SUBSLIDE':
          if (!Number.isInteger(payload.index) || (payload.index as number) < 0) baseErrors.push('index debe ser entero >= 0');
          break;
        case 'SCRIPTURE_ARROW_NAV':
          if (payload.direction !== 'up' && payload.direction !== 'down') baseErrors.push('direction debe ser up o down');
          break;
        case 'SCRIPTURE_BOUNDARY':
          if (payload.direction !== 'next' && payload.direction !== 'previous') baseErrors.push('direction debe ser next o previous');
          break;
      }
    }
    return baseErrors.length > 0 ? fail(baseErrors) : ok(value as unknown as BroadcastMessage);
  }

  return fail([`Tipo de mensaje no soportado: ${value.type}`]);
};
