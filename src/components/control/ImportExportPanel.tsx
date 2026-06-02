import React from 'react';
import { Download, Upload } from 'lucide-react';
import type { Presentation } from '../../types/presentation';

interface ImportExportPanelProps {
  presentations: Presentation[];
  onImport: (imported: Presentation[]) => void;
}

export const ImportExportPanel: React.FC<ImportExportPanelProps> = ({
  presentations,
  onImport,
}) => {
  const handleExport = () => {
    try {
      const dataStr = JSON.stringify(presentations, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', 'sefer_presenter_presentations.json');
      linkElement.click();
    } catch (err) {
      alert('Error al exportar las presentaciones: ' + (err as Error).message);
    }
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      try {
        const parsed = JSON.parse(readerEvent.target?.result as string);
        if (!Array.isArray(parsed)) {
          throw new Error('El archivo JSON debe contener una lista (array) de presentaciones.');
        }

        for (const presentation of parsed) {
          if (!presentation.id || !presentation.title || !Array.isArray(presentation.slides)) {
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
    event.target.value = '';
  };

  return (
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
        <input type="file" accept=".json" onChange={handleImport} className="hidden" />
      </label>
    </div>
  );
};
