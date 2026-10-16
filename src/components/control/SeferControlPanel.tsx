import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
import React from 'react';
import { ChevronLeft, ChevronRight, Play, Sliders } from 'lucide-react';
import type { ScriptureNavState } from '../../types/presentation';
import type { SeferReaderState } from '../../hooks/useSeferReader';
import { useSeferControlLogic } from '../../hooks/useSeferControlLogic';
import { sanitizeSlideHtml } from '../../utils/hebrewText';

interface SeferControlPanelProps {
  /** Called whenever a verse should be projected (activate ▶️ or arrow nav while active) */
  onProject: (state: SeferReaderState, command?: 'navigate' | 'next' | 'previous') => void;
  /** Called when projection is stopped */
  onDeactivate?: () => void;
  /** Called when ➕ is pressed — project + add as slide */
  onAddSlide: (state: SeferReaderState, kind?: 'sefer' | 'tanaj') => void;
  /** Restore a previously projected state (when returning to scripture mode) */
  restoredState?: ScriptureNavState | null;
  /** Callback to update font sizes */
  onUpdateFontSizes?: (sizes: { hebrewFontSize: number; combinedTextBaseSize: number }) => void;
  /** Emits the fully resolved verse data for preview */
  onVerseResolved?: (state: SeferReaderState | null) => void;
}

