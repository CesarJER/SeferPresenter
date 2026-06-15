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
- `server/local-server.mjs`: local backend, static serving, SSE, persistence endpoints, auth gate.
- `vite.config.ts`: Vite config, development proxy, and multi-entry build inputs.

## Folder Responsibilities

- `src/components/control/`: operator UI, presentation editor, background/audio/video controls, Sefer controls.
- `src/components/presenter/`: projector UI, slide rendering, Sefer reader display, verse sidebar/flow visuals.
- `src/components/audience/`: audience route wrapper and audience quiz/projection selection.
- `src/components/quiz/`: quiz presenter, controller, audience, results, timer, and editor UI.
- `src/components/shared/`: reusable UI widgets such as auto-resizing text/input and slide previews.
- `src/hooks/`: stateful behavior for sync, background resolution, media playback, keyboard, URL sync, quiz, Sefer reader, scripture navigation.
- `src/utils/`: validation, normalization, sync message construction, quiz parsing/scoring, scripture parsing/lookup, media helpers.
- `src/types/`: shared contracts for presentations, sync, audio, quiz, and transliteration.
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
- `src/utils/syncProtocol.ts`
- `src/utils/validation.ts`
- `src/hooks/useSyncState.ts`
- `src/App.tsx`
- `server/local-server.mjs`

Prefer typed `REMOTE_COMMAND` messages for operator intent and lightweight telemetry for frequent media/display changes.

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
