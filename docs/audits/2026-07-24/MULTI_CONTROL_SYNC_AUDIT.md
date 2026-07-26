# Multi-Control synchronization audit — 2026-07-24

## Decision

The current implementation is not ready for production use with multiple
Control instances. A newly authorized or reconnected Control can receive the
technical participant snapshot while remaining unable to decrypt aliases or
private messages. “Sin nick” is therefore a synchronization failure, not a
valid steady state for an admitted participant whose alias is known to another
authorized Control.

This audit preserves the privacy invariant:

- the server never receives or decrypts clear aliases or private messages;
- technical state is server-owned and non-nominal;
- nominal/private state is an E2E encrypted overlay shared between authorized
  Controls;
- all state is memory-only for the presentation session and is cleared on
  session rotation.

## Confirmed findings

| ID | Severity | Finding |
| --- | --- | --- |
| MC-SYNC-001 | Critical | Control authorization and E2E key delivery are separate, non-atomic flows. Approval is sent even when key transfer fails or the historical join-request event was missed. |
| MC-SYNC-002 | Critical | No E2E Control-to-Control snapshot exists. Alias maps, Audience public keys, inbox messages and microphone configuration live only in one Control’s React state. |
| MC-SYNC-003 | High | All Audience private signals share a silent limit of five messages per minute. Automatic profile traffic can consume it before alias recovery or a human private message. |
| MC-SYNC-004 | High | Alias recovery is a one-shot broadcast without request ID, acknowledgement, retry or targeted unresolved IDs. Local signature deduplication prevents later recovery attempts. |
| MC-SYNC-005 | High | There is no monotonic `stateRevision`. Random `snapshotId` and timestamps cannot detect stale snapshots, missing events or ordering gaps. |
| MC-SYNC-006 | High | A Control reconnect creates a new Control identity and authorization flow. The client does not automatically request a fresh snapshot on each WebSocket reopen. |
| MC-SYNC-007 | High | Snapshot application merges participants instead of atomically replacing the collection. Removed participants can survive as stale or ghost state. |
| MC-SYNC-008 | High | Audience status can overwrite server-owned moderation fields. A delayed status may regress grant, queue, mute or active state. |
| MC-SYNC-009 | Medium | Private messages have no stable message/event ID. Retransmission cannot be distinguished from a new message and inboxes cannot be reconciled. |
| MC-SYNC-010 | Medium | The Control UI consumes only part of the operational snapshot and reconstructs queue/ownership metadata through separate event paths. |
| MC-SYNC-011 | Medium | Duplicate-alias ordinals are not represented in shared Control state, so they cannot remain stable across Control handoff. |

## Direct causes of the reported behavior

1. `LIVE_AUDIO_CONTROL_JOIN_REQUEST` is an ephemeral event and its recipient
   public key is absent from the server snapshot.
2. `handleApproveRequest` authorizes in `finally`, including when
   `authorizeSecondaryControl` rejects.
3. The key handoff transfers only the Control session key, not the existing
   private overlay.
4. A new Control asks Audience to repeat aliases, but the response may be
   silently rejected by the shared five-per-minute limiter.
5. If recovery fails once, the unresolved-ID signature can suppress further
   attempts.
6. Private messages sent before the new Control joined are intentionally absent
   from the current operational snapshot.

## Target state model

### Server-owned technical state

Introduce a monotonically increasing integer `stateRevision`, scoped by
`presentationSessionId`. Increment it exactly once for every accepted canonical
mutation:

- participant connect/disconnect and rejoin grace transitions;
- queue/hand state;
- grant, revoke, mute, block and rescue;
- visibility/view permissions;
- Control ownership and authorization;
- LiveKit operational state relevant to Control;
- session rotation.

Every technical snapshot and incremental event must contain:

```ts
{
  presentationSessionId: string;
  stateRevision: number;
  eventId: string;
  connectionEpoch: string;
}
```

The server stamps revision and time. Audience may report telemetry, but cannot
write canonical moderation fields.

### E2E private Control overlay

Add a separately versioned encrypted payload:

```ts
interface PrivateControlOverlay {
  presentationSessionId: string;
  keyId: string;
  privateStateRevision: number;
  basedOnStateRevision: number;
  participantAliases: Record<string, string>;
  aliasOrdinals: Record<string, number>;
  audiencePublicKeys: Record<string, string>;
  privateMessages: PrivateMessageRecord[];
  participantMicrophoneConfigs: Record<string, MicrophoneConfig>;
}
```

`PrivateMessageRecord` needs a stable random `messageId`, sender participant ID,
encrypted content, and session-relative receipt order. The clear overlay exists
only in authorized Control memory. The server may retain the latest bounded
ciphertext blob with `keyId`, revisions and TTL, but must not possess its
decryption key.

Inbox retention remains session-only. Rotation clears the overlay and opaque
server copy. Whether dismissing a message is per-Control or shared must be made
an explicit product rule before implementation; the recommended default is
per-Control read/dismiss state with a shared immutable message journal.

## Authorization and synchronization protocol

1. A Control connects or resumes with an opaque Control resume credential.
2. Server sends `WELCOME` with `connectionEpoch`, session ID and current
   technical revision.
3. A new Control remains `PENDING`. A resumed authorized Control remains
   `AUTHORIZED_SYNCING` until synchronization completes.
