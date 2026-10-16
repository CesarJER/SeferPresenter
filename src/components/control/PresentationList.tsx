import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
import React, { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import type { Presentation } from '../../types/presentation';
import { ImportExportPanel } from './ImportExportPanel';

interface PresentationListProps {
  presentations: Presentation[];
  currentPresentation: Presentation | null;
  onImport: (imported: Presentation[]) => void;
  onSelectPresentation: (presentation: Presentation, slideIdx?: number) => void;
  onStartEditing: (presentation: Presentation) => void;
  onStartEditingNew: () => void;
  onMovePresentationUp: (idx: number) => void;
  onMovePresentationDown: (idx: number) => void;
  onDeletePresentation: (idx: number) => void;
  onSortPresentationsAZ: () => void;
}

const normalizeSearch = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const getSlidePreview = (presentation: Presentation, lines: string[]) => {
  const isFallbackTrilingual =
    presentation.mode === 'trilingual' &&
    lines.length === 3 &&
    (lines[1] === '-' || lines[1] === '>-' || lines[1] === '') &&
    (lines[2] === '-' || lines[2] === '>-' || lines[2] === '');

  return (presentation.mode === 'trilingual' && !isFallbackTrilingual ? lines[2] : lines[0]) || translate("control:PresentationList.empty", "(Vacía)");
};

export const PresentationList: React.FC<PresentationListProps> = ({
  presentations,
  currentPresentation,
  onImport,
  onSelectPresentation,
  onStartEditing,
  onStartEditingNew,
  onMovePresentationUp,
  onMovePresentationDown,
  onDeletePresentation,
  onSortPresentationsAZ,
}) => {
  useUiTranslation('control');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const cleanQuery = normalizeSearch(searchQuery);
  const hasSearch = searchQuery.trim() !== '';

  const { titleMatches, contentMatches } = useMemo(() => {
    if (!hasSearch) {
      return { titleMatches: presentations, contentMatches: [] as Presentation[] };
    }

    const titleResults: Presentation[] = [];
    const contentResults: Presentation[] = [];

    presentations.forEach((presentation) => {
      const normTitle = normalizeSearch(presentation.title);
      if (normTitle.includes(cleanQuery)) {
        titleResults.push(presentation);
        return;
      }

      const matchesContent = presentation.slides?.some((slide) =>
        slide.lines?.some((line) => line && normalizeSearch(line).includes(cleanQuery)),
      );

      if (matchesContent) {
        contentResults.push(presentation);
      }
    });

    return { titleMatches: titleResults, contentMatches: contentResults };
  }, [cleanQuery, hasSearch, presentations]);

  const renderPresentationRows = (items: Presentation[], showContentBadge = false) =>
    items.map((presentation) => {
      const originalIdx = presentations.findIndex((item) => item.id === presentation.id);
      const isCurrent = currentPresentation?.id === presentation.id;
      const isExpanded = expandedRows[presentation.id] ?? (showContentBadge && hasSearch);

      return (
        <React.Fragment key={presentation.id}>
          <tr className={`transition-colors duration-150 hover:bg-gray-800/40 ${isCurrent ? 'bg-yellow-950/20' : ''}`}>
            <td className="p-3 align-middle">
              <div className="flex items-center justify-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectPresentation(presentation)}
                  className={`p-1.5 rounded-md flex items-center justify-center transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-yellow-500 text-white shadow-md shadow-yellow-500/20'
                      : 'bg-gray-700/80 text-gray-300 hover:bg-yellow-600 hover:text-white'
                  }`}
                  title={isCurrent ? translate("control:PresentationList.live", "En directo") : translate("control:PresentationList.present", "Presentar")}
                >
                  <Play size={13} fill={isCurrent ? 'currentColor' : 'none'} />
                </button>

                <button
                  type="button"
                  onClick={() => setExpandedRows((prev) => ({ ...prev, [presentation.id]: !isExpanded }))}
                  className="p-1.5 rounded-md bg-gray-700/80 text-gray-300 hover:bg-gray-600 hover:text-white transition-all cursor-pointer"
                  title={translate("control:PresentationList.viewSlides", "Ver diapositivas")}
                >
                  {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              </div>
            </td>
            <td className="p-3 align-middle font-semibold text-white">
              <div className="flex items-center gap-2">
                <span>{presentation.title}</span>
                {isCurrent && (
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
                    {translate("control:PresentationList.live_4d14e8", "En Directo")}</span>
                )}
                {showContentBadge && (
                  <span className="px-1.5 py-0.5 rounded-sm text-[9px] font-medium bg-blue-950/40 text-blue-300 border border-blue-800/30">
                    {translate("control:PresentationList.matchingLyrics", "Letra coincidente")}</span>
                )}
              </div>
            </td>
            <td className="p-3 align-middle text-center">
              <span
                className={`px-2 py-0.5 rounded text-[10px] uppercase font-extrabold ${
                  presentation.mode === 'trilingual'
                    ? 'bg-purple-950/60 text-purple-400 border border-purple-800/50'
                    : 'bg-blue-950/60 text-blue-400 border border-blue-800/50'
                }`}
              >
                {presentation.mode === 'trilingual' ? translate("control:PresentationList.3x", "3x") : translate("control:PresentationList.1x", "1x")}
              </span>
            </td>
            <td className="p-3 align-middle text-center font-bold text-gray-300">
              {presentation.slides?.length || 0}
            </td>
            <td className="p-3 align-middle">
              <div className="flex items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onStartEditing(presentation)}
                  className="p-1.5 text-gray-400 hover:text-yellow-400 hover:bg-gray-700/60 rounded-sm transition-all cursor-pointer"
                  title={translate("control:PresentationList.editContent", "Editar contenido")}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  disabled={originalIdx === 0}
                  onClick={() => onMovePresentationUp(originalIdx)}
                  className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-gray-700/60 rounded-sm transition-colors cursor-pointer"
                  title={translate("control:PresentationList.moveUp", "Mover Arriba")}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  disabled={originalIdx === presentations.length - 1}
                  onClick={() => onMovePresentationDown(originalIdx)}
                  className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-gray-700/60 rounded-sm transition-colors cursor-pointer"
                  title={translate("control:PresentationList.moveDown", "Mover Abajo")}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => onDeletePresentation(originalIdx)}
                  className="p-1 text-red-400 hover:text-red-300 hover:bg-red-950/20 rounded-sm transition-colors cursor-pointer"
                  title={translate("control:PresentationList.deletePresentation", "Eliminar Presentación")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </td>
          </tr>

          {isExpanded && (
            <tr className="bg-gray-950/40">
              <td colSpan={5} className="px-6 py-2.5">
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    {translate("control:PresentationList.slidesClickOneToDisplayIt", "Diapositivas (Haz clic en una para mostrarla):")}</div>
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto py-1">
                    {presentation.slides.map((slide, slideIdx) => {
                      const slideMatchesQuery =
                        hasSearch &&
                        slide.lines?.some((line) => line && normalizeSearch(line).includes(cleanQuery));

                      return (
                        <button
                          key={slide.id}
                          onClick={() => onSelectPresentation(presentation, slideIdx)}
                          className={`transition-all text-xs border rounded cursor-pointer px-2 py-1 ${
                            slideMatchesQuery
                              ? 'border-yellow-500 bg-yellow-950/30 text-yellow-300 ring-1 ring-yellow-500/40'
                              : 'bg-gray-800 hover:bg-yellow-600 hover:text-white border-gray-700 text-gray-300'
                          }`}
                        >
                          <span className="font-bold text-[10px] me-1 text-yellow-500">
                            {slide.label}:
                          </span>
                          <span className="truncate max-w-[120px] inline-block align-bottom">
                            {getSlidePreview(presentation, slide.lines)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </td>
            </tr>
          )}
        </React.Fragment>
      );
    });

  return (
    <div id="section-presentation-manager" className="flex-1 flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between rounded-md bg-gray-900 border border-gray-700 p-3">
        <div className="relative flex-1 min-w-0 w-full lg:max-w-md">
          <input
            ref={searchInputRef}
            type="text"
            aria-label={translate("control:PresentationList.searchThePresentationLibrary", "Buscar presentación en el repertorio")}
            placeholder={translate("control:PresentationList.searchThePresentationLibrary_6bef1a", "Buscar presentación en el repertorio...")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setSearchQuery('')}
            className="w-full bg-white border border-gray-300 rounded-md ps-3 pe-8 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 focus:outline-hidden p-0.5 rounded-sm cursor-pointer transition-colors"
              title={translate("control:PresentationList.clearSearch", "Limpiar búsqueda")}
              aria-label={translate("control:PresentationList.clearSearch", "Limpiar búsqueda")}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 justify-end items-center sm:flex-nowrap">
          <button
            type="button"
            onClick={onSortPresentationsAZ}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gray-700 hover:bg-gray-650 transition-colors text-white border border-gray-600 cursor-pointer"
          >
            {translate("control:PresentationList.sortAZ", "Ordenar A-Z")}</button>

          <ImportExportPanel presentations={presentations} onImport={onImport} />

          <button
            type="button"
            onClick={onStartEditingNew}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-yellow-600 hover:bg-yellow-500 transition-colors text-white cursor-pointer shadow-xs"
          >
            <Plus size={13} />
            <span>{translate("control:PresentationList.newPresentation", "Nueva Presentación")}</span>
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-300 sm:hidden">{translate("control:PresentationList.swipeTheTableToSeeManagement", "Desliza la tabla a la derecha para ver Gestión →")}</p>
      <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-900/40 backdrop-blur-md shadow-lg">
        <table className="w-full text-start border-collapse">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-900/80 text-xs font-semibold uppercase tracking-wider text-gray-400">
              <th className="px-3 py-3 w-[100px] text-center">{translate("control:PresentationList.action", "Acción")}</th>
              <th className="px-3 py-3">{translate("control:PresentationList.presentationTitle", "Título de la Presentación")}</th>
              <th className="px-3 py-3 w-[80px] text-center">{translate("control:PresentationList.mode", "Modo")}</th>
              <th className="px-3 py-3 w-[100px] text-center">{translate("control:PresentationList.slides", "Diapositivas")}</th>
              <th className="px-3 py-3 w-[160px] text-center">{translate("control:PresentationList.management", "Gestión")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 text-sm">
            {hasSearch && titleMatches.length > 0 && (
              <tr className="bg-gray-950/70 border-b border-gray-800">
                <td colSpan={5} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-yellow-500">
                  {translate("control:PresentationList.titleMatches", "Coincidencias en Título")}</td>
              </tr>
            )}

            {renderPresentationRows(titleMatches)}

            {hasSearch && contentMatches.length > 0 && (
              <tr className="bg-gray-950/70 border-b border-gray-800">
                <td colSpan={5} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-blue-400">
                  {translate("control:PresentationList.contentMatchesLyricsSlides", "Coincidencias en Contenido (Letras/Diapositivas)")}</td>
              </tr>
            )}

            {renderPresentationRows(contentMatches, true)}

            {titleMatches.length === 0 && contentMatches.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-xs text-gray-500 italic">
                  {hasSearch ? translate("control:PresentationList.noPresentationsMatchTheSearch", "No se encontraron presentaciones que coincidan con la búsqueda") : translate("control:PresentationList.noPresentationsInTheLibrary", "No hay presentaciones en el repertorio")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
