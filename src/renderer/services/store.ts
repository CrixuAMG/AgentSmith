import { reactive } from 'vue';

import type {
  AppSnapshot,
  FileReadResult,
  GitStatus,
  InstructionFile,
  ProjectFileNode,
  ResourceKey,
  ViewId,
  WorkspaceLayout,
  WorkspaceTab,
} from '@/shared/types';
import { DEFAULT_WORKSPACE_LAYOUT, normalizeWorkspaceLayout } from '@/shared/layout';
import { api } from './api';

export const store = reactive({
  snapshot: null as AppSnapshot | null,
  activeView: 'dashboard' as ViewId,
  pendingProjectPicker: false,
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
  store.snapshot.config.layout = normalizeWorkspaceLayout(store.snapshot.config.layout);
  store.workspaceTab = store.snapshot.config.layout.tab;
  document.documentElement.dataset.theme = store.snapshot.config.theme;
  applyLayoutVariables();
}

export async function persist(key: ResourceKey, value: unknown) {
  await api.saveResource(key, value);
}

export async function persistConfig() {
  if (!store.snapshot) return;
  await persist('config', store.snapshot.config);
}

export function workspaceLayout(): WorkspaceLayout | null {
  return store.snapshot?.config.layout ?? null;
}

function applyLayoutVariables() {
  const layout = workspaceLayout();
  if (!layout) return;
  // CSS media queries collapse these panels on narrow viewports, so a stored
  // desktop width never constrains a mobile layout.
  document.documentElement.style.setProperty('--rail-width', `${layout.railWidth}px`);
  document.documentElement.style.setProperty('--explorer-ratio', String(layout.explorerRatio));
}

export function updateLayout(patch: Partial<WorkspaceLayout>) {
  if (!store.snapshot) return;
  store.snapshot.config.layout = normalizeWorkspaceLayout({ ...store.snapshot.config.layout, ...patch });
  applyLayoutVariables();
}

export async function persistLayout() {
  await persistConfig();
}

export async function selectWorkspaceTab(tab: WorkspaceTab) {
  if (!store.snapshot || store.workspaceTab === tab) return;
  store.workspaceTab = tab;
  updateLayout({ tab });
  await persistLayout();
}

export async function resetLayout() {
  updateLayout(structuredClone(DEFAULT_WORKSPACE_LAYOUT));
  store.workspaceTab = store.snapshot?.config.layout.tab ?? 'explorer';
  await persistLayout();
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
  if (key === 'promptHistory') store.snapshot.promptHistory = value as AppSnapshot['promptHistory'];
}
