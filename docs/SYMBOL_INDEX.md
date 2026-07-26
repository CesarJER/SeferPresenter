# Symbol Index

Navigation-critical symbols and files. This is not an exhaustive API index.

## Entry Points

- `presenter.html` - Vite build entry for presenter mode; loads `src/main.tsx`.
- `audience.html` - Vite build entry for audience mode; loads `src/main-audience.tsx`.
- `control.html` - Vite build entry for control mode; loads `src/main-control.tsx`.
- `audio-editor.html` - Vite build entry for audio editor mode; loads `src/main-audio-editor.tsx`.
- `catalog.html` - Vite build entry for public catalogs; loads `src/main-catalog.tsx`.
- `src/main.tsx` - current React root for presenter/default shell.
- `src/main-audio-editor.tsx` - standalone audio editor root; loads and saves `/api/audio-sync` without presenter sync wiring.
- `src/main-audience.tsx` - standalone Audience root with read-only projection,
  quiz, PWA/media and optional Live Audio wiring.
- `src/main-control.tsx` - standalone React root for control mode; orchestrates control state and sync wiring without presenter/media elements.
- `src/main-catalog.tsx` - standalone React root for the public catalog interface.
- `vite.config.ts` - Vite multi-entry input configuration.
- `public/audience-sw.js` - shared PWA service worker for `/audience` and `/control`, versioned as `1.2.0`; arbitrary runtime media is network-only.
- `public/manifest.webmanifest` - Audience PWA manifest scoped to `/audience` and using `public/logo.svg`.
- `public/control-manifest.webmanifest` - Control PWA manifest scoped to `/control` and using `public/logo.svg`.
- `server/audience-projection-state.mjs` - allowlisted derivation of the public
  Audience projection snapshot; exposes only the active slide plus required
  display, media, scripture, and quiz state.

## Hooks

- [useSyncState](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSyncState.ts) - `src/hooks/useSyncState.ts`: role-aware BroadcastChannel/SSE/API sync, reduced public Audience endpoints, local persistence, remote state application, calling `onAudioTimelineState` and exposing `wsStatus`.
- [useWebSocket](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useWebSocket.ts) - `src/hooks/useWebSocket.ts`: standalone WebSocket connection helper with safe JSON send, typed receive callback, status, cleanup, and exponential reconnect.
- [useServerClock](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useServerClock.ts) - `src/hooks/useServerClock.ts`: WebSocket server clock offset and RTT estimation from `SERVER_TIME_PING` / `SERVER_TIME_PONG`.
- [useAudioTimeline](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudioTimeline.ts) - `src/hooks/useAudioTimeline.ts`: local audio timeline tracking, status estimation, action dispatching over WebSocket.
- [useAudioTimelineApplicator](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudioTimelineApplicator.ts) - `src/hooks/useAudioTimelineApplicator.ts`: applies audio timeline changes and continuous drift correction to each role-local HTML audio element.
- [useAudienceAudioPlayback](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudienceAudioPlayback.ts) - `src/hooks/useAudienceAudioPlayback.ts`: synchronizes HTML audio element playback, current time, and volume on the audience device based on presentation audio telemetry.
- [useSeferControlLogic](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSeferControlLogic.ts) - `src/hooks/useSeferControlLogic.ts`: orchestrates the full or mini scripture navigation control UI logic, including verse selection, page navigation, boundary checks, and font adjustments.
- [useResizablePanel](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useResizablePanel.ts) - `src/hooks/useResizablePanel.ts`: controls dragging and resizing behavior for side/layout panels (e.g. Sefer reader layout), adapting size based on viewport orientation.
- [usePrivateControlSignals](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/usePrivateControlSignals.ts) - `src/hooks/usePrivateControlSignals.ts`: Fase 5.2 crypto-only private moderation signaling with in-memory ECDH P-256 keys, AES-GCM private signals, nonce replay rejection, key rotation, and secondary Control key transfer.
- [useControlAuthorization](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useControlAuthorization.ts) - `src/hooks/useControlAuthorization.ts`: Fase 5.3 Control principal/secondary state, pending verification-code countdown, delegated approval/rejection commands, and succession reflection over WebSocket.
- `useBackgroundResolver` - `src/hooks/useBackgroundResolver.ts`: active background, lock, and override behavior.
- `useUrlSync` - `src/hooks/useUrlSync.ts`: presenter URL/hash synchronization.
- `useKeyboardNavigation` - `src/hooks/useKeyboardNavigation.ts`: keyboard navigation for slides and scripture.
- `useSmoothVolume` - `src/hooks/useSmoothVolume.ts`: smooth volume transitions and autoduck factor application via `requestAnimationFrame`.
- `useAudioPlayback` - `src/hooks/useAudioPlayback.ts`: presenter audio element playback and audio sync.
- `useScriptureNavigation` - `src/hooks/useScriptureNavigation.ts`: scripture projection, slide boundary, manual Sefer mode transitions.
- `useSeferReader` - `src/hooks/useSeferReader.ts`: book/chapter/verse reader state and data loading.
- `useQuizTimer` - `src/hooks/useQuizTimer.ts`: quiz timer state and transitions.
- [useAudienceSession](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudienceSession.ts) - `src/hooks/useAudienceSession.ts`: ephemeral audience identity/alias state, logout purge, and presentation-session rotation.
- `useAudienceAccess` - `src/hooks/useAudienceAccess.ts`: Audience credential
  bootstrap, admission state, one-use SSE tickets, session rotation and
  credential cleanup.
