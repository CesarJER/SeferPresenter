# Sync Architecture

This document describes the current synchronization model and backend-ready
direction. It avoids claims beyond what the current code shows.

## Current Sync Model

The app uses two sync paths:

- Local tabs: `BroadcastChannel('sefer-presenter')` in `src/hooks/useSyncState.ts`.
- LAN/backend-ready mode: WebSocket at `/ws` is preferred for sending `SYNC_STATE` and `REMOTE_COMMAND` when the connection is open, falling back to HTTP POST endpoints (which broadcast updates via Server-Sent Events (SSE) in `server/local-server.mjs`).
- Server audio timeline: WebSocket at `/ws`, attached by `server/ws-server.mjs`.

The backend is the practical source of truth for projected state. Control emits
a `REMOTE_COMMAND`; `server/local-server.mjs` validates and reduces supported
presentation commands through `server/projection-state-reducer.mjs`, updates
`currentState`, logs the resulting `origin=control` state change, and broadcasts
the updated `SYNC_STATE`. Presenter applies backend state as a display client.
Presenter may still emit real media telemetry from its DOM media elements, but
it is not required for Control-to-Audience navigation.

The local backend keeps SSE connections alive with `data: heartbeat\n\n` every
30 seconds on `/api/state-events`, `/api/audience/events`, `/api/quiz-events`,
and `/api/quiz-control-events`. Audience uses a `SYNC_STATE`-compatible public
snapshot/events pair containing only the active slide plus the functional media,
quiz, scripture and display state required to render it. Control quiz aggregates use the authenticated Control
event route; their delivery does not depend on an optional Basic Auth header on
the public Audience stream. Closed or errored SSE responses are removed from
the server client sets, and failed SSE writes are dropped from future broadcasts.

Audience access is public by default and can be changed to `CONTROLLED` only by
the principal Control. Switching an active public session to controlled access
keeps active participants who already supplied a nick admitted; anonymous and
later arrivals must request admission. In controlled mode the browser first obtains a random,
session-scoped credential from `/api/audience/access/bootstrap`, binds it to its
WebSocket and sends the requested alias through the existing E2E private signal.
The access credential identifier and the later Live Audio participant identifier
remain separate on that WebSocket; binding access must not prevent Audience from
registering its Live Audio identity. The current Control public key is replayed
when access binds so a request is not lost if the initial key announcement raced
the Audience UI subscription.
Control admits, rejects or blocks the request without the server reading that
alias. Admission is enforced on the Audience state snapshot, single-use
STATE/QUIZ SSE tickets, quiz submissions and LiveKit token issuance. The browser
stores the credential; the backend keeps only its SHA-256 digest and RAM access
state until presentation-session rotation.
Blocked nicks remain outside and cannot request access again, but stay visible
to authorized Controls so they can be admitted later.

Main message types live in `src/types/sync.ts`:

- `SYNC_STATE`: canonical synchronization envelope. Control/Presenter receive
  the full presentation; Audience receives the same functional contract with
  the presentation reduced to its active slide.
- `REMOTE_COMMAND`: operator intent sent from control to the backend reducer.
- `AUDIO_TELEMETRY`: lightweight audio playback updates.
- `VIDEO_TELEMETRY`: lightweight video playback updates.
- `DISPLAY_TELEMETRY`: background lock/override updates.
- `AUDIO_SYNC_MAPS_UPDATE`: audio cue map updates.
- `SET_AUTODUCK_STATE`: Autoduck status and fade factor to lower media volume automatically when active speakers are detected.
- `REQUEST_STATE`: clients ask for a fresh backend snapshot; Control/Presenter
  fetch `/api/state` and Audience fetches `/api/audience/state` on startup.
- `WELCOME`: sent by the server upon WebSocket connection, providing client ID, role, server time, and presentation session ID.
- `PRESENTATION_SESSION_ROTATED`: announces a new presentation session ID, which forces clients to update/sync.
- `SERVER_TIME_PING` / `SERVER_TIME_PONG`: round-trip clock sync messages for estimating client-to-server clock offset.
- `AUDIO_TIMELINE_ACTION`: control action dispatched to the server audio timeline.
- `AUDIO_TIMELINE_STATE`: server-broadcasted timeline playback status.
- `AUDIO_PRESENTATION_CLOCK`: periodic message containing the current estimated position of the audio playback.
- `MEDIA_MASTER_STATUS`: server-broadcasted status determining if the current control client is the media master (e.g. when there is no active presenter).
- `ERROR`: technical error code and message.
- `SESSION_ACCESS_POLICY`, `AUDIENCE_ACCESS_STATE`,
  `AUDIENCE_ACCESS_REQUEST` and `AUDIENCE_ACCESS_DECISION`: controlled-entry
  state. Only the principal changes the public/controlled policy; authorized
  Controls process pending requests from their private inbox.
  `AUDIENCE_ACCESS_LEAVE` returns an admitted Audience client to the access gate
  when it explicitly leaves during a controlled session.
