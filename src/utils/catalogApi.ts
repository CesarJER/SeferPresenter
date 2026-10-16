import { translate } from '../i18n/runtime';
const revisions = new WeakMap<object, string>();
export async function loadCatalog<T>(path: string, normalize?: (value: T) => T): Promise<T[]> {
  const response = await fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error(`${path}: catálogo inválido`);
  const data = normalize ? payload.map(normalize) : payload as T[];
  const etag = response.headers.get('ETag');
  if (etag) revisions.set(data, etag);
  return data;
}
export async function saveCatalog<T>(path: string, data: T[], base: T[]): Promise<void> {
  const etag = revisions.get(base);
  if (!etag) throw new Error(translate("common:catalogApi.reloadTheCatalogBeforeSavingYourDraftIsPreserved", "Recarga el catálogo antes de guardar. Tu borrador se conserva."));
  const response = await fetch(path, { method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(response.status === 412
    ? translate("common:catalogApi.anotherEditorChangedTheCatalogYourDraftIsPreservedReload", "Otro editor ha cambiado el catálogo. Tu borrador se conserva; recarga antes de combinar y guardar.")
    : `${path}: HTTP ${response.status}. Tu borrador se conserva.`);
  const next = response.headers.get('ETag');
  if (next) revisions.set(data, next);
}
