/**
 * QuizControllerView — Controller panel overlay for quiz slides.
 *
 * Appears inside MenuPopup's quiz panel. Provides:
 * - Subslide navigation
 * - Timer controls (Start / Pause / Resume / Reset)
 * - Correct answer always visible
 * - Demo/correction selector (after timer expires)
 * - Audience answer collection stats
 * - Sound controls
 */

import React from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, CheckCircle, XCircle, Users, Eraser } from 'lucide-react';
import type { QuizData, QuizOptionId } from '../../types/presentation';
import type { QuizSubslide, QuizTimerState } from '../../types/quiz';
import { formatRemainingTime, calcRemainingMs, getDisplayOptions } from '../../utils/quizUtils';
import { QuizSubslideNav } from './QuizSubslideNav';
import { QuizTimerDisplay } from './QuizTimerDisplay';
import { QuizResultsController } from './QuizResultsView';
import type { QuizRangeStats } from '../../types/quiz';

interface QuizControllerViewProps {
  slide: { id: string };
  quizData: QuizData;
  subslides: QuizSubslide[];
  currentSubslideIndex: number;
  onSubslideSelect: (idx: number) => void;
  timerState: QuizTimerState;
  onStartTimer: () => void;
  onPauseTimer: () => void;
  onResumeTimer: () => void;
  onResetTimer: () => void;
  onComplete: () => void;
  presenterDemoSelection: QuizOptionId | null;
  onDemoSelect: (optionId: QuizOptionId | null) => void;
  submittedCount: number;
  onPlayApplause: () => void;
  onPlayMal: () => void;
  audioMuted?: boolean;
  onToggleMute?: () => void;
  optionCounts: Record<QuizOptionId, number>;
  onClearAnswers: () => void;
  rangeStats: QuizRangeStats[];
  totalSessions: number;
  maxBaseCentipunts: number;
  renderMode?: 'top' | 'bottom' | 'both';
  onAdjustTimer?: (seconds: number) => void;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export const QuizControllerView: React.FC<QuizControllerViewProps> = ({
  slide,
  quizData,
  subslides,
  currentSubslideIndex,
  onSubslideSelect,
  timerState,
  onStartTimer,
  onPauseTimer,
  onResumeTimer,
  onResetTimer,
  onComplete,
  presenterDemoSelection,
  onDemoSelect,
  submittedCount,
  onPlayApplause,
  onPlayMal,
  audioMuted = false,
  onToggleMute,
  optionCounts,
  onClearAnswers,
  rangeStats,
  totalSessions,
  maxBaseCentipunts,
  renderMode = 'both',
  onAdjustTimer,
}) => {
  const displayOptions = getDisplayOptions(quizData, slide.id);
  const remaining = calcRemainingMs(timerState);
  const status = timerState.status;
  const isExpired = status === 'expired' || status === 'completed';
  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isIdle = status === 'idle';
  const isResults = subslides[currentSubslideIndex]?.kind === 'results';
  const isPregunta = subslides[currentSubslideIndex]?.kind === 'pregunta';

  return (
    <div className={`flex flex-col gap-3 ${renderMode !== 'bottom' ? 'rounded-xl border border-violet-900/60 bg-gray-950/60 p-3 shadow-xl' : 'mt-3'}`}>

      {/* Header */}
      {(renderMode === 'both' || renderMode === 'top') && (
        <div className="flex items-center gap-2 border-b border-gray-800 pb-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-violet-400">Quiz</span>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-gray-500">
          <Users size={10} />
          <span>{submittedCount} respuestas</span>
        </div>
      </div>
      )}

      {/* Subnav */}
      {(renderMode === 'both' || renderMode === 'top') && (
      <QuizSubslideNav
        subslides={subslides}
        currentIndex={currentSubslideIndex}
        onSelect={onSubslideSelect}
        isInteractive={true}
      />
      )}

      {/* Question preview */}
      {(renderMode === 'both' || renderMode === 'top') && !isResults && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 px-2.5 py-2">
          <p className="text-[11px] text-white/70 line-clamp-2">{quizData.question}</p>
        </div>
      )}

      {/* Timer section */}
      {(renderMode === 'both' || renderMode === 'top') && !isResults && (
        <div className="flex items-center gap-3">
          {/* Timer ring */}
          {isPregunta && <QuizTimerDisplay timerState={timerState} size={56} strokeWidth={5} />}

        {/* Timer controls */}
        <div className="flex flex-1 flex-wrap gap-1.5">
          {isIdle && isPregunta && (
            <button
              type="button"
              onClick={onStartTimer}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-3 py-1.5 text-[11px] font-bold text-emerald-300 hover:bg-emerald-900/50 transition-colors"
            >
              <Play size={11} fill="currentColor" /> Iniciar
            </button>
          )}
          {isRunning && isPregunta && (
            <button
              type="button"
              onClick={onPauseTimer}
              className="flex items-center gap-1.5 rounded-lg border border-yellow-700/60 bg-yellow-950/40 px-3 py-1.5 text-[11px] font-bold text-yellow-300 hover:bg-yellow-900/50 transition-colors"
            >
              <Pause size={11} /> Pausar
            </button>
          )}
          {isPaused && isPregunta && (
            <button
              type="button"
              onClick={onResumeTimer}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-3 py-1.5 text-[11px] font-bold text-emerald-300 hover:bg-emerald-900/50 transition-colors"
            >
              <Play size={11} fill="currentColor" /> Reanudar
            </button>
          )}
          {!isIdle && isPregunta && (
            <button
              type="button"
              onClick={onResetTimer}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-1.5 text-[11px] font-bold text-gray-400 hover:text-white transition-colors"
            >
              <RotateCcw size={11} /> Reset Timer
            </button>
          )}
          {!isIdle && (
            <button
              type="button"
              onClick={onClearAnswers}
              className="flex items-center gap-1.5 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-1.5 text-[11px] font-bold text-red-400 hover:bg-red-900/50 transition-colors"
              title="Borrar respuestas de la audiencia"
            >
              <Eraser size={11} /> Borrar Resp.
            </button>
          )}
          {!isExpired && !isIdle && (
            <button
              type="button"
              onClick={onComplete}
              className="flex items-center gap-1.5 rounded-lg border border-violet-700/60 bg-violet-950/40 px-3 py-1.5 text-[11px] font-bold text-violet-300 hover:bg-violet-900/50 transition-colors"
            >
              Revelar →
            </button>
          )}
          {isPregunta && (
            <div className="text-[11px] text-gray-500 self-center ml-auto">
              {isExpired ? (
                '¡Tiempo!'
              ) : (isIdle || isPaused) && onAdjustTimer ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="1"
                    max="600"
                    value={isIdle ? quizData.timerSeconds : Math.round(remaining / 1000)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val > 0) onAdjustTimer(val);
                    }}
                    className="w-12 rounded border border-gray-700 bg-gray-900 px-1 py-0.5 text-center text-white focus:outline-none focus:ring-1 focus:ring-yellow-500 font-mono text-[11px]"
                    title="Editar segundos"
                  />
                  <span>s</span>
                </div>
              ) : isIdle ? (
                `${quizData.timerSeconds}s`
              ) : (
                formatRemainingTime(remaining)
              )}
            </div>
          )}
        </div>