- `AudienceAccessGate` -
  `src/components/audience/AudienceAccessGate.tsx`: encrypted-alias waiting
  room UI that keeps protected session content unmounted until admission.
- `saveProtectedAudienceSnapshot` / `loadProtectedAudienceSnapshot` /
  `clearProtectedAudienceSnapshot` -
  `src/utils/protectedAudienceStore.ts`: credential-bound IndexedDB recovery
  for the last admitted projection snapshot and quiz drafts.
- Quiz answer hooks - `src/hooks/useQuizAnswers.ts`: presentation-scoped audience answer sessions and controller aggregation through `useAudienceAnswers` and `useControllerAnswers`.
- `useQuizAudio` - `src/hooks/useQuizAudio.ts`: quiz feedback sounds.
- `scriptureNumerals` helpers - `src/hooks/scriptureNumerals.ts`: scripture numeral utilities.
- [useLiveAudioAvailability](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/features/liveAudio/hooks/useLiveAudioAvailability.ts) - `src/features/liveAudio/hooks/useLiveAudioAvailability.ts`: optional LiveKit runtime availability check using `/api/livekit/status`, with module-level cache and no SDK import.
- [useLiveAudio](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/features/liveAudio/hooks/useLiveAudio.ts) - `src/features/liveAudio/hooks/useLiveAudio.ts`: isolated LiveKit client lifecycle, token request/refresh, reconnect/retry states, audio-only remote subscriptions, explicit remote playback start, manual microphone publish/unpublish, and local track cleanup.
- [LiveAudioProvider](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/features/liveAudio/hooks/LiveAudioProvider.tsx) - `src/features/liveAudio/hooks/LiveAudioProvider.tsx`: optional context wrapper for sharing one Live Audio connection within a feature view.

## Components

