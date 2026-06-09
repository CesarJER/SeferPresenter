/**
 * QuizAudienceView — Interactive quiz view for audience members.
 *
 * Manages the full audience interaction for one quiz question:
 * - Lectura: reading phase (no interaction)
 * - Pregunta: option selection + cita identification + submit button
 * - Cita verse: verse display (read-only)
 * - Respuesta: result display + bonus reading claim checkbox
 */

import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, XCircle, BookOpen, Send, RotateCcw } from 'lucide-react';
import type { QuizData, QuizOptionId } from '../../types/presentation';
import type { QuizAudienceAnswer, QuizSubslide, QuizTimerState } from '../../types/quiz';
import { formatCentipunts, getDisplayOptions, scoreAnswer } from '../../utils/quizUtils';
import { getMetadata, resolveBookName } from '../../utils/metadataCache';
import type { AppMetadata } from '../../utils/metadataCache';
import { QuizResultsDiploma } from './QuizResultsView';

interface QuizAudienceViewProps {
  slide: { id: string };
  quizData: QuizData;
  subslides: QuizSubslide[];
  currentSubslideIndex: number;
  timerState: QuizTimerState;
  /** From useAudienceAnswers */
  answer: QuizAudienceAnswer;
  onSelectRadio: (optionId: QuizOptionId) => void;
  onToggleCheckbox: (optionId: QuizOptionId) => void;
  onSetCitaField: (fields: Partial<Pick<QuizAudienceAnswer, 'citaBook' | 'citaChapter' | 'citaVerseStart' | 'citaVerseEnd'>>) => void;
  onSubmit: () => void;
  onClear: () => void;
  onBonusClaim: (claimed: boolean) => void;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export const QuizAudienceView: React.FC<QuizAudienceViewProps> = ({
  slide,
  quizData,
  subslides,
  currentSubslideIndex,
  timerState,
  answer,
  onSelectRadio,
  onToggleCheckbox,
  onSetCitaField,
  onSubmit,
  onClear,
  onBonusClaim,
}) => {
  const currentSubslide = subslides[currentSubslideIndex];
  const displayOptions = getDisplayOptions(quizData, slide.id);
  const isExpired = timerState.status === 'expired' || timerState.status === 'completed';
  const isPregunta = currentSubslide?.kind === 'pregunta';
  const isRespuesta = currentSubslide?.kind === 'respuesta';
  const isLectura = currentSubslide?.kind === 'lectura';
  const isCitaVerse = currentSubslide?.kind === 'cita-verse';
  const isResults = currentSubslide?.kind === 'results';

  // Auto-submit on timer expire
  useEffect(() => {
    if (isExpired && isPregunta && !answer.submitted) {
      onSubmit();
    }
  }, [isExpired, isPregunta, answer.submitted, onSubmit]);

  const [metadata, setMetadata] = React.useState<AppMetadata | null>(null);
  useEffect(() => {
    getMetadata().then(setMetadata).catch(console.error);
  }, []);

  // Score for respuesta phase
  const questionScore = isRespuesta ? scoreAnswer(quizData, answer) : null;

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-auto px-4 py-4 pointer-events-auto">

      {/* Lectura phase */}
      {isLectura && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col gap-3 items-center justify-center flex-1 text-center"
        >
          <BookOpen size={40} className="text-yellow-400/60" />
          <p className="text-white/60 text-sm">Tiempo de lectura</p>
          {quizData.citaReviewRef && (
            <p className="text-yellow-300 font-semibold text-base">{quizData.citaReviewRef}</p>
          )}
        </motion.div>
      )}

