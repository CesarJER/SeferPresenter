import { describe, expect, it } from 'vitest';
import {
  createControlSyncReducerState,
  reduceControlSyncEnvelope,
  type ControlSyncDelta,
  type ControlSyncReducerState,
  type ControlSyncSnapshot,
} from '../../src/features/liveAudio/utils/controlSyncReducer';

interface TestState {
  participants: string[];
}

type TestDelta =
  | { action: 'ADD'; participantId: string }
  | { action: 'REMOVE'; participantId: string };

const identity = {
  serverEpoch: 'server-one',
  sessionId: 'session-one',
};

const applyDelta = (state: TestState, delta: TestDelta): TestState => ({
  participants: delta.action === 'ADD'
    ? [...state.participants, delta.participantId]
    : state.participants.filter((id) => id !== delta.participantId),
});

const snapshot = (
  stateRevision: number,
  participants: string[],
  overrides: Partial<ControlSyncSnapshot<TestState>> = {},
): ControlSyncSnapshot<TestState> => ({
  type: 'SNAPSHOT',
  ...identity,
  stateRevision,
  state: { participants },
  ...overrides,
});

const delta = (
  stateRevision: number,
  eventId: string,
  change: TestDelta,
  overrides: Partial<ControlSyncDelta<TestDelta>> = {},
): ControlSyncDelta<TestDelta> => ({
  type: 'DELTA',
  ...identity,
  stateRevision,
  eventId,
  delta: change,
  ...overrides,
});

const reduce = (
  sync: ControlSyncReducerState<TestState, TestDelta>,
  envelope: ControlSyncSnapshot<TestState> | ControlSyncDelta<TestDelta>,
) => reduceControlSyncEnvelope(sync, envelope, applyDelta);

const initialized = () => reduce(
  createControlSyncReducerState<TestState, TestDelta>(),
  snapshot(10, ['current']),
).sync;