4. Authorization transfers the E2E key and private overlay. The join request
   data needed for transfer must be recoverable from current pending state, not
   only an old event.
5. Recipient validates/imports the key, decrypts the overlay and responds with
   an ACK containing `keyId`, `privateStateRevision` and request ID.
6. Only after that ACK may the server expose the Control as operational
   `AUTHORIZED`. Never authorize from a `finally` block.
7. Control requests a technical snapshot with a unique `requestId`.
8. While applying it, Control buffers incremental events.
9. Snapshot atomically replaces technical maps at revision `R`.
10. Buffered events are deduplicated by `eventId` and applied only in contiguous
    order `R+1`, `R+2`, ….
11. A revision gap, key mismatch, timeout, WebSocket reopen or session epoch
    change triggers automatic resynchronization.
12. UI state is `SYNCING` until both technical and private revisions are ready.
    Show “Sincronizando alias…” rather than materializing “Sin nick”.

If no authorized Control or usable encrypted overlay remains, request alias
recovery from Audience using targeted participant IDs, `requestId`, ACK and
bounded exponential retry. Recovery traffic must have a separate quota from
human private messages. Offline participants can only be recovered from the
opaque encrypted overlay; this is why Audience replay alone is insufficient.

## Snapshot and delta rules

- Accept a snapshot only when its session ID matches and it is not older than
  the revision already applied.
- Treat the snapshot participant collection as authoritative replacement.
- Apply an incremental event only when `stateRevision === current + 1`.
- Ignore duplicate events with a known `eventId` or revision.
- On `stateRevision > current + 1`, stop applying deltas and request resync.
- Keep a bounded delta buffer while syncing.
- Bind private overlay to `basedOnStateRevision`; reconcile/remove private
  entries for participants absent from the accepted technical snapshot.
- Do not use client-provided wall-clock timestamps for conflict resolution.

## Required test matrix

### Authorization and E2E handoff

- New secondary receives key, full private overlay and technical snapshot.
- Missing historical join-request event cannot produce an authorized Control
  without a key.
- Failed key import/overlay decrypt never authorizes.
- Duplicate authorization/ACK is idempotent.
- Principal disconnect promotes an already synchronized authorized successor.

### Snapshot/event races

- Delta arrives before snapshot application finishes.
- Snapshot older than local revision is ignored.
- Duplicate snapshot and duplicate event do not duplicate state/messages.
- Revision gap triggers exactly one bounded resync.
- Authoritative snapshot removes a participant absent from it.
- Delayed Audience telemetry cannot revert a moderation decision.

### Reconnection

- Same Control resumes after transient disconnect without becoming a new
  pending Control.
- Every WebSocket reopen requests/revalidates both snapshots.
- Session rotation rejects old resume credentials, revisions and ciphertext.
- Key rotation during sync restarts private-overlay synchronization safely.

### Alias and messages

- Existing aliases appear on a newly authorized Control without Audience
  activity.
- Duplicate aliases retain stable Control-only ordinals.
- Offline Audience alias remains available from encrypted overlay.
- Alias-recovery request retries after loss/rate-limit and receives ACK.
- Human private messages are not blocked by profile/recovery traffic.
- Message retransmission is deduplicated by stable `messageId`.
- New authorized Control receives the bounded session inbox according to the
  agreed retention/dismissal rule.

### Scale and failure injection

- 50 Audience participants and multiple Controls reconnecting concurrently.
- Packet/event loss, reordering and duplication around snapshot boundaries.
- Principal crash during key/overlay handoff.
- Opaque overlay unavailable or corrupt: explicit degraded state and targeted
  recovery, never silent “Sin nick”.

## Curated stabilization sequence

1. **Safety hotfix**
   - remove authorization from `finally`;
   - prevent operational authorization without E2E ACK;
   - separate message and recovery rate limits;
   - return ACK/NACK for private sends;
   - request snapshot on every WebSocket `open`.
2. **Technical revision protocol**
   - add `stateRevision`, `eventId`, `connectionEpoch`;
   - make server fields canonical;
   - implement atomic snapshot replacement, buffering, dedupe and gap resync.
3. **Control resume identity**
   - opaque ephemeral resume credential, server-side hash and rejoin grace;
   - rotate/clear on presentation-session rotation.
4. **Private E2E overlay**
   - versioned Control-to-Control snapshot;
   - bounded opaque ciphertext cache in server memory;
   - stable alias ordinals and message IDs.
5. **Recovery and UX**
   - targeted alias recovery with ACK/backoff;
   - explicit `SYNCING`, `READY` and degraded states;
   - never show “Sin nick” while recovery is in progress.
6. **Concurrency verification**
   - deterministic protocol tests, reconnect/race injection and 50-user soak.
7. **Resume the broader pre-production audit**
   - only after the multi-Control gate passes.

## Evidence run

Focused existing tests passed:

```text
__tests__/wsRouting.test.ts
__tests__/activeParticipants.test.ts
__tests__/wsSecurity.test.ts
__tests__/utils/cryptoUtils.test.ts
__tests__/utils/liveAudioAliasRequests.test.ts
41 tests passed
```

They validate current routing restrictions and basic snapshots, but do not
exercise the required end-to-end multi-Control state convergence described
above.
