# Consolidated findings register

Status at consolidation: `confirmed` unless explicitly marked `candidate`.
Expected behavior is the inverse of the documented actual behavior. Every
remediation must add the stated regression coverage and update architecture
documentation when its trigger in `AGENTS.md` applies.

## Architecture and data integrity

| ID | Sev/conf | Classification | Evidence, actual behavior and impact | Minimum remediation and tests |
| --- | --- | --- | --- | --- |
| SP-ARCH-001 | S2/C3 | confirmed defect | `useSyncState.arePresentationsEqual` omits presentation tags and slide `mediaFit`, `mediaShowBg` and `scriptureVerses`; snapshots differing only in those fields are ignored. | Canonical complete equality/versioning; tests for every persistent/rendered field. |
| SP-ARCH-002 | S2/C3 | confirmed defect | `POST /api/presentations` and `/api/audio-sync` persist superficially normalized but unvalidated payloads; malformed content can replace usable user data. | Validate before cache/write, reject 400 without mutation, preserve last good data; endpoint and legacy compatibility tests. |
| SP-ARCH-003 | S2/C3 | confirmed defect | `validateRemoteStatePayload` accepts incomplete/malformed `quizState`; consumers dereference missing timer fields. | Deep `QuizSyncState` validator or explicit compatibility normalization; negative sync tests. |
| SP-ARCH-004 | S2/C3 | confirmed defect | Presentation validation ignores `scriptureVerses`, permits arbitrary `mediaFit`, and does not validate result profile members; renderers assume all three shapes. | Validate enums, nested verse arrays and complete profiles; malformed import/API/sync tests. |
| SP-ARCH-005 | S3/C3 | maintainability issue | `MenuPopup.tsx` mixes orchestration, parsing, model transforms, fetching and duplicated quiz controller blocks across about 2,000 lines. | Incrementally extract duplicated quiz view and pure transforms into existing owners; round-trip tests. |
| SP-ARCH-006 | S4/C3 | documentation defect | Project maps still describe `main-audience.tsx` as a placeholder and `App.tsx` as route detector although MPA roots now own those routes. | Correct project map, symbol index and ownership text. |

## Application security

| ID | Sev/conf | Classification | Evidence, actual behavior and impact | Minimum remediation and tests |
| --- | --- | --- | --- | --- |
| SP-SEC-001 | S1/C3 | security defect | With auth enabled, the method-based gate leaves GET `/api/state`, `/api/presentations` and `/api/audio-sync` public. Runtime reproduced `/api/state` 200 while protected UI routes returned 401. | Explicit public GET allowlist; path×method auth matrix preserving Audience/public catalog. |
| SP-SEC-002 | S1/C3 | security defect | `/api/livekit/token` is outside auth and trusts client-selected `role`; arbitrary clients can request Control/Presenter publisher grants. | Bind privileged roles to authorized WS/control session; negative role/token tests. |
| SP-SEC-003 | S1/C2 | security defect | LiveKit refresh accepts only an observable participant UUID and reissues the prior role/grants. | Proof-of-possession with rotating opaque refresh credential or validated prior JWT/session; own/foreign/expired/kicked tests. |
| SP-SEC-004 | S1/C3 | security defect | Public builder preserves arbitrary HTML and CatalogViewer inserts it through `dangerouslySetInnerHTML`; persistent same-origin XSS is reproducible. | Sanitize every catalog sink/response and add CSP; malicious tag/attribute/URL tests. |
| SP-SEC-005 | S1/C3 | security defect | WS applies RESET/session side effects before backend authorization; pending Control can rotate state and seek principal succession. Timeline/telemetry gates are also weaker. | Central authorization before any side effect; role matrix tests for reset, timeline and telemetry. |
| SP-SEC-006 | S2/C3 | security defect | Public quiz endpoint accepts clear/unknown messages and unbounded arbitrary IDs/maps, allowing result deletion/forgery and memory growth. | Audience message allowlist, deep schema, active presentation binding, quotas/rate/TTL; abuse tests. |
| SP-SEC-007 | S2/C3 | security defect | WS uses the library default large payload limit and lacks connection quotas/backpressure. | Set contract-sized `maxPayload`, connection/rate limits and 1009 close tests. |
| SP-SEC-008 | S3/C3 | security defect | Windows static path containment uses string `startsWith`, allowing encoded traversal into sibling names sharing `dist`/`public` prefix. | `path.relative` boundary validation; encoded Windows path tests. |
| SP-SEC-009 | S1/C3 | security defect | Compose defaults auth off and exposes LiveKit with known `devkey/secret` even when Live Audio is disabled. | Fail-closed secrets/auth and optional LiveKit profile; configuration tests. |
| SP-SEC-010 | S2/C2 | security defect | HTTP/WS do not validate Origin; authenticated browser contexts may be abused cross-site. | Origin/Host allowlist and CSRF protection for mutations; allowed/rejected origin tests. |
| SP-SEC-011 | S3/C3 | operational risk | Floating container tags and startup IP lookup make deployed code non-reproducible. | Pin tested versions/digests and make IP explicit; upgrade/rollback smoke tests. |

