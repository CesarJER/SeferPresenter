const DATABASE_NAME = 'sefer-protected-audience';
const STORE_NAME = 'session-state';
const RECORD_KEY = 'current';
const QUIZ_ANSWERS_KEY = 'sefer-quiz-answers-by-presentation';
const QUIZ_SCORES_KEY = 'sefer-quiz-scores-by-presentation';

interface ProtectedAudienceRecord {
  id: typeof RECORD_KEY;
  presentationSessionId: string;
  participantId: string;
  credentialDigest: string;
  expiresAt: number;
  stateRevision: number;
  projectionState: Record<string, unknown>;
  quizAnswers: string | null;
  quizScores: string | null;
  updatedAt: number;
}

export interface ProtectedAudienceStoreContext {
  presentationSessionId: string;
  participantId: string;
  credential: string;
  expiresAt: number;
}

const openDatabase = (): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const digestCredential = async (credential: string): Promise<string> => {
  const bytes = new TextEncoder().encode(credential);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const runTransaction = async <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, resolve: (value: T) => void) => void,
): Promise<T | null> => {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => database.close();
    operation(transaction.objectStore(STORE_NAME), resolve);
  });
};

export const saveProtectedAudienceSnapshot = async (
  context: ProtectedAudienceStoreContext,
  stateRevision: number,
  projectionState: Record<string, unknown>,
): Promise<void> => {
  if (context.expiresAt <= Date.now()) return;
  const record: ProtectedAudienceRecord = {
    id: RECORD_KEY,
    presentationSessionId: context.presentationSessionId,
    participantId: context.participantId,
    credentialDigest: await digestCredential(context.credential),
    expiresAt: context.expiresAt,
    stateRevision,
    projectionState,
    quizAnswers: localStorage.getItem(QUIZ_ANSWERS_KEY),
    quizScores: localStorage.getItem(QUIZ_SCORES_KEY),
    updatedAt: Date.now(),
  };
  await runTransaction<void>('readwrite', (store, resolve) => {
    const request = store.put(record);
    request.onsuccess = () => resolve();
  });
};

export const loadProtectedAudienceSnapshot = async (
  context: ProtectedAudienceStoreContext,
): Promise<{ stateRevision: number; projectionState: Record<string, unknown> } | null> => {
  if (context.expiresAt <= Date.now()) {
    await clearProtectedAudienceSnapshot();
    return null;
  }
  const credentialDigest = await digestCredential(context.credential);
  const record = await runTransaction<ProtectedAudienceRecord | undefined>(
    'readonly',
    (store, resolve) => {
      const request = store.get(RECORD_KEY);
      request.onsuccess = () => resolve(request.result as ProtectedAudienceRecord | undefined);
    },
  );
  if (
    !record ||
    record.presentationSessionId !== context.presentationSessionId ||
    record.participantId !== context.participantId ||
    record.credentialDigest !== credentialDigest ||
    record.expiresAt <= Date.now()
  ) {
    await clearProtectedAudienceSnapshot();
    return null;
  }
  if (record.quizAnswers) localStorage.setItem(QUIZ_ANSWERS_KEY, record.quizAnswers);
  if (record.quizScores) localStorage.setItem(QUIZ_SCORES_KEY, record.quizScores);
  window.dispatchEvent(new CustomEvent('sefer-protected-quiz-restored'));
  return {
    stateRevision: record.stateRevision,
    projectionState: record.projectionState,
  };
};

export const clearProtectedAudienceSnapshot = async (): Promise<void> => {
  localStorage.removeItem(QUIZ_ANSWERS_KEY);
  localStorage.removeItem(QUIZ_SCORES_KEY);
  await runTransaction<void>('readwrite', (store, resolve) => {
    const request = store.delete(RECORD_KEY);
    request.onsuccess = () => resolve();
  });
};

export const refreshProtectedAudienceDrafts = async (): Promise<void> => {
  await runTransaction<void>('readwrite', (store, resolve) => {
    const request = store.get(RECORD_KEY);
    request.onsuccess = () => {
      const record = request.result as ProtectedAudienceRecord | undefined;
      if (!record || record.expiresAt <= Date.now()) {
        const deletion = store.delete(RECORD_KEY);
        deletion.onsuccess = () => resolve();
        return;
      }
      const update = store.put({
        ...record,
        quizAnswers: localStorage.getItem(QUIZ_ANSWERS_KEY),
        quizScores: localStorage.getItem(QUIZ_SCORES_KEY),
        updatedAt: Date.now(),
      });
      update.onsuccess = () => resolve();
    };
  });
};
