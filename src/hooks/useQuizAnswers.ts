/**
 * useQuizAnswers — local Audience answers with aggregate-only Control sync.
 *
 * This hook manages:
 * 1. The audience member's own answers (local state)
 * 2. Sending bounded aggregate contributions with independent IDs per scope
 * 3. On the controller side: receiving aggregate snapshots only
 *
 * Architecture:
 * - Audience side: detailed answers remain local to the current presentation.
 * - Backend side: submissions use independent IDs per aggregation scope so
 *   the aggregate store has no shared participant ID across those buckets.
 *   This does not guarantee anonymity against timing/network correlation.
 * - Controller side: no individual answer or Audience identity is exposed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QuizOptionId, QuizResultProfile } from '../types/presentation';
import type {
  QuizAudienceAnswer,
  QuizAggregateSnapshot,
  QuizRangeStats,
  QuizQuestionScore,
  QuizSlideAggregate,
} from '../types/quiz';
import { makeEmptyAudienceAnswer } from '../types/quiz';
import { readExpiringStorage, writeExpiringStorage } from '../utils/privacyStorage';
import { getOperatorHeaders } from '../utils/operatorAuth';

// ── Unlinkable submission IDs ────────────────────────────────────────────────

const makeQuizSubmissionId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `qa-${crypto.randomUUID()}`
    : `qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ── Message types ─────────────────────────────────────────────────────────────

interface QuizAnswerAggregateMessage {
  type: 'QUIZ_ANSWER_AGGREGATE';
  presentationId: string;
  submissionId: string;
  slideId: string;
  selectedOptionIds: QuizOptionId[];
}

interface QuizClearMessage {
  type: 'QUIZ_CLEAR_ANSWERS';
  presentationId: string;
  slideId: string;
}

interface QuizQuestionResultAggregateMessage {
  type: 'QUIZ_QUESTION_RESULT_AGGREGATE';
  presentationId: string;
  submissionId: string;
  slideId: string;
  isCitaCorrect: boolean;
}

interface QuizFinalScoreAggregateMessage {
  type: 'QUIZ_FINAL_SCORE_AGGREGATE';
  presentationId: string;
  submissionId: string;
  requestId: number;
  rank: number;
}

interface QuizAggregateSnapshotMessage {
  type: 'QUIZ_AGGREGATE_SNAPSHOT';
  presentationId: string;
  aggregate: QuizAggregateSnapshot;
}

type QuizMessage =
  | QuizAnswerAggregateMessage
  | QuizQuestionResultAggregateMessage
  | QuizFinalScoreAggregateMessage
  | QuizClearMessage
  | QuizAggregateSnapshotMessage;

// ── Audience-side hook ────────────────────────────────────────────────────────

export interface UseAudienceAnswersReturn {
  /** All draft answers keyed by slideId */
  getAnswers: () => Record<string, QuizAudienceAnswer>;
  /** Current draft answer for the given slide */
  getAnswer: (slideId: string) => QuizAudienceAnswer;
  /** Toggle a radio option selection */
  selectRadioOption: (slideId: string, optionId: QuizOptionId) => void;
  /** Toggle a checkbox option */
  toggleCheckboxOption: (slideId: string, optionId: QuizOptionId) => void;
  /** Update cita fields */
  setCitaField: (slideId: string, field: Partial<Pick<QuizAudienceAnswer, 'citaBook' | 'citaChapter' | 'citaVerseStart' | 'citaVerseEnd'>>) => void;
  /** Toggle bonus reading claim */
  setBonusClaim: (slideId: string, claimed: boolean) => void;
  /** Submit an aggregate contribution for a slide; Control receives aggregate snapshots. */
  submitAnswer: (slideId: string) => void;
  /** Auto-submit all unsubmitted answers (called on timer expire) */
  submitAll: (slideId: string) => void;
  /** Clear answer for a slide (for retry/reset) */
  clearAnswer: (slideId: string) => void;
  /** Send only the locally calculated result rank for aggregate counting. */
  sendFinalScore: (rank: number, requestId: number) => void;
  /** Get all locally saved scores */
  getScores: () => Record<string, QuizQuestionScore>;
  /** Save a calculated score for a slide */
  saveScore: (slideId: string, score: QuizQuestionScore) => void;
}

