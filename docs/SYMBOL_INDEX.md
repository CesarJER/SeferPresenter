# Symbol Index

Navigation-critical symbols and files. This is not an exhaustive API index.

## Entry Points

- `presenter.html` - Vite build entry for presenter mode; loads `src/main.tsx`.
- `audience.html` - Vite build entry for audience mode; loads `src/main-audience.tsx`.
- `control.html` - Vite build entry for control mode; loads `src/main-control.tsx`.
- `audio-editor.html` - Vite build entry for audio editor mode; loads `src/main-audio-editor.tsx`.
- `src/main.tsx` - current React root for presenter/default shell.
- `src/main-audio-editor.tsx` - standalone audio editor root; loads and saves `/api/audio-sync` without presenter sync wiring.
- `src/main-audience.tsx` - placeholder mode-specific root for audience mode in the MPA split.
- `src/main-control.tsx` - standalone React root for control mode; orchestrates control state and sync wiring without presenter/media elements.
- `vite.config.ts` - Vite multi-entry input configuration.

## Hooks

- [useSyncState](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useSyncState.ts) - `src/hooks/useSyncState.ts`: BroadcastChannel, SSE/API sync, local persistence, remote state application, calling `onAudioTimelineState` and exposing `wsStatus`.
- [useWebSocket](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useWebSocket.ts) - `src/hooks/useWebSocket.ts`: standalone WebSocket connection helper with safe JSON send, typed receive callback, status, cleanup, and exponential reconnect.
- [useServerClock](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useServerClock.ts) - `src/hooks/useServerClock.ts`: WebSocket server clock offset and RTT estimation from `SERVER_TIME_PING` / `SERVER_TIME_PONG`.
- [useAudioTimeline](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudioTimeline.ts) - `src/hooks/useAudioTimeline.ts`: local audio timeline tracking, status estimation, action dispatching over WebSocket.
- [useAudioTimelineApplicator](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useAudioTimelineApplicator.ts) - `src/hooks/useAudioTimelineApplicator.ts`: applies audio timeline changes (source, status, volume, rate) to the presenter's HTML audio element.
- [usePrivateControlSignals](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/usePrivateControlSignals.ts) - `src/hooks/usePrivateControlSignals.ts`: Fase 5.2 crypto-only private moderation signaling with in-memory ECDH P-256 keys, AES-GCM private signals, nonce replay rejection, key rotation, and secondary Control key transfer.
- [useControlAuthorization](file:///c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter/src/hooks/useControlAuthorization.ts) - `src/hooks/useControlAuthorization.ts`: Fase 5.3 Control principal/secondary state, pending verification-code countdown, delegated approval/rejection commands, and succession reflection over WebSocket.
- `useBackgroundResolver` - `src/hooks/useBackgroundResolver.ts`: active background, lock, and override behavior.
- `useUrlSync` - `src/hooks/useUrlSync.ts`: presenter URL/hash synchronization.
- `useKeyboardNavigation` - `src/hooks/useKeyboardNavigation.ts`: keyboard navigation for slides and scripture.
- `useAudioPlayback` - `src/hooks/useAudioPlayback.ts`: presenter audio element playback and audio sync.
- `useScriptureNavigation` - `src/hooks/useScriptureNavigation.ts`: scripture projection, slide boundary, manual Sefer mode transitions.
- `useSeferReader` - `src/hooks/useSeferReader.ts`: book/chapter/verse reader state and data loading.
- `useQuizTimer` - `src/hooks/useQuizTimer.ts`: quiz timer state and transitions.
- Quiz answer hooks - `src/hooks/useQuizAnswers.ts`: audience answer sessions and controller aggregation through `useAudienceAnswers` and `useControllerAnswers`.
- `useQuizAudio` - `src/hooks/useQuizAudio.ts`: quiz feedback sounds.
- `scriptureNumerals` helpers - `src/hooks/scriptureNumerals.ts`: scripture numeral utilities.
- Proposed Live Audio hooks -
  `src/features/liveAudio/hooks/useLiveAudioAvailability.ts`,
  `src/features/liveAudio/hooks/useLiveAudio.ts`,
  `src/features/liveAudio/hooks/usePrivateControlSignals.ts`,
  `src/features/liveAudio/hooks/useControlAuthorization.ts`: future optional
  LiveKit availability, connection lifecycle, encrypted private signal handling,
  and Control authorization. These hooks are not connected in Fase 5.1.

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
- `PresenterScreen` - `src/components/presenter/PresenterScreen.tsx`: projected slide/video/quiz rendering.
- `SeferReaderScreen` - `src/components/presenter/SeferReaderScreen.tsx`: projected scripture reader.
- `SeferFlowView` - `src/components/presenter/SeferFlowView.tsx`: scripture flow visual.
- `VerseSidebar` - `src/components/presenter/VerseSidebar.tsx`: verse sidebar visual.
- `AudienceScreen` - `src/components/audience/AudienceScreen.tsx`: audience route projection/quiz selection.
- Proposed Live Audio components - future optional runtime components under
  `src/features/liveAudio/components/control/`,
  `src/features/liveAudio/components/audience/`, and
  `src/features/liveAudio/components/shared/`. Core legal components for
  `/proteccion-datos` may stay outside the LiveKit module.
- `QuizPresenterView` - `src/components/quiz/QuizPresenterView.tsx`: projected quiz view.
- `QuizControllerView` - `src/components/quiz/QuizControllerView.tsx`: controller quiz controls/results.
- `QuizAudienceView` - `src/components/quiz/QuizAudienceView.tsx`: audience quiz answer UI.
- `QuizSlideEditor` - `src/components/quiz/QuizSlideEditor.tsx`: quiz editing UI.
- `LiveAudioControlAuthorization` - `src/components/control/LiveAudioControlAuthorization.tsx`: compact Fase 5.3 Control principal/pending authorization panel.
- `ControlVerificationCode` - `src/components/shared/ControlVerificationCode.tsx`: short verification-code display with countdown.
- `SlideVisualizer` - `src/components/shared/SlideVisualizer.tsx`: control-side preview.
- `AutoResizeText` - `src/components/shared/AutoResizeText.tsx`: projected responsive text.

## Sync Modules

- `RemoteCommandPayload` / `SyncStatePayload` - `src/types/sync.ts`: sync contracts.
- `LiveAudioBroadcastMessage` / `PrivateControlSignalMessage` -
  `src/types/liveAudio.ts`: optional Live Audio message family kept separate from
  `SyncStatePayload` and existing remote commands.
- `src/features/liveAudio/` - future optional Live Audio runtime module. This is
  the only place where `@livekit/client`, LiveKit track lifecycle, and heavy Live
  Audio UI should live.
- `src/hooks/usePrivateControlSignals.ts` - Fase 5.2 crypto-only private
  moderation lifecycle using existing WebSocket send/subscribe functions and no
  LiveKit import.
- `src/hooks/useControlAuthorization.ts` - Fase 5.3 Control authorization
  lifecycle using existing WebSocket send/subscribe functions.
- `server/ws-server.mjs` - WebSocket `/ws` server for audio timeline plus Fase
  5.3 Control principal election, pending code TTL, authorization decisions,
  private-signal routing, moderation filtering, and succession.
- `makeSyncMessage` - `src/utils/syncProtocol.ts`: message envelope creation.
- `server/local-server.mjs`: SSE/API mirroring for state, commands, media telemetry, quiz events, assets, persistence.
- `server/ws-server.mjs`: WebSocket `/ws` server for F2 audio timeline messages.
- `server/timelineManager.mjs`: backend-owned audio timeline state and action reducer.

## Validation Modules

- `validatePresentationList` / `validatePresentation` - `src/utils/validation.ts`: presentation payload validation.
- `validateAudioSyncMaps` - `src/utils/validation.ts`: audio sync map validation.
- `validateRemoteStatePayload` / `validateSyncMessage` - `src/utils/validation.ts`: remote state and sync message validation.
- `isValidPrivateControlSignal` / `isValidEphemeralParticipantId` -
  `src/utils/validation.ts`: Live Audio technical envelope and ephemeral UUID v4
  validation. Backend runtime authorization must still bind IDs to live sessions
  and roles.
- `isValidControlVerificationCode` - `src/utils/validation.ts`: verifies Fase
  5.3 Control authorization codes in `NNN-NNN` format.
- `src/utils/cryptoUtils.ts`: Web Crypto helpers for ECDH P-256 session and
  ephemeral keys, public/private key import/export, AES-GCM 256 encrypt/decrypt,
  base64 conversion, and nonce replay rejection.

## Types

- `Presentation`, `Slide`, `VideoState`, `ScriptureNavState`, `AppMode` - `src/types/presentation.ts`.
- `AudioState`, `AudioSyncMap`, `AudioSyncCue`, `AudioSyncMode`, `AudioTimelineState`, `AudioTimelineAction` - `src/types/audio.ts`.
- `QuizTimerState`, `QuizSubslide`, `QuizAudienceAnswer`, `QuizSyncState` - `src/types/quiz.ts`.
- `BroadcastMessage`, `DisplayTelemetryState`, `AudiencePublicState` - `src/types/sync.ts`.
- `LiveAudioAvailability`, `ControlPrincipalState`, `ControlSecondaryState`,
  `SpeakerState`, `LiveAudioParticipantStatusMessage`,
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
- `scripts/generate-verses.js`: generated `public/books/*.tsv` and `public/metadata.json`.

## Utilities

- `generateQuizSubslides` - `src/utils/quizUtils.ts`: quiz phase/subslide expansion.
- `parseQuizBlock` / `serializeQuizToText` - `src/utils/quizUtils.ts`: quick-edit quiz text conversion.
- `scoreAnswer` / `calcResultRanges` - `src/utils/quizUtils.ts`: quiz scoring and result ranges.
- `parseMediaSlideString` - `src/utils/mediaUtils.ts`: media slide parsing.
- `transliterateText` - `src/utils/transliterate.ts`: transliteration helper.
- `sanitizeHtml` / `sanitizeSlideHtml` / niqqud helpers - `src/utils/hebrewText.ts`: slide HTML sanitizing and Hebrew text cleanup.
