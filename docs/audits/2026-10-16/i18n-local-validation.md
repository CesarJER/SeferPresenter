# Local i18n implementation and verification

Date: 2026-10-16. Branch: `feature/i18n`. Base:
`7a4edb43178962ed20d23ebb204259bddca405f7` (local Node 24 work, including the
preceding Tailwind 4 migration). This is a local review candidate, not a published
GitHub PR or a deployed release.

Implementation commit: `10e47733055d55ee28816918b0620399dc0ebeb9`.
Author and committer date: `2026-10-16T11:37:43+02:00`, set 12 hours before
creation as requested. See the [implementation file list](i18n-changed-files.txt).

## Delivered scope

- i18next 26.4.7 and react-i18next 17.0.20, with lazy locale/namespace imports.
- Five application entry points, shared UI, accessibility strings, dialogs,
  feature UI and selected client-side validation messages.
- Role-specific local preferences; validated server default via optional JSON
  and an allowlisted public endpoint; Spanish technical fallback.
- Hebrew interface direction, logical UI spacing/position and directional icons;
  content-derived/explicit direction preserved for projected text.
- Catalog checks, AST literal detection with a documented baseline, incremental
  translation planning, a provider adapter interface and a manual workflow.
- English contributor documentation and a design-only private override proposal.

The existing optimizer modification was present before this work and is excluded
from its commits. Dockerfile, Compose, running services, operator data and corpus
were not changed. No push, GitHub mutation, deployment or translation API call
was performed. Only upstream documentation and npm dependency downloads were
authorized external operations.

## Coverage and editorial status

| Locale | Catalog entries | English reference coverage | Editorial status |
| --- | ---: | --- | --- |
| English | 783 | 783/783 | Machine draft; review against original Spanish required |
| Spanish | 789 | 783/783 | Original interface source plus locale-specific plural forms |
| French | 789 | 783/783 | Machine draft; human review required |
| Hebrew | 789 | 783/783 | Machine draft; human and bidi/mobile review required |

Entry counts include locale-specific plural variants. Equal key coverage does
not certify translation quality. In particular, review consent language,
moderation terminology, sentence fragments retained from the original UI and
French/Hebrew idiom. Operator legal documents, biblical content, speech recognition
language and persisted/shared presentation labels are not translated.

## Checks actually executed

- Full Vitest suite: **76 files, 608 tests passed** (590 pre-existing + 18 new).
- Subsequent focused run after final configuration/provider checks: **18 passed**.
- Application and Node TypeScript checks passed.
- ESLint on the new `src/i18n` runtime passed. Repository-wide lint was not run.
- `npm run i18n:check`: **0 errors, 0 warnings; 30 explicit baseline entries**.
- `npm run i18n:plan`: **0 pending, 0 source characters** for unchanged catalogs.
  No provider was invoked. Draft-review status and changed-source cache behavior
  are tested with synthetic fixtures.
- Vite production build passed, invoked directly to bypass corpus-generating
  prebuild hooks. Build outputs and synthetic data paths are under ignored `tmp`.
- `git diff --check` passed after whitespace cleanup.

Tests cover configuration filtering/fallback, role-specific preference priority,
isolated instances, all four catalog loaders, lazy namespaces, Spanish fallback,
interpolation/plural categories, RTL and independent biblical text direction,
React text escaping, disabled storage, offline configuration, failed locale
switches, AST detection, validation, budgets, batching, protected translations,
cache invalidation and service-worker reuse of a previously fetched locale chunk.

A synthetic read-only HTTP preview on loopback showed the catalog switch from
Spanish to Hebrew with translated accessible labels. The browser screenshot and
viewport-inspection facilities failed for that tab; no screenshot/mobile-layout
acceptance is claimed. The preview did not connect to the active backend or
private data. Test server and temporary tab are stopped/closed after verification.

## Measured bundle impact

Built the base and candidate with the same local tooling and settings. The table
counts the transitive **static** JS imports plus linked CSS for each HTML entry,
deduplicated per entry. Gzip is the sum of Node gzip-compressed file sizes, not a
network timing result. Shared files count once within a page; they can be reused
by browser caching across pages. Deferred locale chunks are excluded here and
reported separately in [machine-readable evidence](i18n-bundle-evidence.json).

| Entry | Base gzip bytes | Candidate gzip bytes | Added gzip bytes |
| --- | ---: | ---: | ---: |
| Presenter | 235240 | 255078 | 19838 |
| Control | 225249 | 248584 | 23335 |
| Audience | 259353 | 280945 | 21592 |
| Catalog | 95726 | 115360 | 19634 |
| Audio editor | 121703 | 142357 | 20654 |

Examples of deferred catalogs: Spanish `common` 2638 gzip bytes; Hebrew `common`
2861 and Hebrew `control` 5066. A selected non-Spanish locale also uses Spanish
fallback resources. The exact namespaces requested depend on mounted components;
these figures do not assert a measured first-interaction network total. The
application does not preload every language.

## Remaining acceptance work

- Review and approve English, French and Hebrew wording; retain Spanish authority
  during the initial migration. Machine drafts must not be marked reviewed just
  because tests pass.
- Verify actual mobile layouts, RTL dialog focus, tables, directional navigation,
  long French strings and mixed-script data on supported browsers/devices.
- Exercise the installed Control/Audience PWA offline on real browsers. Unit
  tests establish caching policy behavior, not full physical-device acceptance.
- Review low-level runtime/server diagnostics and computed messages as their
  consuming flows are exercised. AST warnings cannot prove exhaustive coverage.
- Configure a translation provider only when deliberately selected and budgeted.
  The shipped manual workflow plans translations; it does not translate remotely.
- Review this stacked branch against the local Node 24 base before any future
  publication. This report does not authorize merging or deployment.

Contributor and configuration instructions: [i18n guide](../../development/i18n.md).
