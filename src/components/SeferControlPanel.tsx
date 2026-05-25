import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Play, Plus, Sliders } from 'lucide-react';
import type { ScriptureNavState } from '../App';
import type { SeferReaderState } from '../hooks/useSeferReader';
import { useSeferReader } from '../hooks/useSeferReader';

interface SeferControlPanelProps {
  /** Called whenever a verse should be projected (activate ▶️ or arrow nav while active) */
  onProject: (state: SeferReaderState, command?: 'navigate' | 'next' | 'previous') => void;
  /** Called when ➕ is pressed — project + add as slide */
  onAddSlide: (state: SeferReaderState) => void;
  /** Restore a previously projected state (when returning to scripture mode) */
  restoredState?: ScriptureNavState | null;
  /** Callback to update font sizes */
  onUpdateFontSizes?: (sizes: { hebrewFontSize: number; combinedTextBaseSize: number }) => void;
}

const SeferControlPanel: React.FC<SeferControlPanelProps> = ({
  onProject,
  onAddSlide,
  restoredState,
  onUpdateFontSizes,
}) => {
  const lastSyncedStateRef = useRef<string | null>(null);
  const didInitFontSyncRef = useRef(false);
  const [showFontSettings, setShowFontSettings] = useState(false);

  const [hebrewFontSize, setHebrewFontSize] = useState<number>(() => {
    const val = localStorage.getItem('sefer-presenter-font-hebrew');
    return val ? Number(val) : 42;
  });
  const [combinedTextBaseSize, setCombinedTextBaseSize] = useState<number>(() => {
    const val = localStorage.getItem('sefer-presenter-font-combined');
    return val ? Number(val) : 50;
  });

  const {
    metadata,
    currentVerse,
    isLoading,
    isActive,
    bookList,
    chapters,
    verses,
    selectedBook,
    selectedChapter,
    selectedVerse,
    setSelectedBook,
    setSelectedChapter,
    setSelectedVerse,
    activate,
    goNext,
    goPrev,
    restoreState,
  } = useSeferReader();

  useEffect(() => {
    if (!didInitFontSyncRef.current) {
      didInitFontSyncRef.current = true;
      return;
    }
    if (onUpdateFontSizes) {
      onUpdateFontSizes({ hebrewFontSize, combinedTextBaseSize });
    }
  }, [hebrewFontSize, combinedTextBaseSize, onUpdateFontSizes]);

  useEffect(() => {
    const restoredBaseSize = restoredState?.combinedTextBaseSize;
    if (typeof restoredBaseSize === 'number' && Number.isFinite(restoredBaseSize)) {
      const clamped = Math.max(12, Math.min(70, restoredBaseSize));
      if (clamped !== combinedTextBaseSize) {
        setCombinedTextBaseSize(clamped);
      }
    }
  }, [restoredState, combinedTextBaseSize]);

  // Continuous sync from presenter/keyboard updates
  useEffect(() => {
    if (!restoredState) return;
    const stateKey = `${restoredState.bookEs}-${restoredState.chapter}-${restoredState.verse}`;
    if (stateKey !== lastSyncedStateRef.current) {
      lastSyncedStateRef.current = stateKey;
      restoreState(restoredState);
    }
  }, [restoreState, restoredState]);

  // ----------------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------------
  const handleActivate = useCallback(() => {
    const state = activate();
    if (state) {
      lastSyncedStateRef.current = `${state.bookEs}-${state.chapter}-${state.verse}`;
      onProject(state, 'navigate');
    }
  }, [activate, onProject]);

  const handleNext = useCallback(() => {
    const state = goNext();
    if (state) {
      lastSyncedStateRef.current = `${state.bookEs}-${state.chapter}-${state.verse}`;
      if (isActive) onProject(state, 'next');
    }
  }, [goNext, isActive, onProject]);

  const handlePrev = useCallback(() => {
    const state = goPrev();
    if (state) {
      lastSyncedStateRef.current = `${state.bookEs}-${state.chapter}-${state.verse}`;
      if (isActive) onProject(state, 'previous');
    }
  }, [goPrev, isActive, onProject]);

  const handleAddSlide = useCallback(() => {
    if (currentVerse) {
      onProject(currentVerse, 'navigate');
      onAddSlide(currentVerse);
    }
  }, [currentVerse, onProject, onAddSlide]);

  // Keyboard navigation within the control panel window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement).tagName.toUpperCase();
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev]);

  // ----------------------------------------------------------------
  // Loading / unavailable states
  // ----------------------------------------------------------------
  if (Object.keys(metadata).length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Cargando datos bíblicos...
      </div>
    );
  }

  const selectClass = "bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-yellow-500 cursor-pointer min-w-0";

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-900 text-white">

      {/* ── Navigation selectors ───────────────────────────────── */}
      <div className="flex-none p-3 border-b border-gray-800 space-y-2">
        {/* Selector Row: Book, Chapter, Verse side-by-side */}
        <div className="flex gap-1.5">
          <select
            id="sefer-book-select"
            value={selectedBook}
            onChange={(e) => setSelectedBook(e.target.value)}
            className={`${selectClass} flex-[2]`}
          >
            {bookList.map((book) => (
              <option key={book} value={book}>{book}</option>
            ))}
          </select>
          <select
            id="sefer-chapter-select"
            value={selectedChapter}
            onChange={(e) => setSelectedChapter(e.target.value)}
            className={`${selectClass} flex-[1]`}
          >
            {chapters.map((ch) => (
              <option key={ch} value={ch}>{ch}</option>
            ))}
          </select>
          <select
            id="sefer-verse-select"
            value={selectedVerse}
            onChange={(e) => setSelectedVerse(e.target.value)}
            className={`${selectClass} flex-[1]`}
          >
            {verses.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        {/* Action Row: Activate, settings, and page status */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              id="sefer-activate-btn"
              onClick={handleActivate}
              disabled={isLoading || !currentVerse}
              title={isActive ? 'Detener Proyección' : 'Proyectar'}
              className={`flex items-center justify-center p-2 rounded-md transition-all ${isActive
                ? 'bg-orange-500 text-white hover:bg-orange-600 shadow-[0_0_10px_rgba(249,115,22,0.5)]'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
                } disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
            >
              <Play size={14} className={isActive ? 'fill-current' : ''} />
            </button>

            <button
              type="button"
              onClick={() => setShowFontSettings(!showFontSettings)}
              title="Ajustar tamaños de letra"
              className={`flex items-center justify-center p-2 rounded-md transition-all ${showFontSettings
                ? 'bg-yellow-600 text-white'
                : 'bg-gray-800 text-gray-450 hover:bg-gray-705 hover:text-white border border-gray-700'
                } cursor-pointer`}
            >
              <Sliders size={14} />
            </button>
          </div>

          {/* ── Navigation controls ────────────────────────────────── */}
          <div className="flex-none border-t border-gray-800 p-3 flex items-center justify-between gap-2">
            {/* Prev */}
            <button
              id="sefer-prev-btn"
              onClick={handlePrev}
              disabled={!currentVerse || currentVerse.verseIdx === 0}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-md bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} /> Anterior
            </button>

            {/* Add slide ➕ */}
            <button
              id="sefer-add-slide-btn"
              onClick={handleAddSlide}
              disabled={!currentVerse}
              title="Presentar y añadir como slide a la presentación actual"
              className="flex items-center justify-center gap-1 px-3 py-2 rounded-md bg-green-700 hover:bg-green-600 text-white text-xs font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Plus size={14} />
            </button>

            {/* Next */}
            <button
              id="sefer-next-btn"
              onClick={handleNext}
              disabled={!currentVerse || currentVerse.verseIdx >= currentVerse.totalVerses - 1}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-md bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </div>


          <div className="flex items-center gap-2">
            {isLoading && <span className="text-[10px] text-gray-500">Cargando...</span>}
            <span className="text-[10px] text-gray-500 font-mono"></span>
          </div>
        </div>

        {/* Font Adjustment Drawer */}
        {showFontSettings && (
          <div className="p-2.5 bg-gray-800 border border-gray-700 rounded-md space-y-2 text-[10px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-300 font-semibold">Hebreo: {hebrewFontSize}px</span>
              <input
                type="range"
                min="20"
                max="72"
                value={hebrewFontSize}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setHebrewFontSize(val);
                  localStorage.setItem('sefer-presenter-font-hebrew', String(val));
                  if (onUpdateFontSizes) onUpdateFontSizes({ hebrewFontSize: val, combinedTextBaseSize });
                }}
                className="w-24 accent-yellow-500 cursor-pointer"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-300 font-semibold">Texto combinado: {combinedTextBaseSize}px</span>
              <input
                type="range"
                min="12"
                max="70"
                value={combinedTextBaseSize}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  const clamped = Math.max(12, Math.min(70, val));
                  setCombinedTextBaseSize(clamped);
                  localStorage.setItem('sefer-presenter-font-combined', String(clamped));
                  if (onUpdateFontSizes) onUpdateFontSizes({ hebrewFontSize, combinedTextBaseSize: clamped });
                }}
                className="w-24 accent-yellow-500 cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Current verse display ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {currentVerse ? (
          <div className="rounded-lg bg-gray-800/80 p-2.5">
            {/* Hebrew */}
            <div
              dir="rtl"
              className="text-sm leading-relaxed text-[#f3c96a] font-bold text-right"
              style={{ fontFamily: "'Frank Ruhl Libre', 'SBL Hebrew', serif" }}
              dangerouslySetInnerHTML={{ __html: currentVerse.verseNikud }}
            />

            {/* Transliteration & Translation in compact format */}
            <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-gray-700/60 text-xs">
              {currentVerse.transliteration && (
                <p className="text-sky-355 leading-relaxed">
                  <span className="text-sky-400 font-bold mr-1"></span>
                  {currentVerse.transliteration}
                </p>
              )}
              {currentVerse.translation && (
                <p className="text-gray-300 leading-relaxed">
                  <span className="text-green-455 font-bold mr-1"></span>
                  {currentVerse.translation}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs">
            Selecciona un versículo
          </div>
        )}
      </div>

    </div>
  );
};

export default SeferControlPanel;