- Live Audio family: optional LiveKit-ready technical messages that stay
  outside `SYNC_STATE` and existing `REMOTE_COMMAND` payloads.

`src/utils/syncProtocol.ts` builds protocol messages. `src/utils/validation.ts`
validates incoming remote state and sync messages before they are applied.

## Optional Live Audio Message Family

Fase 5.1 defines the Live Audio protocol contracts without connecting LiveKit.
The application must continue to work as presentation-only software when the
module is disabled, misconfigured, unsupported, or not implemented by the
backend.

The shared core may know the lightweight protocol, but the runtime LiveKit
implementation must live under `src/features/liveAudio/`. Core sync files,
`src/App.tsx`, shared types, and existing shared components must not import
the LiveKit browser SDK.

Live Audio message contracts live in `src/types/liveAudio.ts` and are included
in `BroadcastMessage` as a separate family:

- `LIVE_AUDIO_PARTICIPANT_STATUS`: technical participant state by ephemeral
  `participantId`, role, speaker state, publish/subscribe capability, active
  audience flag, microphone-open flag, mute flag, and kicked flag. It does not
  carry aliases in clear text.
- `LIVE_AUDIO_CONNECTION_COUNTS`: server-owned WebSocket counts for total
  connected presenter/control/audience clients. Control uses this for the total
  audience indicator so passive listeners are included.
- `LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE`: technical active-participant profile
  containing `participantId`, visibility preference and an Audience public key.
  An alias is invalid in this clear-text message and must use the private E2E
  channel.
- `LIVE_AUDIO_GRANT_SPEAK`, `LIVE_AUDIO_REVOKE_SPEAK`: Control-authorized
  speaker permission changes by `participantId`.
- `LIVE_AUDIO_MUTE_PARTICIPANT`, `LIVE_AUDIO_MUTE_ALL`,
  `LIVE_AUDIO_KICK_PARTICIPANT`, `LIVE_AUDIO_RESCUE_PARTICIPANT`: moderation
  actions by `participantId`.
- `LIVE_AUDIO_CONTROL_PUBLIC_KEY`: current Control public key for encrypted
  private signaling.
- `LIVE_AUDIO_CONTROL_JOIN_REQUEST`, `LIVE_AUDIO_CONTROL_AUTHORIZED`: secondary
  Control authorization flow. In Fase 5.2, a secondary Control may include a
  recipient public key in the join request; the authorizing Control replies with
  encrypted session private-key material (`encryptedSessionPrivateKey`, `nonce`,
  `transferPublicKey`, `sessionPublicKey`, `keyId`) so the private key is never
  sent in clear text or persisted.
- `LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE`,
  `LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION`: Fase 5.3 server-owned principal,
  pending, authorization, and rejection state for Control instances. The first
  `/ws?role=control` connection registered by `server/ws-server.mjs` becomes
  `PRINCIPAL`; later Control connections are `PENDING` with a short `NNN-NNN`
  verification code that expires after
  `SEFER_LIVE_AUDIO_CONTROL_CODE_TTL_SECONDS` seconds, clamped to at most 120
  seconds and defaulting to 90.
- `CONTROL_KEY_ROTATED`: announces that clients must negotiate against a new
  Control public key.
- `PRIVATE_CONTROL_SIGNAL`: encrypted bidirectional private container with only
  technical routing fields and ciphertext. Audience uses it for aliases,
  hand-state refreshes, and private messages to authorized Controls (both in
  active session and waiting room); authorized Controls use it for targeted
  microphone configuration, E2E chat responses to participants, inter-control
  team announcements, and message reply state synchronization.
- `LIVE_AUDIO_SET_EXTERNAL_BROADCAST_STATE` and
  `LIVE_AUDIO_EXTERNAL_BROADCAST_STATE`: authorized operator declaration and
  server-owned revision for `off`, `live`, or `recording`. This is not automatic
  streaming detection.

`PRIVATE_CONTROL_SIGNAL` has the exact public envelope:

