export type Theme = 'dark' | 'light';

export type ViewId =
  | 'dashboard'
  | 'projects'
  | 'prompt-studio'
  | 'prompt-job'
  | 'agent-profiles'
  | 'personalization'
  | 'settings';

export type WorkspaceTab = 'explorer' | 'git' | 'commits' | 'instructions';

export interface WorkspaceLayout {
  version: 1;
  railWidth: number;
  explorerRatio: number;
  tab: WorkspaceTab;
}

export interface AppConfig {
  version: number;
  locale: string;
  theme: Theme;
  showHiddenFiles: boolean;
  lastProjectId: string | null;
  activeProfileId: string | null;
  maxConcurrentJobs: number;
  layout: WorkspaceLayout;
  allowedExternalPathsGlobal?: string[];
}

export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
  allowedExternalPaths?: string[];
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

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitLog {
  isRepository: boolean;
  branch: string | null;
  commits: GitCommit[];
  error: string | null;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  date: string | null;
}

export interface GitBranchList {
  isRepository: boolean;
  current: string | null;
  branches: GitBranch[];
  error: string | null;
}

export interface GitPushResult {
  ok: boolean;
  message: string;
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
  providerInstructions: boolean;
  projectInstructions: boolean;
  nestedInstructions: boolean;
  gitStatus: boolean;
  gitDiff: boolean;
  projectStructure: boolean;
  readme: boolean;
  composerJson: boolean;
  packageJson: boolean;
  selectedFiles: boolean;
}

export interface PromptCompositionInput {
  project: Project | null;
  task: string;
  role: Role | null;
  goals: Goal[];
  guardrails: GuardrailProfile | null;
  globalInstructions: string;
  providerInstructions: string;
  projectInstructions: string;
  nestedInstructions: string;
  projectStructure: string;
  readme: string;
  composerJson: string;
  packageJson: string;
  gitStatus: string;
  gitDiff: string;
  selectedFiles: Array<{ path: string; content: string }>;
  contexts: PromptContextOptions;
  contextPaths?: Partial<Record<keyof PromptContextOptions, string | null>>;
}

export type ContextDecision = 'allow' | 'warn' | 'confirm' | 'deny';

export interface PromptContextManifestEntry {
  id: string;
  kind: 'file' | 'diff' | 'instruction' | 'structure' | 'git-status' | 'global' | 'provider' | 'project' | 'role' | 'goals' | 'guardrails' | 'task';
  path: string | null;
  included: boolean;
  bytes: number | null;
  chars: number | null;
  lines: number | null;
  decision: ContextDecision;
  enforcement: EnforcementLayer | 'baseline' | null;
  ruleId: string | null;
  reason: string | null;
}

export interface PromptContextManifest {
  version: 1;
  entries: PromptContextManifestEntry[];
  totals: { includedEntries: number; includedBytes: number; includedChars: number; includedLines: number };
}

export interface PromptComposition {
  text: string;
  sections: PromptSection[];
  blockedContexts: Array<{ path: string; reason: string }>;
  contextManifest: PromptContextManifest;
}

export type SuggestionDiscipline = 'backend' | 'frontend' | 'quality' | 'architecture' | 'security' | 'general';

export interface FeatureSuggestion {
  angleId: string;
  angleLabel: string;
  discipline: SuggestionDiscipline;
  round: number;
  title: string;
  text: string;
}

export interface SavedSuggestion {
  relativePath: string;
  absolutePath: string;
  savedAt: string;
}

export type PromptHistoryStatus = 'queued' | 'starting' | 'started' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface PromptHistoryEntry {
  id: string;
  executedAt: string;
  task: string;
  prompt: string;
  providerId: string;
  modelId: string | null;
  variant: Record<string, string | number | boolean>;
  roleId: string | null;
  roleName: string | null;
  goalIds: string[];
  goalNames?: string[];
  guardrailProfileId: string | null;
  guardrailProfileName: string | null;
  contexts?: PromptContextOptions;
  contextManifest?: PromptContextManifest;
  command: string | null;
  status: PromptHistoryStatus;
  exitCode: number | null;
  jobId?: string | null;
}

