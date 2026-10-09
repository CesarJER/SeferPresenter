# Voice Scripture: notas históricas extraídas

Extraído el 2026-10-07 de `docs/VOICE_SCRIPTURE.md`, sobre `57786c1` con correcciones documentales pendientes. Las dos secciones siguientes conservan literalmente texto recibido y fechas originales. Observaciones/resultados/comandos pertenecen a esas revisiones; no acreditan validación actual ni autorizan repetir operaciones.

Comportamiento vigente: [Voice Scripture](../../features/voice-scripture.md).

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


## Persistent assistant and source selection — 2026-09-09

The voice component was a child of `PrivateControlInbox`, whose closed state
returns null. Closing the inbox therefore disposed the STT session. The separate
10-second no-STT watchdog could also treat ordinary silence as a connection failure.
Both lifecycle causes have been removed.

Controllers now appear in their own collapsible group above active speakers.
Presence and microphone state come from LiveKit, including connection, publication,
mute and reconnect events; the application audience snapshot does not contain this
roster. Nicknames use the notification operator-nick preference and the existing
encrypted control channel. Profiles are sent on changes/new peers and refreshed
periodically; they do not enter public projection snapshots. Remote microphone
volume/music settings also use that channel and accept only current controllers.
Controller rows expose audio settings, without grant/revoke/kick/moderation actions.

Click an active microphone before a nickname to select it, another to switch, or
the selected microphone to disable recognition. A yellow ring identifies selection;
selecting the local microphone also marks the bottom microphone button. Selection
starts empty and is never restored from storage. An unavailable engine disables
source activation. Normal microphone publishing/muting remains a separate action.

Voice projection opens the manual reader and switches to `seferManual`, retaining
range endpoints. Recommendations and status remain transient and movable; there
is no voice popover, source dropdown or separate start button.

Validation for this revision includes source selection/switch/deselection, yellow
rings, inbox/drawer closure, private controller settings, moving the recommendations
portal, silence, stalled-final rejection/recovery and cancellation of reconnects.
Physical microphone accuracy and a multi-device LiveKit session remain operator
acceptance checks; synthetic tests do not establish those outcomes.

Delivery checks: 86 focused voice/accessibility cases passed; after the final
source-identity/ordered-close adjustment, all 22 affected interaction/session
cases passed again. The wider run passed 395/397 tests, retaining the two known
unrelated failures in legal-route caching and legacy Audience alias expectations.
Lint and TypeScript passed, and both optional-off and optional-on builds were
checked without running the private corpus generator. The final Docker build also
ran TypeScript and the enabled production build.

The existing app container was updated and reported healthy; authenticated voice
readiness returned HTTP 200 with enabled/available true. In the live Control UI,
a selected local microphone displayed its yellow ring and a reference reached
server-confirmed projection with the drawers closed. The portrait recommendation
block was visually checked below the manual reader. This observation is not a
measured recognition-accuracy or long-duration multi-device test. The prior image
is retained locally as `seferpresenter-app:before-copilot-20260909`.
