import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
import React from 'react';
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, ChevronUp, FileText, HelpCircle, Image as ImageIcon, Languages, Play, ScrollText, Trash2, Video } from 'lucide-react';
import type { Presentation, QuizData, Slide, VideoState } from '../../types/presentation';
import AutoResizeText from '../shared/AutoResizeText';
import { AutoResizeInput, AutoResizeTextarea } from '../shared/AutoResizeInput';
import { CustomSearchSelect } from '../shared/CustomSearchSelect';
import { ScriptureRangeEditor } from './ScriptureRangeEditor';
import { QuizSlideEditor } from '../quiz/QuizSlideEditor';

type PresentationMode = 'standard' | 'trilingual';
type SlideType = 'text' | 'media' | 'tanaj' | 'sefer' | 'quiz';

type VideoParamUpdate = {
  mediaSrc?: string;
  mediaFit?: 'cover' | 'contain' | 'fill';
  volume?: number;
  speed?: number;
  loop?: boolean;
  presenterNav?: boolean;
  mediaShowBg?: boolean;
  startTime?: number;
  endTime?: number;
};

type ScriptureSlideUpdate = {
  scriptureBook: string;
  scriptureChapter: string;
  scriptureVerseStart: string;
  scriptureVerseEnd?: string;
  label: string;
};

interface SlideRowProps {
  slide: Slide;
  idx: number;
  slides: Slide[];
  id: string;
  title: string;
  bg: string;
  mode: PresentationMode;
  fontScale: number;
  currentPresentation: Presentation | null;
  currentSlideIndex: number;
  videoState: VideoState | null;
  videoDurations: Record<string, number>;
  expandedRows: Record<string, boolean>;
  setExpandedRows: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  backgrounds: string[];
  getScriptureRangeRootIndex: (idx: number) => number;
  getScriptureRangeEndIndex: (startIdx: number) => number;
  isScriptureRangeRoot: (slide: Slide) => boolean;
  parseSlides: () => Slide[];
  onSelectPresentation: (presentation: Presentation, slideIdx?: number, targetVerse?: string) => void;
  handleUpdateLabel: (idx: number, newLabel: string) => void;
  handleUpdateScriptureVerseBackground: (idx: number, verse: string, bgValue: string) => void;
  handleUpdateScriptureSlide: (idx: number, payload: ScriptureSlideUpdate) => void;
  handleUpdateVideoParams: (idx: number, changes: VideoParamUpdate) => void;
  handleUpdateImagePresenterNav: (idx: number, visible: boolean) => void;
  handleUpdateQuizData: (idx: number, quizData: QuizData) => void;
  handleUpdateLine: (slideIdx: number, lineIdx: number, textValue: string) => void;
  handleUpdateSlideBg: (idx: number, bgValue: string) => void;
  handleTransliterateRow: (idx: number) => void;
  handleMoveUp: (idx: number) => void;
  handleMoveDown: (idx: number) => void;
  handleDeleteSlide: (idx: number) => void;
  handleChangeSlideType: (idx: number, newType: SlideType) => void;
}

const isTitleSlide = (slide: Slide) =>
  slide.id === 'slide-title' || slide.label === 'Título';

