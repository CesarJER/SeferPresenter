import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudienceAccessSnapshot, AudienceAccessState, SessionAccessMode } from '../types/audienceAccess';

const STORAGE_KEY = 'sefer-audience-access';

interface StoredAudienceAccess {
  presentationSessionId: string;
  credential: string;
}

const readStoredAccess = (): StoredAudienceAccess | null => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<StoredAudienceAccess> | null;
    return typeof value?.presentationSessionId === 'string' && typeof value.credential === 'string'
      ? value as StoredAudienceAccess
      : null;
  } catch {
    return null;
  }
};

const isAccessMode = (value: unknown): value is SessionAccessMode => value === 'PUBLIC' || value === 'CONTROLLED';
const isAccessState = (value: unknown): value is AudienceAccessState => (
  value === 'REQUEST_REQUIRED' || value === 'WAITING' || value === 'ADMITTED' ||
  value === 'REJECTED' || value === 'BLOCKED' || value === 'CREDENTIAL_OBSOLETE'
);

export function useAudienceAccess() {
  const [snapshot, setSnapshot] = useState<AudienceAccessSnapshot>({
    presentationSessionId: '',
    accessMode: 'PUBLIC',
    participantId: null,
    accessState: 'LOADING',
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
      const stored = readStoredAccess();
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
        typeof body.participantId !== 'string' ||
        !isAccessMode(body.accessMode) ||
        !isAccessState(body.accessState)
      ) throw new Error('Invalid audience access bootstrap');

      const nextCredential = typeof body.credential === 'string'
        ? body.credential
        : stored?.presentationSessionId === body.presentationSessionId
          ? stored.credential
          : null;
      if (!nextCredential) throw new Error('Audience credential unavailable');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        presentationSessionId: body.presentationSessionId,
        credential: nextCredential,
      }));
      setCredential(nextCredential);
      setSnapshot({
        presentationSessionId: body.presentationSessionId,
        accessMode: body.accessMode,
        participantId: body.participantId,
        accessState: body.accessState,
        retryAt: typeof body.retryAt === 'number' ? body.retryAt : undefined,
      });
      if (body.accessState === 'ADMITTED') void issueTickets(nextCredential);
    } catch {
      setSnapshot((current) => ({ ...current, accessState: 'CREDENTIAL_OBSOLETE' }));
    } finally {
      bootstrappingRef.current = false;
    }
  }, [issueTickets]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    if (snapshot.accessState !== 'CREDENTIAL_OBSOLETE') return;
    const retry = window.setTimeout(() => void bootstrap(), 2_000);
    return () => window.clearTimeout(retry);
  }, [bootstrap, snapshot.accessState]);

  const handleWsMessage = useCallback((type: string, payload: Record<string, unknown>) => {
    if (type === 'PRESENTATION_SESSION_ROTATED' || payload.accessState === 'CREDENTIAL_OBSOLETE') {
      localStorage.removeItem(STORAGE_KEY);
      setCredential(null);
      setStateSseTicket(null);
      setQuizSseTicket(null);
      sessionStorage.removeItem('sefer-audience-quiz-sse-ticket');
      void bootstrap();
      return;
    }
    if (type !== 'AUDIENCE_ACCESS_STATE' && type !== 'SESSION_ACCESS_POLICY') return;

    setSnapshot((current) => {
      const next = {
        presentationSessionId: typeof payload.presentationSessionId === 'string'
          ? payload.presentationSessionId
          : current.presentationSessionId,
        accessMode: isAccessMode(payload.accessMode) ? payload.accessMode : current.accessMode,
        participantId: typeof payload.participantId === 'string' ? payload.participantId : current.participantId,
        accessState: isAccessState(payload.accessState) ? payload.accessState : current.accessState,
        retryAt: typeof payload.retryAt === 'number' ? payload.retryAt : undefined,
      } satisfies AudienceAccessSnapshot;
      if (next.accessState === 'ADMITTED' && credential) void issueTickets(credential);
      if (next.accessState !== 'ADMITTED') {
        setStateSseTicket(null);
        setQuizSseTicket(null);
        sessionStorage.removeItem('sefer-audience-quiz-sse-ticket');
      }
      return next;
    });
  }, [bootstrap, credential, issueTickets]);

  const refreshTickets = useCallback(() => {
    if (credential && snapshot.accessState === 'ADMITTED') void issueTickets(credential);
  }, [credential, issueTickets, snapshot.accessState]);

  useEffect(() => {
    window.addEventListener('sefer-audience-sse-refresh-request', refreshTickets);
    return () => window.removeEventListener('sefer-audience-sse-refresh-request', refreshTickets);
  }, [refreshTickets]);

  return {
    ...snapshot,
    credential,
    stateSseTicket,
    quizSseTicket,
    authorized: snapshot.accessState === 'ADMITTED',
    handleWsMessage,
    refreshTickets,
  };
}
