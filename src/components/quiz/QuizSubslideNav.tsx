/**
 * QuizSubslideNav — Contextual subnav for quiz subslides.
 *
 * Controller: sees all subslides including cita verses.
 * Presenter/Audience: sees all subslides (display only, no interaction).
 */

import React from 'react';
import type { QuizSubslide } from '../../types/quiz';
import { BookOpen, HelpCircle, CheckSquare, BookMarked, Trophy } from 'lucide-react';

interface QuizSubslideNavProps {
  subslides: QuizSubslide[];
  currentIndex: number;
  onSelect?: (index: number) => void;
  isInteractive?: boolean;
}

const SUBSLIDE_ICONS: Record<string, React.ReactNode> = {
  lectura: <BookOpen size={11} />,
  pregunta: <HelpCircle size={11} />,
  'cita-verse': <BookMarked size={11} />,
  respuesta: <CheckSquare size={11} />,
  results: <Trophy size={11} />,
};

export const QuizSubslideNav: React.FC<QuizSubslideNavProps> = ({
  subslides,
  currentIndex,
  onSelect,
  isInteractive = true,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg bg-black/30 px-2 py-1.5 backdrop-blur-sm">
      {subslides.map((sub, idx) => {
        const isActive = idx === currentIndex;
        const isPast = idx < currentIndex;

        return (
          <button
            key={`${sub.kind}-${sub.verse ?? idx}`}
            type="button"
            disabled={!isInteractive}
            onClick={() => isInteractive && onSelect?.(idx)}
            className={[
              'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition-all duration-150',
              isActive
                ? 'bg-yellow-500 text-black shadow-md shadow-yellow-500/30'
                : isPast
                  ? 'bg-white/10 text-white/60 hover:bg-white/15 hover:text-white/80'
                  : isInteractive
                    ? 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60 cursor-pointer'
                    : 'bg-white/5 text-white/40 cursor-default',
            ].join(' ')}
            title={sub.label}
          >
            {SUBSLIDE_ICONS[sub.kind]}
            <span>{sub.label}</span>
          </button>
        );
      })}
    </div>
  );
};
