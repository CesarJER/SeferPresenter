import React, { useEffect, useState } from 'react';
import { CatalogIndex } from './CatalogIndex.tsx';
import { CatalogViewer } from './CatalogViewer.tsx';

export interface CatalogDef {
  id: string;
  path: string;
  title: string;
  tags: string[];
}

export const CatalogApp: React.FC = () => {
  const [catalogs, setCatalogs] = useState<CatalogDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/public-catalogs')
      .then(r => {
        if (!r.ok) throw new Error('Error cargando catálogos');
        return r.json();
      })
      .then(data => {
        setCatalogs(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-600 flex items-center justify-center">
        <p>Cargando catálogo...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 text-red-500 flex flex-col items-center justify-center p-4">
        <h1 className="text-2xl font-bold mb-2">Error</h1>
        <p>{error}</p>
      </div>
    );
  }

  const currentPath = window.location.pathname;
  const activeCatalog = catalogs.find(c => currentPath.startsWith(c.path));

  if (!activeCatalog) {
    // Si la ruta no pertenece a ningún catálogo (poco probable ya que local-server la intercepta)
    // o es la raíz genérica, mostramos el índice.
    return <CatalogIndex catalogs={catalogs} />;
  }

  const pathRest = currentPath.slice(activeCatalog.path.length).replace(/^\//, '');
  const presentationId = pathRest ? pathRest.split('/')[0] : null;

  return <CatalogViewer catalog={activeCatalog} presentationId={presentationId} />;
};