- `App` - `src/App.tsx`: route-level coordinator and state/sync wiring.
- `MenuPopup` - `src/components/control/MenuPopup.tsx`: control mode coordinator.
- `PresentationEditor` - `src/components/control/PresentationEditor.tsx`: presentation edit UI.
- `SlideRow` - `src/components/control/SlideRow.tsx`: slide edit row.
- `PresentationList` - `src/components/control/PresentationList.tsx`: presentation list actions.
- `BackgroundSelector` - `src/components/control/BackgroundSelector.tsx`: background controls.
- `AudioPanel` - `src/components/control/AudioPanel.tsx`: audio controls.
- `MediaControls` - `src/components/control/MediaControls.tsx`: video controls.
- `SeferControlPanel` - `src/components/control/SeferControlPanel.tsx`: full Sefer control panel.
- `SeferControlPanelMini` - `src/components/control/SeferControlPanelMini.tsx`: compact scripture controls.
- [ScriptureRangeEditor](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/control/ScriptureRangeEditor.tsx) - `src/components/control/ScriptureRangeEditor.tsx`: control-side range editor used for slide reference selection.
- `PresenterScreen` - `src/components/presenter/PresenterScreen.tsx`: projected slide/video/quiz rendering.
- `SeferReaderScreen` - `src/components/presenter/SeferReaderScreen.tsx`: projected scripture reader.
- `SeferFlowView` - `src/components/presenter/SeferFlowView.tsx`: scripture flow visual.
- `VerseSidebar` - `src/components/presenter/VerseSidebar.tsx`: verse sidebar visual.
- `AudienceScreen` - `src/components/audience/AudienceScreen.tsx`: audience route projection/quiz selection.
- `CatalogApp` - `src/components/catalog/CatalogApp.tsx`: public catalog root component, handles routing.
- `CatalogIndex` - `src/components/catalog/CatalogIndex.tsx`: displays available public catalogs.
- `CatalogViewer` - `src/components/catalog/CatalogViewer.tsx`: displays presentations for a given public catalog with safe excerpts and search highlighting.
- `src/utils/catalogCards.ts` - pure catalog card count, title-slide,
  plain-text excerpt, and accent-insensitive highlight helpers.
- `ActiveParticipantsPanel` - `src/features/liveAudio/components/audience/ActiveParticipantsPanel.tsx`: audience-side alias-sharing checkbox and authorized visible participant list.
- `PwaRestartButton` - `src/components/shared/PwaRestartButton.tsx`: confirmed reload/update action for installed audience/control PWAs.
- Proposed Live Audio components - future optional runtime components under
  `src/features/liveAudio/components/control/`,
  `src/features/liveAudio/components/audience/`, and
  `src/features/liveAudio/components/shared/`. Core legal components for
  `/proteccion-datos` may stay outside the LiveKit module.
- `LiveAudioTrackOutput` - `src/features/liveAudio/components/shared/LiveAudioTrackOutput.tsx`: hidden remote-track audio renderer used by audience, presenter, and control; attaches LiveKit tracks to native audio elements and applies browser-native 0-100 playback volume.
- `QuizPresenterView` - `src/components/quiz/QuizPresenterView.tsx`: projected quiz view.
- `QuizControllerView` - `src/components/quiz/QuizControllerView.tsx`: controller quiz controls/results.
- `QuizAudienceView` - `src/components/quiz/QuizAudienceView.tsx`: audience quiz answer UI.
- `QuizSlideEditor` - `src/components/quiz/QuizSlideEditor.tsx`: quiz editing UI.
- [QuizResultsView](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/quiz/QuizResultsView.tsx) - `src/components/quiz/QuizResultsView.tsx`: quiz results chart/statistics dashboard.
- [QuizSubslideNav](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/quiz/QuizSubslideNav.tsx) - `src/components/quiz/QuizSubslideNav.tsx`: navigation toolbar to select active subslides within quiz projection.
- [QuizTimerDisplay](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/quiz/QuizTimerDisplay.tsx) - `src/components/quiz/QuizTimerDisplay.tsx`: visual timer indicator with ring animations and adjusting tools.
- `LiveAudioControlAuthorization` - `src/components/control/LiveAudioControlAuthorization.tsx`: compact Fase 5.3 Control principal/pending authorization panel.
- `LiveAudioControlContainer.computeVisibleList` / `distributeVisibleList` /
  `lastSentListRef` - `src/features/liveAudio/components/control/LiveAudioControlContainer.tsx`: Control-owned E2E visible participant list computation and differential encrypted distribution.
