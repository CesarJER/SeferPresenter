# Sync Architecture

This document describes the current synchronization model and backend-ready
direction. It avoids claims beyond what the current code shows.

## Current Sync Model

The app uses two sync paths:

- Local tabs: `BroadcastChannel('sefer-presenter')` in `src/hooks/useSyncState.ts`.
- LAN/backend-ready mode: HTTP POST endpoints and SSE in `server/local-server.mjs`.
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

`src/utils/syncProtocol.ts` builds protocol messages. `src/utils/validation.ts`
validates incoming remote state and sync messages before they are applied.

## WebSocket Audio Timeline

Fase 2 adds a backend-owned audio timeline over `ws://localhost:<port>/ws`.
This channel does not replace SSE and does not own `currentState` in
`server/local-server.mjs`.

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
- Mirror over network: `server/local-server.mjs`.
- Add backend-owned audio timeline behavior: `server/timelineManager.mjs` and `server/ws-server.mjs`.

## What Not To Do

- Do not scatter independent `localStorage` writes for sync-ready state.
- Do not bypass `useSyncState` for state that should later be remote-controlled.
- Do not mix temporary UI state with presentation state.
- Do not broadcast frequent media progress or countdown ticks through full `SYNC_STATE`.
- Do not let audience controls mutate presenter/control navigation.
- Do not make server command handling mutate `currentState` unless that endpoint is intended to own state.
