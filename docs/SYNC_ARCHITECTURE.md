# Sync Architecture

This document describes the current synchronization model and backend-ready
direction. It avoids claims beyond what the current code shows.

## Current Sync Model

The app uses two sync paths:

- Local tabs: `BroadcastChannel('sefer-presenter')` in `src/hooks/useSyncState.ts`.
- LAN/backend-ready mode: WebSocket at `/ws` is preferred for sending `SYNC_STATE` and `REMOTE_COMMAND` when the connection is open, falling back to HTTP POST endpoints (which broadcast updates via Server-Sent Events (SSE) in `server/local-server.mjs`).
- Server audio timeline: WebSocket at `/ws`, attached by `server/ws-server.mjs`.

Presenter is the practical source of truth for projected state. Control usually
emits a `REMOTE_COMMAND`; presenter applies that command and then broadcasts
state or telemetry.

The local backend keeps SSE connections alive with `data: heartbeat\n\n` every
30 seconds on `/api/state-events`, `/api/audience/events`, and
`/api/quiz-events`. Closed or errored SSE responses are removed from the server
client sets, and failed SSE writes are dropped from future broadcasts.

Main message types live in `src/types/sync.ts`:

- `SYNC_STATE`: full state needed to initialize or resynchronize clients.
- `REMOTE_COMMAND`: operator intent sent from control to presenter (commands should send explicit desired state, not simple toggles, to avoid split-brain).
- `AUDIO_TELEMETRY`: lightweight audio playback updates.
- `VIDEO_TELEMETRY`: lightweight video playback updates.
- `DISPLAY_TELEMETRY`: background lock/override updates.
- `AUDIO_SYNC_MAPS_UPDATE`: audio cue map updates.
- `REQUEST_STATE`: non-presenter clients ask presenter for current state.
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
`@livekit/client`.

Live Audio message contracts live in `src/types/liveAudio.ts` and are included
in `BroadcastMessage` as a separate family:

- `LIVE_AUDIO_PARTICIPANT_STATUS`: technical participant state by ephemeral
  `participantId`, role, speaker state, and publish/subscribe capability.
- `LIVE_AUDIO_GRANT_SPEAK`, `LIVE_AUDIO_REVOKE_SPEAK`: Control-authorized
  speaker permission changes by `participantId`.
- `LIVE_AUDIO_MUTE_PARTICIPANT`, `LIVE_AUDIO_MUTE_ALL`,
  `LIVE_AUDIO_KICK_PARTICIPANT`: moderation actions by `participantId`.
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
- `PRIVATE_CONTROL_SIGNAL`: encrypted Audience-to-Control container with only
  technical routing fields and ciphertext.

`PRIVATE_CONTROL_SIGNAL` has the exact public envelope:

- `type`
- `fromParticipantId`
- optional `toControlSessionId`
- `keyId`
- `ephemeralPublicKey`
- `ciphertext`
- `nonce`
- optional `createdAt`

Audience clients encrypt private moderation payloads with ECDH P-256 plus
AES-GCM 256. Each message uses a fresh 12-byte AES-GCM nonce. Control keeps a
per-session nonce replay guard in memory and clears it when the Control key
rotates; historical messages are not recovered after `CONTROL_KEY_ROTATED`.

The server must only route `PRIVATE_CONTROL_SIGNAL`. It must not decrypt,
persist, log, or semantically inspect aliases, private text, keys, or ciphertext
content. Runtime backend checks must still bind `participantId` to an active
WebSocket/session and authorized role; UUID format validation alone is not
authorization.

`server/ws-server.mjs` filters Live Audio messages by Control state:

- Audience WebSocket clients may send only `SERVER_TIME_PING`, their own
  `LIVE_AUDIO_PARTICIPANT_STATUS`, and `PRIVATE_CONTROL_SIGNAL`.
- Audience `PRIVATE_CONTROL_SIGNAL` messages are accepted only when
  `fromParticipantId` is a UUID v4 bound to the active WebSocket connection, the
  ciphertext is base64 and at most 4096 bytes, the nonce decodes to 12 bytes,
  and the participant stays under the server-side 5-per-minute rate limit.
- Audience participant status is reduced to technical fields and routed only to
  presenter and authorized Controls; audience clients do not receive a full
  participant list.
