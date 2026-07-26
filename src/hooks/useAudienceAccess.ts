import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudienceAccessSnapshot,
  AudienceAccessState,
  SessionAccessMode,
} from '../types/audienceAccess';
import { clearProtectedAudienceSnapshot } from '../utils/protectedAudienceStore';

const STORAGE_KEY = 'sefer-audience-resume-credential';

interface StoredCredential {
  presentationSessionId: string;
  credential: string;
  participantId: string;
  accessState: AudienceAccessState;
  expiresAt: number;
}

const readStoredCredential = (): StoredCredential | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as Partial<StoredCredential>;
    if (
      typeof value.presentationSessionId !== 'string' ||
      typeof value.credential !== 'string' ||
      typeof value.participantId !== 'string' ||
      !isAccessState(value.accessState) ||
      typeof value.expiresAt !== 'number'
    ) return null;
    return value as StoredCredential;
  } catch {
    return null;
  }
};

const writeStoredCredential = (value: StoredCredential | null) => {
  if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  else localStorage.removeItem(STORAGE_KEY);
};

const isAccessState = (value: unknown): value is AudienceAccessState => (
  value === 'REQUEST_REQUIRED' ||
  value === 'WAITING' ||
  value === 'ADMITTED' ||
  value === 'REJECTED' ||
  value === 'BLOCKED' ||
  value === 'CREDENTIAL_OBSOLETE'
);

const isAccessMode = (value: unknown): value is SessionAccessMode =>
  value === 'PUBLIC' || value === 'CONTROLLED';

