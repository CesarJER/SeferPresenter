/**
 * useQuizAnswers — Audience answer collection with controller sync.
 *
 * This hook manages:
 * 1. The audience member's own answers (local state)
 * 2. Broadcasting answers to the controller via BroadcastChannel + SSE
 * 3. On the controller side: receiving and aggregating all answers
 *
 * Architecture:
 * - Audience side: stores answers in sessionStorage (persist across page refresh).
 *   On answer submit, broadcasts via a dedicated 'sefer-quiz' channel.
 * - Controller side: listens on 'sefer-quiz' channel and accumulates session answers.
 *
 * Session ID: Generated once per audience tab, stored in sessionStorage.
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

// ── Session ID ────────────────────────────────────────────────────────────────

function getOrCreateSessionId(): string {
  const key = 'sefer-quiz-session-id';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `qs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

// ── Message types ─────────────────────────────────────────────────────────────

interface QuizAnswerMessage {
  type: 'QUIZ_ANSWER';
  sessionId: string;
  displayName?: string;
  slideId: string;
  answer: QuizAudienceAnswer;
}

interface QuizClearMessage {
  type: 'QUIZ_CLEAR_ANSWERS';
  slideId: string;
}

interface QuizFinalScoreMessage {
  type: 'QUIZ_FINAL_SCORE';
  sessionId: string;
  totalCentipunts: number;
}

type QuizMessage = QuizAnswerMessage | QuizClearMessage | QuizFinalScoreMessage;

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

export function useAudienceAnswers(): UseAudienceAnswersReturn {
  const sessionId = useMemo(() => getOrCreateSessionId(), []);
  const channel = useMemo(() => new BroadcastChannel('sefer-quiz'), []);

  const [answers, setAnswers] = useState<Record<string, QuizAudienceAnswer>>(() => {
    // Restore from sessionStorage on mount
    try {
      const stored = sessionStorage.getItem('sefer-quiz-answers');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const [scores, setScores] = useState<Record<string, QuizQuestionScore>>(() => {
    try {
      const stored = sessionStorage.getItem('sefer-quiz-scores');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Persist to sessionStorage whenever answers change
  useEffect(() => {
    try {
      sessionStorage.setItem('sefer-quiz-answers', JSON.stringify(answers));
    } catch {
      // Storage quota exceeded — silently ignore
    }
  }, [answers]);

  // Persist to sessionStorage whenever scores change
  useEffect(() => {
    try {
      sessionStorage.setItem('sefer-quiz-scores', JSON.stringify(scores));
    } catch {
      // Ignore
    }
  }, [scores]);

  // Listen for CLEAR commands from controller
  useEffect(() => {
    const processClear = (slideId: string) => {
      setAnswers(prev => {
        const current = prev[slideId];
        if (!current) return prev;
        
        return {
          ...prev,
          [slideId]: {
            ...current,
            submitted: false,
            submittedAt: null
          }
        };
      });
      setScores(prev => {
        if (!prev[slideId]) return prev;
        const next = { ...prev };
        delete next[slideId];
        return next;
      });
    };

    const handleChannelMessage = (event: MessageEvent) => {
      const data = event.data as QuizMessage;
      if (data?.type === 'QUIZ_CLEAR_ANSWERS') {
        processClear(data.slideId);
      }
    };

    channel.addEventListener('message', handleChannelMessage);

    const eventSource = new EventSource('/api/quiz-events');
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type === 'QUIZ_CLEAR_ANSWERS') {
          processClear(data.slideId);
        }
      } catch {}
    };

    return () => {
      channel.removeEventListener('message', handleChannelMessage);
      eventSource.close();
    };
  }, [channel]);

  const getAnswers = useCallback(() => answers, [answers]);

  const getAnswer = useCallback((slideId: string): QuizAudienceAnswer => {
    return answers[slideId] ?? makeEmptyAudienceAnswer(slideId);
  }, [answers]);

  const updateAnswer = useCallback((slideId: string, updater: (prev: QuizAudienceAnswer) => QuizAudienceAnswer) => {
    setAnswers(prev => {
      const current = prev[slideId] ?? makeEmptyAudienceAnswer(slideId);
      const updated = updater(current);
      return { ...prev, [slideId]: updated };
    });
  }, []);

  const broadcast = useCallback((slideId: string, answer: QuizAudienceAnswer) => {
    const msg: QuizAnswerMessage = {
      type: 'QUIZ_ANSWER',
      sessionId,
      slideId,
      answer,
    };
    channel.postMessage(msg);

    // Also send via SSE endpoint for cross-device sync
    fetch('/api/quiz-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }).catch(() => {}); // Non-critical — local state is source of truth
  }, [channel, sessionId]);

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
    setAnswers(prev => {
      const current = prev[slideId] ?? makeEmptyAudienceAnswer(slideId);
      if (current.submitted) return prev; // idempotent
      const submitted = { ...current, submitted: true, submittedAt: Date.now() };
      broadcast(slideId, submitted);
      return { ...prev, [slideId]: submitted };
    });
  }, [broadcast]);

  const submitAll = useCallback((slideId: string) => {
    setAnswers(prev => {
      const current = prev[slideId] ?? makeEmptyAudienceAnswer(slideId);
      if (current.submitted) return prev;
      const submitted = { ...current, submitted: true, submittedAt: Date.now() };
      broadcast(slideId, submitted);
      return { ...prev, [slideId]: submitted };
    });
  }, [broadcast]);

  const clearAnswer = useCallback((slideId: string) => {
    setAnswers(prev => {
      const next = { ...prev };
      delete next[slideId];
      return next;
    });
    setScores(prev => {
      const next = { ...prev };
      delete next[slideId];
      return next;
    });
  }, []);

  const sendFinalScore = useCallback((totalCentipunts: number) => {
    const msg: QuizFinalScoreMessage = {
      type: 'QUIZ_FINAL_SCORE',
      sessionId,
      totalCentipunts,
    };
    channel.postMessage(msg);
  }, [channel, sessionId]);

  const getScores = useCallback(() => scores, [scores]);

  const saveScore = useCallback((slideId: string, score: QuizQuestionScore) => {
    setScores(prev => ({ ...prev, [slideId]: score }));
  }, []);

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
  calcRangeStats: (profiles: QuizResultProfile[], maxBaseCentipunts: number) => QuizRangeStats[];
  /** Clear answers for a specific slide across all audiences */
  clearSlideAnswers: (slideId: string) => void;
}

