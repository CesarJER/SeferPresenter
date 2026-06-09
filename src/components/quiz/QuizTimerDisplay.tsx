/**
 * QuizTimerDisplay — Visual timer for presenter/audience views.
 *
 * Renders a circular progress ring + countdown text.
 * Uses requestAnimationFrame internally to update without React re-renders.
 */

import React, { useEffect, useRef } from 'react';
import type { QuizTimerState } from '../../types/quiz';
import { calcRemainingFraction, calcRemainingMs, formatRemainingTime } from '../../utils/quizUtils';

interface QuizTimerDisplayProps {
  timerState: QuizTimerState;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export const QuizTimerDisplay: React.FC<QuizTimerDisplayProps> = ({
  timerState,
  size = 80,
  strokeWidth = 6,
  className = '',
}) => {
  const textRef = useRef<SVGTextElement>(null);
  const circleRef = useRef<SVGCircleElement>(null);
  const rafRef = useRef<number>(0);
  const timerStateRef = useRef(timerState);
  timerStateRef.current = timerState;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    const update = () => {
      const state = timerStateRef.current;
      const remaining = calcRemainingMs(state);
      const fraction = calcRemainingFraction(state);

      if (textRef.current) {
        textRef.current.textContent = state.status === 'idle' ? formatRemainingTime(state.timerDurationMs) : formatRemainingTime(remaining);
      }
      if (circleRef.current) {
        const offset = circumference * (1 - fraction);
        circleRef.current.style.strokeDashoffset = String(offset);
      }

      rafRef.current = requestAnimationFrame(update);
    };

    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [circumference]);

  const isExpired = timerState.status === 'expired' || timerState.status === 'completed';
  const isIdle = timerState.status === 'idle';

  const trackColor = isExpired ? '#dc2626' : '#ffffff15';
  const progressColor = isExpired ? '#dc2626' : isIdle ? '#ffffff40' : '#f3c96a';
  const textColor = isExpired ? '#f87171' : '#ffffff';

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`block ${className}`}
      style={{ transform: 'rotate(-90deg)' }}
    >
      {/* Background track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={trackColor}
        strokeWidth={strokeWidth}
      />
      {/* Progress ring */}
      <circle
        ref={circleRef}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={progressColor}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={0}
        strokeLinecap="round"
        style={{ transition: 'stroke 0.3s ease' }}
      />
      {/* Text (counter-rotated) */}
      <text
        ref={textRef}
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={textColor}
        fontSize={size * 0.28}
        fontWeight="bold"
        fontFamily="inherit"
        style={{ transform: `rotate(90deg)`, transformOrigin: `${size / 2}px ${size / 2}px` }}
      />
    </svg>
  );
};
