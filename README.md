# AgentSmith

AgentSmith is a local-first desktop command center for AI-assisted software development. It keeps projects, reusable roles, development goals, guardrails, instructions, prompt context, and provider execution in one transparent workspace.

## Development

```bash
npm install
npm run dev
```

The development command starts Vite and Electron together. For a production renderer smoke check:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

`npm start` loads the built renderer. Electron is configured with context isolation, disabled Node integration, and a typed preload bridge.

## Configuration

AgentSmith stores personal configuration at `~/.config/AgentSmith/` on macOS/Linux and `%APPDATA%/AgentSmith/` on Windows. It creates modular JSON resources for projects, goals, roles, guardrails, profiles, and providers, plus a canonical global instruction file at `instructions/global.md` and generated suggestions under `suggestions/`.

Writes are versioned, validated, backed up, and performed through a temporary file followed by an atomic rename. AgentSmith does not store API keys, tokens, environment-file contents, or private keys.

## Included Features

* Project registration without deleting project files.
* `.gitignore`-aware hierarchical explorer with hidden-file toggle, fuzzy search, read-only syntax-highlighted preview, binary detection, and a one-megabyte safeguard.
* Read-only Git branch, status, staged/unstaged state, and file-level diffs.
* Global, provider-scoped, project, and nested `AGENTS.md` discovery and atomic editing.
* CRUD for reusable goals, roles, guardrail profiles, and agent profiles.
* OpenCode and Codex provider adapters with capability reporting.
* Deterministic Prompt Studio composition with section-by-section preview, provider instructions, standard manifest context, guarded multi-file selection, and copy support.
* **Make a suggestion** on the task editor: a role-aware feature-proposal prompt that can be regenerated, accepted into the task, and reviewed before anything runs.
* Explicit process confirmation, streaming stdout/stderr, exit status, and cancellation.
* English i18n resources, locale-ready formatting, and dark/light theme support.

## Feature Suggestions

`Make a suggestion` composes a deterministic feature-proposal prompt locally from the selected project, role, and enabled goals, then runs that prompt through the selected provider and model. The suggestion surface shows the provider, model, and the advisory network boundary before generation; provider output is stored with the durable job record and displayed as rendered markdown. Each click of `Another suggestion` advances to a different proposal angle out of twelve.

Accepting selected ideas only copies them into the task field, preserving any text already there below a separator; it never starts execution automatically. The task then follows the ordinary composed prompt: guardrails, context manifest, section preview, explicit confirmation, and provider execution. Every generated suggestion is saved to `~/.config/AgentSmith/suggestions/<project name>/<timestamp>.md` before it is displayed, so a discarded suggestion is still recoverable. The file name is derived and validated in the main process, files are created exclusively at `0o600`, and the surface is write-only: there is no read, list, or delete operation.

## Providers

OpenCode is discovered from `PATH` and its installed `opencode models --verbose` command is queried at runtime, with a plain `models` fallback. Returned model IDs, names, and provider-reported variants are marked verified. Codex is detected from `PATH`; because no Codex executable is installed in the development environment and no stable model discovery interface can be verified here, its model list is intentionally empty/manual rather than guessed. A manual model identifier is clearly labelled when dynamic discovery is unavailable.

The initial process allowlist is `opencode` and `codex`. Commands are built as argument arrays with `shell: false` and run in the selected project root. AgentSmith never passes OpenCode's dangerous `--auto` flag by default.

## Security Boundaries

Project reads are root-bound and reject traversal and symlink escapes. The viewer and prompt context deny application-baseline sensitive paths such as `.env*` and common private-key extensions, plus active guardrails. AgentSmith writes only managed instruction paths and rejects existing symlink instruction targets until explicitly reviewed. Suggestion writes accept a project name but never a path: the name must be usable as a single directory segment, the resolved directory must stay inside the suggestions root, and each file is created exclusively so nothing is overwritten. Prompt-only guardrails are advisory; an unsandboxed provider can still make its own filesystem or network decisions after launch. Provider sandboxing is reported as unsupported unless the provider exposes and AgentSmith configures that capability.

See [`docs/security-model.md`](docs/security-model.md) for the complete threat model and [`docs/architecture.md`](docs/architecture.md) for module boundaries.
