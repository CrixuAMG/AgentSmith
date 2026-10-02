export type Theme = 'dark' | 'light';

export type ViewId =
  | 'dashboard'
  | 'projects'
  | 'prompt-studio'
  | 'agent-profiles'
  | 'personalization'
  | 'settings';

export type WorkspaceTab = 'explorer' | 'git' | 'instructions';

export interface AppConfig {
  version: number;
  locale: string;
  theme: Theme;
  showHiddenFiles: boolean;
  lastProjectId: string | null;
  activeProfileId: string | null;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
}

export interface Goal {
  version: number;
  id: string;
  name: string;
  description: string;
  instructions: string[];
  enabled: boolean;
  order: number;
}

export interface Role {
  version: number;
  id: string;
  name: string;
  description: string;
  instructions: string[];
  tags: string[];
  enabled: boolean;
}

export type GuardrailType =
  | 'file_access'
  | 'filesystem_write'
  | 'network'
  | 'database'
  | 'command'
  | 'git'
  | 'agent_permission';

export type GuardrailAction = 'deny' | 'warn' | 'confirm';
export type EnforcementLayer = 'prompt' | 'application' | 'provider' | 'advisory';

export interface GuardrailRule {
  id: string;
  type: GuardrailType;
  pattern: string;
  action: GuardrailAction;
  enabled: boolean;
  enforcement: EnforcementLayer;
  description?: string;
}

export interface GuardrailProfile {
  version: number;
  id: string;
  name: string;
  description: string;
  rules: GuardrailRule[];
}

export interface AgentProfile {
  version: number;
  id: string;
  name: string;
  providerId: string;
  modelId: string | null;
  variant: Record<string, string | number | boolean>;
  roleId: string | null;
  goalIds: string[];
  guardrailProfileId: string | null;
}

export interface ProviderInstallation {
  providerId: string;
  installed: boolean;
  executable: string | null;
  version: string | null;
  error: string | null;
}

export interface ProviderCapabilities {
  supportsModelDiscovery: boolean;
  supportsReasoningEffort: boolean;
  supportsStreaming: boolean;
  supportsInteractiveTerminal: boolean;
  supportsPermissionModes: boolean;
  supportsSandboxing: boolean;
  supportsWorkingDirectory: boolean;
}

export interface ModelVariant {
  id: string;
  label: string;
  verified: boolean;
}

export interface Model {
  id: string;
  name: string;
  verified: boolean;
  variants: ModelVariant[];
}

export interface ProviderDiscovery {
  installation: ProviderInstallation;
  capabilities: ProviderCapabilities;
  models: Model[];
  modelDiscoveryAvailable: boolean;
  note: string | null;
  executionSupported?: boolean;
}

export interface ProviderSetting {
  id: string;
  name: string;
  executable: string | null;
  enabled: boolean;
}

export interface ProjectFileNode {
  name: string;
  relativePath: string;
  kind: 'directory' | 'file' | 'symlink';
  size?: number;
  ignored?: boolean;
  children?: ProjectFileNode[];
}

export interface FileReadResult {
  relativePath: string;
  content: string;
  language: string;
  lineCount: number;
  size: number;
}

export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

export interface GitFileChange {
  path: string;
  oldPath?: string;
  kind: GitChangeKind;
  staged: boolean;
  unstaged: boolean;
  indexStatus: string;
  worktreeStatus: string;
}

export interface GitStatus {
  isRepository: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  changes: GitFileChange[];
  error: string | null;
}

export interface InstructionFile {
  relativePath: string;
  absolutePath: string;
  scope: 'global' | 'project' | 'nested';
  depth: number;
  readable: boolean;
}

export interface PromptSection {
  id: string;
  title: string;
  content: string;
  included: boolean;
}

export interface PromptContextOptions {
  globalInstructions: boolean;
  projectInstructions: boolean;
  nestedInstructions: boolean;
  gitStatus: boolean;
  gitDiff: boolean;
  projectStructure: boolean;
  selectedFiles: boolean;
}

export interface PromptCompositionInput {
  project: Project | null;
  task: string;
  role: Role | null;
  goals: Goal[];
  guardrails: GuardrailProfile | null;
  globalInstructions: string;
  projectInstructions: string;
  nestedInstructions: string;
  projectStructure: string;
  gitStatus: string;
  gitDiff: string;
  selectedFiles: Array<{ path: string; content: string }>;
  contexts: PromptContextOptions;
}

export interface PromptComposition {
  text: string;
  sections: PromptSection[];
  blockedContexts: Array<{ path: string; reason: string }>;
}

export interface AgentExecutionRequest {
  providerId: string;
  modelId: string | null;
  prompt: string;
  projectPath: string;
  variant: Record<string, string | number | boolean>;
  guardrailProfile?: GuardrailProfile | null;
}

export interface ExecutionConfiguration {
  executable: string;
  args: string[];
  cwd: string;
  displayCommand: string;
}

export interface ExecutionEvent {
  executionId: string;
  kind: 'started' | 'stdout' | 'stderr' | 'completed' | 'failed' | 'cancelled';
  text?: string;
  exitCode?: number | null;
  providerId?: string;
}

export interface AppSnapshot {
  config: AppConfig;
  projects: Project[];
  goals: Goal[];
  roles: Role[];
  guardrails: GuardrailProfile[];
  profiles: AgentProfile[];
  providerSettings: ProviderSetting[];
  globalInstructions: string;
  providerInstructions: Record<string, string>;
  storageRoot: string;
  warnings: string[];
}

export type ResourceKey = 'config' | 'projects' | 'goals' | 'roles' | 'guardrails' | 'profiles' | 'providerSettings' | 'globalInstructions' | 'providerInstructions';

export interface AgentSmithApi {
  loadSnapshot(): Promise<AppSnapshot>;
  saveResource(key: ResourceKey, value: unknown): Promise<void>;
  pickProject(): Promise<{ path: string; name: string } | null>;
  validateProject(project: Project): Promise<{ valid: boolean; error: string | null }>;
  scanProject(project: Project, options: { showHidden: boolean }): Promise<ProjectFileNode[]>;
  readFile(project: Project, relativePath: string, guardrails: GuardrailProfile | null): Promise<FileReadResult>;
  gitStatus(project: Project): Promise<GitStatus>;
  gitDiff(project: Project, relativePath: string, staged: boolean): Promise<string>;
  listInstructions(project: Project): Promise<InstructionFile[]>;
  readInstruction(project: Project, relativePath: string): Promise<string>;
  writeInstruction(project: Project, relativePath: string, content: string, overwrite: boolean): Promise<void>;
  discoverProviders(): Promise<ProviderDiscovery[]>;
  startProcess(request: AgentExecutionRequest): Promise<{ executionId: string; command: string }>;
  cancelProcess(executionId: string): Promise<void>;
  onProcessEvent(callback: (event: ExecutionEvent) => void): () => void;
}