- `PENDING` Controls do not receive `PRIVATE_CONTROL_SIGNAL`.
- `PENDING` Controls cannot send moderation messages such as grant, mute, or
  kick; the server returns an `ERROR`.
- Authorized Controls can publish the current Control public key and can send
  moderation actions by `participantId`; those actions update only memory state
  and are routed to presenter/authorized Controls, not into `SYNC_STATE`.
- `allowDelegatedModerators` is controlled by
  `SEFER_LIVE_AUDIO_ALLOW_DELEGATED_MODERATORS` and defaults to true. When false,
  only the principal Control may authorize pending Controls.
- If the principal disconnects, the oldest authorized Control by authorization
  timestamp is promoted. If no authorized Control exists, the server emits
  `CONTROL_KEY_ROTATED` with reason `NO_AUTHORIZED_CONTROLS`, clears the private
  session boundary, and restarts Control ownership with the oldest pending
  Control if one remains connected.
- Audience disconnect keeps technical participant state in memory for
  `SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS` seconds, then removes the
  `participantId`, speaker permission, mute state, and pending private-signal
  rate window if the connection does not return.

Live Audio messages must use a dedicated handler in future phases. They must not
be folded into presentation `SYNC_STATE`, audio playback `AudioState`, or the
backend-owned `AudioTimelineState`.
`src/hooks/useSyncState.ts` treats Live Audio message types as WebSocket-only
subscriber events and ignores them on BroadcastChannel/SSE paths.

### Build And Runtime Optionality

Live Audio has two separate switches:

- `VITE_SEFER_LIVE_AUDIO_BUILD`: frontend build flag. When false, the base
  frontend should avoid static imports of `src/features/liveAudio/` and must not
  include `@livekit/client` or heavy Live Audio UI in the main bundle.
- `SEFER_LIVE_AUDIO_ENABLED`: backend/runtime flag. When false, the backend
  should report Live Audio disabled and leave `/presenter`, `/control`,
  `/audience`, `/audio-editor`, media sync, quiz, and scripture flows working.

`src/types/liveAudio.ts` and validation helpers can remain in the core because
they are small protocol contracts and do not connect LiveKit. The optional
runtime module owns LiveKit SDK imports, track lifecycle, microphone permission
state, encrypted signal hooks, and Live Audio UI.

Fase 5.4 adds `server/livekit-server.mjs` for self-hosted LiveKit backend
endpoints. It keeps participant, token, speaker, mute, and kick state in memory
only. If `SEFER_LIVE_AUDIO_ENABLED=false` or any required `LIVEKIT_*` variable is
missing, `/api/livekit/status` reports disabled or unavailable and the server
still starts without importing or requiring a LiveKit SDK. Token generation uses
minimum grants by role: audience can subscribe only, while control can publish
audio. Mutating moderation endpoints require an authorized WebSocket Control
session from `server/ws-server.mjs`; audience requests are rejected with 403.

## WebSocket Audio Timeline

Fase 2 adds a backend-owned audio timeline over `ws://localhost:<port>/ws`.
The React client connects to this channel, receives `AUDIO_TIMELINE_STATE` updates, and dispatches actions via `AUDIO_TIMELINE_ACTION`.
This channel synchronizes timeline state while maintaining compatibility with existing SSE event streams.

`server/timelineManager.mjs` owns only the audio timeline fields:

- `timelineId`, `version`, `presentationId`, `audioSrc`, and `syncMapId`.
- Playback state: `status`, `basePositionSec`, `baseServerTimeMs`,
  `playbackRate`, and `volume`.
- Sync metadata: `syncMode`, cue indexes, and `updatedBy`.

`server/ws-server.mjs` handles:

- `WELCOME` on connection, including `clientId`, role, and server time.
- `SERVER_TIME_PING` / `SERVER_TIME_PONG` for clock estimation.
- `AUDIO_TIMELINE_ACTION` from presenter/control clients.
- `AUDIO_TIMELINE_STATE` broadcasts back to presenter/control clients.
- Live Audio Control authorization state, verification-code expiry, delegated
  authorization, participant association, private-signal rate limiting,
  moderation filtering, public-key routing, private-signal routing, and
  principal succession.

`src/hooks/useServerClock.ts` sends `SERVER_TIME_PING` when the WebSocket is
open and estimates client-to-server clock offset plus RTT from
`SERVER_TIME_PONG`. Audio timeline clients should use `serverNow()` from this
hook when they need backend-owned timeline time.

