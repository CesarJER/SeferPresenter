export interface ControlSyncIdentity {
  serverEpoch: string;
  sessionId: string;
}

export interface ControlSyncSnapshot<TState> extends ControlSyncIdentity {
  type: 'SNAPSHOT';
  stateRevision: number;
  state: TState;
}

export interface ControlSyncDelta<TDelta> extends ControlSyncIdentity {
  type: 'DELTA';
  stateRevision: number;
  eventId: string;
  delta: TDelta;
}

export type ControlSyncEnvelope<TState, TDelta> =
  | ControlSyncSnapshot<TState>
  | ControlSyncDelta<TDelta>;

export interface ControlSyncReducerState<TState, TDelta> {
  identity: ControlSyncIdentity | null;
  stateRevision: number;
  value: TState | null;
  bufferedDeltas: Map<number, ControlSyncDelta<TDelta>>;
  seenEventIds: Set<string>;
  retiredStreams: Set<string>;
  snapshotRequested: boolean;
}

export type ControlSyncReducerStatus =
  | 'APPLIED'
  | 'DUPLICATE'
  | 'STALE'
  | 'GAP_BUFFERED'
  | 'STREAM_RESET'
  | 'AWAITING_SNAPSHOT';

export interface ControlSyncReducerResult<TState, TDelta> {
  sync: ControlSyncReducerState<TState, TDelta>;
  status: ControlSyncReducerStatus;
  requestSnapshot: boolean;
}

export type ApplyControlSyncDelta<TState, TDelta> = (
  state: TState,
  delta: TDelta,
) => TState;

export const createControlSyncReducerState = <
  TState,
  TDelta,
>(): ControlSyncReducerState<TState, TDelta> => ({
  identity: null,
  stateRevision: -1,
  value: null,
  bufferedDeltas: new Map(),
  seenEventIds: new Set(),
  retiredStreams: new Set(),
  snapshotRequested: false,
});

const streamKey = (identity: ControlSyncIdentity): string =>
  `${identity.serverEpoch}\u001f${identity.sessionId}`;

const hasSameIdentity = (
  left: ControlSyncIdentity | null,
  right: ControlSyncIdentity,
): boolean => (
  left?.serverEpoch === right.serverEpoch
  && left.sessionId === right.sessionId
);

const cloneSyncState = <TState, TDelta>(
  sync: ControlSyncReducerState<TState, TDelta>,
): ControlSyncReducerState<TState, TDelta> => ({
  ...sync,
  bufferedDeltas: new Map(sync.bufferedDeltas),
  seenEventIds: new Set(sync.seenEventIds),
  retiredStreams: new Set(sync.retiredStreams),
});

const applyBufferedContiguousDeltas = <TState, TDelta>(
  sync: ControlSyncReducerState<TState, TDelta>,
  applyDelta: ApplyControlSyncDelta<TState, TDelta>,
): void => {
  while (sync.value !== null) {
    const nextRevision = sync.stateRevision + 1;
    const next = sync.bufferedDeltas.get(nextRevision);
    if (!next) break;

    sync.value = applyDelta(sync.value, next.delta);
    sync.stateRevision = nextRevision;
    sync.bufferedDeltas.delete(nextRevision);
  }

  if (sync.bufferedDeltas.size === 0) {
    sync.snapshotRequested = false;
  }
};

const bufferDelta = <TState, TDelta>(
  sync: ControlSyncReducerState<TState, TDelta>,
  envelope: ControlSyncDelta<TDelta>,
): ControlSyncReducerResult<TState, TDelta> => {
  const shouldRequestSnapshot = !sync.snapshotRequested;
  sync.snapshotRequested = true;
  sync.seenEventIds.add(envelope.eventId);
  if (!sync.bufferedDeltas.has(envelope.stateRevision)) {
    sync.bufferedDeltas.set(envelope.stateRevision, envelope);
  }

  return {
    sync,
    status: sync.value === null ? 'AWAITING_SNAPSHOT' : 'GAP_BUFFERED',
    requestSnapshot: shouldRequestSnapshot,
  };
};

export const reduceControlSyncEnvelope = <TState, TDelta>(
  current: ControlSyncReducerState<TState, TDelta>,
  envelope: ControlSyncEnvelope<TState, TDelta>,
  applyDelta: ApplyControlSyncDelta<TState, TDelta>,
): ControlSyncReducerResult<TState, TDelta> => {
  const sync = cloneSyncState(current);
  const incomingIdentity: ControlSyncIdentity = {
    serverEpoch: envelope.serverEpoch,
    sessionId: envelope.sessionId,
  };
  const incomingStreamKey = streamKey(incomingIdentity);

  if (!hasSameIdentity(sync.identity, incomingIdentity)) {
    if (sync.retiredStreams.has(incomingStreamKey)) {
      return { sync, status: 'STALE', requestSnapshot: false };
    }

    if (envelope.type === 'DELTA') {
      return bufferDelta(sync, envelope);
    }

    if (sync.identity) {
      sync.retiredStreams.add(streamKey(sync.identity));
    }
    const pendingForIncomingStream = Array.from(sync.bufferedDeltas.entries())
      .filter(([, pending]) => (
        hasSameIdentity(incomingIdentity, pending)
        && pending.stateRevision > envelope.stateRevision
      ));
    sync.identity = incomingIdentity;
    sync.stateRevision = envelope.stateRevision;
    sync.value = envelope.state;
    sync.bufferedDeltas = new Map(pendingForIncomingStream);
    sync.seenEventIds = new Set(
      pendingForIncomingStream.map(([, pending]) => pending.eventId),
    );
    sync.snapshotRequested = false;
    applyBufferedContiguousDeltas(sync, applyDelta);

    return {
      sync,
      status: 'STREAM_RESET',
      requestSnapshot: false,
    };
  }

  if (envelope.type === 'SNAPSHOT') {
    if (envelope.stateRevision <= sync.stateRevision) {
      return {
        sync,
        status: envelope.stateRevision === sync.stateRevision ? 'DUPLICATE' : 'STALE',
        requestSnapshot: false,
      };
    }

    sync.stateRevision = envelope.stateRevision;
    sync.value = envelope.state;
    sync.snapshotRequested = false;
    for (const revision of sync.bufferedDeltas.keys()) {
      if (revision <= envelope.stateRevision) {
        sync.bufferedDeltas.delete(revision);
      }
    }
    applyBufferedContiguousDeltas(sync, applyDelta);

    return { sync, status: 'APPLIED', requestSnapshot: false };
  }

  if (sync.seenEventIds.has(envelope.eventId)) {
    return { sync, status: 'DUPLICATE', requestSnapshot: false };
  }

  if (envelope.stateRevision <= sync.stateRevision) {
    sync.seenEventIds.add(envelope.eventId);
    return { sync, status: 'STALE', requestSnapshot: false };
  }

  if (sync.value === null || envelope.stateRevision > sync.stateRevision + 1) {
    return bufferDelta(sync, envelope);
  }

  sync.value = applyDelta(sync.value, envelope.delta);
  sync.stateRevision = envelope.stateRevision;
  sync.seenEventIds.add(envelope.eventId);
  applyBufferedContiguousDeltas(sync, applyDelta);

  return { sync, status: 'APPLIED', requestSnapshot: false };
};
