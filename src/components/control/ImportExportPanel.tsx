import React from 'react';
import { Download, Upload } from 'lucide-react';
import type { Presentation } from '../../types/presentation';
import { validatePresentationList } from '../../utils/validation';

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
      const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', url);
      linkElement.setAttribute('download', 'sefer_presenter_presentations.json');
      linkElement.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
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
        const validation = validatePresentationList(parsed);
        if (!validation.ok || !validation.value) {
          throw new Error(`Formato de presentación inválido:\n${validation.errors.slice(0, 8).join('\n')}`);
        }

        if (window.confirm(`¿Estás seguro de que deseas importar ${validation.value.length} presentaciones? Esto reemplazará tu lista actual.`)) {
          onImport(validation.value);
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
