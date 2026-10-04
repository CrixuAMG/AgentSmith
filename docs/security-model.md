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

## Suggestion Rules

* The renderer supplies a project display name and a text body. It never supplies a path.
* The display name is untrusted. It is rejected unless it can be used as one directory segment inside `suggestions/`: no path separators, no `.` or `..`, no control characters, and a bounded length.
* After the directory is created, its real path is resolved and must still be inside the suggestions root, so a pre-planted symlink cannot redirect the write. The operation fails closed.
* Files are created with an exclusive flag at mode `0o600`; an existing suggestion is never truncated or replaced, and a name collision allocates the next free suffix instead of overwriting.
* Bodies must be UTF-8 text within 256 KB. A rejected body leaves the tree untouched.
* The suggestion composer embeds the project name, role, and goal labels only. It never copies file contents, and it never embeds the absolute project path; the resulting prompt is sent to the explicitly selected provider only after the UI discloses that boundary.
* A suggestion generation is a provider execution and is recorded as a separate durable job. A generated idea is not executed as a development task; it becomes task content only after the user accepts it and then completes the existing preflight confirmation, so guardrails and provider confirmation still apply.
* There is no read, list, or delete operation for suggestions. The surface is write-only and append-only.

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
* Output is streamed to the current session but not persisted by default. Diagnostics redact obvious token/key patterns and never log file contents. A generated feature suggestion is an exception: it is written to the local suggestions directory by design, never transmitted by AgentSmith itself, and never sent to a provider unless the user accepts it and confirms execution.
* Provider output is treated as untrusted text. Terminal control sequences are stripped before output is persisted or displayed, and the renderer displays text rather than injecting provider output as HTML.
* Cancellation sends `SIGTERM`, then escalates only after a short grace period.

## Hosted Repository Rules

* GitHub credentials are accepted only by the main-process VCS service, held in memory for the session, and never written to configuration or returned through IPC.
* `AGENTSMITH_GITHUB_TOKEN` is available to the VCS service but is removed from the environment of every AI provider child process.
* Repository links are derived from the local Git remote and validated again at the IPC boundary. GitHub issue paths, titles, bodies, labels, and issue states use explicit bounds and allowlists.
* Provider issue analysis is untrusted output. It must parse as a bounded JSON issue list; prose, malformed objects, duplicate titles, and oversized fields are rejected or skipped before a write.
* Creating an issue requires an explicit user selection in the Issues page. Each selected draft is posted through the main-process GitHub client, and the result must contain a readable GitHub issue before the UI reports success.
* AgentSmith does not expose merge, force-push, reset, or arbitrary hosted-repository operations. Additional providers can implement the same narrow contract without receiving GitHub credentials.

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