Audience WebSocket clients receive `WELCOME` but do not receive the private
audio timeline. Existing SSE endpoints remain active for state, audience,
quiz, and telemetry flows.

## Local-Only Today

Current local/browser state includes:

- Stored presenter state and background lock in `localStorage`.
- Control editor UI state such as draft text, expanded rows, fullscreen, panel visibility.
- Audience answer/session state managed by `src/hooks/useQuizAnswers.ts`, with event broadcasting for quiz submissions.
- DOM media element refs and loaded media metadata.

Keep these local unless another device/mode must observe them.

## Backend-Ready Direction

Current inference: the backend is intentionally small and mirrors browser state
for LAN/mobile use. The code appears designed so future online/mobile remote
control can replace or extend the local server without changing every component.

Backend-owned or backend-mirrored pieces:

- `/api/state` and `/api/state-events`
- `/api/command`
- `/api/audio-telemetry`
- `/api/video-telemetry`
- `/api/display-telemetry`
- `/api/presentations`
- `/api/audio-sync`
- `/api/quiz-answer` and `/api/quiz-events`
- `/api/audience/state` and `/api/audience/events`
- `/ws` for backend-owned audio timeline messages only
- `/api/livekit/status`, `/api/livekit/token`, `/api/livekit/refresh-token`,
  and `/api/livekit/*` moderation endpoints for optional Live Audio state in
  memory only

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

Controller UI state:

- Editor drafts.
- Search/select state.
- Expanded rows.
- Panel toggles.
- Temporary local previews.

Synchronization protocol:

- Typed state and commands in `src/types/sync.ts`.
- Optional Live Audio contracts in `src/types/liveAudio.ts`.
- Audio timeline contracts in `src/types/audio.ts` and `src/types/sync.ts`.
- Message construction in `src/utils/syncProtocol.ts`.
- Validation in `src/utils/validation.ts`.
- Application/broadcast in `src/hooks/useSyncState.ts`.
  WebSocket timeline state is owned separately by `server/timelineManager.mjs`.

## Where To Modify Sync Code

- Add command or payload type: `src/types/sync.ts`.
- Validate payload: `src/utils/validation.ts`.
- Emit from control: `src/App.tsx` prop wiring.
- Apply in presenter: `App.handleRemoteCommand`.
- Broadcast/apply/persist: `src/hooks/useSyncState.ts`.
- Manage WebSocket connection: [useWebSocket.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useWebSocket.ts).
- Add optional Live Audio contracts: `src/types/liveAudio.ts`, then expose the
  message family through `src/types/sync.ts` without touching `SyncStatePayload`
  or `RemoteCommandPayload`.
- Add optional LiveKit runtime behavior: use `src/features/liveAudio/` and keep
  `@livekit/client` imports inside that module or dynamic imports owned by it.
  The Fase 5.2 crypto-only hook is currently `src/hooks/usePrivateControlSignals.ts`
  because it depends only on Web Crypto and the existing sync transport.
- Synchronize server clock offset and RTT: [useServerClock.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useServerClock.ts).
- Track and dispatch audio timeline actions: [useAudioTimeline.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudioTimeline.ts).
- Apply timeline changes to presenter's audio element: [useAudioTimelineApplicator.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudioTimelineApplicator.ts).
- Mirror over network: `server/local-server.mjs`.
- Add backend-owned audio timeline behavior: `server/timelineManager.mjs` and `server/ws-server.mjs`.
- Add optional LiveKit backend behavior: `server/livekit-server.mjs` and
  registration in `server/local-server.mjs`.

## What Not To Do

- Do not scatter independent `localStorage` writes for sync-ready state.
- Do not bypass `useSyncState` for state that should later be remote-controlled.
- Do not mix temporary UI state with presentation state.
- Do not broadcast frequent media progress or countdown ticks through full `SYNC_STATE`.
- Do not let audience controls mutate presenter/control navigation.
- Do not make server command handling mutate `currentState` unless that endpoint is intended to own state.
- Do not add consent fields or endpoints to Live Audio contracts; privacy notice
  UI remains local and must not create persisted acceptance records.
- Do not add `/accept-consent`, `/consent`, `/alias`, or readable chat endpoints.
- Do not statically import `@livekit/client` from core, `src/App.tsx`,
  `src/hooks/useSyncState.ts`, existing `src/components/shared/`, or shared
  `src/types/*`.