export function useAudienceAccess() {
  const [snapshot, setSnapshot] = useState<AudienceAccessSnapshot>({
    presentationSessionId: '',
    accessMode: 'PUBLIC',
    participantId: null,
    accessState: 'LOADING',
    stateRevision: -1,
  });
  const [credential, setCredential] = useState<string | null>(null);
  const [stateSseTicket, setStateSseTicket] = useState<string | null>(null);
  const [quizSseTicket, setQuizSseTicket] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const bootstrappingRef = useRef(false);

  const issueTickets = useCallback(async (activeCredential: string) => {
    const issue = async (purpose: 'STATE' | 'QUIZ') => {
      const response = await fetch('/api/audience/sse-ticket', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeCredential}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ purpose }),
        cache: 'no-store',
      });
      if (!response.ok) return null;
      const body = await response.json() as { ticket?: unknown };
      return typeof body.ticket === 'string' ? body.ticket : null;
    };
    const [stateTicket, quizTicket] = await Promise.all([issue('STATE'), issue('QUIZ')]);
    setStateSseTicket(stateTicket);
    setQuizSseTicket(quizTicket);
    if (quizTicket) sessionStorage.setItem('sefer-audience-quiz-sse-ticket', quizTicket);
    else sessionStorage.removeItem('sefer-audience-quiz-sse-ticket');
    window.dispatchEvent(new CustomEvent('sefer-audience-tickets-updated'));
  }, []);

  const bootstrap = useCallback(async () => {
    if (bootstrappingRef.current) return;
    bootstrappingRef.current = true;
    try {
      const stored = readStoredCredential();
      const response = await fetch('/api/audience/access/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: stored?.credential }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Audience access bootstrap failed');
      const body = await response.json() as Record<string, unknown>;
      if (
        typeof body.presentationSessionId !== 'string' ||
        !isAccessMode(body.accessMode) ||
        typeof body.participantId !== 'string' ||
        !isAccessState(body.accessState) ||
        !Number.isInteger(body.stateRevision)
      ) throw new Error('Audience access bootstrap returned an invalid response');
      const nextCredential = typeof body.credential === 'string'
        ? body.credential
        : stored?.presentationSessionId === body.presentationSessionId
          ? stored.credential
          : null;
      if (!nextCredential) throw new Error('Audience access credential is unavailable');
      writeStoredCredential({
        presentationSessionId: body.presentationSessionId,
        credential: nextCredential,
        participantId: body.participantId,
        accessState: body.accessState,
        expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : Date.now(),
      });
      setCredential(nextCredential);
      const nextSnapshot: AudienceAccessSnapshot = {
        presentationSessionId: body.presentationSessionId,
        accessMode: body.accessMode,
        participantId: body.participantId,
        accessState: body.accessState,
        retryAt: typeof body.retryAt === 'number' ? body.retryAt : undefined,
        expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : undefined,
        recordingConfirmedEpoch: typeof body.recordingConfirmedEpoch === 'number'
          ? body.recordingConfirmedEpoch
          : undefined,
        stateRevision: Number(body.stateRevision),
      };
      setSnapshot(nextSnapshot);
      setOffline(false);
      if (nextSnapshot.accessState === 'ADMITTED') void issueTickets(nextCredential);
    } finally {
      bootstrappingRef.current = false;
    }
  }, [issueTickets]);

  useEffect(() => {
    void bootstrap().catch(() => {
      const stored = readStoredCredential();
      if (
        stored &&
        stored.accessState === 'ADMITTED' &&
        stored.expiresAt > Date.now()
      ) {
        setCredential(stored.credential);
        setOffline(true);
        setSnapshot({
          presentationSessionId: stored.presentationSessionId,
          accessMode: 'CONTROLLED',
          participantId: stored.participantId,
          accessState: 'ADMITTED',
          expiresAt: stored.expiresAt,
          stateRevision: -1,
        });
      } else {
        writeStoredCredential(null);
        void clearProtectedAudienceSnapshot();
        setSnapshot((current) => ({ ...current, accessState: 'CREDENTIAL_OBSOLETE' }));
      }
    });
  }, [bootstrap]);

  useEffect(() => {
    if (!snapshot.expiresAt) return;
    const remaining = snapshot.expiresAt - Date.now();
    if (remaining <= 0) {
      writeStoredCredential(null);
      void clearProtectedAudienceSnapshot();
      setCredential(null);
      setSnapshot((current) => ({ ...current, accessState: 'CREDENTIAL_OBSOLETE' }));
      return;
    }
    const timer = window.setTimeout(() => {
      writeStoredCredential(null);
      void clearProtectedAudienceSnapshot();
      setCredential(null);
      setStateSseTicket(null);
      setQuizSseTicket(null);
      setSnapshot((current) => ({ ...current, accessState: 'CREDENTIAL_OBSOLETE' }));
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [snapshot.expiresAt]);

  useEffect(() => {
    const handleOnline = () => {
      setOffline(false);
      void bootstrap();
    };
    const handleOffline = () => setOffline(true);
    setOffline(!navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [bootstrap]);

  useEffect(() => {
    const refresh = () => {
      if (credential) void issueTickets(credential);
    };
    window.addEventListener('sefer-audience-sse-refresh-request', refresh);
    return () => window.removeEventListener('sefer-audience-sse-refresh-request', refresh);
  }, [credential, issueTickets]);

  useEffect(() => {
    const clearAfterLogout = () => {
      if (credential) {
        void fetch('/api/audience/access/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${credential}` },
        });
      }
      writeStoredCredential(null);
      void clearProtectedAudienceSnapshot();
      setCredential(null);
      setStateSseTicket(null);
      setQuizSseTicket(null);
      sessionStorage.removeItem('sefer-audience-quiz-sse-ticket');
      void bootstrap();
    };
    window.addEventListener('sefer-audience-logout', clearAfterLogout);
    return () => window.removeEventListener('sefer-audience-logout', clearAfterLogout);
  }, [bootstrap, credential]);

  const handleWsMessage = useCallback((type: string, payload: Record<string, unknown>) => {
    if (type === 'PRESENTATION_SESSION_ROTATED') {
      writeStoredCredential(null);
      void clearProtectedAudienceSnapshot();
      setCredential(null);
      setStateSseTicket(null);
      setQuizSseTicket(null);
      sessionStorage.removeItem('sefer-audience-quiz-sse-ticket');
      void bootstrap();
      return;
    }
    if (type !== 'AUDIENCE_ACCESS_STATE' && type !== 'SESSION_ACCESS_POLICY') return;
    if (payload.accessState === 'CREDENTIAL_OBSOLETE') {
      writeStoredCredential(null);
      void clearProtectedAudienceSnapshot();
      setCredential(null);
      setStateSseTicket(null);
      setQuizSseTicket(null);
      void bootstrap();
      return;
    }
    setSnapshot((current) => {
      const next: AudienceAccessSnapshot = {
        presentationSessionId: typeof payload.presentationSessionId === 'string'
          ? payload.presentationSessionId
          : current.presentationSessionId,
        accessMode: isAccessMode(payload.accessMode) ? payload.accessMode : current.accessMode,
        participantId: typeof payload.participantId === 'string'
          ? payload.participantId
          : current.participantId,
        accessState: isAccessState(payload.accessState)
          ? payload.accessState
          : current.accessState,
        retryAt: typeof payload.retryAt === 'number' ? payload.retryAt : undefined,
        expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : current.expiresAt,
        recordingConfirmedEpoch: typeof payload.recordingConfirmedEpoch === 'number'
          ? payload.recordingConfirmedEpoch
          : current.recordingConfirmedEpoch,
        stateRevision: Number.isInteger(payload.stateRevision)
          ? Number(payload.stateRevision)
          : current.stateRevision,
      };
      if (next.accessState === 'ADMITTED' && credential) void issueTickets(credential);
      if (credential && next.participantId && next.expiresAt) {
        writeStoredCredential({
          presentationSessionId: next.presentationSessionId,
          credential,
          participantId: next.participantId,
          accessState: next.accessState,
          expiresAt: next.expiresAt,
        });
      }
      if (next.accessState !== 'ADMITTED') {
        void clearProtectedAudienceSnapshot();
        setStateSseTicket(null);
        setQuizSseTicket(null);
        sessionStorage.removeItem('sefer-audience-quiz-sse-ticket');
      }
      return next;
    });
  }, [bootstrap, credential, issueTickets]);

  const logout = useCallback(() => {
    if (credential) {
      void fetch('/api/audience/access/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}` },
      });
    }
    writeStoredCredential(null);
    void clearProtectedAudienceSnapshot();
    setCredential(null);
    setStateSseTicket(null);
    setQuizSseTicket(null);
    sessionStorage.removeItem('sefer-audience-quiz-sse-ticket');
    window.dispatchEvent(new CustomEvent('sefer-audience-logout'));
    void bootstrap();
  }, [bootstrap, credential]);

  const refreshTickets = useCallback(() => {
    if (credential && snapshot.accessState === 'ADMITTED') {
      void issueTickets(credential);
    }
  }, [credential, issueTickets, snapshot.accessState]);

  return {
    ...snapshot,
    credential,
    stateSseTicket,
    quizSseTicket,
    authorized: snapshot.accessState === 'ADMITTED',
    offline,
    handleWsMessage,
    refreshTickets,
    logout,
  };
}