- `ControlVerificationCode` - `src/components/shared/ControlVerificationCode.tsx`: short verification-code display with countdown.
- `SlideVisualizer` - `src/components/shared/SlideVisualizer.tsx`: control-side preview.
- `AutoResizeText` - `src/components/shared/AutoResizeText.tsx`: projected responsive text.
- [AutoResizeInput](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/shared/AutoResizeInput.tsx) - `src/components/shared/AutoResizeInput.tsx`: auto-resizing text input.
- [CustomSearchSelect](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/shared/CustomSearchSelect.tsx) - `src/components/shared/CustomSearchSelect.tsx`: combobox widget.
- [DataProtectionLink](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/shared/DataProtectionLink.tsx) - `src/components/shared/DataProtectionLink.tsx`: shared data protection link.
- [DataProtectionPage](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/shared/DataProtectionPage.tsx) - `src/components/shared/DataProtectionPage.tsx`: standalone data protection terms page.
- [FormatLegend](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/components/shared/FormatLegend.tsx) - `src/components/shared/FormatLegend.tsx`: slide editor styling guide legend.

## Sync Modules

- `RemoteCommandPayload` / `SyncStatePayload` - `src/types/sync.ts`: sync contracts, including `QUIZ_RECALCULATE_RESULTS` for publishing a partial-quiz result cut.
- `LiveAudioBroadcastMessage` / `PrivateControlSignalMessage` -
  `src/types/liveAudio.ts`: optional Live Audio message family kept separate from
  `SyncStatePayload` and existing remote commands.
- `LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY`,
  `LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION`,
  `LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION`,
  `LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE`,
  `LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT` - `src/types/liveAudio.ts` and
  `server/ws-server.mjs`: technical Live Audio visibility/profile messages and
  remove-vs-block behavior.
- `VISIBLE_ACTIVE_PARTICIPANTS` - private encrypted payload inside
  `PRIVATE_CONTROL_SIGNAL`, not a public WebSocket message.
- `isAliasVisibleToActiveParticipants`, `isAliasHiddenByControl`,
  `canViewActiveParticipants`, `activeListPublicKey` - Live Audio participant
  visibility fields in `src/types/liveAudio.ts`, `server/ws-server.mjs`, and
  Control/audience UI.
- `src/features/liveAudio/` - optional Live Audio runtime module. This is the
  only place where the LiveKit browser SDK, LiveKit track lifecycle, and heavy
  Live Audio UI should live.
- `src/features/liveAudio/index.ts` - optional public entry for Live Audio hooks
  and provider; core routes should import it only through an optional/dynamic
  path when `VITE_SEFER_LIVE_AUDIO_BUILD=true`.
- `src/hooks/usePrivateControlSignals.ts` - Fase 5.2 crypto-only private
  moderation lifecycle using existing WebSocket send/subscribe functions and no
  LiveKit import.
- `src/hooks/useControlAuthorization.ts` - Fase 5.3 Control authorization
  lifecycle using existing WebSocket send/subscribe functions.
- `server/ws-server.mjs` - WebSocket `/ws` server for audio timeline plus Fase
  5.3-5.11 Control principal election, pending code TTL, authorization
  decisions, ephemeral participant association, private-signal rate limiting,
  public-key routing, private-signal routing, moderation filtering, WebSocket
  connection counts, kicked-participant state, targeted audience moderation
  delivery, guaranteed cleanup after audience rejoin grace, participant
  snapshot lookup for token refresh, and succession.
- `makeSyncMessage` - `src/utils/syncProtocol.ts`: message envelope creation.
- `reduceProjectionCommand` / `makeProjectionSyncStateMessage` -
  `server/projection-state-reducer.mjs`: pure backend-consumable reduction of
  supported projection `REMOTE_COMMAND` payloads into canonical `SYNC_STATE`.
- `server/local-server.mjs`: SSE/API mirroring for state, backend reduction of
  projection commands, media telemetry, quiz events, assets, persistence.