- `type`
- `fromParticipantId`
- optional `toControlSessionId`
- optional `toParticipantId`
- `keyId`
- `ephemeralPublicKey`
- `ciphertext`
- `nonce`
- optional `createdAt`

Audience clients encrypt private moderation payloads with ECDH P-256 plus
AES-GCM 256. Each message uses a fresh 12-byte AES-GCM nonce. Control keeps a
per-session nonce replay guard in memory and clears it when the Control key
rotates; historical messages are not recovered after `CONTROL_KEY_ROTATED`.
When Control sends a private signal back to Audience, it targets
`toParticipantId` and derives the shared key from the audience ephemeral public
key captured from that participant's previous private signal.

The server must only route `PRIVATE_CONTROL_SIGNAL`. It must not decrypt,
persist, log, or semantically inspect aliases, private text, keys, or ciphertext
content. Runtime backend checks must still bind `participantId` to an active
WebSocket/session and authorized role; UUID format validation alone is not
authorization.

### Participantes Activos Visibles (E2E)

Active audience participants may voluntarily share their alias with other active
participants. Alias, technical audience ID and
`isAliasVisibleToActiveParticipants` are page-session state and are not stored
in `localStorage`; startup removes keys left by older versions. Logout and
presentation-session rotation purge them, rotate the technical ID and clear quiz
identity/state. `VITE_SEFER_ACTIVE_ALIAS_VISIBLE_BY_DEFAULT=false` keeps the
checkbox off unless explicitly configured otherwise.

The readable list is never computed or broadcast by the server. Audience sends
only `participantId`, its sharing preference and its public key in clear via
`LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE`. It sends the alias separately inside
an encrypted `PRIVATE_CONTROL_SIGNAL` to authorized Control. Control computes
the visible A-Z list with `computeVisibleActiveParticipants` and sends
`{ type: 'VISIBLE_ACTIVE_PARTICIPANTS', participants, updatedAt }` back as a
targeted encrypted private signal to each active viewer whose
`canViewActiveParticipants` flag is true. The server neither receives a readable
alias in the active profile nor accepts one in snapshot patches.

The server owns only technical fields in memory and snapshots:
`isAliasVisibleToActiveParticipants`, `canViewActiveParticipants`,
`isAliasHiddenByControl`, and `activeListPublicKey`. Control may grant/revoke
list-view permission with `LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION`; the
server confirms that state to the target audience client with clear
`LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION`. Control may put a consenting
participant into incognito mode with `LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY`,
and may use `LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT` only on kicked participants.
Remove is not the same as block: kick keeps `isKicked=true`, while remove clears
kicked state, clears active-list flags and alias overlay, and lets the
participant join again with a clean alias.

`SEFER_ACTIVE_ALIAS_MODERATION_DEFAULT_VISIBLE=true` means consenting users are
not hidden by Control by default. When the principal Control changes,
`CONTROL_KEY_ROTATED` causes Audience to re-signal aliases/preferences; the new
principal receives the operational snapshot and redistributes the current list.
Control uses `lastSentListRef` to avoid re-sending unchanged visible lists.

`server/ws-server.mjs` filters Live Audio messages by Control state:

- Audience WebSocket clients may send only `SERVER_TIME_PING`, their own
  `LIVE_AUDIO_PARTICIPANT_STATUS`, technical
  `LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE`, and `PRIVATE_CONTROL_SIGNAL`.
- Audience `PRIVATE_CONTROL_SIGNAL` messages are accepted only when
  `fromParticipantId` is a UUID v4 bound to the active WebSocket connection, the
  ciphertext is base64 and at most 4096 bytes, the nonce decodes to 12 bytes,
  and the participant stays under the server-side 5-per-minute rate limit.
- Audience participant status is reduced to technical fields and routed only to
  presenter and authorized Controls; audience clients do not receive a full
  participant list.
- `PENDING` Controls do not receive `PRIVATE_CONTROL_SIGNAL`.
- `PENDING` Controls cannot send private signals or moderation messages such as
  grant, mute, or kick; the server returns an `ERROR`.
- Authorized Controls can publish the current Control public key and can send
  moderation actions by `participantId`; those actions update only memory state,
  are routed to presenter/authorized Controls, and are also delivered to the
  affected audience participant so its local microphone state can react. They
  are not folded into `SYNC_STATE`.
- Authorized Controls can send `PRIVATE_CONTROL_SIGNAL` targeted to a specific
  `toParticipantId` or to fellow authorized Controls; the server routes it
  blindly without inspecting ciphertext.
