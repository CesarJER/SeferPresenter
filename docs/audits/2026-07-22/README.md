# SeferPresenter stabilization audit — 2026-07-22

Audit target: commit `a2c8ce052154621b0b2b14d7bc31b1be322e31cf` on
`main`. Discovery was read-only; no production source was changed before the
findings were consolidated.

## Baseline

| Check | Result | Evidence |
| --- | --- | --- |
| Working tree | PASS | Clean before and after discovery/build |
| `npm.cmd run test` | FLAKY | First run: 25/26 files, 173/190 tests, worker exited unexpectedly. Immediate verbose rerun: 26/26 files and 190/190 tests passed. |
| `npx.cmd tsc --noEmit` | PASS | Exit 0 |
| `npm.cmd run lint` | FAIL | 5 errors (`no-explicit-any`) and 7 React hook dependency warnings |
| `npm.cmd run build` | PASS | Vite 8.0.13; 2,253 modules; largest chunk `LiveAudioTrackOutput` 480.79 kB / 124.88 kB gzip |
| Compose validation | PASS | Services: app, Redis, LiveKit and Caddy |
| Docker runtime | DEGRADED | App, Redis and Caddy up; LiveKit running but `unhealthy` because its healthcheck calls an absent `curl` binary |
| Isolated Compose project | FAIL | Fixed `container_name` values conflict with the already-running stack |
| Browser UI verification | BLOCKED | The in-app browser could not navigate to the active deployment under its URL policy; no workaround was used |

The build regenerated the sacred-text artifacts deterministically and left the
worktree clean. The Docker build transferred a 1.68 GB context, of which about
1.54 GB was `legacy/`.

## Readiness decision after discovery

**NO-GO.** No S0 issue was found, but confirmed S1 defects permit unauthorized
state/data access, LiveKit role escalation or token reuse, persistent XSS, data
loss during persistence, insecure default deployment and retention contrary to
the published privacy notice.

## Consolidated counts

| Domain | S1 | S2 | S3 | S4/candidate | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Architecture | 0 | 4 | 1 | 1 | 6 |
| Security | 6 | 3 | 2 | 0 | 11 |
| Privacy | 4 | 3 | 1 | 0 | 8 |
| Performance | 2 | 3 | 0 | 0 | 5 |
| Accessibility | 0 | 11 | 2 | 0 | 13 |
| SRE/DevOps | 3 | 9 | 1 | 0 | 13 |

There are 56 domain records. Related impacts are linked rather than summed as
independent root causes in remediation. For example, insecure LiveKit defaults
(`SP-SEC-009`/`SP-SRE-003`) and identifier logging
(`SP-PRIV-006`/`SP-SRE-004`) each share one correction stream.

## Evidence standard

- `C3`: direct reproduction, runtime output, failing invariant or unequivocal
  code path.
- `C2`: complete static causal chain whose impact still needs target-environment
  measurement.
- `C1`: static accessibility evidence requiring assistive-technology or visual
  confirmation before a global conformance claim.

See [FINDINGS.md](FINDINGS.md) for the register and
[REMEDIATION_PLAN.md](REMEDIATION_PLAN.md) for dependencies, batches, exit
criteria and rollback. Final dispositions and verification evidence are in
[RESULTS.md](RESULTS.md).
