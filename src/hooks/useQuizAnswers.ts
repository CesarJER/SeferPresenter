/**
 * useQuizAnswers — Audience answer collection with controller sync.
/**
 * useQuizAnswers — Audience answer collection with controller sync.
 *
 * This hook manages:
 * 1. The audience member's own answers (local state)
 * 2. Broadcasting answers to the controller via BroadcastChannel + SSE
 * 3. On the controller side: receiving and aggregating all answers
 *
 * Architecture:
 * - Audience side: stores answers locally for the current presentation session.
 *   On answer submit, broadcasts via a dedicated 'sefer-quiz' channel.
 * - Controller side: listens on 'sefer-quiz' channel and accumulates session answers.
 *
 * Session ID: Ephemeral for the active page/session and rotated on logout.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { QuizOptionId, QuizResultProfile } from '../types/presentation';
import type {
  QuizAudienceAnswer,
  QuizAudienceSession,
  QuizRangeStats,
  QuizQuestionScore,
} from '../types/quiz';
import { makeEmptyAudienceAnswer } from '../types/quiz';
import { refreshProtectedAudienceDrafts } from '../utils/protectedAudienceStore';

// ── Session ID ────────────────────────────────────────────────────────────────

const makeQuizSessionId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `qs-${crypto.randomUUID()}`
    : `qs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ── Message types ─────────────────────────────────────────────────────────────

interface QuizAnswerMessage {
  type: 'QUIZ_ANSWER';
  presentationId: string;
  sessionId: string;
  displayName?: string;
  slideId: string;
  answer: QuizAudienceAnswer;
}

interface QuizClearMessage {
  type: 'QUIZ_CLEAR_ANSWERS';
  presentationId: string;
  slideId: string;
}

interface QuizFinalScoreMessage {
  type: 'QUIZ_FINAL_SCORE';
  presentationId: string;
  sessionId: string;
  totalCentipunts: number;
}

interface QuizSessionSnapshotMessage {
  type: 'QUIZ_SESSION_SNAPSHOT';
  presentationId: string;
  sessions: Record<string, QuizAudienceSession>;
  sessionTotalScores: Record<string, number>;
}

type QuizMessage = QuizAnswerMessage | QuizClearMessage | QuizFinalScoreMessage | QuizSessionSnapshotMessage;

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
  /** Send final calculated score to controller */
  sendFinalScore: (totalCentipunts: number) => void;
  /** Get all locally saved scores */
  getScores: () => Record<string, QuizQuestionScore>;
  /** Save a calculated score for a slide */
  saveScore: (slideId: string, score: QuizQuestionScore) => void;
}

type AnswersByPresentation = Record<string, Record<string, QuizAudienceAnswer>>;
type ScoresByPresentation = Record<string, Record<string, QuizQuestionScore>>;

const ANSWERS_STORAGE_KEY = 'sefer-quiz-answers-by-presentation';
const SCORES_STORAGE_KEY = 'sefer-quiz-scores-by-presentation';
const QUIZ_SSE_TICKET_KEY = 'sefer-audience-quiz-sse-ticket';

const getAudienceCredential = (): string | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem('sefer-audience-resume-credential') || 'null') as {
      credential?: unknown;
    } | null;
    return typeof parsed?.credential === 'string' ? parsed.credential : null;
  } catch {
    return null;
  }
};

const getAudienceParticipantId = (): string | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem('sefer-audience-resume-credential') || 'null') as {
      participantId?: unknown;
    } | null;
    return typeof parsed?.participantId === 'string' ? parsed.participantId : null;
  } catch {
    return null;
  }
};

const getAudienceHeaders = () => {
  const credential = getAudienceCredential();
  return {
    'Content-Type': 'application/json',
    ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
  };
};

