/**
 * useQuizAudio — Quiz-specific sound effects.
 *
 * Uses a dedicated <audio> element (separate from the main presentation audio)
 * to play quiz sounds without interrupting music playback.
 *
 * Sounds:
 * - Pregunta.mp3 — plays in loop while timer is running
 * - aplausos.mp3 — plays on correct demo selection
 * - Mal.ogg      — plays on incorrect demo selection
 * - bip.mp3      — plays on timer-start / tick feedback
 */

import { useCallback, useEffect, useRef } from 'react';
import type { QuizTimerStatus } from '../types/quiz';

const SOUNDS = {
  pregunta: '/audio/sounds/Pregunta.mp3',
  aplausos: '/audio/sounds/aplausos.mp3',
  mal: '/audio/sounds/Mal.ogg',
  bip: '/audio/sounds/bip.mp3',
} as const;

export interface UseQuizAudioReturn {
  /** Play applause sound (correct answer demo) */
  playApplause: () => void;
  /** Play wrong-answer sound */
  playMal: () => void;
  /** Play single bip (timer start, transition) */
  playBip: () => void;
  /** Stop all quiz audio */
  stopAll: () => void;
}

export function useQuizAudio(options: {
  /** Only play sounds on presenter/controller side */
  isPresenterOrControl: boolean;
  timerStatus: QuizTimerStatus;
  isQuestionSubslide?: boolean;
}): UseQuizAudioReturn {
  const { isPresenterOrControl, timerStatus, isQuestionSubslide = true } = options;

  const bgAudioRef = useRef<HTMLAudioElement | null>(null);
  const fxAudioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize audio elements once
  useEffect(() => {
    if (!isPresenterOrControl) return;

    const bg = new Audio();
    bg.loop = true;
    bg.volume = 0.55;
    bgAudioRef.current = bg;

    const fx = new Audio();
    fx.volume = 0.75;
    fxAudioRef.current = fx;

    return () => {
      bg.pause();
      bg.src = '';
      fx.pause();
      fx.src = '';
      bgAudioRef.current = null;
      fxAudioRef.current = null;
    };
  }, [isPresenterOrControl]);

  // ── Timer-driven background music ──────────────────────────────────
  useEffect(() => {
    if (!isPresenterOrControl) return;
    const bg = bgAudioRef.current;
    if (!bg) return;

    if (timerStatus === 'running' && isQuestionSubslide) {
      if (bg.src !== window.location.origin + SOUNDS.pregunta) {
        bg.src = SOUNDS.pregunta;
        bg.load();
      }
      bg.play().catch(err => {
        // Autoplay may be blocked on first interaction — silently ignore.
        // The main app's audio unlock banner handles this globally.
        if (err.name !== 'NotAllowedError') {
          console.warn('[QuizAudio] Pregunta.mp3 play error:', err);
        }
      });
    } else {
      // Fade-like stop: pause and reset
      if (!bg.paused) {
        bg.pause();
        bg.currentTime = 0;
      }
    }
  }, [timerStatus, isQuestionSubslide, isPresenterOrControl]);

  // ── FX helpers ────────────────────────────────────────────────────
  const playFx = useCallback((src: string) => {
    if (!isPresenterOrControl) return;
    const fx = fxAudioRef.current;
    if (!fx) return;

    fx.pause();
    fx.src = src;
    fx.currentTime = 0;
    fx.play().catch(err => {
      if (err.name !== 'NotAllowedError') {
        console.warn('[QuizAudio] FX play error:', err);
      }
    });
  }, [isPresenterOrControl]);

  const playApplause = useCallback(() => playFx(SOUNDS.aplausos), [playFx]);
  const playMal = useCallback(() => playFx(SOUNDS.mal), [playFx]);
  const playBip = useCallback(() => playFx(SOUNDS.bip), [playFx]);

  const stopAll = useCallback(() => {
    if (!isPresenterOrControl) return;
    [bgAudioRef.current, fxAudioRef.current].forEach(a => {
      if (a && !a.paused) {
        a.pause();
        a.currentTime = 0;
      }
    });
  }, [isPresenterOrControl]);

  return { playApplause, playMal, playBip, stopAll };
}
