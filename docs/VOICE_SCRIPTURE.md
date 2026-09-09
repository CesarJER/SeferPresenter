# Voice Scripture

Optional, local spoken-reference navigation. Control selects one existing local
or remote Live Audio track and explicitly starts automatic listening. Presenter
and Audience perform no speech recognition. Names and aliases come exclusively
from the installed corpus; public examples below use synthetic collections.

## Behavior and ownership

```text
selected MediaStreamTrack
  -> filtered mono PCM16, 16 kHz, 320 ms frames
  -> protected same-origin /voice-scripture/ws
  -> native local NeMo 0.1.0, finalization by silence
  -> bounded final utterance, ordered corpus-validated references
  -> last unambiguous reference automatically hydrated
  -> existing SCRIPTURE_PROJECT -> backend SYNC_STATE -> displays
```

- `VoiceScriptureControl.tsx` coordinates UI, hydration cancellation, serial
  projection work and acknowledgement against the backend scripture snapshot.
- `voiceScriptureSession.ts` owns capability acquisition, socket, track lifecycle,
  worklet, final-event deduplication (512 recent IDs), health checks and rotation.
- `voicePcmWorklet.ts` mixes channels, applies a normalized 63-tap low-pass FIR,
  resamples to 16 kHz and flushes partial frames before manual-stop commit.
- `voiceScriptureParser.ts` is pure; `voiceScriptureProjection.ts` handles corpus
  hydration and context phrase construction. LiveKit bridging stays outside them.

The newest valid intervention replaces manual alternatives. With multiple valid
references, the last is projected and all are offered as buttons. An invalid or
ambiguous mention prevents automatic selection for that intervention; valid
alternatives can still be selected manually. Non-reference speech leaves the
previous options intact. Stop clears options and cancels pending hydration;
finals received during stopping must never project.

A range such as `Alfa 1:3-5` starts at verse 3, preserves both endpoints and uses
the existing range label and navigation. No new sync fields or remote commands
are introduced. Relative commands use the last confirmed backend state, never
an unconfirmed voice candidate. While a projection awaits acknowledgement,
relative commands abstain. A missing acknowledgement stops automation after
three seconds. Hydration is discarded if canonical context changes meanwhile.

## Parsing boundaries

Explicit book/chapter/verse and ranges may appear inside discourse. Numeric
words, corpus aliases and uniquely resolvable compact digits are supported.
Roman numbers are accepted only in the numeric suffix of an explicit book.
Chapter-only references and bare numbers do not navigate.

Examples with synthetic metadata:

- `Vamos a leer Alfa dos V`: select 2:5 if the installed metadata validates it.
- `Alfa uno tres al cinco`: preserve 1:3-5, display the first verse.
- `Alfa dos cinco, perdón, dos seis`: replace with 2:6.
- `No vayamos a Alfa dos cinco`: abstain.
- `Alfa uno tres y Beta seis cuatro`: project the latter; retain both options.

Simple corrections use `perdón`, `corrijo` or `rectifico`; unsupported or
incomplete corrections abstain. Negation handling is deliberately conservative,
not general natural-language understanding. Contextual forms include next/previous
verse or chapter, `ahora el N`, `versículo N`, `del N al N`, `continúa hasta N`,
`volvamos al N`, and `ahora capítulo N V` with a valid confirmed context.
Finals exceeding 100 tokens or 1600 characters are rejected. No partial hypothesis
can trigger navigation. Aliases shared by multiple books are ambiguous.

## Optionality, API and privacy

Both `VITE_SEFER_LIVE_AUDIO_BUILD` and `VITE_SEFER_VOICE_SCRIPTURE_BUILD` must
be true for the feature build. Runtime additionally needs
`SEFER_LIVE_AUDIO_ENABLED=true`, `SEFER_VOICE_SCRIPTURE_ENABLED=true`, a Control
password, STT URL, readiness URL and local API key. The base feature flags remain
false by default. No model installation/download occurs during an app build.

```text
GET /api/voice-scripture/status -> { enabled, available, debug }
POST /api/voice-scripture/token -> { enabled, available, debug, token, expiresInMs }
```

The existing authenticated backend issues a short-lived capability. The browser
passes it as a WebSocket subprotocol, never a URL parameter. The gateway enforces
origin/authentication, one active session, and injects the upstream key. Vite
also proxies the dedicated voice path during development.

Audio and transcripts stay in memory and never enter the main sync socket,
presentation state or a database. Alternative references are transient Control
state. No cloud fallback, LLM, diarization or recording is introduced. The
gateway's explicit `SEFER_VOICE_SCRIPTURE_DEBUG=true` mode can log upstream text
and private phrase aliases to its console; keep it off during normal operation.
The surrounding runtime can retain console output independently of this feature.
The new client UI exposes stages and failures without logging transcripts.

## Reproducible native runtime

The verified installed engine is **NeMo-Speech.cpp 0.1.0**, with the existing
operator-installed Q8 streaming model. Its transcription endpoint is
`/v1/realtime`. Do not silently upgrade the engine: newer upstream documentation
distinguishes `/v1/audio/transcriptions/realtime` from VoiceChat routes. Verify
the target protocol when upgrading.

Set the local secret in `.env` (the launcher reads it without printing it):

```dotenv
SEFER_VOICE_SCRIPTURE_STT_URL=ws://127.0.0.1:9090/v1/realtime
SEFER_VOICE_SCRIPTURE_READY_URL=http://127.0.0.1:9090/ready
SEFER_VOICE_SCRIPTURE_STT_API_KEY=<local-secret>
```

