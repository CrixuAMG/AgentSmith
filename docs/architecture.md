# AgentSmith Architecture

## Decision

AgentSmith is an Electron desktop application with a Vue 3 + TypeScript renderer and a small Node.js main process. Electron is the pragmatic choice for this workspace because Node.js is already available, Rust/Tauri is not installed, and the product needs local filesystem, Git, and controlled child-process access. The main process is intentionally narrow so a future Tauri shell can replace it without changing the domain or presentation layers.

The application is local-first and does not require a server, database server, or cloud account. Structured configuration is human-readable JSON under the platform configuration directory (`~/.config/AgentSmith` on macOS/Linux and `%APPDATA%/AgentSmith` on Windows). Project files remain in their original locations.

## Runtime Boundaries

```text
Electron main process
├── ConfigurationStore      JSON, schema checks, atomic writes, backups
├── ProjectService           path validation, tree scanning, guarded reads
├── GitService               machine-readable status and read-only diffs
├── InstructionService       AGENTS.md discovery and guarded atomic writes
├── ProviderRegistry         OpenCode and Codex adapters
├── ProcessService           allowlisted provider process execution
└── IPC handlers             typed, minimal renderer-facing operations

Preload bridge
└── window.agentSmith       context-isolated, no Node.js exposure

Vue renderer
├── Application shell        navigation, project context, notifications
├── Pages                    dashboard, workspace, prompt studio, settings
├── Domain services          prompt composition and fuzzy filtering
└── i18n                     English resources and locale abstraction
```

`nodeIntegration` is disabled and `contextIsolation` is enabled. The renderer cannot import `fs`, spawn processes, or invoke arbitrary commands. Every privileged operation is an explicit IPC method.

## Module Ownership

### Core/domain

The shared TypeScript types describe projects, instructions, roles, goals, guardrails, providers, prompts, and execution states. `PromptComposer` is deterministic and has no Electron dependency. Guardrail matching is a pure function so it can be tested without a desktop runtime.

### Infrastructure

The main process owns all operating-system integrations. Configuration storage accepts only known resource keys, validates versioned documents, writes a backup before replacement, and uses a temporary file plus rename for atomicity. Project reads resolve paths relative to a registered project root and reject traversal and symlink escapes. Git is invoked with argument arrays and machine-readable flags. Provider commands are allowlisted by provider adapter.

### Presentation

The renderer receives an initial snapshot and saves individual resource collections through the bridge. Pages do not access the filesystem directly. The current project ID is held by the application shell and passed to workspace and prompt features, so the selected project remains visible across navigation.

## IPC Surface

The preload bridge exposes only these operation families:

* `storage.load` and `storage.save` for versioned application resources.
* `projects.pick`, `projects.validate`, and `projects.scan`.
* `files.read` for read-only, size-limited, binary-aware file access.
* `git.status` and `git.diff` for read-only repository inspection.
* `instructions.list`, `instructions.read`, and `instructions.write`.
* `providers.discover`.
* `process.start`, `process.cancel`, and process event subscriptions.

No IPC method accepts a shell command. Process execution receives a provider ID and an execution request; the adapter constructs an executable plus argument array.

## Provider Contract

The renderer consumes provider-neutral data:

```ts
interface AIProvider {
  id: string;
  name: string;
  detectInstallation(): Promise<ProviderInstallation>;
  getAvailableModels(): Promise<ModelDiscoveryResult>;
  getCapabilities(): ProviderCapabilities;
  buildExecutionCommand(request: AgentExecutionRequest): ExecutionConfiguration;
}
```

The initial OpenCode adapter runs its documented `models` command and parses one model ID per line. The Codex adapter detects the executable and reports that model discovery is unavailable until an installed Codex version exposes a stable machine-readable interface. The UI labels fallback/manual data rather than presenting it as verified.

## Prompt Composition

`PromptComposer` creates ordered sections: operating contract, global instructions, project instructions, role, goals, guardrails, project structure, Git context, selected files, and user task. Each section is retained in the preview model, so the preview and the execution request share the same generated prompt. Context sources are opt-in except global/project instructions, project structure, and Git status defaults.

## Navigation

The shell has a persistent sidebar with Dashboard, Projects, Prompt Studio, Agent Profiles, Personalization, and Settings. Projects use workspace tabs for Explorer, Git Changes, and Instructions. The shell displays the selected project name and path in the top bar. Empty states are explicit when no project is selected or a provider is unavailable.

## Testing Strategy

Pure domain tests cover path rules, guardrail matching, prompt composition, fuzzy search, and configuration validation. Infrastructure tests use temporary directories and a temporary Git repository. Provider tests mock executables rather than requiring credentials. Renderer tests are intentionally focused on exposed page behavior; the production build remains the final integration check.

## Future Shell Replacement

Domain types, persistence format, prompt composition, provider contracts, and the renderer bridge shape are shell-independent. A future Tauri implementation can replace `electron/main.cjs` and `electron/preload.cjs` with Rust commands while preserving the JSON format and renderer-facing operations.