- `LIVE_AUDIO_REQUEST_ALIASES` is an empty public doorbell from authorized
  Controls to audience clients. Audience responses must travel back as encrypted
  `PRIVATE_CONTROL_SIGNAL` payloads such as `ACTIVE_STATE` or `REQUEST_WORD`,
  never as clear-text alias messages. Control also retries this doorbell for
  unresolved controlled-access nicks.
- `LIVE_AUDIO_SNAPSHOT_REQUEST`, `LIVE_AUDIO_SNAPSHOT`, and
  `LIVE_AUDIO_SNAPSHOT_PATCH` support Control handoff. Only authorized Controls
  receive or publish operational snapshots; pending Controls receive an error
  and no snapshot. The snapshot includes connected-user counts, participants,
  logical roles (`pasivo`,
  `activo`, `cola`, `orador`, `control`, `presenter`), microphone permission/track state,
  speaker state, intervention queue, Control authorizations, relevant LiveKit
  state, and anonymous quiz aggregates. It does not include historical private
  messages, ciphertext history or aliases.
- The WebSocket server keeps the current authorized Control public key in memory
  and replays it to audience clients that connect later, so nicknames and
  private messages can be encrypted even when Control was already open.
- Moderation state transitions are intentionally explicit: grant moves queued
  or active-muted audience to `GRANTED` with microphone closed; mute keeps the
  participant `GRANTED` but closes the microphone; revoke moves a speaker back
  to active-muted `LISTENER`; restrict (kick) moves the participant to restricted
  `REVOKED` with `isKicked=true` (silenced, without mic/chat participation, but
  keeping slide viewing); rescue clears `isKicked` and returns the participant to
  active muted `LISTENER` with `canPublishAudio=false` and no published track.
  `REMOVE` removes the active profile cleanly, returning the client to `REQUEST_REQUIRED`
  so they can re-enter cleanly. `BLOCK` imposes a full session ban (revoking tokens
  and closing all chat/interaction channels). `UNBLOCK` transitions a blocked client
  back to `WAITING` in the moderation waiting room.
- An authorized Control owns the external broadcast declaration. Every change
  to `live` or `recording` increments a server revision, revokes all existing
  Audience speaker grants and tells affected clients to close published tracks.
  Audience and Control must explicitly confirm microphone publication again for
  that revision. Changing the declaration does not start, stop or inspect OBS;
  the operator must set it before and after the external broadcast.
- `server/privacy-session-manifest.mjs` observes the accepted transition on the
  backend. Entering `recording` starts one non-nominative `.local.json` manifest;
  leaving it finalizes that manifest. This evidence is serialized through an
  internal write queue, is not a WebSocket message, and never enters
  `SYNC_STATE` or an operational snapshot.
- `allowDelegatedModerators` is controlled by
  `SEFER_LIVE_AUDIO_ALLOW_DELEGATED_MODERATORS` and defaults to true. When false,
  only the principal Control may authorize pending Controls.
- If the principal disconnects, the oldest authorized Control by authorization
  timestamp is promoted. If no authorized Control exists, the server emits
  `CONTROL_KEY_ROTATED` with reason `NO_AUTHORIZED_CONTROLS`, clears the private
  session boundary, and restarts Control ownership with the oldest pending
  Control if one remains connected.
- Audience disconnect keeps technical participant state in memory for
  `SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS` seconds. If the participant returns
  within the grace window, the same `participantId` can continue and the client
  must renegotiate private crypto state. If the participant does not return, the
  server emits a technical revoke/participant status update to presenter and
  authorized Controls, removes the `participantId`, clears speaker permission
  and mute state, and drops the pending private-signal rate window. A periodic
  sweep also enforces this cleanup if an individual timeout is missed.

Live Audio messages must use a dedicated handler in future phases. They must not
be folded into presentation `SYNC_STATE`, audio playback `AudioState`, or the
backend-owned `AudioTimelineState`.
`src/hooks/useSyncState.ts` treats Live Audio message types as WebSocket-only
subscriber events and ignores them on BroadcastChannel/SSE paths.

### Operational Snapshot Privacy

`server/ws-server.mjs` keeps the Control handoff snapshot in process memory only.
It accepts only allowlisted technical participant and microphone state; aliases
and private-signal content are rejected rather than stored in a
server-decryptable overlay. The server never stores private message history,
private signal plaintext, private keys, ciphertext logs or readable aliases in
the snapshot.

`server/local-server.mjs` contributes only anonymous quiz aggregates to the
snapshot: submitted-answer counts by slide and final-score buckets. It does not
include individual answers, nominal rankings, display names, or session IDs.

