import type { AudioState, AudioSyncMap, AudioSyncMode, AudioTimelineAction, AudioTimelineState } from '../types/audio';
import type { LiveAudioBroadcastMessage, LiveAudioParticipantRole, PrivateControlSignalMessage } from '../types/liveAudio';
import type { AppMode, Presentation, ScriptureNavState, Slide, VideoState } from '../types/presentation';
import type { QuizSyncState } from '../types/quiz';
import type { AutoduckState, BroadcastMessage, DisplayTelemetryState, SyncStatePayload } from '../types/sync';

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

const isStringMatrixOrUndefined = (value: unknown): value is string[][] | undefined =>
  value === undefined || (
    Array.isArray(value) &&
    value.every((row) => Array.isArray(row) && row.every((entry) => typeof entry === 'string'))
  );

const slideTypes = new Set(['text', 'media', 'tanaj', 'sefer', 'quiz']);
const mediaFits = new Set(['cover', 'contain', 'fill']);
const quizOptionIds = new Set(['A', 'B', 'C', 'D']);
const quizTimerStatuses = new Set(['idle', 'running', 'paused', 'expired', 'completed']);
const quizFeedbackSounds = new Set(['applause', 'mal', 'bip']);
const presentationModes = new Set(['standard', 'trilingual']);
const appModes = new Set(['slides', 'scripture', 'seferManual']);
const origins = new Set(['control', 'presenter']);
const audioSyncModes = new Set<AudioSyncMode>(['none', 'unilateral', 'bilateral']);
const audioChangeTypes = new Set(['track', 'volume', 'playState', 'seek', 'syncMode']);
const wsRoles = new Set(['presenter', 'control', 'audience', 'unknown']);
const audioTimelineStatuses = new Set<AudioTimelineState['status']>(['idle', 'loading', 'playing', 'paused', 'ended']);
const audioTimelineUpdatedBy = new Set<AudioTimelineState['updatedBy']>(['control', 'presenter', 'server']);
const liveAudioParticipantRoles = new Set<LiveAudioParticipantRole>(['audience', 'control', 'presenter']);
const liveAudioPrivateSignalSenderRoles = new Set<LiveAudioParticipantRole>(['audience', 'control']);
const liveAudioSpeakerStates = new Set(['LISTENER', 'REQUESTED', 'GRANTED', 'MUTED', 'REVOKED']);
const liveAudioControlStates = new Set(['PRINCIPAL', 'PENDING', 'AUTHORIZED']);
const liveAudioOperationalRoles = new Set(['pasivo', 'activo', 'cola', 'orador', 'control', 'presenter']);
const liveAudioMicrophonePermissionStates = new Set(['unknown', 'prompt', 'denied', 'granted', 'unavailable']);
const liveAudioMicrophoneTrackStates = new Set(['notRequested', 'off', 'publishing', 'mutedByUser', 'mutedByControl', 'error']);
const liveAudioMessageTypes = new Set([
  'LIVE_AUDIO_PARTICIPANT_STATUS',
  'LIVE_AUDIO_CONNECTION_COUNTS',
  'LIVE_AUDIO_GRANT_SPEAK',
  'LIVE_AUDIO_REVOKE_SPEAK',
  'LIVE_AUDIO_MUTE_PARTICIPANT',
  'LIVE_AUDIO_MUTE_ALL',
  'LIVE_AUDIO_KICK_PARTICIPANT',
  'LIVE_AUDIO_RESCUE_PARTICIPANT',
  'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION',
  'LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION',
  'LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY',
  'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT',
  'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE',
  'LIVE_AUDIO_SET_EXTERNAL_BROADCAST_STATE',
  'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE',
  'LIVE_AUDIO_CONTROL_PUBLIC_KEY',
  'LIVE_AUDIO_CONTROL_JOIN_REQUEST',
  'LIVE_AUDIO_CONTROL_AUTHORIZED',
  'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE',
  'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION',
  'CONTROL_KEY_ROTATED',
  'PRIVATE_CONTROL_SIGNAL',
  'LIVE_AUDIO_REQUEST_ALIASES',
  'LIVE_AUDIO_SNAPSHOT_REQUEST',
  'LIVE_AUDIO_SNAPSHOT',
  'LIVE_AUDIO_SNAPSHOT_PATCH',
]);
const privateControlSignalAllowedKeys = new Set([
  'type',
  'fromParticipantId',
  'toControlSessionId',
  'toParticipantId',
  'keyId',
  'ephemeralPublicKey',
  'ciphertext',
  'nonce',
  'createdAt',
  'protocolVersion',
  'timestamp',
  'messageId',
]);

export const PRIVATE_CONTROL_SIGNAL_MAX_CIPHERTEXT_BYTES = 4096;

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const controlVerificationCodePattern = /^\d{3}-\d{3}$/;

export const isValidEphemeralParticipantId = (id: unknown): id is string =>
  typeof id === 'string' && uuidV4Pattern.test(id);

export const isValidControlVerificationCode = (code: unknown): code is string =>
  typeof code === 'string' && controlVerificationCodePattern.test(code);

const isValidBase64 = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && base64Pattern.test(value);

const getBase64ByteLength = (value: string): number => {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
};

const validateOptionalCreatedAt = (value: Record<string, unknown>, path: string, errors: string[]) => {
  if (value.createdAt !== undefined && !isFiniteNumber(value.createdAt)) errors.push(`${path}.createdAt debe ser numero.`);
};

const validateOptionalParticipantId = (value: unknown, path: string, errors: string[]) => {
  if (value !== undefined && !isValidEphemeralParticipantId(value)) {
    errors.push(`${path} debe ser UUID v4 efimero.`);
  }
};

const validateStringArray = (value: unknown, path: string, errors: string[]) => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    errors.push(`${path} debe ser un array de textos.`);
  }
};

const validateParticipantId = (value: unknown, path: string, errors: string[]) => {
  if (!isValidEphemeralParticipantId(value)) errors.push(`${path} debe ser UUID v4 efimero.`);
};

const validatePrivateSignalSenderId = (
  value: unknown,
  senderRole: LiveAudioParticipantRole | undefined,
  hasParticipantTarget: boolean,
  errors: string[],
) => {
  if (senderRole === 'control' || (senderRole === undefined && hasParticipantTarget)) {
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push('PRIVATE_CONTROL_SIGNAL.fromParticipantId debe ser texto no vacio.');
    }
    return;
  }

  validateParticipantId(value, 'PRIVATE_CONTROL_SIGNAL.fromParticipantId', errors);
};