const SlideRowComponent: React.FC<SlideRowProps> = ({
  slide,
  idx,
  slides,
  id,
  title,
  bg,
  mode,
  fontScale,
  currentPresentation,
  currentSlideIndex,
  videoState,
  videoDurations,
  expandedRows,
  setExpandedRows,
  backgrounds,
  getScriptureRangeRootIndex,
  getScriptureRangeEndIndex,
  isScriptureRangeRoot,
  parseSlides,
  onSelectPresentation,
  handleUpdateLabel,
  handleUpdateScriptureVerseBackground,
  handleUpdateScriptureSlide,
  handleUpdateVideoParams,
  handleUpdateImagePresenterNav,
  handleUpdateQuizData,
  handleUpdateLine,
  handleUpdateSlideBg,
  handleTransliterateRow,
  handleMoveUp,
  handleMoveDown,
  handleDeleteSlide,
  handleChangeSlideType,
}) => {
  useUiTranslation('control');
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

  const mediaOptions = backgrounds
    .filter(bgPath => bgPath.match(/\.(mp4|webm|jpg|jpeg|png|gif|webp)$/i))
    .map(bgPath => ({
      label: bgPath.split('/').pop() || bgPath,
      value: bgPath,
    }));

  const maxDuration = slide.mediaSrc && videoDurations[slide.mediaSrc]
    ? videoDurations[slide.mediaSrc]
    : (currentSlideIndex === idx && videoState?.duration ? videoState.duration : undefined);

  return (                              <tr key={slide.id} className={`transition-colors hover:bg-gray-800/10 ${isScriptureGroupChild ? 'bg-gray-950/15' : ''}`}>
                                {/* 1. Label column */}
                                <td className="px-3 py-3 text-center align-top">
                                  {isTitle ? (
                                    <span className="inline-block text-[11px] font-black uppercase bg-yellow-950/80 text-yellow-500 px-2 py-1 rounded-sm border border-yellow-750/30">
                                      {slide.label}
                                    </span>
                                  ) : (
                                    <div className="flex items-center justify-center gap-1">
                                      {isScriptureGroupChild && <span className="text-[10px] font-black text-gray-500">{translate("control:SlideRow.symbol", ">")}</span>}
                                      <AutoResizeInput
                                        type="text"
                                        className={`w-[60px] text-center bg-gray-900 border border-gray-700 rounded-sm px-1.5 py-1 text-xs text-white focus:outline-hidden focus:ring-1 focus:ring-yellow-500 font-bold ${isScriptureGroupChild ? 'opacity-75' : ''}`}
                                        value={slide.label}
                                        onChange={e => handleUpdateLabel(idx, e.target.value)}
                                        placeholder={translate("control:SlideRow.no", "Nº")}
                                      />
                                      {hasRangeChildren && (
                                        <button
                                          type="button"
                                          onClick={() => setExpandedRows({ ...expandedRows, [slide.id]: !groupExpanded })}
                                          className="p-1 rounded-sm bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700"
                                          title={groupExpanded ? translate("control:SlideRow.collapseBlock", "Colapsar bloque") : translate("control:SlideRow.expandBlock", "Expandir bloque")}
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
                                      className="p-1 rounded-sm bg-gray-800 hover:bg-yellow-600 hover:text-white border border-gray-750 transition-colors flex items-center justify-center cursor-pointer text-gray-400"
                                      title={translate("control:SlideRow.projectThisSlideLive", "Proyectar esta diapositiva en directo")}
                                    >
                                      <Play size={10} fill="currentColor" />
                                    </button>
                                  </div>
                                </td>

                                {/* 2. Text/Video/Image fields column */}
                                <td className={`px-3 py-3 align-top ${isScriptureGroupChild ? 'bg-gray-950/20' : ''}`}>
                                  {slide.type === 'quiz' && slide.quizData ? (
                                    <QuizSlideEditor
                                      quizData={slide.quizData}
                                      slideId={slide.id}
                                      backgrounds={backgrounds}
                                      onChange={(quizData) => handleUpdateQuizData(idx, quizData)}
                                    />
                                  ) : slide.type === 'sefer' || slide.type === 'tanaj' || !!slide.scriptureBook ? (
                                    <ScriptureRangeEditor
                                      slide={slide}
                                      backgrounds={backgrounds}
                                      onVerseBackgroundChange={(verse, value) => handleUpdateScriptureVerseBackground(idx, verse, value)}
                                      onPlayVerse={(verse) => {
                                        if (currentPresentation) {
                                          onSelectPresentation(currentPresentation, idx, verse);
                                        }
                                      }}
                                      onCommit={(payload) => handleUpdateScriptureSlide(idx, payload)}
                                    />
                                  ) : slide.type === 'media' ? (
                                    /* Video Config Panel */
                                    <div className="bg-gray-950/40 border border-gray-800/80 rounded-lg p-3 space-y-3 shadow-md w-full">
                                      <div className="flex items-center gap-2 border-b border-gray-850 pb-1.5 mb-1.5">
                                        <Video size={13} className="text-yellow-500 animate-pulse" />
                                        <span className="text-[10px] font-bold text-gray-405 uppercase tracking-wider">{translate("control:SlideRow.mediaSettings", "Configuración Multimedia")}</span>
                                      </div>

                                      {(() => {
                                        const isImageMediaConfig = slide.mediaSrc && /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(slide.mediaSrc);
                                        return (
                                          <>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                              <div className="space-y-1">
                                                <label className="text-[9px] font-black text-gray-500 uppercase tracking-wide">{translate("control:SlideRow.filePath", "Ruta del Archivo")}</label>
                                                <CustomSearchSelect
                                                  value={slide.mediaSrc || ''}
                                                  onChange={val => handleUpdateVideoParams(idx, { mediaSrc: val })}
                                                  options={mediaOptions}
                                                  placeholder={translate("control:SlideRow.selectFile", "Seleccionar archivo...")}
                                                  dropdownWidthClass="w-[260px] -start-5"
                                                  openDirection="down"
                                                />
                                              </div>
                                              <div className="space-y-1">
                                                <label className="text-[9px] font-black text-gray-500 uppercase tracking-wide">{translate("control:SlideRow.fit", "Ajuste (Fit)")}</label>
                                                <select
                                                  value={slide.mediaFit || 'cover'}
                                                  onChange={e => handleUpdateVideoParams(idx, { mediaFit: e.target.value as 'cover' | 'contain' | 'fill' })}
                                                  className="w-full bg-gray-900 border border-gray-700 rounded-sm p-1 text-xs text-gray-200 outline-hidden focus:border-yellow-500"
                                                >
                                                  <option value="cover">{translate("control:SlideRow.coverCrop", "Cover (Recortar)")}</option>
                                                  <option value="contain">{translate("control:SlideRow.containBars", "Contain (Barras)")}</option>
                                                  <option value="fill">{translate("control:SlideRow.fillStretch", "Fill (Estirar)")}</option>
                                                </select>
                                              </div>

                                              {/* Opciones generales para Image y Video */}
                                              <div className="flex flex-wrap items-center gap-6 py-2">
                                                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-gray-300 hover:text-white select-none">
                                                  <input
                                                    type="checkbox"
                                                    checked={slide.mediaPresenterNav !== false}
                                                    onChange={e => handleUpdateVideoParams(idx, { presenterNav: e.target.checked })}
                                                    className="accent-yellow-500 h-4 w-4 rounded-sm border-gray-700 bg-gray-900 cursor-pointer"
                                                  />
                                                  <span>{translate("control:SlideRow.showNav", "Mostrar Nav")}</span>
                                                </label>
                                                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-gray-300 hover:text-white select-none" title={translate("control:SlideRow.whenEnabledTheGlobalBackgroundIsRenderedBehindThis", "Si está activo, el fondo global se renderizará detrás de esta imagen/video. Ideal para modo Ajuste 'Contain'.")}>
                                                  <input
                                                    type="checkbox"
                                                    checked={slide.mediaShowBg === true}
                                                    onChange={e => handleUpdateVideoParams(idx, { mediaShowBg: e.target.checked })}
                                                    className="accent-yellow-500 h-4 w-4 rounded-sm border-gray-700 bg-gray-900 cursor-pointer"
                                                  />
                                                  <span>{translate("control:SlideRow.backgroundVisible", "Fondo Visible")}</span>
                                                </label>
                                              </div>

                                              {!isImageMediaConfig && (
                                                <div className="space-y-1">
                                                  <div className="flex items-center justify-between">
                                                    <label className="text-[9px] font-black text-gray-500 uppercase tracking-wide">{translate("control:SlideRow.volume", "Volumen")}</label>
                                                    <span className="text-[10px] font-bold text-yellow-500">{Math.round((slide.mediaVolume ?? 0.8) * 100)}%</span>
                                                  </div>
                                                  <div className="flex items-center gap-2">
                                                    <input
                                                      type="range"
                                                      min="0"
                                                      max="1"
                                                      step="0.05"
                                                      value={slide.mediaVolume ?? 0.8}
                                                      onChange={e => handleUpdateVideoParams(idx, { volume: parseFloat(e.target.value) })}
                                                      className="flex-1 accent-yellow-500 h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer"
                                                    />
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                            
                                            {!isImageMediaConfig && (
                                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-gray-850/40">
                                                <div className="space-y-1">
                                                  <label className="text-[9px] font-black text-gray-500 uppercase tracking-wide block mb-1">{translate("control:SlideRow.speed", "Velocidad")}</label>
                                                  <div className="flex items-center gap-1 rounded-sm bg-gray-955 p-0.5 w-fit border border-gray-800">
                                                    {[0.5, 1.0, 1.25, 1.5, 2.0].map(speedVal => {
                                                      const isActive = (slide.mediaSpeed ?? 1.0) === speedVal;
                                                      return (
                                                        <button
                                                          key={speedVal}
                                                          type="button"
                                                          onClick={() => handleUpdateVideoParams(idx, { speed: speedVal })}
                                                          className={`text-[9px] font-bold px-2 py-0.5 rounded-sm transition-all cursor-pointer ${isActive ? 'bg-yellow-600 text-white font-black' : 'text-gray-400 hover:text-gray-200'}`}
                                                        >
                                                          {speedVal}{translate("control:SlideRow.x", "x")}</button>
                                                      );
                                                    })}
                                                  </div>
                                                </div>

                                                <div>
                                                  <label className="text-[9px] font-black text-gray-500 uppercase tracking-wide block mb-1.5">{translate("control:SlideRow.playback", "Reproducción")}</label>
                                                  <div className="flex items-center gap-4">
                                                    <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-gray-300 hover:text-white select-none">
                                                      <input
                                                        type="checkbox"
                                                        checked={slide.mediaLoop !== false}
                                                        onChange={e => handleUpdateVideoParams(idx, { loop: e.target.checked })}
                                                        className="accent-yellow-500 h-4 w-4 rounded-sm border-gray-700 bg-gray-900 cursor-pointer"
                                                      />
                                                      <span>{translate("control:SlideRow.loop", "Bucle")}</span>
                                                    </label>
                                                  </div>
                                                </div>

                                                <div className="space-y-1">
                                                  <label className="text-[9px] font-black text-gray-500 uppercase tracking-wide block">{translate("control:SlideRow.intervalSeconds", "Intervalo (segundos)")}</label>
                                                  <div className="flex items-center gap-2">
                                                    <div className="flex-1 flex items-center gap-1.5 bg-gray-955 rounded-sm px-2 py-1 border border-gray-800">
                                                      <span className="text-[8px] font-bold text-gray-550">{translate("control:SlideRow.start", "INICIO")}</span>
                                                      <input
                                                        type="number"
                                                        min="0"
                                                        max={maxDuration}
                                                        placeholder="0"
                                                        value={slide.mediaStart !== undefined ? slide.mediaStart : ''}
                                                        onChange={e => {
                                                          let val = e.target.value !== '' ? parseFloat(e.target.value) : undefined;
                                                          if (val !== undefined && maxDuration && val > maxDuration) {
                                                            val = maxDuration;
                                                          }
                                                          handleUpdateVideoParams(idx, { startTime: val });
                                                        }}
                                                        className="w-full bg-transparent text-xs text-white focus:outline-hidden font-bold"
                                                      />
                                                    </div>
                                                    <div className="flex-1 flex items-center gap-1.5 bg-gray-955 rounded-sm px-2 py-1 border border-gray-800">
                                                      <span className="text-[8px] font-bold text-gray-550">{translate("control:SlideRow.end", "FINAL")}</span>
                                                      <input
                                                        type="number"
                                                        min="0"
                                                        max={maxDuration}
                                                        placeholder={translate("control:SlideRow.end_5a2af6", "Fin")}
                                                        value={slide.mediaEnd !== undefined ? slide.mediaEnd : ''}
                                                        onChange={e => {
                                                          let val = e.target.value !== '' ? parseFloat(e.target.value) : undefined;
                                                          if (val !== undefined && maxDuration && val > maxDuration) {
                                                            val = maxDuration;
                                                          }
                                                          handleUpdateVideoParams(idx, { endTime: val });
                                                        }}
                                                        className="w-full bg-transparent text-xs text-white focus:outline-hidden font-bold"
                                                      />
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                            )}
                                          </>
                                        );
                                      })()}
                                      </div>
                                  ) : isImage ? (
                                    /* Pure Image Slide Banner */
                                    <div className="flex items-center gap-3 bg-blue-950/10 border border-blue-900/20 rounded-lg p-3.5 shadow-xs w-full">
                                      <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-sm bg-blue-950/50 border border-blue-800/30 text-blue-400">
                                          <ImageIcon size={15} />
                                        </div>
                                        <div className="space-y-0.5">
                                          <span className="text-[10px] font-black text-blue-300 uppercase tracking-wide block">{translate("control:SlideRow.imageOnlySlide", "Diapositiva de Imagen Pura")}</span>
                                          <p className="text-[11px] text-gray-400 leading-relaxed max-w-lg">
                                            {translate("control:SlideRow.thisSlideCompletelyHidesTheTranslucentTextBoxOn", "Esta diapositiva oculta por completo el cuadro de texto translúcido en la pantalla de proyección, permitiendo apreciar la imagen o el video de fondo a pantalla completa.")}</p>
                                        </div>
                                      </div>
                                      <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-gray-300 hover:text-white select-none pt-1">
                                        <input
                                          type="checkbox"
                                          checked={slide.mediaPresenterNav !== false}
                                          onChange={e => handleUpdateImagePresenterNav(idx, e.target.checked)}
                                          className="accent-yellow-500 h-4 w-4 rounded-sm border-gray-700 bg-gray-900 cursor-pointer"
                                        />
                                        <span>{translate("control:SlideRow.nav", "Nav")}</span>
                                      </label>
                                    </div>
                                  ) : (
                                    /* Standard Text Slide */
                                    <div className="flex flex-col gap-2">
                                      {mode === 'standard' ? (
                                        <div>
                                          <AutoResizeTextarea
                                            className="w-full bg-gray-900 border border-gray-700 rounded-sm px-2 py-1.5 text-xs text-white focus:outline-hidden focus:ring-1 focus:ring-yellow-500 min-h-14 leading-relaxed resize-y"
                                            value={slide.lines[0] || ''}
                                            onChange={e => handleUpdateLine(idx, 0, e.target.value)}
                                            placeholder={isTitle ? translate("control:SlideRow.enterTheTitle", "Escribe el título...") : translate("control:SlideRow.enterTheSlideLyrics", "Escribe la letra de la diapositiva...")}
                                          />
                                        </div>
                                      ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                          {/* Hebrew Text */}
                                          <div className="space-y-1">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{translate("control:SlideRow.hebrew", "Hebreo")}</span>
                                            <AutoResizeTextarea
                                              className="w-full bg-gray-900 border border-gray-700 rounded-sm px-2 py-1 text-xs text-white focus:outline-hidden focus:ring-1 focus:ring-yellow-500 min-h-12 leading-relaxed resize-y"
                                              dir="rtl"
                                              value={slide.lines[0] || ''}
                                              onChange={e => handleUpdateLine(idx, 0, e.target.value)}
                                              placeholder={isTitle ? translate("control:SlideRow.hebrewTitle", "Título hebreo...") : translate("control:SlideRow.hebrewPhrase", "Frase en hebreo...")}
                                            />
                                          </div>
                                          {/* Transliterated Text */}
                                          <div className="space-y-1">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{translate("control:SlideRow.transliteration", "Transliteración")}</span>
                                            <AutoResizeTextarea
                                              className="w-full bg-gray-900 border border-gray-700 rounded-sm px-2 py-1 text-xs text-white focus:outline-hidden focus:ring-1 focus:ring-yellow-500 min-h-12 leading-relaxed resize-y"
                                              value={slide.lines[1] || ''}
                                              onChange={e => handleUpdateLine(idx, 1, e.target.value)}
                                              placeholder={isTitle ? translate("control:SlideRow.transliteratedTitle", "Título transliterado...") : translate("control:SlideRow.transliteratedPhrase", "Frase transliterada...")}
                                            />
                                          </div>
                                          {/* Translated Text */}
                                          <div className="space-y-1">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{translate("control:SlideRow.translation", "Traducción")}</span>
                                            <AutoResizeTextarea
                                              className="w-full bg-gray-900 border border-gray-700 rounded-sm px-2 py-1 text-xs text-white focus:outline-hidden focus:ring-1 focus:ring-yellow-500 min-h-12 leading-relaxed resize-y"
                                              value={slide.lines[2] || ''}
                                              onChange={e => handleUpdateLine(idx, 2, e.target.value)}
                                              placeholder={isTitle ? translate("control:SlideRow.translatedTitle", "Título traducido...") : translate("control:SlideRow.translatedPhrase", "Frase traducida...")}
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
                                    <div className="relative h-10 w-18 rounded-md border border-gray-700 bg-black overflow-hidden shadow-md flex items-center justify-center">
                                      {customBg ? (
                                        isVideo ? (
                                          <video
                                            src={customBg}
                                            autoPlay
                                            loop
                                            muted
                                            playsInline
                                            preload="none"
                                            className="absolute inset-0 h-full w-full object-cover opacity-60"
                                          />
                                        ) : (
                                          <img src={customBg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
                                        )
                                      ) : (
                                        <div className="absolute inset-0 h-full w-full bg-[radial-gradient(circle_at_30%_20%,#29415f,#09111f_55%,#020617)] opacity-60" />
                                      )}
                                      <div className="absolute inset-0 bg-linear-to-r from-black/60 to-black/30" />

                                      {/* Slide Label inside preview */}
                                      <div className="absolute top-1 start-1 bg-black/70 border border-gray-700 rounded-sm px-1 text-[8px] text-gray-300 z-10 font-bold">
                                        {slide.label}
                                      </div>

                                      {/* Slide Content with AutoResizeText */}
                                      <div className="absolute inset-0 p-1 flex items-center justify-center">
                                        {(() => {
                                          if (slide.type === 'media' || isImage || slide.lines[0]?.trim() === '[MEDIA]') return null;
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
                                                  className="font-bold text-white text-center drop-shadow-sm text-[5px] select-none"
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
                                        value={slide.background || "Principal"}
                                        onChange={val => handleUpdateSlideBg(idx, val)}
                                        options={[
                                          { label: translate("control:SlideRow.main", "Principal"), value: "Principal" },
                                          { label: translate("control:SlideRow.ignore", "Ignorar"), value: "Ignorar" },
                                          { label: translate("control:SlideRow.previous", "Anterior"), value: "Anterior" },
                                          ...backgrounds.map(background => ({
                                            label: background.split('/').pop() || background,
                                            value: background
                                          }))
                                        ]}
                                        placeholder={translate("control:SlideRow.defaultBackground", "Defecto / Fondo...")}
                                        dropdownWidthClass="w-[200px] -start-10"
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
                                          className="p-1 rounded-sm border border-sky-950 bg-sky-950/20 text-sky-400 hover:bg-sky-900/40 hover:text-sky-300 transition-colors z-10 cursor-pointer"
                                          title={translate("control:SlideRow.transliterateRow", "Transliterar fila")}
                                        >
                                          <Languages size={13} />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        disabled={idx <= 1}
                                        onClick={() => handleMoveUp(idx)}
                                        className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-gray-700/60 rounded-sm transition-colors cursor-pointer"
                                        title={translate("control:SlideRow.moveUp", "Subir")}
                                      >
                                        <ArrowUp size={13} />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={idx === 0 || idx === slides.length - 1}
                                        onClick={() => handleMoveDown(idx)}
                                        className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-gray-700/60 rounded-sm transition-colors cursor-pointer"
                                        title={translate("control:SlideRow.moveDown", "Bajar")}
                                      >
                                        <ArrowDown size={13} />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isTitle}
                                        onClick={() => handleDeleteSlide(idx)}
                                        className="p-1 text-red-400 hover:text-red-300 hover:bg-red-950/20 disabled:opacity-30 disabled:pointer-events-none rounded-sm transition-colors cursor-pointer"
                                        title={translate("control:SlideRow.deleteSlide", "Borrar diapositiva")}
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>

                                    {/* Fila 2: Selector de tipo de diapositiva (solo iconos compactos en gris/activo) */}
                                    {!isTitle && (
                                      <div className="flex flex-col items-center gap-1 mt-1 bg-gray-950/40 border border-gray-800/60 rounded-sm py-1 px-2.5 w-fit">

                                        {/* Primera línea */}
                                        <div className="flex items-center justify-center gap-3.5">
                                          <button
                                            type="button"
                                            onClick={() => handleChangeSlideType(idx, 'text')}
                                            className={`transition-colors cursor-pointer p-0.5 ${!isImage && slide.type !== 'media' && slide.type !== 'tanaj' && slide.type !== 'sefer' && slide.type !== 'quiz'
                                              ? 'text-yellow-500 font-bold'
                                              : 'text-gray-500 hover:text-gray-350'
                                              }`}
                                            title={translate("control:SlideRow.typeNormalText", "Tipo: Texto normal")}
                                          >
                                            <FileText size={12} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleChangeSlideType(idx, 'media')}
                                            className={`transition-colors cursor-pointer p-0.5 ${slide.type === 'media'
                                              ? 'text-yellow-500 font-bold'
                                              : 'text-gray-500 hover:text-gray-350'
                                              }`}
                                            title={translate("control:SlideRow.typeMediaVideoImage", "Tipo: Multimedia (Video/Imagen)")}
                                          >
                                            <Video size={12} />
                                          </button>
{/* Imagen pura unificada en media */}
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
                                            title={translate("control:SlideRow.typeMaterializedTanaj", "Tipo: Tanaj materializado")}
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
                                            title={translate("control:SlideRow.typeNativeSefer", "Tipo: Sefer nativo")}
                                          >
                                            <ScrollText size={12} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleChangeSlideType(idx, 'quiz')}
                                            className={`transition-colors cursor-pointer p-0.5 ${slide.type === 'quiz'
                                              ? 'text-yellow-500 font-bold'
                                              : 'text-gray-500 hover:text-gray-350'
                                              }`}
                                            title={translate("control:SlideRow.typeQuiz", "Tipo: Quiz")}
                                          >
                                            <HelpCircle size={12} />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
  );
};

export const SlideRow = React.memo(SlideRowComponent);