### Build And Runtime Optionality

Live Audio has two separate switches:

- `VITE_SEFER_LIVE_AUDIO_BUILD`: frontend build flag. When false, the base
  frontend should avoid static imports of `src/features/liveAudio/` and must not
  include the LiveKit browser SDK or heavy Live Audio UI in the main bundle.
- `SEFER_LIVE_AUDIO_ENABLED`: backend/runtime flag. When false, the backend
  should report Live Audio disabled and leave `/presenter`, `/control`,
  `/audience`, `/audio-editor`, media sync, quiz, and scripture flows working.

`src/types/liveAudio.ts` and validation helpers can remain in the core because
they are small protocol contracts and do not connect LiveKit. The optional
runtime module owns LiveKit SDK imports, track lifecycle, microphone permission
state, encrypted signal hooks, and Live Audio UI.

Fase 5.6 adds the optional frontend runtime entry
`src/features/liveAudio/index.ts`. `useLiveAudioAvailability.ts` checks
`GET /api/livekit/status` without importing the SDK. `useLiveAudio.ts` imports
the published LiveKit browser package (`livekit-client`) only inside the feature
module, requests tokens from `/api/livekit/token`, connects with manual audio
subscription, exposes remote audio tracks, and opens the microphone only when
`publishMicrophone()` is called after an explicit user action. `startRemoteAudio()`
is exposed so UI can keep remote playback behind a browser/user gesture.

Fase 5.11 hardens long sessions and mobile networks. `useLiveAudio.ts` refreshes
tokens through `POST /api/livekit/refresh-token` with a two-minute safety margin
and a one-use rotating `refreshCredential`,
keeps the same ephemeral `participantId` on refresh, exposes reconnecting,
reconnected, and prolonged reconnect-failure states, and stops all local tracks
when microphone publication ends, the user disconnects, or the component
unmounts. Audience clients stay listen-only until Control grants speaking and a
user gesture publishes microphone audio; passive listeners do not publish LiveKit
data.

Fase 5.4 adds `server/livekit-server.mjs` for self-hosted LiveKit backend
endpoints. It keeps participant, token, speaker, mute, kick, and rescue state in memory
only. If `SEFER_LIVE_AUDIO_ENABLED=false` or any required `LIVEKIT_*` variable is
missing, `/api/livekit/status` reports disabled or unavailable and the server
still starts without importing or requiring a LiveKit SDK. Token generation uses
minimum grants by role: the public endpoint can mint only minimum Audience
grants. Control additionally requires Basic Auth plus an authorized WS
`controlSessionId`; Presenter requires Basic Auth. Tokens include only ephemeral LiveKit identity and JSON metadata with the
UUID `participantId`; no alias is included. Mutating moderation endpoints require
an authorized WebSocket Control session from `server/ws-server.mjs`; audience
requests are rejected with 403.

`/api/livekit/refresh-token` requires `participantId` plus the rotating secret,
stores only its SHA-256 hash, rejects replay/foreign/expired credentials, and
consults the WebSocket participant state so a granted audience speaker can
receive microphone-only publish permission without changing `participantId` or
recovering any private alias/message history.
`/api/livekit/rescue-participant` clears kicked state for an authorized Control
and keeps the participant as `LISTENER` without publish permission.

## WebSocket Audio Timeline

Fase 2 adds a backend-owned audio timeline over `ws://localhost:<port>/ws`.
The React client connects to this channel, receives `AUDIO_TIMELINE_STATE` updates, and dispatches actions via `AUDIO_TIMELINE_ACTION`.
This channel synchronizes timeline state while maintaining compatibility with existing SSE event streams.
Presenter, Control, and Audience each apply the same backend timeline to their
local playback target. This is the hidden audio element on normal platforms and
an `IosAudioBufferPlayer` facade for normal music on iPhone. While the backend
timeline is playing, clients periodically compare local `currentTime` with `serverNow()` and
the canonical `basePositionSec` / `baseServerTimeMs`; small drift is corrected
with a temporary playback-rate nudge, while large drift is corrected with a
seek. This keeps the rendered lyrics/timeline and the audible track aligned on
all roles without adding high-frequency progress broadcasts.

`server/timelineManager.mjs` owns only the audio timeline fields:

- `timelineId`, `version`, `presentationId`, `audioSrc`, and `syncMapId`.
- Playback state: `status`, `basePositionSec`, `baseServerTimeMs`,
  `playbackRate`, `volume`, `durationSec`, and `loop`.
- Sync metadata: `syncMode`, cue indexes, and `updatedBy`.

