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
- `src/components/control/ScriptureRangeEditor.tsx`: control-side scripture reference range selector.
- Proposed Live Audio controls: `LiveAudioControlPanel.tsx`,
  `LiveAudioControlAuthorization.tsx`, `LiveAudioQueue.tsx`,
  `LiveAudioSpeakers.tsx`, `LiveAudioParticipantRow.tsx`, and
  `PrivateControlInbox.tsx` should live in
  `src/features/liveAudio/components/control/` when implemented. Fase 5.3 keeps
  the crypto-free `LiveAudioControlAuthorization.tsx` under
  `src/components/control/` so `/control` can display principal, pending, and
  authorization state without importing LiveKit. `MenuPopup.tsx` may coordinate
  future panels/tabs through a lightweight optional slot or dynamic import, but
  should not own moderation logic or encrypted message handling.

Presenter-only:

- `src/components/presenter/PresenterScreen.tsx`: projected text/image/video/quiz rendering.
- `src/components/presenter/SeferReaderScreen.tsx`: projected Sefer reader.
- `src/components/presenter/SeferFlowView.tsx`: scripture flow display.
- `src/components/presenter/VerseSidebar.tsx`: verse navigation display.

Audience:

- `src/components/audience/AudienceScreen.tsx`: audience route selection between projection, Sefer reader, and quiz answer UI.
- Live Audio audience UI lives in `src/features/liveAudio/components/audience/`. It exposes `AudienceLiveAudioContext` (managed by `LiveAudioAudienceContainer`) to share state and controls. `AudienceLiveAudioPanel.tsx` owns the active-audience controls, while `ActiveParticipantsPanel.tsx` owns the local alias-sharing checkbox and the Control-authorized visible alias list. Sub-views like `PresenterScreen`, `SeferReaderScreen`, and `QuizAudienceView` receive the rendered `<AudienceLiveAudioPanel />` as a prop (`liveAudioPanel`) to display it contextually without portals. Audience mode remains read-only for presentation controls.

Shared:

- `src/components/shared/AutoResizeText.tsx`
- `src/components/shared/AutoResizeInput.tsx`
- `src/components/shared/SlideVisualizer.tsx`
- `src/components/shared/CustomSearchSelect.tsx`
- `src/components/shared/FormatLegend.tsx`
- `src/components/shared/DataProtectionLink.tsx`
- `src/components/shared/DataProtectionPage.tsx`
- `src/components/shared/PwaRestartButton.tsx`: shared confirmed PWA reload action for installable audience/control shells; it must not clear localStorage or session state.
- Live Audio shared widgets such as `LiveAudioStatusBadge.tsx` and

Catalog:

- `src/components/catalog/CatalogApp.tsx`: React root for the public catalog interface, parsing route paths and fetching public index data.
- `src/components/catalog/CatalogIndex.tsx`: displays the list of all available public catalogs and their tags.
- `src/components/catalog/CatalogViewer.tsx`: renders public, safe-for-web presentation copies, card excerpts, configurable counts, and safe search highlights.
- `src/utils/catalogCards.ts`: owns reusable pure card/count/excerpt/search
  derivation; catalog components own only rendering and interaction.
  `LiveAudioTrackOutput.tsx` belong under
  `src/features/liveAudio/components/shared/`. Future `LiveAudioNotice.tsx`,
  `CollapsiblePrivacyNotice.tsx`, `LiveAudioAliasInput.tsx`, and
  `ControlVerificationCode.tsx` should also stay there when implemented. Core
  legal affordances such as `DataProtectionLink.tsx` and
  `DataProtectionPage.tsx` can live outside the LiveKit module so
  `/proteccion-datos` remains available even when
  `VITE_SEFER_LIVE_AUDIO_BUILD=false`. Privacy notice checkboxes must remain
  local UI state and must not emit consent records.

Hooks:

- [useSyncState.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSyncState.ts): BroadcastChannel/SSE/API synchronization.
- [useWebSocket.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useWebSocket.ts): standalone WebSocket connection management.
- [useServerClock.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useServerClock.ts): WebSocket server clock offset and RTT estimation.
- [useAudioTimeline.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudioTimeline.ts): local audio timeline tracking, status estimation, action dispatching over WebSocket.
- [useAudioTimelineApplicator.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudioTimelineApplicator.ts): applying timeline changes, volume/autoduck, and drift correction to presenter/control/audience audio elements.
- [useAudienceAudioPlayback.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudienceAudioPlayback.ts): syncs presenter audio state to the audience device.
- [useSeferControlLogic.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSeferControlLogic.ts): stateful logic for the sacred text reader operator interface.
- [useResizablePanel.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useResizablePanel.ts): pointer-drag resizing behavior for sidebar panels.
- [useScriptureNavigation.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useScriptureNavigation.ts): slide/scripture/manual Sefer mode transitions.
- [useSeferReader.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSeferReader.ts): book/chapter/verse reader state and loading.
- [useBackgroundResolver.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useBackgroundResolver.ts): active background and lock/override behavior.
- [useAudioPlayback.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudioPlayback.ts): hidden presenter audio element and audio sync.
- [useQuizTimer.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useQuizTimer.ts), [useQuizAnswers.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useQuizAnswers.ts), [useQuizAudio.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useQuizAudio.ts), [useAudienceSession.ts](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudienceSession.ts): quiz and session runtime behavior.
- Proposed Live Audio hooks live under `src/features/liveAudio/hooks/`, except
  for the Fase 5.2 crypto-only `src/hooks/usePrivateControlSignals.ts` hook:
  `useLiveAudioAvailability.ts` should own optional module availability
  (`enabled`, `disabled`, `misconfigured`, `unsupported`) without importing
  the LiveKit browser SDK; `useLiveAudio.ts` or `LiveAudioProvider.tsx` should own
  LiveKit connection, token refresh, reconnection/retry states, and track
  lifecycle; `usePrivateControlSignals.ts` owns
  in-memory Web Crypto keys, `PRIVATE_CONTROL_SIGNAL`, key rotation, and
  secondary Control private-key transfer; `useControlAuthorization.ts` owns the
  client reflection of server-owned principal, pending, delegated authorization,
  and verification-code countdown state.

Library/sync/validation:

- `src/types/*`: contracts.
- `src/types/liveAudio.ts`: optional Live Audio contracts and privacy-boundary
  message types. Do not add consent fields or mix these contracts into
  presentation `SYNC_STATE`. This file is shared core and must not import
  the LiveKit browser SDK or runtime LiveKit code. Operational snapshot types
  for Control handoff also live here, but they remain WebSocket-only Live Audio
  messages rather than projection state.
- `src/utils/validation.ts`: runtime validation.
- `src/utils/cryptoUtils.ts`: pure Web Crypto helpers for ECDH P-256,
  AES-GCM 256, base64 encoding, and nonce replay protection.
- `src/utils/mediaVolume.ts`: iOS-aware media volume helpers used by
  `useSmoothVolume`, including a video-only Web Audio gain fallback on iOS and
  playback-blocked error detection.
- `src/utils/iosAudioBufferPlayer.ts`: owns iPhone-only decoded normal-audio
  playback, source recreation, gain, MediaStream-backed media-session output,
  timing, and fallback to direct/native output. It does not own canonical audio
  or timeline state.
- `src/hooks/useIosAudioBufferPlayer.ts`: owns the React lifetime and autoduck
  binding for that engine; normal audio hooks select it only on iPhone.
- `src/utils/pwaUpdate.ts`: PWA service-worker registration and update/reload helpers for route-specific shells.
- `src/utils/normalizePresentation.ts`: persistence/path normalization.
- `src/utils/syncProtocol.ts`: sync message construction.
- `src/utils/audioTimeline.ts`: client timeline manipulation, status estimation, and local audio drift-correction helpers.
- `src/utils/navigationUtils.ts`: step generators for slide navigation.
- `src/utils/mediaUtils.ts`: serializers and parsers for media slide parameters.
- `server/projection-state-reducer.mjs`: pure projection-state reducer used by
  the backend to turn supported Control `REMOTE_COMMAND` payloads into
  canonical `SYNC_STATE`.
