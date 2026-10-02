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
* Include provider instructions, README/package manifests, and multiple guarded files selected from Explorer.
* Use the same composed prompt object for preview and process execution.
* Block or visibly annotate contexts denied by the selected guardrail profile.

Acceptance: the visible preview is the exact prompt sent to a provider.

## Phase 7a: Feature Suggestions

* Add a **Make a suggestion** action to the Prompt Studio task editor.
* Compose a deterministic, role-aware feature-proposal prompt from the selected project, role, and goals; rotate the proposal angle on every additional suggestion.
* Show the generated prompt for review with **Another suggestion** and **Accept suggestion**. Nothing is executed automatically.
* Persist every generated suggestion to `suggestions/<project-name>/<timestamp>.md` in the configuration root with a validated name, verified containment, exclusive create, and restrictive permissions.
* Keep the suggestion out of scope for automatic execution so guardrails, context selection, preview, and preflight confirmation still apply after acceptance.

Acceptance: a suggestion is reviewable, replaceable, and durably recorded, and a rejected or hostile project name cannot write outside the suggestions directory.

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

Phases 1 through 9 plus the Phase 7a suggestion workflow are implemented in the current workspace: Electron/Vue foundation, local persistence and migrations, project explorer, Git inspection, instruction management, personalization, provider discovery, Prompt Studio, feature suggestions, controlled process execution, and hardening. Coverage includes path, symlink, malformed/future configuration, guardrail, provider-argument/variant, Git-parser/diff, prompt composition, suggestion composition and persistence, and UI shell tests. Remaining limitations are documented in `README.md` and `security-model.md` rather than hidden behind mock behavior.

Feature suggestions are composed locally rather than generated by a provider. That keeps the action deterministic, offline, and free of unverified model output, at the cost of proposing feature *directions* rather than finished proposals; the generated prompt asks the provider for the actual proposals once the user accepts it.