describe('control sync reducer', () => {
  it('treats a snapshot as authoritative when a stream starts', () => {
    const initial = createControlSyncReducerState<TestState, TestDelta>();
    initial.value = { participants: ['residual'] };

    const result = reduce(initial, snapshot(10, ['current']));

    expect(result.status).toBe('STREAM_RESET');
    expect(result.sync.value).toEqual({ participants: ['current'] });
    expect(result.sync.stateRevision).toBe(10);
  });

  it('applies contiguous deltas and deduplicates their eventId', () => {
    const first = reduce(
      initialized(),
      delta(11, 'event-11', { action: 'ADD', participantId: 'new' }),
    );
    const duplicate = reduce(
      first.sync,
      delta(11, 'event-11', { action: 'ADD', participantId: 'new' }),
    );

    expect(first.sync.value?.participants).toEqual(['current', 'new']);
    expect(duplicate.status).toBe('DUPLICATE');
    expect(duplicate.sync.value?.participants).toEqual(['current', 'new']);
  });

  it('buffers a revision gap and requests only one snapshot', () => {
    const firstGap = reduce(
      initialized(),
      delta(13, 'event-13', { action: 'ADD', participantId: 'thirteen' }),
    );
    const secondGap = reduce(
      firstGap.sync,
      delta(14, 'event-14', { action: 'ADD', participantId: 'fourteen' }),
    );

    expect(firstGap).toMatchObject({ status: 'GAP_BUFFERED', requestSnapshot: true });
    expect(secondGap).toMatchObject({ status: 'GAP_BUFFERED', requestSnapshot: false });
    expect(secondGap.sync.stateRevision).toBe(10);
  });

  it('drains buffered deltas when the missing contiguous delta arrives', () => {
    const gap = reduce(
      initialized(),
      delta(13, 'event-13', { action: 'ADD', participantId: 'thirteen' }),
    );
    const revisionTwelve = reduce(
      gap.sync,
      delta(12, 'event-12', { action: 'ADD', participantId: 'twelve' }),
    );
    const revisionEleven = reduce(
      revisionTwelve.sync,
      delta(11, 'event-11', { action: 'ADD', participantId: 'eleven' }),
    );

    expect(revisionEleven.sync.stateRevision).toBe(13);
    expect(revisionEleven.sync.value?.participants).toEqual([
      'current',
      'eleven',
      'twelve',
      'thirteen',
    ]);
    expect(revisionEleven.sync.bufferedDeltas.size).toBe(0);
    expect(revisionEleven.sync.snapshotRequested).toBe(false);
  });

  it('uses a newer snapshot as a replacement and then applies contiguous buffered deltas', () => {
    const gap = reduce(
      initialized(),
      delta(13, 'event-13', { action: 'ADD', participantId: 'thirteen' }),
    );
    const recovered = reduce(gap.sync, snapshot(12, ['authoritative']));

    expect(recovered.sync.stateRevision).toBe(13);
    expect(recovered.sync.value?.participants).toEqual(['authoritative', 'thirteen']);
    expect(recovered.sync.bufferedDeltas.size).toBe(0);
  });

  it('rejects stale snapshots without regressing current state', () => {
    const current = reduce(
      initialized(),
      delta(11, 'event-11', { action: 'ADD', participantId: 'new' }),
    ).sync;
    const stale = reduce(current, snapshot(10, ['obsolete']));

    expect(stale.status).toBe('STALE');
    expect(stale.sync.stateRevision).toBe(11);
    expect(stale.sync.value?.participants).toEqual(['current', 'new']);
  });

  it('buffers a delta from a new stream and requests its authoritative snapshot', () => {
    const result = reduce(
      initialized(),
      delta(
        1,
        'new-stream-event',
        { action: 'ADD', participantId: 'unconfirmed' },
        { serverEpoch: 'server-two', sessionId: 'session-two' },
      ),
    );

    expect(result).toMatchObject({
      status: 'GAP_BUFFERED',
      requestSnapshot: true,
    });
    expect(result.sync.value?.participants).toEqual(['current']);
  });

  it('applies a buffered new-stream delta after receiving its baseline snapshot', () => {
    const waiting = reduce(
      initialized(),
      delta(
        1,
        'new-stream-event',
        { action: 'ADD', participantId: 'after-baseline' },
        { serverEpoch: 'server-two', sessionId: 'session-two' },
      ),
    );
    const reset = reduce(
      waiting.sync,
      snapshot(0, ['fresh'], { serverEpoch: 'server-two', sessionId: 'session-two' }),
    );

    expect(reset.status).toBe('STREAM_RESET');
    expect(reset.sync.stateRevision).toBe(1);
    expect(reset.sync.value?.participants).toEqual(['fresh', 'after-baseline']);
    expect(reset.sync.bufferedDeltas.size).toBe(0);
  });

  it('resets revision, buffers, and dedupe state on an authoritative new stream snapshot', () => {
    const old = reduce(
      initialized(),
      delta(11, 'old-event', { action: 'ADD', participantId: 'old' }),
    ).sync;
    const reset = reduce(
      old,
      snapshot(0, ['fresh'], { serverEpoch: 'server-two', sessionId: 'session-two' }),
    );

    expect(reset.status).toBe('STREAM_RESET');
    expect(reset.sync.stateRevision).toBe(0);
    expect(reset.sync.value?.participants).toEqual(['fresh']);
    expect(reset.sync.seenEventIds.size).toBe(0);
    expect(reset.sync.bufferedDeltas.size).toBe(0);
    expect(reset.sync.retiredStreams.has('server-one\u001fsession-one')).toBe(true);
  });

  it('does not revert to a retired session after a stream reset', () => {
    const reset = reduce(
      initialized(),
      snapshot(0, ['fresh'], { serverEpoch: 'server-two', sessionId: 'session-two' }),
    ).sync;
    const delayedOldSnapshot = reduce(reset, snapshot(99, ['delayed-old']));

    expect(delayedOldSnapshot.status).toBe('STALE');
    expect(delayedOldSnapshot.sync.value?.participants).toEqual(['fresh']);
    expect(delayedOldSnapshot.sync.stateRevision).toBe(0);
  });
});