- `server/ws-server.mjs`: WebSocket `/ws` server for F2 audio timeline messages.
- `server/livekit-server.mjs`: optional Fase 5.4/5.11 LiveKit self-hosted
  status, token, refresh-token, and moderation endpoints with memory-only state
  and no top-level server SDK dependency. Tokens include ephemeral
  `participantId` metadata and no alias; refresh keeps the same participant
  identity while reflecting current speaker permission and muted speaker state;
  refresh possession is proved by a rotating, hashed credential.
- `server/content-validation.mjs`: bounded deep validation for persisted
  presentation and audio-sync payloads.
- `server/json-persistence.mjs`: fsynced temp/backup persistence with atomic
  rename and an explicit single-file bind-mount fallback.
- `server/path-containment.mjs`: static-file containment using `path.relative`.
- `server/quiz-message-validation.mjs`: bounded public quiz message shapes.
- `server/timelineManager.mjs`: backend-owned audio timeline state and action reducer.
- `server/audio-timeline-sync.mjs`: pure helpers for estimating backend audio
  timeline position and mapping audio cue positions to slide/verse selections.
- [server/authUtils.mjs](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/server/authUtils.mjs) - `server/authUtils.mjs`: server-side authentication helpers based on `SEFER_REQUIRE_AUTH` and `SEFER_CONTROL_PASSWORD`.

## Validation Modules

- `validatePresentationList` / `validatePresentation` - `src/utils/validation.ts`: presentation payload validation.
- `validateAudioSyncMaps` - `src/utils/validation.ts`: audio sync map validation.
- `validateRemoteStatePayload` / `validateSyncMessage` - `src/utils/validation.ts`: remote state and sync message validation.
- `isValidPrivateControlSignal` / `isValidEphemeralParticipantId` -
  `src/utils/validation.ts`: Live Audio technical envelope validation for
  audience-to-control and control-to-audience private signals. Backend runtime
  authorization must still bind IDs to live sessions and roles.
- `isValidControlVerificationCode` - `src/utils/validation.ts`: verifies Fase
  5.3 Control authorization codes in `NNN-NNN` format.
- `src/utils/cryptoUtils.ts`: Web Crypto helpers for ECDH P-256 session and
  ephemeral keys, public/private key import/export, AES-GCM 256 encrypt/decrypt,
  base64 conversion, and nonce replay rejection.
- `computeVisibleActiveParticipants` / `serializeVisibleParticipants` /
  `hasVisibleParticipantsChanged` -
  `src/features/liveAudio/utils/activeParticipants.ts`: pure helpers for
  Control-owned visible alias list filtering, A-Z ordering, and send suppression.
- `createControlAuthorizationAttempt` / `advanceControlAuthorizationAttempt` -
  `src/features/liveAudio/utils/controlAuthorizationFlow.ts`: pure correlated
  ACK/NACK/timeout state machine used to prevent E2E key-transfer failure from
  authorizing a secondary Control.
- `createControlSyncReducerState` / `reduceControlSyncEnvelope` -
  `src/features/liveAudio/utils/controlSyncReducer.ts`: authoritative snapshot
  replacement, monotonic delta application, deduplication, gap buffering, and
  stream/session reset for multi-Control synchronization.
- `validatePrivateControlOverlaySnapshot` / `replacePrivateControlOverlay` /
  `applyPrivateControlOverlayDelta` -
  `src/features/liveAudio/utils/privateControlOverlay.ts`: strict current-state
  E2E overlay validation and monotonic application without message history.
- `normalizeAliasForOrdinal` / `assignStableAliasOrdinal` /
  `formatAliasForControl` -
  `src/features/liveAudio/utils/aliasOrdinals.ts`: Control-only duplicate alias
  grouping and stable, non-reused session ordinals.

## Types

