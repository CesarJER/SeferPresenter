import React from 'react';
import type { CatalogDef } from './CatalogApp';
import { BookOpen } from 'lucide-react';

interface CatalogIndexProps {
  catalogs: CatalogDef[];
}

export const CatalogIndex: React.FC<CatalogIndexProps> = ({ catalogs }) => {
  return (
    <div className="h-dvh overflow-y-auto bg-[#fef3c7] text-amber-950 p-4 sm:p-8 flex flex-col items-center">
      <div className="max-w-4xl w-full">
        <header className="mb-10 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-amber-700 mb-2">Catálogos Públicos</h1>
          <p className="text-amber-900/70">Selecciona un catálogo para ver su contenido</p>
        </header>

        {catalogs.length === 0 ? (
          <div className="text-center p-8 bg-amber-100/50 border border-amber-200 rounded-lg text-amber-800">
            No hay catálogos públicos disponibles en este momento.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalogs.map(cat => (
              <a
                key={cat.id}
                href={cat.path}
                className="bg-white/80 border border-amber-200 hover:border-amber-400 hover:bg-white transition-colors rounded-lg p-6 flex flex-col items-center text-center group cursor-pointer shadow-xs hover:shadow-md"
              >
                <div className="bg-amber-100 p-4 rounded-full mb-4 group-hover:bg-amber-200 transition-colors">
                  <BookOpen size={32} className="text-amber-600 group-hover:text-amber-700" />
                </div>
                <h2 className="text-xl font-bold text-amber-900 mb-2">{cat.title}</h2>
                <div className="flex flex-wrap gap-1 justify-center">
                  {cat.tags.map(tag => (
                    <span key={tag} className="text-[9px] uppercase tracking-wider bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-sm border border-amber-200">
                      {tag}
                    </span>
                  ))}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