```powershell
node scripts/start-voice-scripture.mjs
# Docker-to-native-host pilot:
node scripts/start-voice-scripture.mjs --host 0.0.0.0
```

The launcher defaults to the sibling `STT_Engine` installation; `--engine` and
`--model` override those paths. It validates the version, refuses an occupied
port and starts with `--endpointing --stop-history-eou-ms 1000`. It does not kill
another process. The runtime key remains an engine process argument as required
by this installed CLI; never print the complete process command line.

For Docker, retain `docker-compose.voice-scripture.yml` and
`host.docker.internal` URLs. Restart only the selected STT service after verifying
its ownership; do not interrupt unrelated services. The model remains outside
the app image. Keep port 9090 restricted to the intended host/container boundary.

## Failure handling and limits

- Capability/connect attempts are bounded and cancelled on stop/unmount.
- Audio startup has a 15-second watchdog. Hydration consumers can be cancelled
  independently of the shared book cache and time out after three seconds.
- Track removal/replacement stops listening. Four seconds without PCM fails.
- Ten seconds without STT events fails. After the first nonempty partial, four
  seconds without further text or a final, or a 20-second unfinalized utterance,
  stops the session with an endpointing diagnostic. These are fail-closed guards,
  not an alternative transcription segmenter.
- Browser and gateway queues are capped at 256 KiB. Exceeding the cap stops the
  session rather than silently dropping speech or accumulating unbounded audio.
- At 256 MiB cumulative PCM, rotate at the next completed utterance; at 448 MiB
  without a boundary, stop rather than reaching the upstream 512 MiB cap.
- Availability can be checked again without reloading Control. Failures require
  an explicit restart; no automatic retry may unexpectedly resume a microphone.

## Neutral technical record — 2026-09-09

**Observed problem:** an operator-supplied trace contained 213 partial events and
one final after manual stop, accumulating 70.4 seconds. Several references and
ordinary speech reached the single-reference parser together. The old UI also
required manual confirmation and therefore did not implement automatic navigation.

**Live diagnosis:** the installed executable reports 0.1.0. Two verified STT
processes were listening on port 9090 without endpointing. A no-commit WAV pilot
produced zero finals before correction. After replacing those listeners with the
reproducible endpointing startup, three consecutive utterances produced three
finals without commit, delayed 416/492/445 ms after the supplied audio ended.
These are repeated measurements of one existing WAV, not accuracy statistics,
P95 across speakers, or end-to-end browser latency.

**Changes:** separated capture/session from UI, filtered resampling and flush,
bounded queues, cancellation/watchdogs, multiple-reference extraction, automatic
projection and manual alternatives, backend acknowledgement, development proxy,
synthetic regression cases and neutral documentation.

**Validation boundaries:** automated tests cover parsing, exact worklet source,
transport with simulated browser primitives, Control hydration/cancellation and
the real backend reducer/Audience snapshot without a Presenter. The live WAV
pilot verifies native segmentation. A real microphone/browser/display pilot,
accuracy corpus, P50/P95 and a 4–6 hour thermal/memory run remain separate checks;
simulated rotation tests do not establish those results.

The transport test additionally advances six simulated hours, delivering 7200
final events across three sessions. It checks rotation and cancellation logic,
not real six-hour memory or thermal behavior. Both feature-disabled and
feature-enabled builds pass using `npm.cmd --ignore-scripts run build` to avoid
the private-data prebuild generator. TypeScript and repository lint pass.
The full-suite run also exposes two unrelated existing failures in legal cache
headers and Audience alias retention; their implementation/test files are
unchanged, and each failure reproduces when run separately.

```powershell
npx.cmd vitest run __tests__/voiceScriptureParser.test.ts __tests__/voiceScriptureSession.test.ts __tests__/voicePcmWorklet.test.ts __tests__/voiceScriptureControl.test.tsx __tests__/voiceScriptureServer.test.ts
node scripts/verify-voice-segmentation.mjs <operator-supplied.wav>
```

The pilot repeats a supplied WAV three times with silence, never sends commit,
and reports only counts/timing/text lengths. It creates no audio/transcript files.
Target: P95 at most two seconds from end of an intervention to confirmed
projection, to be measured on a representative corpus. It is not guaranteed
from a reference mentioned mid-sentence while the speaker continues talking.

### Final verification record

- 75 focused voice tests pass. The Audience integration test renders the real
  Audience component in jsdom and checks both the initial verse text and full
  range label from the backend snapshot. Transport primitives are simulated;
  this is not a physical-browser microphone test.
- The optional `--with-parser` pilot uses the actual pure parser and reads the
  installed metadata without changing it. All three live STT finals resolved
  to corpus-valid references, at 417/509/439 ms after the supplied audio ended.
  This validates recognition of that sample, not an independent accuracy corpus.
- The Docker app was rebuilt with the existing base/voice Compose files and
  recreated using `--no-deps --no-build`. It is healthy, serves the updated voice
  chunk and returns authenticated STT status `enabled=true, available=true`.
  The preceding image is retained locally as `seferpresenter-app:before-voice-20260909`.
  Reload Control to obtain the new client module; no browser microphone session
  was started as part of the deployment check.

## TODO — proposals for a later turn

- Slide navigation: next, previous, selected position.
- Playback: pause/resume the active medium.
- Display: hide/restore projection.
- Voice control: suspend automation and undo the most recent action.
- Compare local engines on the same clean/noisy/distant-speech and negative corpus
  if recognition accuracy remains insufficient; do not change the navigation API.
- Measure sustained hardware use, memory growth, false projections and P50/P95
  with multiple speakers before declaring performance/accuracy targets achieved.

These proposals are intentionally not enabled or parsed in this release.