const validatePrivateControlSignalValue = (
  msg: unknown,
  senderRole?: LiveAudioParticipantRole,
): ValidationResult<PrivateControlSignalMessage> => {
  if (!isRecord(msg)) return fail(['PRIVATE_CONTROL_SIGNAL debe ser un objeto.']);

  const errors: string[] = [];
  Object.keys(msg).forEach((key) => {
    if (!privateControlSignalAllowedKeys.has(key)) errors.push(`PRIVATE_CONTROL_SIGNAL.${key} no esta permitido.`);
  });
  if (msg.type !== 'PRIVATE_CONTROL_SIGNAL') errors.push('PRIVATE_CONTROL_SIGNAL.type no es valido.');
  validatePrivateSignalSenderId(msg.fromParticipantId, senderRole, msg.toParticipantId !== undefined, errors);
  if (msg.toControlSessionId !== undefined && typeof msg.toControlSessionId !== 'string') {
    errors.push('PRIVATE_CONTROL_SIGNAL.toControlSessionId debe ser texto.');
  }
  if (msg.toParticipantId !== undefined && !isValidEphemeralParticipantId(msg.toParticipantId)) {
    errors.push('PRIVATE_CONTROL_SIGNAL.toParticipantId debe ser UUID v4 efimero.');
  }
  if (typeof msg.keyId !== 'string' || msg.keyId.trim() === '') errors.push('PRIVATE_CONTROL_SIGNAL.keyId debe ser texto no vacio.');
  if (!isValidBase64(msg.ephemeralPublicKey)) errors.push('PRIVATE_CONTROL_SIGNAL.ephemeralPublicKey debe ser base64.');
  if (!isValidBase64(msg.ciphertext)) {
    errors.push('PRIVATE_CONTROL_SIGNAL.ciphertext debe ser base64.');
  } else if (getBase64ByteLength(msg.ciphertext) > PRIVATE_CONTROL_SIGNAL_MAX_CIPHERTEXT_BYTES) {
    errors.push(`PRIVATE_CONTROL_SIGNAL.ciphertext no puede superar ${PRIVATE_CONTROL_SIGNAL_MAX_CIPHERTEXT_BYTES} bytes.`);
  }
  if (!isValidBase64(msg.nonce)) {
    errors.push('PRIVATE_CONTROL_SIGNAL.nonce debe ser base64.');
  } else if (getBase64ByteLength(msg.nonce) !== 12) {
    errors.push('PRIVATE_CONTROL_SIGNAL.nonce debe codificar 12 bytes.');
  }
  validateOptionalCreatedAt(msg, 'PRIVATE_CONTROL_SIGNAL', errors);

  if (senderRole !== undefined && !liveAudioPrivateSignalSenderRoles.has(senderRole)) {
    errors.push('PRIVATE_CONTROL_SIGNAL no esta permitido para este rol.');
  }
  if (senderRole === 'audience' && msg.toParticipantId !== undefined) {
    errors.push('PRIVATE_CONTROL_SIGNAL.toParticipantId no esta permitido desde audiencia.');
  }
  if (senderRole === 'control' && msg.toParticipantId === undefined) {
    errors.push('PRIVATE_CONTROL_SIGNAL.toParticipantId es requerido desde control.');
  }

  return errors.length > 0 ? fail(errors) : ok(msg as unknown as PrivateControlSignalMessage);
};

/**
 * Validates only technical shape and caller-supplied role. A valid UUID format is
 * not authorization: the backend must verify at runtime that participantId is
 * bound to an active WebSocket/session and to the authorized role for the action.
 */
export const isValidPrivateControlSignal = (
  msg: unknown,
  senderRole?: LiveAudioParticipantRole,
): msg is PrivateControlSignalMessage => validatePrivateControlSignalValue(msg, senderRole).ok;

const validateOperationalParticipantSnapshot = (
  value: unknown,
  path: string,
  errors: string[],
) => {
  if (!isRecord(value)) {
    errors.push(`${path} debe ser un objeto.`);
    return;
  }
  validateParticipantId(value.participantId, `${path}.participantId`, errors);
  if (typeof value.role !== 'string' || !liveAudioParticipantRoles.has(value.role as LiveAudioParticipantRole)) {
    errors.push(`${path}.role no es valido.`);
  }
  if (value.alias !== undefined && typeof value.alias !== 'string') errors.push(`${path}.alias debe ser texto.`);
  if (typeof value.operationalRole !== 'string' || !liveAudioOperationalRoles.has(value.operationalRole)) {
    errors.push(`${path}.operationalRole no es valido.`);
  }
  if (typeof value.microphonePermissionState !== 'string' || !liveAudioMicrophonePermissionStates.has(value.microphonePermissionState)) {
    errors.push(`${path}.microphonePermissionState no es valido.`);
  }
  if (typeof value.microphoneTrackState !== 'string' || !liveAudioMicrophoneTrackStates.has(value.microphoneTrackState)) {
    errors.push(`${path}.microphoneTrackState no es valido.`);
  }
  if (typeof value.speakerState !== 'string' || !liveAudioSpeakerStates.has(value.speakerState)) {
    errors.push(`${path}.speakerState no es valido.`);
  }
  [
    'canSubscribe',
    'canPublishAudio',
    'isMuted',
    'isActiveAudience',
    'isMicrophoneActive',
    'isKicked',
    'connected',
  ].forEach((key) => {
    if (typeof value[key] !== 'boolean') errors.push(`${path}.${key} debe ser booleano.`);
  });
  if (value.connectedAt !== undefined && !isFiniteNumber(value.connectedAt)) errors.push(`${path}.connectedAt debe ser numero.`);
  if (value.disconnectedAt !== undefined && !isFiniteNumber(value.disconnectedAt)) errors.push(`${path}.disconnectedAt debe ser numero.`);
  if (!isFiniteNumber(value.updatedAt)) errors.push(`${path}.updatedAt debe ser numero.`);
};

