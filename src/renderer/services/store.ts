import { reactive } from 'vue';

import type {
  AppSnapshot,
  FileReadResult,
  GitStatus,
  InstructionFile,
  ProjectFileNode,
  ResourceKey,
  ViewId,
  WorkspaceTab,
} from '@/shared/types';
import { api } from './api';

export const store = reactive({
  snapshot: null as AppSnapshot | null,
  activeView: 'dashboard' as ViewId,
  workspaceTab: 'explorer' as WorkspaceTab,
  tree: [] as ProjectFileNode[],
  treeLoading: false,
  treeLoadedFor: null as string | null,
  selectedFilePath: null as string | null,
  selectedFile: null as FileReadResult | null,
  promptFiles: [] as Array<{ path: string; content: string }>,
  fileLoading: false,
  git: null as GitStatus | null,
  gitLoading: false,
  gitDiff: null as { path: string; staged: boolean; content: string } | null,
  instructions: [] as InstructionFile[],
  instructionLoading: false,
  selectedInstructionPath: null as string | null,
  selectedInstructionContent: '',
  error: null as string | null,
});

export async function initializeStore() {
  store.snapshot = await api.loadSnapshot();
  document.documentElement.dataset.theme = store.snapshot.config.theme;
}

export async function persist(key: ResourceKey, value: unknown) {
  await api.saveResource(key, value);
}

export async function persistConfig() {
  if (!store.snapshot) return;
  await persist('config', store.snapshot.config);
}

export function selectedProject() {
  const snapshot = store.snapshot;
  if (!snapshot?.config.lastProjectId) return null;
  return snapshot.projects.find((project) => project.id === snapshot.config.lastProjectId) ?? null;
}

export function activeGuardrails() {
  const snapshot = store.snapshot;
  const activeProfileId = snapshot?.profiles.find((profile) => profile.id === snapshot.config.activeProfileId)?.guardrailProfileId;
  return snapshot?.guardrails.find((profile) => profile.id === activeProfileId)
    ?? snapshot?.guardrails.find((profile) => profile.id === 'default-security')
    ?? null;
}

export async function selectProject(projectId: string | null) {
  if (!store.snapshot) return;
  store.snapshot.config.lastProjectId = projectId;
  await persist('config', store.snapshot.config);
  clearWorkspace();
}

export function clearWorkspace() {
  store.tree = [];
  store.treeLoadedFor = null;
  store.selectedFilePath = null;
  store.selectedFile = null;
  store.promptFiles = [];
  store.git = null;
  store.gitDiff = null;
  store.instructions = [];
  store.selectedInstructionPath = null;
  store.selectedInstructionContent = '';
  store.error = null;
}

export function applyResource(key: ResourceKey, value: unknown) {
  if (!store.snapshot) return;
  if (key === 'config') store.snapshot.config = value as AppSnapshot['config'];
  if (key === 'projects') store.snapshot.projects = value as AppSnapshot['projects'];
  if (key === 'goals') store.snapshot.goals = value as AppSnapshot['goals'];
  if (key === 'roles') store.snapshot.roles = value as AppSnapshot['roles'];
  if (key === 'guardrails') store.snapshot.guardrails = value as AppSnapshot['guardrails'];
  if (key === 'profiles') store.snapshot.profiles = value as AppSnapshot['profiles'];
  if (key === 'providerSettings') store.snapshot.providerSettings = value as AppSnapshot['providerSettings'];
  if (key === 'globalInstructions') store.snapshot.globalInstructions = String(value);
  if (key === 'providerInstructions') store.snapshot.providerInstructions = value as AppSnapshot['providerInstructions'];
}
