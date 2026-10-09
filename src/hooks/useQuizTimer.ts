/**
 * useQuizTimer — Encapsulated quiz countdown timer.
 *
 * Design principles:
 * - remainingMs is derived via rAF, never stored as React state (avoids
 *   per-frame re-renders of the full component tree).
 * - The timer state (status, startedAt, duration, pausedRemaining) IS stored
 *   in React state because it controls the UI phase transitions.
 * - Callers read the derived remaining time through `getRemainingMs`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuizTimerState, QuizTimerStatus } from '../types/quiz';
import { calcRemainingMs } from '../utils/quizUtils';

export interface UseQuizTimerReturn {
  timerState: QuizTimerState;
  /** Call during render to get current remaining ms (RAF-based, no extra re-render) */
  getRemainingMs: () => number;
  startTimer: () => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  resetTimer: (newDurationMs?: number) => void;
  setTimerState: (state: QuizTimerState) => void;
  /** Manually mark as completed (e.g. controller clicked "Mostrar Respuesta") */
  completeTimer: () => void;
  adjustTimer: (seconds: number) => void;
}

export function useQuizTimer(options: {
  timerSeconds: number;
  onExpire?: () => void;
  onTick?: (remainingMs: number) => void;
}): UseQuizTimerReturn {
  const { timerSeconds, onExpire, onTick } = options;

  const [timerState, setTimerState] = useState<QuizTimerState>({
    status: 'idle',
    timerStartedAt: null,
    timerDurationMs: timerSeconds * 1000,
    pausedRemainingMs: null,
  });

  // Stable refs to avoid stale closures in rAF loop
  const timerStateRef = useRef(timerState);
  timerStateRef.current = timerState;
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const expiredFiredRef = useRef(false);

  // ── RAF loop for expiry detection ────────────────────────────────
  useEffect(() => {
    let rafId: number;

    const tick = () => {
      const state = timerStateRef.current;
      if (state.status !== 'running') return;

      const remaining = calcRemainingMs(state);
      onTickRef.current?.(remaining);

      if (remaining <= 0 && !expiredFiredRef.current) {
        expiredFiredRef.current = true;
        setTimerState(prev => ({ ...prev, status: 'expired' as QuizTimerStatus }));
        onExpireRef.current?.();
        return; // stop loop
      }

      rafId = requestAnimationFrame(tick);
    };

    if (timerState.status === 'running') {
      expiredFiredRef.current = false;
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [timerState.status]);

  // ── Actions ───────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    expiredFiredRef.current = false;
    setTimerState(prev => ({
      ...prev,
      status: 'running',
      timerStartedAt: Date.now(),
      timerDurationMs: prev.timerDurationMs,
      pausedRemainingMs: null,
    }));
  }, []);

  const pauseTimer = useCallback(() => {
    setTimerState(prev => {
      if (prev.status !== 'running') return prev;
      const remaining = calcRemainingMs(prev);
      return {
        ...prev,
        status: 'paused',
        pausedRemainingMs: remaining,
        timerStartedAt: null,
      };
    });
  }, []);

  const resumeTimer = useCallback(() => {
    setTimerState(prev => {
      if (prev.status !== 'paused') return prev;
      const remaining = prev.pausedRemainingMs ?? prev.timerDurationMs;
      return {
        ...prev,
        status: 'running',
        timerStartedAt: Date.now(),
        timerDurationMs: remaining,
        pausedRemainingMs: null,
      };
    });
  }, []);

  const resetTimer = useCallback((newDurationMs?: number) => {
    expiredFiredRef.current = false;
    setTimerState(prev => ({
      status: 'idle',
      timerStartedAt: null,
      timerDurationMs: newDurationMs ?? prev.timerDurationMs,
      pausedRemainingMs: null,
    }));
  }, []);

  const completeTimer = useCallback(() => {
    setTimerState(prev => ({ ...prev, status: 'completed' }));
  }, []);

  const adjustTimer = useCallback((seconds: number) => {
    const ms = seconds * 1000;
    setTimerState(prev => {
      if (prev.status === 'paused') {
        return { ...prev, pausedRemainingMs: ms };
      } else if (prev.status === 'idle') {
        return { ...prev, timerDurationMs: ms };
      }
      return prev;
    });
  }, []);

  const getRemainingMs = useCallback(() => {
    return calcRemainingMs(timerStateRef.current);
  }, []);

  // Update duration when timerSeconds prop changes (and timer is idle)
  useEffect(() => {
    setTimerState(prev => {
      if (prev.status !== 'idle') return prev;
      return { ...prev, timerDurationMs: timerSeconds * 1000 };
    });
  }, [timerSeconds]);

  return { timerState, getRemainingMs, startTimer, pauseTimer, resumeTimer, resetTimer, setTimerState, completeTimer, adjustTimer };
}