export interface AgentExecutionRequest {
  providerId: string;
  modelId: string | null;
  prompt: string;
  projectPath: string;
  variant: Record<string, string | number | boolean>;
  guardrailProfile?: GuardrailProfile | null;
  guardrailProfileId?: string | null;
  contextManifest?: PromptContextManifest;
  jobId?: string;
  historyEntryId?: string | null;
  purpose?: 'task' | 'suggestion';
  projectId?: string | null;
  task?: string;
}

export interface ExecutionConfiguration {
  executable: string;
  args: string[];
  cwd: string;
  displayCommand: string;
}

export interface ExecutionEvent {
  executionId: string;
  kind: 'queued' | 'starting' | 'started' | 'stdout' | 'stderr' | 'completed' | 'failed' | 'cancelled';
  text?: string;
  exitCode?: number | null;
  providerId?: string;
  command?: string;
  jobId?: string;
  outputTruncated?: boolean;
}

export interface PromptJob {
  id: string;
  projectId: string | null;
  historyEntryId: string | null;
  task: string;
  state: 'queued' | 'starting' | 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  executionId: string | null;
  command: string | null;
  output: Array<{ kind: 'stdout' | 'stderr' | 'system' | 'error'; text: string }>;
  exitCode: number | null;
  providerId?: string;
  modelId?: string | null;
  purpose?: 'task' | 'suggestion';
  outputBytes?: number;
  outputTruncated?: boolean;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
  finishedAt?: string | null;
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
  promptHistory: Record<string, PromptHistoryEntry[]>;
  promptJobs: PromptJob[];
  storageRoot: string;
  warnings: string[];
}

export type ResourceKey = 'config' | 'projects' | 'goals' | 'roles' | 'guardrails' | 'profiles' | 'providerSettings' | 'globalInstructions' | 'providerInstructions' | 'promptHistory' | 'promptJobs';

export interface AgentSmithApi {
  loadSnapshot(): Promise<AppSnapshot>;
  saveResource(key: ResourceKey, value: unknown): Promise<void>;
  pickProject(): Promise<{ path: string; name: string } | null>;
  validateProject(project: Project): Promise<{ valid: boolean; error: string | null }>;
  scanProject(project: Project, options: { showHidden: boolean }): Promise<ProjectFileNode[]>;
  readFile(project: Project, relativePath: string, guardrails: GuardrailProfile | null): Promise<FileReadResult>;
  gitStatus(project: Project): Promise<GitStatus>;
  gitDiff(project: Project, relativePath: string, staged: boolean, guardrails?: GuardrailProfile | null): Promise<string>;
  gitLog(project: Project, options: { branch?: string | null; limit: number }): Promise<GitLog>;
  gitBranches(project: Project): Promise<GitBranchList>;
  gitPush(project: Project): Promise<GitPushResult>;
  listInstructions(project: Project): Promise<InstructionFile[]>;
  readInstruction(project: Project, relativePath: string, guardrails?: GuardrailProfile | null): Promise<string>;
  writeInstruction(project: Project, relativePath: string, content: string, overwrite: boolean): Promise<void>;
  discoverProviders(): Promise<ProviderDiscovery[]>;
  saveSuggestion(project: Project, content: string): Promise<SavedSuggestion>;
  startProcess(request: AgentExecutionRequest): Promise<{ executionId: string; jobId?: string; command: string | null }>;
  cancelProcess(executionId: string): Promise<void>;
  listPromptJobs(): Promise<PromptJob[]>;
  syncPermissions(payload: { projectPath?: string; allowedExternalPaths?: string[] }): Promise<{ ok: boolean }>;
  onProcessEvent(callback: (event: ExecutionEvent) => void): () => void;
}
