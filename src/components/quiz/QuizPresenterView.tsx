import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
/**
 * QuizPresenterView — Projected quiz display for presenter screen & public display.
 *
 * What it shows:
 * - Lectura: citation review text (CITA!: content) or waiting screen
 * - Pregunta: question + options (no correct answer shown) + timer ring
 * - Cita verse: biblical verse content
 * - Respuesta: question + options with correct answer highlighted +
 *              presenter demo selection result
 */

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Trophy } from 'lucide-react';
import type { QuizData } from '../../types/presentation';
import type { QuizOptionId, QuizSubslide, QuizTimerState } from '../../types/quiz';
import { getDisplayOptions, calcResultRanges } from '../../utils/quizUtils';
import { QuizTimerDisplay } from './QuizTimerDisplay';
import AutoResizeText from '../shared/AutoResizeText';

interface QuizPresenterViewProps {
  slide: { id: string };
  quizData: QuizData;
  subslides: QuizSubslide[];
  currentSubslideIndex: number;
  timerState: QuizTimerState;
  /** Option selected by presenter for demo (shown only in respuesta phase) */
  presenterDemoSelection: QuizOptionId | null;
  /** Content of the cita verse being displayed */
  citaVerseContent?: { hebrew: string; transliteration: string; translation: string } | null;
  maxBaseCentipunts?: number;
  /** Global font scale passed from PresenterScreen */
  fontScale?: number;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export const QuizPresenterView: React.FC<QuizPresenterViewProps> = ({
  slide,
  quizData,
  subslides,
  currentSubslideIndex,
  timerState,
  presenterDemoSelection,
  citaVerseContent,
  maxBaseCentipunts = 0,
  fontScale = 1,
}) => {
  useUiTranslation('quiz');
  const currentSubslide = subslides[currentSubslideIndex];
  const displayOptions = getDisplayOptions(quizData, slide.id);

  const isRespuesta = currentSubslide?.kind === 'respuesta';
  const isPregunta = currentSubslide?.kind === 'pregunta';
  const isLectura = currentSubslide?.kind === 'lectura';
  const isCitaVerse = currentSubslide?.kind === 'cita-verse';
  const isResults = currentSubslide?.kind === 'results';
  const ranges = isResults && maxBaseCentipunts > 0 ? calcResultRanges(quizData.resultProfiles || [], maxBaseCentipunts) : [];

  return (
    <div className="relative z-0 flex flex-col w-full h-full max-h-full min-h-0 gap-[1.5vh] py-[1.5vh] text-left" style={{ '--font-scale': fontScale } as React.CSSProperties}>

      {/* Question text (shown in lectura, pregunta and respuesta) */}
      <AnimatePresence mode="wait">
        {(isLectura || isPregunta || isRespuesta) && (
          <motion.div
            key={`question-${slide.id}`}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="glass-panel flex flex-[0.7] min-h-0 px-[4vw] py-[2vh] items-center gap-[4vw]"
          >
            <div className="flex-1 h-full overflow-hidden flex items-center">
              <AutoResizeText
                text={quizData.question}
                html={true}
                fontScale={fontScale}
                allowGrow={true}
                className="font-bold text-white drop-shadow-lg"
              />
            </div>
            {isPregunta && (
              <div className="shrink-0 flex items-center justify-center">
                <QuizTimerDisplay timerState={timerState} size={80} strokeWidth={8} />
              </div>
            )}
          </motion.div>
        )}



        {/* Cita verse content */}
        {isCitaVerse && citaVerseContent && (
          <motion.div
            key={`cita-${currentSubslide.verse}`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col gap-3 flex-1"
          >
            <div className="glass-panel px-[4vw] py-[3vh]">
              <p className="text-right text-yellow-300 font-semibold hebrew-text drop-shadow-lg"
                style={{ fontSize: 'clamp(1.4rem, 3vw, 4rem)' }}
                dir="rtl"
                dangerouslySetInnerHTML={{ __html: citaVerseContent.hebrew }} />
            </div>
            <div className="glass-panel px-[4vw] py-[2vh]">
              <p className="text-sky-200" style={{ fontSize: 'clamp(0.9rem, 1.8vw, 2rem)' }}>
                {citaVerseContent.transliteration}
              </p>
            </div>
            <div className="glass-panel px-[4vw] py-[2vh]">
              <p className="text-white/80" style={{ fontSize: 'clamp(0.85rem, 1.6vw, 1.9rem)' }}>
                {citaVerseContent.translation}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results screen */}
      {isResults && (
        <motion.div
          key="results"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, type: 'spring' }}
          className="glass-panel flex flex-col w-full h-full max-h-full min-h-0 px-[3vw] py-[3vh] gap-[2vh]"
        >
          <div className="flex items-center justify-center gap-[2vw] mb-[1vh] shrink-0">
            <Trophy size={48} className="text-yellow-400 drop-shadow-lg shrink-0" />
            <div className="flex flex-col text-left">
              <h1 className="text-3xl font-black text-white">{translate("quiz:QuizPresenterView.finalResults", "Resultados Finales")}</h1>
              <p className="text-lg text-white/60">{translate("quiz:QuizPresenterView.thankYouForParticipatingCheckYourDeviceToSee", "¡Gracias por participar! Revisa tu dispositivo para ver tu puntuación.")}</p>
            </div>
          </div>
          
          <div className="flex-1 overflow-hidden flex flex-col gap-[1vh] min-h-0">
            {[...(quizData.resultProfiles || [])].sort((a, b) => a.rank - b.rank).map(profile => {
              const range = ranges.find(r => r.rank === profile.rank);
              
              const formatPts = (c: number) => {
                const pts = c / 100;
                return Number.isInteger(pts) ? pts.toString() : pts.toFixed(1);
              };

              let rangeText = '';
              if (range) {
                if (range.maxCentipunts === Infinity) {
                  rangeText = `>${formatPts(range.minCentipunts)}`;
                } else if (range.minCentipunts === 0) {
                  rangeText = `0 - ${formatPts(range.maxCentipunts)}`;
                } else if (range.minCentipunts === range.maxCentipunts) {
                  rangeText = formatPts(range.minCentipunts);
                } else {
                  rangeText = `>${formatPts(range.minCentipunts)} - ${formatPts(range.maxCentipunts)}`;
                }
              }

              return (
                <div key={profile.rank} className="flex-1 min-h-0 flex gap-[1.5vw] rounded-xl border border-white/10 bg-black/30 px-[1.5vw] py-[1vh] items-center">
                  <div className="w-[8%] flex h-full items-center justify-center overflow-hidden">
                    <AutoResizeText text={rangeText} html={false} fontScale={fontScale} className="font-bold text-gray-400 text-center" />
                  </div>
                  <div className="w-[22%] flex h-full items-center overflow-hidden">
                    <AutoResizeText text={profile.title} html={false} fontScale={fontScale} className="font-bold text-white" />
                  </div>
                  <div className="w-[45%] flex h-full items-center overflow-hidden">
                    <AutoResizeText text={profile.description} html={false} fontScale={fontScale} className="text-gray-300" />
                  </div>
                  <div className="w-[25%] flex h-full items-center overflow-hidden">
                    {profile.giftText ? (
                      <AutoResizeText text={profile.giftText} html={false} fontScale={fontScale} className="text-yellow-400/90 italic font-medium" />
                    ) : <span />}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Confetti or visual effects could be added conditionally here */}

      {/* Options grid (lectura + pregunta + respuesta) */}
      <AnimatePresence mode="wait">
        {(isLectura || isPregunta || isRespuesta) && (() => {
          const numOptions = displayOptions.length;
          const gridCols = numOptions <= 2 ? 'grid-cols-1' : 'grid-cols-2';
          const gridRows = 'grid-rows-2';

          return (
            <motion.div
              key={`options-${slide.id}-${isRespuesta}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, delay: 0.05 }}
              className={`grid ${gridCols} ${gridRows} gap-[1.5vh] flex-[2.3] min-h-0 h-full`}
            >
              {displayOptions.map((opt, idx) => {
                const letter = OPTION_LETTERS[idx] ?? opt.id;
                const showCorrect = isRespuesta && opt.isCorrect;
                const isDemoSelected = isRespuesta && presenterDemoSelection === opt.id;
                const isWrongDemo = isDemoSelected && !opt.isCorrect;

                let borderColor = 'glass-panel';
                if (showCorrect) borderColor = 'glass-panel border-emerald-500/70 bg-emerald-950/60! shadow-[inset_0_0_20px_rgba(16,185,129,0.3)]';
                if (isDemoSelected && showCorrect) borderColor = 'glass-panel border-emerald-400 bg-emerald-900/70! shadow-lg shadow-emerald-500/30';
                if (isWrongDemo) borderColor = 'glass-panel border-red-500/70 bg-red-950/60! shadow-[inset_0_0_20px_rgba(239,68,68,0.3)]';

                return (
                  <div
                    key={opt.id}
                    className={`flex items-center gap-[2vw] rounded-2xl border px-[2vw] py-[1vh] transition-all duration-300 h-full min-h-0 ${borderColor}`}
                  >
                    <span className={`shrink-0 flex h-[4vh] w-[4vh] items-center justify-center rounded-full text-[2vh] font-black ${showCorrect ? 'bg-emerald-500 text-black' : isWrongDemo ? 'bg-red-500 text-white' : 'bg-white/10 text-white/60'}`}>
                      {letter}
                    </span>
                    <div className="flex-1 overflow-hidden h-full flex items-center">
                      <AutoResizeText
                        text={opt.text}
                        html={true}
                        fontScale={fontScale}
                        baseFontSize={28 * fontScale}
                        className={`font-medium ${showCorrect ? 'text-emerald-200' : isWrongDemo ? 'text-red-200' : 'text-white/80'}`}
                      />
                    </div>
                  </div>
                );
              })}
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Cita hint during pregunta (if there's an evaluable CITA:) */}
      {isPregunta && quizData.citaRef && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center"
        >
          <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-[11px] font-bold text-yellow-400">
            {translate("quiz:QuizPresenterView.identifyTheCorrectReference", "📖 Identifica la cita correcta")}</span>
        </motion.div>
      )}

      {/* Respuesta: show the correct cita ref */}
      {isRespuesta && quizData.citaRef && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-panel px-4 py-2 text-center"
        >
          <span className="text-[11px] font-bold uppercase tracking-widest text-yellow-400/70 mr-2">{translate("quiz:QuizPresenterView.reference", "CITA:")}</span>
          <span className="text-sm font-semibold text-yellow-300">{quizData.citaRef}</span>
        </motion.div>
      )}
    </div>
  );
};
