import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Eye } from 'lucide-react';
import type { Slide, ScriptureNavState, AppMode } from '../../types/presentation';
import type { QuizSubslide } from '../../types/quiz';
import { sanitizeSlideHtml } from '../../utils/hebrewText';
import { findScriptureRange } from '../../utils/scriptureLookup';

interface SlideVisualizerProps {
  slide: Slide | null;
  appMode: AppMode;
  scriptureState: ScriptureNavState | null;
  quizSubslide?: QuizSubslide;
}

const containsHebrew = (text: string): boolean => {
  return /[\u0590-\u05FF]/.test(text);
};

const SlideVisualizer: React.FC<SlideVisualizerProps> = ({
  slide,
  appMode,
  scriptureState,
  quizSubslide,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [quizVerseLines, setQuizVerseLines] = useState<string[]>([]);

  // Auto expand when switching to scripture mode
  useEffect(() => {
    if (appMode === 'scripture') {
      setIsCollapsed(false);
    }
  }, [appMode]);

  // Fetch quiz verse content if needed
  useEffect(() => {
    if (slide?.type === 'quiz' && quizSubslide?.kind === 'cita-verse' && quizSubslide.bookToken && quizSubslide.chapter && quizSubslide.verse) {
      findScriptureRange(quizSubslide.bookToken, quizSubslide.chapter, quizSubslide.verse)
        .then(verses => {
          if (verses && verses.length > 0) {
            const v = verses[0];
            setQuizVerseLines([
              v.verseNikud || '',
              v.transliteration || '',
              v.translation || ''
            ]);
          } else {
            setQuizVerseLines([]);
          }
        })
        .catch(err => {
          console.error("Error fetching quiz verse", err);
          setQuizVerseLines([]);
        });
    } else {
      setQuizVerseLines([]);
    }
  }, [slide, quizSubslide]);

  // If in manual mode, the manual control panel handles its own visualizer
  if (appMode === 'seferManual') {
    return null;
  }

  // Determine lines to display
  let lines: string[] = [];
  let labelText = '';

  if (appMode === 'scripture' && scriptureState) {
    lines = [
      scriptureState.verseNikud || '',
      scriptureState.transliteration || '',
      scriptureState.translation || '',
    ];
    labelText = `${scriptureState.bookAbbrevEs || scriptureState.bookEs} ${scriptureState.chapter}:${scriptureState.verse}`;
  } else if (slide?.type === 'quiz' && quizSubslide?.kind === 'cita-verse') {
    lines = quizVerseLines;
    labelText = quizSubslide.label || '';
  } else if (slide) {
    lines = slide.lines || [];
    labelText = slide.label || '';
  }

  const hasContent = lines.length > 0 && lines.some(l => l && l.trim() !== '' && l.trim() !== '-');

  if (!hasContent) {
    return (
      <div className="px-4 py-2 text-xs text-gray-500 italic bg-gray-950/40 border-b border-gray-800 text-center">
        No hay diapositiva o versículo proyectado
      </div>
    );
  }

  const line0 = lines[0] || '';
  const safeLine0 = sanitizeSlideHtml(line0);
  const line1 = lines[1] || '';
  const line2 = lines[2] || '';

  const isFallback1x = lines.length === 3 && line1 === '-' && line2 === '-';
  const isTrilingual = lines.length === 3 && !isFallback1x && (line1.trim() !== '' || line2.trim() !== '');

  // Detect direction of the first line (Hebrew vs Greek/Latin)
  const isRtl = containsHebrew(line0);
  const textDir = isRtl ? 'rtl' : 'ltr';
  const textAlignment = isRtl ? 'text-right' : 'text-left';

  return (
    <div id="section-slide-visualizer" className="bg-gray-950/80 border-b border-gray-800 flex flex-col transition-all">
      {/* Header / Toggle Panel */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900/40 text-[11px] font-bold text-gray-400 border-b border-gray-800/40 select-none">
        <div className="flex items-center gap-1.5">
          <Eye size={12} className="text-yellow-500" />
          <span>PREVISUALIZACIÓN DE PROYECCIÓN</span>
          {labelText && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-800 text-yellow-400 font-mono">
              {labelText}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 rounded hover:bg-gray-800 hover:text-white transition-colors cursor-pointer"
          title={isCollapsed ? "Expandir previsualización" : "Colapsar previsualización"}
        >
          {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {/* Main View Area */}
      {!isCollapsed && (
        <div className="p-2.5 md:p-3">
          {isTrilingual ? (
            <div className="rounded-lg bg-gray-900/60 border border-gray-800/60 p-2.5 space-y-2">
              {/* Line 0 (Hebrew/Greek) */}
              <div
                dir={textDir}
                className={`text-sm md:text-base leading-relaxed text-[#f3c96a] font-bold ${textAlignment}`}
                style={{ fontFamily: isRtl ? "'Frank Ruhl Libre', 'SBL Hebrew', serif" : 'inherit' }}
                dangerouslySetInnerHTML={{ __html: safeLine0 }}
              />

              {/* Transliteration & Translation */}
              <div className="flex flex-col gap-1 mt-1.5 pt-1.5 border-t border-gray-800/60 text-xs">
                {line1 && line1 !== '-' && (
                  <p className="text-sky-300 leading-relaxed">
                    {line1}
                  </p>
                )}
                {line2 && line2 !== '-' && (
                  <p className="text-gray-300 leading-relaxed">
                    {line2}
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* Monolingual View - Shows only line 0 */
            <div className="rounded-lg bg-gray-900/60 border border-gray-800/60 p-2.5">
              <div
                dir={textDir}
                className={`text-sm md:text-base leading-relaxed text-white font-bold ${textAlignment}`}
                style={{ fontFamily: isRtl ? "'Frank Ruhl Libre', 'SBL Hebrew', serif" : 'inherit' }}
                dangerouslySetInnerHTML={{ __html: safeLine0 }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SlideVisualizer;
