/**
 * QuizSlideEditor — Visual editor panel for quiz slides inside SlideRow.
 *
 * Inspired by legacy/QuizSlideEditorLegacy.tsx.
 * Features:
 * - Question textarea
 * - Options A–D with correct toggle (checkbox) + remove button
 * - + Add option (up to 4)
 * - Timer, randomize, multiSelect controls
 * - Biblical citation (CITA: / CITA!:) via ScriptureRangeEditor
 * - Toggle: Modo Resultados — switches to result profiles editor (R1–R9)
 * - Auto-save on blur (no submit button needed)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HelpCircle, BookOpen, Plus, Trash2, Trophy } from 'lucide-react';
import type { QuizData, QuizOptionId, QuizResultProfile } from '../../types/presentation';
import { ScriptureRangeEditor } from '../control/ScriptureRangeEditor';
import { parseScriptureTag } from '../../utils/scriptureLookup';
import type { Slide } from '../../types/presentation';
import { makeDefaultQuizData, makeDefaultResultsQuizData } from '../../utils/quizUtils';

const QUIZ_OPTION_IDS: QuizOptionId[] = ['A', 'B', 'C', 'D'];

interface QuizSlideEditorProps {
  quizData: QuizData;
  slideId: string;
  backgrounds: string[];
  onChange: (updated: QuizData) => void;
}

export const QuizSlideEditor: React.FC<QuizSlideEditorProps> = ({
  quizData,
  slideId,
  backgrounds,
  onChange,
}) => {
  const [local, setLocal] = useState<QuizData>({ ...quizData });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Sync from external prop only when slideId changes (avoids overwriting mid-edit)
  useEffect(() => {
    setLocal({ ...quizData });
  }, [slideId]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((updated: QuizData, immediate = true) => {
    setLocal(updated);
    if (immediate) onChangeRef.current(updated);
  }, []);

  const commit = () => onChangeRef.current(local);

  // ── Options helpers ────────────────────────────────────────────────
  const addOption = () => {
    const opts = local.options ?? [];
    if (opts.length >= 4) return;
    const nextId = QUIZ_OPTION_IDS[opts.length];
    update({ ...local, options: [...opts, { id: nextId, text: '', isCorrect: false }] });
  };

  const removeOption = (idx: number) => {
    const opts = local.options ?? [];
    if (opts.length <= 2) return;
    // Re-assign stable IDs in order
    const newOpts = opts.filter((_, i) => i !== idx).map((opt, i) => ({
      ...opt,
      id: QUIZ_OPTION_IDS[i],
    }));
    // Remove from correct set if deleted; remap if the ID shifted
    update({ ...local, options: newOpts });
  };

  const updateOptionText = (idx: number, text: string) => {
    const opts = [...(local.options ?? [])];
    opts[idx] = { ...opts[idx], text };
    setLocal(prev => ({ ...prev, options: opts }));
    // Defer save to onBlur
  };

  const toggleCorrect = (id: QuizOptionId, checked: boolean) => {
    const opts = (local.options ?? []).map(opt =>
      opt.id === id ? { ...opt, isCorrect: checked } : opt
    );
    update({ ...local, options: opts });
  };

  // ── Result profiles helpers ────────────────────────────────────────
  const addProfile = () => {
    const current = local.resultProfiles ?? [];
    const newRank = current.length + 1;
    update({
      ...local,
      resultProfiles: [...current, { rank: newRank, title: '', description: '', giftText: '' }],
    });
  };

  const removeProfile = (idx: number) => {
    const current = local.resultProfiles ?? [];
    const next = current.filter((_, i) => i !== idx).map((p, i) => ({ ...p, rank: i + 1 }));
    update({ ...local, resultProfiles: next });
  };

  const updateProfile = (idx: number, field: keyof QuizResultProfile, value: string | number) => {
    const current = [...(local.resultProfiles ?? [])];
    current[idx] = { ...current[idx], [field]: value };
    setLocal(prev => ({ ...prev, resultProfiles: current }));
    // Defer save
  };

  // ── Cita helpers ──────────────────────────────────────────────────
  const hasCitaRef = !!local.citaRef;
  const hasCitaReviewRef = !!local.citaReviewRef;
  const hasAnyCita = hasCitaRef || hasCitaReviewRef;
  const citaMode: 'eval' | 'review' | null = hasCitaRef ? 'eval' : hasCitaReviewRef ? 'review' : null;

  const getDummySlideForCita = (): Slide => {
    const tagText = local.citaRef ?? local.citaReviewRef;
    let book = '', chapter = '1', start = '1', end = '';
    if (tagText) {
      const parsed = parseScriptureTag(`[Sefer ${tagText}]`) ?? parseScriptureTag(`[Tanaj ${tagText}]`);
      // Try plain format: "Dn 1:1-4"
      const plainMatch = tagText.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
      if (parsed) {
        book = parsed.bookToken;
        chapter = String(parsed.chapter);
        start = String(parsed.verseStart);
        end = parsed.verseEnd ? String(parsed.verseEnd) : '';
      } else if (plainMatch) {
        book = plainMatch[1].trim();
        chapter = plainMatch[2];
        start = plainMatch[3];
        end = plainMatch[4] ?? '';
      }
    }
    return {
      id: slideId,
      type: 'sefer',
      label: book ? `${book} ${chapter}:${start}${end ? '-' + end : ''}` : '',
      lines: ['', '-', '-'],
      scriptureBook: book,
      scriptureChapter: chapter,
      scriptureVerseStart: start,
      scriptureVerseEnd: end,
    };
  };

  const handleCitaCommit = (payload: { scriptureBook: string; scriptureChapter: string; scriptureVerseStart: string; scriptureVerseEnd?: string }) => {
    if (!payload.scriptureBook) {
      update({ ...local, citaRef: undefined, citaReviewRef: undefined });
      return;
    }
    const ref = `${payload.scriptureBook} ${payload.scriptureChapter}:${payload.scriptureVerseStart}${payload.scriptureVerseEnd && payload.scriptureVerseEnd !== payload.scriptureVerseStart ? `-${payload.scriptureVerseEnd}` : ''}`;
    if (citaMode === 'review') {
      update({ ...local, citaReviewRef: ref, citaRef: undefined });
    } else {
      update({ ...local, citaRef: ref, citaReviewRef: undefined });
    }
  };

  const clearCita = () => update({ ...local, citaRef: undefined, citaReviewRef: undefined });

  const setCitaMode = (mode: 'eval' | 'review') => {
    const ref = local.citaRef ?? local.citaReviewRef ?? '';
    if (mode === 'eval') {
      update({ ...local, citaRef: ref, citaReviewRef: undefined });
    } else {
      update({ ...local, citaReviewRef: ref, citaRef: undefined });
    }
  };

  // ── Toggle results mode ───────────────────────────────────────────
  const isResultsMode = !!local.isResultsSlide;

  const handleToggleResultsMode = (checked: boolean) => {
    if (checked) {
      update({
        ...makeDefaultResultsQuizData(),
        resultProfiles: local.resultProfiles?.length ? local.resultProfiles : makeDefaultResultsQuizData().resultProfiles,
      });
    } else {
      update({
        ...makeDefaultQuizData(),
        question: local.question,
        options: local.options?.length >= 2 ? local.options : makeDefaultQuizData().options,
      });
    }
  };

  return (
    <div className="bg-gray-950/40 border border-violet-900/60 rounded-lg p-3 space-y-3 shadow-md w-full">

      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-800 pb-2">
        <HelpCircle size={13} className="text-violet-400 shrink-0" />
        <span className="text-[10px] font-black uppercase tracking-wider text-gray-300">Editor de Quiz</span>
        <span className="text-[9px] text-gray-600 italic">• auto-guardado</span>
        <label className="ml-auto flex items-center gap-1.5 text-[10px] font-bold text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isResultsMode}
            onChange={e => handleToggleResultsMode(e.target.checked)}
            className="accent-violet-500"
          />
          <Trophy size={10} className="text-violet-400" />
          Modo Resultados
        </label>
      </div>

      {/* ── Results mode ── */}
      {isResultsMode && (
        <div className="space-y-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block">
            Rangos de Resultados (R1 = mejor)
          </span>
          {(local.resultProfiles ?? []).map((profile, rangeIdx) => (
            <div key={`${slideId}-profile-${rangeIdx}`} className="grid grid-cols-[36px_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_auto] gap-1.5 items-center">
              <span className="text-center text-[10px] font-black text-violet-400">R{profile.rank}</span>
              <input
                value={profile.title}
                onChange={e => updateProfile(rangeIdx, 'title', e.target.value)}
                onBlur={commit}
                placeholder="Título"
                className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:border-violet-500"
              />
              <input
                value={profile.description}
                onChange={e => updateProfile(rangeIdx, 'description', e.target.value)}
                onBlur={commit}
                placeholder="Descripción"
                className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:border-violet-500"
              />
              <input
                value={profile.giftText}
                onChange={e => updateProfile(rangeIdx, 'giftText', e.target.value)}
                onBlur={commit}
                placeholder="Versículo / regalo"
                className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:border-violet-500"
              />
              <button
                type="button"
                onClick={() => removeProfile(rangeIdx)}
                disabled={(local.resultProfiles?.length ?? 0) <= 1}
                className="rounded border border-red-900/70 bg-red-950/30 px-2 py-1 text-[10px] font-bold text-red-300 disabled:opacity-30"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addProfile}
            disabled={(local.resultProfiles?.length ?? 0) >= 9}
            className="flex items-center gap-1 rounded border border-violet-800 bg-violet-950/30 px-3 py-1 text-[11px] font-bold text-violet-300 hover:bg-violet-900/40 disabled:opacity-40"
          >
            <Plus size={11} /> Añadir Rango
          </button>
        </div>
      )}

      {/* ── Quiz mode ── */}
      {!isResultsMode && (
        <>
          {/* Question */}
          <textarea
            value={local.question}
            onChange={e => setLocal(prev => ({ ...prev, question: e.target.value }))}
            onBlur={commit}
            rows={2}
            placeholder="P: Escribe la pregunta aquí..."
            className="w-full rounded border border-gray-800 bg-gray-900 px-2.5 py-2 text-xs text-white resize-none focus:outline-none focus:border-violet-500 placeholder-gray-600"
          />

          {/* Options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {(local.options ?? []).map((opt, optIdx) => {
              const isCorrect = opt.isCorrect;
              return (
                <div
                  key={`${slideId}-${opt.id}`}
                  className={`flex items-center gap-1.5 rounded border px-2 py-1.5 ${isCorrect ? 'border-emerald-700 bg-emerald-950/30' : 'border-gray-800 bg-gray-900/70'}`}
                >
                  <label className="flex items-center gap-1 font-black text-[11px] text-gray-300 cursor-pointer select-none shrink-0">
                    <input
                      type="checkbox"
                      checked={isCorrect}
                      onChange={e => toggleCorrect(opt.id, e.target.checked)}
                      className="accent-emerald-500"
                      title="Marcar como correcta"
                    />
                    <span className={isCorrect ? 'text-emerald-300' : ''}>{opt.id})</span>
                  </label>
                  <input
                    value={opt.text}
                    onChange={e => updateOptionText(optIdx, e.target.value)}
                    onBlur={commit}
                    placeholder={`Opción ${opt.id}`}
                    className="min-w-0 flex-1 bg-transparent text-[11px] text-gray-100 outline-none placeholder-gray-600"
                  />
                  {(local.options?.length ?? 0) > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(optIdx)}
                      className="shrink-0 text-red-400 hover:text-red-300"
                      title="Eliminar opción"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {(local.options?.length ?? 0) < 4 && (
            <button
              type="button"
              onClick={addOption}
              className="flex items-center gap-1 text-[11px] font-bold text-violet-400 hover:text-violet-300 transition-colors"
            >
              <Plus size={11} /> Añadir Opción
            </button>
          )}

          {/* Config row */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold text-gray-300 pt-1 border-t border-gray-800">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={local.randomize !== false}
                onChange={e => update({ ...local, randomize: e.target.checked })}
                className="accent-violet-500"
              />
              Aleatorio
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={local.multiSelect === true}
                onChange={e => update({ ...local, multiSelect: e.target.checked })}
                className="accent-violet-500"
              />
              Multi-selección
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">⏱</span>
              <input
                type="number"
                min={5}
                max={300}
                value={local.timerSeconds ?? 30}
                onChange={e => setLocal(prev => ({ ...prev, timerSeconds: Number(e.target.value) || 30 }))}
                onBlur={commit}
                className="w-14 rounded border border-gray-800 bg-gray-900 px-2 py-1 text-white focus:outline-none focus:border-violet-500"
              />
              <span className="text-gray-600 font-normal">seg</span>
            </label>
          </div>

          {/* Cita section */}
          <div className="border-t border-gray-800 pt-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">Referencia Bíblica</span>
              <div className="flex items-center gap-1.5">
                {hasAnyCita && (
                  <>
                    <button
                      type="button"
                      onClick={() => setCitaMode('eval')}
                      className={`rounded px-2 py-0.5 text-[10px] font-bold transition-colors ${citaMode === 'eval' ? 'bg-yellow-600 text-black' : 'text-yellow-600 hover:text-yellow-400'}`}
                    >
                      CITA:
                    </button>
                    <button
                      type="button"
                      onClick={() => setCitaMode('review')}
                      className={`rounded px-2 py-0.5 text-[10px] font-bold transition-colors ${citaMode === 'review' ? 'bg-violet-600 text-white' : 'text-violet-400 hover:text-violet-300'}`}
                    >
                      CITA!:
                    </button>
                    <button
                      type="button"
                      onClick={clearCita}
                      className="text-[10px] text-red-400 hover:text-red-300"
                    >
                      Quitar
                    </button>
                  </>
                )}
                {!hasAnyCita && (
                  <button
                    type="button"
                    onClick={() => update({ ...local, citaRef: 'Gn 1:1' })}
                    className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300"
                  >
                    <BookOpen size={10} /> + Añadir Ref
                  </button>
                )}
              </div>
            </div>

            {hasAnyCita && (
              <div className="space-y-1">
                <p className="text-[9px] text-gray-600">
                  {citaMode === 'eval'
                    ? 'CITA: — La audiencia debe identificar este versículo (+0.5 pts)'
                    : 'CITA!: — Solo para lectura, no evaluada'}
                </p>
                <ScriptureRangeEditor
                  slide={getDummySlideForCita()}
                  backgrounds={backgrounds}
                  onVerseBackgroundChange={() => {}}
                  onCommit={handleCitaCommit}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
