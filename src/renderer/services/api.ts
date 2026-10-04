import { DEFAULT_CONFIG, DEFAULT_GOALS, DEFAULT_GUARDRAILS, DEFAULT_PROFILES, DEFAULT_PROVIDER_SETTINGS, DEFAULT_ROLES, DEFAULT_VCS_SETTINGS } from '@/shared/defaults';
import { toRaw } from 'vue';
import type {
  AgentExecutionRequest,
  AgentSmithApi,
  AppSnapshot,
  ExecutionEvent,
  FileReadResult,
  GitBranchList,
  GitLog,
  GitPushResult,
  GitStatus,
  GuardrailProfile,
  InstructionFile,
  IssueDraft,
  IssueListResult,
  IssuePatch,
  IssueWriteResult,
  Project,
  ProjectFileNode,
  PromptJob,
  ResourceKey,
  RepositoryDetection,
  SavedSuggestion,
  VcsCredentialState,
  VcsProviderDiscovery,
  VcsProviderId,
} from '@/shared/types';

const fallbackSnapshot: AppSnapshot = {
  config: structuredClone(DEFAULT_CONFIG),
  projects: [],
  goals: structuredClone(DEFAULT_GOALS),
  roles: structuredClone(DEFAULT_ROLES),
  guardrails: structuredClone(DEFAULT_GUARDRAILS),
  profiles: structuredClone(DEFAULT_PROFILES),
  providerSettings: structuredClone(DEFAULT_PROVIDER_SETTINGS),
  vcsSettings: structuredClone(DEFAULT_VCS_SETTINGS),
  globalInstructions: '',
  providerInstructions: {},
  promptHistory: {},
  promptJobs: [],
  storageRoot: '~/.config/AgentSmith',
  warnings: [],
};

const browserStorageKey = 'agentsmith.snapshot';
const listeners = new Set<(event: ExecutionEvent) => void>();

function browserApi(): AgentSmithApi {
  const read = (): AppSnapshot => {
    const stored = localStorage.getItem(browserStorageKey);
    if (!stored) return structuredClone(fallbackSnapshot);
    const parsed = JSON.parse(stored) as Partial<AppSnapshot>;
    return { ...structuredClone(fallbackSnapshot), ...parsed, promptHistory: parsed.promptHistory ?? {} };
  };
  return {
    async loadSnapshot() {
      return read();
    },
    async saveResource(key: ResourceKey, value: unknown) {
      const snapshot = read();
      if (key === 'config') snapshot.config = value as AppSnapshot['config'];
      if (key === 'projects') snapshot.projects = value as AppSnapshot['projects'];
      if (key === 'goals') snapshot.goals = value as AppSnapshot['goals'];
      if (key === 'roles') snapshot.roles = value as AppSnapshot['roles'];
      if (key === 'guardrails') snapshot.guardrails = value as AppSnapshot['guardrails'];
      if (key === 'profiles') snapshot.profiles = value as AppSnapshot['profiles'];
      if (key === 'providerSettings') snapshot.providerSettings = value as AppSnapshot['providerSettings'];
      if (key === 'vcsSettings') snapshot.vcsSettings = value as AppSnapshot['vcsSettings'];
      if (key === 'globalInstructions') snapshot.globalInstructions = String(value);
      if (key === 'providerInstructions') snapshot.providerInstructions = value as AppSnapshot['providerInstructions'];
      if (key === 'promptHistory') snapshot.promptHistory = value as AppSnapshot['promptHistory'];
      localStorage.setItem(browserStorageKey, JSON.stringify(snapshot));
    },
    async pickProject() {
      return null;
    },
    async validateProject() {
      return { valid: false, error: 'Project selection requires the desktop application.' };
    },
    async scanProject() {
      return [];
    },
    async readFile(): Promise<FileReadResult> {
      throw new Error('File access requires the desktop application.');
    },
    async gitStatus(): Promise<GitStatus> {
      return { isRepository: false, branch: null, ahead: 0, behind: 0, changes: [], error: 'Git inspection requires the desktop application.' };
    },
    async gitDiff() {
      return 'Git inspection requires the desktop application.';
    },
    async gitLog(): Promise<GitLog> {
      return { isRepository: false, branch: null, commits: [], error: 'Git history requires the desktop application.' };
    },
    async gitBranches(): Promise<GitBranchList> {
      return { isRepository: false, current: null, branches: [], error: 'Git history requires the desktop application.' };
    },
    async gitPush(): Promise<GitPushResult> {
      return { ok: false, message: 'Git push requires the desktop application.' };
    },
    async gitRemote(): Promise<RepositoryDetection> {
      return { remote: null, link: null, error: 'Repository detection requires the desktop application.' };
    },
    async listInstructions(): Promise<InstructionFile[]> {
      return [];
    },
    async readInstruction() {
      throw new Error('Instruction access requires the desktop application.');
    },
    async writeInstruction() {
      throw new Error('Instruction access requires the desktop application.');
    },
    async discoverProviders() {
      return [];
    },
    async discoverVcsProviders(): Promise<VcsProviderDiscovery[]> {
      return [];
    },
    async setVcsCredential(_providerId: VcsProviderId, _token: string | null): Promise<VcsCredentialState> {
      throw new Error('Repository credentials require the desktop application.');
    },
    async listRepositoryIssues(_project: Project, _options: { state: 'open' | 'closed' | 'all' }): Promise<IssueListResult> {
      return { ok: false, repository: '', issues: [], error: 'Repository issues require the desktop application.' };
    },
    async createRepositoryIssue(_project: Project, _draft: IssueDraft): Promise<IssueWriteResult> {
      return { ok: false, issue: null, error: 'Repository issues require the desktop application.' };
    },
    async updateRepositoryIssue(_project: Project, _number: number, _patch: IssuePatch): Promise<IssueWriteResult> {
      return { ok: false, issue: null, error: 'Repository issues require the desktop application.' };
    },
    async saveSuggestion(): Promise<SavedSuggestion> {
      throw new Error('Suggestion storage requires the desktop application.');
    },
    async startProcess() {
      throw new Error('Process execution requires the desktop application.');
    },
    async cancelProcess() {},
    async listPromptJobs(): Promise<PromptJob[]> {
      return [];
    },
    async syncPermissions() { return { ok: false }; },
    onProcessEvent(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

export function toPlainIpcValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => toPlainIpcValue(item)) as T;
  if (value && typeof value === 'object') {
    const raw = toRaw(value as object) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).map(([key, item]) => [key, toPlainIpcValue(item)])) as T;
  }
  return value;
}

