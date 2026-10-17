import { translate } from '../i18n/runtime';
import { mergeCatalog, type CatalogConflict, type MergeChoice } from './catalogMerge';
import { validateAudioSyncMaps, validatePresentationList, type ValidationResult } from './validation';
import { normalizePresentation } from './normalizePresentation';
import type { AudioSyncMap } from '../types/audio';
export const presentationCatalogOptions = { normalize: normalizePresentation, validate: validatePresentationList };
export const audioSyncCatalogOptions = { validate: validateAudioSyncMaps, keyOf: (map: AudioSyncMap) => JSON.stringify([map.presentationId, map.audioSrc]) };
export interface CatalogSaveOptions<T> {
  normalize?: (value: T) => T;
  validate: (value: unknown) => ValidationResult<T[]>;
  keyOf?: (value: T) => string;
  resolve?: (conflicts: CatalogConflict[]) => Promise<Record<string, MergeChoice> | null>;
  signal?: AbortSignal;
}
const revisions = new WeakMap<object, { etag: string; snapshot: unknown[] }>();
export async function loadCatalog<T>(path: string, normalize?: (value: T) => T, signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error(`${path}: catálogo inválido`);
  const data = normalize ? payload.map(normalize) : payload as T[];
  const etag = response.headers.get('ETag');
  if (etag) revisions.set(data, { etag, snapshot: structuredClone(data) });
  return data;
}
export async function saveCatalog<T extends { id: string }>(path: string, data: T[], base: T[], options: CatalogSaveOptions<T>): Promise<T[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    options.signal?.throwIfAborted();
    const revision = revisions.get(base);
    if (!revision) throw new Error(translate("common:catalogApi.reloadTheCatalogBeforeSavingYourDraftIsPreserved", "Recarga el catálogo antes de guardar. Tu borrador se conserva."));
    const response = await fetch(path, { method: 'POST', cache: 'no-store', signal: options.signal,
      headers: { 'Content-Type': 'application/json', 'If-Match': revision.etag }, body: JSON.stringify(data) });
    if (response.status === 412) {
      if (attempt === 2) break;
      const remote = await loadCatalog<T>(path, options.normalize, options.signal);
      if (!options.validate(remote).ok) throw new Error(`${path}: catálogo inválido`);
      const original = revision.snapshot as T[];
      const merge = mergeCatalog(original, data, remote, {}, options.keyOf);
      let merged = merge.items;
      if (merge.conflicts.length) {
        const choices = await options.resolve?.(merge.conflicts);
        if (!choices) throw new Error(translate('common:catalogMerge.cancelled', 'Guardado cancelado. Tu borrador se conserva.'));
        const resolved = mergeCatalog(original, data, remote, choices, options.keyOf);
        if (resolved.conflicts.length) throw new Error(translate('common:catalogMerge.unresolved', 'Resuelve todos los conflictos antes de guardar.'));
        merged = resolved.items;
      }
      if (!options.validate(merged).ok) throw new Error(`${path}: catálogo inválido`);
      base = remote;
      data = merged;
      continue;
    }
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}. Tu borrador se conserva.`);
    const next = response.headers.get('ETag');
    if (next) revisions.set(data, { etag: next, snapshot: structuredClone(data) });
    return data;
  }
  throw new Error(translate('common:catalogMerge.changedAgain', 'El catálogo volvió a cambiar. Tu borrador se conserva; vuelve a guardar para revisarlo.'));
}
