# Voice Scripture

Voice Scripture is an optional, Control-owned detector of spoken references
from the operator-installed corpus. It is not a general transcription feature and it never navigates
without an operator pressing **Mostrar**.

## Implemented boundary

```text
one selected LiveKit MediaStreamTrack
  -> browser AudioWorklet (mono PCM16, 16 kHz, 320 ms chunks)
  -> same-origin /voice-scripture/ws with a short-lived Control capability
  -> self-hosted NeMo-Speech.cpp realtime STT
  -> final transcript held only on the JS call stack
  -> deterministic parser + metadata validation
  -> transient Control candidate
  -> Mostrar
  -> existing onProjectScripture navigation
```

The parser and Voice Scripture module know only `MediaStreamTrack`; the small
bridge in `LiveAudioControlContainer` supplies that track. The first version
does not capture a second microphone, mix speakers, diarize, transcribe partial
results, or add Voice state to `SYNC_STATE`.

Go was evaluated for an STT gateway and deliberately not added. The upstream
runtime is already native C++, while this repository already has Node, `ws`,
Basic Auth, origin validation, and the HTTP listener that owns Control access.
A Go proxy would duplicate those boundaries without removing work from the
browser or the inference engine.

## Optionality

- `VITE_SEFER_VOICE_SCRIPTURE_BUILD=false` removes the dynamically imported
  Voice component and parser from the base build. The STT runtime and model are
  never frontend dependencies.
- `SEFER_VOICE_SCRIPTURE_ENABLED=false` keeps the backend status disabled and
  refuses the realtime socket.
- A true runtime flag is still fail-closed unless STT URL, readiness URL, local
  API key, and `SEFER_CONTROL_PASSWORD` are configured.
- V1 obtains its one audio track from optional Live Audio, so Live Audio must
  also be built and enabled. Presenter and Audience do no STT work.

Status is deliberately small:

```text
GET /api/voice-scripture/status -> { enabled, available }
POST /api/voice-scripture/token -> { enabled, available, token, expiresInMs }
```

The browser connects only to same-origin `/voice-scripture/ws`. The backend
requires valid Control Basic Auth to issue a short-lived one-use capability,
passes that capability as a WebSocket subprotocol rather than in the URL,
requires a same-origin upgrade, permits one active session, injects the upstream bearer credential server-side, and
proxies only the dedicated realtime stream. PCM and transcripts never enter
`/ws`, `SYNC_STATE`, `REMOTE_COMMAND`, logs, files, or databases.

## STT runtime

The implemented protocol target is NVIDIA NeMo-Speech.cpp with
`nemotron-3.5-asr-streaming-0.6b.q8_0.gguf`: realtime PCM16, `es-ES`, endpointing,
and a small request-time phrase bias. The runtime code is Apache-2.0; the model
card currently declares OpenMDW 1.1. Review both again before redistribution.

Install/download is explicit and independent from Sefer. The verified Windows
pilot uses the native runtime and local weights under the sibling `STT_Engine`
directory:

```powershell
$sttRoot = Resolve-Path '..\STT_Engine'
& "$sttRoot\bin\nemo-speech.exe" serve `
  --asr-model "$sttRoot\nemotron-3.5-asr-streaming-0.6b.q8_0.gguf" `
  --host 127.0.0.1 --port 9090 --api-key '<local-random-secret>' --no-ui
```

For a non-Docker Sefer backend:

```dotenv
VITE_SEFER_LIVE_AUDIO_BUILD=true
SEFER_LIVE_AUDIO_ENABLED=true
VITE_SEFER_VOICE_SCRIPTURE_BUILD=true
SEFER_VOICE_SCRIPTURE_ENABLED=true
SEFER_VOICE_SCRIPTURE_STT_URL=ws://127.0.0.1:9090/v1/realtime
SEFER_VOICE_SCRIPTURE_READY_URL=http://127.0.0.1:9090/ready
SEFER_VOICE_SCRIPTURE_STT_API_KEY=<same-local-random-secret>
```

For Docker-hosted Sefer with the native Windows STT pilot, use `--host 0.0.0.0`
so the engine is reachable through `host.docker.internal`. Keep the API key enabled, and
restrict port 9090 to the private Docker/host boundary with Windows Firewall.
Then start the overlay:

```powershell
docker compose -f docker-compose.yml -f docker-compose.voice-scripture.yml --profile live-audio up --build
```

Return to core mode with the ordinary base command and false/default flags:

```powershell
docker compose up --build
```

The overlay contains no model and no STT image. This intentionally supports an
independently installed native pilot. The merged Compose configuration, feature
image build, and container-to-host realtime proxy were validated on 2026-09-01.
CUDA therefore belongs to the native Windows runtime in this pilot; GPU
passthrough to a Docker STT container was not exercised.