## Privacy

| ID | Sev/conf | Classification | Evidence, actual behavior and impact | Minimum remediation and tests |
| --- | --- | --- | --- | --- |
| SP-PRIV-001 | S1/C3 | privacy defect | Notice says alias is not retained, but `useAudienceSession` persists it indefinitely in localStorage until an observed logout/rotation. | Choose ephemeral or documented persistence policy; reload/offline/logout/rotation tests. |
| SP-PRIV-002 | S1/C3 | privacy defect | Quiz reuses a stable audience device UUID, sends optional Live Audio display name, and exposes individual answers/scores to Control while notice says anonymous/aggregate-only. | Remove alias, use scoped ephemeral quiz ID and minimize Control snapshot, or explicitly change product/privacy contract; non-correlation tests. |
| SP-PRIV-003 | S1/C3 | privacy defect | Logout/session rotation leaves quiz answer/score maps and stable device ID; emitted logout event has no listener. | Central purge/TTL with correct event ordering; local persistence lifecycle tests. |
| SP-PRIV-004 | S1/C3 | privacy defect | RESET_STATE does not clear server encrypted sensitive snapshot or mounted Control message/alias state. | Atomic sensitive-session purge across server and Control; rotation/handoff distinction tests. |
| SP-PRIV-005 | S2/C3 | privacy defect | Notice claims alias E2E encryption, but active profile sends alias in application-clear text to backend and authorized Controls. | Correct notice immediately; encrypt only if that becomes an explicit requirement. |
| SP-PRIV-006 | S2/C3 | privacy defect | Runtime/application logs contain stable participant identities and moderation actions beyond ephemeral map TTL. | Redact/aggregate IDs, debug opt-in and defined retention/access; log capture tests. |
| SP-PRIV-007 | S2/C3 | deployment/privacy defect | New deployments can publish the notice with generic responsible party or example contact; required organization variables are absent from `.env.example`. | Required configuration validation/template and safe Live Audio disablement; build/config tests. |
| SP-PRIV-008 | S3/C3 | compliance risk | Recording status, providers, transfers, retention criteria and rights channel are indeterminate and depend on external organizational facts. | Organizational decision record and deployment-specific notice; not a legal conclusion from code alone. |

## Performance and runtime

| ID | Sev/conf | Classification | Evidence, actual behavior and impact | Minimum remediation and tests |
| --- | --- | --- | --- | --- |
| SP-PERF-001 | S1/C3 | performance issue | `useAudioTimeline` sets React state every animation frame in Presenter and Control roots; Presenter does not consume the estimated position. | Localize/throttle ticker and remove unused root subscription; profiler/fake RAF tests. |
| SP-PERF-002 | S1/C3 | performance/architecture issue | With `VITE_SEFER_LIVE_AUDIO_BUILD=false`, Control/Audience still import/mount Live Audio; measured build retains about 142 kB gzip optional code. | Apply build flag at all MPA roots and verify off-manifest contains no SDK/container chunks. |
| SP-PERF-003 | S2/C3 | performance issue | Service worker caches arbitrary non-range audio/video despite policy, causing persistent media storage and duplicate iPhone buffering. | Network-only media or bounded explicit offline allowlist; fetch-event/quota tests. |
| SP-PERF-004 | S2/C3 | performance issue | iPhone player version-checks only after fetch/decode; obsolete track loads are not aborted. | AbortController and pre-decode stale checks; second-load/destroy race tests. |
| SP-PERF-005 | S2/C2 | performance issue | SSE ignores `res.write` backpressure and WS broadcasts ignore `bufferedAmount`, allowing slow clients to accumulate memory/latency. | Drain handling, latest-wins coalescing and client thresholds; slow-consumer tests. |

