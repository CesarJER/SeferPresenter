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
- Update validation in `src/utils/validation.ts`.
- Emit commands from control wiring in `src/App.tsx`.
- Handle commands in `App.handleRemoteCommand`.
- Apply/broadcast through `src/hooks/useSyncState.ts`.
- Mirror backend endpoints/SSE in `server/local-server.mjs` only when needed.
- For backend-owned audio timeline behavior, update `server/timelineManager.mjs` and `server/ws-server.mjs` without mixing it into `currentState`.
- Do not broadcast high-frequency timer/media ticks through full `SYNC_STATE`.

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
- `src/components/control/*`, `src/components/presenter/*`, `src/components/audience/*`, `src/components/shared/*`: check `docs/COMPONENT_OWNERSHIP.md` and `docs/SYMBOL_INDEX.md`.
- New hooks or utilities under `src/hooks/` or `src/utils/`: check `docs/SYMBOL_INDEX.md` and `docs/AI_PROJECT_MAP.md`.
- New route, endpoint, mode, or common workflow: check `docs/AI_PROJECT_MAP.md`, `docs/SYNC_ARCHITECTURE.md`, and `README.md`.
