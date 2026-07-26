import { describe, expect, it } from 'vitest';
import {
  assignStableAliasOrdinal,
  formatAliasForControl,
  normalizeAliasForOrdinal,
} from '../../src/features/liveAudio/utils/aliasOrdinals';

describe('stable duplicate alias ordinals', () => {
  it('groups collapsed, NFC-normalized and case-insensitive aliases', () => {
    expect(normalizeAliasForOrdinal('  JOSE\u0301   Pérez ')).toBe(
      normalizeAliasForOrdinal('josé pérez'),
    );
  });

  it('never renumbers or reuses an ordinal during a session', () => {
    let state = { assignments: {}, nextByNormalizedAlias: {} };
    state = assignStableAliasOrdinal(state, 'one', 'Alias');
    state = assignStableAliasOrdinal(state, 'two', ' alias ');
    state = assignStableAliasOrdinal(state, 'three', 'ALIAS');
    state = assignStableAliasOrdinal(state, 'one', 'Changed');

    expect(state.assignments).toEqual({ one: 0, two: 1, three: 2 });
    expect(formatAliasForControl('Alias', state.assignments.one)).toBe('Alias');
    expect(formatAliasForControl('alias', state.assignments.two)).toBe('alias [1]');
    expect(formatAliasForControl('ALIAS', state.assignments.three)).toBe('ALIAS [2]');
  });
});
