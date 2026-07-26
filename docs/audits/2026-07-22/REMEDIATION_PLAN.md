# Prioritized remediation plan

Implementation status: B1–B5 completed; B6 foundations completed with the
residual component/manual matrix listed in `RESULTS.md`; B7 documentation was
completed while the broad `MenuPopup.tsx` extraction remains deferred under the
Ponytail/Laziest rule.

No production correction begins before this register and order exist. Batches
must remain individually reversible and may be parallelized only when their
files, contracts and protocols are disjoint.

## Batch dependency order

1. **B1 — Contain deployment exposure and build secrets**
   - Findings: SP-SEC-009, SP-SRE-001, 003, 005, 007–011, 013.
   - Owners: `.dockerignore`, `Dockerfile`, Compose, `.env.example`, Caddy and
     deployment documentation.
   - Exit: no known default secret; LiveKit optional/internal; healthy probe;
     small secret-free context; parallel Compose projects possible; versions
     pinned.
   - Rollback: keep a documented prior Compose file/image; never restore known
     credentials.

2. **B2 — Centralize authentication and authorization**
   - Findings: SP-SEC-001–003, 005–007, 010.
   - Owners: `authUtils`, local/WS/LiveKit servers, protocol validation/tests.
   - Exit: explicit public endpoint allowlist; privileged tokens and all WS
     side effects require authorized principal; refresh proves possession;
     payload/origin/quiz abuse tests pass.
   - Rollback trigger: Audience/public catalog or Control→Audience without
     Presenter stops working.

3. **B3 — Prevent XSS, invalid state and data loss**
   - Findings: SP-SEC-004, 008; SP-ARCH-001–004; SP-SRE-002.
   - Owners: validators/normalization, catalog builder/viewer, persistence and
     sync equality.
   - Exit: hostile HTML sanitized; malformed external/persisted/sync data is
     rejected without mutation; atomic durable writes and restore test pass.

4. **B4 — Enforce privacy lifecycle and truthful notices**
   - Findings: SP-PRIV-001–008, SP-SRE-004 and privacy impact of SP-SEC-002/003.
   - Owners: audience/quiz session hooks, Control Live Audio state, WS snapshots,
     logging, privacy UI and configuration docs.
   - Exit: one defined session boundary purges all required stores; quiz/alias
     linkage matches the approved policy; notice matches actual recipients,
     persistence and encryption; logs are bounded/redacted.

5. **B5 — Runtime and PWA stability**
   - Findings: SP-PERF-001–005, SP-SRE-006, 012.
   - Exit: no root RAF rerender; flag-off bundle excludes SDK; media cache is
     bounded/network-only; stale iOS loads abort; transports have backpressure;
     services drain and expose readiness.

6. **B6 — Accessibility foundations, then component fixes**
   - Findings: SP-A11Y-001–013.
   - Order: native keyboard controls/dialog/focus → labels and quiz semantics →
     live announcements/state → focus visibility/contrast/language → landmarks,
     titles and reduced motion.
   - Exit: automated semantic/keyboard tests plus manual keyboard, zoom and
     assistive-technology matrix. Candidate SP-A11Y-013 must be reproduced
     before correction.

7. **B7 — Conservative simplification and documentation cleanup**
   - Findings: SP-ARCH-005–006.
   - Ponytail/Laziest order: delete dead MPA compatibility branches only after
     characterization; reuse existing utils; consolidate duplicate quiz view;
     add no state manager or new abstraction without multiple consumers.
   - Exit: behavior-identical tests and net reduction recorded; no safety,
     validation, privacy or accessibility guard removed.

## Checks required after every production batch

```powershell
npm.cmd run test
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
```

Add focused tests first. Run Docker/manual flows whenever a batch touches
deployment, sync, persistence, PWA, media or Live Audio. A baseline failure must
be distinguished from a new regression; it is not silently waived.

## Final system matrix

- Control → backend → Presenter.
- Control → backend → Audience with Presenter closed.
- Late join for Presenter, Audience and Control.
- Multiple Controls: pending, authorization, rejection, succession and reset.
- SSE and WS disconnect/reconnect and slow clients.
- Audio play/pause/seek/cues/autoduck/drift/end/loop.
- Video synchronization and recovery.
- LiveKit connect, proof-bearing refresh, microphone publication and moderation.
- Background/lock/resume on iPhone, iPad, Android and desktop.
- PWA install/update/old-cache recovery without local-state destruction.
- Live Audio build-off, runtime-off, unavailable and misconfigured.
- HTTPS Docker deployment, health/readiness, backup/restore and rollback.
- Long-running session with bounded memory, buffers, logs, timers and tracks.

Final readiness requires zero open S0/S1 findings. Any blocked physical-device,
browser-policy or external-provider check remains an explicit residual risk and
cannot be reported as verified.
