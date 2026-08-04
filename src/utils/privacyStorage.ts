const STORAGE_ENVELOPE_VERSION = 1;
const DEFAULT_TTL_HOURS = 24;
const MIN_TTL_HOURS = 1;
const MAX_TTL_HOURS = 168;

interface ExpiringStorageEnvelope<T> {
  version: typeof STORAGE_ENVELOPE_VERSION;
  expiresAt: number;
  data: T;
}

const configuredTtlHours = Number(import.meta.env.VITE_SEFER_AUDIENCE_STORAGE_TTL_HOURS);
const ttlHours = Number.isFinite(configuredTtlHours)
  ? Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, configuredTtlHours))
  : DEFAULT_TTL_HOURS;

export const AUDIENCE_PRIVACY_STORAGE_TTL_MS = ttlHours * 60 * 60 * 1000;

const isEnvelope = <T>(value: unknown): value is ExpiringStorageEnvelope<T> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<ExpiringStorageEnvelope<T>>;
  return candidate.version === STORAGE_ENVELOPE_VERSION
    && Number.isFinite(candidate.expiresAt)
    && (candidate.expiresAt as number) > 0
    && Object.prototype.hasOwnProperty.call(candidate, 'data');
};

export const readExpiringStorage = <T>(
  storage: Storage,
  key: string,
  now = Date.now(),
): T | null => {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope<T>(parsed) || parsed.expiresAt <= now) {
      storage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    storage.removeItem(key);
    return null;
  }
};

export const writeExpiringStorage = <T>(
  storage: Storage,
  key: string,
  data: T,
  now = Date.now(),
): void => {
  const envelope: ExpiringStorageEnvelope<T> = {
    version: STORAGE_ENVELOPE_VERSION,
    expiresAt: now + AUDIENCE_PRIVACY_STORAGE_TTL_MS,
    data,
  };
  storage.setItem(key, JSON.stringify(envelope));
};