function desktopApi(bridge: AgentSmithApi): AgentSmithApi {
  return {
    ...bridge,
    saveResource: (key, value) => bridge.saveResource(key, toPlainIpcValue(value)),
    validateProject: (project) => bridge.validateProject(toPlainIpcValue(project)),
    scanProject: (project, options) => bridge.scanProject(toPlainIpcValue(project), toPlainIpcValue(options)),
    readFile: (project, relativePath, guardrails) => bridge.readFile(toPlainIpcValue(project), relativePath, toPlainIpcValue(guardrails)),
    gitStatus: (project) => bridge.gitStatus(toPlainIpcValue(project)),
    gitDiff: (project, relativePath, staged, guardrails) => bridge.gitDiff(toPlainIpcValue(project), relativePath, staged, toPlainIpcValue(guardrails)),
    gitLog: (project, options) => bridge.gitLog(toPlainIpcValue(project), toPlainIpcValue(options)),
    gitBranches: (project) => bridge.gitBranches(toPlainIpcValue(project)),
    gitPush: (project) => bridge.gitPush(toPlainIpcValue(project)),
    gitRemote: (project) => bridge.gitRemote(toPlainIpcValue(project)),
    listInstructions: (project) => bridge.listInstructions(toPlainIpcValue(project)),
    readInstruction: (project, relativePath, guardrails) => bridge.readInstruction(toPlainIpcValue(project), relativePath, toPlainIpcValue(guardrails)),
    writeInstruction: (project, relativePath, content, overwrite) => bridge.writeInstruction(toPlainIpcValue(project), relativePath, content, overwrite),
    listRepositoryIssues: (project, options) => bridge.listRepositoryIssues(toPlainIpcValue(project), toPlainIpcValue(options)),
    createRepositoryIssue: (project, draft) => bridge.createRepositoryIssue(toPlainIpcValue(project), toPlainIpcValue(draft)),
    updateRepositoryIssue: (project, number, patch) => bridge.updateRepositoryIssue(toPlainIpcValue(project), number, toPlainIpcValue(patch)),
    saveSuggestion: (project, content) => bridge.saveSuggestion(toPlainIpcValue(project), content),
    startProcess: (request) => bridge.startProcess(toPlainIpcValue(request)),
    listPromptJobs: () => bridge.listPromptJobs(),
    syncPermissions: (payload: any) => bridge.syncPermissions(toPlainIpcValue(payload)),
  };
}

export const api: AgentSmithApi = typeof window !== 'undefined' && window.agentSmith
  ? desktopApi(window.agentSmith)
  : browserApi();

export function onProcessEvent(callback: (event: ExecutionEvent) => void): () => void {
  return api.onProcessEvent(callback);
}

export type { AgentExecutionRequest, GuardrailProfile, Project, ProjectFileNode };
