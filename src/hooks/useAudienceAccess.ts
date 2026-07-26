import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudienceAccessSnapshot,
  AudienceAccessState,
  SessionAccessMode,
} from '../types/audienceAccess';

const STORAGE_KEY = 'sefer-audience-resume-credential';

interface StoredCredential {
  presentationSessionId: string;
  credential: string;
}

const readStoredCredential = (): StoredCredential | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as Partial<StoredCredential>;
    if (
      typeof value.presentationSessionId !== 'string' ||
      typeof value.credential !== 'string'
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
      });
      setCredential(nextCredential);
      const nextSnapshot: AudienceAccessSnapshot = {
        presentationSessionId: body.presentationSessionId,
        accessMode: body.accessMode,
        participantId: body.participantId,
        accessState: body.accessState,
        retryAt: typeof body.retryAt === 'number' ? body.retryAt : undefined,
        stateRevision: Number(body.stateRevision),
      };
      setSnapshot(nextSnapshot);
      if (nextSnapshot.accessState === 'ADMITTED') void issueTickets(nextCredential);
    } finally {
      bootstrappingRef.current = false;
    }
  }, [issueTickets]);

  useEffect(() => {
    void bootstrap().catch(() => {
      setSnapshot((current) => ({ ...current, accessState: 'CREDENTIAL_OBSOLETE' }));
    });
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
      writeStoredCredential(null);
      setCredential(null);
      setStateSseTicket(null);
      setQuizSseTicket(null);
      sessionStorage.removeItem('sefer-audience-quiz-sse-ticket');
      void bootstrap();
    };
    window.addEventListener('sefer-audience-logout', clearAfterLogout);
    return () => window.removeEventListener('sefer-audience-logout', clearAfterLogout);
  }, [bootstrap]);

  const handleWsMessage = useCallback((type: string, payload: Record<string, unknown>) => {
    if (type === 'PRESENTATION_SESSION_ROTATED') {
      writeStoredCredential(null);
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
        stateRevision: Number.isInteger(payload.stateRevision)
          ? Number(payload.stateRevision)
          : current.stateRevision,
      };
      if (next.accessState === 'ADMITTED' && credential) void issueTickets(credential);
      if (next.accessState !== 'ADMITTED') {
        setStateSseTicket(null);
        setQuizSseTicket(null);
        sessionStorage.removeItem('sefer-audience-quiz-sse-ticket');
      }
      return next;
    });
  }, [bootstrap, credential, issueTickets]);

  const logout = useCallback(() => {
    writeStoredCredential(null);
    setCredential(null);
    setStateSseTicket(null);
    setQuizSseTicket(null);
    sessionStorage.removeItem('sefer-audience-quiz-sse-ticket');
    window.dispatchEvent(new CustomEvent('sefer-audience-logout'));
    void bootstrap();
  }, [bootstrap]);

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
    handleWsMessage,
    refreshTickets,
    logout,
  };
}