const validateOperationalSnapshot = (snapshot: unknown, path: string, errors: string[]) => {
  if (!isRecord(snapshot)) {
    errors.push(`${path} debe ser un objeto.`);
    return;
  }
  if (typeof snapshot.snapshotId !== 'string' || snapshot.snapshotId.trim() === '') errors.push(`${path}.snapshotId debe ser texto no vacio.`);
  if (!isFiniteNumber(snapshot.createdAt)) errors.push(`${path}.createdAt debe ser numero.`);
  if (!isRecord(snapshot.connectionCounts)) {
    errors.push(`${path}.connectionCounts debe ser un objeto.`);
  } else {
    const connectionCounts = snapshot.connectionCounts;
    ['totalConnections', 'audienceConnections', 'controlConnections', 'presenterConnections'].forEach((key) => {
      if (!Number.isInteger(connectionCounts[key]) || (connectionCounts[key] as number) < 0) {
        errors.push(`${path}.connectionCounts.${key} debe ser entero >= 0.`);
      }
    });
    if (!isFiniteNumber(connectionCounts.updatedAt)) errors.push(`${path}.connectionCounts.updatedAt debe ser numero.`);
  }
  if (!Array.isArray(snapshot.participants)) {
    errors.push(`${path}.participants debe ser un array.`);
  } else {
    snapshot.participants.forEach((participant, index) => {
      validateOperationalParticipantSnapshot(participant, `${path}.participants[${index}]`, errors);
    });
  }
  validateStringArray(snapshot.interventionQueue, `${path}.interventionQueue`, errors);

  if (!isRecord(snapshot.policies) || !['PUBLIC', 'CONTROLLED'].includes(snapshot.policies.accessMode as string)) {
    errors.push(`${path}.policies.accessMode debe ser PUBLIC o CONTROLLED.`);
  }
  if (!Array.isArray(snapshot.audienceAccessRequests)) {
    errors.push(`${path}.audienceAccessRequests debe ser un array.`);
  } else {
    snapshot.audienceAccessRequests.forEach((request, index) => {
      if (!isRecord(request)) {
        errors.push(`${path}.audienceAccessRequests[${index}] debe ser un objeto.`);
        return;
      }
      if (typeof request.participantId !== 'string' || request.participantId.trim() === '') {
        errors.push(`${path}.audienceAccessRequests[${index}].participantId debe ser texto no vacio.`);
      }
      if (!isFiniteNumber(request.requestedAt)) {
        errors.push(`${path}.audienceAccessRequests[${index}].requestedAt debe ser numero.`);
      }
      if (request.accessState !== 'WAITING' && request.accessState !== 'BLOCKED') {
        errors.push(`${path}.audienceAccessRequests[${index}].accessState debe ser WAITING o BLOCKED.`);
      }
    });
  }

  if (!isRecord(snapshot.authorizations)) {
    errors.push(`${path}.authorizations debe ser un objeto.`);
  } else {
    const auth = snapshot.authorizations;
    if (auth.principalControlSessionId !== null && typeof auth.principalControlSessionId !== 'string') {
      errors.push(`${path}.authorizations.principalControlSessionId debe ser texto o null.`);
    }
    if (!Array.isArray(auth.controls)) {
      errors.push(`${path}.authorizations.controls debe ser un array.`);
    } else {
      auth.controls.forEach((control, index) => {
        if (!isRecord(control)) {
          errors.push(`${path}.authorizations.controls[${index}] debe ser un objeto.`);
          return;
        }
        if (typeof control.controlSessionId !== 'string') errors.push(`${path}.authorizations.controls[${index}].controlSessionId debe ser texto.`);
        if (typeof control.clientId !== 'string') errors.push(`${path}.authorizations.controls[${index}].clientId debe ser texto.`);
        if (typeof control.controlState !== 'string' || !liveAudioControlStates.has(control.controlState)) {
          errors.push(`${path}.authorizations.controls[${index}].controlState no es valido.`);
        }
        if (!isFiniteNumber(control.connectedAt)) errors.push(`${path}.authorizations.controls[${index}].connectedAt debe ser numero.`);
        if (!isFiniteNumber(control.authorizedAt)) errors.push(`${path}.authorizations.controls[${index}].authorizedAt debe ser numero.`);
        if (control.codeExpiresAt !== undefined && !isFiniteNumber(control.codeExpiresAt)) {
          errors.push(`${path}.authorizations.controls[${index}].codeExpiresAt debe ser numero.`);
        }
      });
    }
    if (!Array.isArray(auth.pendingControls)) errors.push(`${path}.authorizations.pendingControls debe ser un array.`);
    if (typeof auth.allowDelegatedModerators !== 'boolean') errors.push(`${path}.authorizations.allowDelegatedModerators debe ser booleano.`);
  }

  if (!isRecord(snapshot.liveKit)) {
    errors.push(`${path}.liveKit debe ser un objeto.`);
  } else {
    const liveKit = snapshot.liveKit;
    if (liveKit.enabled !== undefined && typeof liveKit.enabled !== 'boolean') errors.push(`${path}.liveKit.enabled debe ser booleano.`);
    if (liveKit.available !== undefined && typeof liveKit.available !== 'boolean') errors.push(`${path}.liveKit.available debe ser booleano.`);
    if (!Array.isArray(liveKit.participants)) errors.push(`${path}.liveKit.participants debe ser un array.`);
    validateStringArray(liveKit.speakers, `${path}.liveKit.speakers`, errors);
    validateStringArray(liveKit.muted, `${path}.liveKit.muted`, errors);
    validateStringArray(liveKit.kicked, `${path}.liveKit.kicked`, errors);
  }

  if (!isRecord(snapshot.quizAggregate)) {
    errors.push(`${path}.quizAggregate debe ser un objeto.`);
  } else {
    const quiz = snapshot.quizAggregate;
    if (!isRecord(quiz.submittedAnswersBySlideId)) {
      errors.push(`${path}.quizAggregate.submittedAnswersBySlideId debe ser un objeto.`);
    } else {
      Object.values(quiz.submittedAnswersBySlideId).forEach((count) => {
        if (!Number.isInteger(count) || (count as number) < 0) {
          errors.push(`${path}.quizAggregate.submittedAnswersBySlideId contiene conteos invalidos.`);
        }
      });
    }
    if (quiz.finalScoreRanges !== undefined && !isRecord(quiz.finalScoreRanges)) {
      errors.push(`${path}.quizAggregate.finalScoreRanges debe ser un objeto.`);
    }
    if (!Number.isInteger(quiz.totalFinalScores) || (quiz.totalFinalScores as number) < 0) {
      errors.push(`${path}.quizAggregate.totalFinalScores debe ser entero >= 0.`);
    }
    if (!Number.isInteger(quiz.minimumGroupSize) || (quiz.minimumGroupSize as number) < 2) {
      errors.push(`${path}.quizAggregate.minimumGroupSize debe ser entero >= 2.`);
    }
    if (quiz.updatedAt !== null && !isFiniteNumber(quiz.updatedAt)) errors.push(`${path}.quizAggregate.updatedAt debe ser numero o null.`);
  }
};

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
  } else if (value.resultProfiles !== undefined) {
    if (!Array.isArray(value.resultProfiles)) {
      errors.push(`${path}.resultProfiles debe ser un array.`);
    } else {
      const ranks = new Set<number>();
      value.resultProfiles.forEach((profile: unknown, index: number) => {
        const profilePath = `${path}.resultProfiles[${index}]`;
        if (!isRecord(profile)) {
          errors.push(`${profilePath} debe ser un objeto.`);
          return;
        }
        if (!Number.isInteger(profile.rank) || (profile.rank as number) < 1) {
          errors.push(`${profilePath}.rank debe ser entero >= 1.`);
        } else if (ranks.has(profile.rank as number)) {
          errors.push(`${profilePath}.rank no puede estar duplicado.`);
        } else {
          ranks.add(profile.rank as number);
        }
        for (const field of ['title', 'description', 'giftText'] as const) {
          if (typeof profile[field] !== 'string') errors.push(`${profilePath}.${field} debe ser texto.`);
        }
      });
    }
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
  if (value.mediaFit !== undefined && (typeof value.mediaFit !== 'string' || !mediaFits.has(value.mediaFit))) {
    errors.push(`${path}.mediaFit no es valido.`);
  }
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
  if (!isStringMatrixOrUndefined(value.scriptureVerses)) {
    errors.push(`${path}.scriptureVerses debe ser un array de arrays de textos.`);
  }
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
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === 'string')) {
      errors.push(`${path}.tags debe ser un array de textos.`);
    }
  }
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
    tags: Array.isArray(value.tags) ? Array.from(new Set(value.tags.map(String).map(s => s.trim()).filter(Boolean))) : undefined,
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
  if (!isFiniteNumber(value.volume) || value.volume < 0 || value.volume > 1) errors.push(`${path}.volume debe estar entre 0 y 1.`);
  if (!isFiniteNumber(value.speed)) errors.push(`${path}.speed debe ser numero.`);
  if (value.mediaSrc !== null && typeof value.mediaSrc !== 'string' && value.mediaSrc !== undefined) errors.push(`${path}.mediaSrc debe ser texto o null.`);
  if (value.videoSrc !== null && typeof value.videoSrc !== 'string' && value.videoSrc !== undefined) errors.push(`${path}.videoSrc debe ser texto o null.`);
  if (value.lastUpdatedBy !== 'controller' && value.lastUpdatedBy !== 'projection') errors.push(`${path}.lastUpdatedBy no es valido.`);
  if (!isFiniteNumber(value.timestamp)) errors.push(`${path}.timestamp debe ser numero.`);
  if (!isBooleanOrUndefined(value.loop)) errors.push(`${path}.loop debe ser booleano.`);
  if (value.startTime !== undefined && !isFiniteNumber(value.startTime)) errors.push(`${path}.startTime debe ser numero.`);
  if (value.endTime !== undefined && !isFiniteNumber(value.endTime)) errors.push(`${path}.endTime debe ser numero.`);
  if (value.seekId !== undefined && !isFiniteNumber(value.seekId)) errors.push(`${path}.seekId debe ser numero.`);

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

