import React, { useState, useEffect } from 'react';
import type { Slide } from '../../types/presentation';
import { getScriptureChapterVerses } from '../../utils/scriptureLookup';
import { ChevronUp, ChevronDown, Play } from 'lucide-react';
import { sanitizeSlideHtml } from '../../utils/hebrewText';

interface ScriptureRangeEditorProps {
  slide: Slide;
  backgrounds: string[];
  onVerseBackgroundChange: (verse: string, value: string) => void;
  onPlayVerse?: (verse: string) => void;
  onCommit: (payload: {
    scriptureBook: string;
    scriptureChapter: string;
    scriptureVerseStart: string;
    scriptureVerseEnd?: string;
    label: string;
  }) => void;
}

export const ScriptureRangeEditor: React.FC<ScriptureRangeEditorProps> = ({ slide, backgrounds, onVerseBackgroundChange, onPlayVerse, onCommit }) => {
  const [bookToken, setBookToken] = useState(slide.scriptureBook || slide.label.split(' ')[0] || '');
  const [chapter, setChapter] = useState(slide.scriptureChapter || '1');
  const [verseStart, setVerseStart] = useState(slide.scriptureVerseStart || '1');
  const [verseEnd, setVerseEnd] = useState(slide.scriptureVerseEnd && slide.scriptureVerseEnd !== slide.scriptureVerseStart ? slide.scriptureVerseEnd : '');
  const [selectedVerses, setSelectedVerses] = useState<Awaited<ReturnType<typeof getScriptureChapterVerses>>>([]);
  const [loadingVerses, setLoadingVerses] = useState(false);
  const [showTanajTable, setShowTanajTable] = useState(true);

  const isTanaj = slide.type === 'tanaj';
  const isSefer = slide.type === 'sefer';

  useEffect(() => {
    setBookToken(slide.scriptureBook || slide.label.split(' ')[0] || '');
    setChapter(slide.scriptureChapter || '1');
    setVerseStart(slide.scriptureVerseStart || '1');
    setVerseEnd(slide.scriptureVerseEnd && slide.scriptureVerseEnd !== slide.scriptureVerseStart ? slide.scriptureVerseEnd : '');
  }, [slide.id, slide.label, slide.scriptureBook, slide.scriptureChapter, slide.scriptureVerseStart, slide.scriptureVerseEnd]);

  useEffect(() => {
    let alive = true;
    const safeBook = bookToken.trim();
    const safeChapter = chapter.trim() || '1';
    const startNum = Number(verseStart || '1');
    const endNum = Number(verseEnd || verseStart || '1');

    if (!safeBook) {
      setSelectedVerses([]);
      setLoadingVerses(false);
      return () => { alive = false; };
    }

    setLoadingVerses(true);
    getScriptureChapterVerses(safeBook, safeChapter)
      .then((rows) => {
        if (!alive) return;
        const from = Number.isFinite(startNum) ? startNum : 1;
        const to = Number.isFinite(endNum) ? endNum : from;
        const min = Math.min(from, to);
        const max = Math.max(from, to);
        setSelectedVerses(rows.filter((row) => {
          const verseNum = Number(row.verse);
          return verseNum >= min && verseNum <= max;
        }));
      })
      .catch(() => {
        if (!alive) return;
        setSelectedVerses([]);
      })
      .finally(() => {
        if (alive) setLoadingVerses(false);
      });

    return () => {
      alive = false;
    };
  }, [bookToken, chapter, verseStart, verseEnd]);

  const commitRange = () => {
    const bookValue = bookToken.trim() || slide.scriptureBook || slide.label.split(' ')[0] || '';
    const startValue = verseStart.trim() || '1';
    const rawEnd = verseEnd.trim();
    let normalizedEnd = rawEnd || startValue;
    const startNum = Number(startValue);
    const endNum = Number(rawEnd);
    if (normalizedEnd && Number.isFinite(startNum) && Number.isFinite(endNum) && endNum < startNum) {
      normalizedEnd = startValue;
    }

    onCommit({
      scriptureBook: bookValue,
      scriptureChapter: chapter.trim() || '1',
      scriptureVerseStart: startValue,
      scriptureVerseEnd: normalizedEnd,
      label: `${bookValue} ${chapter.trim() || '1'}:${normalizedEnd !== startValue ? `${startValue}-${normalizedEnd}` : startValue}`,
    });
  };

  return (
    <div className="space-y-2 rounded-lg border border-gray-800 bg-gray-950/60 p-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.2fr)_80px_80px_80px_auto]">
        <input
          value={bookToken}
          onChange={(e) => setBookToken(e.target.value)}
          className="w-full rounded-sm border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-white focus:outline-hidden focus:ring-1 focus:ring-yellow-500"
          placeholder="Gn"
        />
        <input
          value={chapter}
          onChange={(e) => setChapter(e.target.value)}
          className="w-full rounded-sm border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-white focus:outline-hidden focus:ring-1 focus:ring-yellow-500"
          placeholder="Cap"
        />
        <input
          value={verseStart}
          onChange={(e) => setVerseStart(e.target.value)}
          className="w-full rounded-sm border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-white focus:outline-hidden focus:ring-1 focus:ring-yellow-500"
          placeholder="Ver"
        />
        <input
          value={verseEnd}
          onChange={(e) => setVerseEnd(e.target.value)}
          className="w-full rounded-sm border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-white focus:outline-hidden focus:ring-1 focus:ring-yellow-500"
          placeholder="End"
        />
        <button
          type="button"
          onClick={commitRange}
          className="rounded-md bg-yellow-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-yellow-500"
        >
          Ok
        </button>
      </div>

      {(isTanaj || isSefer) && (
        <div className="rounded-md border border-gray-800 bg-gray-900/50">
          <button
            type="button"
            onClick={() => setShowTanajTable(!showTanajTable)}
            className="flex w-full items-center justify-between px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-gray-400 hover:text-white"
          >
            <span>Versos {isTanaj ? 'Tanaj' : 'Sefer'} seleccionados</span>
            {showTanajTable ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {showTanajTable && (
            <div className="overflow-x-auto border-t border-gray-800">
              <table className="w-full min-w-[680px] text-left text-[11px]">
                <thead className="bg-gray-950/60 text-[9px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-2 py-1.5 w-[5%] text-center">v.</th>
                    <th className="px-2 py-1.5 w-[32%]">Hebreo</th>
                    <th className="px-2 py-1.5 w-[22%]">Transliteración</th>
                    <th className="px-2 py-1.5 w-[22%]">Traducción</th>
                    {isTanaj && <th className="px-2 py-1.5 w-[19%]">Fondo slide</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {loadingVerses ? (
                    <tr><td colSpan={isTanaj ? 5 : 4} className="px-2 py-2 text-gray-500">Cargando versos...</td></tr>
                  ) : selectedVerses.length > 0 ? selectedVerses.map((verse) => (
                    <tr key={`${verse.chapter}-${verse.verse}`}>
                      <td className="px-2 py-1.5 align-middle w-[5%]">
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          <span className="text-[10px] font-bold text-white">{verse.verse}</span>
                          <button
                            type="button"
                            onClick={() => onPlayVerse?.(verse.verse)}
                            className="w-5 h-5 rounded-full bg-white/5 hover:bg-yellow-600 text-gray-400 hover:text-white border border-white/10 transition-all flex items-center justify-center cursor-pointer"
                            title={`Ir al verso ${verse.verse}`}
                          >
                            <Play size={9} fill="currentColor" className="ml-px" />
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right text-[#f3c96a]" dir="rtl" dangerouslySetInnerHTML={{ __html: sanitizeSlideHtml(verse.verseNikudSanitized || verse.verseNikud) }} />
                      <td className="px-2 py-1.5 text-sky-200">{verse.transliteration}</td>
                      <td className="px-2 py-1.5 text-gray-300">{verse.translation}</td>
                      {isTanaj && <td className="px-2 py-1.5">
                        <select
                          value={slide.scriptureVerseBackgrounds?.[verse.verse] || 'Principal'}
                          onChange={(e) => onVerseBackgroundChange(verse.verse, e.target.value)}
                          className="w-full rounded-sm border border-gray-700 bg-gray-900 px-1.5 py-1 text-[10px] text-gray-200"
                        >
                          {['Principal', 'Anterior', 'Ignorar', 'No cambiar', ...backgrounds].map((bgOption) => (
                            <option key={bgOption} value={bgOption}>{bgOption.split('/').pop() || bgOption}</option>
                          ))}
                        </select>
                      </td>}
                    </tr>
                  )) : (
                    <tr><td colSpan={isTanaj ? 5 : 4} className="px-2 py-2 text-gray-500">Sin versos para este rango.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
