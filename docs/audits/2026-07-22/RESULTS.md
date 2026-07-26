# Remediation results

Final verification date: 2026-07-22.

## Decision

**CONDITIONAL GO for the base presentation stack.** All directly exploitable S1
security/privacy paths found in discovery are closed. The S1 persistence issue
is reduced to an explicit single-file bind-mount limitation: writes keep a
durable, fsynced recovery copy in the Compose `sefer_backups` volume before the
in-place fallback.

This is **not** a claim of complete WCAG conformance or full Live Audio
production readiness. Those remain conditional on physical-device/assistive-
technology checks, deployment-specific organization/privacy configuration and
triage of the moderate production dependency advisory reported by `npm ci`.

## Finding disposition

| Domain | Fixed and verified | Partial/mitigated | Open | Candidate | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Architecture | 5 | 0 | 1 | 0 | 6 |
| Security | 9 | 2 | 0 | 0 | 11 |
| Privacy | 7 | 0 | 1 | 0 | 8 |
| Performance | 5 | 0 | 0 | 0 | 5 |
| Accessibility | 5 | 4 | 3 | 1 | 13 |
| SRE/DevOps | 11 | 2 | 0 | 0 | 13 |
| **Total** | **42** | **8** | **5** | **1** | **56** |

### Fixed and verified

- Architecture: SP-ARCH-001–004, 006.
- Security: SP-SEC-001–005, 008–011.
- Privacy: SP-PRIV-001–007. SP-PRIV-002 is closed against the corrected
  product contract: quiz identity is ephemeral, optional alias disclosure is
  explicit, and the notice truthfully describes temporary individual processing.
- Performance: SP-PERF-001–005.
- Accessibility: SP-A11Y-001, 002, 004, 009, 010.
- SRE: SP-SRE-001, 003–010, 012, 013.

### Partial or mitigated

- SP-SEC-006: strict message allowlist/schema, active-presentation binding and
  bounded sessions/answers are present; a distributed rate/TTL policy is still
  absent.
- SP-SEC-007: 64 KiB payload cap and slow-consumer cutoff are present; global
  connection/rate quotas are still absent.
- SP-A11Y-006/007/008/012: quiz/private-message announcements, focused inbox
  actions, combobox state and per-route titles are fixed; not every status,
  hover-only action, disclosure, landmark or skip path has been migrated.
- SP-SRE-002: native filesystems use temp+fsync+rename. Docker single-file bind
  mounts may require in-place replacement, preceded by a durable backup in a
  named volume; automated restore is not yet implemented.
- SP-SRE-011: images are digest-pinned, but a maintained rollback ledger and
  prior-image smoke test are still required.

### Open or externally blocked

- SP-ARCH-005: `MenuPopup.tsx` remains oversized. It was not broadly rewritten
  under the Ponytail/Laziest rule because the critical fixes did not require it.
- SP-PRIV-008: provider/transfer/rights/retention decisions belong to the
  deploying organization. The notice now refuses to hide missing responsible-
  party configuration and no longer assumes recordings.
- SP-A11Y-003/005/011: remaining pointer-only controls, programmatic labels and
  contrast tokens require a dedicated component-by-component pass.
- SP-A11Y-013 remains a candidate until dynamic focus loss is reproduced.
- Browser-policy restrictions blocked in-app UI navigation; physical keyboard,
  screen reader, zoom and mobile-device validation were not performed.
- Docker production install reported one moderate dependency advisory. Detailed
  advisory lookup was not authorized because it would submit dependency
  metadata to an external registry; no package change was guessed.

## Final automated evidence

| Check | Result |
| --- | --- |
| Tests | PASS — 36 files, 253 tests, one worker |
| TypeScript | PASS — `npx.cmd tsc --noEmit` |
| ESLint | PASS — zero errors and warnings |
| Production build | PASS — Vite 8.0.13, 2,253 modules |
| Live Audio build-off verifier | PASS — 447 modules off vs 479 on; no SDK/runtime modules off |
| Compose base/profile config | PASS |
| Docker build | PASS — 17.16 MB context; build-off image has no LiveKit chunks |
| Isolated app health | PASS — healthy |
| Runtime auth/CSP | PASS — Audience/status 200, state/Presenter 401, CSP present |
| SIGTERM | PASS — exit code 0 within 15-second grace |
| Diff check | PASS |

The isolated `sefer_audit_final` project and the older `sefer_audit` network and
volumes created by this audit were removed. The user's active deployment was not
stopped, restarted or reconfigured.
