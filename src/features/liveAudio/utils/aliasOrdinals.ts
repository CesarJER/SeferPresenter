export interface AliasOrdinalState {
  assignments: Record<string, number>;
  nextByNormalizedAlias: Record<string, number>;
}

export const normalizeAliasForOrdinal = (alias: string): string =>
  alias.trim().replace(/\s+/gu, ' ').normalize('NFC').toLocaleLowerCase();

export const assignStableAliasOrdinal = (
  state: AliasOrdinalState,
  participantId: string,
  alias: string,
): AliasOrdinalState => {
  if (Object.hasOwn(state.assignments, participantId)) return state;
  const normalized = normalizeAliasForOrdinal(alias);
  const ordinal = state.nextByNormalizedAlias[normalized] ?? 0;
  return {
    assignments: { ...state.assignments, [participantId]: ordinal },
    nextByNormalizedAlias: { ...state.nextByNormalizedAlias, [normalized]: ordinal + 1 },
  };
};

export const formatAliasForControl = (alias: string, ordinal = 0): string =>
  ordinal > 0 ? `${alias} [${ordinal}]` : alias;