      {/* Cita verse phase */}
      {isCitaVerse && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-1 items-center justify-center"
        >
          <p className="text-white/60 text-sm text-center">
            Verso {currentSubslide.verse} — sigue en pantalla
          </p>
        </motion.div>
      )}

      {/* Pregunta phase */}
      {isPregunta && (
        <AnimatePresence>
          <motion.div
            key="pregunta-audience"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-3"
          >
            {/* Question text */}
            <p className="text-white font-bold text-base leading-snug">
              {quizData.question}
            </p>

            {/* Submitted banner */}
            {answer.submitted && (
              <div className="rounded-lg border border-emerald-600/50 bg-emerald-950/40 px-3 py-2 text-xs font-bold text-emerald-300 text-center">
                ✓ Respuesta enviada
              </div>
            )}

            {/* Options */}
            <div className="flex flex-col gap-2">
              {displayOptions.map((opt, idx) => {
                const letter = OPTION_LETTERS[idx] ?? opt.id;
                const isSelected = answer.selectedOptionIds.includes(opt.id);
                const isDisabled = answer.submitted;

                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => {
                      if (quizData.multiSelect) {
                        onToggleCheckbox(opt.id);
                      } else {
                        onSelectRadio(opt.id);
                      }
                    }}
                    className={[
                      'flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150',
                      isSelected
                        ? 'border-yellow-500/70 bg-yellow-950/50 shadow-md shadow-yellow-500/20'
                        : isDisabled
                          ? 'border-white/10 bg-white/3 opacity-50 cursor-not-allowed'
                          : 'border-white/15 bg-white/5 hover:border-white/30 hover:bg-white/10 active:scale-[0.99] cursor-pointer',
                    ].join(' ')}
                  >
                    <span className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${isSelected ? 'bg-yellow-500 text-black' : 'bg-white/10 text-white/50'}`}>
                      {letter}
                    </span>
                    <span className={`text-sm ${isSelected ? 'text-yellow-100 font-semibold' : 'text-white/70'}`}>
                      {opt.text}
                    </span>
                    {quizData.multiSelect && (
                      <span className={`ml-auto shrink-0 h-4 w-4 rounded border ${isSelected ? 'border-yellow-500 bg-yellow-500' : 'border-white/30 bg-transparent'}`} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Cita identification (only if CITA:) */}
            {quizData.citaRef && !answer.submitted && metadata && (
              <div className="rounded-lg border border-yellow-600/30 bg-yellow-950/20 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-yellow-400 mb-2">
                  📖 Identifica la cita
                </p>
                <div className="grid grid-cols-[1fr_60px_60px_60px] gap-1.5">
                  <select
                    value={answer.citaBook ?? ''}
                    onChange={e => {
                      onSetCitaField({ citaBook: e.target.value, citaChapter: '', citaVerseStart: '', citaVerseEnd: '' });
                    }}
                    className="rounded border border-yellow-600/30 bg-black/30 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-yellow-500 appearance-none"
                  >
                    <option value="">Libro</option>
                    {Object.values(metadata).map(m => (
                      <option key={m.bookAbbrevEs} value={m.bookAbbrevEs}>{m.bookAbbrevEs}</option>
                    ))}
                  </select>

                  {(() => {
                    const resolvedBookName = answer.citaBook ? resolveBookName(answer.citaBook, metadata) : null;
                    const bookMeta = resolvedBookName ? metadata[resolvedBookName] : null;
                    const chapters = bookMeta ? Object.keys(bookMeta.chapters) : [];
                    const versesCount = bookMeta && answer.citaChapter && bookMeta.chapters[answer.citaChapter]
                      ? bookMeta.chapters[answer.citaChapter].length
                      : 0;
                    const verses = Array.from({ length: versesCount }, (_, i) => String(i + 1));

                    return (
                      <>
                        <select
                          value={answer.citaChapter ?? ''}
                          onChange={e => onSetCitaField({ citaChapter: e.target.value, citaVerseStart: '', citaVerseEnd: '' })}
                          disabled={!bookMeta}
                          className="rounded border border-yellow-600/30 bg-black/30 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-yellow-500 appearance-none text-center disabled:opacity-50"
                        >
                          <option value="">Cap</option>
                          {chapters.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select
                          value={answer.citaVerseStart ?? ''}
                          onChange={e => onSetCitaField({ citaVerseStart: e.target.value })}
                          disabled={!answer.citaChapter}
                          className="rounded border border-yellow-600/30 bg-black/30 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-yellow-500 appearance-none text-center disabled:opacity-50"
                        >
                          <option value="">V.ini</option>
                          {verses.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <select
                          value={answer.citaVerseEnd ?? ''}
                          onChange={e => onSetCitaField({ citaVerseEnd: e.target.value })}
                          disabled={!answer.citaVerseStart}
                          className="rounded border border-yellow-600/30 bg-black/30 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-yellow-500 appearance-none text-center disabled:opacity-50"
                        >
                          <option value="">V.fin</option>
                          {verses.filter(v => Number(v) >= Number(answer.citaVerseStart)).map(v => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Action buttons */}
            {!answer.submitted && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClear}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-white/50 hover:text-white/70 transition-colors"
                >
                  <RotateCcw size={12} />
                  Borrar
                </button>
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={answer.selectedOptionIds.length === 0}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-yellow-600/50 bg-yellow-600/20 px-4 py-2 text-sm font-bold text-yellow-300 hover:bg-yellow-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <Send size={14} />
                  Enviar respuesta
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Respuesta phase */}
      {isRespuesta && questionScore && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35 }}
          className="flex flex-col gap-3"
        >
          {/* Score summary */}
          <div className={`rounded-xl border px-4 py-3 text-center ${questionScore.optionCentipunts > 0 ? 'border-emerald-600/60 bg-emerald-950/40' : 'border-red-600/40 bg-red-950/30'}`}>
            <div className="flex items-center justify-center gap-2 mb-1">
              {questionScore.optionCentipunts > 0
                ? <CheckCircle size={18} className="text-emerald-400" />
                : <XCircle size={18} className="text-red-400" />}
              <span className={`font-black text-lg ${questionScore.optionCentipunts > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                {questionScore.optionCentipunts > 0 ? '¡Correcto!' : 'Incorrecto'}
              </span>
            </div>
            <p className="text-xs text-white/50">
              Puntuación: <span className="text-white font-bold">{formatCentipunts(questionScore.totalCentipunts)} pts</span>
            </p>
          </div>

          {/* Options result */}
          <div className="flex flex-col gap-1.5">
            {displayOptions.map((opt, idx) => {
              const letter = OPTION_LETTERS[idx] ?? opt.id;
              const wasSelected = answer.selectedOptionIds.includes(opt.id);

              let style = 'border-white/10 bg-white/3 opacity-50';
              if (opt.isCorrect && wasSelected) style = 'border-emerald-500 bg-emerald-900/50';
              else if (opt.isCorrect) style = 'border-emerald-500/50 bg-emerald-950/30';
              else if (wasSelected) style = 'border-red-500/60 bg-red-950/30';

              return (
                <div key={opt.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${style}`}>
                  <span className={`shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${opt.isCorrect ? 'bg-emerald-500 text-black' : wasSelected ? 'bg-red-500 text-white' : 'bg-white/10 text-white/40'}`}>
                    {letter}
                  </span>
                  <span className="text-xs text-white/70">{opt.text}</span>
                  {opt.isCorrect && <CheckCircle size={12} className="ml-auto text-emerald-400" />}
                  {!opt.isCorrect && wasSelected && <XCircle size={12} className="ml-auto text-red-400" />}
                </div>
              );
            })}
          </div>

          {/* Cita result */}
          {quizData.citaRef && (
            <div className={`rounded-lg border px-3 py-2 ${questionScore.citaCentipunts > 0 ? 'border-yellow-500/50 bg-yellow-950/30' : 'border-white/10 bg-white/3'}`}>
              <p className="text-[10px] font-bold text-yellow-400/70 mb-0.5 uppercase tracking-wide">CITA:</p>
              <p className="text-sm font-semibold text-yellow-300">{quizData.citaRef}</p>
              {questionScore.citaCentipunts > 0
                ? <p className="text-[11px] text-emerald-400 mt-1">✓ Cita correcta +{formatCentipunts(questionScore.citaCentipunts)} pts</p>
                : <p className="text-[11px] text-white/40 mt-1">✗ Cita no identificada</p>}
            </div>
          )}

          {/* Bonus reading claim */}
          <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3 cursor-pointer hover:bg-white/8 transition-colors">
            <input
              type="checkbox"
              checked={answer.bonusReadingClaimed}
              onChange={e => onBonusClaim(e.target.checked)}
              className="mt-0.5 accent-yellow-500"
            />
            <div>
              <p className="text-xs font-bold text-white/80">He leído el texto con atención</p>
              <p className="text-[10px] text-white/40 mt-0.5">+0.25 puntos extra</p>
            </div>
          </label>
        </motion.div>
      )}

      {/* Results phase */}
      {isResults && (
        <QuizResultsDiploma
          profile={quizData.resultProfiles?.[0] ?? null}
          totalScore={{ totalCentipunts: 0, maxBaseCentipunts: 0, questions: [] }}
        />
      )}
    </div>
  );
};