## Accessibility (WCAG 2.2)

These are static findings. C1 means physical keyboard, screen reader, zoom and
mobile verification remains required; it does not weaken the direct markup
evidence.

| ID | Sev/conf | Criteria | Evidence and impact | Minimum remediation and tests |
| --- | --- | --- | --- | --- |
| SP-A11Y-001 | S2/C1 | 2.1.1, 2.1.3, 4.1.2 | Custom select trigger/options are click-only `<div>` elements without focus or combobox semantics. | Prefer native select or complete ARIA combobox; keyboard/focus tests. |
| SP-A11Y-002 | S2/C1 | 2.1.1, 2.4.3, 2.4.11, 4.1.2 | Reset/intervention/private-message overlays lack dialog semantics, focus confinement, Escape and restoration. | Native dialog or modal pattern; focus lifecycle tests. |
| SP-A11Y-003 | S2/C1 | 2.1.1, 2.5.1, 4.1.2 | Reset logo, selectable verses, QR, volume trigger and resize separators depend on pointer/click. | Buttons and keyboard-operable separator values; interaction tests. |
| SP-A11Y-004 | S2/C1 | 1.3.1, 3.3.2, 4.1.2 | Quiz options do not expose radio/checkbox selected state; citation selects lack persistent labels. | Native grouped inputs and associated labels; role/name/state tests. |
| SP-A11Y-005 | S2/C1 | 1.3.1, 2.5.3, 3.3.2, 4.1.2 | Many editor/message/volume controls rely on adjacent text, title or placeholder instead of programmatic labels. | Associated labels and meaningful range value text; accessible-name tests. |
| SP-A11Y-006 | S2/C1 | 3.3.1, 4.1.3 | No live regions exist for send, reconnect, loading, quiz result or error state. | Scoped status/alert regions and error associations; announcement tests. |
| SP-A11Y-007 | S2/C1 | 2.4.7, 2.4.11 | Focusable actions remain opacity/max-width hidden until hover. | Reveal on focus-within/focus-visible or remove from focus order; visibility tests. |
| SP-A11Y-008 | S2/C1 | 1.3.1, 4.1.2 | Toggles/disclosures expose none of expanded, pressed, current or selected state. | ARIA state/relationship attributes; before/after tests. |
| SP-A11Y-009 | S3/C1 | 2.2.2, 2.3.3 | Persistent pulse/spin/scale animation has no reduced-motion policy. | Global media query and Framer reduced-motion use; emulation tests. |
| SP-A11Y-010 | S2/C1 | 3.1.2 | Hebrew fragments use RTL but no `lang="he"`. | Language annotation across renderers; DOM tests. |
| SP-A11Y-011 | S2/C1 | 1.4.3 | Small gray-500 text on gray-900 is about 3.67:1; white/40 text is also used at 10–11 px. | Raise tokens/opacities to at least 4.5:1; contrast matrix and visual QA. |
| SP-A11Y-012 | S3/C1 | 1.3.1, 2.4.1, 2.4.2, 2.4.6 | Shells share one title and complex Control/Editor/Quiz surfaces lack landmarks/bypass structure. | Route titles, main/navigation/headings and skip links; semantic tests. |
| SP-A11Y-013 | S3/C2 candidate | 2.4.3, 3.2.1 | Remotely changing quiz/Live Audio phases unmount focused elements without a focus destination. | Dynamic validation followed by stable phase focus strategy. |