## Parser coverage

V1 accepts explicit book + chapter + optional verse/range, Spanish number words
through 150, and canonical metadata names/abbreviations. Operator-specific
pronunciation variants live only in `SEFER_DATA_DIR/config/voice_aliases.json`;
the scripture generator validates them and embeds them into the generated
`SEFER_DATA_DIR/public/metadata.json`. Changing only that private file also
invalidates the generation hash. A chapter-only command resolves to verse 1.
Every book, chapter, endpoint, and range is checked against loaded metadata.
When an STT final compacts chapter and verse into one digit token, the parser
accepts it only if the direct reading is invalid and exactly one corpus-valid
split exists; ambiguous splits are rejected.

V2 accepts the bounded forms `versículo N`, `ahora el N`, `del N al N`,
`versículos N al N`, next/previous verse or chapter, `ahora capítulo N`,
`continúa hasta N`, and `volvamos al N`. It uses the current projected
`ScriptureNavState`; it creates no parallel context. Bare numbers are rejected.

## Privacy delta

- New data: one selected participant's remote audio and short final STT text.
- Processing: browser memory, same-host Sefer proxy, and self-hosted STT memory.
- Lifetime: bounded audio/worklet/WebSocket buffers; transcript is discarded
  immediately after parsing. Only a structured candidate remains until shown,
  replaced, disabled, or the component unmounts.
- External transfer: none by design after explicit model installation.
- Persistence: none. No audio, transcript, alias, history, or model is stored by
  Sefer. The existing scripture projection selected by the operator remains
  subject to normal application state behavior.

## Verification and pilot benchmark

Completed on 2026-09-01:

- focused parser/generator/server tests, including ambiguous compact digits;
- server boundary: disabled/misconfigured status, minimal readiness output,
  one-use same-origin Control capability, bearer injection, and binary PCM proxy;
- private alias regeneration: 66 metadata books, 66 alias entries, zero mismatches,
  and an idempotent second run;
- Docker Compose base/overlay validation and feature image build;
- realtime direct and Docker-proxied transcription with
  `scripts/smoke-voice-scripture.mjs`.

The available WAV is 1.944 seconds, mono PCM16 at 22.05 kHz; the smoke script
converts it in memory to mono PCM16 at 16 kHz and sends 320 ms realtime chunks.
Nemotron returned `de Barim 64.`. After the conservative compact-digit rule,
that final resolved to the expected installed-corpus reference. Direct native
realtime completed 125 ms after the final audio chunk; the Docker proxy completed
in 126 ms. These are single-sample smoke results, not P50/P95 or an accuracy corpus.

| Motor | Ref accuracy | Hebrew names | False positives | P95 | VRAM | GPU | Temp | RAM |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Nemotron 3.5 Q8 / NeMo-Speech.cpp 0.1.0 | 1/1 smoke only | not measured | not measured | not measured; 125-126 ms final delay in one sample | 1769 MiB whole-GPU reading after load | 0% idle snapshot | 48 C idle snapshot | 236 MiB working set |
| WhisperLive large-v3-turbo | not measured | not measured | not measured | not measured | not measured | not measured | not measured | not measured |
| WhisperLive distil-large-v3 | not measured | not measured | not measured | not measured | not measured | not measured | not measured | not measured |

The Q8 model file is 741,548,352 bytes (about 707 MiB). The Docker application
image measured 350 MB and contains neither model nor STT runtime. The GPU and
RAM readings above are point-in-time observations after inference, not isolated
model deltas or sustained thermal measurements. Nemotron is therefore the
implemented pilot, not yet a final winner over unmeasured Whisper baselines.

Before calling the engine selection final, run all three against the same clean,
Hebrew-name, range, contextual, negative, distance, and noise WAV corpus on the
RTX 2080 Super Max-Q. Record final reference accuracy (primary), false positives,
end-of-phrase-to-candidate P50/P95, VRAM/RAM, sustained GPU utilization,
temperature, power where available, and a 30-60 minute thermal pilot. Also run
STT missing/model missing/GPU missing, socket cut,
track removal, Control reload, and 4-6 hour memory-growth checks. If WhisperLive
wins materially, adapt only the protected STT boundary; do not change the parser
or navigation path.

Primary upstream references reviewed for this implementation:

- [NeMo-Speech.cpp server and realtime API](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/api.md)
- [NeMo-Speech.cpp runtime](https://github.com/NVIDIA/NeMo-Speech.cpp)
- [Nemotron 3.5 model card](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b)
- [WhisperLive](https://github.com/collabora/WhisperLive)

