import React, { useEffect, useState, useMemo } from 'react';
import type { CatalogDef } from './CatalogApp';
import type { Presentation } from '../../types/presentation';
import { ArrowLeft, Search, FileText, BookOpen, AlignLeft, LayoutGrid } from 'lucide-react';
import { sanitizeSlideHtml } from '../../utils/hebrewText';
import {
  catalogTextToPlainText,
  getCatalogCardData,
  isCatalogTitleSlide,
  normalizeCatalogSearch,
  splitCatalogHighlightedText,
} from '../../utils/catalogCards';

interface CatalogViewerProps {
  catalog: CatalogDef;
  presentationId: string | null;
}

const HighlightedText: React.FC<{ value: string; query: string }> = ({ value, query }) => (
  <>
    {splitCatalogHighlightedText(value, query).map((segment, index) => (
      segment.match
        ? <mark key={index} className="bg-yellow-200 text-inherit rounded-sm">{segment.text}</mark>
        : <React.Fragment key={index}>{segment.text}</React.Fragment>
    ))}
  </>
);

export const CatalogViewer: React.FC<CatalogViewerProps> = ({ catalog, presentationId }) => {
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'continuous' | 'grid'>('continuous');

  useEffect(() => {
    fetch(`/api/public-catalogs/${catalog.id}/presentations`)
      .then(r => {
        if (!r.ok) throw new Error('Error cargando presentaciones');
        return r.json();
      })
      .then(data => {
        setPresentations(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [catalog.id]);

  const cleanQuery = normalizeCatalogSearch(search);
  const hasSearch = search.trim() !== '';

  const { titleMatches, contentMatches } = useMemo(() => {
    if (!hasSearch) {
      return { titleMatches: presentations, contentMatches: [] as Presentation[] };
    }

    const tResults: Presentation[] = [];
    const cResults: Presentation[] = [];

    presentations.forEach(p => {
      const normTitle = normalizeCatalogSearch(p.title);
      if (normTitle.includes(cleanQuery)) {
        tResults.push(p);
        return;
      }

      const matchesContent = p.slides?.some(slide => 
        slide.lines?.some(line => line && normalizeCatalogSearch(catalogTextToPlainText(line)).includes(cleanQuery))
      );

      if (matchesContent) {
        cResults.push(p);
      }
    });

    return { titleMatches: tResults, contentMatches: cResults };
  }, [presentations, hasSearch, cleanQuery]);

  if (loading) {
    return (
      <div className="h-dvh overflow-y-auto bg-[#fef3c7] text-amber-950 flex items-center justify-center">
        <p>Cargando {catalog.title}...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-dvh overflow-y-auto bg-[#fef3c7] text-red-600 flex flex-col items-center justify-center p-4">
        <h1 className="text-2xl font-bold mb-2">Error</h1>
        <p>{error}</p>
        <a href={catalog.path} className="mt-4 text-amber-700 hover:underline">Volver al catálogo</a>
      </div>
    );
  }

  if (presentationId) {
    const pres = presentations.find(p => p.id === presentationId);
    if (!pres) {
      return (
        <div className="h-dvh overflow-y-auto bg-[#fef3c7] text-amber-950 flex flex-col items-center justify-center p-4">
          <p>Presentación no encontrada</p>
          <a href={catalog.path} className="mt-4 text-amber-700 hover:underline">Volver al catálogo</a>
        </div>
      );
    }

    let slidesToRender = pres.slides;
    if (slidesToRender.length > 0) {
      if (isCatalogTitleSlide(pres, 0)) {
        slidesToRender = slidesToRender.slice(1);
      }
    }

    return (
      <div className="h-dvh overflow-y-auto bg-[#fef3c7] text-amber-950">
        <header className="bg-amber-100 border-b border-amber-200 p-4 sticky top-0 z-10 flex items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-4 min-w-0">
            <a href={catalog.path} className="p-2 rounded hover:bg-amber-200 text-amber-700 hover:text-amber-900 transition-colors" title="Volver">
              <ArrowLeft size={20} />
            </a>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-amber-900 truncate">{pres.title}</h1>
              <p className="text-xs text-amber-700 truncate">{catalog.title}</p>
            </div>
          </div>
          <div className="flex gap-1 bg-amber-50 rounded-lg p-1 border border-amber-200">
            <button
              onClick={() => setViewMode('continuous')}
              className={`p-1.5 rounded ${viewMode === 'continuous' ? 'bg-amber-200 text-amber-900 shadow-sm' : 'text-amber-600 hover:bg-amber-100'} transition-all`}
              title="Lectura Continua"
            >
              <AlignLeft size={18} />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-amber-200 text-amber-900 shadow-sm' : 'text-amber-600 hover:bg-amber-100'} transition-all`}
              title="Vista de Tarjetas"
            >
              <LayoutGrid size={18} />
            </button>
          </div>
        </header>
        
        <main className={`p-4 sm:p-8 max-w-4xl mx-auto ${viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-6 pb-16'}`}>
          {slidesToRender.map((slide, i) => (
            <div key={slide.id || i} className={`${viewMode === 'grid' ? 'bg-white/80 border border-amber-200 rounded p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow' : ''}`}>
              {slide.label && (
                <div className={`flex justify-between items-start mb-2 ${viewMode === 'continuous' ? 'border-b border-amber-200 pb-1 mb-3' : ''}`}>
                  <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">
                    {slide.label}
                  </div>
                  {(slide.type === 'tanaj' || slide.type === 'sefer') && slide.scriptureBook && slide.scriptureChapter && (
                    <a 
                      href={`/lector?book=${encodeURIComponent(slide.scriptureBook)}&chapter=${encodeURIComponent(slide.scriptureChapter)}&verse=${encodeURIComponent(slide.scriptureVerseStart || '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 bg-blue-50 px-2 py-1 rounded border border-blue-100"
                    >
                      <BookOpen size={12} />
                      Leer en contexto
                    </a>
                  )}
                </div>
              )}
              <div className="leading-relaxed whitespace-pre-wrap break-words w-full">
                {slide.scriptureVerses ? (
                  <div className="space-y-4">
                    {slide.scriptureVerses.map((verseLines, vIdx) => (
                      <div key={vIdx} className={`w-full ${viewMode === 'continuous' ? 'grid grid-cols-3 gap-2 sm:gap-4' : 'flex flex-col space-y-2'}`}>
                        {verseLines.slice(0, 3).map((line, idx) => {
                          if (!line || line === '-' || line === '>-') return <div key={idx}></div>;
                          
                          let colorClass = 'text-amber-950';
                          if (idx === 0) colorClass = 'text-rose-900';
                          if (idx === 2) colorClass = 'text-blue-800';
                          
                          return (
                            <div 
                              key={idx} 
                              className={`text-base sm:text-lg font-medium ${colorClass}`}
                              dangerouslySetInnerHTML={{ __html: sanitizeSlideHtml(line) }}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : pres.mode === 'trilingual' && (
                  (slide.lines[1] && slide.lines[1] !== '-' && slide.lines[1] !== '>-') || 
                  (slide.lines[2] && slide.lines[2] !== '-' && slide.lines[2] !== '>-')
                ) ? (
                  <div className={`w-full ${viewMode === 'continuous' ? 'grid grid-cols-3 gap-2 sm:gap-4' : 'flex flex-col space-y-2'}`}>
                    {slide.lines.slice(0, 3).map((line, idx) => {
                      if (!line || line === '-' || line === '>-') return <div key={idx}></div>;
                      
                      let colorClass = 'text-amber-950';
                      if (idx === 0) colorClass = 'text-rose-900';
                      if (idx === 2) colorClass = 'text-blue-800';
                      
                      return (
                        <div 
                          key={idx} 
                          className={`text-base sm:text-lg font-medium ${colorClass}`}
                          dangerouslySetInnerHTML={{ __html: sanitizeSlideHtml(line) }}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {slide.lines.map((line, idx) => {
                      if (!line || line === '-' || line === '>-') return null;
                      return (
                        <div 
                          key={idx} 
                          className="text-base sm:text-lg text-amber-950 font-medium"
                          dangerouslySetInnerHTML={{ __html: sanitizeSlideHtml(line) }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </main>
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-y-auto bg-[#fef3c7] text-amber-950 flex flex-col">
      <header className="bg-amber-100 border-b border-amber-200 p-4 sm:p-6 sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="text-center sm:text-left min-w-0">
            <h1 className="text-2xl font-bold text-amber-900 truncate">{catalog.title}</h1>
            <p className="text-xs text-amber-700 mt-1">
              Catálogo público • {presentations.length} presentaciones
            </p>
          </div>
          <div className="relative w-full sm:w-auto min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-600" size={16} />
            <input
              type="text"
              placeholder="Buscar título o contenido..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white/80 border border-amber-200 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all text-amber-950 placeholder-amber-600/70"
            />
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-8 max-w-4xl w-full mx-auto space-y-8">
        {!hasSearch ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {titleMatches.map(p => (
              <PresentationCard key={p.id} presentation={p} catalogPath={catalog.path} countSefer={catalog.count_sefer} />
            ))}
          </div>
        ) : (
          <>
            {titleMatches.length === 0 && contentMatches.length === 0 && (
              <div className="text-center p-8 bg-amber-100/50 border border-amber-200 rounded-lg text-amber-800">
                No se encontraron resultados para "{search}".
              </div>
            )}

            {titleMatches.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-amber-800 uppercase tracking-wider mb-4 border-b border-amber-200/50 pb-2">
                  Coincidencias en Título
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {titleMatches.map(p => (
                    <PresentationCard key={p.id} presentation={p} catalogPath={catalog.path} countSefer={catalog.count_sefer} query={search} />
                  ))}
                </div>
              </div>
            )}

            {contentMatches.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-amber-800 uppercase tracking-wider mb-4 border-b border-amber-200/50 pb-2">
                  Coincidencias en Contenido
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {contentMatches.map(p => {
                    const matchedLine = p.slides?.flatMap(s => s.lines || []).find(l => l && normalizeCatalogSearch(catalogTextToPlainText(l)).includes(cleanQuery));
                    return (
                      <PresentationCard 
                        key={p.id} 
                        presentation={p} 
                        catalogPath={catalog.path} 
                        snippet={matchedLine} 
                        countSefer={catalog.count_sefer}
                        query={search}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

interface PresentationCardProps {
  presentation: Presentation;
  catalogPath: string;
  snippet?: string;
  countSefer: boolean;
  query?: string;
}

const PresentationCard: React.FC<PresentationCardProps> = ({ presentation, catalogPath, snippet, countSefer, query = '' }) => {
  const card = getCatalogCardData(presentation, countSefer);
  const excerpt = snippet ? catalogTextToPlainText(snippet) : card.excerpt;
  return (
    <a
    href={`${catalogPath}/${presentation.id}`}
    className="bg-white/80 border border-amber-200 hover:border-amber-400 hover:bg-white transition-colors p-4 rounded-lg flex items-start gap-4 group cursor-pointer shadow-sm hover:shadow-md"
  >
    <div className="bg-amber-100 p-2.5 rounded-lg group-hover:bg-amber-200 transition-colors mt-0.5 shrink-0">
      <FileText size={20} className="text-amber-600 group-hover:text-amber-700 transition-colors" />
    </div>
    <div className="flex-1 min-w-0">
      <h3 className="font-bold text-amber-900 group-hover:text-amber-950 truncate mb-1">
        <HighlightedText value={presentation.title} query={query} />
      </h3>
      {excerpt && (
        <p className="text-xs text-amber-700/90 mt-1 line-clamp-3">
          <span className="font-bold text-amber-800">({card.count})</span>{' '}
          <HighlightedText value={excerpt} query={query} />
        </p>
      )}
      {!excerpt && <p className="text-xs font-bold text-amber-700">({card.count})</p>}
    </div>
  </a>
  );
};

