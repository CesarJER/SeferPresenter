# Symbol Index

Navigation-critical symbols and files. This is not an exhaustive API index.

## Hooks

- `useSyncState` - `src/hooks/useSyncState.ts`: BroadcastChannel, SSE/API sync, local persistence, remote state application.
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

## Components

- `App` - `src/App.tsx`: route-level coordinator and state/sync wiring.
- `MenuPopup` - `src/components/control/MenuPopup.tsx`: control mode coordinator.
- `PresentationEditor` - `src/components/control/PresentationEditor.tsx`: presentation edit UI.
- `SlideRow` - `src/components/control/SlideRow.tsx`: slide edit row.
- `PresentationList` - `src/components/control/PresentationList.tsx`: presentation list actions.
- `BackgroundSelector` - `src/components/control/BackgroundSelector.tsx`: background controls.
- `AudioPanel` - `src/components/control/AudioPanel.tsx`: audio controls.
- `VideoControls` - `src/components/control/VideoControls.tsx`: video controls.
- `SeferControlPanel` - `src/components/control/SeferControlPanel.tsx`: full Sefer control panel.
- `SeferControlPanelMini` - `src/components/control/SeferControlPanelMini.tsx`: compact scripture controls.
- `PresenterScreen` - `src/components/presenter/PresenterScreen.tsx`: projected slide/video/quiz rendering.
- `SeferReaderScreen` - `src/components/presenter/SeferReaderScreen.tsx`: projected scripture reader.
- `SeferFlowView` - `src/components/presenter/SeferFlowView.tsx`: scripture flow visual.
- `VerseSidebar` - `src/components/presenter/VerseSidebar.tsx`: verse sidebar visual.
- `AudienceScreen` - `src/components/audience/AudienceScreen.tsx`: audience route projection/quiz selection.
- `QuizPresenterView` - `src/components/quiz/QuizPresenterView.tsx`: projected quiz view.
- `QuizControllerView` - `src/components/quiz/QuizControllerView.tsx`: controller quiz controls/results.
- `QuizAudienceView` - `src/components/quiz/QuizAudienceView.tsx`: audience quiz answer UI.
- `QuizSlideEditor` - `src/components/quiz/QuizSlideEditor.tsx`: quiz editing UI.
- `SlideVisualizer` - `src/components/shared/SlideVisualizer.tsx`: control-side preview.
- `AutoResizeText` - `src/components/shared/AutoResizeText.tsx`: projected responsive text.

## Sync Modules

- `RemoteCommandPayload` / `SyncStatePayload` - `src/types/sync.ts`: sync contracts.
- `makeSyncMessage` - `src/utils/syncProtocol.ts`: message envelope creation.
- `server/local-server.mjs`: SSE/API mirroring for state, commands, media telemetry, quiz events, assets, persistence.

## Validation Modules

- `validatePresentationList` / `validatePresentation` - `src/utils/validation.ts`: presentation payload validation.
- `validateAudioSyncMaps` - `src/utils/validation.ts`: audio sync map validation.
- `validateRemoteStatePayload` / `validateSyncMessage` - `src/utils/validation.ts`: remote state and sync message validation.

## Types

- `Presentation`, `Slide`, `VideoState`, `ScriptureNavState`, `AppMode` - `src/types/presentation.ts`.
- `AudioState`, `AudioSyncMap`, `AudioSyncCue`, `AudioSyncMode` - `src/types/audio.ts`.
- `QuizTimerState`, `QuizSubslide`, `QuizAudienceAnswer`, `QuizSyncState` - `src/types/quiz.ts`.
- `BroadcastMessage`, `DisplayTelemetryState` - `src/types/sync.ts`.

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
- `parseVideoSlideString` - `src/utils/videoUtils.ts`: video slide parsing.
- `transliterateText` - `src/utils/transliterate.ts`: transliteration helper.
- `sanitizeHtml` / `sanitizeSlideHtml` / niqqud helpers - `src/utils/hebrewText.ts`: slide HTML sanitizing and Hebrew text cleanup.
