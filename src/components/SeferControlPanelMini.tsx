import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Sliders } from 'lucide-react';
import type { ScriptureNavState } from '../App';
import type { SeferReaderState } from '../hooks/useSeferReader';
import { useSeferReader } from '../hooks/useSeferReader';

interface SeferControlPanelProps {
  /** Called whenever a verse should be projected (activate â–¶ï¸ or arrow nav while active) */
  onProject: (state: SeferReaderState, command?: 'navigate' | 'next' | 'previous') => void;
  /** Called when navigation hits the start/end of the current Sefer range */
  onBoundaryReached?: (direction: 'next' | 'previous') => void;
  /** Restore a previously projected state (when returning to scripture mode) */
  restoredState?: ScriptureNavState | null;
  /** Callback to update font sizes */
  onUpdateFontSizes?: (sizes: { hebrewFontSize: number; combinedTextBaseSize: number }) => void;
}

const SeferControlPanel: React.FC<SeferControlPanelProps> = ({
  onProject,
  onBoundaryReached,
  restoredState,
  onUpdateFontSizes,
}) => {
  // ────────────────────────────────────────────────────────────────
  // States
  // ────────────────────────────────────────────────────────────────
  const lastSyncedStateRef = useRef<string | null>(null);
  const [showFontSettings, setShowFontSettings] = useState(false);

  const [hebrewFontSize, setHebrewFontSize] = useState<number>(() => {
    const val = localStorage.getItem('sefer-presenter-font-hebrew');
    return val ? Number(val) : 42;
  });
  const [combinedTextBaseSize, setCombinedTextBaseSize] = useState<number>(() => {
    const val = localStorage.getItem('sefer-presenter-font-combined');
    return val ? Number(val) : 40;
  });

  const {
    metadata,
    currentVerse,
    isActive,
    selectedVerse,
    goToVerse,
    goNext,
    goPrev,
    restoreState,
    rangeVerses,
  } = useSeferReader();

  // ────────────────────────────────────────────────────────────────
  // Effects
  // ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const restoredHebrewSize = restoredState?.hebrewFontSize;
    if (typeof restoredHebrewSize === 'number' && Number.isFinite(restoredHebrewSize)) {
      const clamped = Math.max(20, Math.min(72, restoredHebrewSize));
      if (clamped !== hebrewFontSize) {
        setHebrewFontSize(clamped);
      }
    }

    const restoredBaseSize = restoredState?.combinedTextBaseSize;
    if (typeof restoredBaseSize === 'number' && Number.isFinite(restoredBaseSize)) {
      const clamped = Math.max(12, Math.min(70, restoredBaseSize));
      if (clamped !== combinedTextBaseSize) {
        setCombinedTextBaseSize(clamped);
      }
    }
  }, [restoredState, combinedTextBaseSize, hebrewFontSize]);

  // Continuous sync from presenter/keyboard updates
  useEffect(() => {
    if (!restoredState) return;
    const stateKey = `${restoredState.bookEs}-${restoredState.chapter}-${restoredState.verse}`;
    if (stateKey !== lastSyncedStateRef.current) {
      lastSyncedStateRef.current = stateKey;
      restoreState(restoredState);
    }
  }, [restoreState, restoredState]);

  // ────────────────────────────────────────────────────────────────
  // Handlers
  // ────────────────────────────────────────────────────────────────
  const hasActiveRange = !!currentVerse?.verseEnd;
  const currentVerseIndex = currentVerse ? rangeVerses.indexOf(currentVerse.verse) : -1;
  const canAdjustFont = restoredState?.scriptureKind !== 'tanaj';

  const handleVerseSelect = useCallback((verse: string, command: 'navigate' | 'next' | 'previous' = 'navigate') => {
    const state = goToVerse(verse);
    if (state) {
      lastSyncedStateRef.current = `${state.bookEs}-${state.chapter}-${state.verse}`;
      onProject(state, command);
    }
  }, [goToVerse, onProject]);

  const handleNext = useCallback(() => {
    if (!currentVerse) return;
    if (!hasActiveRange) {
      const state = goNext();
      if (state) {
        lastSyncedStateRef.current = `${state.bookEs}-${state.chapter}-${state.verse}`;
        onProject(state, 'next');
      }
      return;
    }
    if (currentVerseIndex >= 0 && currentVerseIndex < rangeVerses.length - 1) {
      handleVerseSelect(rangeVerses[currentVerseIndex + 1], 'next');
      return;
    }
    if (isActive && onBoundaryReached) {
      onBoundaryReached('next');
    }
  }, [currentVerse, currentVerseIndex, goNext, handleVerseSelect, hasActiveRange, isActive, onBoundaryReached, onProject, rangeVerses]);

  const handlePrev = useCallback(() => {
    if (!currentVerse) return;
    if (!hasActiveRange) {
      const state = goPrev();
      if (state) {
        lastSyncedStateRef.current = `${state.bookEs}-${state.chapter}-${state.verse}`;
        onProject(state, 'previous');
      }
      return;
    }
    if (currentVerseIndex > 0) {
      handleVerseSelect(rangeVerses[currentVerseIndex - 1], 'previous');
      return;
    }
    if (isActive && onBoundaryReached) {
      onBoundaryReached('previous');
    }
  }, [currentVerse, currentVerseIndex, goPrev, handleVerseSelect, hasActiveRange, isActive, onBoundaryReached, onProject, rangeVerses]);

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

  // ────────────────────────────────────────────────────────────────
  // Loading / unavailable states
  // ────────────────────────────────────────────────────────────────
  if (Object.keys(metadata).length === 0) {
    return (
      <div id="section-loading-bible-data" className="flex items-center justify-center h-full text-gray-500 text-sm">
        Cargando datos bí­blicos...
      </div>
    );
  }

  return (
    <div id="section-sefer-panel-mini-container" className="flex flex-col h-full overflow-hidden bg-gray-900 text-white">
      {/* ── Navigation selectors ───────────────────────────────── */}
      <div id="section-nav-selectors" className="flex-none p-3 border-b border-gray-800 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <div className="flex -1 items-center gap-2">
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
                        onClick={() => {
                          const state = goToVerse(verseNum);
                          if (state) onProject(state, 'navigate');
                        }}
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

        {/* ── Font Adjustment Drawer ───────────────────────────────── */}
        {canAdjustFont && showFontSettings && (
          <div id="section-font-adjustments" className="p-2.5 bg-gray-800 border border-gray-700 rounded-md space-y-2 text-[10px]">
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
      <div id="section-current-verse-display" className="flex-1 overflow-y-auto p-2.5 space-y-2">
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
