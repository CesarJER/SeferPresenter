import React, { useEffect, useState, useMemo } from 'react';
import type { CatalogDef } from './CatalogApp';
import type { Presentation } from '../../types/presentation';
import { ArrowLeft, Search, FileText, BookOpen } from 'lucide-react';

interface CatalogViewerProps {
  catalog: CatalogDef;
  presentationId: string | null;
}

export const CatalogViewer: React.FC<CatalogViewerProps> = ({ catalog, presentationId }) => {
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

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

  const filteredPresentations = useMemo(() => {
    if (!search.trim()) return presentations;
    const query = search.toLowerCase().trim();
    return presentations.filter(p => p.title.toLowerCase().includes(query));
  }, [presentations, search]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-gray-400 flex items-center justify-center">
        <p>Cargando {catalog.title}...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black text-red-400 flex flex-col items-center justify-center p-4">
        <h1 className="text-2xl font-bold mb-2">Error</h1>
        <p>{error}</p>
        <a href={catalog.path} className="mt-4 text-blue-400 hover:underline">Volver al catálogo</a>
      </div>
    );
  }

  if (presentationId) {
    const pres = presentations.find(p => p.id === presentationId);
    if (!pres) {
      return (
        <div className="min-h-screen bg-black text-gray-400 flex flex-col items-center justify-center p-4">
          <p>Presentación no encontrada</p>
          <a href={catalog.path} className="mt-4 text-blue-400 hover:underline">Volver al catálogo</a>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-black text-gray-200">
        <header className="bg-gray-900 border-b border-gray-800 p-4 sticky top-0 z-10 flex items-center gap-4">
          <a href={catalog.path} className="p-2 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors" title="Volver">
            <ArrowLeft size={20} />
          </a>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-yellow-500 truncate">{pres.title}</h1>
            <p className="text-xs text-gray-500 truncate">{catalog.title}</p>
          </div>
        </header>
        
        <main className="p-4 sm:p-8 max-w-4xl mx-auto space-y-6">
          {pres.slides.map((slide, i) => (
            <div key={slide.id || i} className="bg-gray-900 border border-gray-800 rounded p-4 sm:p-6 shadow">
              {slide.label && (
                <div className="flex justify-between items-start mb-3">
                  <div className="text-[10px] font-bold text-yellow-600 uppercase tracking-wider">
                    {slide.label}
                  </div>
                  {(slide.type === 'tanaj' || slide.type === 'sefer') && slide.scriptureBook && slide.scriptureChapter && (
                    <a 
                      href={`/lector?book=${encodeURIComponent(slide.scriptureBook)}&chapter=${encodeURIComponent(slide.scriptureChapter)}&verse=${encodeURIComponent(slide.scriptureVerseStart || '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 bg-blue-900/20 px-2 py-1 rounded"
                    >
                      <BookOpen size={12} />
                      Leer en contexto
                    </a>
                  )}
                </div>
              )}
              <div className="space-y-4">
                {slide.lines.map((line, idx) => {
                  if (!line || line === '-' || line === '>-') return null;
                  
                  let textClass = 'text-xl sm:text-2xl font-bold text-white';
                  if (pres.mode === 'trilingual') {
                    if (idx === 0) textClass = 'text-xl sm:text-2xl font-bold text-white';
                    if (idx === 1) textClass = 'text-lg sm:text-xl text-yellow-400 italic';
                    if (idx === 2) textClass = 'text-base sm:text-lg text-gray-400';
                  }

                  return (
                    <div key={idx} className={textClass}>
                      {line}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-gray-200 flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 p-4 sm:p-6 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="text-center sm:text-left min-w-0">
            <h1 className="text-2xl font-bold text-yellow-500 truncate">{catalog.title}</h1>
            <p className="text-xs text-gray-500 mt-1">
              Catálogo público • {presentations.length} canciones
            </p>
          </div>
          <div className="relative w-full sm:w-auto min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
            <input
              type="text"
              placeholder="Buscar título..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 transition-all text-white placeholder-gray-500"
            />
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-8 max-w-4xl w-full mx-auto">
        {filteredPresentations.length === 0 ? (
          <div className="text-center p-8 bg-gray-900 border border-gray-800 rounded-lg text-gray-500">
            No se encontraron resultados para "{search}".
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredPresentations.map(p => (
              <a
                key={p.id}
                href={`${catalog.path}/${p.id}`}
                className="bg-gray-900 border border-gray-800 hover:border-yellow-600/50 hover:bg-gray-800 transition-colors p-4 rounded flex items-start gap-4 group cursor-pointer"
              >
                <div className="bg-gray-950 p-2.5 rounded group-hover:bg-yellow-600/20 transition-colors mt-0.5">
                  <FileText size={20} className="text-gray-500 group-hover:text-yellow-500 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-200 group-hover:text-white truncate mb-1">{p.title}</h3>
                  <p className="text-xs text-gray-500 truncate">
                    {p.slides.length} diapositiva{p.slides.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