const validateAudioTimelineAction = (value: unknown, path: string): ValidationResult<AudioTimelineAction> => {
  if (!isRecord(value) || typeof value.type !== 'string') return fail([`${path} debe incluir type.`]);

  const errors: string[] = [];
  switch (value.type) {
    case 'SET_TRACK':
      if (typeof value.presentationId !== 'string') errors.push(`${path}.presentationId debe ser texto.`);
      if (typeof value.audioSrc !== 'string') errors.push(`${path}.audioSrc debe ser texto.`);
      if (!isStringOrUndefined(value.syncMapId)) errors.push(`${path}.syncMapId debe ser texto.`);
      if (value.syncMode !== undefined && (typeof value.syncMode !== 'string' || !audioSyncModes.has(value.syncMode as AudioSyncMode))) {
        errors.push(`${path}.syncMode no es valido.`);
      }
      if (value.volume !== undefined && (!isFiniteNumber(value.volume) || value.volume < 0 || value.volume > 1)) {
        errors.push(`${path}.volume debe estar entre 0 y 1.`);
      }
      break;
    case 'PLAY':
      if (value.positionSec !== undefined && !isFiniteNumber(value.positionSec)) errors.push(`${path}.positionSec debe ser numero.`);
      break;
    case 'PAUSE':
    case 'STOP':
      break;
    case 'SEEK':
      if (!isFiniteNumber(value.positionSec)) errors.push(`${path}.positionSec debe ser numero.`);
      break;
    case 'SET_RATE':
      if (!isFiniteNumber(value.rate)) errors.push(`${path}.rate debe ser numero.`);
      break;
    case 'SET_VOLUME':
      if (!isFiniteNumber(value.volume) || value.volume < 0 || value.volume > 1) errors.push(`${path}.volume debe estar entre 0 y 1.`);
      break;
    case 'SET_DURATION':
      if (value.durationSec !== null && (!isFiniteNumber(value.durationSec) || value.durationSec <= 0)) {
        errors.push(`${path}.durationSec debe ser numero positivo o null.`);
      }
      break;
    case 'SET_LOOP':
      if (typeof value.loop !== 'boolean') errors.push(`${path}.loop debe ser booleano.`);
      break;
    case 'SET_SYNC_MODE':
      if (typeof value.mode !== 'string' || !audioSyncModes.has(value.mode as AudioSyncMode)) errors.push(`${path}.mode no es valido.`);
      break;
    case 'END':
      if (value.positionSec !== undefined && !isFiniteNumber(value.positionSec)) errors.push(`${path}.positionSec debe ser numero.`);
      break;
    default:
      errors.push(`${path}.type no es valido.`);
      break;
  }

  return errors.length > 0 ? fail(errors) : ok(value as unknown as AudioTimelineAction);
};

const validateNullableNumber = (value: unknown, path: string, errors: string[]) => {
  if (value !== null && !isFiniteNumber(value)) errors.push(`${path} debe ser numero o null.`);
};