export function useControllerAnswers(): UseControllerAnswersReturn {
  const channel = useMemo(() => new BroadcastChannel('sefer-quiz'), []);
  const [sessions, setSessions] = useState<Record<string, QuizAudienceSession>>({});
  const [sessionTotalScores, setSessionTotalScores] = useState<Record<string, number>>({});

  // Listen for incoming answers from audience
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as QuizMessage;
      if (!data) return;

      if (data.type === 'QUIZ_ANSWER') {
        const { sessionId, slideId, answer } = data;
        if (!sessionId || !slideId || !answer) return;

        setSessions(prev => {
          const existing = prev[sessionId] ?? { sessionId, answers: {} };
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
      }
    };

    channel.addEventListener('message', handleMessage);

    // Also listen via SSE for cross-device answers
    const eventSource = new EventSource('/api/quiz-events');
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type === 'QUIZ_ANSWER' || data?.type === 'QUIZ_FINAL_SCORE') {
          handleMessage({ data } as MessageEvent);
        }
      } catch {
        // Ignore parse errors
      }
    };

    return () => {
      channel.removeEventListener('message', handleMessage);
      eventSource.close();
    };
  }, [channel]);

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
    // Send clear message locally via BroadcastChannel
    const msg: QuizClearMessage = { type: 'QUIZ_CLEAR_ANSWERS', slideId };
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
  }, [channel]);

  const calcRangeStats = useCallback((
    profiles: QuizResultProfile[],
    maxBaseCentipunts: number
  ): QuizRangeStats[] => {
    const stats: Record<number, QuizRangeStats> = {};
    for (const profile of profiles) {
      stats[profile.rank] = { rank: profile.rank, title: profile.title, count: 0, sessionIds: [] };
    }

    if (profiles.length === 0) return [];
    
    // Sort profiles to calculate ranges manually
    const sorted = [...profiles].sort((a, b) => a.rank - b.rank);
    const count = sorted.length;
    const rangeSize = Math.floor(maxBaseCentipunts / count);
    
    // Evaluate ranks based on total score
    for (const [sid, totalPts] of Object.entries(sessionTotalScores)) {
      // Find the appropriate rank
      let assignedRank = sorted[0].rank; // default
      for (let i = 0; i < sorted.length; i++) {
        const rank = sorted[i].rank;
        const reverseIdx = count - 1 - i;
        const min = reverseIdx === 0 ? 0 : reverseIdx * rangeSize;
        const max = reverseIdx === count - 1 ? Infinity : (reverseIdx + 1) * rangeSize - 1;
        
        if (totalPts >= min && totalPts <= max) {
          assignedRank = rank;
          break;
        }
      }

      if (stats[assignedRank]) {
        stats[assignedRank].count++;
        stats[assignedRank].sessionIds.push(sid);
      }
    }

    return Object.values(stats).sort((a, b) => a.rank - b.rank);
  }, [sessionTotalScores]);

  return { sessions, getSessionAnswer, getSubmittedCount, clearAll, calcRangeStats, clearSlideAnswers };
}

// Re-export helpers for use alongside the hooks
export { makeEmptyAudienceAnswer };
