import { useCallback, useEffect, useRef, useState } from 'react';
import { saveCatalog, type CatalogSaveOptions } from '../utils/catalogApi';
import type { CatalogConflict, MergeChoice } from '../utils/catalogMerge';
import { CatalogMergeDialog } from '../components/shared/CatalogMergeDialog';
import { translate } from '../i18n/runtime';

export function useCatalogSave<T extends { id: string }>(path: string, options: CatalogSaveOptions<T>) {
  const [conflicts, setConflicts] = useState<CatalogConflict[] | null>(null);
  const pending = useRef<((choices: Record<string, MergeChoice> | null) => void) | null>(null);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); pending.current?.(null); pending.current = null; }, []);
  const finish = (choices: Record<string, MergeChoice> | null) => {
    pending.current?.(choices);
    pending.current = null;
    setConflicts(null);
  };
  const save = useCallback(async (data: T[], base: T[]) => {
    if (busy.current) throw new Error(translate('common:catalogMerge.busy', 'Ya hay un guardado en curso. Espera a que termine.'));
    busy.current = true;
    const request = new AbortController();
    controller.current = request;
    try {
      return await saveCatalog(path, data, base, { ...options, signal: request.signal, resolve: list => new Promise(resolve => {
        if (request.signal.aborted) { resolve(null); return; }
        pending.current = resolve;
        setConflicts(list);
      }) });
    } finally { busy.current = false; controller.current = null; }
  }, [path, options]);
  return { save, dialog: conflicts ? <CatalogMergeDialog conflicts={conflicts} onResolve={finish} /> : null };
}
