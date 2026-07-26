# Pre-audit stabilization — 2026-07-24

## Scope

This phase stabilized architecture that would otherwise invalidate findings
from the production audit. It does not certify the product.

## Changes

1. Audience projection sync now uses `/api/audience/state` and
   `/api/audience/events`. The public snapshot contains only the active slide
   and required functional state; full Control/Presenter state remains
   protected.
2. Live Audio aliases no longer enter server-readable snapshots or clear
   profile messages. Alias recovery uses E2E `PRIVATE_CONTROL_SIGNAL`; server
   snapshots retain only non-nominal operational state.
3. Public catalog cards show a non-title excerpt, safe accent-insensitive
   highlights, and a configurable count. `count_sefer` changes counting only;
   it does not hide Tanaj/Sefer content or remove it from search.
4. LiveKit keeps explicit `LIVEKIT_NODE_IP` precedence and supports a bounded,
   HTTPS-only public IPv4 discovery fallback controlled by
   `SEFER_LIVEKIT_AUTO_DISCOVER_IP`. The container healthcheck probes the local
   signaling port with an available BusyBox command.
5. `*.local` and `*.local.*` are reserved for private deployment adaptations,
   never canonical project files.

## Verification

- `npm.cmd run test -- --maxWorkers=1`: 37 files, 262 tests passed.
- `npx.cmd tsc --noEmit`: passed.
- `npm.cmd run lint`: passed.
- `npm.cmd run build`: passed with Vite 8.0.13.
- `docker compose config --quiet`: passed (Docker client emitted only a local
  config-file permission warning).
- Recreated the LiveKit service with the new Compose definition: `healthy`.

The default parallel Vitest run completed individual tests but once reported a
worker-process exit. Re-running the entire suite with one worker passed all
tests; this should be tracked as test-runner stability, not treated as a product
test failure.

## Git history

- `97f6d1b` — `fix(audience): restore public projection sync`
- `3adc312` — `security(live-audio): keep aliases end-to-end encrypted`
- `1282526` — `feat(catalog): add configurable counts and search excerpts`
- `c7d3d26` — `ops(livekit): harden dynamic IP fallback and healthcheck`
