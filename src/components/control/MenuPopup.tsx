import React, { useEffect, useState, useRef } from 'react';
import type { Presentation, Slide, VideoState, AppMode, ScriptureNavState } from '../../types/presentation';
import type { SeferReaderState } from '../../hooks/useSeferReader';
import { transliterateText } from '../../utils/transliterate';
import { parseVideoSlideString } from '../../utils/videoUtils';
import { materializeScriptureSlides, parseScriptureTag, scriptureSlideToTag } from '../../utils/scriptureLookup';
import { ArrowUp, Pencil, Maximize2, Minimize2, Music, ArrowUpDown } from 'lucide-react';
import SeferControlPanel from './SeferControlPanel';
import SeferControlPanelMini from './SeferControlPanelMini';
import SlideVisualizer from '../shared/SlideVisualizer';
import { BackgroundSelector } from './BackgroundSelector';
import { VideoControls } from './VideoControls';
import { AudioPanel } from './AudioPanel';
import { PresentationList } from './PresentationList';
import { PresentationEditor } from './PresentationEditor';
import { CustomSearchSelect } from '../shared/CustomSearchSelect';
import type { AudioState, AudioSyncMap } from '../../types/audio';

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
  audioState: AudioState;
  audioSyncMaps: AudioSyncMap[];
  availableAudioFiles: string[];
  onAudioStateChange: (state: AudioState) => void;
  onAudioSyncMapsChange: (maps: AudioSyncMap[]) => void;
  onResetState?: () => void;
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

