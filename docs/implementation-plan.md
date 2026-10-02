# AgentSmith Implementation Plan

## Phase 1: Foundation

* Create an Electron + Vite + Vue 3 + TypeScript application.
* Add strict TypeScript checking, ESLint-compatible formatting conventions, Vitest, and a production renderer build.
* Define shared entities and versioned default configuration.
* Implement a JSON configuration store with atomic writes, backups, malformed-file recovery, and modular resource directories.
* Add a context-isolated preload bridge and a persistent navigation shell.
* Add English i18n resources and locale-ready formatting helpers.

Acceptance: the app opens, default configuration is created, configuration survives restart, and foundation tests pass.

## Phase 2: Project Workspace

* Register existing directories through a native directory picker.
* Validate missing and inaccessible projects without crashing.
* Scan a bounded tree with hidden-file and `.gitignore` controls.
* Add fuzzy path filtering, keyboard-friendly selection, read-only file preview, syntax highlighting, binary detection, and a one-megabyte viewer limit.

Acceptance: a real local project can be inspected without a renderer filesystem escape.

## Phase 3: Git Inspection

* Detect repositories and current branch.
* Parse `git status --porcelain=v1 -b` into typed changes.
* Show staged/unstaged classification and file-level read-only diff previews.

Acceptance: the UI reflects a real repository without parsing human-formatted Git output.

## Phase 4: Instructions

* Discover global, project, and nested `AGENTS.md` files.
* Support safe read, create, and edit operations with overwrite confirmation in the UI.
* Keep the canonical global instruction file in AgentSmith storage and make provider locations explicit rather than assuming `$HOME/AGENTS.md`.
* Detect nested instruction scopes and duplicate/conflicting paths.

Acceptance: existing instruction files are never silently replaced.

## Phase 5: Personalization

* Add CRUD and persistence for goals, roles, and guardrail profiles.
* Validate rules and preserve resource versions.
* Add enabled state and ordering for goals.

Acceptance: user-created configuration survives restart and is reusable across projects.

## Phase 6: Providers

* Add a provider registry and provider-neutral capability model.
* Implement OpenCode installation and model discovery.
* Implement Codex installation detection and honest unsupported/fallback reporting.
* Keep provider command construction out of the UI.

Acceptance: unavailable providers are actionable and no model is represented as verified without discovery.

## Phase 7: Prompt Studio

* Add context toggles, role/goal/guardrail selection, task editing, deterministic composition, section inspection, and copy-to-clipboard.
* Use the same composed prompt object for preview and process execution.
* Block or visibly annotate contexts denied by the selected guardrail profile.

Acceptance: the visible preview is the exact prompt sent to a provider.

## Phase 8: Integrated Execution

* Add explicit preflight confirmation.
* Launch only supported provider commands in the selected project directory.
* Stream stdout/stderr, preserve current-session output, expose exit state, and cancel cleanly.

Acceptance: a locally installed provider can be run without arbitrary shell access.

## Phase 9: Hardening

* Exercise path traversal, symlink escape, `.env` denial, malformed JSON, unsafe argument, provider failure, and cancellation tests.
* Verify keyboard navigation, responsive layout, reduced-motion behavior, and actionable error states.
* Run unit/integration tests, typecheck, lint, and production build.
* Update all four design documents with implemented behavior and known limitations.

## Delivery Notes

The first release deliberately excludes Git writes, commits, history, network policy enforcement outside provider capabilities, and secret storage. These require platform-specific controls or additional product decisions. Prompt-level guardrails are clearly marked as advisory; application-controlled project reads and provider process construction are enforced.

## Current Delivery Status

Phases 1 through 8 are implemented in the current workspace: Electron/Vue foundation, local persistence, project explorer, Git inspection, instruction management, personalization, provider discovery, Prompt Studio, and controlled process execution. Phase 9 hardening is represented by path, symlink, malformed-configuration, guardrail, provider-argument, Git-parser, and configuration-store tests, plus the typecheck, lint, and production build commands in `package.json`. Remaining limitations are documented in `README.md` and `security-model.md` rather than hidden behind mock behavior.
