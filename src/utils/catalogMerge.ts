export type MergeChoice = 'local' | 'remote';
export interface CatalogConflict {
  key: string;
  label: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

export const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameValue(value, b[i]));
  }
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = Object.entries(b).filter(([, value]) => value !== undefined);
  return left.length === right.length && left.every(([key, value]) => Object.hasOwn(b, key) && sameValue(value, Reflect.get(b, key)));
};

export function mergeCatalog<T extends { id: string; title?: string; name?: string }>(
  base: T[], local: T[], remote: T[], choices: Record<string, MergeChoice> = {}, keyOf: (item: T) => string = item => item.id,
) {
  const index = (items: T[]) => {
    const map = new Map(items.map(item => [keyOf(item), item]));
    if (map.size !== items.length) throw new Error('Ambiguous catalog: duplicate records');
    return map;
  };
  const before = index(base), mine = index(local), theirs = index(remote);
  const conflicts: CatalogConflict[] = [];
  const merged = new Map<string, T>();
  const select = (key: string, label: string, original: unknown, localValue: unknown, remoteValue: unknown) => {
    if (sameValue(localValue, remoteValue) || sameValue(remoteValue, original)) return localValue;
    if (sameValue(localValue, original)) return remoteValue;
    if (!choices[key]) conflicts.push({ key, label, base: original, local: localValue, remote: remoteValue });
    return choices[key] === 'local' ? localValue : remoteValue;
  };
  for (const id of new Set([...before.keys(), ...mine.keys(), ...theirs.keys()])) {
    const item = mine.get(id) ?? theirs.get(id) ?? before.get(id)!;
    const value = select(`item:${id}`, item.title || item.name || item.id, before.get(id), mine.get(id), theirs.get(id)) as T | undefined;
    if (value) merged.set(id, value);
  }
  // New records append in server/local order; existing records retain the chosen relative order.
  const common = new Set([...before.keys()].filter(id => mine.has(id) && theirs.has(id) && merged.has(id)));
  const order = (items: T[]) => items.map(keyOf).filter(id => common.has(id));
  const selectedOrder = select('order', 'order', order(base), order(local), order(remote)) as string[];
  const primary = sameValue(selectedOrder, order(remote)) ? remote : local;
  const resultOrder = [...new Set([...primary.map(keyOf), ...remote.map(keyOf), ...local.map(keyOf)])].filter(id => merged.has(id));
  return { items: resultOrder.map(id => merged.get(id)!), conflicts };
}