export function useAudienceAnswers(
  presentationId: string | null,
  displayName?: string,
): UseAudienceAnswersReturn {
  const [sessionId, setSessionId] = useState(makeQuizSessionId);
  const [ticketRevision, setTicketRevision] = useState(0);
  const channel = useMemo(() => new BroadcastChannel('sefer-quiz'), []);
  const scopeId = presentationId ?? '';

  const [answersByPresentation, setAnswersByPresentation] = useState<AnswersByPresentation>(() => {
    try {
      const stored = localStorage.getItem(ANSWERS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const [scoresByPresentation, setScoresByPresentation] = useState<ScoresByPresentation>(() => {
    try {
      const stored = localStorage.getItem(SCORES_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
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
    const handleTicketUpdate = () => setTicketRevision((value) => value + 1);
    window.addEventListener('sefer-audience-tickets-updated', handleTicketUpdate);
    return () => window.removeEventListener('sefer-audience-tickets-updated', handleTicketUpdate);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ANSWERS_STORAGE_KEY, JSON.stringify(answersByPresentation));
      void refreshProtectedAudienceDrafts();
    } catch {
      // Storage quota exceeded — silently ignore
    }
  }, [answersByPresentation]);

  // Persist to localStorage whenever scores change
  useEffect(() => {
    try {
      localStorage.setItem(SCORES_STORAGE_KEY, JSON.stringify(scoresByPresentation));
      void refreshProtectedAudienceDrafts();
    } catch {
      // Ignore
    }
  }, [scoresByPresentation]);

  useEffect(() => {
    const handleLogout = () => {
      localStorage.removeItem(ANSWERS_STORAGE_KEY);
      localStorage.removeItem(SCORES_STORAGE_KEY);
      localStorage.removeItem('sefer-quiz-session-id');
      setAnswersByPresentation({});
      setScoresByPresentation({});
      setSessionId(makeQuizSessionId());
    };
    const handleProtectedRestore = () => {
      try {
        setAnswersByPresentation(JSON.parse(localStorage.getItem(ANSWERS_STORAGE_KEY) || '{}'));
        setScoresByPresentation(JSON.parse(localStorage.getItem(SCORES_STORAGE_KEY) || '{}'));
      } catch {
        setAnswersByPresentation({});
        setScoresByPresentation({});
      }
    };
    window.addEventListener('sefer-audience-logout', handleLogout);
    window.addEventListener('sefer-protected-quiz-restored', handleProtectedRestore);
    return () => {
      window.removeEventListener('sefer-audience-logout', handleLogout);
      window.removeEventListener('sefer-protected-quiz-restored', handleProtectedRestore);
    };
  }, []);

  // Listen for CLEAR commands from controller and LOGOUT events from PWA identity
  useEffect(() => {
    const processClear = (slideId: string) => {
      if (!scopeId) return;
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

    const credential = getAudienceCredential();
    const ticket = sessionStorage.getItem(QUIZ_SSE_TICKET_KEY);
    if (credential && !ticket) {
      channel.removeEventListener('message', handleChannelMessage);
      return;
    }
    const eventSource = new EventSource(
      ticket ? `/api/quiz-events?ticket=${encodeURIComponent(ticket)}` : '/api/quiz-events',
    );
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
  }, [channel, scopeId, ticketRevision]);

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
    const msg: QuizAnswerMessage = {
      type: 'QUIZ_ANSWER',
      presentationId,
      sessionId: getAudienceParticipantId() ?? sessionId,
      displayName: displayName?.trim().slice(0, 80) || undefined,
      slideId,
      answer,
    };
    channel.postMessage(msg);

    // Also send via SSE endpoint for cross-device sync
    const { displayName: _displayName, ...serverMessage } = msg;
    void _displayName;
    fetch('/api/quiz-answer', {
      method: 'POST',
      headers: getAudienceHeaders(),
      body: JSON.stringify(serverMessage),
    }).catch(() => {}); // Non-critical — local state is source of truth
  }, [channel, displayName, presentationId, sessionId]);

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
    updateAnswer(slideId, prev => {
      const updated = { ...prev, bonusReadingClaimed: claimed };
      if (prev.submitted) {
        // Rebroadcast with updated bonus claim
        broadcast(slideId, updated);
      }
      return updated;
    });
  }, [updateAnswer, broadcast]);

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

  const sendFinalScore = useCallback((totalCentipunts: number) => {
    if (!presentationId) return;
    const msg: QuizFinalScoreMessage = {
      type: 'QUIZ_FINAL_SCORE',
      presentationId,
      sessionId: getAudienceParticipantId() ?? sessionId,
      totalCentipunts,
    };
    channel.postMessage(msg);

    // Also send via SSE endpoint for cross-device sync
    fetch('/api/quiz-answer', {
      method: 'POST',
      headers: getAudienceHeaders(),
      body: JSON.stringify(msg),
    }).catch(() => {});
  }, [channel, presentationId, sessionId]);

  const getScores = useCallback(() => scores, [scores]);

  const saveScore = useCallback((slideId: string, score: QuizQuestionScore) => {
    if (!scopeId) return;
    setScoresByPresentation(prev => ({
      ...prev,
      [scopeId]: { ...(prev[scopeId] ?? {}), [slideId]: score },
    }));
  }, [scopeId]);

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
import { calcResultRanges } from '../utils/quizUtils';

export interface UseControllerAnswersReturn {
  /** All received sessions keyed by sessionId */
  sessions: Record<string, QuizAudienceSession>;
  /** Answer for a specific session and slide */
  getSessionAnswer: (sessionId: string, slideId: string) => QuizAudienceAnswer | undefined;
  /** Count of submitted answers for a given slide */
  getSubmittedCount: (slideId: string) => number;
  /** Clear all received answers (between quiz rounds) */
  clearAll: () => void;
  /**
   * Calculate range stats for results slide using reported scores.
   */
  calcRangeStats: (
    profiles: QuizResultProfile[],
    maxBaseCentipunts: number,
    sessionScoreOverrides?: Record<string, number>,
  ) => QuizRangeStats[];
  /** Clear answers for a specific slide across all audiences */
  clearSlideAnswers: (slideId: string) => void;
}

export function useControllerAnswers(presentationId: string | null): UseControllerAnswersReturn {
  const channel = useMemo(() => new BroadcastChannel('sefer-quiz'), []);
  const [sessions, setSessions] = useState<Record<string, QuizAudienceSession>>({});
  const [sessionTotalScores, setSessionTotalScores] = useState<Record<string, number>>({});

  // Listen for incoming answers from audience
  useEffect(() => {
    let cancelled = false;
    const handleMessage = (event: MessageEvent) => {
      if (cancelled) return;
      const data = event.data as QuizMessage;
      if (!data) return;
      if (!presentationId || data.presentationId !== presentationId) return;

      if (data.type === 'QUIZ_ANSWER') {
        const { sessionId, slideId, answer } = data;
        if (!sessionId || !slideId || !answer) return;

        setSessions(prev => {
          const existing = prev[sessionId] ?? { sessionId, presentationId, answers: {} };
          return {
            ...prev,
            [sessionId]: {
              ...existing,
              answers: { ...existing.answers, [slideId]: answer },
            },
          };
        });
      } else if (data.type === 'QUIZ_FINAL_SCORE') {
        const { sessionId, totalCentipunts } = data;
        if (!sessionId || totalCentipunts == null) return;
        setSessionTotalScores(prev => ({ ...prev, [sessionId]: totalCentipunts }));
      } else if (data.type === 'QUIZ_SESSION_SNAPSHOT') {
        setSessions(prev => {
          const merged = { ...data.sessions };
          for (const [sessionId, liveSession] of Object.entries(prev)) {
            const storedSession = merged[sessionId];
            if (!storedSession) {
              merged[sessionId] = liveSession;
              continue;
            }
            const answers = { ...storedSession.answers };
            for (const [slideId, liveAnswer] of Object.entries(liveSession.answers)) {
              const storedAnswer = answers[slideId];
              if (!storedAnswer || (liveAnswer.submittedAt ?? 0) >= (storedAnswer.submittedAt ?? 0)) {
                answers[slideId] = liveAnswer;
              }
            }
            merged[sessionId] = { ...storedSession, ...liveSession, answers };
          }
          return merged;
        });
        setSessionTotalScores(prev => ({ ...data.sessionTotalScores, ...prev }));
      }
    };

    channel.addEventListener('message', handleMessage);

    // Also listen via SSE for cross-device answers
    const eventSource = new EventSource('/api/quiz-events');
    eventSource.onmessage = (event) => {
      try {
        if (event.data === 'heartbeat') return;
        const data = JSON.parse(event.data);
        if (data?.type === 'QUIZ_ANSWER' || data?.type === 'QUIZ_FINAL_SCORE') {
          handleMessage({ data } as MessageEvent);
        }
      } catch {
        // Ignore parse errors
      }
    };

    if (presentationId) {
      fetch('/api/quiz-control-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presentationId }),
      })
        .then((response) => response.json())
        .then((snapshot) => {
          if (snapshot?.type === 'QUIZ_SESSION_SNAPSHOT') {
            handleMessage({ data: snapshot } as MessageEvent);
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      channel.removeEventListener('message', handleMessage);
      eventSource.close();
    };
  }, [channel, presentationId]);

  useEffect(() => {
    setSessions({});
    setSessionTotalScores({});
  }, [presentationId]);

  const getSessionAnswer = useCallback((sid: string, slideId: string) => {
    return sessions[sid]?.answers[slideId];
  }, [sessions]);

  const getSubmittedCount = useCallback((slideId: string) => {
    return Object.values(sessions).filter(s => s.answers[slideId]?.submitted).length;
  }, [sessions]);

  const clearAll = useCallback(() => {
    setSessions({});
    setSessionTotalScores({});
  }, []);

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

    // Also clear locally in sessions
    setSessions(prev => {
      const next = { ...prev };
      for (const sid of Object.keys(next)) {
        if (next[sid].answers[slideId]) {
          const updatedAnswers = { ...next[sid].answers };
          delete updatedAnswers[slideId];
          next[sid] = { ...next[sid], answers: updatedAnswers };
        }
      }
      return next;
    });
  }, [channel, presentationId]);

  const calcRangeStats = useCallback((
    profiles: QuizResultProfile[],
    maxBaseCentipunts: number,
    sessionScoreOverrides?: Record<string, number>,
  ): QuizRangeStats[] => {
    const stats: Record<number, QuizRangeStats> = {};
    for (const profile of profiles) {
      stats[profile.rank] = { rank: profile.rank, title: profile.title, count: 0, sessionIds: [] };
    }

    if (profiles.length === 0) return [];
    
    // Sort profiles to calculate ranges manually
    const ranges = calcResultRanges(profiles, maxBaseCentipunts);
    
    // Evaluate ranks based on total score
    const scoresToClassify = sessionScoreOverrides ?? sessionTotalScores;
    for (const [sid, totalPts] of Object.entries(scoresToClassify)) {
      const match = ranges.find(r => totalPts >= r.minCentipunts && totalPts <= r.maxCentipunts);
      if (match && stats[match.rank]) {
        stats[match.rank].count++;
        stats[match.rank].sessionIds.push(sid);
      }
    }

    return Object.values(stats).sort((a, b) => a.rank - b.rank);
  }, [sessionTotalScores]);

  return { sessions, getSessionAnswer, getSubmittedCount, clearAll, calcRangeStats, clearSlideAnswers };
}

// Re-export helpers for use alongside the hooks
export { makeEmptyAudienceAnswer };
