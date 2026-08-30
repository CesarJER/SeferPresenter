# Voice Scripture

Voice Scripture is an optional, Control-owned detector of spoken Bible
references. It is not a general transcription feature and it never navigates
without an operator pressing **Mostrar**.

## Implemented boundary

```text
one selected LiveKit MediaStreamTrack
  -> browser AudioWorklet (mono PCM16, 16 kHz, 320 ms chunks)
  -> authenticated /voice-scripture/ws
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
```

The browser connects only to same-origin `/voice-scripture/ws`. The backend
requires valid Control Basic Auth and a same-origin WebSocket upgrade, permits
one active session, injects the upstream bearer credential server-side, and
proxies only the dedicated realtime stream. PCM and transcripts never enter
`/ws`, `SYNC_STATE`, `REMOTE_COMMAND`, logs, files, or databases.

## STT runtime

The implemented protocol target is NVIDIA NeMo-Speech.cpp with
`nemotron-3.5-asr-streaming-0.6b.q8_0.gguf`: realtime PCM16, `es-ES`, endpointing,
and a small request-time phrase bias. The runtime code is Apache-2.0; the model
card currently declares OpenMDW 1.1. Review both again before redistribution.

Install/download is explicit and independent from Sefer. Check the exact model
alias exposed by the installed CLI, download it once, then start from local
weights:

```powershell
nemo-speech model list
nemo-speech pull nemotron-3.5
$env:NEMO_SPEECH_HTTP_API_KEY = '<local-random-secret>'
nemo-speech serve --asr-model nemotron-3.5 --host 127.0.0.1 --port 9090 --no-ui --asr.endpointing.enable=true --asr.endpointing.stop_history_eou_ms=800
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

For Docker-hosted Sefer with the native Windows STT pilot, bind the STT to a
host address reachable as `host.docker.internal`, keep the API key enabled, and
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
independently installed native pilot while the Docker/CUDA path remains
unverified. Do not treat the overlay as Docker-validated until the deferred
checks below pass.

## Parser coverage

V1 accepts explicit book + chapter + optional verse/range, Spanish number words
through 150, canonical metadata names/abbreviations, numbered Corinthians, and
the selected observed aliases `Bereshit`, `Shemot`, `Vayikra`, `Bamidbar`,
`Devarim`/`de barim`, `Yeshayahu`, and `Tehilim`. A chapter-only command resolves
to verse 1. Every book, chapter, endpoint, and range is checked against loaded
metadata.

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

## Verification and deferred benchmark

Completed without Docker:

- parser: 27 focused V1/V2/invalid/negative cases;
- server boundary: disabled/misconfigured status, minimal readiness output,
  same-origin Basic Auth, bearer injection, and binary PCM proxy;
- TypeScript;
- base build with no `VoiceScriptureControl-*` artifact;
- feature build with a separate `VoiceScriptureControl-*` chunk.

The requested real comparison could not be executed in this implementation
session because Docker testing was explicitly excluded and no controlled spoken
WAV corpus was available. Results must therefore remain `not measured`; no
accuracy, latency, VRAM, GPU, temperature, power, or cost number is inferred.

| Motor | Ref accuracy | Hebrew names | False positives | P95 | VRAM | GPU | Temp | RAM |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Nemotron 3.5 Q8 / NeMo-Speech.cpp | not measured | not measured | not measured | not measured | not measured | not measured | not measured | not measured |
| WhisperLive large-v3-turbo | not measured | not measured | not measured | not measured | not measured | not measured | not measured | not measured |
| WhisperLive distil-large-v3 | not measured | not measured | not measured | not measured | not measured | not measured | not measured | not measured |

Before calling the engine selection final, run all three against the same clean,
Hebrew-name, range, contextual, negative, distance, and noise WAV corpus on the
RTX 2080 Super Max-Q. Record final reference accuracy (primary), false positives,
end-of-phrase-to-candidate P50/P95, VRAM/RAM, sustained GPU utilization,
temperature, power where available, and a 30-60 minute thermal pilot. Also run
Docker Compose config/build, STT missing/model missing/GPU missing, socket cut,
track removal, Control reload, and 4-6 hour memory-growth checks. If WhisperLive
wins materially, adapt only the protected STT boundary; do not change the parser
or navigation path.

Primary upstream references reviewed for this implementation:

- [NeMo-Speech.cpp server and realtime API](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/api.md)
- [NeMo-Speech.cpp runtime](https://github.com/NVIDIA/NeMo-Speech.cpp)
- [Nemotron 3.5 model card](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b)
- [WhisperLive](https://github.com/collabora/WhisperLive)

