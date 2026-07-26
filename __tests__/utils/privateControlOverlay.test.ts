import { describe, expect, it } from 'vitest';
import {
  applyPrivateControlOverlayDelta,
  reconcilePrivateControlOverlayParticipants,
  replacePrivateControlOverlay,
  validatePrivateControlOverlayDelta,
  validatePrivateControlOverlaySnapshot,
  type PrivateControlOverlaySnapshot,
} from '../../src/features/liveAudio/utils/privateControlOverlay';

const makeSnapshot = (
  privateStateRevision = 4,
  basedOnStateRevision = 10,
): PrivateControlOverlaySnapshot => ({
  type: 'PRIVATE_CONTROL_OVERLAY_SNAPSHOT',
  keyId: 'control-key-1',
  privateStateRevision,
  basedOnStateRevision,
  participants: {
    participantA: {
      alias: 'Alex',
      aliasOrdinal: 1,
      ephemeralPublicKey: 'audience-public-key',
      microphoneConfig: { volume: 125, musicMode: true },
    },
    participantB: {
      alias: 'Alex',
      aliasOrdinal: 2,
    },
  },
});

describe('private Control overlay validation', () => {
  it('accepts aliases, stable ordinals, audience keys and microphone configs', () => {
    expect(validatePrivateControlOverlaySnapshot(makeSnapshot())).toEqual({
      ok: true,
      value: makeSnapshot(),
    });
  });

  it('rejects historical messages and unknown private fields', () => {
    const value = {
      ...makeSnapshot(),
      messages: [{ text: 'histórico' }],
    };
    const result = validatePrivateControlOverlaySnapshot(value);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('messages');
  });

  it('rejects invalid ordinals and microphone configuration', () => {
    const value = makeSnapshot();
    value.participants.participantA = {
      alias: 'Alex',
          aliasOrdinal: -1,
      microphoneConfig: { volume: 301, musicMode: true },
    };
    const result = validatePrivateControlOverlaySnapshot(value);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('aliasOrdinal');
      expect(result.errors.join(' ')).toContain('volume');
    }
  });

  it('rejects a participant present in both sides of a delta', () => {
    const result = validatePrivateControlOverlayDelta({
      type: 'PRIVATE_CONTROL_OVERLAY_DELTA',
      keyId: 'control-key-1',
      privateStateRevision: 5,
      basedOnPrivateStateRevision: 4,
      basedOnStateRevision: 11,
      upsertParticipants: {
        participantA: { alias: 'Alex', aliasOrdinal: 1 },
      },
      removeParticipantIds: ['participantA'],
    });

    expect(result.ok).toBe(false);
  });
});

describe('private Control overlay replacement', () => {
  it('replaces with a newer snapshot for the expected E2E key', () => {
    const current = makeSnapshot(4, 10);
    const incoming = makeSnapshot(6, 12);
    incoming.participants.participantA.alias = 'Alejandra';

    expect(replacePrivateControlOverlay(current, incoming, {
      expectedKeyId: 'control-key-1',
      currentTechnicalStateRevision: 12,
    })).toEqual({ ok: true, value: incoming });
  });

  it('rejects stale snapshots, wrong keys and technical state from the future', () => {
    expect(replacePrivateControlOverlay(makeSnapshot(4), makeSnapshot(4))).toMatchObject({
      ok: false,
      reason: 'stale',
    });
    expect(replacePrivateControlOverlay(null, makeSnapshot(), {
      expectedKeyId: 'other-key',
    })).toMatchObject({ ok: false, reason: 'key-mismatch' });
    expect(replacePrivateControlOverlay(null, makeSnapshot(4, 11), {
      currentTechnicalStateRevision: 10,
    })).toMatchObject({ ok: false, reason: 'technical-state-ahead' });
  });

  it('allows an explicit snapshot replacement after key rotation', () => {
    const rotated = { ...makeSnapshot(0, 12), keyId: 'control-key-2' };

    expect(replacePrivateControlOverlay(makeSnapshot(), rotated, {
      expectedKeyId: 'control-key-2',
      currentTechnicalStateRevision: 12,
    })).toEqual({ ok: true, value: rotated });
  });
});

describe('private Control overlay deltas', () => {
  it('applies exactly the next revision atomically', () => {
    const result = applyPrivateControlOverlayDelta(makeSnapshot(), {
      type: 'PRIVATE_CONTROL_OVERLAY_DELTA',
      keyId: 'control-key-1',
      privateStateRevision: 5,
      basedOnPrivateStateRevision: 4,
      basedOnStateRevision: 11,
      upsertParticipants: {
        participantA: {
          alias: 'Alejandra',
          aliasOrdinal: 1,
          microphoneConfig: { volume: 80, musicMode: false },
        },
        participantC: { alias: 'Bea', aliasOrdinal: 1 },
      },
      removeParticipantIds: ['participantB'],
    }, 11);

    expect(result).toMatchObject({
      ok: true,
      value: {
        privateStateRevision: 5,
        basedOnStateRevision: 11,
        participants: {
          participantA: { alias: 'Alejandra' },
          participantC: { alias: 'Bea' },
        },
      },
    });
    if (result.ok) expect(result.value.participants).not.toHaveProperty('participantB');
  });

  it('detects duplicates, stale deltas and revision gaps', () => {
    const base = {
      type: 'PRIVATE_CONTROL_OVERLAY_DELTA',
      keyId: 'control-key-1',
      basedOnStateRevision: 10,
      upsertParticipants: {},
      removeParticipantIds: [],
    } as const;

    expect(applyPrivateControlOverlayDelta(makeSnapshot(), {
      ...base,
      privateStateRevision: 4,
      basedOnPrivateStateRevision: 3,
    })).toMatchObject({ ok: false, reason: 'stale' });
    expect(applyPrivateControlOverlayDelta(makeSnapshot(), {
      ...base,
      privateStateRevision: 6,
      basedOnPrivateStateRevision: 4,
    })).toMatchObject({ ok: false, reason: 'revision-gap' });
    expect(applyPrivateControlOverlayDelta(makeSnapshot(), {
      ...base,
      privateStateRevision: 5,
      basedOnPrivateStateRevision: 4,
      basedOnStateRevision: 12,
    }, 11)).toMatchObject({ ok: false, reason: 'technical-state-ahead' });
  });
});

describe('private Control overlay reconciliation', () => {
  it('drops private data for participants absent from the technical snapshot', () => {
    const reconciled = reconcilePrivateControlOverlayParticipants(
      makeSnapshot(),
      ['participantB', 'participantC'],
      11,
    );

    expect(reconciled.participants).toEqual({
      participantB: { alias: 'Alex', aliasOrdinal: 2 },
    });
    expect(reconciled.privateStateRevision).toBe(5);
    expect(reconciled.basedOnStateRevision).toBe(11);
  });

  it('preserves object identity when no reconciliation change is needed', () => {
    const snapshot = makeSnapshot();

    expect(reconcilePrivateControlOverlayParticipants(
      snapshot,
      ['participantA', 'participantB'],
      10,
    )).toBe(snapshot);
  });

  it('refuses reconciliation against an older technical state', () => {
    expect(() => reconcilePrivateControlOverlayParticipants(
      makeSnapshot(),
      ['participantA'],
      9,
    )).toThrow(/anterior/);
  });
});
