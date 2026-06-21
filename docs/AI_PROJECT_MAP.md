# AI Project Map

Fast map for agents. Use real paths only; this repo does not currently have
`src/lib/*` sync or validation modules. The current equivalents are in
`src/utils/*`, `src/hooks/*`, and `src/types/*`.

## Main Entry Points

- `presenter.html`: presenter HTML entry used by Vite multi-entry builds; loads `src/main.tsx`.
- `audience.html`: audience HTML entry used by Vite multi-entry builds; loads `src/main-audience.tsx`.
- `control.html`: control HTML entry used by Vite multi-entry builds; loads `src/main-control.tsx`.
- `audio-editor.html`: audio editor HTML entry used by Vite multi-entry builds; loads `src/main-audio-editor.tsx`.
- `index.html`: development/default shell that still loads `src/main.tsx`.
- `src/main.tsx`: current presenter React root and global CSS import.
- `src/main-audio-editor.tsx`: standalone audio editor React root; loads presentations, audio files, and audio sync maps from local APIs.
- `src/main-audience.tsx`: placeholder mode-specific React entry for the MPA split.
- `src/main-control.tsx`: standalone control React root; loads the control panel tree without presenter dependencies.
- `src/App.tsx`: route detection, top-level state, synchronization wiring, command dispatch, mode rendering.
- `README.md`: human overview, routes, scripts, backend endpoints, verification.
- `server/local-server.mjs`: local backend, static serving, SSE, persistence endpoints, auth gate, and WebSocket attachment.
- `server/ws-server.mjs`: WebSocket `/ws` server for backend-owned audio timeline messages.
- `server/livekit-server.mjs`: optional self-hosted LiveKit token and moderation endpoints with memory-only state.
- `server/timelineManager.mjs`: isolated audio timeline state and action reducer.
- `server/projection-state-reducer.mjs`: pure backend-consumable reducer for supported projection `REMOTE_COMMAND` payloads into canonical `SYNC_STATE` state.
- `src/types/liveAudio.ts`: optional Live Audio protocol contracts and role state types; no LiveKit connection code.
- `vite.config.ts`: Vite config, development proxy, and multi-entry build inputs.

## Folder Responsibilities

- `src/components/control/`: operator UI, presentation editor, background/audio/video controls, Sefer controls.
- `src/components/presenter/`: projector UI, slide rendering, Sefer reader display, verse sidebar/flow visuals.
- `src/components/audience/`: audience route wrapper and audience quiz/projection selection.
- `src/components/quiz/`: quiz presenter, controller, audience, results, timer, and editor UI.
- `src/components/shared/`: reusable UI widgets such as auto-resizing text/input and slide previews.
- `src/hooks/`: stateful behavior for sync, background resolution, media playback, keyboard, URL sync, quiz, Sefer reader, scripture navigation, and the Fase 5.2 crypto-only `usePrivateControlSignals.ts` hook. LiveKit runtime hooks should still live under `src/features/liveAudio/hooks/` when implemented.
- `src/utils/`: validation, normalization, sync message construction, quiz parsing/scoring, scripture parsing/lookup, media helpers, and Web Crypto helpers.
- `server/projection-state-reducer.mjs`: projection-state command reducer shared by backend runtime and Vitest.
- `src/types/`: shared contracts for presentations, sync, audio, quiz, and transliteration.
- `src/types/liveAudio.ts`: LiveKit-ready but optional Live Audio message contracts, kept separate from presentation sync state.
- `src/features/liveAudio/`: optional Live Audio runtime module. This is where LiveKit hooks, UI, crypto helpers, and any LiveKit browser SDK imports belong.
- `src/hooks/usePrivateControlSignals.ts`: Fase 5.2 crypto-only private moderation signaling hook. It owns in-memory Web Crypto keys and consumes the existing WebSocket send/subscribe functions without importing LiveKit.
- `src/hooks/useControlAuthorization.ts`: Fase 5.3 Control principal/secondary authorization state derived from WebSocket messages.
- `src/utils/cryptoUtils.ts`: pure Web Crypto helpers for ECDH P-256, AES-GCM 256, base64 encoding, and nonce replay rejection.
- `server/`: local Node backend and dev launcher.
- `scripts/`: generated data and utility scripts.
- `__tests__/`: Vitest tests for utils and selected hooks.
- `public/`: static assets, PWA files, generated book TSVs and metadata.

## Common Change Paths

### Add Or Modify A Slide Type

Start with:

- `src/types/presentation.ts`
- `src/utils/validation.ts`
- `src/utils/normalizePresentation.ts`
- `src/components/control/PresentationEditor.tsx`
- `src/components/control/SlideRow.tsx`
- `src/components/presenter/PresenterScreen.tsx`
- `src/components/shared/SlideVisualizer.tsx`

Then check import/export or sync if the new slide type must persist or project remotely.

### Modify Control/Menu UI

Start with:

- `src/components/control/MenuPopup.tsx`
- The focused child under `src/components/control/`
- `src/App.tsx` only for prop wiring and command emission