const validateAudioTimelineState = (value: unknown, path: string): ValidationResult<AudioTimelineState> => {
  if (!isRecord(value)) return fail([`${path} debe ser un objeto.`]);

  const errors: string[] = [];
  if (typeof value.timelineId !== 'string') errors.push(`${path}.timelineId debe ser texto.`);
  if (!isFiniteNumber(value.version)) errors.push(`${path}.version debe ser numero.`);
  if (value.presentationId !== null && typeof value.presentationId !== 'string') errors.push(`${path}.presentationId debe ser texto o null.`);
  if (value.audioSrc !== null && typeof value.audioSrc !== 'string') errors.push(`${path}.audioSrc debe ser texto o null.`);
  if (value.syncMapId !== null && typeof value.syncMapId !== 'string') errors.push(`${path}.syncMapId debe ser texto o null.`);
  if (typeof value.status !== 'string' || !audioTimelineStatuses.has(value.status as AudioTimelineState['status'])) errors.push(`${path}.status no es valido.`);
  if (!isFiniteNumber(value.basePositionSec)) errors.push(`${path}.basePositionSec debe ser numero.`);
  if (!isFiniteNumber(value.baseServerTimeMs)) errors.push(`${path}.baseServerTimeMs debe ser numero.`);
  if (!isFiniteNumber(value.playbackRate)) errors.push(`${path}.playbackRate debe ser numero.`);
  if (!isFiniteNumber(value.volume) || value.volume < 0 || value.volume > 1) errors.push(`${path}.volume debe estar entre 0 y 1.`);
  if (value.durationSec !== undefined && value.durationSec !== null && (!isFiniteNumber(value.durationSec) || value.durationSec <= 0)) {
    errors.push(`${path}.durationSec debe ser numero positivo o null.`);
  }
  if (value.loop !== undefined && typeof value.loop !== 'boolean') errors.push(`${path}.loop debe ser booleano.`);
  if (typeof value.syncMode !== 'string' || !audioSyncModes.has(value.syncMode as AudioSyncMode)) errors.push(`${path}.syncMode no es valido.`);
  validateNullableNumber(value.activeCueIndex, `${path}.activeCueIndex`, errors);
  validateNullableNumber(value.nextCueIndex, `${path}.nextCueIndex`, errors);
  if (typeof value.updatedBy !== 'string' || !audioTimelineUpdatedBy.has(value.updatedBy as AudioTimelineState['updatedBy'])) errors.push(`${path}.updatedBy no es valido.`);

  return errors.length > 0 ? fail(errors) : ok(value as unknown as AudioTimelineState);
};