;


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
  onUpdateScriptureFontSizes = () => { },
  audioState,
  audioSyncMaps,
  availableAudioFiles,
  onAudioStateChange,
  onResetState,
}) => {
  // ────────────────────────────────────────────────────────────────
  // States
  // ────────────────────────────────────────────────────────────────
  const activeSlide = currentPresentation && currentSlideIndex >= 0 && currentSlideIndex < currentPresentation.slides.length
    ? currentPresentation.slides[currentSlideIndex]
    : null;
  const isActiveScriptureSlide = !!activeSlide && (activeSlide.type === 'sefer' || activeSlide.type === 'tanaj' || !!activeSlide.scriptureBook);

  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [bg, setBg] = useState('');

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMusicPanelOpen, setIsMusicPanelOpen] = useState(false);
  
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // ────────────────────────────────────────────────────────────────
  // Effects
  // ────────────────────────────────────────────────────────────────
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

    const handleOpenAudioEditor = () => {
    const width = 1100;
    const height = 800;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    window.open(
      `${window.location.origin}${window.location.pathname}?mode=audio-editor`,
      'AudioSyncEditor',
      `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes`
    );
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
  // Local video state for scrubbing (prevents slider fighting telemetry)
  
  

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

  

  

  // ────────────────────────────────────────────────────────────────
  // Handlers
  // ────────────────────────────────────────────────────────────────
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
      { id: 'slide-title', label: 'Título', lines: ['', '-', '-'] }
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
      { id: 'slide-title', label: 'Título', lines: ['', '-', '-'] }
    ]);
    setIsTableMode(true);
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
        const fallbackVal = '-';
        if (newMode === 'trilingual') {
          const l1 = slide.lines[1] !== undefined && slide.lines[1] !== '' ? slide.lines[1] : fallbackVal;
          const l2 = slide.lines[2] !== undefined && slide.lines[2] !== '' ? slide.lines[2] : fallbackVal;
          return {
            ...slide,
            lines: [slide.lines[0] || '', l1, l2]
          };
        } else {
          return {
            ...slide,
            lines: [slide.lines[0] || '', fallbackVal, fallbackVal]
          };
        }
      });
      setSlides(newSlides);
    } else {
      const parsed = await buildSlidesForSave();
      if (newMode === 'trilingual') {
        const mapped = parsed.slides.map(slide => {
          const fallbackVal = '-';
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
        const mapped = parsed.slides.map(slide => {
          const fallbackVal = '-';
          return {
            ...slide,
            lines: [scriptureSlideToTag(slide) || slide.lines[0] || '', fallbackVal, fallbackVal]
          };
        });
        setSlides(mapped);
        setStandardText(getStandardTextFromSlides(mapped));
      }
    }
  };

  const handleAddSlide = () => {
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const newId = `slide-${slides.length}-${Date.now()}-${randomSuffix}`;
    const newLabel = (slides.length).toString();
    const newSlide: Slide = { id: newId, label: newLabel, lines: [] };
    const fallbackVal = '-';
    newSlide.lines = ['', fallbackVal, fallbackVal];
    setSlides([...slides, newSlide]);
  };

  const handleAddImageSlide = () => {
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const newId = `slide-img-${slides.length}-${Date.now()}-${randomSuffix}`;
    const newLabel = (slides.length).toString();
    const newSlide: Slide = { id: newId, label: newLabel, lines: [] };
    const fallbackVal = '-';
    newSlide.lines = ['[IMAGE]', fallbackVal, fallbackVal];
    setSlides([...slides, newSlide]);
  };

  const handleAddVideoSlide = () => {
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const newId = `slide-video-${slides.length}-${Date.now()}-${randomSuffix}`;
    const newLabel = (slides.length).toString();
    const newSlide: Slide = {
      id: newId,
      label: newLabel,
      lines: [],
      type: 'video' as const,
      videoSrc: '',
      videoVolume: 0.8,
      videoSpeed: 1.0,
      videoLoop: true,
      videoPresenterNav: true
    };
    const fallbackVal = '-';
    newSlide.lines = ['[VIDEO - "" - 0.8 - 1.0 - 1 - 1]', fallbackVal, fallbackVal];

    setSlides([...slides, newSlide]);
  };

  const handleChangeSlideType = (idx: number, newType: 'text' | 'video' | 'image' | 'tanaj' | 'sefer') => {
    const updated = [...slides];
    const slide = { ...updated[idx] };
    const fallbackVal = '-';

    if (newType === 'text') {
      delete slide.type;
      delete slide.videoSrc;
      delete slide.videoVolume;
      delete slide.videoSpeed;
      delete slide.videoStart;
      delete slide.videoEnd;
      delete slide.videoPresenterNav;
      delete slide.scriptureBook;
      delete slide.scriptureChapter;
      delete slide.scriptureVerseStart;
      delete slide.scriptureVerseEnd;

      const cleanLine = (l: string) => {
        if (l.trim() === '[IMAGE]' || l.trim().startsWith('[VIDEO')) return '';
        return l;
      };
      const cleanLines = slide.lines.map(cleanLine);
      slide.lines = [
        cleanLines[0] || '',
        cleanLines[1] !== undefined ? cleanLines[1] : fallbackVal,
        cleanLines[2] !== undefined ? cleanLines[2] : fallbackVal
      ];
    } else if (newType === 'image') {
      delete slide.type;
      delete slide.videoSrc;
      delete slide.videoVolume;
      delete slide.videoSpeed;
      delete slide.videoStart;
      delete slide.videoEnd;
      delete slide.videoPresenterNav;
      delete slide.scriptureBook;
      delete slide.scriptureChapter;
      delete slide.scriptureVerseStart;
      delete slide.scriptureVerseEnd;

      slide.lines = ['[IMAGE]', fallbackVal, fallbackVal];
    } else if (newType === 'video') {
      slide.type = 'video';
      slide.videoSrc = slide.videoSrc || '';
      slide.videoVolume = slide.videoVolume ?? 0.8;
      slide.videoSpeed = slide.videoSpeed ?? 1.0;
      slide.videoLoop = slide.videoLoop ?? true;
      slide.videoPresenterNav = slide.videoPresenterNav ?? true;
      delete slide.scriptureBook;
      delete slide.scriptureChapter;
      delete slide.scriptureVerseStart;
      delete slide.scriptureVerseEnd;

      const startStr = slide.videoStart !== undefined ? slide.videoStart : '';
      const endStr = slide.videoEnd !== undefined ? slide.videoEnd : '';
      const loopStr = slide.videoLoop !== false ? '1' : '0';
      const presenterNavStr = slide.videoPresenterNav !== false ? '1' : '0';
      const parts = [
        'VIDEO',
        `"${slide.videoSrc}"`,
        slide.videoVolume.toString(),
        slide.videoSpeed.toString(),
        loopStr,
        presenterNavStr,
        startStr.toString(),
        endStr.toString()
      ];
      while (parts.length > 6 && parts[parts.length - 1] === '') {
        parts.pop();
      }
      slide.lines = [`[${parts.join(' - ')}]`, fallbackVal, fallbackVal];
    } else if (newType === 'tanaj' || newType === 'sefer') {
      slide.type = newType;
    }

    updated[idx] = slide;
    setSlides(updated);
  };

  const handleUpdateVideoParams = (
    idx: number,
    params: { videoSrc?: string; volume?: number; speed?: number; loop?: boolean; presenterNav?: boolean; startTime?: number; endTime?: number }
  ) => {
    const updated = [...slides];
    const slide = { ...updated[idx] };
    const fallbackVal = '-';

    if (slide.type === 'video') {
      if ('videoSrc' in params) slide.videoSrc = params.videoSrc;
      if ('volume' in params) slide.videoVolume = params.volume;
      if ('speed' in params) slide.videoSpeed = params.speed;
      if ('loop' in params) slide.videoLoop = params.loop;
      if ('presenterNav' in params) slide.videoPresenterNav = params.presenterNav;
      if ('startTime' in params) slide.videoStart = params.startTime;
      if ('endTime' in params) slide.videoEnd = params.endTime;

      const startVal = slide.videoStart !== undefined && !isNaN(slide.videoStart) ? slide.videoStart : '';
      const endVal = slide.videoEnd !== undefined && !isNaN(slide.videoEnd) ? slide.videoEnd : '';
      const loopStr = slide.videoLoop !== false ? '1' : '0';
      const presenterNavStr = slide.videoPresenterNav !== false ? '1' : '0';
      const parts = [
        'VIDEO',
        `"${slide.videoSrc || ''}"`,
        (slide.videoVolume ?? 0.8).toString(),
        (slide.videoSpeed ?? 1.0).toString(),
        loopStr,
        presenterNavStr,
        startVal.toString(),
        endVal.toString()
      ];
      while (parts.length > 6 && parts[parts.length - 1] === '') {
        parts.pop();
      }
      slide.lines = [`[${parts.join(' - ')}]`, fallbackVal, fallbackVal];
    }

    updated[idx] = slide;
    setSlides(updated);
  };

  const handleUpdateImagePresenterNav = (idx: number, visible: boolean) => {
    const updated = [...slides];
    const slide = { ...updated[idx] };
    if (slide.lines[0]?.trim() === '[IMAGE]') {
      slide.videoPresenterNav = visible;
      updated[idx] = slide;
      setSlides(updated);
    }
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
    const cleanForSort = (str: string) =>
      (str || '')
        .replace(/[¡!¿?]/g, '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const sorted = [...presentations].sort((a, b) =>
      cleanForSort(a.title).localeCompare(cleanForSort(b.title))
    );
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
      lines: [hasTitleMarker ? titleLines.join('\n') : (titleLines.join('\n') || title.trim()), '-', '-']
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
        const randomSuffix = Math.random().toString(36).substring(2, 9);
        if (videoData) {
          return {
            id: `slide-${idx}-${Date.now()}-${randomSuffix}`,
            label,
            lines: [content.trim(), '-', '-'],
            type: 'video' as const,
            videoSrc: videoData.videoSrc,
            videoVolume: videoData.volume,
            videoSpeed: videoData.speed,
            videoLoop: videoData.loop,
            videoStart: videoData.startTime,
            videoEnd: videoData.endTime
          };
        }

        return { id: `slide-${idx}-${Date.now()}-${randomSuffix}`, label, lines: [content.trim(), '-', '-'] };
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
      lines: [hebData.title || '', transData.title || '-', traData.title || '-']
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
        const randomSuffix = Math.random().toString(36).substring(2, 9);
        if (videoData) {
          return {
            id: `slide-${idx}-${Date.now()}-${randomSuffix}`,
            label,
            lines: [contentHeb.trim(), row.transliteration.trim() || '-', row.translation.trim() || '-'],
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
          id: `slide-${idx}-${Date.now()}-${randomSuffix}`,
          label,
          lines: [contentHeb.trim(), row.transliteration.trim() || '-', row.translation.trim() || '-']
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
      const normalizedSlides = slides.map(slide => {
        const fallbackVal = '-';
        return {
          ...slide,
          lines: [
            slide.lines[0] || '',
            slide.lines[1] !== undefined && slide.lines[1] !== '' ? slide.lines[1] : fallbackVal,
            slide.lines[2] !== undefined && slide.lines[2] !== '' ? slide.lines[2] : fallbackVal
          ]
        };
      });
      return { slides: normalizedSlides, mode: nextMode };
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
        lines: [hasTitleMarker ? titleLines.join('\n') : (titleLines.join('\n') || title.trim()), '-', '-']
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
        const randomSuffix = Math.random().toString(36).substring(2, 9);
        if (videoData) {
          parsed.push({
            id: `slide-${idx}-${Date.now()}-${randomSuffix}`,
            label,
            lines: [content.trim(), '-', '-'],
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

        parsed.push({ id: `slide-${idx}-${Date.now()}-${randomSuffix}`, label, lines: [content.trim(), '-', '-'] });
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
      lines: [hebData.title || '', transData.title || '-', traData.title || '-']
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
          lines: [contentHeb.trim(), row.transliteration.trim() || '-', row.translation.trim() || '-'],
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
        lines: [contentHeb.trim(), row.transliteration.trim() || '-', row.translation.trim() || '-']
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
    <div id="section-menu-popup-container" className="flex h-full w-full flex-col bg-gray-800 text-white">
      {/* ── Menu Header ───────────────────────────────── */}
      <div id="section-menu-header" className="flex items-center justify-between border-b border-gray-700 bg-gray-900 px-4 py-3 md:px-5 md:py-4">
        <h2 className="flex items-center gap-2 text-lg font-bold md:text-xl">
          <img
            src="/logo.svg"
            alt="Logo"
            className="h-7 w-7 cursor-pointer hover:opacity-85 active:scale-95 transition-all"
            title="Restablecer estado del presentador"
            onClick={() => setShowResetConfirm(true)}
          />
          <span>Gestor de Presentaciones</span>
        </h2>
        <div className="flex items-center gap-2">
          {/* Music Controller Button */}
          <button
            type="button"
            onClick={() => setIsMusicPanelOpen(!isMusicPanelOpen)}
            className={`flex items-center justify-center p-2 text-xs font-semibold rounded border transition-all cursor-pointer ${isMusicPanelOpen
                ? 'bg-orange-600 border-orange-500 text-white font-bold'
                : audioState.volume === 0
                  ? 'bg-red-600 border-red-500 text-white font-bold animate-pulse'
                  : !audioState.isPlaying || !audioState.audioSrc
                    ? 'bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white'
                    : audioState.syncMode === 'unilateral'
                      ? 'bg-sky-600 border-sky-500 text-white font-bold'
                      : audioState.syncMode === 'bilateral'
                        ? 'bg-emerald-600 border-emerald-500 text-white font-bold'
                        : 'bg-orange-600 border-orange-500 text-white font-bold'
              }`}
            title={isMusicPanelOpen ? "Cerrar panel de música" : "Abrir panel de música y sincronización"}
          >
            {audioState.volume === 0 ? (
              <div className="relative">
                <Music size={14} className="text-red-200" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-red-300 font-extrabold text-sm select-none pointer-events-none" style={{ transform: 'rotate(45deg)' }}>/</span>
                </div>
              </div>
            ) : audioState.syncMode === 'unilateral' && audioState.isPlaying ? (
              <div className="flex items-center gap-0.5">
                <Music size={13} />
                <ArrowUp size={10} className="stroke-[3]" />
              </div>
            ) : audioState.syncMode === 'bilateral' && audioState.isPlaying ? (
              <div className="flex items-center gap-0.5">
                <Music size={13} />
                <ArrowUpDown size={10} className="stroke-[3]" />
              </div>
            ) : (
              <Music size={14} />
            )}
          </button>

          {/* Toggle app mode button */}
          <button
            type="button"
            onClick={() => onToggleAppMode && onToggleAppMode(appMode === 'seferManual' ? 'slides' : 'seferManual')}
            className={`flex items-center justify-center p-2 text-xs font-semibold rounded border transition-all cursor-pointer ${appMode === 'seferManual'
                ? 'bg-yellow-600 border-yellow-500 text-white font-bold'
                : 'bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white'
              }`}
            title={appMode === 'seferManual' ? "Volver a la diapositiva" : "Activar Sefer manual"}
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

      {/* ── App Mode Wrapper ───────────────────────────────── */}
      <div id="section-app-mode-wrapper" className="flex-1 min-h-0 overflow-auto flex flex-col">
        {isMusicPanelOpen && (
<AudioPanel
            audioState={audioState}
            onAudioStateChange={onAudioStateChange}
            audioSyncMaps={audioSyncMaps}
            availableAudioFiles={availableAudioFiles}
            presentations={presentations}
            currentPresentation={currentPresentation}
            onSelectPresentation={onSelectPresentation}
            handleOpenAudioEditor={handleOpenAudioEditor}
          />
        )}

        {appMode === 'seferManual' && (
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
          {/* ── Visor Superior Panel ───────────────────────────────── */}
          <div id="section-viewer-top-panel" className="border-b border-gray-700 bg-gray-900/50 p-3 md:p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">

              {/* ── Viewer Controls Left ───────────────────────────────── */}
              <div id="section-viewer-controls-left" className="flex flex-col gap-3 sm:flex-row sm:items-end lg:w-[420px] lg:flex-none">
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
                <BackgroundSelector
                  activeBackground={activeBackground}
                  currentPresentation={currentPresentation}
                  backgrounds={backgrounds}
                  onSelectBackgroundOverride={onSelectBackgroundOverride}
                  backgroundLock={backgroundLock}
                  onToggleBackgroundLock={onToggleBackgroundLock}
                />
              </div>

              {/* ── Live Navigation ───────────────────────────────── */}
              <div id="section-live-navigation" className="flex-1 min-w-0 flex flex-col justify-center rounded-md bg-gray-900/60 border border-gray-700/60 p-2.5 sm:p-3 shadow-inner">
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
                              onClick={() => onSelectSlide(idx)}
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

                    {/* ── Sefer Control Panel Mini ───────────────────────────────── */}
                    {appMode !== 'seferManual' && isActiveScriptureSlide && scriptureState && (
                      <div id="section-sefer-control-mini" className="rounded-md border border-gray-800 bg-gray-950/50">
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

                    {/* ── Video Player Controller ───────────────────────────────── */}
                    <VideoControls
                      activeSlide={activeSlide!}
                      videoState={videoState}
                      onVideoStateChange={onVideoStateChange}
                    />
                  </div>
                ) : (
                  <div className="text-center py-2 text-xs text-gray-500 italic">
                    Ninguna presentación activa para proyectar
                  </div>
                )}
              </div>

            </div>
          </div>

          <SlideVisualizer
            slide={activeSlide}
            appMode={appMode}
            scriptureState={scriptureState}
          />

          {/* ── Main Area ───────────────────────────────── */}
          <div id="section-main-area" className="flex-1 overflow-y-auto p-3 md:p-4">
            {editorMode === 'list' ? (
              /* ── Presentation Manager (List Mode) ───────────────────────────────── */
              <PresentationList
                presentations={presentations}
                currentPresentation={currentPresentation}
                onImport={onImport}
                onSelectPresentation={onSelectPresentation}
                onStartEditing={handleStartEditing}
                onStartEditingNew={handleStartEditingNew}
                onMovePresentationUp={handleMovePresentationUp}
                onMovePresentationDown={handleMovePresentationDown}
                onDeletePresentation={handleDeletePresentation}
                onSortPresentationsAZ={handleSortPresentationsAZ}
              />
            ) : (
              /* -- Presentation Editor (Edit Mode) --------------------------------- */
              <PresentationEditor
                id={id}
                title={title}
                setTitle={setTitle}
                bg={bg}
                setBg={setBg}
                backgrounds={backgrounds}
                slides={slides}
                setSlides={setSlides}
                mode={mode}
                fontScale={fontScale}
                setFontScale={setFontScale}
                isTableMode={isTableMode}
                setEditorMode={setEditorMode}
                currentPresentation={currentPresentation}
                currentSlideIndex={currentSlideIndex}
                videoState={videoState}
                videoDurations={videoDurations}
                expandedRows={expandedRows}
                setExpandedRows={setExpandedRows}
                standardText={standardText}
                setStandardText={setStandardText}
                hebText={hebText}
                setHebText={setHebText}
                transText={transText}
                setTransText={setTransText}
                traText={traText}
                setTraText={setTraText}
                textareaClass={textareaClass}
                handleModeChange={handleModeChange}
                toggleEditMode={toggleEditMode}
                handleSave={handleSave}
                handleTransliterateAllTable={handleTransliterateAllTable}
                getScriptureRangeRootIndex={getScriptureRangeRootIndex}
                getScriptureRangeEndIndex={getScriptureRangeEndIndex}
                isScriptureRangeRoot={isScriptureRangeRoot}
                parseSlides={parseSlides}
                onSelectPresentation={onSelectPresentation}
                handleUpdateLabel={handleUpdateLabel}
                handleUpdateScriptureVerseBackground={handleUpdateScriptureVerseBackground}
                handleUpdateScriptureSlide={handleUpdateScriptureSlide}
                handleUpdateVideoParams={handleUpdateVideoParams}
                handleUpdateImagePresenterNav={handleUpdateImagePresenterNav}
                handleUpdateLine={handleUpdateLine}
                handleUpdateSlideBg={handleUpdateSlideBg}
                handleTransliterateRow={handleTransliterateRow}
                handleMoveUp={handleMoveUp}
                handleMoveDown={handleMoveDown}
                handleDeleteSlide={handleDeleteSlide}
                handleChangeSlideType={handleChangeSlideType}
                handleAddImageSlide={handleAddImageSlide}
                handleAddSlide={handleAddSlide}
                handleAddVideoSlide={handleAddVideoSlide}
                handleTransliterate={handleTransliterate}
              />            )}
          </div>
        </div>
      </div>
      {showResetConfirm && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-sm w-full p-5 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-red-500 flex items-center gap-2">
              ⚠️ ¿Restablecer aplicación?
            </h3>
            <p className="text-xs text-gray-300 leading-relaxed font-sans">
              Esto borrará la memoria temporal de la presentación activa, desbloqueará los fondos y reiniciará el presentador a la pantalla inicial en todos los dispositivos conectados.
            </p>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResetConfirm(false);
                  if (onResetState) {
                    onResetState();
                  }
                }}
                className="px-4 py-2 bg-red-650 hover:bg-red-600 text-white rounded font-bold cursor-pointer"
              >
                Sí, restablecer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuPopup;