type AnswersByPresentation = Record<string, Record<string, QuizAudienceAnswer>>;
type ScoresByPresentation = Record<string, Record<string, QuizQuestionScore>>;
type QuizContribution = QuizAnswerAggregateMessage | QuizQuestionResultAggregateMessage | QuizFinalScoreAggregateMessage;
type QuizContributionInput = Omit<QuizAnswerAggregateMessage, 'submissionId'>
  | Omit<QuizQuestionResultAggregateMessage, 'submissionId'> | Omit<QuizFinalScoreAggregateMessage, 'submissionId'>;
type QuizOutbox = Record<string, { message: QuizContribution; expiresAt: number }>;

const ANSWERS_STORAGE_KEY = 'sefer-quiz-answers-by-presentation';
const SCORES_STORAGE_KEY = 'sefer-quiz-scores-by-presentation';
const OUTBOX_STORAGE_KEY = 'sefer-quiz-outbox';
// Keep acknowledged IDs too: a reconnect can reach a restarted, empty aggregate server.
const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [1000, 3000, 10000];
const AUDIENCE_ACCESS_STORAGE_KEY = 'sefer-audience-access';
const AUDIENCE_QUIZ_TICKET_KEY = 'sefer-audience-quiz-sse-ticket';

const getAudienceAccessCredential = (): string | null => {
  try {
    const stored = JSON.parse(localStorage.getItem(AUDIENCE_ACCESS_STORAGE_KEY) ?? 'null') as { credential?: unknown } | null;
    return typeof stored?.credential === 'string' ? stored.credential : null;
  } catch {
    return null;
  }
};

const getAudienceRequestHeaders = (): Record<string, string> => {
  const credential = getAudienceAccessCredential();
  return {
    'Content-Type': 'application/json',
    ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
  };
};