`AUDIO_TIMELINE_ACTION` `SET_TRACK` may include `syncMode` and `volume` from
the selected `AudioSyncMap`; the server normalizes empty track identifiers to
`null`, clamps volume to `0..1`, and stores the selected mode as the canonical
timeline state. Runtime autoduck applies only to the DOM media element's
effective output volume; it must not overwrite the canonical timeline or
`AudioState.volume` value that controls will continue to display and sync.
Presenter/Control clients report finite media duration with
`AUDIO_TIMELINE_ACTION` `SET_DURATION`; the server uses it to clamp non-looping
positions and wrap looping positions. Control can toggle canonical audio loop
with `SET_LOOP`. When a non-looping DOM audio element reaches the end,
Presenter/Control emits `END`, moving the backend timeline to `ended` so all
roles leave `playing` together. Audience remains read-only and never sends
timeline actions.

`server/local-server.mjs` evaluates backend-owned timeline cues against
`SEFER_DATA_DIR/audio_sync.json` and emits canonical `SELECT_PRESENTATION_AND_SLIDE`
reductions with the full presentation object. This keeps music-to-letter
navigation server-owned even when a Presenter tab is connected. In `bilateral`
mode, manual Control/Presenter slide or verse selection seeks the backend
timeline to the matching cue and rebroadcasts `AUDIO_TIMELINE_STATE`.

`server/ws-server.mjs` handles:

- `WELCOME` on connection, including `clientId`, role, and server time.
- `SERVER_TIME_PING` / `SERVER_TIME_PONG` for clock estimation.
- `AUDIO_TIMELINE_ACTION` from presenter/control clients.
- `AUDIO_TIMELINE_STATE` broadcasts back to presenter/control/audience clients.
- Live Audio Control authorization state, verification-code expiry, delegated
  authorization, participant association, private-signal rate limiting,
  moderation filtering, public-key routing, private-signal routing, and
  principal succession.

`src/hooks/useServerClock.ts` sends `SERVER_TIME_PING` when the WebSocket is
open and estimates client-to-server clock offset plus RTT from
`SERVER_TIME_PONG`. Audio timeline clients should use `serverNow()` from this
hook when they need backend-owned timeline time.

Audience WebSocket clients receive `WELCOME` and `AUDIO_TIMELINE_STATE` as
read-only playback state so audience devices can hear backend-owned tracks.
Audience clients still cannot send `AUDIO_TIMELINE_ACTION`. Existing SSE
endpoints remain active for state, audience, quiz, and telemetry flows.

On iPhone/iPad, audience playback may still require a local user gesture after
the synchronized state arrives. `src/main-audience.tsx` shows an `Activar audio
y video` button when local audio/video `play()` is blocked, resumes the managed
audio context, and retries the current audio, timeline, and active video media.
This is a browser-policy recovery path only; it does not change canonical
timeline state or grant audience control over media actions.

Only iPhone normal music uses the decoded-buffer player. It recreates one-shot
`AudioBufferSourceNode` instances for play and seek, applies canonical volume
and runtime autoduck through a `GainNode`, and routes that gain into a
`MediaStreamAudioDestinationNode` consumed by one hidden audio element. This
keeps a Safari media session associated with normal music across screen locking
without duplicating the audible graph while playback is active. Pause stops both
the buffer source and MediaStream audio element; a later remote resume may need
the existing user-gesture unlock path. Stream-output failures use the direct
AudioContext destination; decode/request failures use the hidden native audio
element. The player exposes the same local timing surface used by drift
correction. This local choice does not alter timeline messages, telemetry
contracts, ownership, or Android/iPad/desktop playback.

## Local-Only Today

Current local/browser state includes:

- Stored presenter state and background lock in `localStorage`.
- Control editor UI state such as draft text, expanded rows, fullscreen, panel visibility.
- Audience detailed answer/score state managed by `src/hooks/useQuizAnswers.ts`
  and partitioned by `presentationId` in versioned, expiring local-storage
  envelopes. The default TTL is 24 hours and is clamped to 1-168 hours. Network contributions
  contain independent submission IDs per aggregation scope, never a stable quiz
  session ID.
- DOM media element refs and loaded media metadata.

Keep these local unless another device/mode must observe them.

### Legal Document Boundary

`DataProtectionPage` does not embed operator facts. It fetches the Markdown
selected by `VITE_PRIVACY_POLICY_PATH`, which is constrained to `/legal/*.md`,
and displays the declared version plus a browser-computed SHA-256. The neutral
fallback is `public/legal/privacy.md`; an operator may build with an ignored
`.local` legal path. A fetch failure is visible and does not silently substitute
different legal wording. Audit reports remain outside `public/legal/`.

