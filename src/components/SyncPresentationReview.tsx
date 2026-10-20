import type { Presentation } from '../types/presentation';
import { translate } from '../i18n/runtime';

export function SyncPresentationReview({ before, after, times, onReview }: {
  before: Presentation; after: Presentation | null; times: Record<string, string>; onReview: () => void;
}) {
  return <section role="alert" className="m-3 max-h-[40dvh] shrink-0 overflow-auto rounded border border-yellow-600 bg-yellow-950 p-3 text-white">
    <h3 className="font-bold">{translate('audioEditor:syncReview.title', 'La presentación ha cambiado')}</h3>
    <p>{translate('audioEditor:syncReview.explanation', 'Tus marcas se conservan sobre la versión anterior. Revisa las diapositivas antes de guardar. Las marcas de diapositivas eliminadas dejarán de aplicarse.')}</p>
    {before.slides.some(slide => slide.scriptureBook) && <p>{translate('audioEditor:syncReview.verses', 'Las marcas de versículos fuera del nuevo rango también dejarán de aplicarse.')}</p>}
    <details open className="my-3">
      <summary>{translate('audioEditor:syncReview.compare', 'Comparar diapositivas y marcas')}</summary>
      <div className="max-h-64 overflow-auto"><table className="w-full text-sm"><thead><tr>
        <th>{translate('audioEditor:syncReview.before', 'Antes / marca')}</th><th>{translate('audioEditor:syncReview.after', 'Ahora')}</th>
      </tr></thead><tbody>{before.slides.map((slide, index) => {
        const nextIndex = after?.slides.findIndex(item => item.id === slide.id) ?? -1;
        const next = after?.slides[nextIndex];
        return <tr key={`${slide.id}-${index}`} className="border-t border-yellow-800">
          <td className="w-1/2 align-top p-2"><p>{index + 1}. {slide.label}</p><pre dir="auto" className="whitespace-pre-wrap break-words">{slide.lines.join('\n')}</pre>
            {slide.scriptureBook && <p>{slide.scriptureBook} {slide.scriptureChapter}:{slide.scriptureVerseStart}–{slide.scriptureVerseEnd}</p>}
            {Object.entries(times).filter(([key]) => key === `slide-${index}` || key.startsWith(`slide-${index}-verse-`)).map(([key, time]) => <p key={key}>{key.includes('-verse-') ? key.split('-verse-')[1] + ': ' : ''}{translate('audioEditor:syncReview.seconds', '{{time}} s', {time})}</p>)}
          </td>
          <td className="align-top p-2">{!next ? translate('audioEditor:syncReview.removed', 'Eliminada: sus marcas no se conservarán') : <><p>{nextIndex + 1}. {next.label}</p><pre dir="auto" className="whitespace-pre-wrap break-words">{next.lines.join('\n')}</pre>{next.scriptureBook && <p>{next.scriptureBook} {next.scriptureChapter}:{next.scriptureVerseStart}–{next.scriptureVerseEnd}</p>}</>}</td>
        </tr>;
      })}{after?.slides.map((slide, index) => before.slides.some(item => item.id === slide.id) ? null : <tr key={`new-${slide.id}`} className="border-t border-yellow-800">
        <td className="p-2">{translate('audioEditor:syncReview.added', 'Nueva diapositiva: sin marcas')}</td><td className="p-2"><p>{index + 1}. {slide.label}</p><pre dir="auto" className="whitespace-pre-wrap break-words">{slide.lines.join('\n')}</pre></td>
      </tr>)}</tbody></table></div>
    </details>
    {after ? <button type="button" onClick={onReview} className="rounded bg-yellow-700 px-3 py-2">{translate('audioEditor:syncReview.review', 'Actualizar diapositivas y revisar marcas')}</button>
      : <p>{translate('audioEditor:syncReview.deleted', 'Esta presentación se eliminó. Selecciona otra para continuar; tu borrador sigue disponible.')}</p>}
  </section>;
}
