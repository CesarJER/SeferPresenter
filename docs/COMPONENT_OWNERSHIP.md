# Component Ownership

This file explains where behavior belongs and how state should be categorized.

## Component Categories

Control-only:

- `src/components/control/MenuPopup.tsx`: operator layout coordinator.
- `src/components/control/PresentationEditor.tsx`: presentation editing surface.
- `src/components/control/SlideRow.tsx`: per-slide editing row.
- `src/components/control/PresentationList.tsx`: presentation list management.
- `src/components/control/BackgroundSelector.tsx`: background override and lock controls.
- `src/components/control/AudioPanel.tsx`: audio track/sync controls.
- `src/components/control/MediaControls.tsx`: video playback controls.
- `src/components/control/SeferControlPanel.tsx` and `SeferControlPanelMini.tsx`: sacred-text controls.

Presenter-only:

- `src/components/presenter/PresenterScreen.tsx`: projected text/image/video/quiz rendering.
- `src/components/presenter/SeferReaderScreen.tsx`: projected Sefer reader.
- `src/components/presenter/SeferFlowView.tsx`: scripture flow display.
- `src/components/presenter/VerseSidebar.tsx`: verse navigation display.

Audience:

- `src/components/audience/AudienceScreen.tsx`: audience route selection between projection, Sefer reader, and quiz answer UI.

Shared:

- `src/components/shared/AutoResizeText.tsx`
- `src/components/shared/AutoResizeInput.tsx`
- `src/components/shared/SlideVisualizer.tsx`
- `src/components/shared/CustomSearchSelect.tsx`
- `src/components/shared/FormatLegend.tsx`

Hooks:

- `src/hooks/useSyncState.ts`: BroadcastChannel/SSE/API synchronization.
- `src/hooks/useScriptureNavigation.ts`: slide/scripture/manual Sefer mode transitions.
- `src/hooks/useSeferReader.ts`: book/chapter/verse reader state and loading.
- `src/hooks/useBackgroundResolver.ts`: active background and lock/override behavior.
- `src/hooks/useAudioPlayback.ts`: hidden presenter audio element and audio sync.
- `src/hooks/useQuizTimer.ts`, `useQuizAnswers.ts`, `useQuizAudio.ts`: quiz runtime behavior.

Library/sync/validation:

- `src/types/*`: contracts.
- `src/utils/validation.ts`: runtime validation.
- `src/utils/normalizePresentation.ts`: persistence/path normalization.
- `src/utils/syncProtocol.ts`: sync message construction.
- `src/utils/quizUtils.ts`: quiz parsing/scoring/subslides.
- `src/utils/scriptureLookup.ts`, `scriptureParser.ts`, `metadataCache.ts`: sacred text data.
- `server/timelineManager.mjs`: backend-owned audio timeline state; keep separate from presenter `currentState`.
- `server/ws-server.mjs`: WebSocket transport for the backend-owned audio timeline.

## State Categories

Presentation state:

- `Presentation`, `Slide`, `QuizData`, and media/scripture slide fields in `src/types/presentation.ts`.
- Persists through `presentations.json` and `/api/presentations`.

Sync-ready state:

- `SyncStatePayload`, `RemoteCommandPayload`, media/display telemetry in `src/types/sync.ts`.
- Managed by `src/hooks/useSyncState.ts`.
- Includes current presentation, slide index, background lock/override, media state, app mode, scripture state, and quiz sync state.
- `AudioTimelineState` is backend-owned in `server/timelineManager.mjs`; do not merge it into `App.tsx` state just to expose `/ws`.

Control UI state:

- Local editor inputs, expanded rows, panel visibility, search/dropdown state.
- Keep local to control components unless presenter/audience must know it.

Content data:

- Generated scripture metadata/books under `public/`.
- Asset lists from backend endpoints.
- Audio sync maps in `audio_sync.json`.

Derived state:

- Active background from `useBackgroundResolver`.
- Active quiz subslides from `generateQuizSubslides`.
- Active scripture projection state from `useScriptureNavigation`.

Transient state:

- DOM media element refs, animation state, temporary loaded video durations, fullscreen state, local warnings.
- Do not sync unless another mode/device genuinely needs it.

## Prop Rules

- Presenter components should receive display-ready data where possible.
- Presenter components may emit media telemetry, but should not own operator navigation.
- Control components may receive editing and navigation callbacks.
- Shared components should not know whether they are used by presenter, control, or audience.
- Audience UI must not expose presenter/control actions.

## Avoiding Prop-Drilling Mistakes

- Do not solve every prop chain by globalizing state.
- Lift state only when multiple owners genuinely need the same source of truth.
- Keep UI-only state local unless synchronization is required.
- If a control action should affect presenter/audience, route it through typed command/sync wiring.
- If a value is derived, prefer deriving it near its owner instead of persisting duplicate state.

## Examples

- Quiz content is persistent in `Slide.quizData`, but timer/subslide/demo selection is runtime state in `QuizSyncState` and hooks.
- Audience quiz answers live in `useQuizAnswers`; they are not presenter demo selections.
- Background lock and override are sync-ready because presenter, control, and audience must agree on projection visuals.
- `PresenterScreen` receives `slide`, `background`, `videoState`, and quiz props; it does not select presentations.