        {/* Mute toggle */}
        {onToggleMute && (
          <button
            type="button"
            onClick={onToggleMute}
            className="shrink-0 rounded-lg border border-gray-700 bg-gray-900/50 p-1.5 text-gray-400 hover:text-white transition-colors"
            title={audioMuted ? 'Activar sonido' : 'Silenciar'}
          >
            {audioMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        )}
        </div>
      )}

      {/* Options — always shows correct answers */}
      {(renderMode === 'both' || renderMode === 'bottom') && !isResults && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[9px] font-black uppercase tracking-wider text-gray-500">Opciones (respuesta correcta visible)</p>
        {displayOptions.map((opt, idx) => {
          const letter = OPTION_LETTERS[idx] ?? opt.id;

          return (
            <div
              key={opt.id}
              className={[
                'flex items-center gap-2 rounded-lg border px-2.5 py-1.5',
                opt.isCorrect ? 'border-emerald-700/70 bg-emerald-950/40' : 'border-gray-800 bg-gray-900/40',
              ].join(' ')}
            >
              <span className={`shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${opt.isCorrect ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/40'}`}>
                {letter}
              </span>
              <div className="flex-1 flex items-center justify-between min-w-0">
                <span className={`truncate text-[11px] ${opt.isCorrect ? 'text-emerald-200' : 'text-gray-400'}`}>
                  {opt.text}
                </span>
                <div className="flex flex-col items-center shrink-0 ml-2 min-w-[20px]">
                  {opt.isCorrect && <CheckCircle size={11} className="text-emerald-500 mb-0.5" />}
                  <span className={`text-[9px] font-bold ${optionCounts[opt.id] > 0 ? 'text-white' : 'text-gray-600'}`}>
                    {optionCounts[opt.id] ?? 0}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Demo selection — only after timer expires */}
      {(renderMode === 'both' || renderMode === 'top') && !isResults && isExpired && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-2">
          <p className="text-[9px] font-black uppercase tracking-wider text-gray-500 mb-1.5">Demo / Corrección pública</p>
          <div className="flex flex-wrap gap-1">
            {displayOptions.map((opt, idx) => {
              const letter = OPTION_LETTERS[idx] ?? opt.id;
              const isDemoSelected = presenterDemoSelection === opt.id;

              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onDemoSelect(isDemoSelected ? null : opt.id)}
                  className={[
                    'flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all',
                    isDemoSelected
                      ? opt.isCorrect
                        ? 'bg-emerald-600 text-white border border-emerald-500'
                        : 'bg-red-600 text-white border border-red-500'
                      : 'border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700',
                  ].join(' ')}
                >
                  {letter}
                </button>
              );
            })}
          </div>
          {/* Sound FX buttons */}
          <div className="flex gap-1.5 mt-2">
            <button
              type="button"
              onClick={onPlayApplause}
              className="flex items-center gap-1 rounded border border-emerald-800 bg-emerald-950/40 px-2 py-1 text-[10px] font-bold text-emerald-400 hover:bg-emerald-900/50"
            >
              <CheckCircle size={10} /> Aplausos
            </button>
            <button
              type="button"
              onClick={onPlayMal}
              className="flex items-center gap-1 rounded border border-red-800 bg-red-950/40 px-2 py-1 text-[10px] font-bold text-red-400 hover:bg-red-900/50"
            >
              <XCircle size={10} /> Mal
            </button>
          </div>
        </div>
      )}

      {/* Cita reference */}
      {(renderMode === 'both' || renderMode === 'bottom') && !isResults && (quizData.citaRef || quizData.citaReviewRef) && (
        <div className="rounded-lg border border-yellow-900/40 bg-yellow-950/20 px-2.5 py-2">
          <p className="text-[9px] font-black uppercase tracking-wider text-yellow-600 mb-0.5">
            {quizData.citaRef ? 'CITA: (evaluable)' : 'CITA!: (revisión)'}
          </p>
          <p className="text-xs font-semibold text-yellow-300">
            {quizData.citaRef ?? quizData.citaReviewRef}
          </p>
        </div>
      )}

      {/* Results View */}
      {(renderMode === 'both' || renderMode === 'bottom') && isResults && (
        <div className="mt-2 border-t border-gray-800 pt-3">
          <QuizResultsController
            profiles={quizData.resultProfiles ?? []}
            rangeStats={rangeStats}
            totalSessions={totalSessions}
            maxBaseCentipunts={maxBaseCentipunts}
          />
        </div>
      )}
    </div>
  );
};
