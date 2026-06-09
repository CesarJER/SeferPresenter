/**
 * QuizResultsView — Results slide display.
 *
 * Controller: table with per-range stats (count of people in each range).
 * Audience: personal diploma with their profile.
 *
 * Props are designed to work with useControllerAnswers + useAudienceAnswers.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Trophy, Star, Users } from 'lucide-react';
import type { QuizResultProfile } from '../../types/presentation';
import type { QuizRangeStats, QuizTotalScore } from '../../types/quiz';
import { formatCentipunts, calcResultRanges } from '../../utils/quizUtils';

// ── Controller results ────────────────────────────────────────────────────────

interface QuizResultsControllerProps {
  profiles: QuizResultProfile[];
  rangeStats: QuizRangeStats[];
  totalSessions: number;
  maxBaseCentipunts: number;
}

export const QuizResultsController: React.FC<QuizResultsControllerProps> = ({
  profiles,
  rangeStats,
  totalSessions,
  maxBaseCentipunts,
}) => {
  const sorted = [...profiles].sort((a, b) => a.rank - b.rank);
  const ranges = calcResultRanges(sorted, maxBaseCentipunts);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs font-bold text-gray-400 mb-1">
        <Users size={12} />
        <span>{totalSessions} participantes</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-800 text-[9px] uppercase tracking-wider text-gray-500">
              <th className="px-2 py-1.5 text-center w-12">Rango</th>
              <th className="px-2 py-1.5 text-center w-14">Pts</th>
              <th className="px-2 py-1.5 w-full">Perfil</th>
              <th className="px-2 py-1.5 text-right w-12">Nº</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {sorted.map(profile => {
              const stats = rangeStats.find(r => r.rank === profile.rank);
              const count = stats?.count ?? 0;
              const range = ranges.find(r => r.rank === profile.rank);
              
              let ptsText = '-';
              if (range) {
                const maxPts = range.maxCentipunts === Infinity ? Infinity : range.maxCentipunts / 100;
                const minPts = range.minCentipunts / 100;
                
                const fmt = (n: number) => Number.isInteger(n) ? n.toString() : n.toFixed(1);

                if (maxPts === Infinity) {
                  ptsText = `>${fmt(minPts)}`;
                } else if (minPts === 0) {
                  ptsText = `0 - ${fmt(maxPts)}`;
                } else if (minPts === maxPts) {
                  ptsText = `${fmt(minPts)}`;
                } else {
                  ptsText = `>${fmt(minPts)} - ${fmt(maxPts)}`;
                }
              }

              return (
                <tr key={profile.rank} className="group hover:bg-gray-800/30 transition-colors">
                  <td className="px-2 py-2 text-center align-top">
                    <span className="text-[10px] font-black text-violet-400">R{profile.rank}</span>
                  </td>
                  <td className="px-2 py-2 text-center align-top text-[10px] font-bold text-gray-400">
                    {ptsText}
                  </td>
                  <td className="px-2 py-2 align-top">
                    <p className="text-xs font-bold text-white leading-tight">{profile.title}</p>
                    <p className="text-[10px] text-gray-500 leading-snug mt-0.5 max-w-[200px]">{profile.description}</p>
                  </td>
                  <td className="px-2 py-2 text-right align-top">
                    <span className="text-sm font-black text-white">{count}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Audience diploma ──────────────────────────────────────────────────────────

interface QuizResultsDiplomaProps {
  profile: QuizResultProfile | null;
  totalScore: QuizTotalScore | null;
  isLoading?: boolean;
}

export const QuizResultsDiploma: React.FC<QuizResultsDiplomaProps> = ({
  profile,
  totalScore,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-white/40 text-sm animate-pulse">Calculando resultado...</p>
      </div>
    );
  }

  if (!profile && !totalScore) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <Star size={32} className="text-yellow-400/40" />
        <p className="text-white/50 text-sm">No hay resultado disponible todavía.</p>
        <p className="text-white/30 text-xs">Responde las preguntas del quiz para ver tu resultado.</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex flex-col items-center gap-4 p-4 text-center"
    >
      {/* Trophy */}
      <motion.div
        initial={{ scale: 0, rotate: -15 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 300 }}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 shadow-xl shadow-yellow-500/30"
      >
        <Trophy size={32} className="text-black" />
      </motion.div>

      {/* Rank badge */}
      {profile && (
        <div className="rounded-full border border-violet-500/50 bg-violet-950/50 px-4 py-1">
          <span className="text-xs font-black text-violet-300 uppercase tracking-widest">
            Perfil R{profile.rank}
          </span>
        </div>
      )}

      {/* Title */}
      {profile && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-2"
        >
          <h2 className="text-xl font-black text-white">{profile.title}</h2>
          <p className="text-sm text-white/60 leading-relaxed">{profile.description}</p>
        </motion.div>
      )}

      {/* Gift text */}
      {profile?.giftText && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="rounded-xl border border-yellow-500/30 bg-yellow-950/30 px-4 py-3 max-w-xs"
        >
          <p className="text-xs font-bold text-yellow-400 uppercase tracking-wider mb-1">📖 Versículo</p>
          <p className="text-sm text-yellow-200 leading-relaxed italic">{profile.giftText}</p>
        </motion.div>
      )}

      {/* Score */}
      {totalScore && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center"
        >
          <p className="text-xs text-white/30 uppercase tracking-wider">Puntuación</p>
          <p className="text-2xl font-black text-white">
            {formatCentipunts(totalScore.totalCentipunts)}
            <span className="text-sm font-normal text-white/40 ml-1">pts</span>
          </p>
        </motion.div>
      )}
    </motion.div>
  );
};
