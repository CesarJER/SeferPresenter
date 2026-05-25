import React, { useEffect, useState, useRef } from 'react';
import type { Presentation, Slide, VideoState, AppMode, ScriptureNavState } from '../App';
import type { SeferReaderState } from '../hooks/useSeferReader';
import { transliterateText } from '../utils/transliterate';
import { getScriptureChapterVerses, materializeScriptureSlides, parseScriptureTag, scriptureSlideToTag } from '../utils/scriptureLookup';
import { Languages, Save, Download, Upload, ArrowUp, ArrowDown, Trash2, Plus, FileText, Table, Pencil, Play, ChevronDown, ChevronUp, X, Lock, Unlock, Layers, Maximize2, Minimize2, Video, Image as ImageIcon, BookOpen, ScrollText } from 'lucide-react';
import AutoResizeText from './AutoResizeText';
import SeferControlPanel from './SeferControlPanel';
import SeferControlPanelMini from './SeferControlPanelMini';

interface MenuPopupProps {
  presentations: Presentation[];
  backgrounds: string[];
  currentPresentation: Presentation | null;
  currentSlideIndex: number;
  activeBackground: string;
  backgroundLock: boolean;
  onToggleBackgroundLock: (locked: boolean) => void;
  onSelectBackgroundOverride: (bg: string) => void;
  onSave: (p: Presentation) => void | Promise<void>;
  onSelectPresentation: (p: Presentation, slideIdx?: number) => void;
  onSelectSlide: (idx: number) => void;
  onImport: (imported: Presentation[]) => void;
  videoState?: VideoState | null;
  onVideoStateChange?: (state: VideoState | null) => void;
  appMode?: AppMode;
  scriptureState?: ScriptureNavState | null;
  onToggleAppMode?: (mode: AppMode) => void;
  onProjectScripture?: (state: SeferReaderState, command?: 'navigate' | 'next' | 'previous') => void;
  onAddScriptureSlide?: (state: SeferReaderState, kind?: 'sefer' | 'tanaj') => void;
  onBoundaryReached?: (direction: 'next' | 'previous') => void;
  onUpdateScriptureFontSizes?: (sizes: { hebrewFontSize: number; combinedTextBaseSize: number }) => void;
}

const isTitleSlide = (slide: Slide) =>
  slide.id === 'slide-title' || slide.label === 'Título';

const mapScriptureDraftToSlide = (
  draft: Awaited<ReturnType<typeof materializeScriptureSlides>>[number],
): Slide => ({
  id: draft.id,
  label: draft.label,
  lines: draft.lines,
  type: draft.type,
  scriptureBook: draft.scriptureBook,
  scriptureChapter: draft.scriptureChapter,
  scriptureVerseStart: draft.scriptureVerseStart,
  scriptureVerseEnd: draft.scriptureVerseEnd,
});

const parseScriptureDirectiveFromText = async (text: string): Promise<Slide[] | null> => {
  const tag = parseScriptureTag(text);
  if (!tag) return null;
  const materialized = await materializeScriptureSlides(tag);
  return materialized.map(mapScriptureDraftToSlide);
};

interface ScriptureRangeEditorProps {
  slide: Slide;
  backgrounds: string[];
  onVerseBackgroundChange: (verse: string, value: string) => void;
  onCommit: (payload: {
    scriptureBook: string;
    scriptureChapter: string;
    scriptureVerseStart: string;
    scriptureVerseEnd?: string;
    label: string;
  }) => void;
}

