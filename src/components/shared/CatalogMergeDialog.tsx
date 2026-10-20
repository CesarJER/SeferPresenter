import { useEffect, useId, useRef, useState } from 'react';
import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
import { sameValue, type CatalogConflict, type MergeChoice } from '../../utils/catalogMerge';

export function CatalogMergeDialog({ conflicts, onResolve }: {
  conflicts: CatalogConflict[];
  onResolve: (choices: Record<string, MergeChoice> | null) => void;
}) {
  useUiTranslation('common');
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const fieldValue = (value: unknown, field: string) => value && typeof value === 'object' ? Reflect.get(value, field) : undefined;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const fieldLabels: Record<string, string> = {
    id: translate('common:catalogMerge.field.id', 'Identificador'),
    title: translate('common:catalogMerge.field.title', 'Título'),
    name: translate('common:catalogMerge.field.name', 'Nombre'),
    background: translate('common:catalogMerge.field.background', 'Fondo'),
    mode: translate('common:catalogMerge.field.mode', 'Modo'),
    fontScale: translate('common:catalogMerge.field.fontScale', 'Tamaño de letra'),
    tags: translate('common:catalogMerge.field.tags', 'Etiquetas públicas'),
    slides: translate('common:catalogMerge.field.slides', 'Diapositivas'),
    audioSrc: translate('common:catalogMerge.field.audioSrc', 'Pista de audio'),
    presentationId: translate('common:catalogMerge.field.presentationId', 'Presentación vinculada'),
    cues: translate('common:catalogMerge.field.cues', 'Marcas de tiempo'),
    defaultSyncMode: translate('common:catalogMerge.field.defaultSyncMode', 'Modo de sincronización'),
    defaultVolume: translate('common:catalogMerge.field.defaultVolume', 'Volumen inicial'),
  };
  const format = (value: unknown) => value === undefined
    ? translate('common:catalogMerge.absent', 'Eliminado / no existe')
    : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const renderValue = (value: unknown, field: string, versions: unknown[]) => {
    if (Array.isArray(value) && value.length === 0) return <p>{translate('common:catalogMerge.empty', 'Sin contenido')}</p>;
    if (field === 'slides' && Array.isArray(value)) return value.map((slide, index) => {
      if (!versions.some(other => !Array.isArray(other) || !sameValue(other[index], slide))) return null;
      const settings = Object.fromEntries(Object.entries(slide).filter(([key]) => !['id', 'label', 'lines'].includes(key)));
      return <section key={`${slide.id}-${index}`} className="my-2 border-b border-gray-700 pb-2">
        <p className="font-semibold">{index + 1}. {slide.label}</p>
        <pre dir="auto" className="whitespace-pre-wrap break-words">{slide.lines?.join('\n')}</pre>
        {Object.keys(settings).length > 0 && <details><summary>{translate('common:catalogMerge.settings', 'Otros ajustes de la diapositiva')}</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(settings, null, 2)}</pre></details>}
      </section>;
    });
    if (field === 'cues' && Array.isArray(value)) return value.map((cue, index) => <p key={index}>
      {translate('common:catalogMerge.cue', '{{time}} s → diapositiva {{slide}}', {time:cue.timeSec,slide:cue.slideIndex+1})}{cue.verse && <> · {translate('common:catalogMerge.verse', 'versículo {{verse}}', {verse:cue.verse})}</>}
    </p>);
    return <pre dir="auto" className="whitespace-pre-wrap break-words">{format(value)}</pre>;
  };
  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onResolve(null); }}
    className="m-auto w-[96vw] max-w-6xl max-h-[90dvh] overflow-auto rounded-lg border border-gray-600 bg-gray-900 p-4 text-white backdrop:bg-black/80">
    <h2 id={titleId} className="text-xl font-bold">{translate('common:catalogMerge.title', 'Revisar cambios antes de guardar')}</h2>
    <p className="my-3">{translate('common:catalogMerge.explanation', 'Los cambios en registros distintos se combinan. Elige qué versión conservar donde ambos han cambiado lo mismo. Cancelar conserva tu borrador.')}</p>
    {conflicts.map(conflict => {
      const versions = [conflict.base, conflict.local, conflict.remote];
      const fields = conflict.key === 'order' ? [] : [...new Set(versions.flatMap(value => value && typeof value === 'object' ? Object.keys(value) : []))]
        .filter(field => !sameValue(fieldValue(conflict.base, field), fieldValue(conflict.local, field)) || !sameValue(fieldValue(conflict.base, field), fieldValue(conflict.remote, field)));
      return <fieldset key={conflict.key} className="my-4 rounded border border-gray-600 p-3">
        <legend className="px-2 text-lg font-bold">{conflict.key === 'order' ? translate('common:catalogMerge.order', 'Orden del catálogo') : conflict.label}</legend>
        <div className="overflow-x-auto"><table className="w-full table-fixed text-sm">
          <thead><tr>{['base', 'local', 'remote'].map((key, i) => <th key={key} className="p-2 text-start">{[
            translate('common:catalogMerge.base', 'Versión al empezar'), translate('common:catalogMerge.local', 'Tu borrador'), translate('common:catalogMerge.remote', 'Versión del servidor'),
          ][i]}</th>)}</tr></thead>
          <tbody>{(fields.length ? fields : ['']).map(field => <tr key={field}>{versions.map((value, i) => <td key={i} className="align-top border-t border-gray-700 p-2">
            {field && <strong>{fieldLabels[field] || field}</strong>}
            <div className="max-h-64 overflow-auto">{renderValue(field ? fieldValue(value, field) : value, field, versions.map(version => fieldValue(version, field)))}</div>
          </td>)}</tr>)}</tbody>
        </table></div>
        <div className="mt-3 flex flex-wrap gap-4">{(['local', 'remote'] as const).map(choice => <label key={choice} className="flex items-center gap-2">
          <input type="radio" name={conflict.key} checked={choices[conflict.key] === choice} onChange={() => setChoices(previous => ({ ...previous, [conflict.key]: choice }))} />
          {choice === 'local' ? translate('common:catalogMerge.keepLocal', 'Conservar mi versión') : translate('common:catalogMerge.keepRemote', 'Conservar la del servidor')}
        </label>)}</div>
      </fieldset>;
    })}
    <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 bg-gray-900 py-3">
      <button type="button" onClick={() => onResolve(null)} className="rounded bg-gray-700 px-4 py-2">{translate('common:catalogMerge.cancel', 'Cancelar y seguir editando')}</button>
      <button type="button" disabled={conflicts.some(conflict => !choices[conflict.key])} onClick={() => onResolve(choices)} className="rounded bg-yellow-600 px-4 py-2 disabled:opacity-40">{translate('common:catalogMerge.save', 'Combinar y guardar')}</button>
    </div>
  </dialog>;
}
