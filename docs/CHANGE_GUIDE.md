# Change Guide

Use these checklists before implementing future tasks.

## Before Changing Code

- Read `AGENTS.md`.
- Identify the smallest owner files from `docs/AI_PROJECT_MAP.md`.
- Check contracts in `src/types/` before changing runtime shape.
- Check `src/utils/validation.ts` before accepting new external/imported/synced fields.
- Decide whether state is persistent, sync-ready, local UI, derived, or transient.
- Decide whether the change will make any AI navigation doc stale. If yes, plan the doc update as part of the same change.
- Avoid broad rewrites and unrelated formatting changes.

## When Adding A New Slide Type

- Update `Slide` in `src/types/presentation.ts`.
- Update validators in `src/utils/validation.ts`.
- Update normalization in `src/utils/normalizePresentation.ts` if line/path defaults change.
- Add/edit control UI in `PresentationEditor.tsx`, `SlideRow.tsx`, or a focused control child.
- Add presenter rendering in `PresenterScreen.tsx` or a focused presenter child.
- Update `SlideVisualizer.tsx` if control preview must show it.
- Add tests when parsing, validation, or pure utilities change.

## When Editing Control/Menu UI

- Prefer focused files under `src/components/control/`.
- Keep `MenuPopup.tsx` as a coordinator.
- Keep mobile/tablet future use in mind, but do not redesign unrelated layout.
- If the action affects projection, emit a typed command or use existing sync callbacks.
- Keep purely local editor/panel state local.

## When Editing Presenter Rendering

- Start with `src/components/presenter/PresenterScreen.tsx` or the relevant presenter child.
- Render from props; avoid importing global state.
- Preserve non-overlapping responsive text behavior.
- Keep video/audio telemetry behavior symmetric with controller actions.
- Check audience route if the same rendering is reused there.

## When Editing Sync Behavior

- Update `src/types/sync.ts` first.
- For optional Live Audio messages, update `src/types/liveAudio.ts` first and
  add only the message-family union to `src/types/sync.ts`.
- Update validation in `src/utils/validation.ts`.
- Emit commands from control wiring in `src/App.tsx`.
- Handle commands in `App.handleRemoteCommand`.
- Apply/broadcast through `src/hooks/useSyncState.ts`.
- Mirror backend endpoints/SSE in `server/local-server.mjs` only when needed.
- For backend-owned audio timeline behavior, update `server/timelineManager.mjs` and `server/ws-server.mjs` without mixing it into `currentState`.
- Do not broadcast high-frequency timer/media ticks through full `SYNC_STATE`.
- Do not mix Live Audio messages into `SyncStatePayload`,
  `RemoteCommandPayload`, `AudioState`, or `AudioTimelineState`.

## When Editing Live Audio

- Keep the module optional. Disabled, misconfigured, unsupported, or absent
  LiveKit must leave `/presenter`, `/control`, and `/audience` usable in
  presentation-only mode.
- Keep contracts in `src/types/liveAudio.ts`; only expose the family through
  `BroadcastMessage` in `src/types/sync.ts`.
- Keep runtime implementation in `src/features/liveAudio/`. Hooks, Live Audio
  UI, crypto helpers, and any LiveKit browser SDK imports belong there.
  Fase 5.2 is a deliberate crypto-only exception: `src/hooks/usePrivateControlSignals.ts`
  and `src/utils/cryptoUtils.ts` may live in core because they use only Web
  Crypto and existing sync transport.
- Do not install or import the LiveKit browser SDK during contract-only phases.
- Do not import the LiveKit browser SDK from core, `src/App.tsx`,
  `src/hooks/useSyncState.ts`, existing `src/components/shared/`, or shared
  `src/types/*`.
- Treat `VITE_SEFER_LIVE_AUDIO_BUILD` as the frontend build/bundle flag and
  `SEFER_LIVE_AUDIO_ENABLED` as the backend/runtime availability flag. A false
  build flag should keep the base frontend free of static LiveKit SDK imports; a
  false runtime flag should keep existing presentation flows working.
- Validate `PRIVATE_CONTROL_SIGNAL` in `src/utils/validation.ts` for UUID v4
  participant IDs, base64 technical fields, ciphertext size, and caller role.
- Use Web Crypto only for private moderation cryptography: ECDH P-256,
  `deriveKey` to AES-GCM 256, 12-byte random nonces, and base64 technical
  fields. Track used nonces in memory and reject replay.