Keep `MenuPopup` as a coordinator. Add focused subcomponents instead of expanding it further.

### Modify Presenter/Projector Rendering

Start with:

- `src/components/presenter/PresenterScreen.tsx`
- `src/components/presenter/SeferReaderScreen.tsx`
- `src/components/quiz/QuizPresenterView.tsx`
- `src/components/shared/AutoResizeText.tsx`

Presenter components should render from props and report media telemetry. They should not own app navigation.

### Modify Sync/Backend-Ready Behavior

Start with:

- `src/types/sync.ts`
- `src/types/liveAudio.ts` when adding optional Live Audio messages
- `src/utils/syncProtocol.ts`
- `src/utils/validation.ts`
- `src/hooks/useSyncState.ts`
- `server/projection-state-reducer.mjs`
- `src/App.tsx`
- `server/local-server.mjs`
- `server/ws-server.mjs` and `server/timelineManager.mjs` when changing backend-owned audio timeline behavior

Prefer typed `REMOTE_COMMAND` messages for operator intent. Supported projection
commands are reduced by the backend, while lightweight telemetry remains for
frequent media/display changes.

### Add Or Modify Live Audio

Start with:

- `src/types/liveAudio.ts`
- `src/types/sync.ts`
- `src/utils/validation.ts`
- `src/utils/cryptoUtils.ts` for private moderation cryptography
- `src/hooks/usePrivateControlSignals.ts` for Fase 5.2 encrypted signal lifecycle
- `src/hooks/useControlAuthorization.ts`,
  `src/components/control/LiveAudioControlAuthorization.tsx`, and
  `src/components/shared/ControlVerificationCode.tsx` for Fase 5.3 Control
  authorization UI/lifecycle
- `server/ws-server.mjs` for principal election, pending Control TTL,
  authorization, moderation filtering, private-signal routing, rejoin-grace
  cleanup, participant snapshot lookup, and succession
- `server/livekit-server.mjs` and `server/local-server.mjs` for Fase 5.4
  self-hosted token, status, refresh, participant identity preservation, and
  moderation endpoints
- `docs/SYNC_ARCHITECTURE.md`
- `docs/COMPONENT_OWNERSHIP.md`

Runtime implementation entry points are focused hooks such as
`src/features/liveAudio/hooks/useLiveAudioAvailability.ts`,
`src/features/liveAudio/hooks/useLiveAudio.ts`,
`src/hooks/usePrivateControlSignals.ts`, and
`src/hooks/useControlAuthorization.ts`. `useLiveAudio.ts` owns token refresh,
reconnection/retry states, audio-only subscription, microphone publication, and
track cleanup.
Control UI should live under `src/features/liveAudio/components/control/`,
audience voice UI under `src/features/liveAudio/components/audience/`, and
Live Audio reusable privacy/status widgets under
`src/features/liveAudio/components/shared/`. Core/shared legal elements such as
`DataProtectionPage` and `DataProtectionLink` can stay outside the LiveKit module
so `/proteccion-datos` works without LiveKit. Keep Live Audio optional: disabled
or misconfigured LiveKit must leave `/presenter`, `/control`, and `/audience`
usable in presentation-only mode.

Build/runtime split:

- `VITE_SEFER_LIVE_AUDIO_BUILD` is a frontend build flag. When false, the base
  bundle must not statically include the optional Live Audio implementation or
  the LiveKit browser SDK.
- `SEFER_LIVE_AUDIO_ENABLED` is a backend/runtime flag. When false, the server
  reports Live Audio disabled and existing presentation flows continue normally.

### Modify Sacred Text Navigation

Start with:

- `src/hooks/useSeferReader.ts`
- `src/hooks/useScriptureNavigation.ts`
- `src/utils/scriptureLookup.ts`
- `src/utils/scriptureParser.ts`
- `src/utils/metadataCache.ts`
- `src/utils/hebrewText.ts`
- `src/components/control/SeferControlPanel.tsx`
- `src/components/presenter/SeferReaderScreen.tsx`

Do not edit generated `public/books/*.tsv` or `public/metadata.json` by hand.

### Modify Quiz/Question Mode

Start with:

- `src/types/presentation.ts`
- `src/types/quiz.ts`
- `src/utils/quizUtils.ts`
- `src/hooks/useQuizTimer.ts`
- `src/hooks/useQuizAnswers.ts`
- `src/hooks/useQuizAudio.ts`
- `src/components/quiz/*`
- Quiz wiring in `src/App.tsx` and `src/components/control/MenuPopup.tsx`

Keep persistent quiz content in `Slide.quizData`; keep runtime session/timer state in hooks and sync state.

### Modify Import/Export Or Validation

Start with:

- `src/utils/validation.ts`
- `src/utils/normalizePresentation.ts`
- `src/components/control/ImportExportPanel.tsx`
- `src/components/control/PresentationEditor.tsx`
- `server/local-server.mjs`

Treat API payloads, imports, localStorage, and sync messages as untrusted.