- `src/utils/quizUtils.ts`: quiz parsing/scoring/subslides.
- `src/utils/scriptureLookup.ts`, `scriptureParser.ts`, `metadataCache.ts`: sacred text data.
- `server/timelineManager.mjs`: backend-owned audio timeline state; keep separate from presenter `currentState`.
- `server/ws-server.mjs`: WebSocket transport for the backend-owned audio timeline.
- `server/authUtils.mjs`: backend basic authentication helpers.

## State Categories

Presentation state:

- `Presentation`, `Slide`, `QuizData`, and media/scripture slide fields in `src/types/presentation.ts`.
- Persists through `presentations.json` and `/api/presentations`.

Sync-ready state:

- `SyncStatePayload`, `RemoteCommandPayload`, media/display telemetry in `src/types/sync.ts`.
- Canonical projection state is owned by `server/local-server.mjs`; clients
  mirror it through `src/hooks/useSyncState.ts`.
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

Live Audio state:

- `LiveAudioAvailability`, role states, participant status, and encrypted private
  signal envelopes belong in `src/types/liveAudio.ts`.
- LiveKit connection state, WebRTC tracks, microphone permission state,
  per-participant microphone boost, temporary aliases, and privacy notice
  checkbox state are session/local state owned by `src/features/liveAudio/`.
  Active participant list visibility is split deliberately: Audience owns its
  ephemeral `isAliasVisibleToActiveParticipants` preference through
  `useAudienceSession`, Audience publishes alias plus active-list public key in
  `LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE`, Control owns visible alias-list
  computation and encrypted list distribution, and `server/ws-server.mjs` owns
  only the technical moderation fields.
  `LiveAudioRemoteTrack` may expose SDK-backed `attach`/`detach` callbacks, but
  the LiveKit SDK import itself must stay inside `src/features/liveAudio/`.
  Fase 5.2 generated E2E keys are owned by
  `src/hooks/usePrivateControlSignals.ts` in memory only. Do not persist them in
  presentation files, localStorage, or sessionStorage.
- Live Audio must not modify `AudioState`, `AudioTimelineState`, or presenter
  audio playback contracts.
- Control authorization state is server-owned in `server/ws-server.mjs` and
  reflected by `src/hooks/useControlAuthorization.ts`; do not persist Control
  codes, authorization decisions, aliases, keys, or private messages.
- Control handoff snapshot state is server-owned in `server/ws-server.mjs`.
  Control UI under `src/features/liveAudio/components/control/` may hydrate
  participant lists, queue state, permissions, microphone state, and anonymous
  quiz aggregates from `LIVE_AUDIO_SNAPSHOT`, but should not persist that data
  locally beyond the active session. Sensitive snapshot overlays are encrypted
  in server memory with a key derived from `SEFER_CONTROL_PASSWORD`.
- The LiveKit browser SDK may only be imported inside `src/features/liveAudio/` or via
  dynamic import from that module. Core files such as `src/App.tsx`,
  `src/hooks/useSyncState.ts`, existing `src/components/shared/`, and shared
  types must stay SDK-free.

## Prop Rules

- Presenter components should receive display-ready data where possible.
- Presenter components may emit media telemetry, but should not own operator
  navigation or reduce Control commands into canonical projection state.
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

- Quiz content is persistent in `Slide.quizData`, but timer/subslide/demo selection and the completed/result question cut are runtime state in `QuizSyncState` and hooks.
- Audience quiz answers live in `useQuizAnswers`, partitioned by presentation ID; they are not presenter demo selections.
- Background lock and override are sync-ready because presenter, control, and audience must agree on projection visuals.
- `PresenterScreen` receives `slide`, `background`, `videoState`, and quiz props; it does not select presentations.