const validateLiveAudioBroadcastMessage = (value: Record<string, unknown>): ValidationResult<LiveAudioBroadcastMessage> => {
  const errors: string[] = [];

  switch (value.type) {
    case 'PRIVATE_CONTROL_SIGNAL':
      return validatePrivateControlSignalValue(value);
    case 'LIVE_AUDIO_PARTICIPANT_STATUS':
      validateParticipantId(value.participantId, 'participantId', errors);
      if (typeof value.role !== 'string' || !liveAudioParticipantRoles.has(value.role as LiveAudioParticipantRole)) errors.push('role no es valido.');
      if (typeof value.speakerState !== 'string' || !liveAudioSpeakerStates.has(value.speakerState)) errors.push('speakerState no es valido.');
      if (value.controlState !== undefined && (typeof value.controlState !== 'string' || !liveAudioControlStates.has(value.controlState))) {
        errors.push('controlState no es valido.');
      }
      if (typeof value.canSubscribe !== 'boolean') errors.push('canSubscribe debe ser booleano.');
      if (typeof value.canPublishAudio !== 'boolean') errors.push('canPublishAudio debe ser booleano.');
      if (!isBooleanOrUndefined(value.isMuted)) errors.push('isMuted debe ser booleano.');
      if (!isBooleanOrUndefined(value.isActiveAudience)) errors.push('isActiveAudience debe ser booleano.');
      if (!isBooleanOrUndefined(value.isMicrophoneActive)) errors.push('isMicrophoneActive debe ser booleano.');
      if (!isBooleanOrUndefined(value.isKicked)) errors.push('isKicked debe ser booleano.');
      if (value.updatedAt !== undefined && !isFiniteNumber(value.updatedAt)) errors.push('updatedAt debe ser numero.');
      break;
    case 'LIVE_AUDIO_CONNECTION_COUNTS':
      if (!Number.isInteger(value.totalConnections) || (value.totalConnections as number) < 0) {
        errors.push('totalConnections debe ser entero >= 0.');
      }
      if (!Number.isInteger(value.audienceConnections) || (value.audienceConnections as number) < 0) {
        errors.push('audienceConnections debe ser entero >= 0.');
      }
      if (!Number.isInteger(value.controlConnections) || (value.controlConnections as number) < 0) {
        errors.push('controlConnections debe ser entero >= 0.');
      }
      if (!Number.isInteger(value.presenterConnections) || (value.presenterConnections as number) < 0) {
        errors.push('presenterConnections debe ser entero >= 0.');
      }
      if (value.updatedAt !== undefined && !isFiniteNumber(value.updatedAt)) errors.push('updatedAt debe ser numero.');
      break;
    case 'LIVE_AUDIO_GRANT_SPEAK':
    case 'LIVE_AUDIO_REVOKE_SPEAK':
    case 'LIVE_AUDIO_MUTE_PARTICIPANT':
    case 'LIVE_AUDIO_KICK_PARTICIPANT':
    case 'LIVE_AUDIO_RESCUE_PARTICIPANT':
      validateParticipantId(value.participantId, 'participantId', errors);
      validateOptionalParticipantId(value.issuedByParticipantId, 'issuedByParticipantId', errors);
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_MUTE_ALL':
      validateOptionalParticipantId(value.issuedByParticipantId, 'issuedByParticipantId', errors);
      if (value.excludeParticipantIds !== undefined) {
        if (!Array.isArray(value.excludeParticipantIds)) {
          errors.push('excludeParticipantIds debe ser un array.');
        } else {
          value.excludeParticipantIds.forEach((participantId, index) => {
            validateParticipantId(participantId, `excludeParticipantIds[${index}]`, errors);
          });
        }
      }
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION':
    case 'LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION':
      validateParticipantId(value.participantId, 'participantId', errors);
      if (typeof value.canViewActiveParticipants !== 'boolean') errors.push('canViewActiveParticipants debe ser booleano.');
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY':
      validateParticipantId(value.participantId, 'participantId', errors);
      if (typeof value.isAliasHiddenByControl !== 'boolean') errors.push('isAliasHiddenByControl debe ser booleano.');
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT':
      validateParticipantId(value.participantId, 'participantId', errors);
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE':
      validateParticipantId(value.participantId, 'participantId', errors);
      if (value.alias !== undefined) errors.push('alias no puede viajar en el perfil operativo.');
      if (!isValidBase64(value.activeListPublicKey)) errors.push('activeListPublicKey debe ser base64.');
      if (typeof value.isAliasVisibleToActiveParticipants !== 'boolean') {
        errors.push('isAliasVisibleToActiveParticipants debe ser booleano.');
      }
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_SET_EXTERNAL_BROADCAST_STATE':
      if (value.state !== 'off' && value.state !== 'live' && value.state !== 'recording') errors.push('state no es valido.');
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE':
      if (value.state !== 'off' && value.state !== 'live' && value.state !== 'recording') errors.push('state no es valido.');
      if (!Number.isInteger(value.revision) || (value.revision as number) < 0) errors.push('revision debe ser entero >= 0.');
      if (!isFiniteNumber(value.updatedAt)) errors.push('updatedAt debe ser numero.');
      break;
    case 'LIVE_AUDIO_CONTROL_PUBLIC_KEY':
      if (typeof value.controlSessionId !== 'string' || value.controlSessionId.trim() === '') errors.push('controlSessionId debe ser texto no vacio.');
      if (typeof value.keyId !== 'string' || value.keyId.trim() === '') errors.push('keyId debe ser texto no vacio.');
      if (!isValidBase64(value.publicKey)) errors.push('publicKey debe ser base64.');
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_CONTROL_JOIN_REQUEST':
      if (typeof value.controlSessionId !== 'string' || value.controlSessionId.trim() === '') errors.push('controlSessionId debe ser texto no vacio.');
      if (typeof value.verificationCode !== 'string' || value.verificationCode.trim() === '') errors.push('verificationCode debe ser texto no vacio.');
      if (value.recipientPublicKey !== undefined && !isValidBase64(value.recipientPublicKey)) errors.push('recipientPublicKey debe ser base64.');
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_CONTROL_AUTHORIZED':
      if (typeof value.controlSessionId !== 'string' || value.controlSessionId.trim() === '') errors.push('controlSessionId debe ser texto no vacio.');
      if (typeof value.authorizedByControlSessionId !== 'string' || value.authorizedByControlSessionId.trim() === '') {
        errors.push('authorizedByControlSessionId debe ser texto no vacio.');
      }
      if (value.keyId !== undefined && (typeof value.keyId !== 'string' || value.keyId.trim() === '')) errors.push('keyId debe ser texto no vacio.');
      if (value.sessionPublicKey !== undefined && !isValidBase64(value.sessionPublicKey)) errors.push('sessionPublicKey debe ser base64.');
      if (value.transferPublicKey !== undefined && !isValidBase64(value.transferPublicKey)) errors.push('transferPublicKey debe ser base64.');
      if (value.encryptedSessionPrivateKey !== undefined && !isValidBase64(value.encryptedSessionPrivateKey)) {
        errors.push('encryptedSessionPrivateKey debe ser base64.');
      }
      if (value.nonce !== undefined) {
        if (!isValidBase64(value.nonce)) {
          errors.push('nonce debe ser base64.');
        } else if (getBase64ByteLength(value.nonce) !== 12) {
          errors.push('nonce debe codificar 12 bytes.');
        }
      }
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE':
      if (typeof value.controlSessionId !== 'string' || value.controlSessionId.trim() === '') errors.push('controlSessionId debe ser texto no vacio.');
      if (typeof value.controlState !== 'string' || !liveAudioControlStates.has(value.controlState)) errors.push('controlState no es valido.');
      if (value.principalControlSessionId !== undefined && typeof value.principalControlSessionId !== 'string') {
        errors.push('principalControlSessionId debe ser texto.');
      }
      if (value.verificationCode !== undefined && !isValidControlVerificationCode(value.verificationCode)) {
        errors.push('verificationCode debe tener formato NNN-NNN.');
      }
      if (value.codeExpiresAt !== undefined && !isFiniteNumber(value.codeExpiresAt)) errors.push('codeExpiresAt debe ser numero.');
      if (typeof value.allowDelegatedModerators !== 'boolean') errors.push('allowDelegatedModerators debe ser booleano.');
      if (value.pendingControls !== undefined) {
        if (!Array.isArray(value.pendingControls)) {
          errors.push('pendingControls debe ser un array.');
        } else {
          value.pendingControls.forEach((pending, index) => {
            if (!isRecord(pending)) {
              errors.push(`pendingControls[${index}] debe ser un objeto.`);
              return;
            }
            if (typeof pending.controlSessionId !== 'string' || pending.controlSessionId.trim() === '') {
              errors.push(`pendingControls[${index}].controlSessionId debe ser texto no vacio.`);
            }
            if (!isValidControlVerificationCode(pending.verificationCode)) {
              errors.push(`pendingControls[${index}].verificationCode debe tener formato NNN-NNN.`);
            }
            if (!isFiniteNumber(pending.codeExpiresAt)) errors.push(`pendingControls[${index}].codeExpiresAt debe ser numero.`);
            if (!isFiniteNumber(pending.connectedAt)) errors.push(`pendingControls[${index}].connectedAt debe ser numero.`);
          });
        }
      }
      if (value.updatedAt !== undefined && !isFiniteNumber(value.updatedAt)) errors.push('updatedAt debe ser numero.');
      break;
    case 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION':
      if (typeof value.targetControlSessionId !== 'string' || value.targetControlSessionId.trim() === '') {
        errors.push('targetControlSessionId debe ser texto no vacio.');
      }
      if (value.decision !== 'APPROVE' && value.decision !== 'REJECT') errors.push('decision no es valida.');
      if (value.issuedByControlSessionId !== undefined && typeof value.issuedByControlSessionId !== 'string') {
        errors.push('issuedByControlSessionId debe ser texto.');
      }
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'CONTROL_KEY_ROTATED':
      if (typeof value.keyId !== 'string' || value.keyId.trim() === '') errors.push('keyId debe ser texto no vacio.');
      if (value.publicKey !== undefined && !isValidBase64(value.publicKey)) errors.push('publicKey debe ser base64.');
      if (value.controlSessionId !== undefined && typeof value.controlSessionId !== 'string') errors.push('controlSessionId debe ser texto.');
      if (value.reason !== undefined && value.reason !== 'CONTROL_ROTATION' && value.reason !== 'NO_AUTHORIZED_CONTROLS') {
        errors.push('reason no es valido.');
      }
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_REQUEST_ALIASES':
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_SNAPSHOT_REQUEST':
      if (value.controlSessionId !== undefined && typeof value.controlSessionId !== 'string') {
        errors.push('controlSessionId debe ser texto.');
      }
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_SNAPSHOT':
      validateOperationalSnapshot(value.snapshot, 'snapshot', errors);
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    case 'LIVE_AUDIO_SNAPSHOT_PATCH':
      if (!isRecord(value.snapshot)) errors.push('snapshot debe ser un objeto.');
      validateOptionalCreatedAt(value, value.type, errors);
      break;
    default:
      errors.push(`Tipo Live Audio no soportado: ${String(value.type)}`);
      break;
  }

  return errors.length > 0 ? fail(errors) : ok(value as unknown as LiveAudioBroadcastMessage);
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

const validateAutoduckState = (value: unknown, path: string): ValidationResult<AutoduckState> => {
  if (!isRecord(value)) return fail([`${path} debe ser un objeto.`]);

  const errors: string[] = [];
  if (typeof value.enabled !== 'boolean') errors.push(`${path}.enabled debe ser booleano.`);
  if (!isFiniteNumber(value.factor) || value.factor < 0 || value.factor > 1) {
    errors.push(`${path}.factor debe estar entre 0 y 1.`);
  }

  return errors.length > 0 ? fail(errors) : ok(value as unknown as AutoduckState);
};

const validateQuizSyncState = (value: unknown, path: string): ValidationResult<QuizSyncState> => {
  if (!isRecord(value)) return fail([`${path} debe ser un objeto.`]);

  const errors: string[] = [];
  if (value.presentationId !== undefined && typeof value.presentationId !== 'string') {
    errors.push(`${path}.presentationId debe ser texto.`);
  }
  if (!Number.isInteger(value.currentSubslideIndex) || (value.currentSubslideIndex as number) < 0) {
    errors.push(`${path}.currentSubslideIndex debe ser entero >= 0.`);
  }

  if (!isRecord(value.timerState)) {
    errors.push(`${path}.timerState debe ser un objeto.`);
  } else {
    const timer = value.timerState;
    if (typeof timer.status !== 'string' || !quizTimerStatuses.has(timer.status)) {
      errors.push(`${path}.timerState.status no es valido.`);
    }
    if (timer.timerStartedAt !== null && (!isFiniteNumber(timer.timerStartedAt) || timer.timerStartedAt < 0)) {
      errors.push(`${path}.timerState.timerStartedAt debe ser numero >= 0 o null.`);
    }
    if (!isFiniteNumber(timer.timerDurationMs) || timer.timerDurationMs < 0) {
      errors.push(`${path}.timerState.timerDurationMs debe ser numero >= 0.`);
    }
    if (timer.pausedRemainingMs !== null && (!isFiniteNumber(timer.pausedRemainingMs) || timer.pausedRemainingMs < 0)) {
      errors.push(`${path}.timerState.pausedRemainingMs debe ser numero >= 0 o null.`);
    }
  }

  if (!isRecord(value.presenterDemoSelection)) {
    errors.push(`${path}.presenterDemoSelection debe ser un objeto.`);
  } else {
    Object.entries(value.presenterDemoSelection).forEach(([slideId, optionId]) => {
      if (slideId.trim() === '' || (optionId !== null && (typeof optionId !== 'string' || !quizOptionIds.has(optionId)))) {
        errors.push(`${path}.presenterDemoSelection contiene una seleccion invalida.`);
      }
    });
  }

  if (value.maxBaseCentipunts !== undefined && (!isFiniteNumber(value.maxBaseCentipunts) || value.maxBaseCentipunts < 0)) {
    errors.push(`${path}.maxBaseCentipunts debe ser numero >= 0.`);
  }
  if (value.scoreRequestId !== undefined && (!Number.isInteger(value.scoreRequestId) || (value.scoreRequestId as number) < 0)) {
    errors.push(`${path}.scoreRequestId debe ser entero >= 0.`);
  }
  for (const field of ['completedQuizSlideIds', 'resultQuizSlideIds'] as const) {
    const ids = value[field];
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))) {
      errors.push(`${path}.${field} debe ser un array de textos.`);
    }
  }
  if (value.feedbackSound !== undefined && value.feedbackSound !== null) {
    if (!isRecord(value.feedbackSound)) {
      errors.push(`${path}.feedbackSound debe ser un objeto o null.`);
    } else {
      if (typeof value.feedbackSound.type !== 'string' || !quizFeedbackSounds.has(value.feedbackSound.type)) {
        errors.push(`${path}.feedbackSound.type no es valido.`);
      }
      if (!isFiniteNumber(value.feedbackSound.timestamp) || value.feedbackSound.timestamp < 0) {
        errors.push(`${path}.feedbackSound.timestamp debe ser numero >= 0.`);
      }
    }
  }

  return errors.length > 0 ? fail(errors) : ok(value as unknown as QuizSyncState);
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
    if (value.quizState === null) {
      next.quizState = null;
    } else {
      const result = validateQuizSyncState(value.quizState, 'remote.quizState');
      if (result.ok) next.quizState = result.value;
      else errors.push(...result.errors);
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
  if (value.stepIndex !== undefined) {
    if (isFiniteNumber(value.stepIndex)) {
      next.stepIndex = value.stepIndex;
    } else {
      errors.push('remote.stepIndex debe ser numero.');
    }
  }
  if (value.autoduckState !== undefined) {
    const result = validateAutoduckState(value.autoduckState, 'remote.autoduckState');
    if (result.ok) next.autoduckState = result.value;
    else errors.push(...result.errors);
  }

  return errors.length > 0 ? fail(errors) : ok(next);
};

