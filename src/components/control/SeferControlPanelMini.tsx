import React from 'react';
import { ChevronLeft, ChevronRight, Sliders } from 'lucide-react';
import type { ScriptureNavState } from '../../types/presentation';
import type { SeferReaderState } from '../../hooks/useSeferReader';
import { useSeferControlLogic } from '../../hooks/useSeferControlLogic';

interface SeferControlPanelMiniProps {
  /** Called whenever a verse should be projected (activate or arrow nav while active) */
  onProject: (state: SeferReaderState, command?: 'navigate' | 'next' | 'previous') => void;
  /** Called when navigation hits the start/end of the current Sefer range */
  onBoundaryReached?: (direction: 'next' | 'previous') => void;
  /** Restore a previously projected state (when returning to scripture mode) */
  restoredState?: ScriptureNavState | null;
  /** Callback to update font sizes */
  onUpdateFontSizes?: (sizes: { hebrewFontSize: number; combinedTextBaseSize: number }) => void;
}

const SeferControlPanelMini: React.FC<SeferControlPanelMiniProps> = ({
  onProject,
  onBoundaryReached,
  restoredState,
  onUpdateFontSizes,
}) => {
  const {
    metadata,
    currentVerse,
    selectedVerse,
    rangeVerses,
    showFontSettings,
    setShowFontSettings,
    hebrewFontSize,
    combinedTextBaseSize,
    updateHebrewFontSize,
    updateCombinedTextBaseSize,
    handleVerseSelect,
    handleNext,
    handlePrev,
    canAdjustFont,
  } = useSeferControlLogic({
    variant: 'mini',
    onProject,
    onBoundaryReached,
    restoredState,
    onUpdateFontSizes,
  });

  if (Object.keys(metadata).length === 0) {
    return (
      <div id="section-loading-bible-data" className="flex items-center justify-center h-full text-gray-500 text-sm">
        Cargando datos bíblicos...
      </div>
    );
  }

  return (
    <div id="section-sefer-panel-mini-container" className="flex flex-col h-full overflow-hidden bg-gray-900 text-white">
      <div id="section-nav-selectors" className="flex-none p-3 border-b border-gray-800 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <div className="flex-1 items-center gap-2">
            {canAdjustFont && (
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
            )}

            <div className="rounded-md border border-gray-800 bg-gray-950/60 p-2 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={!currentVerse}
                  className="flex-none flex items-center justify-center gap-1 py-2 px-2.5 rounded-md bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Versículo anterior"
                >
                  <ChevronLeft size={14} />
                </button>

                <div className="flex-1 flex flex-wrap gap-1">
                  {rangeVerses.length > 0 ? rangeVerses.map((verseNum) => {
                    const active = verseNum === selectedVerse;
                    return (
                      <button
                        key={verseNum}
                        type="button"
                        onClick={() => handleVerseSelect(verseNum, 'navigate')}
                        className={`min-w-8 rounded px-2 py-1 text-[10px] font-bold transition-colors ${active ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                      >
                        {verseNum}
                      </button>
                    );
                  }) : (
                    <span className="text-[10px] text-gray-500">Sin versículos</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!currentVerse}
                  className="flex-none flex items-center justify-center gap-1 py-2 px-2.5 rounded-md bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Versículo siguiente"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {canAdjustFont && showFontSettings && (
          <div id="section-font-adjustments" className="p-2.5 bg-gray-800 border border-gray-700 rounded-md space-y-2 text-[10px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-300 font-semibold">Hebreo: {hebrewFontSize}px</span>
              <input
                type="range"
                min="20"
                max="72"
                value={hebrewFontSize}
                onChange={(e) => updateHebrewFontSize(Number(e.target.value))}
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
                onChange={(e) => updateCombinedTextBaseSize(Number(e.target.value))}
                className="w-24 accent-yellow-500 cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SeferControlPanelMini;