## Backend-Ready Direction

Current inference: the backend owns canonical projected state for LAN/mobile
use. Browser clients still mirror and render state locally, but supported
Control commands are reduced in the backend before being broadcast as
`SYNC_STATE`.

Backend-owned or backend-mirrored pieces:

- `/api/state` and `/api/state-events` for authenticated Control/Presenter
- `/api/command`, which reduces supported `REMOTE_COMMAND` payloads into
  canonical `SYNC_STATE`
- `/api/audio-telemetry`
- `/api/video-telemetry`
- `/api/display-telemetry`
- `/api/presentations`
- `/api/audio-sync`
- `/api/quiz-answer`, public `/api/quiz-events`, authenticated
  `/api/quiz-control-events`, and `/api/quiz-control-state` (POST accepts only
  bounded aggregate contributions; clear commands require authentication when
  enabled; Control receives aggregate snapshots and never individual answers
  or exact scores)
- `/api/audience/state` and `/api/audience/events`, used by Audience instead of
  the protected full-state routes; both carry a valid `SYNC_STATE` reduced to
  the active slide without dropping media, quiz, scripture or display state
- `/api/backgrounds` (lists images/videos recursively from `SEFER_DATA_DIR/public/`)
- `/api/audio` (lists audio recursively from `SEFER_DATA_DIR/public/`)
- `/api/audience-cache-assets` (returns the list of static assets to be cached by the PWA)
- `/metadata.json`, `/books/*.tsv` and any other non-conflicting operator path
  (read-only files from `SEFER_DATA_DIR/public/`)
- public GET `/api/branding/logo.svg`, `/api/branding/favicon.svg`, and
  `/api/branding/welcome.md` (instance overrides with neutral product fallbacks;
  responses are same-origin, cacheable, content-versioned by ETag and `nosniff`)
- `/ws` for backend-owned audio timeline messages only
- `/api/livekit/status`, `/api/livekit/token`, `/api/livekit/refresh-token`,
  and `/api/livekit/*` moderation endpoints for optional Live Audio state in
  memory only
- `/ws` operational Live Audio snapshots for authorized Control handoff; these
  are ephemeral, memory-only, and separate from `SYNC_STATE`

Authentication is required unless `SEFER_REQUIRE_AUTH=false` is explicitly set.
Administrative GET/POST APIs use an explicit protected allowlist boundary;
privileged WebSocket roles require the same Basic authentication, and browser
mutations/upgrades must be same-origin or match `SEFER_ALLOWED_ORIGINS`.
`server/dev.mjs` opts out only for local development when the variable is absent.
Telemetry POST endpoints validate the existing message shape before broadcast:
`AUDIO_TELEMETRY` requires `audioState`, `VIDEO_TELEMETRY` requires
`videoState` or `null`, and `DISPLAY_TELEMETRY` requires the display background
fields with their basic types.

Do not assume persistent cloud identity, auth, or multi-room semantics unless
the code/task explicitly introduces them.

## State Boundaries

Presentation state visible to audience:

- Current presentation and slide.
- Background.
- App mode and scripture state.
- Video/audio state needed to mirror projection.
- Quiz subslide/timer state needed for display and answering.
- Quiz run tracking (`completedQuizSlideIds`, the optional result cut in
  `resultQuizSlideIds`, and its recalculated `maxBaseCentipunts`) so Control,
  Presenter, and Audience use the same category ranges.

Controller UI state:

- Editor drafts.
- Search/select state.
- Expanded rows.
- Panel toggles.
- Temporary local previews.

## Quiz Privacy and Identity

Quiz answers and personal scoring are fundamentally anonymous and decoupled from Live Audio identity. The architecture enforces the following privacy rules:

- **Local Detail:** Individual answers and exact scoring remain in Audience
  `localStorage` during the active presentation session inside a TTL envelope.
  Expiration, legacy/malformed data, logout or presentation rotation clears
  those maps. They are not sent to Control.
- **Presentation Scope:** Aggregate maps are partitioned by `presentationId`.
  `QUIZ_ANSWER_AGGREGATE`, `QUIZ_QUESTION_RESULT_AGGREGATE`,
  `QUIZ_FINAL_SCORE_AGGREGATE`, and `QUIZ_CLEAR_ANSWERS` carry that ID, and
  Control ignores snapshots for any other presentation.
