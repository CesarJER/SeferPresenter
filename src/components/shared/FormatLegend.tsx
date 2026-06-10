import React from 'react';

export const FormatLegend: React.FC = () => (
  <details className="mt-3 group bg-gray-955/40 border border-gray-800/80 rounded-lg p-1.5 select-none transition-all shadow-inner">
    <summary className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 hover:text-white cursor-pointer px-2 py-1 outline-none">
      <span className="text-yellow-500">❓</span>
      <span>Ver Guía de Formato Rápido (Quick Mode)</span>
    </summary>
    <div className="mt-2 p-2.5 rounded bg-gray-955/70 border border-gray-800/50 text-[11px] text-gray-300 space-y-2.5 font-normal leading-relaxed">
      <ul className="list-disc pl-4 space-y-1.5 text-gray-400">
        <li><strong>Separador de Diapositivas:</strong> Separa las diapositivas con una línea en blanco doble (presiona Enter dos veces).</li>
        <li><strong>Etiquetas / Títulos:</strong> Escribe <code>#Nombre</code> al inicio de una diapositiva para etiquetarla (ej: <code>#Coro</code>). Para el título de la canción, escribe <code>&gt; Título</code> al inicio.</li>
        <li><strong>Diapositiva de Medios (Video/Imagen):</strong> Usa el formato:
          <div className="mt-1.5 p-2 bg-gray-955/90 rounded border border-gray-800 text-[11.5px] font-mono text-yellow-500 overflow-x-auto whitespace-pre">
            [MEDIA - ruta - fit - nav - showBg - loop - vol - speed - start - end]
          </div>
          <p className="mt-1 text-[10px] text-gray-500 leading-normal">
            Ejemplo: <code>[MEDIA - "/videos/Adoradle.mp4"]</code> (Casi todos los parámetros son opcionales y tienen valores por defecto. loop: 1=sí, 0=no; vol: 0 a 1; speed: 0.5 a 2.0; start/end en seg; fit: cover, contain; showBg: 0=no, 1=sí).
          </p>
        </li>
      </ul>
    </div>
  </details>
);
