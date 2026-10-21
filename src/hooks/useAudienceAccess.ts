import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudienceAccessSnapshot, AudienceAccessState, SessionAccessMode } from '../types/audienceAccess';
import type { WebSocketConnectionStatus } from './useWebSocket';

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
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const ticketRequestRef = useRef(0);
  const connectionRevisionRef = useRef(0);
  const currentRef = useRef({ snapshot, credential, connected: false, bound: false });

  const clearTickets = useCallback(() => {
    ticketRequestRef.current += 1;
    setStateSseTicket(null);
    setQuizSseTicket(null);
    sessionStorage.removeItem('sefer-audience-quiz-sse-ticket');
  }, []);

  const handleWsConnectionChange = useCallback((status: WebSocketConnectionStatus) => {
    connectionRevisionRef.current += 1;
    currentRef.current.connected = status === 'open';
    currentRef.current.bound = false;
  }, []);
  const getWsBindingEpoch = useCallback(() => `${generationRef.current}:${connectionRevisionRef.current}`, []);

  const isCurrentWsBinding = useCallback(() => {
    const current = currentRef.current;
    return mountedRef.current && current.connected && current.bound && current.credential === credential
      && current.snapshot.accessState !== 'LOADING' && current.snapshot.accessState !== 'CREDENTIAL_OBSOLETE'
      && current.snapshot.participantId === snapshot.participantId
      && current.snapshot.presentationSessionId === snapshot.presentationSessionId;
  }, [credential, snapshot.participantId, snapshot.presentationSessionId]);

  const issueTickets = useCallback(async (activeCredential: string) => {
    if (!mountedRef.current || currentRef.current.credential !== activeCredential) return;
    const generation = generationRef.current;
    const request = ++ticketRequestRef.current;
    const isCurrent = () => mountedRef.current && generation === generationRef.current && request === ticketRequestRef.current
      && currentRef.current.credential === activeCredential && currentRef.current.snapshot.accessState === 'ADMITTED';
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

    const [stateTicket, quizTicket] = await Promise.all([issue('STATE').catch(() => null), issue('QUIZ').catch(() => null)]);
    if (!isCurrent()) return;
    setStateSseTicket(stateTicket);
    setQuizSseTicket(quizTicket);
    if (quizTicket) sessionStorage.setItem('sefer-audience-quiz-sse-ticket', quizTicket);
    else sessionStorage.removeItem('sefer-audience-quiz-sse-ticket');
    window.dispatchEvent(new CustomEvent('sefer-audience-tickets-updated'));
  }, []);

  const bootstrap = useCallback(async () => {
    if (!mountedRef.current || bootstrappingRef.current) return;
    bootstrappingRef.current = true;
    const generation = ++generationRef.current;
    const isCurrent = () => mountedRef.current && generation === generationRef.current;
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
      if (!isCurrent()) return;
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
      const nextSnapshot: AudienceAccessSnapshot = {
        presentationSessionId: body.presentationSessionId,
        accessMode: body.accessMode,
        participantId: body.participantId,
        accessState: body.accessState,
        retryAt: typeof body.retryAt === 'number' ? body.retryAt : undefined,
      };
      currentRef.current = { ...currentRef.current, snapshot: nextSnapshot, credential: nextCredential, bound: false };
      setCredential(nextCredential);
      setSnapshot(nextSnapshot);
      if (body.accessState === 'ADMITTED') void issueTickets(nextCredential).catch(() => {});
    } catch {
      if (!isCurrent()) return;
      currentRef.current.bound = false;
      currentRef.current.snapshot = { ...currentRef.current.snapshot, accessState: 'CREDENTIAL_OBSOLETE' };
      setSnapshot(currentRef.current.snapshot);
    } finally {
      if (isCurrent()) bootstrappingRef.current = false;
    }
  }, [issueTickets]);

  useEffect(() => {
    mountedRef.current = true;
    void bootstrap();
    return () => {
      mountedRef.current = false;
      ticketRequestRef.current += 1;
      currentRef.current.bound = false;
    };
  }, [bootstrap]);

  useEffect(() => {
    if (snapshot.accessState !== 'CREDENTIAL_OBSOLETE') return;
    const retry = window.setTimeout(() => void bootstrap(), 2_000);
    return () => window.clearTimeout(retry);
  }, [bootstrap, snapshot.accessState]);

  const handleWsMessage = useCallback((type: string, payload: Record<string, unknown>) => {
    if (type === 'WELCOME') {
      connectionRevisionRef.current += 1;
      currentRef.current.bound = false;
      return;
    }
    if (type === 'PRESENTATION_SESSION_ROTATED' || (type === 'AUDIENCE_ACCESS_STATE' && payload.accessState === 'CREDENTIAL_OBSOLETE')) {
      generationRef.current += 1;
      bootstrappingRef.current = false;
      currentRef.current = { ...currentRef.current, credential: null, bound: false,
        snapshot: { ...currentRef.current.snapshot, participantId: null, accessState: 'CREDENTIAL_OBSOLETE' } };
      setSnapshot(currentRef.current.snapshot);
      if (payload.hardRefresh) {
        setTimeout(() => window.location.reload(), 150);
      }
      localStorage.removeItem(STORAGE_KEY);
      setCredential(null);
      clearTickets();
      void bootstrap();
      return;
    }
    if (type !== 'AUDIENCE_ACCESS_STATE' && type !== 'SESSION_ACCESS_POLICY') return;

    const current = currentRef.current.snapshot;
    if (payload.presentationSessionId !== current.presentationSessionId) return;
    if (type === 'AUDIENCE_ACCESS_STATE' && (!isAccessState(payload.accessState)
      || !currentRef.current.connected || !currentRef.current.credential
      || payload.participantId !== current.participantId)) return;
    const next = {
      presentationSessionId: typeof payload.presentationSessionId === 'string'
        ? payload.presentationSessionId
        : current.presentationSessionId,
      accessMode: isAccessMode(payload.accessMode) ? payload.accessMode : current.accessMode,
      participantId: typeof payload.participantId === 'string' ? payload.participantId : current.participantId,
      accessState: isAccessState(payload.accessState) ? payload.accessState : current.accessState,
      retryAt: typeof payload.retryAt === 'number' ? payload.retryAt : undefined,
    } satisfies AudienceAccessSnapshot;
    currentRef.current.snapshot = next;
    if (type === 'AUDIENCE_ACCESS_STATE') currentRef.current.bound = true;
    setSnapshot(next);
    if (next.accessState === 'ADMITTED' && currentRef.current.credential) {
      void issueTickets(currentRef.current.credential).catch(clearTickets);
    } else clearTickets();
  }, [bootstrap, clearTickets, issueTickets]);

  const refreshTickets = useCallback(() => {
    if (credential && snapshot.accessState === 'ADMITTED') void issueTickets(credential).catch(clearTickets);
  }, [clearTickets, credential, issueTickets, snapshot.accessState]);

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
    handleWsConnectionChange,
    isCurrentWsBinding,
    getWsBindingEpoch,
    sessionGeneration: generationRef.current,
    refreshTickets,
  };
}
