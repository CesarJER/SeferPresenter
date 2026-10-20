import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
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
  /** Emits the fully resolved verse data for preview */
  onVerseResolved?: (state: SeferReaderState | null) => void;
}

const SeferControlPanelMini: React.FC<SeferControlPanelMiniProps> = ({
  onProject,
  onBoundaryReached,
  restoredState,
  onUpdateFontSizes,
  onVerseResolved,
}) => {
  useUiTranslation('control');
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

  React.useEffect(() => {
    if (onVerseResolved) {
      onVerseResolved(currentVerse);
    }
  }, [currentVerse, onVerseResolved]);

  if (Object.keys(metadata).length === 0) {
    return (
      <div id="section-loading-bible-data" className="flex items-center justify-center h-full text-gray-500 text-sm">
        {translate("control:SeferControlPanelMini.loadingBiblicalData", "Cargando datos bíblicos...")}</div>
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
                title={translate("control:SeferControlPanelMini.adjustFontSizes", "Ajustar tamaños de letra")}
                className={`control-icon-btn p-2 ${showFontSettings
                  ? 'bg-yellow-600 text-white'
                  : 'control-icon-btn-neutral'
                  }`}
              >
                <Sliders size={14} />
              </button>
            )}

            <div className="control-mini-panel">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={!currentVerse}
                  className="control-nav-btn flex-none px-2.5"
                  title={translate("control:SeferControlPanelMini.previousVerse", "Versículo anterior")}
                >
                  <ChevronLeft data-ui-directional="true" size={14} />
                </button>

                <div className="flex-1 flex flex-wrap gap-1">
                  {rangeVerses.length > 0 ? rangeVerses.map((verseNum) => {
                    const active = verseNum === selectedVerse;
                    return (
                      <button
                        key={verseNum}
                        type="button"
                        onClick={() => handleVerseSelect(verseNum, 'navigate')}
                        className={`min-w-8 rounded-sm px-2 py-1 text-[10px] font-bold transition-colors ${active ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                      >
                        {verseNum}
                      </button>
                    );
                  }) : (
                    <span className="text-[10px] text-gray-500">{translate("control:SeferControlPanelMini.noVerses", "Sin versículos")}</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!currentVerse}
                  className="control-nav-btn flex-none px-2.5"
                  title={translate("control:SeferControlPanelMini.nextVerse", "Versículo siguiente")}
                >
                  <ChevronRight data-ui-directional="true" size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {canAdjustFont && showFontSettings && (
          <div id="section-font-adjustments" className="control-font-drawer">
            <div className="flex items-center justify-between gap-2">
              <span className="control-font-label">{translate("control:SeferControlPanelMini.hebrew", "Hebreo:")} {hebrewFontSize}{translate("control:SeferControlPanelMini.px", "px")}</span>
              <input
                type="range"
                min="20"
                max="72"
                value={hebrewFontSize}
                onChange={(e) => updateHebrewFontSize(Number(e.target.value))}
                className="control-range w-24"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="control-font-label">{translate("control:SeferControlPanelMini.combinedText", "Texto combinado:")} {combinedTextBaseSize}{translate("control:SeferControlPanelMini.px", "px")}</span>
              <input
                type="range"
                min="12"
                max="70"
                value={combinedTextBaseSize}
                onChange={(e) => updateCombinedTextBaseSize(Number(e.target.value))}
                className="control-range w-24"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SeferControlPanelMini;
