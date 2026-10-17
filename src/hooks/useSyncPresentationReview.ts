import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Presentation } from '../types/presentation';
import { loadCatalog } from '../utils/catalogApi';
import { sameValue } from '../utils/catalogMerge';
import { normalizePresentation } from '../utils/normalizePresentation';
import { validatePresentationList } from '../utils/validation';

export function useSyncPresentationReview(id: string, isOpen: boolean, presentations: Presentation[]) {
  const initial = useMemo(() => {
    const item = presentations.find(presentation => presentation.id === id);
    return item ? normalizePresentation(item) : null;
  }, [presentations, id]);
  const [snapshot, setSnapshot] = useState<{ id: string; reviewed: Presentation | null; latest: Presentation | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef({ value: 0 });
  const reviewed = snapshot?.id === id ? snapshot.reviewed : initial;
  const latest = snapshot?.id === id ? snapshot.latest : initial;
  useEffect(() => { if (!isOpen) { setSnapshot(null); setError(null); } }, [isOpen]);
  useEffect(() => {
    setSnapshot(previous => previous?.id === id && previous.reviewed
      ? { ...previous, latest: initial } : { id, reviewed: initial, latest: initial });
  }, [id, initial]);
  const refresh = useCallback(async () => {
    const request = ++generation.current.value;
    try {
      const items = await loadCatalog<Presentation>('/api/presentations', normalizePresentation);
      if (!validatePresentationList(items).ok) throw new Error('Invalid presentations payload');
      if (request !== generation.current.value) throw new Error('Presentation check superseded');
      const current = items.find(item => item.id === id) ?? null;
      setSnapshot(previous => ({ id, reviewed: previous?.id === id ? previous.reviewed : initial, latest: current }));
      setError(null);
      return current;
    } catch (err) {
      if (request === generation.current.value) setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [id, initial]);
  useEffect(() => {
    if (!isOpen || !id) return;
    const pendingChecks = generation.current;
    const check = () => { void refresh().catch(() => {}); };
    check();
    const timer = window.setInterval(check, 15000);
    window.addEventListener('focus', check);
    return () => { ++pendingChecks.value; window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, [isOpen, id, refresh]);
  const accept = () => setSnapshot({ id, reviewed: latest, latest });
  return { reviewed, latest, changed: !!reviewed && !sameValue(reviewed.slides, latest?.slides), error, refresh, accept };
}

export function remapSyncTimes(before: Presentation, after: Presentation, times: Record<string, string>) {
  const ids = after.slides.map(slide => slide.id);
  if (new Set(ids).size !== ids.length || new Set(before.slides.map(slide => slide.id)).size !== before.slides.length) {
    throw new Error('Ambiguous slide IDs; sync marks were preserved');
  }
  const indexes = new Map(ids.map((id, index) => [id, index]));
  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(times)) {
    const match = /^slide-(\d+)(-verse-.*)?$/.exec(key);
    if (!match) continue;
    const index = indexes.get(before.slides[Number(match[1])]?.id);
    if (index !== undefined) mapped[`slide-${index}${match[2] || ''}`] = value;
  }
  return mapped;
}
