# AgentSmith

AgentSmith is a local-first desktop command center for AI-assisted software development. It keeps projects, reusable roles, development goals, guardrails, instructions, prompt context, provider execution, and explicit GitHub issue workflows in one transparent workspace.

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
* GitHub repository linking, session-only credential handling, issue browsing, and issue CRUD through the GitHub API.
* Provider-assisted project status analysis that produces reviewable issue drafts; selected drafts can be explicitly created as real GitHub issues.
* Deterministic Prompt Studio composition with section-by-section preview, provider instructions, standard manifest context, guarded multi-file selection, and copy support.
* **Make a suggestion** on the task editor: a role-aware feature-proposal prompt that can be regenerated, accepted into the task, and reviewed before anything runs.
* Explicit process confirmation, streaming stdout/stderr, exit status, and cancellation.
* Readable provider jobs with ANSI-cleaned output and separate Agent output, logs, errors, and system filters.
* Provider temporary files are scoped to `.AgentSmith/tmp/<execution-id>` inside the selected project and removed after the run.
* English i18n resources, locale-ready formatting, and dark/light theme support.

## Feature Suggestions

`Make a suggestion` composes a deterministic feature-proposal prompt locally from the selected project, role, and enabled goals, then runs that prompt through the selected provider and model. The suggestion surface shows the provider, model, and the advisory network boundary before generation; provider output is stored with the durable job record and displayed as rendered markdown. Each click of `Another suggestion` advances to a different proposal angle out of twelve.

Accepting selected ideas only copies them into the task field, preserving any text already there below a separator; it never starts execution automatically. The task then follows the ordinary composed prompt: guardrails, context manifest, section preview, explicit confirmation, and provider execution. Every generated suggestion is saved to `~/.config/AgentSmith/suggestions/<project name>/<timestamp>.md` before it is displayed, so a discarded suggestion is still recoverable. The file name is derived and validated in the main process, files are created exclusively at `0o600`, and the surface is write-only: there is no read, list, or delete operation.

## Providers

OpenCode is discovered from `PATH` and its installed `opencode models --verbose` command is queried at runtime, with a plain `models` fallback. Returned model IDs, names, and provider-reported variants are marked verified. Codex is detected from `PATH`; because no Codex executable is installed in the development environment and no stable model discovery interface can be verified here, its model list is intentionally empty/manual rather than guessed. A manual model identifier is clearly labelled when dynamic discovery is unavailable.

The initial process allowlist is `opencode` and `codex`. Commands are built as argument arrays with `shell: false` and run in the selected project root. AgentSmith never passes OpenCode's dangerous `--auto` flag by default.

## GitHub Issues

Open **Issues** for a selected project and link its `origin` remote. AgentSmith derives the repository owner and name from the remote without storing its URL credentials. Configure a GitHub OAuth App's public client ID as `AGENTSMITH_GITHUB_OAUTH_CLIENT_ID` to use the **Authorize AgentSmith in GitHub** browser flow. Alternatively, a GitHub personal access token can be entered for the current session, or supplied through `AGENTSMITH_GITHUB_TOKEN` before starting AgentSmith. Tokens are held only by the Electron main process and are never persisted or passed to an AI provider.

The recommended token is a **fine-grained personal access token** restricted to the selected repository, with the repository permission **Issues: Read and write**. **Metadata: Read-only** is required by GitHub and is selected automatically. No `Contents` or merge permission is needed. For a classic personal access token, use `repo` for a private repository or `public_repo` for a public repository. The token is used for `GET /user`, issue listing, and `POST`/`PATCH /repos/{owner}/{repo}/issues`; AgentSmith does not validate or request broader permissions. If the token only has read access, verification can succeed but creating or editing an issue will return GitHub's permission error.

In the Issues page, click **Link from Git remote**, then authorize the app in GitHub or paste a token and click **Use token for this session**. Use **New issue** or **Analyze current status** followed by explicit draft selection. The token is session-only; closing AgentSmith clears it. `AGENTSMITH_GITHUB_TOKEN` is useful for unattended startup configuration, but it remains process memory only and is removed from AI provider environments. The OAuth Device Flow uses the `repo` scope so it can write issues in private repositories; limit the OAuth app's use to the intended GitHub account.

**Analyze current status** asks the selected local provider to review bounded project structure, Git status, README, package metadata, and instruction context. The provider must return JSON issue drafts. AgentSmith validates the response and shows every draft for review. Only after selecting **Create selected issue(s)** does the main process make authenticated `POST /repos/{owner}/{repo}/issues` calls. A failed batch leaves the remaining drafts available for retry; no text response is represented as a created ticket.

## Security Boundaries

Project reads are root-bound and reject traversal and symlink escapes. The viewer and prompt context deny application-baseline sensitive paths such as `.env*` and common private-key extensions, plus active guardrails. AgentSmith writes only managed instruction paths and rejects existing symlink instruction targets until explicitly reviewed. Suggestion writes accept a project name but never a path: the name must be usable as a single directory segment, the resolved directory must stay inside the suggestions root, and each file is created exclusively so nothing is overwritten. GitHub issue writes are host-bound, input-validated, authenticated in the main process, and require an explicit selection action after provider review. Prompt-only guardrails are advisory; an unsandboxed provider can still make its own filesystem or network decisions after launch. Provider sandboxing is reported as unsupported unless the provider exposes and AgentSmith configures that capability.

See [`docs/security-model.md`](docs/security-model.md) for the complete threat model and [`docs/architecture.md`](docs/architecture.md) for module boundaries.