export function useAudienceAnswers(
  presentationId: string | null,
): UseAudienceAnswersReturn {
  const channel = useMemo(() => new BroadcastChannel('sefer-quiz'), []);
  const scopeId = presentationId ?? '';
  const [ticketRevision, setTicketRevision] = useState(0);
  const [initialOutbox] = useState<QuizOutbox>(() => {
    try { return readExpiringStorage<QuizOutbox>(localStorage, OUTBOX_STORAGE_KEY) ?? {}; }
    catch { return {}; }
  });
  const outboxRef = useRef(initialOutbox);
  const transportRef = useRef({
    running: false, blocked: false, retries: 0, generation: 0, active: true,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    controller: null as AbortController | null,
    delivered: new Set<string>(), replay: false,
  });
  const flushRef = useRef<() => void>(() => {});

  const persistOutbox = useCallback(() => {
    outboxRef.current = Object.fromEntries(Object.entries(outboxRef.current)
      .filter(([, entry]) => entry?.message && Number.isFinite(entry.expiresAt) && entry.expiresAt > Date.now()));
    try {
      if (Object.keys(outboxRef.current).length) writeExpiringStorage(localStorage, OUTBOX_STORAGE_KEY, outboxRef.current);
      else localStorage.removeItem(OUTBOX_STORAGE_KEY);
    }
    catch { /* Memory remains usable when browser storage is unavailable. */ }
  }, []);

  const flushOutbox = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport.active || transport.blocked || !scopeId || navigator.onLine === false) return;
    if (getAudienceAccessCredential() && !sessionStorage.getItem(AUDIENCE_QUIZ_TICKET_KEY)) return;
    if (transport.running) { transport.replay = true; return; }
    transport.running = true;
    transport.replay = false;
    const generation = transport.generation;
    let retry = false;
    try {
      persistOutbox();
      for (const [key, entry] of Object.entries(outboxRef.current)) {
        if (!transport.active || transport.generation !== generation) break;
        const message = entry.message;
        if (message.presentationId !== scopeId || transport.delivered.has(message.submissionId)) continue;
        if (outboxRef.current[key] !== entry) continue;
        const controller = new AbortController();
        transport.controller = controller;
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch('/api/quiz-answer', {
            method: 'POST', headers: getAudienceRequestHeaders(),
            body: JSON.stringify(message), signal: controller.signal,
          });
          if (transport.generation !== generation || !transport.active) break;
          if (response.ok) transport.delivered.add(message.submissionId);
          else if (response.status === 401 || response.status === 403) {
            transport.blocked = true;
            break;
          } else {
            retry = response.status >= 500;
            if (response.status === 409) {
              const body = await response.json().catch(() => null);
              retry = body?.error === 'Quiz message does not match the active presentation';
            }
            if (retry) break;
          }
        } catch {
          retry = transport.generation === generation && transport.active;
          break;
        } finally {
          clearTimeout(timeout);
          transport.controller = null;
        }
      }
    } finally {
      transport.running = false;
      if (transport.active && !transport.blocked) {
        if (transport.replay || transport.generation !== generation) {
          transport.replay = false;
          flushRef.current();
        } else if (retry && transport.retries < RETRY_DELAYS_MS.length) {
          clearTimeout(transport.timer);
          transport.timer = setTimeout(() => flushRef.current(), RETRY_DELAYS_MS[transport.retries++]);
        }
      }
    }
  }, [scopeId, persistOutbox]);

  useEffect(() => {
    const transport = transportRef.current;
    transport.active = true;
    flushRef.current = () => { void flushOutbox(); };
    flushRef.current();
    return () => {
      transport.active = false;
      transport.generation++;
      clearTimeout(transport.timer);
      transport.controller?.abort();
    };
  }, [flushOutbox]);

  const replayOutbox = useCallback((accessUpdated = false) => {
    const transport = transportRef.current;
    if (accessUpdated) transport.blocked = false;
    transport.generation++;
    transport.delivered.clear();
    transport.retries = 0;
    clearTimeout(transport.timer);
    transport.controller?.abort();
    flushRef.current();
  }, []);

  const clearQueuedSlide = useCallback((slideId: string) => {
    for (const [key, entry] of Object.entries(outboxRef.current)) {
      if (entry.message.presentationId === scopeId &&
          (entry.message.type === 'QUIZ_FINAL_SCORE_AGGREGATE' || entry.message.slideId === slideId)) {
        delete outboxRef.current[key];
      }
    }
    transportRef.current.generation++;
    transportRef.current.controller?.abort();
    clearTimeout(transportRef.current.timer);
    persistOutbox();
  }, [scopeId, persistOutbox]);

  const enqueue = useCallback((input: QuizContributionInput) => {
    persistOutbox();
    const key = JSON.stringify([input.presentationId, input.type,
      input.type === 'QUIZ_FINAL_SCORE_AGGREGATE' ? 'final' : input.slideId]);
    const previous = outboxRef.current[key];
    if (input.type === 'QUIZ_FINAL_SCORE_AGGREGATE' && previous?.message.type === input.type &&
        input.requestId < previous.message.requestId) return;
    if (!previous || (input.type === 'QUIZ_FINAL_SCORE_AGGREGATE' &&
        previous.message.type === input.type && previous.message.requestId !== input.requestId)) {
      outboxRef.current[key] = {
        message: { ...input, submissionId: makeQuizSubmissionId() }, expiresAt: Date.now() + OUTBOX_TTL_MS,
      };
      persistOutbox();
    }
    transportRef.current.retries = 0;
    clearTimeout(transportRef.current.timer);
    flushRef.current();
  }, [persistOutbox]);

  const [answersByPresentation, setAnswersByPresentation] = useState<AnswersByPresentation>(() => {
    try {
      return readExpiringStorage<AnswersByPresentation>(localStorage, ANSWERS_STORAGE_KEY) ?? {};
    } catch {
      return {};
    }
  });

  const [scoresByPresentation, setScoresByPresentation] = useState<ScoresByPresentation>(() => {
    try {
      return readExpiringStorage<ScoresByPresentation>(localStorage, SCORES_STORAGE_KEY) ?? {};
    } catch {
      return {};
    }
  });

  const answers = useMemo(
    () => answersByPresentation[scopeId] ?? {},
    [answersByPresentation, scopeId],
  );
  const scores = useMemo(
    () => scoresByPresentation[scopeId] ?? {},
    [scoresByPresentation, scopeId],
  );

  useEffect(() => {
    try {
      writeExpiringStorage(localStorage, ANSWERS_STORAGE_KEY, answersByPresentation);
    } catch {
      // Storage quota exceeded — silently ignore
    }
  }, [answersByPresentation]);

  // Persist to localStorage whenever scores change
  useEffect(() => {
    try {
      writeExpiringStorage(localStorage, SCORES_STORAGE_KEY, scoresByPresentation);
    } catch {
      // Ignore
    }
  }, [scoresByPresentation]);

  useEffect(() => {
    const handleLogout = () => {
      localStorage.removeItem(ANSWERS_STORAGE_KEY);
      localStorage.removeItem(SCORES_STORAGE_KEY);
      localStorage.removeItem('sefer-quiz-session-id');
      outboxRef.current = {};
      localStorage.removeItem(OUTBOX_STORAGE_KEY);
      transportRef.current.generation++;
      transportRef.current.controller?.abort();
      transportRef.current.delivered.clear();
      clearTimeout(transportRef.current.timer);
      setAnswersByPresentation({});
      setScoresByPresentation({});
    };
    window.addEventListener('sefer-audience-logout', handleLogout);
    return () => window.removeEventListener('sefer-audience-logout', handleLogout);
  }, []);

  useEffect(() => {
    const handleTicketUpdate = () => {
      setTicketRevision(revision => revision + 1);
      replayOutbox(true);
    };
    const handleOnline = () => replayOutbox();
    window.addEventListener('sefer-audience-tickets-updated', handleTicketUpdate);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('sefer-audience-tickets-updated', handleTicketUpdate);
      window.removeEventListener('online', handleOnline);
    };
  }, [replayOutbox]);

  // Listen for CLEAR commands from controller and LOGOUT events from PWA identity
  useEffect(() => {
    const processClear = (slideId: string) => {
      if (!scopeId) return;
      clearQueuedSlide(slideId);
      setAnswersByPresentation(prev => {
        const scoped = prev[scopeId] ?? {};
        const current = scoped[slideId];
        if (!current) return prev;
        return {
          ...prev,
          [scopeId]: {
            ...scoped,
            [slideId]: { ...current, submitted: false, submittedAt: null },
          },
        };
      });
      setScoresByPresentation(prev => {
        const scoped = prev[scopeId] ?? {};
        if (!scoped[slideId]) return prev;
        const nextScoped = { ...scoped };
        delete nextScoped[slideId];
        return { ...prev, [scopeId]: nextScoped };
      });
    };

    const handleChannelMessage = (event: MessageEvent) => {
      const data = event.data as QuizMessage;
      if (data?.type === 'QUIZ_CLEAR_ANSWERS' && data.presentationId === scopeId) {
        processClear(data.slideId);
      }
    };

    channel.addEventListener('message', handleChannelMessage);

    const credential = getAudienceAccessCredential();
    const ticket = sessionStorage.getItem(AUDIENCE_QUIZ_TICKET_KEY);
    if (credential && !ticket) {
      channel.removeEventListener('message', handleChannelMessage);
      return;
    }

    const eventSource = new EventSource(
      ticket ? `/api/quiz-events?ticket=${encodeURIComponent(ticket)}` : '/api/quiz-events',
    );
    eventSource.onopen = () => replayOutbox(true);
    eventSource.onmessage = (event) => {
      try {
        if (event.data === 'heartbeat') return;
        const data = JSON.parse(event.data);
        if (data?.type === 'QUIZ_CLEAR_ANSWERS' && data.presentationId === scopeId) {
          processClear(data.slideId);
        }
      } catch {
        // intentional no-op
      }
    };
    eventSource.onerror = () => {
      if (!credential) return;
      eventSource.close();
      window.dispatchEvent(new CustomEvent('sefer-audience-sse-refresh-request'));
    };

    return () => {
      channel.removeEventListener('message', handleChannelMessage);
      eventSource.close();
    };
  }, [channel, scopeId, ticketRevision, clearQueuedSlide, replayOutbox]);

  const getAnswers = useCallback(() => answers, [answers]);

  const getAnswer = useCallback((slideId: string): QuizAudienceAnswer => {
    return answers[slideId] ?? makeEmptyAudienceAnswer(slideId);
  }, [answers]);

  const updateAnswer = useCallback((slideId: string, updater: (prev: QuizAudienceAnswer) => QuizAudienceAnswer) => {
    if (!scopeId) return;
    setAnswersByPresentation(prev => {
      const scoped = prev[scopeId] ?? {};
      const current = scoped[slideId] ?? makeEmptyAudienceAnswer(slideId);
      const updated = updater(current);
      return { ...prev, [scopeId]: { ...scoped, [slideId]: updated } };
    });
  }, [scopeId]);

  const broadcast = useCallback((slideId: string, answer: QuizAudienceAnswer) => {
    if (!presentationId) return;
    enqueue({
      type: 'QUIZ_ANSWER_AGGREGATE',
      presentationId,
      slideId,
      selectedOptionIds: answer.selectedOptionIds,
    });
  }, [presentationId, enqueue]);

  const selectRadioOption = useCallback((slideId: string, optionId: QuizOptionId) => {
    updateAnswer(slideId, prev => ({ ...prev, selectedOptionIds: [optionId] }));
  }, [updateAnswer]);

  const toggleCheckboxOption = useCallback((slideId: string, optionId: QuizOptionId) => {
    updateAnswer(slideId, prev => {
      const current = prev.selectedOptionIds;
      const has = current.includes(optionId);
      return {
        ...prev,
        selectedOptionIds: has
          ? current.filter(id => id !== optionId)
          : [...current, optionId],
      };
    });
  }, [updateAnswer]);

  const setCitaField = useCallback((
    slideId: string,
    fields: Partial<Pick<QuizAudienceAnswer, 'citaBook' | 'citaChapter' | 'citaVerseStart' | 'citaVerseEnd'>>,
  ) => {
    updateAnswer(slideId, prev => ({ ...prev, ...fields }));
  }, [updateAnswer]);

  const setBonusClaim = useCallback((slideId: string, claimed: boolean) => {
    updateAnswer(slideId, prev => ({ ...prev, bonusReadingClaimed: claimed }));
  }, [updateAnswer]);

  const submitAnswer = useCallback((slideId: string) => {
    if (!scopeId) return;
    setAnswersByPresentation(prev => {
      const scoped = prev[scopeId] ?? {};
      const current = scoped[slideId] ?? makeEmptyAudienceAnswer(slideId);
      if (current.submitted) return prev; // idempotent
      const submitted = { ...current, submitted: true, submittedAt: Date.now() };
      broadcast(slideId, submitted);
      return { ...prev, [scopeId]: { ...scoped, [slideId]: submitted } };
    });
  }, [broadcast, scopeId]);

  const submitAll = useCallback((slideId: string) => {
    if (!scopeId) return;
    setAnswersByPresentation(prev => {
      const scoped = prev[scopeId] ?? {};
      const current = scoped[slideId] ?? makeEmptyAudienceAnswer(slideId);
      if (current.submitted) return prev;
      const submitted = { ...current, submitted: true, submittedAt: Date.now() };
      broadcast(slideId, submitted);
      return { ...prev, [scopeId]: { ...scoped, [slideId]: submitted } };
    });
  }, [broadcast, scopeId]);

  const clearAnswer = useCallback((slideId: string) => {
    if (!scopeId) return;
    clearQueuedSlide(slideId);
    setAnswersByPresentation(prev => {
      const nextScoped = { ...(prev[scopeId] ?? {}) };
      delete nextScoped[slideId];
      return { ...prev, [scopeId]: nextScoped };
    });
    setScoresByPresentation(prev => {
      const nextScoped = { ...(prev[scopeId] ?? {}) };
      delete nextScoped[slideId];
      return { ...prev, [scopeId]: nextScoped };
    });
  }, [scopeId, clearQueuedSlide]);

  const sendFinalScore = useCallback((rank: number, requestId: number) => {
    if (!presentationId) return;
    enqueue({
      type: 'QUIZ_FINAL_SCORE_AGGREGATE',
      presentationId,
      requestId,
      rank,
    });
  }, [presentationId, enqueue]);

  const getScores = useCallback(() => scores, [scores]);

  const saveScore = useCallback((slideId: string, score: QuizQuestionScore) => {
    if (!scopeId) return;
    setScoresByPresentation(prev => ({
      ...prev,
      [scopeId]: { ...(prev[scopeId] ?? {}), [slideId]: score },
    }));
    if (!presentationId) return;
    enqueue({
      type: 'QUIZ_QUESTION_RESULT_AGGREGATE',
      presentationId,
      slideId,
      isCitaCorrect: score.citaCentipunts > 0,
    });
  }, [presentationId, scopeId, enqueue]);

  return {
    getAnswers,
    getAnswer,
    selectRadioOption,
    toggleCheckboxOption,
    setCitaField,
    setBonusClaim,
    submitAnswer,
    submitAll,
    clearAnswer,
    sendFinalScore,
    getScores,
    saveScore,
  };
}