- Keep Control principal/secondary authorization server-owned in
  `server/ws-server.mjs`: first registered Control wins principal, later
  Controls are pending with `NNN-NNN` codes, pending Controls cannot receive
  private signals or send moderation actions, and principal succession promotes
  the oldest authorized Control.
- Keep Control authorization UI compact and separate from `MenuPopup.tsx`;
  `src/hooks/useControlAuthorization.ts` should reflect WebSocket state and emit
  approval/rejection decisions without persisting codes or messages.
- Treat UUID format as a syntax check only. Backend runtime must verify the
  participant is bound to an active WebSocket/session and authorized role.
- Do not add `acceptedNotice`, `consentGiven`, `privacyAcceptedAt`, equivalents,
  consent endpoints, or persisted privacy acknowledgement records.
- Do not log aliases, private text, keys, ciphertext, or full private signal
  payloads.
- Do not use localStorage, sessionStorage, backend endpoints, or server state for
  private keys.
- Do not touch `src/App.tsx`, `AudioState`, or `AudioTimelineState` for
  contract-only phases.
- Update `docs/SYNC_ARCHITECTURE.md`, `docs/AI_PROJECT_MAP.md`,
  `docs/COMPONENT_OWNERSHIP.md`, `docs/SYMBOL_INDEX.md`, and `README.md` when
  Live Audio entry points, ownership, routing, or protocol shape changes.
- Fase 5.1 verification checklist: `npx.cmd tsc --noEmit`, `npm.cmd run test`,
  no LiveKit browser SDK imports outside `src/features/liveAudio/`, no changes to
  `src/App.tsx`, `AudioState`, or `AudioTimelineState`, and docs explain
  `src/features/liveAudio/`, `VITE_SEFER_LIVE_AUDIO_BUILD`, and
  `SEFER_LIVE_AUDIO_ENABLED`.

## When Editing Validation/Import/Export

- Treat imports, API responses, localStorage, and sync messages as untrusted.
- Keep user-facing errors actionable and Spanish when shown in UI.
- Normalize public asset paths with `normalizePublicPath`.
- Avoid saving invalid presentations or audio sync maps.
- Update tests under `__tests__/utils/` when validator behavior changes.

## When Editing Quiz/Question Features

- Keep persistent data in `QuizData` on `Slide`.
- Keep runtime timer/subslide/demo state in `QuizSyncState` and quiz hooks.
- Keep audience answers separate from presenter demo/correction selection.
- Update `src/utils/quizUtils.ts` for parsing, scoring, ranges, and subslides.
- Update `src/components/quiz/*` for view behavior.
- Update `__tests__/quiz/quizUtils.test.ts` for pure quiz behavior.

## After Changing Code

- Run `npm.cmd run build` on Windows, or `npm run build` on other shells, after non-trivial changes.
- Prefer also running `npm.cmd run test`, `npx.cmd tsc --noEmit`, and `npm.cmd run lint` when contracts or shared logic change.
- Manually check `/presenter`, `/control`, and `/audience` when UI/sync behavior changes.
- Mention any untested behavior.
- Update docs if ownership, sync, state categories, route structure, slide types, validation, backend endpoints, or navigation-critical symbols changed.
- Summarize changed files in the final response.

## Documentation Update Triggers

- `src/types/*`: check `docs/SYMBOL_INDEX.md`, `docs/COMPONENT_OWNERSHIP.md`, and `docs/CHANGE_GUIDE.md`.
- `src/hooks/useSyncState.ts`, `src/types/sync.ts`, `src/utils/syncProtocol.ts`, `server/local-server.mjs`: check `docs/SYNC_ARCHITECTURE.md`.
- `src/types/liveAudio.ts`: check `docs/SYNC_ARCHITECTURE.md`,
  `docs/SYMBOL_INDEX.md`, `docs/COMPONENT_OWNERSHIP.md`, `docs/CHANGE_GUIDE.md`,
  and `README.md`.
- `server/ws-server.mjs`: check `docs/SYNC_ARCHITECTURE.md`,
  `docs/SYMBOL_INDEX.md`, and any manual WebSocket verification notes.
- `src/components/control/*`, `src/components/presenter/*`, `src/components/audience/*`, `src/components/shared/*`: check `docs/COMPONENT_OWNERSHIP.md` and `docs/SYMBOL_INDEX.md`.
- New hooks or utilities under `src/hooks/` or `src/utils/`: check `docs/SYMBOL_INDEX.md` and `docs/AI_PROJECT_MAP.md`.
- New route, endpoint, mode, or common workflow: check `docs/AI_PROJECT_MAP.md`, `docs/SYNC_ARCHITECTURE.md`, and `README.md`.
