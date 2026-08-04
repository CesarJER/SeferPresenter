/**
 * useQuizAnswers — local Audience answers with aggregate-only Control sync.
 *
 * This hook manages:
 * 1. The audience member's own answers (local state)
 * 2. Sending unlinkable, bounded aggregate contributions to the backend
 * 3. On the controller side: receiving aggregate snapshots only
 *
 * Architecture:
 * - Audience side: detailed answers remain local to the current presentation.
 * - Backend side: submissions use independent IDs per aggregation scope so
 *   answers and result buckets cannot be linked into a participant history.
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
  /** Submit answer for a slide (broadcasts to controller) */
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

const ANSWERS_STORAGE_KEY = 'sefer-quiz-answers-by-presentation';
const SCORES_STORAGE_KEY = 'sefer-quiz-scores-by-presentation';

export function useAudienceAnswers(
  presentationId: string | null,
): UseAudienceAnswersReturn {
  const channel = useMemo(() => new BroadcastChannel('sefer-quiz'), []);
  const answerSubmissionIdsRef = useRef<Record<string, string>>({});
  const resultSubmissionIdsRef = useRef<Record<string, string>>({});
  const finalSubmissionIdsRef = useRef<Record<number, string>>({});
  const scopeId = presentationId ?? '';

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
      answerSubmissionIdsRef.current = {};
      resultSubmissionIdsRef.current = {};
      finalSubmissionIdsRef.current = {};
      setAnswersByPresentation({});
      setScoresByPresentation({});
    };
    window.addEventListener('sefer-audience-logout', handleLogout);
    return () => window.removeEventListener('sefer-audience-logout', handleLogout);
  }, []);

  // Listen for CLEAR commands from controller and LOGOUT events from PWA identity
  useEffect(() => {
    const processClear = (slideId: string) => {
      if (!scopeId) return;
      delete answerSubmissionIdsRef.current[slideId];
      delete resultSubmissionIdsRef.current[slideId];
      finalSubmissionIdsRef.current = {};
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

    const eventSource = new EventSource('/api/quiz-events');
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

    return () => {
      channel.removeEventListener('message', handleChannelMessage);
      eventSource.close();
    };
  }, [channel, scopeId]);

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
    const submissionId = answerSubmissionIdsRef.current[slideId] ?? makeQuizSubmissionId();
    answerSubmissionIdsRef.current[slideId] = submissionId;
    const msg: QuizAnswerAggregateMessage = {
      type: 'QUIZ_ANSWER_AGGREGATE',
      presentationId,
      submissionId,
      slideId,
      selectedOptionIds: answer.selectedOptionIds,
    };

    fetch('/api/quiz-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }).catch(() => {}); // Non-critical — local state is source of truth
  }, [presentationId]);

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
    delete answerSubmissionIdsRef.current[slideId];
    delete resultSubmissionIdsRef.current[slideId];
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
  }, [scopeId]);

  const sendFinalScore = useCallback((rank: number, requestId: number) => {
    if (!presentationId) return;
    const submissionId = finalSubmissionIdsRef.current[requestId] ?? makeQuizSubmissionId();
    finalSubmissionIdsRef.current[requestId] = submissionId;
    const msg: QuizFinalScoreAggregateMessage = {
      type: 'QUIZ_FINAL_SCORE_AGGREGATE',
      presentationId,
      submissionId,
      requestId,
      rank,
    };

    fetch('/api/quiz-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }).catch(() => {});
  }, [presentationId]);

  const getScores = useCallback(() => scores, [scores]);

  const saveScore = useCallback((slideId: string, score: QuizQuestionScore) => {
    if (!scopeId) return;
    setScoresByPresentation(prev => ({
      ...prev,
      [scopeId]: { ...(prev[scopeId] ?? {}), [slideId]: score },
    }));
    if (!presentationId || resultSubmissionIdsRef.current[slideId]) return;
    const submissionId = makeQuizSubmissionId();
    resultSubmissionIdsRef.current[slideId] = submissionId;
    const msg: QuizQuestionResultAggregateMessage = {
      type: 'QUIZ_QUESTION_RESULT_AGGREGATE',
      presentationId,
      submissionId,
      slideId,
      isCitaCorrect: score.citaCentipunts > 0,
    };
    fetch('/api/quiz-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }).catch(() => {});
  }, [presentationId, scopeId]);

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
  clearSlideAnswers: (slideId: string) => void;
}

export function useControllerAnswers(presentationId: string | null): UseControllerAnswersReturn {
  const channel = useMemo(() => new BroadcastChannel('sefer-quiz'), []);
  const [aggregate, setAggregate] = useState<QuizAggregateSnapshot>(EMPTY_AGGREGATE);

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

  const clearSlideAnswers = useCallback((slideId: string) => {
    if (!presentationId) return;
    // Send clear message locally via BroadcastChannel
    const msg: QuizClearMessage = { type: 'QUIZ_CLEAR_ANSWERS', presentationId, slideId };
    channel.postMessage(msg);

    // Also send to server via SSE endpoint for cross-device sync (smartphones)
    fetch('/api/quiz-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }).catch(() => {});

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