const SeferControlPanel: React.FC<SeferControlPanelProps> = ({
  onProject,
  onDeactivate,
  onAddSlide,
  restoredState,
  onUpdateFontSizes,
  onVerseResolved,
}) => {
  useUiTranslation('control');
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
    showFontSettings,
    setShowFontSettings,
    hebrewFontSize,
    combinedTextBaseSize,
    updateHebrewFontSize,
    updateCombinedTextBaseSize,
    endVerse,
    setEndVerse,
    handleActivate,
    handleActiveRangeChange,
    hasActiveRange,
    handleNext,
    handlePrev,
    handleAddSlide,
    handleVerseSelect,
  } = useSeferControlLogic({
    variant: 'full',
    onProject,
    onDeactivate,
    onAddSlide,
    restoredState,
    onUpdateFontSizes,
  });

  // ----------------------------------------------------------------
  // Emitting resolved verse for preview
  // ----------------------------------------------------------------
  React.useEffect(() => {
    if (onVerseResolved) {
      onVerseResolved(currentVerse);
    }
  }, [currentVerse, onVerseResolved]);

  // ----------------------------------------------------------------
  // Loading / unavailable states
  // ----------------------------------------------------------------
  if (Object.keys(metadata).length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        {translate("control:SeferControlPanel.loadingBiblicalData", "Cargando datos bíblicos...")}</div>
    );
  }

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
            className="control-select flex-2"
          >
            {bookList.map((book) => (
              <option key={book} value={book}>{book}</option>
            ))}
          </select>
          <select
            id="sefer-chapter-select"
            value={selectedChapter}
            onChange={(e) => setSelectedChapter(e.target.value)}
            className="control-select flex-1"
          >
            {chapters.map((ch) => (
              <option key={ch} value={ch}>{ch}</option>
            ))}
          </select>
          <select
            id="sefer-verse-select"
            value={selectedVerse}
            onChange={(e) => {
              if (isActive) {
                handleVerseSelect(e.target.value);
              } else {
                setSelectedVerse(e.target.value);
              }
            }}
            className="control-select flex-1"
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
              title={isActive ? translate("control:SeferControlPanel.stopProjection", "Detener Proyección") : translate("control:SeferControlPanel.project", "Proyectar")}
              className={`control-icon-btn p-2 ${isActive
                ? 'bg-orange-500 text-white hover:bg-orange-600 shadow-[0_0_10px_rgba(249,115,22,0.5)]'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
                } disabled:opacity-40`}
            >
              <Play size={14} className={isActive ? 'fill-current' : ''} />
            </button>

            <button
              type="button"
              onClick={() => setShowFontSettings(!showFontSettings)}
              title={translate("control:SeferControlPanel.adjustFontSizes", "Ajustar tamaños de letra")}
              className={`control-icon-btn p-2 ${showFontSettings
                ? 'bg-yellow-600 text-white'
                : 'control-icon-btn-neutral'
                }`}
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
              className="control-nav-btn flex-1"
            >
              <ChevronLeft data-ui-directional="true" size={14} />  {translate("control:SeferControlPanel.previous", "Anterior")}</button>

            {/* Add slide ➕ */}
            <div className="flex items-center gap-1">
              <button
                id="sefer-add-slide-btn"
                onClick={() => handleAddSlide('sefer')}
                disabled={!currentVerse}
                title={translate("control:SeferControlPanel.presentAndAddAsASeferSlideToThe", "Presentar y añadir como slide Sefer a la presentación actual")}
                className="control-action-btn bg-green-700 hover:bg-green-600"
              >
                <span>+📜</span>
              </button>
              {isActive && hasActiveRange && currentVerse ? (
                <div className="flex items-center gap-1">
                  <select
                    value={currentVerse.verseStart}
                    onChange={(e) => handleActiveRangeChange(e.target.value, currentVerse.verseEnd!)}
                    title={translate("control:SeferControlPanel.firstVerseOfTheProjectedRange", "Versículo inicial del rango proyectado")}
                    className="h-8 rounded-md border border-gray-700 bg-gray-800 px-1.5 text-[10px] font-bold text-gray-200 focus:outline-hidden focus:ring-1 focus:ring-yellow-500 disabled:opacity-40"
                  >
                    {verses
                      .filter((verse) => Number(verse) <= Number(currentVerse.verseEnd!))
                      .map((verse) => (
                        <option key={verse} value={verse}>{verse}</option>
                      ))}
                  </select>
                  <span className="text-gray-400 font-bold text-xs">-</span>
                  <select
                    value={currentVerse.verseEnd}
                    onChange={(e) => handleActiveRangeChange(currentVerse.verseStart!, e.target.value)}
                    title={translate("control:SeferControlPanel.lastVerseOfTheProjectedRange", "Versículo final del rango proyectado")}
                    className="h-8 rounded-md border border-gray-700 bg-gray-800 px-1.5 text-[10px] font-bold text-gray-200 focus:outline-hidden focus:ring-1 focus:ring-yellow-500 disabled:opacity-40"
                  >
                    {verses
                      .filter((verse) => Number(verse) >= Number(currentVerse.verseStart!))
                      .map((verse) => (
                        <option key={verse} value={verse}>{verse}</option>
                      ))}
                  </select>
                </div>
              ) : (
                <select
                  value={endVerse}
                  onChange={(e) => setEndVerse(e.target.value)}
                  disabled={!currentVerse}
                  title={translate("control:SeferControlPanel.optionalLastVerse", "Versículo final opcional")}
                  className="h-8 rounded-md border border-gray-700 bg-gray-800 px-1.5 text-[10px] font-bold text-gray-200 focus:outline-hidden focus:ring-1 focus:ring-yellow-500 disabled:opacity-40"
                >
                  <option value=""></option>
                  {verses
                    .filter((verse) => Number(verse) >= Number(selectedVerse))
                    .map((verse) => (
                      <option key={verse} value={verse}>{verse}</option>
                    ))}
                </select>
              )}
              <button
                id="tanaj-add-slide-btn"
                onClick={() => handleAddSlide('tanaj')}
                disabled={!currentVerse}
                title={translate("control:SeferControlPanel.presentAndAddAsATanajSlideToThe", "Presentar y añadir como slide Tanaj a la presentación actual")}
                className="control-action-btn bg-blue-700 hover:bg-blue-600"
              >
                <span>+📖</span>
              </button>
            </div>

            {/* Next */}
            <button
              id="sefer-next-btn"
              onClick={handleNext}
              disabled={!currentVerse || currentVerse.verseIdx >= currentVerse.totalVerses - 1}
              className="control-nav-btn flex-1"
            >
              {translate("control:SeferControlPanel.next", "Siguiente")} <ChevronRight data-ui-directional="true" size={14} />
            </button>
          </div>


          <div className="flex items-center gap-2">
            {isLoading && <span className="text-[10px] text-gray-500">{translate("control:SeferControlPanel.loading", "Cargando...")}</span>}
            <span className="text-[10px] text-gray-500 font-mono"></span>
          </div>
        </div>

        {/* Font Adjustment Drawer */}
        {showFontSettings && (
          <div className="control-font-drawer">
            <div className="flex items-center justify-between gap-2">
              <span className="control-font-label">{translate("control:SeferControlPanel.hebrew", "Hebreo:")} {hebrewFontSize}{translate("control:SeferControlPanel.px", "px")}</span>
              <input
                type="range"
                min="20"
                max="72"
                value={hebrewFontSize}
                onChange={(e) => {
                  updateHebrewFontSize(Number(e.target.value));
                }}
                className="control-range w-24"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="control-font-label">{translate("control:SeferControlPanel.combinedText", "Texto combinado:")} {combinedTextBaseSize}{translate("control:SeferControlPanel.px", "px")}</span>
              <input
                type="range"
                min="12"
                max="70"
                value={combinedTextBaseSize}
                onChange={(e) => {
                  updateCombinedTextBaseSize(Number(e.target.value));
                }}
                className="control-range w-24"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Current verse display ──────────────────────────────── */}
      <div id="section-current-verse-display" className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {currentVerse ? (
          <div className="rounded-lg bg-gray-800/80 p-2.5">
            {/* Hebrew */}
            <div
              dir={/[\u0590-\u05FF]/.test(currentVerse.verseNikud || '') ? "rtl" : "ltr"}
              lang={/[\u0590-\u05FF]/.test(currentVerse.verseNikud || '') ? 'he' : undefined}
              className={`text-sm leading-relaxed text-[#f3c96a] font-bold ${/[\u0590-\u05FF]/.test(currentVerse.verseNikud || '') ? "text-end" : "text-start"}`}
              style={{ fontFamily: /[\u0590-\u05FF]/.test(currentVerse.verseNikud || '') ? "'Frank Ruhl Libre', 'SBL Hebrew', serif" : 'inherit' }}
              dangerouslySetInnerHTML={{ __html: sanitizeSlideHtml(currentVerse.verseNikudSanitized ?? currentVerse.verseNikud) }}
            />

            {/* Transliteration & Translation in compact format */}
            <div className="flex flex-col gap-1 mt-1.5 pt-1.5 border-t border-gray-800/60 text-xs">
              {currentVerse.transliteration && (
                <p className="text-sky-300 leading-relaxed">
                  {currentVerse.transliteration}
                </p>
              )}
              {currentVerse.translation && (
                <p className="text-gray-300 leading-relaxed">
                  {currentVerse.translation}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs">
            {translate("control:SeferControlPanel.selectAVerse", "Selecciona un versículo")}</div>
        )}
      </div>

    </div>
  );
};

export default SeferControlPanel;

