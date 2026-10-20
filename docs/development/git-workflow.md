# Git Workflow, Commits & Pull Requests

Follow **GitHub Flow**. Keep `main` stable and Git history clean, traceable, and reviewable. Respect existing work, security boundaries, and repository conventions.

---

## 1. Branches

- **Branch source:** Always branch from an up-to-date `main`, unless the work explicitly depends on another active branch. Account for dependencies and integration sequence.
- **Naming conventions (kebab-case):** Use typed prefixes followed by a concise description:
  - `feature/<feature-name>`
  - `fix/<issue-or-bug-description>`
  - `refactor/<affected-area>`
  - `docs/<doc-or-guide>`
  - `perf/`, `test/`, `chore/`, `ci/`, `build/`
- **Protected `main`:** Never commit or push directly to `main` without explicit owner authorization.
- Keep unrelated changes separate; use temporary integration branches only when strictly necessary.

---

## 2. Commits

- **Conventional Commits:**
  - Subject line in **English**, imperative mood (`feat: add slide animation trigger`), concise (~50-72 characters), without trailing period.
  - Informative body for non-trivial changes: explain **why** the change was necessary, key design/architecture choices, compatibility impact, and validation performed.
- **Logical atomicity:** Make commits logically atomic, including relevant tests and documentation. Prefer independently testable commits.
- **Staging hygiene:**
  - Inspect staged changes before committing (`git diff --staged`).
  - Exclude unrelated files, environment configurations (`.env*`), generated artifacts (`dist/`), test corpus files, caches, secrets, and private data.
  - Never bypass git hooks with `--no-verify`.
- **Breaking changes:** Identify breaking changes clearly using `!` in the header (e.g., `feat!: ...`) and/or `BREAKING CHANGE:` in the commit footer.
- **History preservation:** Never rewrite, amend, squash, rebase, reset, or force-push (`--force`) published/shared history without explicit authorization.

---

## 3. Pull Requests & Validation

- **Focused scope:** Keep PRs focused on a single clear purpose, outlining context, relevant decisions, potential risks, and known limitations.
- **Author identity & CLA:** Ensure your Git author email matches your GitHub account so the [Contributor License Agreement (CLA)](../../CLA.md) check via CLA Assistant can pass automatically.
- **Pre-submission verification:**
  - Run relevant local suites: linting (`npm run lint`), type checks, and unit tests (`npm test`).
  - Review the complete diff against the target branch; verify network contracts, backward compatibility, and regression risks.
  - Accurately report test results, failures, or intentionally skipped checks in the PR description.
- **Merge strategy:** Prefer **Squash and merge** for straightforward, atomic PRs; preserve individual commits (rebase or merge commit) only when individual commit history provides clear audit value.

---

## 4. AI Agent Authorization & Safety Guardrails

Automated assistants and AI coding agents operating on this repository must strictly adhere to the following rules:

1. **Explicit authorization required:**
   - **Never commit, push, open or modify PRs, merge, delete branches, or publish releases/tags without explicit user instruction for that specific action in the current turn.** Should be asked at the beginning of the session and confirmed by the user.
   - Authorization to implement a solution or investigate a bug **never** implies permission to commit or publish.
2. **Preserve existing workspace state:**
   - Always verify `git status --short` before touching files or suggesting changes.
   - Never overwrite, discard (`git restore .`, `git checkout --`, `git clean`), or hard-reset existing uncommitted changes from the developer.
   - Do not alter, apply, or drop the user's `git stash` entries.
3. **Complexity audit:**
   - In environments where AI review tools (such as `/ponytail`) are enabled, agents should actively audit diffs for over-engineering, unnecessary abstractions, and redundant dependencies before finalizing implementation.
4. **Human in the loop:**
   - Merging into `main` and releasing to production strictly requires human review and approval (refer to [Prepare Release Guide](../guides/prepare-release.md)).
