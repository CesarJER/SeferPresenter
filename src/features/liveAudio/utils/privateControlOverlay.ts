export interface PrivateControlMicrophoneConfig {
  volume: number;
  musicMode: boolean;
}

export interface PrivateControlParticipantOverlay {
  alias: string;
  aliasOrdinal: number;
  ephemeralPublicKey?: string;
  microphoneConfig?: PrivateControlMicrophoneConfig;
}

export interface PrivateControlOverlaySnapshot {
  type: 'PRIVATE_CONTROL_OVERLAY_SNAPSHOT';
  keyId: string;
  privateStateRevision: number;
  basedOnStateRevision: number;
  participants: Record<string, PrivateControlParticipantOverlay>;
}

export interface PrivateControlOverlayDelta {
  type: 'PRIVATE_CONTROL_OVERLAY_DELTA';
  keyId: string;
  privateStateRevision: number;
  basedOnPrivateStateRevision: number;
  basedOnStateRevision: number;
  upsertParticipants: Record<string, PrivateControlParticipantOverlay>;
  removeParticipantIds: string[];
}

export type PrivateControlOverlayValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export type PrivateControlOverlayApplyFailureReason =
  | 'invalid'
  | 'key-mismatch'
  | 'stale'
  | 'revision-gap'
  | 'technical-state-ahead';

export type PrivateControlOverlayApplyResult =
  | { ok: true; value: PrivateControlOverlaySnapshot }
  | {
    ok: false;
    reason: PrivateControlOverlayApplyFailureReason;
    errors: string[];
  };

export interface ReplacePrivateControlOverlayOptions {
  expectedKeyId?: string;
  currentTechnicalStateRevision?: number;
}

const snapshotKeys = new Set([
  'type',
  'keyId',
  'privateStateRevision',
  'basedOnStateRevision',
  'participants',
]);
const deltaKeys = new Set([
  'type',
  'keyId',
  'privateStateRevision',
  'basedOnPrivateStateRevision',
  'basedOnStateRevision',
  'upsertParticipants',
  'removeParticipantIds',
]);
const participantKeys = new Set([
  'alias',
  'aliasOrdinal',
  'ephemeralPublicKey',
  'microphoneConfig',
]);
const microphoneConfigKeys = new Set(['volume', 'musicMode']);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const validateExactKeys = (
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  errors: string[],
) => {
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) errors.push(`${path}.${key} no está permitido.`);
  });
};