- **Unlinkable Submission IDs:** Audience generates a different random
  `submissionId` for each question answer, question-result contribution and
  final-result request. The server hashes these scope-specific values only for
  duplicate/capacity control; there is no quiz-wide ID to link a participant's
  answers or associate them with Live Audio.
- **Aggregate-Only Control:** The server increments per-option, citation-result
  and final-rank counters immediately, then discards the raw contribution.
  Control receives only these counts, never a display name, answer set, exact
  score or nominal ranking. Slide and final-result distributions remain hidden
  until their aggregation scope contains at least three submissions.
- **Partial Quiz Results:** Questions with submitted answers are marked in green
  in Control. From the results slide, Control may emit `QUIZ_RECALCULATE_RESULTS`
  with those marked IDs; the backend validates them against the active
  presentation, recalculates the maximum score, increments `scoreRequestId`, and
  broadcasts the same result cut to Presenter and Audience. Audience recalculates
  locally and submits only the resulting rank for that request ID. Clearing a
  question removes its aggregate counters, result inclusion and green marker.
- **No Participant Profiling:** There is no historical performance tracking by participant. Quiz session data is ephemeral and disappears when the server session is cleared or the server process stops.
- **Special Activities:** Any future activity (like a named contest) that requires deviating from this anonymous aggregated model must not be implemented in the base MVP and requires explicit documentation and user consent flows prior to participation.

Synchronization protocol:

- Typed state and commands in `src/types/sync.ts`.
- Optional Live Audio contracts in `src/types/liveAudio.ts`.
- Audio timeline contracts in `src/types/audio.ts` and `src/types/sync.ts`.
- Message construction in `src/utils/syncProtocol.ts`.
- Validation in `src/utils/validation.ts`.
- Application/broadcast in `src/hooks/useSyncState.ts`.
- Backend reduction of supported projection commands in
  `server/projection-state-reducer.mjs`, invoked by `server/local-server.mjs`.
  WebSocket timeline state is owned separately by `server/timelineManager.mjs`.

## Where To Modify Sync Code

- Add command or payload type: `src/types/sync.ts`.
- Validate payload: `src/utils/validation.ts`.
- Emit from control: `src/App.tsx` / `src/main-control.tsx` prop wiring.
- Reduce presentation-state commands in `server/projection-state-reducer.mjs`
  through `server/local-server.mjs`.
- Apply in presenter only for local side effects that are not canonical state.
- Broadcast/apply/persist: `src/hooks/useSyncState.ts`.
- Manage WebSocket connection: [useWebSocket.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useWebSocket.ts).
- Add optional Live Audio contracts: `src/types/liveAudio.ts`, then expose the
  message family through `src/types/sync.ts` without touching `SyncStatePayload`
  or `RemoteCommandPayload`.
- Add optional LiveKit runtime behavior: use `src/features/liveAudio/` and keep
  LiveKit browser SDK imports inside that module or dynamic imports owned by it.
  The Fase 5.2 crypto-only hook is currently `src/hooks/usePrivateControlSignals.ts`
  because it depends only on Web Crypto and the existing sync transport.
- Synchronize server clock offset and RTT: [useServerClock.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useServerClock.ts).
- Track and dispatch audio timeline actions: [useAudioTimeline.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudioTimeline.ts).
- Apply timeline changes and drift correction to role-local audio elements:
  [useAudioTimelineApplicator.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudioTimelineApplicator.ts).
- Mirror over network and own canonical projection state:
  `server/local-server.mjs`.
- Add backend-owned audio timeline behavior: `server/timelineManager.mjs` and `server/ws-server.mjs`.
- Add optional LiveKit backend behavior: `server/livekit-server.mjs` and
  registration in `server/local-server.mjs`.

## What Not To Do

- Do not scatter independent `localStorage` writes for sync-ready state.
- Do not bypass `useSyncState` for state that should later be remote-controlled.
- Do not mix temporary UI state with presentation state.
- Do not broadcast frequent media progress or countdown ticks through full `SYNC_STATE`.
- Do not let audience controls mutate presenter/control navigation.
- Do not bypass the backend reducer for supported presentation-state commands.
- Do not add consent fields or endpoints to Live Audio contracts; privacy notice
  UI remains local and must not create persisted acceptance records.
- Do not add `/accept-consent`, `/consent`, `/alias`, or readable chat endpoints.
- Do not statically import the LiveKit browser SDK from core, `src/App.tsx`,
  `src/hooks/useSyncState.ts`, existing `src/components/shared/`, or shared
  `src/types/*`.
