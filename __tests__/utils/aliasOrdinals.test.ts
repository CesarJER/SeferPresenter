import { describe, expect, it } from 'vitest';
import { assignStableAliasOrdinal, formatAliasForControl, normalizeAliasForOrdinal } from '../../src/features/liveAudio/utils/aliasOrdinals';

describe('stable duplicate alias ordinals', () => {
  it('groups whitespace, Unicode NFC, and case variants', () => {
    expect(normalizeAliasForOrdinal('  JOSE\u0301   Pérez ')).toBe(normalizeAliasForOrdinal('josé pérez'));
  });

  it('keeps participant ordinals stable and does not reuse them', () => {
    let state = { assignments: {}, nextByNormalizedAlias: {} };
    state = assignStableAliasOrdinal(state, 'a', 'TV');
    state = assignStableAliasOrdinal(state, 'b', ' tv ');
    state = assignStableAliasOrdinal(state, 'c', 'TV');
    state = assignStableAliasOrdinal(state, 'b', 'TV');
    expect(state.assignments).toEqual({ a: 0, b: 1, c: 2 });
    expect(formatAliasForControl('TV', state.assignments.a)).toBe('TV');
    expect(formatAliasForControl('TV', state.assignments.b)).toBe('TV [1]');
    expect(formatAliasForControl('TV', state.assignments.c)).toBe('TV [2]');
  });

  it('can restart cleanly for a new presentation session', () => {
    const reset = assignStableAliasOrdinal({ assignments: {}, nextByNormalizedAlias: {} }, 'new', 'TV');
    expect(reset.assignments.new).toBe(0);
  });
});