const ScriptureRangeEditor: React.FC<ScriptureRangeEditorProps> = ({ slide, backgrounds, onVerseBackgroundChange, onCommit }) => {
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
          className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-yellow-500"
          placeholder="Gn"
        />
        <input
          value={chapter}
          onChange={(e) => setChapter(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-yellow-500"
          placeholder="Cap"
        />
        <input
          value={verseStart}
          onChange={(e) => setVerseStart(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-yellow-500"
          placeholder="Ver"
        />
        <input
          value={verseEnd}
          onChange={(e) => setVerseEnd(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-yellow-500"
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
                    <th className="px-2 py-1.5 w-[34%]">Hebreo</th>
                    <th className="px-2 py-1.5 w-[24%]">Transliteración</th>
                    <th className="px-2 py-1.5 w-[24%]">Traducción</th>
                    {isTanaj && <th className="px-2 py-1.5 w-[18%]">Fondo slide</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {loadingVerses ? (
                    <tr><td colSpan={isTanaj ? 4 : 3} className="px-2 py-2 text-gray-500">Cargando versos...</td></tr>
                  ) : selectedVerses.length > 0 ? selectedVerses.map((verse) => (
                    <tr key={`${verse.chapter}-${verse.verse}`}>
                      <td className="px-2 py-1.5 text-right text-[#f3c96a]" dir="rtl" dangerouslySetInnerHTML={{ __html: verse.verseNikud }} />
                      <td className="px-2 py-1.5 text-sky-200">{verse.transliteration}</td>
                      <td className="px-2 py-1.5 text-gray-300">{verse.translation}</td>
                      {isTanaj && <td className="px-2 py-1.5">
                        <select
                          value={slide.scriptureVerseBackgrounds?.[verse.verse] || 'Principal'}
                          onChange={(e) => onVerseBackgroundChange(verse.verse, e.target.value)}
                          className="w-full rounded border border-gray-700 bg-gray-900 px-1.5 py-1 text-[10px] text-gray-200"
                        >
                          {['Principal', 'Anterior', 'Ignorar', 'No cambiar', ...backgrounds].map((bgOption) => (
                            <option key={bgOption} value={bgOption}>{bgOption.split('/').pop() || bgOption}</option>
                          ))}
                        </select>
                      </td>}
                    </tr>
                  )) : (
                    <tr><td colSpan={isTanaj ? 4 : 3} className="px-2 py-2 text-gray-500">Sin versos para este rango.</td></tr>
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
const parseVideoSlideString = (text: string): {
  videoSrc: string;
  volume: number;
  speed: number;
  loop: boolean;
  startTime?: number;
  endTime?: number
} | null => {
  const clean = text.trim();
  if (!clean.startsWith('[VIDEO') || !clean.endsWith(']')) return null;

  const inner = clean.substring(6, clean.length - 1).trim();
  if (!inner.startsWith('-')) return null;

  const parts = inner.substring(1).split(' - ').map(p => p.trim());
  if (parts.length < 3) return null;

  // Find the boundary between path and parameters.
  // Case A: The path is quoted. The end of the path is the segment that ends with '"'.
  // Case B: The path is not quoted. Scan from right to left for parameters (max 5 parameters: volume, speed, loop, start, end).
  let pathEndIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].endsWith('"')) {
      pathEndIdx = i;
      break;
    }
  }

  let paramStrings: string[];
  let rawSrc = '';

  if (pathEndIdx !== -1) {
    rawSrc = parts.slice(0, pathEndIdx + 1).join(' - ');
    paramStrings = parts.slice(pathEndIdx + 1);
  } else {
    let paramCount = 0;
    for (let i = parts.length - 1; i >= 1; i--) {
      const part = parts[i];
      const isNum = !isNaN(parseFloat(part)) || part === '';
      if (isNum && paramCount < 5) {
        paramCount++;
      } else {
        break;
      }
    }
    const splitIndex = parts.length - paramCount;
    rawSrc = parts.slice(0, splitIndex).join(' - ');
    paramStrings = parts.slice(splitIndex);
  }

  if (rawSrc.startsWith('"') && rawSrc.endsWith('"')) {
    rawSrc = rawSrc.substring(1, rawSrc.length - 1);
  }

  if (!rawSrc) return null;
  if (paramStrings.length < 2) return null;

  const volume = parseFloat(paramStrings[0]);
  const speed = parseFloat(paramStrings[1]);
  if (isNaN(volume) || isNaN(speed)) return null;

  let loop = true;
  let startTime: number | undefined;
  let endTime: number | undefined;

  if (paramStrings.length >= 3) {
    const loopStr = paramStrings[2];
    if (loopStr !== '') {
      loop = parseFloat(loopStr) !== 0;
    }
  }
  if (paramStrings.length >= 4) {
    const startStr = paramStrings[3];
    if (startStr !== '') {
      startTime = parseFloat(startStr);
    }
  }
  if (paramStrings.length >= 5) {
    const endStr = paramStrings[4];
    if (endStr !== '') {
      endTime = parseFloat(endStr);
    }
  }

  return {
    videoSrc: rawSrc,
    volume,
    speed,
    loop,
    startTime: startTime !== undefined && !isNaN(startTime) ? startTime : undefined,
    endTime: endTime !== undefined && !isNaN(endTime) ? endTime : undefined
  };
};

const FormatLegend: React.FC = () => (
  <details className="mt-3 group bg-gray-955/40 border border-gray-800/80 rounded-lg p-1.5 select-none transition-all shadow-inner">
    <summary className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 hover:text-white cursor-pointer px-2 py-1 outline-none">
      <span className="text-yellow-500">❓</span>
      <span>Ver Guía de Formato Rápido (Quick Mode)</span>
    </summary>
    <div className="mt-2 p-2.5 rounded bg-gray-955/70 border border-gray-800/50 text-[11px] text-gray-300 space-y-2.5 font-normal leading-relaxed">
      <ul className="list-disc pl-4 space-y-1.5 text-gray-400">
        <li><strong>Separador de Diapositivas:</strong> Separa las diapositivas con una línea en blanco doble (presiona Enter dos veces).</li>
        <li><strong>Etiquetas / Títulos:</strong> Escribe <code>#Nombre</code> al inicio de una diapositiva para etiquetarla (ej: <code>#Coro</code>). Para el título de la canción, escribe <code>&gt; Título</code> al inicio.</li>
        <li><strong>Diapositiva de Imagen Pura:</strong> Escribe <code>[IMAGE]</code> para ocultar la caja de texto y mostrar la imagen/video a pantalla completa.</li>
        <li><strong>Diapositiva de Video:</strong> Usa el formato:
          <div className="mt-1.5 p-2 bg-gray-955/90 rounded border border-gray-800 text-[11.5px] font-mono text-yellow-500 overflow-x-auto whitespace-pre">
            [VIDEO - "ruta_video" - volumen - velocidad - bucle - inicio - fin]
          </div>
          <p className="mt-1 text-[10px] text-gray-500 leading-normal">
            Ejemplo: <code>[VIDEO - "/backgrounds/Jerusalem/Jerusalem-Video.mp4" - 0.8 - 1.0 - 1 - 0 - 30]</code> (bucle: 1=sí, 0=no; volumen: 0 a 1; velocidad: 0.5 a 2.0; inicio/fin en segundos).
          </p>
        </li>
      </ul>
    </div>
  </details>
);

interface AutoResizeInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  minFontSize?: number;
  maxFontSize?: number;
}

const AutoResizeInput: React.FC<AutoResizeInputProps> = ({
  minFontSize = 8,
  maxFontSize = 12,
  value,
  className = '',
  style,
  ...props
}) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [fontSize, setFontSize] = React.useState<number>(maxFontSize);

  const adjustFontSize = React.useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    input.style.fontSize = `${maxFontSize}px`;
    const containerWidth = input.clientWidth;
    if (containerWidth === 0) return;

    let currentSize = maxFontSize;
    while (currentSize > minFontSize && input.scrollWidth > containerWidth) {
      currentSize -= 0.5;
      input.style.fontSize = `${currentSize}px`;
    }
    setFontSize(currentSize);
  }, [maxFontSize, minFontSize]);

  React.useEffect(() => {
    adjustFontSize();
  }, [value, adjustFontSize]);

  React.useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const observer = new ResizeObserver(() => {
      adjustFontSize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [adjustFontSize]);

  return (
    <input
      ref={inputRef}
      className={className}
      value={value}
      style={{ ...style, fontSize: `${fontSize}px` }}
      {...props}
    />
  );
};

interface AutoResizeTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minFontSize?: number;
  maxFontSize?: number;
}

const AutoResizeTextarea: React.FC<AutoResizeTextareaProps> = ({
  minFontSize = 8,
  maxFontSize = 12,
  value,
  className = '',
  style,
  ...props
}) => {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [fontSize, setFontSize] = React.useState<number>(maxFontSize);

  const adjustFontSize = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.fontSize = `${maxFontSize}px`;
    const containerHeight = textarea.clientHeight;
    const containerWidth = textarea.clientWidth;
    if (containerHeight === 0 || containerWidth === 0) return;

    let currentSize = maxFontSize;
    while (
      currentSize > minFontSize &&
      (textarea.scrollHeight > containerHeight || textarea.scrollWidth > containerWidth)
    ) {
      currentSize -= 0.5;
      textarea.style.fontSize = `${currentSize}px`;
    }
    setFontSize(currentSize);
  }, [maxFontSize, minFontSize]);

  React.useEffect(() => {
    adjustFontSize();
  }, [value, adjustFontSize]);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const observer = new ResizeObserver(() => {
      adjustFontSize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [adjustFontSize]);

  return (
    <textarea
      ref={textareaRef}
      className={className}
      value={value}
      style={{ ...style, fontSize: `${fontSize}px`, overflow: 'hidden' }}
      {...props}
    />
  );
};

interface CustomSearchSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
  className?: string;
  dropdownWidthClass?: string;
  openDirection?: 'up' | 'down';
}

const CustomSearchSelect: React.FC<CustomSearchSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Seleccionar...',
  className = '',
  dropdownWidthClass = 'w-full',
  openDirection = 'down'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clear search and focus input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      const timer = setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const selectedOption = options.find(opt => opt.value === value);

  const filtered = options.filter(opt =>
    opt.label.toLowerCase().includes(search.toLowerCase()) ||
    opt.value.toLowerCase().includes(search.toLowerCase())
  );

  const directionClass = openDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Select Box Trigger */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white hover:bg-gray-800 focus:ring-1 focus:ring-yellow-500 cursor-pointer select-none"
      >
        <span className={selectedOption ? 'text-white' : 'text-gray-500 font-medium'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span className="text-gray-400 text-xs ml-2 select-none pointer-events-none">▼</span>
      </div>

      {/* Dropdown container */}
      {isOpen && (
        <div className={`absolute left-0 z-[9999] rounded-md border border-gray-700 bg-gray-950/95 backdrop-blur-md shadow-2xl flex flex-col p-1.5 gap-1.5 ${directionClass} ${dropdownWidthClass}`}>
          {/* Search box inside dropdown */}
          <div className="relative flex items-center bg-gray-900 border border-gray-750 rounded px-2.5 py-1.5">
            <input
              ref={searchInputRef}
              type="text"
              className="w-full bg-transparent border-none outline-none text-xs text-white placeholder-gray-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              onClick={(e) => e.stopPropagation()} // Prevent clicking search from closing dropdown
            />
            {search && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSearch('');
                  if (searchInputRef.current) {
                    searchInputRef.current.focus();
                  }
                }}
                className="text-gray-500 hover:text-white text-xs px-1 select-none cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Option items list */}
          <div className="max-h-[12rem] overflow-y-auto divide-y divide-gray-900 custom-scrollbar flex flex-col">
            {filtered.length > 0 ? (
              filtered.map(opt => (
                <div
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`px-3 py-2 text-xs text-gray-200 hover:bg-yellow-600 hover:text-white transition-colors cursor-pointer rounded-sm ${opt.value === value ? 'bg-yellow-600/20 text-yellow-500 border-l-2 border-yellow-500 font-bold' : ''
                    }`}
                >
                  {opt.label}
                </div>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-gray-500 text-center">
                Sin resultados
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};


const MenuPopup: React.FC<MenuPopupProps> = ({
  presentations,
  backgrounds,
  currentPresentation,
  currentSlideIndex,
  activeBackground,
  backgroundLock,
  onToggleBackgroundLock,
  onSelectBackgroundOverride,
  onSave,
  onSelectPresentation,
  onSelectSlide,
  onImport,
  videoState = null,
  onVideoStateChange = () => { },
  appMode = 'slides',
  scriptureState = null,
  onToggleAppMode = () => { },
  onProjectScripture = () => { },
  onAddScriptureSlide = () => { },
  onBoundaryReached = () => { },
  onUpdateScriptureFontSizes = () => { }
}) => {
  const activeSlide = currentPresentation && currentSlideIndex >= 0 && currentSlideIndex < currentPresentation.slides.length
    ? currentPresentation.slides[currentSlideIndex]
    : null;
  const isActiveScriptureSlide = !!activeSlide && (activeSlide.type === 'sefer' || activeSlide.type === 'tanaj' || !!activeSlide.scriptureBook);

  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [bg, setBg] = useState('');

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const [mode, setMode] = useState<'standard' | 'trilingual'>('standard');
  const [fontScale, setFontScale] = useState(1);
  const [standardText, setStandardText] = useState('');
  const [hebText, setHebText] = useState('');
  const [transText, setTransText] = useState('');
  const [traText, setTraText] = useState('');

  // Estados reactivos para la gestión de diapositivas del editor visual
  const [slides, setSlides] = useState<Slide[]>([]);
  const [isTableMode, setIsTableMode] = useState(true);

  // NUEVOS estados para visor/reproducción reestructurado
  const [editorMode, setEditorMode] = useState<'list' | 'edit'>('list');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');

  // Local video state for scrubbing (prevents slider fighting telemetry)
  const [localTime, setLocalTime] = useState<number>(0);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);

  // Store loaded durations of videos to clamp row-level duration editor inputs
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>({});
  const loadedPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const videoPaths = new Set<string>();
    slides.forEach(slide => {
      if (slide.type === 'video' && slide.videoSrc) {
        videoPaths.add(slide.videoSrc);
      }
    });
    backgrounds.forEach(bg => {
      if (bg.match(/\.(mp4|webm)$/i)) {
        videoPaths.add(bg);
      }
    });

    const toLoad = Array.from(videoPaths).filter(src => !loadedPathsRef.current.has(src));
    if (toLoad.length === 0) return;

    toLoad.forEach(src => loadedPathsRef.current.add(src));

    const loadVideoDuration = (src: string): Promise<number> => {
      return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = src;
        video.onloadedmetadata = () => {
          resolve(video.duration);
        };
        video.onerror = () => {
          resolve(0);
        };
        setTimeout(() => {
          resolve(0);
        }, 5000);
      });
    };

    Promise.all(
      toLoad.map(async (src) => {
        const duration = await loadVideoDuration(src);
        return { src, duration };
      })
    ).then((results) => {
      setVideoDurations(prev => {
        const next = { ...prev };
        results.forEach(({ src, duration }) => {
          if (duration > 0) {
            next[src] = duration;
          }
        });
        return next;
      });
    });
  }, [slides, backgrounds]);

  useEffect(() => {
    console.log("[MenuPopup] localTime useEffect - videoState currentTime:", videoState?.currentTime, "activeSlideId:", activeSlide?.id, "isScrubbing:", isScrubbing);
    if (!isScrubbing) {
      if (videoState) {
        setLocalTime(videoState.currentTime);
      } else {
        setLocalTime(activeSlide?.videoStart ?? 0);
      }
    }
  }, [videoState?.currentTime, activeSlide?.id, isScrubbing]);

  useEffect(() => {
    if (!isScrubbing) return;
    const handleRelease = () => {
      setIsScrubbing(false);
    };
    window.addEventListener('mouseup', handleRelease);
    window.addEventListener('touchend', handleRelease);
    return () => {
      window.removeEventListener('mouseup', handleRelease);
      window.removeEventListener('touchend', handleRelease);
    };
  }, [isScrubbing]);

  const handleNew = () => {
    setId(Date.now().toString());
    setTitle('');
    setBg(backgrounds[0] || '');
    setMode('standard');
    setFontScale(1);
    setStandardText('');
    setHebText('');
    setTransText('');
    setTraText('');
    setSlides([
      { id: 'slide-title', label: 'Título', lines: [''] }
    ]);
    setIsTableMode(true);
  };

  const handleStartEditing = (p: Presentation) => {
    setEditorMode('edit');
    setId(p.id);
    setTitle(p.title);
    setBg(p.background);
    setMode(p.mode);
    setFontScale(p.fontScale ?? 1);
    setSlides(p.slides);
    setIsTableMode(true);

    const contentSlides = p.slides.filter(slide => !isTitleSlide(slide));
    const titleSlide = p.slides.find(isTitleSlide);

    // Pre-computación para modo estándar
    const titleLine = titleSlide?.lines[0];
    const titleBlock = titleSlide ? `> ${titleLine ?? ''}` : '';
    const parts = [
      titleBlock,
      ...contentSlides.map(slide => (slide.label ? `#${slide.label}\n` : '') + (slide.lines[0] || ''))
    ].filter(Boolean);
    setStandardText(parts.join('\n\n'));

    // Pre-computación para modo trilingüe
    const titleLines = titleSlide?.lines ?? ['', '', ''];
    const buildTitleBlock = (value: string) => (value.trim() ? `> ${value}` : '');

    setHebText(
      [buildTitleBlock(titleLines[0] || ''), ...contentSlides.map(slide => (slide.label ? `#${slide.label}\n` : '') + (slide.lines[0] || ''))]
        .filter(Boolean)
        .join('\n\n')
    );
    setTransText(
      [buildTitleBlock(titleLines[1] || ''), ...contentSlides.map(slide => slide.lines[1] || '')]
        .filter(Boolean)
        .join('\n\n')
    );
    setTraText(
      [buildTitleBlock(titleLines[2] || ''), ...contentSlides.map(slide => slide.lines[2] || '')]
        .filter(Boolean)
        .join('\n\n')
    );
  };

  const handleStartEditingNew = () => {
    setEditorMode('edit');
    setId(Date.now().toString());
    setTitle('');
    setBg(backgrounds[0] || '');
    setMode('standard');
    setFontScale(1);
    setStandardText('');
    setHebText('');
    setTransText('');
    setTraText('');
    setSlides([
      { id: 'slide-title', label: 'Título', lines: [''] }
    ]);
    setIsTableMode(true);
  };

  const handleExport = () => {
    try {
      const dataStr = JSON.stringify(presentations, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

      const exportFileDefaultName = 'sefer_presenter_presentations.json';

      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
    } catch (err) {
      alert('Error al exportar las presentaciones: ' + (err as Error).message);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!Array.isArray(parsed)) {
          throw new Error('El archivo JSON debe contener una lista (array) de presentaciones.');
        }

        // Validacion basica
        for (const p of parsed) {
          if (!p.id || !p.title || !Array.isArray(p.slides)) {
            throw new Error('Formato de presentación inválido. Cada elemento debe tener "id", "title" y un array "slides".');
          }
        }

        if (window.confirm(`¿Estás seguro de que deseas importar ${parsed.length} presentaciones? Esto reemplazará tu lista actual.`)) {
          onImport(parsed);
        }
      } catch (err) {
        alert('Error al importar: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  useEffect(() => {
    if (editorMode === 'edit') return; // Preservar estado si el operador está editando activamente

    if (!currentPresentation) {
      handleNew();
      return;
    }

    setId(currentPresentation.id);
    setTitle(currentPresentation.title);
    setBg(currentPresentation.background);
    setMode(currentPresentation.mode);
    setFontScale(currentPresentation.fontScale ?? 1);
    setSlides(currentPresentation.slides);
    setIsTableMode(true);

    const contentSlides = currentPresentation.slides.filter(slide => !isTitleSlide(slide));

    // Pre-computación para modo estándar
    const titleSlide = currentPresentation.slides.find(isTitleSlide);
    const titleLine = titleSlide?.lines[0];
    const titleBlock = titleSlide ? `> ${titleLine ?? ''}` : '';

    const parts = [
      titleBlock,
      ...contentSlides.map(slide => (slide.label ? `#${slide.label}\n` : '') + (slide.lines[0] || ''))
    ].filter(Boolean);
    setStandardText(parts.join('\n\n'));

    // Pre-computación para modo trilingüe
    const titleLines = titleSlide?.lines ?? ['', '', ''];
    const buildTitleBlock = (value: string) => (value.trim() ? `> ${value}` : '');

    setHebText(
      [buildTitleBlock(titleLines[0] || ''), ...contentSlides.map(slide => (slide.label ? `#${slide.label}\n` : '') + (slide.lines[0] || ''))]
        .filter(Boolean)
        .join('\n\n')
    );
    setTransText(
      [buildTitleBlock(titleLines[1] || ''), ...contentSlides.map(slide => slide.lines[1] || '')]
        .filter(Boolean)
        .join('\n\n')
    );
    setTraText(
      [buildTitleBlock(titleLines[2] || ''), ...contentSlides.map(slide => slide.lines[2] || '')]
        .filter(Boolean)
        .join('\n\n')
    );
  }, [currentPresentation, backgrounds, editorMode]);

  const getStandardTextFromSlides = (slidesList: Slide[]): string => {
    const contentSlides = slidesList.filter(slide => !isTitleSlide(slide));
    const titleSlide = slidesList.find(isTitleSlide);
    const titleLine = titleSlide?.lines[0];
    const titleBlock = titleSlide ? `> ${titleLine ?? ''}` : '';

    const parts = [
      titleBlock,
      ...contentSlides.map(slide => {
        const tag = scriptureSlideToTag(slide);
        const content = tag || (slide.lines[0] || '');
        return (slide.label ? `#${slide.label}\n` : '') + content;
      })
    ].filter(Boolean);

    return parts.join('\n\n');
  };

  const getTrilingualTextFromSlides = (slidesList: Slide[], index: number): string => {
    const contentSlides = slidesList.filter(slide => !isTitleSlide(slide));
    const titleSlide = slidesList.find(isTitleSlide);
    const titleLine = titleSlide?.lines[index] ?? '';
    const titleBlock = titleLine.trim() || titleSlide ? `> ${titleLine}` : '';

    const parts = [
      titleBlock,
      ...contentSlides.map(slide => {
        const tag = scriptureSlideToTag(slide);
        const content = tag && index === 0 ? tag : (slide.lines[index] || '');
        return (index === 0 && slide.label ? `#${slide.label}\n` : '') + content;
      })
    ].filter(Boolean);

    return parts.join('\n\n');
  };

  const toggleEditMode = async () => {
    if (isTableMode) {
      // De Tabla a Texto Rápido:
      if (mode === 'standard') {
        setStandardText(getStandardTextFromSlides(slides));
      } else {
        setHebText(getTrilingualTextFromSlides(slides, 0));
        setTransText(getTrilingualTextFromSlides(slides, 1));
        setTraText(getTrilingualTextFromSlides(slides, 2));
      }
      setIsTableMode(false);
    } else {
      // De Texto Rápido a Tabla:
      const parsed = await buildSlidesForSave();
      const merged = parsed.slides.map((pSlide, idx) => {
        const existing = slides[idx] || slides.find(s => s.id === pSlide.id);
        return {
          ...pSlide,
          background: existing?.background || pSlide.background
        };
      });
      setSlides(merged);
      setMode(parsed.mode);
      setIsTableMode(true);
    }
  };

  const handleModeChange = async (newMode: 'standard' | 'trilingual') => {
    if (newMode === mode) return;

    setMode(newMode);

    if (isTableMode) {
      const newSlides = slides.map(slide => {
        if (newMode === 'trilingual') {
          const fallbackVal = isTitleSlide(slide) ? '>-' : '-';
          const l1 = slide.lines[1] !== undefined ? slide.lines[1] : fallbackVal;
          const l2 = slide.lines[2] !== undefined ? slide.lines[2] : fallbackVal;
          return {
            ...slide,
            lines: [slide.lines[0] || '', l1, l2]
          };
        } else {
          return {
            ...slide,
            lines: [slide.lines[0] || '']
          };
        }
      });
      setSlides(newSlides);
    } else {
      const parsed = await buildSlidesForSave();
      if (newMode === 'trilingual') {
        const mapped = parsed.slides.map(slide => {
          const fallbackVal = isTitleSlide(slide) ? '>-' : '-';
          if (slide.type === 'tanaj' || slide.type === 'sefer' || slide.scriptureBook) {
            return slide;
          }
          return {
            ...slide,
            lines: [slide.lines[0] || '', slide.lines[1] || fallbackVal, slide.lines[2] || fallbackVal]
          };
        });
        setSlides(mapped);
        setHebText(getTrilingualTextFromSlides(mapped, 0));
        setTransText(getTrilingualTextFromSlides(mapped, 1));
        setTraText(getTrilingualTextFromSlides(mapped, 2));
      } else {
        const mapped = parsed.slides.map(slide => ({
          ...slide,
          lines: [scriptureSlideToTag(slide) || slide.lines[0] || '']
        }));
        setSlides(mapped);
        setStandardText(getStandardTextFromSlides(mapped));
      }
    }
  };

  const handleAddSlide = () => {
    const newId = `slide-${Date.now()}`;
    const newLabel = (slides.length).toString();
    const newSlide: Slide = { id: newId, label: newLabel, lines: [] };
    const fallbackVal = isTitleSlide(newSlide) ? '>-' : '-';
    newSlide.lines = mode === 'standard' ? [''] : ['', fallbackVal, fallbackVal];
    setSlides([...slides, newSlide]);
  };

  const handleAddImageSlide = () => {
    const newId = `slide-${Date.now()}`;
    const newLabel = (slides.length).toString();
    const newSlide: Slide = { id: newId, label: newLabel, lines: [] };
    const fallbackVal = isTitleSlide(newSlide) ? '>-' : '-';
    newSlide.lines = mode === 'standard' ? ['[IMAGE]'] : ['[IMAGE]', fallbackVal, fallbackVal];
    setSlides([...slides, newSlide]);
  };

  const handleAddVideoSlide = () => {
    const newId = `slide-${Date.now()}`;
    const newLabel = (slides.length).toString();
    const newSlide: Slide = {
      id: newId,
      label: newLabel,
      lines: [],
      type: 'video' as const,
      videoSrc: '',
      videoVolume: 0.8,
      videoSpeed: 1.0,
      videoLoop: true
    };
    const fallbackVal = isTitleSlide(newSlide) ? '>-' : '-';
    newSlide.lines = mode === 'standard'
      ? ['[VIDEO - "" - 0.8 - 1.0 - 1]']
      : ['[VIDEO - "" - 0.8 - 1.0 - 1]', fallbackVal, fallbackVal];

    setSlides([...slides, newSlide]);
  };

  const handleChangeSlideType = (idx: number, newType: 'text' | 'video' | 'image' | 'tanaj' | 'sefer') => {
    const updated = [...slides];
    const slide = { ...updated[idx] };

    if (newType === 'text') {
      delete slide.type;
      delete slide.videoSrc;
      delete slide.videoVolume;
      delete slide.videoSpeed;
      delete slide.videoStart;
      delete slide.videoEnd;
      delete slide.scriptureBook;
      delete slide.scriptureChapter;
      delete slide.scriptureVerseStart;
      delete slide.scriptureVerseEnd;

      const cleanLine = (l: string) => {
        if (l.trim() === '[IMAGE]' || l.trim().startsWith('[VIDEO')) return '';
        return l;
      };
      slide.lines = slide.lines.map(cleanLine);
    } else if (newType === 'image') {
      delete slide.type;
      delete slide.videoSrc;
      delete slide.videoVolume;
      delete slide.videoSpeed;
      delete slide.videoStart;
      delete slide.videoEnd;
      delete slide.scriptureBook;
      delete slide.scriptureChapter;
      delete slide.scriptureVerseStart;
      delete slide.scriptureVerseEnd;

      slide.lines = slide.lines.map(() => '[IMAGE]');
      if (slide.lines.length === 0) {
        slide.lines = ['[IMAGE]'];
      }
    } else if (newType === 'video') {
      slide.type = 'video';
      slide.videoSrc = slide.videoSrc || '';
      slide.videoVolume = slide.videoVolume ?? 0.8;
      slide.videoSpeed = slide.videoSpeed ?? 1.0;
      slide.videoLoop = slide.videoLoop ?? true;
      delete slide.scriptureBook;
      delete slide.scriptureChapter;
      delete slide.scriptureVerseStart;
      delete slide.scriptureVerseEnd;

      const startStr = slide.videoStart !== undefined ? slide.videoStart : '';
      const endStr = slide.videoEnd !== undefined ? slide.videoEnd : '';
      const loopStr = slide.videoLoop !== false ? '1' : '0';
      const parts = [
        'VIDEO',
        `"${slide.videoSrc}"`,
        slide.videoVolume.toString(),
        slide.videoSpeed.toString(),
        loopStr,
        startStr.toString(),
        endStr.toString()
      ];
      while (parts.length > 5 && parts[parts.length - 1] === '') {
        parts.pop();
      }
      slide.lines = [`[${parts.join(' - ')}]`].concat(slide.lines.slice(1).map(() => ''));
    } else if (newType === 'tanaj' || newType === 'sefer') {
      slide.type = newType;
      if (slide.scriptureBook && slide.scriptureChapter && slide.scriptureVerseStart) {
        slide.scriptureVerseEnd = newType === 'sefer' ? (slide.scriptureVerseEnd || slide.scriptureVerseStart) : (slide.scriptureVerseStart);
      }
    }

    updated[idx] = slide;
    setSlides(updated);
  };

  const handleUpdateVideoParams = (
    idx: number,
    params: { videoSrc?: string; volume?: number; speed?: number; loop?: boolean; startTime?: number; endTime?: number }
  ) => {
    const updated = [...slides];
    const slide = { ...updated[idx] };

    if (slide.type === 'video') {
      if ('videoSrc' in params) slide.videoSrc = params.videoSrc;
      if ('volume' in params) slide.videoVolume = params.volume;
      if ('speed' in params) slide.videoSpeed = params.speed;
      if ('loop' in params) slide.videoLoop = params.loop;
      if ('startTime' in params) slide.videoStart = params.startTime;
      if ('endTime' in params) slide.videoEnd = params.endTime;

      const startVal = slide.videoStart !== undefined && !isNaN(slide.videoStart) ? slide.videoStart : '';
      const endVal = slide.videoEnd !== undefined && !isNaN(slide.videoEnd) ? slide.videoEnd : '';
      const loopStr = slide.videoLoop !== false ? '1' : '0';
      const parts = [
        'VIDEO',
        `"${slide.videoSrc || ''}"`,
        (slide.videoVolume ?? 0.8).toString(),
        (slide.videoSpeed ?? 1.0).toString(),
        loopStr,
        startVal.toString(),
        endVal.toString()
      ];
      while (parts.length > 5 && parts[parts.length - 1] === '') {
        parts.pop();
      }
      slide.lines = [`[${parts.join(' - ')}]`].concat(slide.lines.slice(1).map(() => ''));
    }

    updated[idx] = slide;
    setSlides(updated);
  };

  const handleDeleteSlide = (idx: number) => {
    if (idx === 0) return; // Portada es indestructible
    const updated = slides.filter((_, i) => i !== idx);
    setSlides(updated);
  };

  const handleMoveUp = (idx: number) => {
    if (idx <= 1) return; // Portada fija, y la primera diapositiva de contenido no puede ir sobre portada
    const updated = [...slides];
    const temp = updated[idx];
    updated[idx] = updated[idx - 1];
    updated[idx - 1] = temp;
    setSlides(updated);
  };

  const handleMoveDown = (idx: number) => {
    if (idx === 0 || idx === slides.length - 1) return; // Portada fija, y la última no puede bajar más
    const updated = [...slides];
    const temp = updated[idx];
    updated[idx] = updated[idx + 1];
    updated[idx + 1] = temp;
    setSlides(updated);
  };

  const handleUpdateLabel = (idx: number, newLabel: string) => {
    const updated = [...slides];
    updated[idx] = { ...updated[idx], label: newLabel };
    setSlides(updated);
  };

  const handleUpdateScriptureSlide = (
    idx: number,
    payload: {
      scriptureBook: string;
      scriptureChapter: string;
      scriptureVerseStart: string;
      scriptureVerseEnd?: string;
      label: string;
    }
  ) => {
    const updated = [...slides];
    const slide = { ...updated[idx] };
    const nextKind = slide.type === 'tanaj' ? 'tanaj' : 'sefer';
    slide.type = nextKind;
    slide.scriptureBook = payload.scriptureBook;
    slide.scriptureChapter = payload.scriptureChapter;
    slide.scriptureVerseStart = payload.scriptureVerseStart;
    slide.scriptureVerseEnd = payload.scriptureVerseEnd || payload.scriptureVerseStart;
    slide.label = payload.label;
    updated[idx] = slide;
    setSlides(updated);
  };

  const handleUpdateScriptureVerseBackground = (idx: number, verse: string, bgValue: string) => {
    const updated = [...slides];
    const slide = { ...updated[idx] };
    const nextBackgrounds = { ...(slide.scriptureVerseBackgrounds ?? {}) };
    if (!bgValue || bgValue === 'Principal') {
      delete nextBackgrounds[verse];
    } else {
      nextBackgrounds[verse] = bgValue;
    }
    slide.scriptureVerseBackgrounds = nextBackgrounds;
    updated[idx] = slide;
    setSlides(updated);
  };

  const handleUpdateLine = (slideIdx: number, lineIdx: number, textValue: string) => {
    const updated = [...slides];
    const newLines = [...updated[slideIdx].lines];
    newLines[lineIdx] = textValue;
    updated[slideIdx] = { ...updated[slideIdx], lines: newLines };
    setSlides(updated);
  };

  const handleUpdateSlideBg = (idx: number, bgValue: string) => {
    const updated = [...slides];
    updated[idx] = { ...updated[idx], background: bgValue };
    setSlides(updated);
  };

  const handleMovePresentationUp = (idx: number) => {
    if (idx <= 0) return;
    const updated = [...presentations];
    const temp = updated[idx];
    updated[idx] = updated[idx - 1];
    updated[idx - 1] = temp;
    onImport(updated);
  };

  const handleMovePresentationDown = (idx: number) => {
    if (idx >= presentations.length - 1) return;
    const updated = [...presentations];
    const temp = updated[idx];
    updated[idx] = updated[idx + 1];
    updated[idx + 1] = temp;
    onImport(updated);
  };

  const handleDeletePresentation = (idx: number) => {
    const p = presentations[idx];
    if (window.confirm(`¿Estás seguro de que deseas eliminar permanentemente la presentación "${p.title}"?`)) {
      const updated = presentations.filter((_, i) => i !== idx);
      onImport(updated);
    }
  };

  const handleSortPresentationsAZ = () => {
    const sorted = [...presentations].sort((a, b) => a.title.localeCompare(b.title));
    onImport(sorted);
  };

  const handleTransliterateRow = (idx: number) => {
    const updated = [...slides];
    const hebLine = updated[idx].lines[0] || '';
    const newLines = [...updated[idx].lines];
    newLines[1] = transliterateText(hebLine);
    updated[idx] = { ...updated[idx], lines: newLines };
    setSlides(updated);
  };

  const handleTransliterateAllTable = () => {
    const updated = slides.map(slide => {
      const hebLine = slide.lines[0] || '';
      const newLines = [...slide.lines];
      newLines[1] = transliterateText(hebLine);
      return { ...slide, lines: newLines };
    });
    setSlides(updated);
  };

  const handleTransliterate = () => {
    const paragraphs = hebText.split(/\n\n+/);
    const newTrans = paragraphs.map(p => {
      const lines = p.split('\n');
      if (lines[0].startsWith('#')) {
        return lines.slice(1).map(l => transliterateText(l)).join('\n');
      }
      return lines.map(l => transliterateText(l)).join('\n');
    }).join('\n\n');
    setTransText(newTrans);
  };

  const parseStandardSlides = (): Slide[] => {
    const parts = standardText.split(/\n\n+/);
    const titleLines: string[] = [];
    const contentParts: string[] = [];
    let hasTitleMarker = false;

    parts.forEach(part => {
      const lines = part.split('\n');
      const hasMarker = lines.some(line => line.startsWith('>'));
      if (hasMarker) hasTitleMarker = true;
      const titleMarkers = lines.filter(line => line.startsWith('>')).map(line => line.substring(1).trim());
      const con = lines.filter(line => !line.startsWith('>')).join('\n');
      if (titleMarkers.length > 0) titleLines.push(...titleMarkers);
      if (con.trim()) contentParts.push(con);
    });

    const titleSlide: Slide = {
      id: 'slide-title',
      label: 'Título',
      lines: [hasTitleMarker ? titleLines.join('\n') : (titleLines.join('\n') || title.trim())]
    };

    let autoId = 1;
    const parsed = contentParts
      .map((part, idx) => {
        const lines = part.split('\n');
        let label: string;
        let content = part;
        if (lines[0].startsWith('#')) {
          label = lines[0].substring(1).trim();
          content = lines.slice(1).join('\n');
        } else {
          label = autoId.toString();
          autoId++;
        }

        const videoData = parseVideoSlideString(content);
        if (videoData) {
          return {
            id: `slide-${idx}`,
            label,
            lines: [content.trim()],
            type: 'video' as const,
            videoSrc: videoData.videoSrc,
            videoVolume: videoData.volume,
            videoSpeed: videoData.speed,
            videoLoop: videoData.loop,
            videoStart: videoData.startTime,
            videoEnd: videoData.endTime
          };
        }

        return { id: `slide-${idx}`, label, lines: [content.trim()] };
      })
      .filter(slide => slide.lines[0].length > 0);

    return [titleSlide, ...parsed];
  };

  const parseTrilingualSlides = (): Slide[] => {
    const getTitleAndContent = (text: string) => {
      const titleLines: string[] = [];
      const content: string[] = [];

      text.split(/\n\n+/).forEach(part => {
        const lines = part.split('\n');
        const titleMarkers = lines.filter(line => line.startsWith('>')).map(line => line.substring(1).trim());
        const body = lines.filter(line => !line.startsWith('>')).join('\n');
        if (titleMarkers.length > 0) titleLines.push(...titleMarkers);
        if (body.trim()) content.push(body);
      });

      return { title: titleLines.join('\n'), content };
    };

    const hebData = getTitleAndContent(hebText);
    const transData = getTitleAndContent(transText);
    const traData = getTitleAndContent(traText);
    const maxLen = Math.max(hebData.content.length, transData.content.length, traData.content.length);

    const rows = Array.from({ length: maxLen }, (_, i) => ({
      hebrew: hebData.content[i] || '',
      transliteration: transData.content[i] || '',
      translation: traData.content[i] || ''
    }));

    const titleSlide: Slide = {
      id: 'slide-title',
      label: 'Título',
      lines: [hebData.title, transData.title, traData.title].map(v => v || '')
    };

    let autoId = 1;
    const parsed = rows
      .map((row, idx) => {
        const lines = row.hebrew.split('\n');
        let label: string;
        let contentHeb = row.hebrew;

        if (lines[0].startsWith('#')) {
          label = lines[0].substring(1).trim();
          contentHeb = lines.slice(1).join('\n');
        } else {
          label = autoId.toString();
          autoId++;
        }

        const videoData = parseVideoSlideString(contentHeb) || parseVideoSlideString(row.transliteration) || parseVideoSlideString(row.translation);
        if (videoData) {
          return {
            id: `slide-${idx}`,
            label,
            lines: [contentHeb.trim(), row.transliteration.trim(), row.translation.trim()],
            type: 'video' as const,
            videoSrc: videoData.videoSrc,
            videoVolume: videoData.volume,
            videoSpeed: videoData.speed,
            videoLoop: videoData.loop,
            videoStart: videoData.startTime,
            videoEnd: videoData.endTime
          };
        }

        return {
          id: `slide-${idx}`,
          label,
          lines: [contentHeb.trim(), row.transliteration.trim(), row.translation.trim()]
        };
      })
      .filter(slide => slide.lines.some(line => line.trim().length > 0));

    return [titleSlide, ...parsed];
  };

  const parseSlides = (): Slide[] => {
    if (isTableMode) {
      return slides;
    }
    return mode === 'standard' ? parseStandardSlides() : parseTrilingualSlides();
  };

  const buildSlidesForSave = async (): Promise<{ slides: Slide[]; mode: 'standard' | 'trilingual' }> => {
    if (isTableMode) {
      const nextMode = slides.some((slide) => slide.type === 'tanaj' || slide.type === 'sefer' || slide.scriptureBook)
        ? 'trilingual'
        : mode;
      return { slides, mode: nextMode };
    }

    if (mode === 'standard') {
      const parts = standardText.split(/\n\n+/);
      const titleLines: string[] = [];
      const contentParts: string[] = [];
      let hasTitleMarker = false;
      let hasScriptureSlides = false;

      parts.forEach((part) => {
        const lines = part.split('\n');
        const hasMarker = lines.some((line) => line.startsWith('>'));
        if (hasMarker) hasTitleMarker = true;
        const titleMarkers = lines.filter((line) => line.startsWith('>')).map((line) => line.substring(1).trim());
        const con = lines.filter((line) => !line.startsWith('>')).join('\n');
        if (titleMarkers.length > 0) titleLines.push(...titleMarkers);
        if (con.trim()) contentParts.push(con);
      });

      const titleSlide: Slide = {
        id: 'slide-title',
        label: 'Título',
        lines: [hasTitleMarker ? titleLines.join('\n') : (titleLines.join('\n') || title.trim())]
      };

      let autoId = 1;
      const parsed: Slide[] = [];
      for (const [idx, part] of contentParts.entries()) {
        const lines = part.split('\n');
        let label: string;
        let content = part;
        if (lines[0].startsWith('#')) {
          label = lines[0].substring(1).trim();
          content = lines.slice(1).join('\n');
        } else {
          label = autoId.toString();
          autoId++;
        }

        const scriptureSlides = await parseScriptureDirectiveFromText(content.trim());
        if (scriptureSlides) {
          hasScriptureSlides = true;
          parsed.push(...scriptureSlides);
          continue;
        }

        const videoData = parseVideoSlideString(content);
        if (videoData) {
          parsed.push({
            id: `slide-${idx}`,
            label,
            lines: [content.trim()],
            type: 'video' as const,
            videoSrc: videoData.videoSrc,
            videoVolume: videoData.volume,
            videoSpeed: videoData.speed,
            videoLoop: videoData.loop,
            videoStart: videoData.startTime,
            videoEnd: videoData.endTime
          });
          continue;
        }

        parsed.push({ id: `slide-${idx}`, label, lines: [content.trim()] });
      }

      return { slides: [titleSlide, ...parsed.filter(slide => slide.lines[0].length > 0)], mode: hasScriptureSlides ? 'trilingual' : 'standard' };
    }

    const getTitleAndContent = (text: string) => {
      const titleLines: string[] = [];
      const content: string[] = [];

      text.split(/\n\n+/).forEach(part => {
        const lines = part.split('\n');
        const titleMarkers = lines.filter(line => line.startsWith('>')).map(line => line.substring(1).trim());
        const body = lines.filter(line => !line.startsWith('>')).join('\n');
        if (titleMarkers.length > 0) titleLines.push(...titleMarkers);
        if (body.trim()) content.push(body);
      });

      return { title: titleLines.join('\n'), content };
    };

    const hebData = getTitleAndContent(hebText);
    const transData = getTitleAndContent(transText);
    const traData = getTitleAndContent(traText);
    const maxLen = Math.max(hebData.content.length, transData.content.length, traData.content.length);

    const rows = Array.from({ length: maxLen }, (_, i) => ({
      hebrew: hebData.content[i] || '',
      transliteration: transData.content[i] || '',
      translation: traData.content[i] || ''
    }));

    const titleSlide: Slide = {
      id: 'slide-title',
      label: 'Título',
      lines: [hebData.title, transData.title, traData.title].map(v => v || '')
    };

    let autoId = 1;
    const parsed: Slide[] = [];
    for (const [idx, row] of rows.entries()) {
      const lines = row.hebrew.split('\n');
      let label: string;
      let contentHeb = row.hebrew;

      if (lines[0].startsWith('#')) {
        label = lines[0].substring(1).trim();
        contentHeb = lines.slice(1).join('\n');
      } else {
        label = autoId.toString();
        autoId++;
      }

      const scriptureSlides = await parseScriptureDirectiveFromText(contentHeb.trim());
      if (scriptureSlides) {
        parsed.push(...scriptureSlides);
        continue;
      }

      const videoData = parseVideoSlideString(contentHeb) || parseVideoSlideString(row.transliteration) || parseVideoSlideString(row.translation);
      if (videoData) {
        parsed.push({
          id: `slide-${idx}`,
          label,
          lines: [contentHeb.trim(), row.transliteration.trim(), row.translation.trim()],
          type: 'video' as const,
          videoSrc: videoData.videoSrc,
          videoVolume: videoData.volume,
          videoSpeed: videoData.speed,
          videoLoop: videoData.loop,
          videoStart: videoData.startTime,
          videoEnd: videoData.endTime
        });
        continue;
      }

      parsed.push({
        id: `slide-${idx}`,
        label,
        lines: [contentHeb.trim(), row.transliteration.trim(), row.translation.trim()]
      });
    }

    return { slides: [titleSlide, ...parsed.filter(slide => slide.lines.some(line => line.trim().length > 0))], mode: 'trilingual' };
  };

  const handleSave = async () => {
    if (!title.trim()) {
      alert('Por favor, introduce un título.');
      return;
    }

    const isDefaultBg = bg === '' || bg === 'Principal' || bg === 'Anterior' || bg === 'Ignorar' || bg === 'No cambiar';
    const finalBg = isDefaultBg
      ? (currentPresentation?.background || backgrounds[0])
      : bg;

    const parsed = await buildSlidesForSave();

    await onSave({
      id: id || currentPresentation?.id || Date.now().toString(),
      title,
      background: finalBg,
      mode: parsed.mode,
      fontScale,
      slides: parsed.slides
    });
  };

  const textareaClass =
    'w-full min-h-[20rem] md:min-h-[24rem] max-h-[78vh] resize-y overflow-auto bg-gray-900 border border-gray-700 rounded-md p-3 text-[0.92rem] leading-relaxed text-white shadow-inner focus:outline-none focus:ring-1 focus:ring-yellow-500';

  const isScriptureRangeRoot = (slide: Slide) => (
    !!slide.scriptureBook &&
    !!slide.scriptureChapter &&
    !!slide.scriptureVerseStart &&
    !!slide.scriptureVerseEnd &&
    slide.scriptureVerseStart !== slide.scriptureVerseEnd
  );

  const getScriptureRangeRootIndex = (idx: number) => {
    const slide = slides[idx];
    if (!slide || !slide.scriptureBook || !slide.scriptureChapter || !slide.scriptureVerseStart) return -1;
    if (isScriptureRangeRoot(slide)) return idx;

    for (let i = idx - 1; i >= 0; i--) {
      const candidate = slides[i];
      if (!candidate.scriptureBook || !candidate.scriptureChapter || candidate.scriptureBook !== slide.scriptureBook || candidate.scriptureChapter !== slide.scriptureChapter) {
        break;
      }
      if (isScriptureRangeRoot(candidate)) return i;
    }

    return -1;
  };

  const getScriptureRangeEndIndex = (startIdx: number) => {
    const root = slides[startIdx];
    if (!root || !isScriptureRangeRoot(root)) return startIdx;

    let endIdx = startIdx;
    for (let i = startIdx + 1; i < slides.length; i++) {
      const candidate = slides[i];
      if (
        candidate.scriptureBook === root.scriptureBook &&
        candidate.scriptureChapter === root.scriptureChapter &&
        candidate.scriptureVerseStart &&
        candidate.scriptureVerseEnd &&
        candidate.scriptureVerseStart === candidate.scriptureVerseEnd
      ) {
        endIdx = i;
        continue;
      }
      break;
    }

    return endIdx;
  };

  return (
    <div className="flex h-full w-full flex-col bg-gray-800 text-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700 bg-gray-900 px-4 py-3 md:px-5 md:py-4">
        <h2 className="flex items-center gap-2 text-lg font-bold md:text-xl">
          <img src="/logo.svg" alt="Logo" className="h-7 w-7" />
          <span>Gestor de Presentaciones</span>
        </h2>
        <div className="flex items-center gap-2">
          {/* Toggle app mode button */}
          <button
            type="button"
            onClick={() => onToggleAppMode(appMode === 'scripture' ? 'slides' : 'scripture')}
            className={`flex items-center justify-center p-2 text-xs font-semibold rounded border transition-all cursor-pointer ${appMode === 'scripture'
              ? 'bg-yellow-600 border-yellow-500 text-white font-bold'
              : 'bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white'
              }`}
            title={appMode === 'scripture' ? "Cambiar a Modo Diapositivas" : "Cambiar a Modo Lectura de Escrituras"}
          >
            <span className="text-sm leading-none">📜</span>
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex items-center justify-center p-2 text-xs font-semibold rounded border border-gray-700 bg-gray-800 hover:bg-gray-700 hover:text-white transition-all cursor-pointer text-gray-300"
            title={isFullscreen ? "Salir de Pantalla Completa" : "Pantalla Completa"}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto flex flex-col">
        {appMode === 'scripture' && !isActiveScriptureSlide && (
          <div className="shrink-0 border-b border-gray-700 bg-gray-950/70">
            <div>
              <SeferControlPanel
                onProject={(state, cmd) => {
                  if (onProjectScripture) {
                    onProjectScripture(state, cmd);
                  }
                }}
                onAddSlide={onAddScriptureSlide}
                restoredState={scriptureState ? { ...scriptureState, verseEnd: undefined } : null}
                onUpdateFontSizes={onUpdateScriptureFontSizes}
              />
            </div>
          </div>
        )}
        <div className="flex-1">
          {/* Visor Superior - Horizontal en desktop, vertical en movil */}
          <div className="border-b border-gray-700 bg-gray-900/50 p-3 md:p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">

              {/* Lado Izquierdo: Controles del Visor */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end lg:w-[420px] lg:flex-none">
                {/* Seleccionar Presentación */}
                <div className="flex-1 space-y-1.5 min-w-0">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Seleccionar Presentación</label>
                  <div className="flex gap-1.5">
                    <CustomSearchSelect
                      value={currentPresentation ? currentPresentation.id : 'new'}
                      onChange={(val) => {
                        if (val === 'new') {
                          handleStartEditingNew();
                        } else {
                          const p = presentations.find(presentation => presentation.id === val);
                          if (p) {
                            onSelectPresentation(p);
                          }
                        }
                      }}
                      options={[
                        { label: '-- Nueva Presentación --', value: 'new' },
                        ...presentations.map(presentation => ({
                          label: presentation.title || 'Sin Título',
                          value: presentation.id
                        }))
                      ]}
                      placeholder="Busca o selecciona presentación..."
                      className="flex-1"
                      dropdownWidthClass="w-[280px] md:w-[320px]"
                    />
                    {currentPresentation && (
                      <button
                        type="button"
                        onClick={() => handleStartEditing(currentPresentation)}
                        className="px-3 rounded-md border flex items-center justify-center bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors cursor-pointer"
                        title="Editar contenido de la presentación activa"
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Fondo */}
                <div className="flex-1 space-y-1.5 min-w-0">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Fondo</label>
                  <div className="flex gap-1.5">
                    <CustomSearchSelect
                      value={activeBackground || (currentPresentation ? currentPresentation.background : backgrounds[0])}
                      onChange={(val) => {
                        onSelectBackgroundOverride(val);
                      }}
                      options={backgrounds.map(background => ({
                        label: background.split('/').pop() || background,
                        value: background
                      }))}
                      placeholder="Fondo global..."
                      dropdownWidthClass="w-[200px]"
                    />
                    <button
                      type="button"
                      onClick={() => onToggleBackgroundLock(!backgroundLock)}
                      className={`px-3 rounded-md border flex items-center justify-center transition-all cursor-pointer ${backgroundLock
                        ? 'bg-red-600 border-red-500 text-white hover:bg-red-500 shadow-md shadow-red-500/20 animate-pulse'
                        : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 hover:text-white'
                        }`}
                      title={
                        backgroundLock
                          ? 'Candado Activo: Fondo congelado (estilo !important)'
                          : 'Candado Inactivo: Diapositivas controlan el fondo libremente'
                      }
                    >
                      {backgroundLock ? <Lock size={15} /> : <Unlock size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Lado Derecho: Navegación de Diapositivas */}
              <div className="flex-1 min-w-0 flex flex-col justify-center rounded-md bg-gray-900/60 border border-gray-700/60 p-2.5 sm:p-3 shadow-inner">
                {currentPresentation && currentPresentation.slides.length > 0 ? (
                  <div className="space-y-1.5 w-full">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 truncate">Navegación en Directo</span>
                        <span className="hidden sm:inline text-[9px] text-gray-500 truncate">(Haz clic para proyectar)</span>
                      </div>
                      <span className="text-[11px] text-yellow-500 font-bold truncate">
                        Activa: {currentPresentation.slides[currentSlideIndex]?.label || 'Ninguna'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 w-full">
                      <button
                        type="button"
                        onClick={() => {
                          const prevIdx = Math.max(currentSlideIndex - 1, 0);
                          onSelectSlide(prevIdx);
                          setTimeout(() => {
                            const btn = document.getElementById(`live-slide-btn-${prevIdx}`);
                            btn?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                          }, 50);
                        }}
                        disabled={currentSlideIndex <= 0}
                        className="flex-none w-5 self-stretch rounded border border-gray-700 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-gray-800 text-gray-400 hover:text-white transition-all cursor-pointer font-bold text-[11px] flex items-center justify-center min-h-[1.8rem]"
                        title="Anterior"
                      >
                        &lt;
                      </button>

                      <div className="flex-1 flex flex-wrap gap-1.5 max-h-[4.2rem] overflow-y-auto pr-1 scrollbar-thin">
                        {currentPresentation.slides.map((slide, idx) => {
                          const isSelected = currentSlideIndex === idx;
                          return (
                            <button
                              id={`live-slide-btn-${idx}`}
                              key={slide.id}
                              onClick={(e) => {
                                onSelectSlide(idx);
                                e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                              }}
                              className={`min-w-[2.2rem] rounded border text-xs font-semibold transition-all px-2.5 py-1 select-none ${isSelected
                                ? 'border-yellow-500 bg-yellow-600 text-white font-bold shadow-[0_0_8px_rgba(234,179,8,0.3)]'
                                : 'border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-300'
                                }`}
                            >
                              {slide.label}
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const nextIdx = Math.min(currentSlideIndex + 1, currentPresentation.slides.length - 1);
                          onSelectSlide(nextIdx);
                          setTimeout(() => {
                            const btn = document.getElementById(`live-slide-btn-${nextIdx}`);
                            btn?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                          }, 50);
                        }}
                        disabled={currentSlideIndex >= currentPresentation.slides.length - 1}
                        className="flex-none w-5 self-stretch rounded border border-gray-700 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-gray-800 text-gray-400 hover:text-white transition-all cursor-pointer font-bold text-[11px] flex items-center justify-center min-h-[1.8rem]"
                        title="Siguiente"
                      >
                        &gt;
                      </button>
                    </div>

                    {isActiveScriptureSlide && scriptureState && (
                      <div className="rounded-md border border-gray-800 bg-gray-950/50">
                        <SeferControlPanelMini
                          onProject={(state, cmd) => {
                            if (onProjectScripture) {
                              onProjectScripture(state, cmd);
                            }
                          }}
                          onBoundaryReached={onBoundaryReached}
                          restoredState={scriptureState}
                          onUpdateFontSizes={onUpdateScriptureFontSizes}
                        />
                      </div>
                    )}

                    {activeSlide?.type === 'video' && (
                      <div className="rounded-md border border-yellow-800/25 bg-yellow-950/10 p-2.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-[10px] font-black text-yellow-500 uppercase tracking-wider">Video</span>
                          </div>
                          <span className="text-[10px] font-black text-gray-400 truncate">
                            {activeSlide.videoSrc?.split('/').pop() || 'Video'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              onVideoStateChange({
                                isPlaying: !videoState?.isPlaying,
                                currentTime: videoState?.currentTime ?? 0,
                                duration: videoState?.duration ?? activeSlide.videoEnd ?? 0,
                                volume: videoState?.volume ?? 0.8,
                                speed: videoState?.speed ?? 1.0,
                                loop: videoState?.loop ?? true,
                                videoSrc: activeSlide.videoSrc || null,
                                lastUpdatedBy: 'controller',
                                timestamp: Date.now()
                              });
                            }}
                            className="w-8 h-8 rounded-full bg-yellow-600 hover:bg-yellow-500 text-white flex items-center justify-center transition-all cursor-pointer shadow-md"
                            title={videoState?.isPlaying ? 'Pausar video' : 'Reproducir video'}
                          >
                            {videoState?.isPlaying ? (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                            ) : (
                              <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                            )}
                          </button>

                          <div className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/60 px-2 py-1">
                            <span className="text-[9px] font-black text-gray-500">VOL</span>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={videoState?.volume ?? 0.8}
                              onChange={(e) => {
                                onVideoStateChange({
                                  isPlaying: videoState?.isPlaying ?? false,
                                  currentTime: videoState?.currentTime ?? 0,
                                  duration: videoState?.duration ?? activeSlide.videoEnd ?? 0,
                                  volume: parseFloat(e.target.value),
                                  speed: videoState?.speed ?? 1.0,
                                  loop: videoState?.loop ?? true,
                                  videoSrc: activeSlide.videoSrc || null,
                                  lastUpdatedBy: 'controller',
                                  timestamp: Date.now()
                                });
                              }}
                              className="w-16 accent-yellow-500"
                            />
                          </div>

                          <div className="flex items-center gap-1 rounded border border-gray-800 bg-gray-950/60 p-0.5">
                            {[0.5, 1, 1.5, 2].map((speedVal) => (
                              <button
                                key={speedVal}
                                type="button"
                                onClick={() => {
                                  onVideoStateChange({
                                    isPlaying: videoState?.isPlaying ?? false,
                                    currentTime: videoState?.currentTime ?? 0,
                                    duration: videoState?.duration ?? activeSlide.videoEnd ?? 0,
                                    volume: videoState?.volume ?? 0.8,
                                    speed: speedVal,
                                    loop: videoState?.loop ?? true,
                                    videoSrc: activeSlide.videoSrc || null,
                                    lastUpdatedBy: 'controller',
                                    timestamp: Date.now()
                                  });
                                }}
                                className={`rounded px-1.5 py-1 text-[9px] font-black ${((videoState?.speed ?? 1) === speedVal) ? 'bg-yellow-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                              >
                                {speedVal}x
                              </button>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              onVideoStateChange({
                                isPlaying: videoState?.isPlaying ?? false,
                                currentTime: videoState?.currentTime ?? 0,
                                duration: videoState?.duration ?? activeSlide.videoEnd ?? 0,
                                volume: videoState?.volume ?? 0.8,
                                speed: videoState?.speed ?? 1.0,
                                loop: !(videoState?.loop ?? true),
                                videoSrc: activeSlide.videoSrc || null,
                                lastUpdatedBy: 'controller',
                                timestamp: Date.now()
                              });
                            }}
                            className={`rounded border px-2 py-1 text-[10px] font-black ${(videoState?.loop ?? true)
                              ? 'bg-yellow-600/25 border-yellow-800 text-yellow-500'
                              : 'bg-gray-950/60 border-gray-800 text-gray-500 hover:text-gray-300'
                              }`}
                          >
                            BUCLE
                          </button>

                          <input
                            type="range"
                            min="0"
                            max={videoState?.duration || activeSlide.videoEnd || 100}
                            step="0.1"
                            value={localTime}
                            onMouseDown={() => setIsScrubbing(true)}
                            onTouchStart={() => setIsScrubbing(true)}
                            onMouseUp={() => setIsScrubbing(false)}
                            onTouchEnd={() => setIsScrubbing(false)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setLocalTime(val);
                              onVideoStateChange({
                                isPlaying: videoState?.isPlaying ?? false,
                                currentTime: val,
                                duration: videoState?.duration ?? activeSlide.videoEnd ?? 0,
                                volume: videoState?.volume ?? 0.8,
                                speed: videoState?.speed ?? 1.0,
                                loop: videoState?.loop ?? true,
                                videoSrc: activeSlide.videoSrc || null,
                                lastUpdatedBy: 'controller',
                                timestamp: Date.now()
                              });
                            }}
                            className="min-w-[160px] flex-1 accent-yellow-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-2 text-xs text-gray-500 italic">
                    Ninguna presentación activa para proyectar
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* Área Principal */}
          <div className="flex-1 overflow-y-auto p-3 md:p-4">
            {editorMode === 'list' ? (
              /* ================= GESTOR DE ORDEN Y LISTA ================= */
              <div className="flex-1 flex flex-col gap-3">
                {/* Header del Gestor */}
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between rounded-md bg-gray-900 border border-gray-700 p-3">
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      placeholder="Buscar canción en el repertorio..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full lg:max-w-md bg-gray-850 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 justify-end items-center sm:flex-nowrap">
                    {/* Ordenar A-Z */}
                    <button
                      type="button"
                      onClick={handleSortPresentationsAZ}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gray-700 hover:bg-gray-650 transition-colors text-white border border-gray-600 cursor-pointer"
                    >
                      Ordenar A-Z
                    </button>

                    {/* Importar / Exportar Base de Datos (Trasladado aquí por solicitud del usuario) */}
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={handleExport}
                        className="px-3 py-1.5 rounded-md border border-gray-600 bg-gray-700 text-xs font-bold text-white hover:bg-gray-650 transition-colors flex items-center gap-1 cursor-pointer"
                        title="Exportar base de datos JSON"
                      >
                        <Download size={13} />
                        <span>Exportar</span>
                      </button>
                      <label
                        className="px-3 py-1.5 rounded-md border border-gray-600 bg-gray-700 text-xs font-bold text-white hover:bg-gray-650 transition-colors flex items-center gap-1 cursor-pointer"
                        title="Importar base de datos JSON"
                      >
                        <Upload size={13} />
                        <span>Importar</span>
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleImport}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {/* Nueva Presentación */}
                    <button
                      type="button"
                      onClick={handleStartEditingNew}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-yellow-600 hover:bg-yellow-500 transition-colors text-white cursor-pointer shadow-sm"
                    >
                      <Plus size={13} />
                      <span>Nueva Presentación</span>
                    </button>
                  </div>
                </div>

                {/* Tabla del Gestor */}
                <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-900/40 backdrop-blur-md shadow-lg">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-700 bg-gray-900/80 text-xs font-semibold uppercase tracking-wider text-gray-400">
                        <th className="px-3 py-3 w-[100px] text-center">Acción</th>
                        <th className="px-3 py-3">Título de la Presentación</th>
                        <th className="px-3 py-3 w-[80px] text-center">Modo</th>
                        <th className="px-3 py-3 w-[100px] text-center">Diapositivas</th>
                        <th className="px-3 py-3 w-[160px] text-center">Gestión</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800 text-sm">
                      {presentations
                        .filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase()))
                        .map((p, idx) => {
                          const isCurrent = currentPresentation?.id === p.id;
                          const isExpanded = !!expandedRows[p.id];
                          return (
                            <React.Fragment key={p.id}>
                              <tr
                                className={`transition-colors duration-150 hover:bg-gray-800/40 ${isCurrent ? 'bg-yellow-950/20' : ''
                                  }`}
                              >
                                <td className="p-3 align-middle">
                                  <div className="flex items-center justify-center gap-1">
                                    {/* Play Button */}
                                    <button
                                      type="button"
                                      onClick={() => onSelectPresentation(p)}
                                      className={`p-1.5 rounded-md flex items-center justify-center transition-all cursor-pointer ${isCurrent
                                        ? 'bg-yellow-500 text-white shadow-md shadow-yellow-500/20'
                                        : 'bg-gray-700/80 text-gray-300 hover:bg-yellow-600 hover:text-white'
                                        }`}
                                      title={isCurrent ? "En directo" : "Presentar"}
                                    >
                                      <Play size={13} fill={isCurrent ? "currentColor" : "none"} />
                                    </button>

                                    {/* Expand Slide Button */}
                                    <button
                                      type="button"
                                      onClick={() => setExpandedRows({ ...expandedRows, [p.id]: !isExpanded })}
                                      className="p-1.5 rounded-md bg-gray-700/80 text-gray-300 hover:bg-gray-600 hover:text-white transition-all cursor-pointer"
                                      title="Ver diapositivas"
                                    >
                                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                    </button>
                                  </div>
                                </td>
                                <td className="p-3 align-middle font-semibold text-white">
                                  <div className="flex items-center gap-2">
                                    <span>{p.title}</span>
                                    {isCurrent && (
                                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
                                        En Directo
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-3 align-middle text-center">
                                  <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-extrabold ${p.mode === 'trilingual'
                                    ? 'bg-purple-950/60 text-purple-400 border border-purple-800/50'
                                    : 'bg-blue-950/60 text-blue-400 border border-blue-800/50'
                                    }`}>
                                    {p.mode === 'trilingual' ? '3x' : '1x'}
                                  </span>
                                </td>
                                <td className="p-3 align-middle text-center font-bold text-gray-300">
                                  {p.slides?.length || 0}
                                </td>
                                <td className="p-3 align-middle">
                                  <div className="flex items-center justify-center gap-1.5">
                                    {/* Pencil Edit button */}
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditing(p)}
                                      className="p-1.5 text-gray-400 hover:text-yellow-400 hover:bg-gray-700/60 rounded transition-all cursor-pointer"
                                      title="Editar contenido"
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={idx === 0}
                                      onClick={() => handleMovePresentationUp(idx)}
                                      className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-gray-700/60 rounded transition-colors cursor-pointer"
                                      title="Mover Arriba"
                                    >
                                      <ArrowUp size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={idx === presentations.length - 1}
                                      onClick={() => handleMovePresentationDown(idx)}
                                      className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-gray-700/60 rounded transition-colors cursor-pointer"
                                      title="Mover Abajo"
                                    >
                                      <ArrowDown size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeletePresentation(idx)}
                                      className="p-1 text-red-400 hover:text-red-300 hover:bg-red-950/20 rounded transition-colors cursor-pointer"
                                      title="Eliminar Presentación"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {/* Expanded slide list row */}
                              {isExpanded && (
                                <tr className="bg-gray-950/40">
                                  <td colSpan={5} className="px-6 py-2.5">
                                    <div className="space-y-1">
                                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                        Diapositivas (Haz clic en una para mostrarla):
                                      </div>
                                      <div className="flex flex-wrap gap-1.5 max-h-[10rem] overflow-y-auto py-1">
                                        {p.slides.map((slide, slideIdx) => (
                                          <button
                                            key={slide.id}
                                            onClick={() => {
                                              onSelectPresentation(p, slideIdx);
                                            }}
                                            className="bg-gray-800 hover:bg-yellow-600 hover:text-white transition-all text-xs border border-gray-700 hover:border-yellow-500 text-gray-300 px-2 py-1 rounded cursor-pointer"
                                          >
                                            <span className="font-bold text-[10px] mr-1 text-yellow-500">
                                              {slide.label}:
                                            </span>
                                            <span className="truncate max-w-[120px] inline-block align-bottom">
                                              {(() => {
                                                const isFb = p.mode === 'trilingual' && slide.lines.length === 3 &&
                                                  (slide.lines[1] === '-' || slide.lines[1] === '>-' || slide.lines[1] === '') &&
                                                  (slide.lines[2] === '-' || slide.lines[2] === '>-' || slide.lines[2] === '');
                                                return (p.mode === 'trilingual' && !isFb ? slide.lines[2] : slide.lines[0]) || '(Vacía)';
                                              })()}
                                            </span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* ================= EDITOR DE CONTENIDO ================= */
              <>
                {/* Header del Editor */}
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between rounded-md bg-gray-900 border border-gray-700 p-3 mb-3">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    {/* Close/Exit X button */}
                    <button
                      type="button"
                      onClick={() => setEditorMode('list')}
                      className="p-1.5 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition-colors cursor-pointer"
                      title="Salir del editor"
                    >
                      <X size={18} />
                    </button>

                    {/* Inline Title input */}
                    <input
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Escribe el título..."
                      className="bg-transparent border-b border-transparent hover:border-gray-700 focus:border-yellow-500 outline-none text-base font-bold text-white px-2 py-1 flex-1 min-w-0 transition-colors"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 justify-end">
                    {/* Selector Fondo Principal del Editor y botón aplicar a todo */}
                    <div className="flex items-center gap-2 bg-gray-800 border border-gray-750 px-2.5 py-1 rounded-md min-w-[210px]">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Principal</label>
                      <CustomSearchSelect
                        value={bg || 'Principal'}
                        onChange={(val) => setBg(val)}
                        options={[
                          { label: 'Principal', value: 'Principal' },
                          { label: 'Ignorar', value: 'Ignorar' },
                          { label: 'Anterior', value: 'Anterior' },
                          ...backgrounds.map(background => ({
                            label: background.split('/').pop() || background,
                            value: background
                          }))
                        ]}
                        placeholder="Fondo principal..."
                        dropdownWidthClass="w-[200px]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (bg !== undefined) {
                            const updatedSlides = slides.map(slide => ({
                              ...slide,
                              background: bg
                            }));
                            setSlides(updatedSlides);
                            alert('Se han configurado todos los fondos de las diapositivas al seleccionado.');
                          }
                        }}
                        className="p-1.5 rounded bg-yellow-600 hover:bg-yellow-500 text-white transition-all cursor-pointer flex items-center justify-center"
                        title="Aplicar este fondo a todas las diapositivas"
                      >
                        <Layers size={13} />
                      </button>
                    </div>

                    {/* 1x / 3x segmented module switcher */}
                    <div className="flex items-center bg-gray-800 p-0.5 rounded-md border border-gray-750">
                      <button
                        type="button"
                        onClick={() => handleModeChange('standard')}
                        className={`px-3 py-1.5 rounded-md text-xs font-black transition-all cursor-pointer ${mode === 'standard'
                          ? 'bg-yellow-600 text-white shadow-md'
                          : 'text-gray-400 hover:text-white'
                          }`}
                        title="Modo Estándar (1 línea por diapositiva)"
                      >
                        1x
                      </button>
                      <button
                        type="button"
                        onClick={() => handleModeChange('trilingual')}
                        className={`px-3 py-1.5 rounded-md text-xs font-black transition-all cursor-pointer ${mode === 'trilingual'
                          ? 'bg-yellow-600 text-white shadow-md'
                          : 'text-gray-400 hover:text-white'
                          }`}
                        title="Modo Trilingüe (3 líneas por diapositiva)"
                      >
                        3x
                      </button>
                    </div>

                    {/* Font Scale slider */}
                    <div className="flex items-center gap-2 bg-gray-800 border border-gray-750 px-2.5 py-1 rounded-md">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Letra</label>
                      <input
                        type="range"
                        min="0.75"
                        max="1.45"
                        step="0.05"
                        value={fontScale}
                        onChange={e => setFontScale(Number(e.target.value))}
                        className="w-16 sm:w-20 accent-yellow-500"
                      />
                      <span className="text-[10px] text-gray-400 font-bold min-w-[28px] text-right">
                        {Math.round(fontScale * 100)}%
                      </span>
                    </div>

                    {/* View Mode: Table / Quick Edit */}
                    <div className="flex items-center bg-gray-800 p-0.5 rounded-md border border-gray-750">
                      <button
                        type="button"
                        onClick={() => { if (!isTableMode) toggleEditMode(); }}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${isTableMode
                          ? 'bg-yellow-600 text-white shadow-md'
                          : 'text-gray-400 hover:text-white'
                          }`}
                      >
                        <Table size={12} />
                        <span className="hidden sm:inline">Tabla</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (isTableMode) toggleEditMode(); }}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${!isTableMode
                          ? 'bg-yellow-600 text-white shadow-md'
                          : 'text-gray-400 hover:text-white'
                          }`}
                      >
                        <FileText size={12} />
                        <span className="hidden sm:inline">Rápida</span>
                      </button>
                    </div>

                    {/* Save Icon button (Only Logo) */}
                    <button
                      type="button"
                      onClick={handleSave}
                      className="p-2 rounded-md bg-yellow-600 hover:bg-yellow-500 text-white shadow-md cursor-pointer transition-all hover:scale-105"
                      title="Guardar presentación de forma permanente"
                    >
                      <Save size={15} />
                    </button>
                  </div>
                </div>

                {/* Table or Text Editor Area */}
                {isTableMode ? (
                  <div className="space-y-4">
                    {/* Visual Editor Table */}
                    <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-900/40 backdrop-blur-md shadow-lg">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-gray-700 bg-gray-900/80 text-xs font-semibold uppercase tracking-wider text-gray-400">
                            <th className="px-3 py-3 w-[80px] text-center">Etiqueta</th>
                            <th className="px-3 py-3">
                              <div className="flex items-center justify-between">
                                <span>Contenido de la Diapositiva</span>
                                {mode === 'trilingual' && (
                                  <button
                                    type="button"
                                    onClick={handleTransliterateAllTable}
                                    className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] px-2.5 py-1 rounded transition-all cursor-pointer shadow-sm"
                                    title="Generar transliteración para todas las diapositivas"
                                  >
                                    <Languages size={10} />
                                    <span>Transliterar todas</span>
                                  </button>
                                )}
                              </div>
                            </th>
                            <th className="px-3 py-3 w-[150px] text-center">Fondo</th>
                            <th className="px-3 py-3 w-[120px] text-center font-bold">Orden / Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800 text-sm">
                          {slides.map((slide, idx) => {
                            const rangeRootIdx = getScriptureRangeRootIndex(idx);
                            const isScriptureGroupChild = rangeRootIdx >= 0 && rangeRootIdx !== idx;
                            const groupRoot = rangeRootIdx >= 0 ? slides[rangeRootIdx] : null;
                            const groupExpanded = groupRoot ? expandedRows[groupRoot.id] !== false : true;
                            if (isScriptureGroupChild && !groupExpanded) {
                              return null;
                            }

                            const isTitle = isTitleSlide(slide);
                            const customBg = slide.background;
                            const isVideo = customBg && (customBg.endsWith('.mp4') || customBg.endsWith('.webm') || customBg.endsWith('.ogg'));
                            const isImage = slide.lines[0]?.trim() === '[IMAGE]';
                            const hasRangeChildren = isScriptureRangeRoot(slide) && getScriptureRangeEndIndex(idx) > idx;

                            const videoOptions = backgrounds
                              .filter(bg => bg.match(/\.(mp4|webm)$/i))
                              .map(bg => ({
                                label: bg.split('/').pop() || bg,
                                value: bg
                              }));

                            const maxDuration = slide.videoSrc && videoDurations[slide.videoSrc]
                              ? videoDurations[slide.videoSrc]
                              : (currentSlideIndex === idx && videoState?.duration ? videoState.duration : undefined);

                            return (
                              <tr key={slide.id} className={`transition-colors hover:bg-gray-800/10 ${isScriptureGroupChild ? 'bg-gray-950/15' : ''}`}>
                                {/* 1. Label column */}
                                <td className="px-3 py-3 text-center align-top">
                                  {isTitle ? (
                                    <span className="inline-block text-[11px] font-black uppercase bg-yellow-950/80 text-yellow-500 px-2 py-1 rounded border border-yellow-750/30">
                                      {slide.label}
                                    </span>
                                  ) : (
                                    <div className="flex items-center justify-center gap-1">
                                      {isScriptureGroupChild && <span className="text-[10px] font-black text-gray-500">&gt;</span>}
                                      <AutoResizeInput
                                        type="text"
                                        className={`w-[60px] text-center bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-yellow-500 font-bold ${isScriptureGroupChild ? 'opacity-75' : ''}`}
                                        value={slide.label}
                                        onChange={e => handleUpdateLabel(idx, e.target.value)}
                                        placeholder="Nº"
                                      />
                                      {hasRangeChildren && (
                                        <button
                                          type="button"
                                          onClick={() => setExpandedRows({ ...expandedRows, [slide.id]: !groupExpanded })}
                                          className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700"
                                          title={groupExpanded ? 'Colapsar bloque' : 'Expandir bloque'}
                                        >
                                          {groupExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                        </button>
                                      )}
                                    </div>
                                  )}

                                  {/* Broadcast slide immediately directly from the editor row */}
                                  <div className="mt-2 flex justify-center">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const livePresentation: Presentation = {
                                          id: id || currentPresentation?.id || Date.now().toString(),
                                          title: title || 'Sin Título',
                                          background: bg,
                                          mode,
                                          fontScale,
                                          slides: parseSlides()
                                        };
                                        onSelectPresentation(livePresentation, idx);
                                      }}
                                      className="p-1 rounded bg-gray-800 hover:bg-yellow-600 hover:text-white border border-gray-750 transition-colors flex items-center justify-center cursor-pointer text-gray-400"
                                      title="Proyectar esta diapositiva en directo"
                                    >
                                      <Play size={10} fill="currentColor" />
                                    </button>
                                  </div>
                                </td>

                                {/* 2. Text/Video/Image fields column */}
                                <td className={`px-3 py-3 align-top ${isScriptureGroupChild ? 'bg-gray-950/20' : ''}`}>
                                  {slide.type === 'sefer' || slide.type === 'tanaj' || !!slide.scriptureBook ? (
                                    <ScriptureRangeEditor
                                      slide={slide}
                                      backgrounds={backgrounds}
                                      onVerseBackgroundChange={(verse, value) => handleUpdateScriptureVerseBackground(idx, verse, value)}
                                      onCommit={(payload) => handleUpdateScriptureSlide(idx, payload)}
                                    />
                                  ) : slide.type === 'video' ? (
                                    /* Video Config Panel */
                                    <div className="bg-gray-950/40 border border-gray-800/80 rounded-lg p-3 space-y-3 shadow-md w-full">
                                      <div className="flex items-center gap-2 border-b border-gray-850 pb-1.5 mb-1.5">
                                        <Video size={13} className="text-yellow-500 animate-pulse" />
                                        <span className="text-[10px] font-bold text-gray-405 uppercase tracking-wider">Configuración de Diapositiva de Video</span>
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {/* Video Source */}
                                        <div className="space-y-1">
                                          <label className="text-[9px] font-black text-gray-500 uppercase tracking-wide">Ruta del Video</label>
                                          <CustomSearchSelect
                                            value={slide.videoSrc || ''}
                                            onChange={val => handleUpdateVideoParams(idx, { videoSrc: val })}
                                            options={videoOptions}
                                            placeholder="Seleccionar video..."
                                            dropdownWidthClass="w-[260px] -left-5"
                                            openDirection="down"
                                          />
                                        </div>

                                        {/* Volume */}
                                        <div className="space-y-1">
                                          <div className="flex items-center justify-between">
                                            <label className="text-[9px] font-black text-gray-500 uppercase tracking-wide">Volumen</label>
                                            <span className="text-[10px] font-bold text-yellow-500">{Math.round((slide.videoVolume ?? 0.8) * 100)}%</span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="range"
                                              min="0"
                                              max="1"
                                              step="0.05"
                                              value={slide.videoVolume ?? 0.8}
                                              onChange={e => handleUpdateVideoParams(idx, { volume: parseFloat(e.target.value) })}
                                              className="flex-1 accent-yellow-500 h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer"
                                            />
                                          </div>
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-gray-850/40">
                                        {/* Speed */}
                                        <div className="space-y-1">
                                          <label className="text-[9px] font-black text-gray-500 uppercase tracking-wide block mb-1">Velocidad</label>
                                          <div className="flex items-center gap-1 rounded bg-gray-955 p-0.5 w-fit border border-gray-800">
                                            {[0.5, 1.0, 1.25, 1.5, 2.0].map(speedVal => {
                                              const isActive = (slide.videoSpeed ?? 1.0) === speedVal;
                                              return (
                                                <button
                                                  key={speedVal}
                                                  type="button"
                                                  onClick={() => handleUpdateVideoParams(idx, { speed: speedVal })}
                                                  className={`text-[9px] font-bold px-2 py-0.5 rounded transition-all cursor-pointer ${isActive ? 'bg-yellow-600 text-white font-black' : 'text-gray-400 hover:text-gray-200'}`}
                                                >
                                                  {speedVal}x
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>

                                        {/* Loop checkbox */}
                                        <div className="space-y-1">
                                          <label className="text-[9px] font-black text-gray-500 uppercase tracking-wide block mb-1.5">Reproducción</label>
                                          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-gray-300 hover:text-white select-none pt-1">
                                            <input
                                              type="checkbox"
                                              checked={slide.videoLoop !== false}
                                              onChange={e => handleUpdateVideoParams(idx, { loop: e.target.checked })}
                                              className="accent-yellow-500 h-4 w-4 rounded border-gray-700 bg-gray-900 cursor-pointer"
                                            />
                                            <span>Repetir en Bucle</span>
                                          </label>
                                        </div>

                                        {/* Start / End Times */}
                                        <div className="space-y-1">
                                          <label className="text-[9px] font-black text-gray-500 uppercase tracking-wide block">Intervalo (segundos)</label>
                                          <div className="flex items-center gap-2">
                                            <div className="flex-1 flex items-center gap-1.5 bg-gray-955 rounded px-2 py-1 border border-gray-800">
                                              <span className="text-[8px] font-bold text-gray-550">INICIO</span>
                                              <input
                                                type="number"
                                                min="0"
                                                max={maxDuration}
                                                placeholder="0"
                                                value={slide.videoStart !== undefined ? slide.videoStart : ''}
                                                onChange={e => {
                                                  let val = e.target.value !== '' ? parseFloat(e.target.value) : undefined;
                                                  if (val !== undefined && maxDuration && val > maxDuration) {
                                                    val = maxDuration;
                                                  }
                                                  handleUpdateVideoParams(idx, { startTime: val });
                                                }}
                                                className="w-full bg-transparent text-xs text-white focus:outline-none font-bold"
                                              />
                                            </div>
                                            <div className="flex-1 flex items-center gap-1.5 bg-gray-955 rounded px-2 py-1 border border-gray-800">
                                              <span className="text-[8px] font-bold text-gray-550">FINAL</span>
                                              <input
                                                type="number"
                                                min="0"
                                                max={maxDuration}
                                                placeholder="Fin"
                                                value={slide.videoEnd !== undefined ? slide.videoEnd : ''}
                                                onChange={e => {
                                                  let val = e.target.value !== '' ? parseFloat(e.target.value) : undefined;
                                                  if (val !== undefined && maxDuration && val > maxDuration) {
                                                    val = maxDuration;
                                                  }
                                                  handleUpdateVideoParams(idx, { endTime: val });
                                                }}
                                                className="w-full bg-transparent text-xs text-white focus:outline-none font-bold"
                                              />
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ) : isImage ? (
                                    /* Pure Image Slide Banner */
                                    <div className="flex items-center gap-3 bg-blue-950/10 border border-blue-900/20 rounded-lg p-3.5 shadow-sm w-full">
                                      <div className="p-2 rounded bg-blue-950/50 border border-blue-800/30 text-blue-400">
                                        <ImageIcon size={15} />
                                      </div>
                                      <div className="space-y-0.5">
                                        <span className="text-[10px] font-black text-blue-300 uppercase tracking-wide block">Diapositiva de Imagen Pura</span>
                                        <p className="text-[11px] text-gray-400 leading-relaxed max-w-lg">
                                          Esta diapositiva oculta por completo el cuadro de texto translúcido en la pantalla de proyección, permitiendo apreciar la imagen o el video de fondo a pantalla completa.
                                        </p>
                                      </div>
                                    </div>
                                  ) : (
                                    /* Standard Text Slide */
                                    <div className="flex flex-col gap-2">
                                      {mode === 'standard' ? (
                                        <div>
                                          <AutoResizeTextarea
                                            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-yellow-500 min-h-[3.5rem] leading-relaxed resize-y"
                                            value={slide.lines[0] || ''}
                                            onChange={e => handleUpdateLine(idx, 0, e.target.value)}
                                            placeholder={isTitle ? 'Escribe el título...' : 'Escribe la letra de la diapositiva...'}
                                          />
                                        </div>
                                      ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                          {/* Hebrew Text */}
                                          <div className="space-y-1">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Hebreo</span>
                                            <AutoResizeTextarea
                                              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-yellow-500 min-h-[3rem] leading-relaxed resize-y"
                                              dir="rtl"
                                              value={slide.lines[0] || ''}
                                              onChange={e => handleUpdateLine(idx, 0, e.target.value)}
                                              placeholder={isTitle ? 'Título hebreo...' : 'Frase en hebreo...'}
                                            />
                                          </div>
                                          {/* Transliterated Text */}
                                          <div className="space-y-1">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Transliteración</span>
                                            <AutoResizeTextarea
                                              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-yellow-500 min-h-[3rem] leading-relaxed resize-y"
                                              value={slide.lines[1] || ''}
                                              onChange={e => handleUpdateLine(idx, 1, e.target.value)}
                                              placeholder={isTitle ? 'Título transliterado...' : 'Frase transliterada...'}
                                            />
                                          </div>
                                          {/* Translated Text */}
                                          <div className="space-y-1">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Traducción</span>
                                            <AutoResizeTextarea
                                              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-yellow-500 min-h-[3rem] leading-relaxed resize-y"
                                              value={slide.lines[2] || ''}
                                              onChange={e => handleUpdateLine(idx, 2, e.target.value)}
                                              placeholder={isTitle ? 'Título traducido...' : 'Frase traducida...'}
                                            />
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </td>

                                {/* 3. Dropdown Background select */}
                                <td className="px-3 py-3 align-top text-center">
                                  <div className="flex flex-col gap-1.5 items-center justify-center">
                                    {/* Slide Mini-Preview container */}
                                    <div className="relative h-[2.5rem] w-[4.5rem] rounded-md border border-gray-700 bg-black overflow-hidden shadow-md flex items-center justify-center">
                                      {customBg ? (
                                        isVideo ? (
                                          <video
                                            src={customBg}
                                            autoPlay
                                            loop
                                            muted
                                            playsInline
                                            className="absolute inset-0 h-full w-full object-cover opacity-60"
                                          />
                                        ) : (
                                          <img src={customBg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
                                        )
                                      ) : (
                                        <div className="absolute inset-0 h-full w-full bg-[radial-gradient(circle_at_30%_20%,#29415f,#09111f_55%,#020617)] opacity-60" />
                                      )}
                                      <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-black/30" />

                                      {/* Slide Label inside preview */}
                                      <div className="absolute top-1 left-1 bg-black/70 border border-gray-700 rounded px-1 text-[8px] text-gray-300 z-10 font-bold">
                                        {slide.label}
                                      </div>

                                      {/* Slide Content with AutoResizeText */}
                                      <div className="absolute inset-0 p-1 flex items-center justify-center">
                                        {(() => {
                                          const isFb = slide.lines.length === 3 &&
                                            (slide.lines[1] === '-' || slide.lines[1] === '>-' || slide.lines[1] === '') &&
                                            (slide.lines[2] === '-' || slide.lines[2] === '>-' || slide.lines[2] === '');
                                          if (slide.lines.length === 3 && !isFb) {
                                            return (
                                              <div className="flex flex-col gap-0.5 w-full h-full justify-center">
                                                {slide.lines.map((line, lIdx) => (
                                                  <div key={lIdx} className="overflow-hidden flex-1 flex items-center justify-center max-h-[30%]">
                                                    <AutoResizeText
                                                      text={line}
                                                      fontScale={fontScale * 0.25}
                                                      className={`font-semibold text-center select-none ${lIdx === 0
                                                        ? 'hebrew-text text-[#f3c96a] text-[4px]'
                                                        : lIdx === 1
                                                          ? 'text-sky-200 text-[3px]'
                                                          : 'text-white text-[3px]'
                                                        }`}
                                                    />
                                                  </div>
                                                ))}
                                              </div>
                                            );
                                          } else {
                                            return (
                                              <div className="w-full h-full flex items-center justify-center p-0.5 overflow-hidden">
                                                <AutoResizeText
                                                  text={slide.lines[0]}
                                                  fontScale={fontScale * 0.28}
                                                  className="font-bold text-white text-center drop-shadow text-[5px] select-none"
                                                />
                                              </div>
                                            );
                                          }
                                        })()}
                                      </div>
                                    </div>

                                    {/* Custom search autocomplete for slide background, opens upward */}
                                    <div className="w-[130px]">
                                      <CustomSearchSelect
                                        value={slide.background || 'Principal'}
                                        onChange={val => handleUpdateSlideBg(idx, val)}
                                        options={[
                                          { label: 'Principal', value: 'Principal' },
                                          { label: 'Ignorar', value: 'Ignorar' },
                                          { label: 'Anterior', value: 'Anterior' },
                                          ...backgrounds.map(background => ({
                                            label: background.split('/').pop() || background,
                                            value: background
                                          }))
                                        ]}
                                        placeholder="Defecto / Fondo..."
                                        dropdownWidthClass="w-[200px] -left-10"
                                        openDirection="up"
                                      />
                                    </div>
                                  </div>
                                </td>

                                {/* 4. Slide ordering column */}
                                <td className="px-3 py-3 align-top text-center">
                                  <div className="flex flex-col gap-2.5 items-center justify-center">
                                    {/* Fila 1: Acciones básicas */}
                                    <div className="flex items-center justify-center gap-1">
                                      {mode === 'trilingual' && (
                                        <button
                                          type="button"
                                          onClick={() => handleTransliterateRow(idx)}
                                          className="p-1 rounded border border-sky-950 bg-sky-950/20 text-sky-400 hover:bg-sky-900/40 hover:text-sky-300 transition-colors z-10 cursor-pointer"
                                          title="Transliterar fila"
                                        >
                                          <Languages size={13} />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        disabled={idx <= 1}
                                        onClick={() => handleMoveUp(idx)}
                                        className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-gray-700/60 rounded transition-colors cursor-pointer"
                                        title="Subir"
                                      >
                                        <ArrowUp size={13} />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={idx === 0 || idx === slides.length - 1}
                                        onClick={() => handleMoveDown(idx)}
                                        className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-gray-700/60 rounded transition-colors cursor-pointer"
                                        title="Bajar"
                                      >
                                        <ArrowDown size={13} />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isTitle}
                                        onClick={() => handleDeleteSlide(idx)}
                                        className="p-1 text-red-400 hover:text-red-300 hover:bg-red-950/20 disabled:opacity-30 disabled:pointer-events-none rounded transition-colors cursor-pointer"
                                        title="Borrar diapositiva"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>

                                    {/* Fila 2: Selector de tipo de diapositiva (solo iconos compactos en gris/activo) */}
                                    {!isTitle && (
                                      <div className="flex flex-col items-center gap-1 mt-1 bg-gray-950/40 border border-gray-800/60 rounded py-1 px-2.5 w-fit">

                                        {/* Primera línea */}
                                        <div className="flex items-center justify-center gap-3.5">
                                          <button
                                            type="button"
                                            onClick={() => handleChangeSlideType(idx, 'text')}
                                            className={`transition-colors cursor-pointer p-0.5 ${!isImage && slide.type !== 'video' && slide.type !== 'tanaj' && slide.type !== 'sefer'
                                              ? 'text-yellow-500 font-bold'
                                              : 'text-gray-500 hover:text-gray-350'
                                              }`}
                                            title="Tipo: Texto normal"
                                          >
                                            <FileText size={12} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleChangeSlideType(idx, 'video')}
                                            className={`transition-colors cursor-pointer p-0.5 ${slide.type === 'video'
                                              ? 'text-yellow-500 font-bold'
                                              : 'text-gray-500 hover:text-gray-350'
                                              }`}
                                            title="Tipo: Video"
                                          >
                                            <Video size={12} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleChangeSlideType(idx, 'image')}
                                            className={`transition-colors cursor-pointer p-0.5 ${isImage
                                              ? 'text-yellow-500 font-bold'
                                              : 'text-gray-500 hover:text-gray-350'
                                              }`}
                                            title="Tipo: Imagen Pura"
                                          >
                                            <ImageIcon size={12} />
                                          </button>
                                        </div>

                                        {/* Segunda línea */}
                                        <div className="flex items-center justify-center gap-3.5">

                                          <button
                                            type="button"
                                            onClick={() => handleChangeSlideType(idx, 'tanaj')}
                                            className={`transition-colors cursor-pointer p-0.5 ${slide.type === 'tanaj'
                                              ? 'text-yellow-500 font-bold'
                                              : 'text-gray-500 hover:text-gray-350'
                                              }`}
                                            title="Tipo: Tanaj materializado"
                                          >
                                            <BookOpen size={12} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleChangeSlideType(idx, 'sefer')}
                                            className={`transition-colors cursor-pointer p-0.5 ${slide.type === 'sefer'
                                              ? 'text-yellow-500 font-bold'
                                              : 'text-gray-500 hover:text-gray-350'
                                              }`}
                                            title="Tipo: Sefer nativo"
                                          >
                                            <ScrollText size={12} />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Add Slide button with integrated secondary shortcuts */}
                    <div className="mt-1 flex items-center justify-between gap-2 w-full rounded-md border border-dashed border-gray-650 bg-gray-900/20 px-3 py-2 text-xs font-bold shadow-sm">
                      {/* Left: + Image Shortcut */}
                      <button
                        type="button"
                        onClick={handleAddImageSlide}
                        className="flex items-center gap-1 text-gray-500 hover:text-white transition-colors cursor-pointer pr-2 border-r border-gray-800"
                        title="Añadir Diapositiva de Imagen Pura (+ 🖼️)"
                      >
                        <span className="text-[11px] font-black text-gray-400">+</span>
                        <ImageIcon size={14} className="text-gray-400" />
                      </button>

                      {/* Center: Main Add Slide */}
                      <button
                        type="button"
                        onClick={handleAddSlide}
                        className="flex-1 flex items-center justify-center gap-1.5 text-gray-300 hover:text-white transition-all cursor-pointer py-0.5"
                      >
                        <Plus size={14} />
                        <span>Añadir Nueva Diapositiva</span>
                      </button>

                      {/* Right: + Video Shortcut */}
                      <button
                        type="button"
                        onClick={handleAddVideoSlide}
                        className="flex items-center gap-1 text-gray-500 hover:text-white transition-colors cursor-pointer pl-2 border-l border-gray-800"
                        title="Añadir Diapositiva de Video (+ 🎥)"
                      >
                        <span className="text-[11px] font-black text-gray-400">+</span>
                        <Video size={14} className="text-gray-400" />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Text Editor Area (Quick Edit) */
                  mode === 'standard' ? (
                    <div className="flex flex-col gap-3">
                      <textarea
                        className={`${textareaClass} min-h-[20rem] md:min-h-[26rem]`}
                        value={standardText}
                        onChange={e => setStandardText(e.target.value)}
                        placeholder={'#Coro\nEste es un ejemplo de coro.\n\nEste es el párrafo 1.'}
                      />
                      <FormatLegend />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Hebreo</label>
                          <button
                            type="button"
                            onClick={handleTransliterate}
                            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-blue-500"
                            title="Generar transliteración del texto en hebreo"
                          >
                            <Languages size={13} />
                            <span>Transliterar</span>
                          </button>
                        </div>
                        <textarea
                          className={`${textareaClass} min-h-[20rem] md:min-h-[24rem]`}
                          value={hebText}
                          onChange={e => setHebText(e.target.value)}
                          dir="rtl"
                          placeholder={'> Mi título\n#1\nשְׁמַע יִשְׂרָאֵל'}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Transliteración</label>
                        <textarea
                          className={`${textareaClass} min-h-[20rem] md:min-h-[24rem]`}
                          value={transText}
                          onChange={e => setTransText(e.target.value)}
                          placeholder={'> Mi título\nShemá Israel'}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Traducción</label>
                        <textarea
                          className={`${textareaClass} min-h-[20rem] md:min-h-[24rem]`}
                          value={traText}
                          onChange={e => setTraText(e.target.value)}
                          placeholder={'> Mi título\nEscucha Israel'}
                        />
                      </div>

                      <FormatLegend />
                    </div>
                  )
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MenuPopup;