export const validateSyncMessage = (value: unknown): ValidationResult<BroadcastMessage> => {
  if (!isRecord(value) || typeof value.type !== 'string') return fail(['El mensaje de sync debe incluir type.']);

  const baseErrors: string[] = [];
  if (value.protocolVersion !== undefined && value.protocolVersion !== 1) baseErrors.push('protocolVersion no soportado.');
  if (value.timestamp !== undefined && !isFiniteNumber(value.timestamp)) baseErrors.push('timestamp debe ser numero.');
  if (value.messageId !== undefined && typeof value.messageId !== 'string') baseErrors.push('messageId debe ser texto.');

  if (value.type === 'WELCOME') {
    if (typeof value.clientId !== 'string') baseErrors.push('clientId debe ser texto.');
    if (!isFiniteNumber(value.serverTimeMs)) baseErrors.push('serverTimeMs debe ser numero.');
    if (value.role !== undefined && (typeof value.role !== 'string' || !wsRoles.has(value.role))) baseErrors.push('role no es valido.');
    return baseErrors.length > 0 ? fail(baseErrors) : ok(value as unknown as BroadcastMessage);
  }

  if (value.type === 'SERVER_TIME_PING') {
    if (!isFiniteNumber(value.clientSentAtMs)) baseErrors.push('clientSentAtMs debe ser numero.');
    return baseErrors.length > 0 ? fail(baseErrors) : ok(value as unknown as BroadcastMessage);
  }

  if (value.type === 'SERVER_TIME_PONG') {
    if (!isFiniteNumber(value.clientSentAtMs)) baseErrors.push('clientSentAtMs debe ser numero.');
    if (!isFiniteNumber(value.serverTimeMs)) baseErrors.push('serverTimeMs debe ser numero.');
    return baseErrors.length > 0 ? fail(baseErrors) : ok(value as unknown as BroadcastMessage);
  }

  if (value.type === 'AUDIO_TIMELINE_ACTION') {
    const action = validateAudioTimelineAction(value.action, 'action');
    return baseErrors.length || !action.ok
      ? fail([...baseErrors, ...action.errors])
      : ok({ ...value, action: action.value } as unknown as BroadcastMessage);
  }

  if (value.type === 'AUDIO_TIMELINE_STATE') {
    const timeline = validateAudioTimelineState(value.timeline, 'timeline');
    return baseErrors.length || !timeline.ok
      ? fail([...baseErrors, ...timeline.errors])
      : ok({ ...value, timeline: timeline.value } as unknown as BroadcastMessage);
  }

  if (value.type === 'AUDIO_PRESENTATION_CLOCK') {
    if (typeof value.timelineId !== 'string') baseErrors.push('timelineId debe ser texto.');
    if (!isFiniteNumber(value.estimatedPositionSec)) baseErrors.push('estimatedPositionSec debe ser numero.');
    if (!isFiniteNumber(value.serverTimeMs)) baseErrors.push('serverTimeMs debe ser numero.');
    return baseErrors.length > 0 ? fail(baseErrors) : ok(value as unknown as BroadcastMessage);
  }

  if (liveAudioMessageTypes.has(value.type)) {
    const liveAudio = validateLiveAudioBroadcastMessage(value);
    return baseErrors.length || !liveAudio.ok
      ? fail([...baseErrors, ...liveAudio.errors])
      : ok(value as unknown as BroadcastMessage);
  }

  if (value.type === 'ERROR') {
    if (typeof value.code !== 'string') baseErrors.push('code debe ser texto.');
    if (typeof value.message !== 'string') baseErrors.push('message debe ser texto.');
    return baseErrors.length > 0 ? fail(baseErrors) : ok(value as unknown as BroadcastMessage);
  }

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
        case 'SELECT_PRESENTATION_AND_SLIDE':
          if (payload.presentation !== null && !isRecord(payload.presentation)) baseErrors.push('presentation debe ser objeto o null');
          if (!isFiniteNumber(payload.slideIndex)) baseErrors.push('slideIndex debe ser numero');
          if (payload.direction !== undefined && payload.direction !== 'forward' && payload.direction !== 'backward') {
            baseErrors.push('direction debe ser forward o backward');
          }
          if (payload.targetVerse !== undefined && typeof payload.targetVerse !== 'string') baseErrors.push('targetVerse debe ser texto');
          break;
        case 'SELECT_STEP':
          if (!Number.isInteger(payload.stepIndex) || (payload.stepIndex as number) < 0) baseErrors.push('stepIndex debe ser entero >= 0');
          break;
        case 'TOGGLE_APP_MODE':
          if (!appModes.has(payload.mode as string)) baseErrors.push(`Modo invalido: ${payload.mode}`);
          break;
        case 'TOGGLE_BG_LOCK':
          if (typeof payload.locked !== 'boolean') baseErrors.push('locked debe ser booleano');
          break;
        case 'SELECT_BG_OVERRIDE':
          if (payload.bg !== null && typeof payload.bg !== 'string') baseErrors.push('bg debe ser texto o null');
          break;
        case 'QUIZ_SELECT_SUBSLIDE':
          if (!Number.isInteger(payload.index) || (payload.index as number) < 0) baseErrors.push('index debe ser entero >= 0');
          break;
        case 'QUIZ_ADJUST_TIMER':
          if (!isFiniteNumber(payload.seconds) || (payload.seconds as number) < 1) baseErrors.push('seconds debe ser numero >= 1');
          break;
        case 'QUIZ_RECALCULATE_RESULTS':
          if (!Array.isArray(payload.slideIds) || payload.slideIds.some((id) => typeof id !== 'string')) {
            baseErrors.push('slideIds debe ser un array de textos');
          }
          break;
        case 'QUIZ_CLEAR_QUESTION_RESULTS':
          if (typeof payload.slideId !== 'string') baseErrors.push('slideId debe ser texto');
          break;
        case 'QUIZ_DEMO_SELECT':
          if (payload.optionId !== null && typeof payload.optionId !== 'string') baseErrors.push('optionId debe ser texto o null');
          break;
        case 'SCRIPTURE_PROJECT':
          if (!isRecord(payload.state)) baseErrors.push('state debe ser objeto');
          if (
            payload.navCommand !== undefined &&
            payload.navCommand !== 'navigate' &&
            payload.navCommand !== 'next' &&
            payload.navCommand !== 'previous'
          ) {
            baseErrors.push('navCommand debe ser navigate, next o previous');
          }
          break;
        case 'SCRIPTURE_ARROW_NAV':
          if (payload.direction !== 'up' && payload.direction !== 'down') baseErrors.push('direction debe ser up o down');
          break;
        case 'SCRIPTURE_BOUNDARY':
          if (payload.direction !== 'next' && payload.direction !== 'previous') baseErrors.push('direction debe ser next o previous');
          break;
        case 'UPDATE_FONT_SIZES':
          if (payload.hebrewFontSize !== undefined && !isFiniteNumber(payload.hebrewFontSize)) baseErrors.push('hebrewFontSize debe ser numero');
          if (payload.combinedTextBaseSize !== undefined && !isFiniteNumber(payload.combinedTextBaseSize)) baseErrors.push('combinedTextBaseSize debe ser numero');
          break;
        case 'VIDEO_STATE_CHANGE':
          if (payload.state !== null && !isRecord(payload.state)) baseErrors.push('state debe ser objeto o null');
          break;
        case 'AUDIO_STATE_CHANGE':
          if (!isRecord(payload.state)) baseErrors.push('state debe ser objeto');
          break;
        case 'SET_AUTODUCK_STATE': {
          const result = validateAutoduckState(payload.state, 'payload.state');
          if (!result.ok) baseErrors.push(...result.errors);
          break;
        }
      }
    }
    return baseErrors.length > 0 ? fail(baseErrors) : ok(value as unknown as BroadcastMessage);
  }

  return fail([`Tipo de mensaje no soportado: ${value.type}`]);
};
