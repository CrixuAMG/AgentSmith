# AgentSmith Security Model

## Trust Boundaries

The user-selected project is untrusted input. Project files, Git output, provider output, and configuration files can contain arbitrary text. The renderer is less trusted than the main process and never receives Node.js primitives. The provider process is an external program and is not assumed to obey prompt instructions or guardrails.

## Filesystem Rules

* Project paths are chosen through an OS directory picker for new registrations.
* Existing registrations are validated with `stat` and `realpath` before use.
* Relative file paths are resolved against the canonical project root. Absolute paths, `..` traversal, and paths whose resolved target leaves the root are rejected.
* Directory scans do not follow symbolic-link directories. File reads resolve symlinks and reject targets outside the root.
* The read-only viewer has a one-megabyte limit and rejects binary-like content.
* `.env*` and common private-key extensions are denied by an application baseline before reads, in addition to active user guardrails. A denied file is never loaded into the renderer or prompt.
* Project writes are limited to `AGENTS.md` paths and use an atomic temporary-file replacement. The application never writes arbitrary project files.

## Configuration Rules

* Configuration is local JSON under the platform configuration root.
* API keys, tokens, environment file contents, and private keys are not stored by AgentSmith.
* Writes validate resource shape and version, create a timestamped backup, then atomically rename a temporary file.
* Malformed resources are quarantined with a `.invalid-<timestamp>` suffix and replaced with defaults; the user receives a warning.
* Known version-zero resources are migrated with a backup. Unknown future versions are left untouched and surfaced as warnings. Unknown envelope fields are retained when a valid resource is saved.

## Process Rules

* The renderer cannot run a command or provide a shell string.
* Provider adapters return an executable and argument array. `spawn` runs with `shell: false` and a validated project working directory.
* The initial process allowlist is `opencode` and `codex`, resolved by the main process. No arbitrary executable path is accepted from the UI.
* The safe default does not pass OpenCode's `--auto` option. The UI warns that provider permissions are still provider-controlled.
* Output is streamed to the current session but not persisted by default. Diagnostics redact obvious token/key patterns and never log file contents.
* Cancellation sends `SIGTERM`, then escalates only after a short grace period.

## Guardrail Layers

1. **Prompt-level**: instructions included in the composed prompt; advisory only.
2. **Application-enforced**: path checks, denied reads, project-root boundaries, and command allowlisting.
3. **Provider-enforced**: capability or permission options when a provider exposes them.
4. **OS-level**: Electron itself does not provide a complete sandbox for the child provider. Users should treat provider CLIs as trusted local software.

The UI distinguishes these layers and shows a warning where a rule cannot be enforced by AgentSmith. In particular, AgentSmith cannot prevent a provider from reading a file on its own once launched, cannot enforce network restrictions for an unsandboxed child process, and cannot guarantee that an external provider honors prompt-only rules.

## Symlink and Instruction Safety

AgentSmith never assumes a global `$HOME/AGENTS.md` convention. The canonical global file is stored in AgentSmith configuration. Provider-specific locations are detected/configured and displayed before any symlink operation. Existing files and symlinks are resolved and require explicit user confirmation before replacement or removal. Instruction writes reject existing symlink targets until they have been reviewed explicitly. The initial UI manages project instruction files and AgentSmith-managed provider instruction sources directly; it does not silently create global symlinks.

## Incident Handling

Errors identify the operation, affected path class, and corrective action without echoing sensitive content. A diagnostic view shows provider versions, configuration root, and recent status events, but not prompts, environment contents, tokens, or file contents. If an operation is blocked, the user can inspect the active rule and adjust it explicitly.
