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

AgentSmith stores personal configuration at `~/.config/AgentSmith/` on macOS/Linux and `%APPDATA%/AgentSmith/` on Windows. It creates modular JSON resources for projects, goals, roles, guardrails, profiles, and providers, plus a canonical global instruction file at `instructions/global.md`.

Writes are versioned, validated, backed up, and performed through a temporary file followed by an atomic rename. AgentSmith does not store API keys, tokens, environment-file contents, or private keys.

## Included Features

* Project registration without deleting project files.
* `.gitignore`-aware hierarchical explorer with hidden-file toggle, fuzzy search, read-only syntax-highlighted preview, binary detection, and a one-megabyte safeguard.
* Read-only Git branch, status, staged/unstaged state, and file-level diffs.
* Global, project, and nested `AGENTS.md` discovery and atomic editing.
* CRUD for reusable goals, roles, guardrail profiles, and agent profiles.
* OpenCode and Codex provider adapters with capability reporting.
* Deterministic Prompt Studio composition with section-by-section preview and copy support.
* Explicit process confirmation, streaming stdout/stderr, exit status, and cancellation.
* English i18n resources and dark/light theme support.

## Providers

OpenCode is discovered from `PATH` and its installed `opencode models` command is queried at runtime. Returned model IDs are marked verified. Codex is detected from `PATH`; because no Codex executable is installed in the development environment and no stable model discovery interface can be verified here, its model list is intentionally empty/manual rather than guessed.

The initial process allowlist is `opencode` and `codex`. Commands are built as argument arrays with `shell: false` and run in the selected project root. AgentSmith never passes OpenCode's dangerous `--auto` flag by default.

## Security Boundaries

Project reads are root-bound and reject traversal and symlink escapes. The viewer and prompt context deny active file-access guardrails such as `.env*` and common private-key extensions. AgentSmith writes only managed instruction paths. Prompt-only guardrails are advisory; an unsandboxed provider can still make its own filesystem or network decisions after launch. Provider sandboxing is reported as unsupported unless the provider exposes and AgentSmith configures that capability.

See [`docs/security-model.md`](docs/security-model.md) for the complete threat model and [`docs/architecture.md`](docs/architecture.md) for module boundaries.