const validateNonEmptyString = (
  value: unknown,
  path: string,
  errors: string[],
  maxLength: number,
) => {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${path} debe ser texto no vacío.`);
  } else if (value.length > maxLength) {
    errors.push(`${path} no puede superar ${maxLength} caracteres.`);
  }
};

const validateParticipantOverlay = (
  value: unknown,
  path: string,
  errors: string[],
): value is PrivateControlParticipantOverlay => {
  if (!isRecord(value)) {
    errors.push(`${path} debe ser un objeto.`);
    return false;
  }
  validateExactKeys(value, participantKeys, path, errors);
  validateNonEmptyString(value.alias, `${path}.alias`, errors, 80);
  if (!Number.isSafeInteger(value.aliasOrdinal) || (value.aliasOrdinal as number) < 0) {
    errors.push(`${path}.aliasOrdinal debe ser un entero no negativo.`);
  }
  if (value.ephemeralPublicKey !== undefined) {
    validateNonEmptyString(
      value.ephemeralPublicKey,
      `${path}.ephemeralPublicKey`,
      errors,
      4096,
    );
  }
  if (value.microphoneConfig !== undefined) {
    if (!isRecord(value.microphoneConfig)) {
      errors.push(`${path}.microphoneConfig debe ser un objeto.`);
    } else {
      validateExactKeys(
        value.microphoneConfig,
        microphoneConfigKeys,
        `${path}.microphoneConfig`,
        errors,
      );
      const { volume, musicMode } = value.microphoneConfig;
      if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 300) {
        errors.push(`${path}.microphoneConfig.volume debe estar entre 0 y 300.`);
      }
      if (typeof musicMode !== 'boolean') {
        errors.push(`${path}.microphoneConfig.musicMode debe ser booleano.`);
      }
    }
  }
  return true;
};

const validateParticipantMap = (
  value: unknown,
  path: string,
  errors: string[],
): value is Record<string, PrivateControlParticipantOverlay> => {
  if (!isRecord(value)) {
    errors.push(`${path} debe ser un objeto.`);
    return false;
  }
  Object.entries(value).forEach(([participantId, participant]) => {
    validateNonEmptyString(participantId, `${path}.[participantId]`, errors, 200);
    validateParticipantOverlay(participant, `${path}.${participantId}`, errors);
  });
  return true;
};

export const validatePrivateControlOverlaySnapshot = (
  value: unknown,
): PrivateControlOverlayValidationResult<PrivateControlOverlaySnapshot> => {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['El snapshot privado debe ser un objeto.'] };
  }
  validateExactKeys(value, snapshotKeys, 'snapshot', errors);
  if (value.type !== 'PRIVATE_CONTROL_OVERLAY_SNAPSHOT') {
    errors.push('snapshot.type no es válido.');
  }
  validateNonEmptyString(value.keyId, 'snapshot.keyId', errors, 200);
  if (!isRevision(value.privateStateRevision)) {
    errors.push('snapshot.privateStateRevision debe ser una revisión no negativa.');
  }
  if (!isRevision(value.basedOnStateRevision)) {
    errors.push('snapshot.basedOnStateRevision debe ser una revisión no negativa.');
  }
  validateParticipantMap(value.participants, 'snapshot.participants', errors);
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: value as unknown as PrivateControlOverlaySnapshot };
};

export const validatePrivateControlOverlayDelta = (
  value: unknown,
): PrivateControlOverlayValidationResult<PrivateControlOverlayDelta> => {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['El delta privado debe ser un objeto.'] };
  }
  validateExactKeys(value, deltaKeys, 'delta', errors);
  if (value.type !== 'PRIVATE_CONTROL_OVERLAY_DELTA') {
    errors.push('delta.type no es válido.');
  }
  validateNonEmptyString(value.keyId, 'delta.keyId', errors, 200);
  if (!isRevision(value.privateStateRevision)) {
    errors.push('delta.privateStateRevision debe ser una revisión no negativa.');
  }
  if (!isRevision(value.basedOnPrivateStateRevision)) {
    errors.push('delta.basedOnPrivateStateRevision debe ser una revisión no negativa.');
  }
  if (!isRevision(value.basedOnStateRevision)) {
    errors.push('delta.basedOnStateRevision debe ser una revisión no negativa.');
  }
  validateParticipantMap(value.upsertParticipants, 'delta.upsertParticipants', errors);
  if (!Array.isArray(value.removeParticipantIds)) {
    errors.push('delta.removeParticipantIds debe ser una lista.');
  } else {
    const seen = new Set<string>();
    value.removeParticipantIds.forEach((participantId, index) => {
      validateNonEmptyString(
        participantId,
        `delta.removeParticipantIds.${index}`,
        errors,
        200,
      );
      if (typeof participantId === 'string') {
        if (seen.has(participantId)) {
          errors.push(`delta.removeParticipantIds.${index} está duplicado.`);
        }
        seen.add(participantId);
        if (
          isRecord(value.upsertParticipants) &&
          Object.hasOwn(value.upsertParticipants, participantId)
        ) {
          errors.push(`El participante ${participantId} no puede añadirse y eliminarse en el mismo delta.`);
        }
      }
    });
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: value as unknown as PrivateControlOverlayDelta };
};

const technicalStateAheadFailure = (
  basedOnStateRevision: number,
  currentTechnicalStateRevision: number | undefined,
): PrivateControlOverlayApplyResult | null => {
  if (
    currentTechnicalStateRevision !== undefined &&
    basedOnStateRevision > currentTechnicalStateRevision
  ) {
    return {
      ok: false,
      reason: 'technical-state-ahead',
      errors: ['El overlay depende de un estado técnico que aún no se ha aplicado.'],
    };
  }
  return null;
};

export const replacePrivateControlOverlay = (
  current: PrivateControlOverlaySnapshot | null,
  incoming: unknown,
  options: ReplacePrivateControlOverlayOptions = {},
): PrivateControlOverlayApplyResult => {
  const validation = validatePrivateControlOverlaySnapshot(incoming);
  if (!validation.ok) return { ok: false, reason: 'invalid', errors: validation.errors };
  const snapshot = validation.value;
  if (options.expectedKeyId !== undefined && snapshot.keyId !== options.expectedKeyId) {
    return {
      ok: false,
      reason: 'key-mismatch',
      errors: ['El snapshot privado no pertenece a la clave de control activa.'],
    };
  }
  const technicalFailure = technicalStateAheadFailure(
    snapshot.basedOnStateRevision,
    options.currentTechnicalStateRevision,
  );
  if (technicalFailure) return technicalFailure;
  if (
    current &&
    current.keyId === snapshot.keyId &&
    snapshot.privateStateRevision <= current.privateStateRevision
  ) {
    return {
      ok: false,
      reason: 'stale',
      errors: ['El snapshot privado no es más reciente que el estado actual.'],
    };
  }
  return { ok: true, value: snapshot };
};

export const applyPrivateControlOverlayDelta = (
  current: PrivateControlOverlaySnapshot,
  incoming: unknown,
  currentTechnicalStateRevision?: number,
): PrivateControlOverlayApplyResult => {
  const validation = validatePrivateControlOverlayDelta(incoming);
  if (!validation.ok) return { ok: false, reason: 'invalid', errors: validation.errors };
  const delta = validation.value;
  if (delta.keyId !== current.keyId) {
    return {
      ok: false,
      reason: 'key-mismatch',
      errors: ['El delta privado no pertenece a la clave de control activa.'],
    };
  }
  if (
    delta.privateStateRevision <= current.privateStateRevision ||
    delta.basedOnPrivateStateRevision < current.privateStateRevision
  ) {
    return {
      ok: false,
      reason: 'stale',
      errors: ['El delta privado ya fue aplicado o se basa en un estado anterior.'],
    };
  }
  if (
    delta.basedOnPrivateStateRevision !== current.privateStateRevision ||
    delta.privateStateRevision !== current.privateStateRevision + 1
  ) {
    return {
      ok: false,
      reason: 'revision-gap',
      errors: ['Falta al menos una revisión privada; es necesario solicitar un snapshot.'],
    };
  }
  if (delta.basedOnStateRevision < current.basedOnStateRevision) {
    return {
      ok: false,
      reason: 'stale',
      errors: ['El delta privado se basa en un estado técnico anterior.'],
    };
  }
  const technicalFailure = technicalStateAheadFailure(
    delta.basedOnStateRevision,
    currentTechnicalStateRevision,
  );
  if (technicalFailure) return technicalFailure;

  const participants = { ...current.participants, ...delta.upsertParticipants };
  delta.removeParticipantIds.forEach((participantId) => {
    delete participants[participantId];
  });
  return {
    ok: true,
    value: {
      type: 'PRIVATE_CONTROL_OVERLAY_SNAPSHOT',
      keyId: current.keyId,
      privateStateRevision: delta.privateStateRevision,
      basedOnStateRevision: delta.basedOnStateRevision,
      participants,
    },
  };
};

export const reconcilePrivateControlOverlayParticipants = (
  overlay: PrivateControlOverlaySnapshot,
  technicalParticipantIds: readonly string[],
  technicalStateRevision: number,
): PrivateControlOverlaySnapshot => {
  if (!isRevision(technicalStateRevision)) {
    throw new RangeError('technicalStateRevision debe ser una revisión no negativa.');
  }
  if (technicalStateRevision < overlay.basedOnStateRevision) {
    throw new RangeError('No se puede reconciliar contra un estado técnico anterior.');
  }

  const allowed = new Set(technicalParticipantIds);
  const participants = Object.fromEntries(
    Object.entries(overlay.participants).filter(([participantId]) => allowed.has(participantId)),
  );
  const changed = (
    Object.keys(participants).length !== Object.keys(overlay.participants).length ||
    technicalStateRevision !== overlay.basedOnStateRevision
  );
  if (!changed) return overlay;
  return {
    ...overlay,
    privateStateRevision: overlay.privateStateRevision + 1,
    basedOnStateRevision: technicalStateRevision,
    participants,
  };
};
