import { DEFAULT_CONFIG, DEFAULT_GOALS, DEFAULT_GUARDRAILS, DEFAULT_PROFILES, DEFAULT_PROVIDER_SETTINGS, DEFAULT_ROLES } from '@/shared/defaults';
import { toRaw } from 'vue';
import type {
  AgentExecutionRequest,
  AgentSmithApi,
  AppSnapshot,
  ExecutionEvent,
  FileReadResult,
  GitStatus,
  GuardrailProfile,
  InstructionFile,
  Project,
  ProjectFileNode,
  ResourceKey,
} from '@/shared/types';

const fallbackSnapshot: AppSnapshot = {
  config: structuredClone(DEFAULT_CONFIG),
  projects: [],
  goals: structuredClone(DEFAULT_GOALS),
  roles: structuredClone(DEFAULT_ROLES),
  guardrails: structuredClone(DEFAULT_GUARDRAILS),
  profiles: structuredClone(DEFAULT_PROFILES),
  providerSettings: structuredClone(DEFAULT_PROVIDER_SETTINGS),
  globalInstructions: '',
  providerInstructions: {},
  storageRoot: '~/.config/AgentSmith',
  warnings: [],
};

const browserStorageKey = 'agentsmith.snapshot';
const listeners = new Set<(event: ExecutionEvent) => void>();

function browserApi(): AgentSmithApi {
  const read = (): AppSnapshot => {
    const stored = localStorage.getItem(browserStorageKey);
    return stored ? JSON.parse(stored) as AppSnapshot : structuredClone(fallbackSnapshot);
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
      if (key === 'globalInstructions') snapshot.globalInstructions = String(value);
      if (key === 'providerInstructions') snapshot.providerInstructions = value as AppSnapshot['providerInstructions'];
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
    async startProcess() {
      throw new Error('Process execution requires the desktop application.');
    },
    async cancelProcess() {},
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
    gitDiff: (project, relativePath, staged) => bridge.gitDiff(toPlainIpcValue(project), relativePath, staged),
    listInstructions: (project) => bridge.listInstructions(toPlainIpcValue(project)),
    readInstruction: (project, relativePath) => bridge.readInstruction(toPlainIpcValue(project), relativePath),
    writeInstruction: (project, relativePath, content, overwrite) => bridge.writeInstruction(toPlainIpcValue(project), relativePath, content, overwrite),
    startProcess: (request) => bridge.startProcess(toPlainIpcValue(request)),
  };
}

export const api: AgentSmithApi = typeof window !== 'undefined' && window.agentSmith
  ? desktopApi(window.agentSmith)
  : browserApi();

export function onProcessEvent(callback: (event: ExecutionEvent) => void): () => void {
  return api.onProcessEvent(callback);
}

export type { AgentExecutionRequest, GuardrailProfile, Project, ProjectFileNode };
