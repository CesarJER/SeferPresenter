import React from 'react';
import { FileText, Image as ImageIcon, Languages, Layers, Plus, Save, Table, Video, X } from 'lucide-react';
import type { Presentation, Slide, VideoState } from '../../types/presentation';
import { CustomSearchSelect } from '../shared/CustomSearchSelect';
import { FormatLegend } from '../shared/FormatLegend';
import { SlideRow } from './SlideRow';

type EditorMode = 'list' | 'edit';
type PresentationMode = 'standard' | 'trilingual';
type SlideType = 'text' | 'video' | 'image' | 'tanaj' | 'sefer';
type ScriptureSlideUpdate = {
  scriptureBook: string;
  scriptureChapter: string;
  scriptureVerseStart: string;
  scriptureVerseEnd?: string;
  label: string;
};

type VideoParamUpdate = {
  videoSrc?: string;
  volume?: number;
  speed?: number;
  loop?: boolean;
  presenterNav?: boolean;
  startTime?: number;
  endTime?: number;
};

interface PresentationEditorProps {
  id: string;
  title: string;
  setTitle: React.Dispatch<React.SetStateAction<string>>;
  bg: string;
  setBg: React.Dispatch<React.SetStateAction<string>>;
  backgrounds: string[];
  slides: Slide[];
  setSlides: React.Dispatch<React.SetStateAction<Slide[]>>;
  mode: PresentationMode;
  fontScale: number;
  setFontScale: React.Dispatch<React.SetStateAction<number>>;
  isTableMode: boolean;
  setEditorMode: React.Dispatch<React.SetStateAction<EditorMode>>;
  currentPresentation: Presentation | null;
  currentSlideIndex: number;
  videoState: VideoState | null;
  videoDurations: Record<string, number>;
  expandedRows: Record<string, boolean>;
  setExpandedRows: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  standardText: string;
  setStandardText: React.Dispatch<React.SetStateAction<string>>;
  hebText: string;
  setHebText: React.Dispatch<React.SetStateAction<string>>;
  transText: string;
  setTransText: React.Dispatch<React.SetStateAction<string>>;
  traText: string;
  setTraText: React.Dispatch<React.SetStateAction<string>>;
  textareaClass: string;
  handleModeChange: (newMode: PresentationMode) => void | Promise<void>;
  toggleEditMode: () => void;
  handleSave: () => void | Promise<void>;
  handleTransliterateAllTable: () => void;
  getScriptureRangeRootIndex: (idx: number) => number;
  getScriptureRangeEndIndex: (startIdx: number) => number;
  isScriptureRangeRoot: (slide: Slide) => boolean;
  parseSlides: () => Slide[];
  onSelectPresentation: (presentation: Presentation, slideIdx?: number) => void;
  handleUpdateLabel: (idx: number, newLabel: string) => void;
  handleUpdateScriptureVerseBackground: (idx: number, verse: string, bgValue: string) => void;
  handleUpdateScriptureSlide: (idx: number, payload: ScriptureSlideUpdate) => void;
  handleUpdateVideoParams: (idx: number, changes: VideoParamUpdate) => void;
  handleUpdateImagePresenterNav: (idx: number, visible: boolean) => void;
  handleUpdateLine: (slideIdx: number, lineIdx: number, textValue: string) => void;
  handleUpdateSlideBg: (idx: number, bgValue: string) => void;
  handleTransliterateRow: (idx: number) => void;
  handleMoveUp: (idx: number) => void;
  handleMoveDown: (idx: number) => void;
  handleDeleteSlide: (idx: number) => void;
  handleChangeSlideType: (idx: number, newType: SlideType) => void;
  handleAddImageSlide: () => void;
  handleAddSlide: () => void;
  handleAddVideoSlide: () => void;
  handleTransliterate: () => void;
}

export const PresentationEditor: React.FC<PresentationEditorProps> = ({
  id,
  title,
  setTitle,
  bg,
  setBg,
  backgrounds,
  slides,
  setSlides,
  mode,
  fontScale,
  setFontScale,
  isTableMode,
  setEditorMode,
  currentPresentation,
  currentSlideIndex,
  videoState,
  videoDurations,
  expandedRows,
  setExpandedRows,
  standardText,
  setStandardText,
  hebText,
  setHebText,
  transText,
  setTransText,
  traText,
  setTraText,
  textareaClass,
  handleModeChange,
  toggleEditMode,
  handleSave,
  handleTransliterateAllTable,
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
  handleUpdateLine,
  handleUpdateSlideBg,
  handleTransliterateRow,
  handleMoveUp,
  handleMoveDown,
  handleDeleteSlide,
  handleChangeSlideType,
  handleAddImageSlide,
  handleAddSlide,
  handleAddVideoSlide,
  handleTransliterate,
}) => (              <div id="section-presentation-editor">
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
                          {slides.map((slide, idx) => (
                            <SlideRow
                              key={slide.id}
                              slide={slide}
                              idx={idx}
                              slides={slides}
                              id={id}
                              title={title}
                              bg={bg}
                              mode={mode}
                              fontScale={fontScale}
                              currentPresentation={currentPresentation}
                              currentSlideIndex={currentSlideIndex}
                              videoState={videoState}
                              videoDurations={videoDurations}
                              expandedRows={expandedRows}
                              setExpandedRows={setExpandedRows}
                              backgrounds={backgrounds}
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
                            />
                          ))}
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
              </div>

);