## SRE and DevOps

| ID | Sev/conf | Classification | Evidence, actual behavior and impact | Minimum remediation and tests |
| --- | --- | --- | --- | --- |
| SP-SRE-001 | S1/C3 | security/operational defect | `COPY . .` plus incomplete `.dockerignore` sends `.env*`, user data, `legacy/` and agent metadata to builder cache/context. | Deny sensitive paths and preferably use COPY allowlist; inspect context/history and rotate exposed secrets. |
| SP-SRE-002 | S1/C3 | data-loss risk | JSON writer copies one `.bak` then overwrites primary; backup is outside mounted file and is lost when container is recreated. | Mounted data directory plus temp/fsync/rename and durable versioned restore; kill/recreate tests. |
| SP-SRE-003 | S1/C3 | security defect | Known LiveKit fallback secret, direct port 7880 and always-on service duplicate SP-SEC-009 deployment root cause. | Required secrets, internal signaling and optional profile; fail-closed config tests. |
| SP-SRE-004 | S2/C3 | operational/privacy risk | No Docker log rotation; runtime LiveKit logs large SDP/IDs and app logs client/participant identifiers. | Bounded log driver, production levels and redaction; soak/log-size tests. |
| SP-SRE-005 | S2/C3 | operational defect | LiveKit healthcheck calls absent `curl`; runtime remains unhealthy while serving. | Use available/native probe and positive/negative health tests. |
| SP-SRE-006 | S2/C3 | operational risk | App/Redis/Caddy lack health/readiness and `depends_on` does not wait for health. | Healthchecks and conditional dependencies while keeping LiveKit optional; cold/degraded tests. |
| SP-SRE-007 | S2/C3 | configuration defect | Several documented TTL/moderation/IP/build variables are not passed to app/build and example/documentation defaults disagree. | Single env matrix and effective-config tests without secret output. |
| SP-SRE-008 | S2/C3 | operational risk | LiveKit entrypoint ignores configured node IP and performs three unbounded public HTTP discovery attempts. | Explicit IP, optional HTTPS discovery with timeout/retry; offline/NAT tests. |
| SP-SRE-009 | S2/C3 | operational defect | Docker context is 1.68 GB because historical `legacy/` is included. | Ignore legacy and enforce context threshold. |
| SP-SRE-010 | S2/C3 | operational defect | Fixed global container names prevent parallel, blue/green or isolated audit stacks. | Remove `container_name`; prove two Compose projects can coexist. |
| SP-SRE-011 | S2/C3 | operational risk | LiveKit `latest` and other mobile tags lack a tested rollback/version ledger. | Pin versions/digests and retain prior release smoke-tested for rollback. |
| SP-SRE-012 | S2/C3 | operational defect | Production has no SIGTERM/SIGINT drain for HTTP/WS/timers; npm is PID1. | Idempotent graceful shutdown and stop grace period; SIGTERM connection/write tests. |
| SP-SRE-013 | S3/C3 | operational risk | Redis/LiveKit always consume resources and affect health even when Live Audio is disabled. | Base and Live Audio Compose profiles; disabled/misconfigured smoke tests. |

## Positive controls and rejected hypotheses

- Backend projection reduction works without Presenter and has dedicated tests.
- Audience does not emit projection navigation commands.
- Audio timeline remains separate from general projection state.
- `livekit-client` imports are confined to the Live Audio feature module, even
  though two MPA roots currently load that module despite the build flag.
- ECDH P-256/AES-GCM uses random 12-byte nonces; replay and authenticity tests
  pass, private keys remain in memory, and the server routes ciphertext without
  decrypting it.
- Private-signal role routing and per-participant rate limit are tested.
- Public catalog removes media/quiz/private fields; its remaining defect is HTML
  sanitization.
- WebSocket reconnect timers, clock intervals, timeline applicator resources and
  LiveKit tracks have explicit cleanup paths covered by directed tests.
- No SQL/command injection or application SSRF was confirmed.
- Redis non-persistence is consistent with intentionally ephemeral Live Audio
  state; persisted presentation/audio files are a separate concern.