- `Presentation`, `Slide`, `VideoState`, `ScriptureNavState`, `AppMode` - `src/types/presentation.ts`.
- `AudioState`, `AudioSyncMap`, `AudioSyncCue`, `AudioSyncMode`, `AudioTimelineState`, `AudioTimelineAction` - `src/types/audio.ts`.
- `QuizTimerState`, `QuizSubslide`, `QuizAudienceAnswer`, `QuizSyncState` - `src/types/quiz.ts`.
- `BroadcastMessage`, `DisplayTelemetryState`, `AudiencePublicState` - `src/types/sync.ts`.
- `LiveAudioAvailability`, `LiveAudioConnectionState`,
  `LiveAudioTokenResponse`, `ControlPrincipalState`, `ControlSecondaryState`,
  `SpeakerState`, `LiveAudioRemoteTrack`,
  `LiveAudioParticipantStatusMessage`, `LiveAudioConnectionCountsMessage`,
  `LiveAudioGrantSpeakMessage`, `LiveAudioRevokeSpeakMessage`,
  `LiveAudioMuteParticipantMessage`, `LiveAudioMuteAllMessage`,
  `LiveAudioKickParticipantMessage`, `LiveAudioControlPublicKeyMessage`,
  `LiveAudioControlJoinRequestMessage`,
  `LiveAudioControlAuthorizedMessage`, `ControlKeyRotatedMessage`,
  `PrivateControlSignalMessage` - `src/types/liveAudio.ts`.

## Data/Content Modules

- `normalizePresentation` - `src/utils/normalizePresentation.ts`: presentation defaults and public path normalization.
- `loadStoredPresenterState` - `src/utils/normalizePresentation.ts`: validated localStorage state loading.
- `getMetadata` / `loadBookData` - `src/utils/metadataCache.ts`: scripture metadata/book loading and caching.
- `parseVerses` - `src/utils/scriptureParser.ts`: TSV scripture parsing.
- `getScriptureChapterVerses` / `materializeScriptureSlides` - `src/utils/scriptureLookup.ts`: scripture lookup and slide materialization.
- `validateScriptureSpec` / `auditQuickScriptureReferences` / `auditSlideScriptureReferences` - `src/utils/scriptureLookup.ts`: checks quiz and Sefer/Tanaj references against generated metadata before editor conversion or persistence.
- `scripts/generate-verses.js`: generated `public/books/*.tsv` and `public/metadata.json`.
- [navigationUtils](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/utils/navigationUtils.ts) - `src/utils/navigationUtils.ts`: sequential linear step generation for presentations.

## Utilities

- `generateQuizSubslides` - `src/utils/quizUtils.ts`: quiz phase/subslide expansion.
- `parseQuizBlock` / `serializeQuizToText` - `src/utils/quizUtils.ts`: quick-edit quiz text conversion.
- `scoreAnswer` / `calcResultRanges` - `src/utils/quizUtils.ts`: quiz scoring and result ranges.
- `parseMediaSlideString` - `src/utils/mediaUtils.ts`: media slide parsing.
- `transliterateText` - `src/utils/transliterate.ts`: transliteration helper.
- `sanitizeHtml` / `sanitizeSlideHtml` / niqqud helpers - `src/utils/hebrewText.ts`: slide HTML sanitizing and Hebrew text cleanup.
- `mediaVolume` helpers - `src/utils/mediaVolume.ts`: iOS-aware output volume,
  video-only Web Audio gain fallback on iOS, audio-context resume, and
  autoplay-blocked error detection.
- `IosAudioBufferPlayer` - `src/utils/iosAudioBufferPlayer.ts`: iPhone-only
  normal-music player with decoded buffers, gain ramps, MediaStream-backed
  output, transport timing, and native fallback.
- `useIosAudioBufferPlayer` - `src/hooks/useIosAudioBufferPlayer.ts`: selects
  and binds the iPhone player to React audio state and runtime autoduck.
- `registerScopedServiceWorker` / `restartPwaApp` - `src/utils/pwaUpdate.ts`: route-scoped PWA service-worker registration and update-aware reload without clearing local state.
- [audioTimeline](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/utils/audioTimeline.ts) - `src/utils/audioTimeline.ts`: timeline calculations, actions application, client clock offset estimations, and local audio drift-correction decisions.
