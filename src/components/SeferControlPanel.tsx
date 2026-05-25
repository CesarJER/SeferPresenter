import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Play, Plus } from 'lucide-react';
import type { SeferReaderState } from '../hooks/useSeferReader';
import { useSeferReader } from '../hooks/useSeferReader';

interface SeferControlPanelProps {
  /** Called whenever a verse should be projected (activate ▶️ or arrow nav while active) */
  onProject: (state: SeferReaderState, command?: 'navigate' | 'next' | 'previous') => void;
  /** Called when ➕ is pressed — project + add as slide */
  onAddSlide: (state: SeferReaderState) => void;
  /** Restore a previously projected state (when returning to scripture mode) */
  restoredState?: SeferReaderState | null;
}

const SeferControlPanel: React.FC<SeferControlPanelProps> = ({
  onProject,
  onAddSlide,
  restoredState,
}) => {
  const didRestoreInitialState = useRef(false);
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

  // When panel mounts and a restoredState exists, activate immediately
  useEffect(() => {
    if (restoredState && currentVerse) {
      // Already active — caller handles projection
    }
  }, []);

  useEffect(() => {
    if (!restoredState || didRestoreInitialState.current) return;
    didRestoreInitialState.current = true;
    restoreState(restoredState);
  }, [restoreState, restoredState]);

  // ----------------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------------
  const handleActivate = () => {
    const state = activate();
    if (state) onProject(state, 'navigate');
  };

  const handleNext = () => {
    const state = goNext();
    if (state && isActive) onProject(state, 'next');
    else if (state) {
      // Not yet active — update selection only
    }
  };

  const handlePrev = () => {
    const state = goPrev();
    if (state && isActive) onProject(state, 'previous');
  };

  const handleAddSlide = () => {
    if (currentVerse) {
      onProject(currentVerse, 'navigate');
      onAddSlide(currentVerse);
    }
  };

  // ----------------------------------------------------------------
  // Loading / unavailable states
  // ----------------------------------------------------------------
  if (typeof __APP_MODE__ !== 'undefined' && __APP_MODE__ === 'singlefile') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center text-gray-400 gap-3">
        <span className="text-4xl">📜</span>
        <p className="text-sm">
          El modo lectura bíblica no está disponible en esta versión.<br />
          Abre <strong>SeferOnline</strong> para leer mientras presentas.
        </p>
      </div>
    );
  }

  if (Object.keys(metadata).length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Cargando datos bíblicos...
      </div>
    );
  }

  const selectClass = "w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-yellow-500 cursor-pointer";
  const positionLabel = currentVerse
    ? `${currentVerse.bookAbbrevEs} ${currentVerse.chapter}:${currentVerse.verse} / ${currentVerse.totalVerses}`
    : '—';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-900 text-white">

      {/* ── Navigation selectors ───────────────────────────────── */}
      <div className="flex-none p-3 border-b border-gray-800 space-y-2">
        {/* Row 1: Book */}
        <select
          id="sefer-book-select"
          value={selectedBook}
          onChange={(e) => setSelectedBook(e.target.value)}
          className={selectClass}
        >
          {bookList.map((book) => (
            <option key={book} value={book}>{book}</option>
          ))}
        </select>

        {/* Row 2: Chapter + Verse */}
        <div className="flex gap-2">
          <select
            id="sefer-chapter-select"
            value={selectedChapter}
            onChange={(e) => setSelectedChapter(e.target.value)}
            className={selectClass}
          >
            {chapters.map((ch) => (
              <option key={ch} value={ch}>Cap. {ch}</option>
            ))}
          </select>
          <select
            id="sefer-verse-select"
            value={selectedVerse}
            onChange={(e) => setSelectedVerse(e.target.value)}
            className={selectClass}
          >
            {verses.map((v) => (
              <option key={v} value={v}>V. {v}</option>
            ))}
          </select>
        </div>

        {/* Row 3: Activate button + status */}
        <div className="flex items-center gap-2">
          <button
            id="sefer-activate-btn"
            onClick={handleActivate}
            disabled={isLoading || !currentVerse}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              isActive
                ? 'bg-yellow-500 text-gray-900 shadow-[0_0_10px_rgba(234,179,8,0.5)]'
                : 'bg-yellow-600/80 text-white hover:bg-yellow-500'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <Play size={12} />
            {isActive ? 'Activo' : 'Proyectar'}
          </button>
          <span className="text-[10px] text-gray-500 font-mono">{positionLabel}</span>
          {isLoading && <span className="text-[10px] text-gray-500">Cargando...</span>}
        </div>
      </div>

      {/* ── Current verse display ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {currentVerse ? (
          <>
            {/* Hebrew */}
            <div className="rounded-lg bg-gray-800/80 p-3">
              <div
                dir="rtl"
                className="text-[1.5rem] leading-[1.9] text-[#f3c96a] font-bold text-right"
                style={{ fontFamily: "'Frank Ruhl Libre', 'SBL Hebrew', serif" }}
                dangerouslySetInnerHTML={{ __html: currentVerse.verseNikud }}
              />
            </div>

            {/* Transliteration */}
            {currentVerse.transliteration && (
              <div className="rounded-lg bg-gray-800/60 p-3">
                <p className="text-[9px] font-bold text-sky-400 uppercase tracking-widest mb-1">Transliteración</p>
                <p className="text-sky-200 text-xs leading-relaxed">{currentVerse.transliteration}</p>
              </div>
            )}

            {/* Translation */}
            {currentVerse.translation && (
              <div className="rounded-lg bg-gray-800/60 p-3">
                <p className="text-[9px] font-bold text-green-400 uppercase tracking-widest mb-1">Traducción</p>
                <p className="text-gray-200 text-xs leading-relaxed">{currentVerse.translation}</p>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs">
            Selecciona un versículo
          </div>
        )}
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
    </div>
  );
};

export default SeferControlPanel;