// ── Controller-side hook ──────────────────────────────────────────────────────

const EMPTY_AGGREGATE: QuizAggregateSnapshot = {
  slides: {},
  submittedAnswersBySlideId: {},
  finalScoreRanges: {},
  totalFinalScores: 0,
  minimumGroupSize: 3,
  finalScoreRequestId: null,
  updatedAt: null,
};

export interface UseControllerAnswersReturn {
  getSlideAggregate: (slideId: string) => QuizSlideAggregate;
  getSubmittedCount: (slideId: string) => number;
  totalParticipants: number;
  clearAll: () => void;
  calcRangeStats: (profiles: QuizResultProfile[]) => QuizRangeStats[];
  clearSlideAnswers: (slideId: string) => Promise<boolean>;
}

export function useControllerAnswers(presentationId: string | null): UseControllerAnswersReturn {
  const channel = useMemo(() => new BroadcastChannel('sefer-quiz'), []);
  const [aggregate, setAggregate] = useState<QuizAggregateSnapshot>(EMPTY_AGGREGATE);
  const currentPresentationId = useRef(presentationId);
  currentPresentationId.current = presentationId;

  useEffect(() => {
    let cancelled = false;
    const applySnapshot = (data: QuizAggregateSnapshotMessage) => {
      if (cancelled || !presentationId || data.presentationId !== presentationId) return;
      if (data.type !== 'QUIZ_AGGREGATE_SNAPSHOT' || !data.aggregate) return;
      setAggregate(data.aggregate);
    };

    const eventSource = new EventSource('/api/quiz-control-events');
    eventSource.onmessage = (event) => {
      try {
        if (event.data === 'heartbeat') return;
        const data = JSON.parse(event.data) as QuizAggregateSnapshotMessage;
        if (data?.type === 'QUIZ_AGGREGATE_SNAPSHOT') applySnapshot(data);
      } catch {
        // Ignore malformed events.
      }
    };

    if (presentationId) {
      fetch('/api/quiz-control-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presentationId }),
      })
        .then((response) => response.json())
        .then((snapshot: QuizAggregateSnapshotMessage) => applySnapshot(snapshot))
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      eventSource.close();
    };
  }, [presentationId]);

  useEffect(() => setAggregate(EMPTY_AGGREGATE), [presentationId]);

  const getSlideAggregate = useCallback((slideId: string): QuizSlideAggregate => (
    aggregate.slides[slideId] ?? {
      submittedCount: 0,
      optionCounts: {},
      citaHits: 0,
      citaMisses: 0,
    }
  ), [aggregate.slides]);

  const getSubmittedCount = useCallback((slideId: string) => (
    aggregate.slides[slideId]?.submittedCount
      ?? aggregate.submittedAnswersBySlideId[slideId]
      ?? 0
  ), [aggregate.slides, aggregate.submittedAnswersBySlideId]);

  const clearAll = useCallback(() => setAggregate(EMPTY_AGGREGATE), []);

  const clearSlideAnswers = useCallback(async (slideId: string) => {
    if (!presentationId) return false;
    const msg: QuizClearMessage = { type: 'QUIZ_CLEAR_ANSWERS', presentationId, slideId };
    const response = await fetch('/api/quiz-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getOperatorHeaders() },
      body: JSON.stringify(msg),
    });
    if (!response.ok) throw new Error(`Quiz clear failed (${response.status})`);
    channel.postMessage(msg);
    if (currentPresentationId.current !== presentationId) return false;

    setAggregate(prev => {
      const slides = { ...prev.slides };
      const submittedAnswersBySlideId = { ...prev.submittedAnswersBySlideId };
      delete slides[slideId];
      delete submittedAnswersBySlideId[slideId];
      return {
        ...prev,
        slides,
        submittedAnswersBySlideId,
        finalScoreRanges: {},
        totalFinalScores: 0,
        finalScoreRequestId: null,
      };
    });
    return true;
  }, [channel, presentationId]);

  const calcRangeStats = useCallback((profiles: QuizResultProfile[]): QuizRangeStats[] => (
    profiles
      .map((profile) => ({
        rank: profile.rank,
        title: profile.title,
        count: aggregate.finalScoreRanges[String(profile.rank)] ?? 0,
      }))
      .sort((a, b) => a.rank - b.rank)
  ), [aggregate.finalScoreRanges]);

  const totalParticipants = Math.max(
    aggregate.totalFinalScores,
    0,
    ...Object.values(aggregate.slides).map((slide) => slide.submittedCount),
  );

  return { getSlideAggregate, getSubmittedCount, totalParticipants, clearAll, calcRangeStats, clearSlideAnswers };
}

// Re-export helpers for use alongside the hooks
export { makeEmptyAudienceAnswer };
