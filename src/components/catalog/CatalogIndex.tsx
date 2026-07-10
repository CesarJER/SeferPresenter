import React from 'react';
import type { CatalogDef } from './CatalogApp';
import { BookOpen } from 'lucide-react';

interface CatalogIndexProps {
  catalogs: CatalogDef[];
}

export const CatalogIndex: React.FC<CatalogIndexProps> = ({ catalogs }) => {
  return (
    <div className="min-h-screen bg-black text-gray-200 p-4 sm:p-8 flex flex-col items-center">
      <div className="max-w-4xl w-full">
        <header className="mb-10 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-yellow-500 mb-2">Catálogos Públicos</h1>
          <p className="text-gray-400">Selecciona un catálogo para ver su contenido</p>
        </header>

        {catalogs.length === 0 ? (
          <div className="text-center p-8 bg-gray-900 border border-gray-800 rounded-lg text-gray-500">
            No hay catálogos públicos disponibles en este momento.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalogs.map(cat => (
              <a
                key={cat.id}
                href={cat.path}
                className="bg-gray-900 border border-gray-700 hover:border-yellow-600 hover:bg-gray-800 transition-colors rounded-lg p-6 flex flex-col items-center text-center group cursor-pointer shadow-lg"
              >
                <div className="bg-gray-800 p-4 rounded-full mb-4 group-hover:bg-yellow-600/20 transition-colors">
                  <BookOpen size={32} className="text-yellow-500 group-hover:text-yellow-400" />
                </div>
                <h2 className="text-xl font-bold text-gray-100 mb-2 group-hover:text-white">{cat.title}</h2>
                <div className="flex flex-wrap gap-1 justify-center">
                  {cat.tags.map(tag => (
                    <span key={tag} className="text-[9px] uppercase tracking-wider bg-gray-950 text-gray-500 px-1.5 py-0.5 rounded border border-gray-800">
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
