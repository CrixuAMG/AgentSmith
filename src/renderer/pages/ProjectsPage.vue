<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { Project, ProjectFileNode } from '@/shared/types';
import { LAYOUT_LIMITS } from '@/shared/layout';
import FileTreeNode from '../components/FileTreeNode.vue';
import FileViewer from '../components/FileViewer.vue';
import { api } from '../services/api';
import { PALETTE_EVENTS } from '../services/command-palette';
import { fuzzySearch, indexProjectTree, type SearchEntry } from '../services/file-search';
import {
  activeGuardrails,
  clearWorkspace,
  persist,
  persistLayout,
  resetLayout,
  selectProject,
  selectWorkspaceTab,
  selectedProject,
  store,
  updateLayout,
} from '../services/store';

const { t } = useI18n();
const projects = computed(() => store.snapshot?.projects ?? []);
const project = computed(selectedProject);
const search = ref('');
const searchIndex = ref<SearchEntry[]>([]);
const searchCursor = ref(0);
const busy = ref(false);
const localError = ref<string | null>(null);
const newInstructionPath = ref('');
const draftPromptOpen = ref(false);
const draftPromptMode = ref<'switch' | 'overwrite'>('switch');
const pendingDraftAction = ref<(() => Promise<void>) | null>(null);
const diffLoading = ref(false);
const treePanel = ref<HTMLElement | null>(null);
const resizing = ref<'rail' | 'explorer' | null>(null);

const railWidth = computed(() => store.snapshot?.config.layout.railWidth ?? LAYOUT_LIMITS.railWidth.min);
const explorerRatio = computed(() => store.snapshot?.config.layout.explorerRatio ?? 0.335);

const searchResults = computed(() => {
  if (!search.value.trim()) return [];
  return fuzzySearch(searchIndex.value, search.value);
});
const groupedChanges = computed(() => {
  const groups = new Map<string, typeof store.git extends null ? never : NonNullable<typeof store.git>['changes']>();
  for (const change of store.git?.changes ?? []) {
    const label = change.kind === 'untracked' ? t('git.untracked') : change.kind === 'added' ? t('git.added') : change.kind === 'deleted' ? t('git.deleted') : change.kind === 'renamed' ? t('git.renamed') : change.kind === 'conflicted' ? t('git.conflicted') : t('git.modified');
    const current = groups.get(label) ?? [];
    current.push(change);
    groups.set(label, current);
  }
  return [...groups.entries()];
});
const instructionOverlapWarning = computed(() => {
  const paths = store.instructions.filter((item) => item.scope !== 'global').map((item) => item.relativePath === 'AGENTS.md' ? '' : item.relativePath.replace(/\/AGENTS\.md$/, ''));
  const hasNestedOverlap = paths.some((path) => path && paths.some((other) => other !== path && other.startsWith(`${path}/`)));
  const hasRootOverlap = paths.includes('') && paths.some(Boolean);
  return hasNestedOverlap || hasRootOverlap
    ? t('instructions.overlapWarning')
    : null;
});

async function loadWorkspace() {
  if (!project.value) return;
  busy.value = true;
  localError.value = null;
  store.treeLoading = true;
  try {
    const [tree, git, instructions] = await Promise.all([
      api.scanProject(project.value, { showHidden: store.snapshot?.config.showHiddenFiles ?? false }),
      api.gitStatus(project.value),
      api.listInstructions(project.value),
    ]);
    store.tree = tree;
    store.treeLoadedFor = project.value.id;
    searchIndex.value = indexProjectTree(tree);
    store.git = git;
    store.instructions = instructions;
    if (store.instructions.length && !store.selectedInstructionPath) await selectInstruction(store.instructions[0].relativePath);
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
    store.treeLoading = false;
  }
}

async function addProject() {
  localError.value = null;
  if (store.instructionDirty) {
    if (!window.confirm(t('instructions.discardDraftConfirm'))) return;
    discardInstructionDraft();
  }
  try {
    const picked = await api.pickProject();
    if (!picked) {
      localError.value = t('projects.pickerUnavailable');
      return;
    }
    if (!store.snapshot) return;
    const candidate: Project = { id: crypto.randomUUID(), name: picked.name, path: picked.path, lastOpenedAt: new Date().toISOString() };
    const validation = await api.validateProject(candidate);
    if (!validation.valid) {
      localError.value = validation.error ?? t('projects.invalidProject');
      return;
    }
    store.snapshot.projects.unshift(candidate);
    await persist('projects', store.snapshot.projects);
    await selectProject(candidate.id);
    await loadWorkspace();
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error);
  }
}

async function chooseProject(projectId: string) {
  const candidate = projects.value.find((item) => item.id === projectId);
  if (!candidate) return;
  if (store.instructionDirty) {
    if (!window.confirm(t('instructions.discardDraftConfirm'))) return;
    discardInstructionDraft();
  }
  const validation = await api.validateProject(candidate);
  if (!validation.valid) {
    localError.value = validation.error ?? t('projects.invalidProject');
    return;
  }
  candidate.lastOpenedAt = new Date().toISOString();
  await selectProject(projectId);
  await persist('projects', projects.value);
  await loadWorkspace();
}

async function removeProject(projectId: string) {
  if (!store.snapshot || !window.confirm(t('projects.removeConfirm'))) return;
  if (store.instructionDirty && !window.confirm(t('instructions.discardDraftConfirm'))) return;
  if (store.instructionDirty) discardInstructionDraft();
  store.snapshot.projects = store.snapshot.projects.filter((item) => item.id !== projectId);
  await persist('projects', store.snapshot.projects);
  if (store.snapshot.config.lastProjectId === projectId) await selectProject(null);
  if (!project.value) clearWorkspace();
}

async function selectFile(node: ProjectFileNode) {
  if (!project.value || node.kind !== 'file') return;
  store.selectedFilePath = node.relativePath;
  store.fileLoading = true;
  store.error = null;
  try {
    store.selectedFile = await api.readFile(project.value, node.relativePath, activeGuardrails());
  } catch (error) {
    store.selectedFile = null;
    store.error = error instanceof Error ? error.message : String(error);
  } finally {
    store.fileLoading = false;
  }
}

async function selectSearchResult(node: ProjectFileNode) {
  if (node.kind === 'directory') return;
  await selectFile(node);
}

async function togglePromptFile() {
  if (!project.value || !store.selectedFile) return;
  const path = store.selectedFile.relativePath;
  const existingIndex = store.promptFiles.findIndex((file) => file.path === path);
  if (existingIndex >= 0) {
    store.promptFiles.splice(existingIndex, 1);
    return;
  }
  store.promptFiles.push({ path, content: store.selectedFile.content });
}

async function selectChange(change: NonNullable<typeof store.git>['changes'][number]) {
  if (!project.value) return;
  diffLoading.value = true;
  localError.value = null;
  try {
     store.gitDiff = { path: change.path, staged: change.staged, content: await api.gitDiff(project.value, change.path, change.staged, activeGuardrails()) };
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error);
  } finally {
    diffLoading.value = false;
  }
}

async function selectInstruction(relativePath: string) {
  if (!project.value) return;
  store.instructionLoading = true;
  localError.value = null;
  try {
    store.selectedInstructionPath = relativePath;
    store.instructionDraft = await api.readInstruction(project.value, relativePath, activeGuardrails());
    store.instructionOriginalContent = store.instructionDraft;
    store.instructionDraftProjectId = project.value.id;
    store.instructionDirty = false;
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error);
  } finally {
    store.instructionLoading = false;
  }
}

async function saveInstruction(force = false): Promise<boolean> {
  if (!project.value || !store.selectedInstructionPath) return false;
  try {
    const existing = store.instructions.some((item) => item.relativePath === store.selectedInstructionPath);
    if (existing && !force) {
      draftPromptMode.value = 'overwrite';
      draftPromptOpen.value = true;
      return false;
    }
    await api.writeInstruction(project.value, store.selectedInstructionPath, store.instructionDraft, force);
    store.instructionOriginalContent = store.instructionDraft;
    store.instructionDirty = false;
    store.instructions = await api.listInstructions(project.value);
    return true;
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error);
    return false;
  }
}

function requestSaveInstruction() {
  void saveInstruction();
}

async function createInstruction() {
  if (!project.value) return;
  const relativePath = newInstructionPath.value.trim().replaceAll('\\', '/');
  if (!relativePath) return;
  const target = relativePath.endsWith('AGENTS.md') ? relativePath : `${relativePath.replace(/\/$/, '')}/AGENTS.md`;
  if (store.instructionDirty) {
    pendingDraftAction.value = () => createInstructionAt(target);
    draftPromptMode.value = 'switch';
    draftPromptOpen.value = true;
    return;
  }
  await createInstructionAt(target);
}

async function createInstructionAt(target: string, force = false) {
  if (!project.value) return;
  try {
    await api.writeInstruction(project.value, target, '', force);
    newInstructionPath.value = '';
    store.instructions = await api.listInstructions(project.value);
    await selectInstruction(target);
  } catch (error) {
    if (!force && error instanceof Error && error.message.includes('already exists')) {
      pendingDraftAction.value = () => createInstructionAt(target, true);
      draftPromptMode.value = 'overwrite';
      draftPromptOpen.value = true;
      return;
    }
    localError.value = error instanceof Error ? error.message : String(error);
  }
}

function discardInstructionDraft() {
  store.instructionDraft = store.instructionOriginalContent;
  store.instructionDirty = false;
}

function requestInstruction(relativePath: string) {
  if (!store.instructionDirty || relativePath === store.selectedInstructionPath) {
    void selectInstruction(relativePath);
    return;
  }
  pendingDraftAction.value = () => selectInstruction(relativePath);
  draftPromptMode.value = 'switch';
  draftPromptOpen.value = true;
}

async function saveDraftAndContinue() {
  const action = pendingDraftAction.value;
  const saved = await saveInstruction(true);
  if (!saved) return;
  pendingDraftAction.value = null;
  draftPromptOpen.value = false;
  if (action) await action();
}

async function discardDraftAndContinue() {
  const action = pendingDraftAction.value;
  pendingDraftAction.value = null;
  draftPromptOpen.value = false;
  discardInstructionDraft();
  if (action) await action();
}

function cancelDraftPrompt() {
  pendingDraftAction.value = null;
  draftPromptOpen.value = false;
}

function handleSearchKeydown(event: KeyboardEvent) {
  if (!searchResults.value.length) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    searchCursor.value = Math.min(searchCursor.value + 1, searchResults.value.length - 1);
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    searchCursor.value = Math.max(searchCursor.value - 1, 0);
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    void selectSearchResult(searchResults.value[searchCursor.value]);
  }
}

const RAIL_STEP = 16;
const EXPLORER_STEP = 0.02;
let dragStart: { pointerId: number; kind: 'rail' | 'explorer'; originX: number; originValue: number } | null = null;

function startResize(kind: 'rail' | 'explorer', event: PointerEvent) {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  event.preventDefault();
  dragStart = {
    pointerId: event.pointerId,
    kind,
    originX: event.clientX,
    originValue: kind === 'rail' ? railWidth.value : (treePanel.value?.clientWidth ?? 0),
  };
  resizing.value = kind;
  window.addEventListener('pointermove', handleResize);
  window.addEventListener('pointerup', endResize);
  window.addEventListener('pointercancel', endResize);
}

function handleResize(event: PointerEvent) {
  if (!dragStart || event.pointerId !== dragStart.pointerId) return;
  const delta = event.clientX - dragStart.originX;
  if (dragStart.kind === 'rail') {
    updateLayout({ railWidth: dragStart.originValue + delta });
    return;
  }
  const available = treePanel.value?.parentElement?.clientWidth ?? 0;
  if (available <= 0) return;
  updateLayout({ explorerRatio: (dragStart.originValue + delta) / available });
}

async function endResize(event: PointerEvent) {
  if (!dragStart || event.pointerId !== dragStart.pointerId) return;
  dragStart = null;
  resizing.value = null;
  window.removeEventListener('pointermove', handleResize);
  window.removeEventListener('pointerup', endResize);
  window.removeEventListener('pointercancel', endResize);
  await persistLayout();
}

function resizeWithKeyboard(kind: 'rail' | 'explorer', event: KeyboardEvent) {
  const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  if (!direction && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  if (kind === 'rail') {
    const limits = LAYOUT_LIMITS.railWidth;
    const next = event.key === 'Home' ? limits.min : event.key === 'End' ? limits.max : railWidth.value + direction * RAIL_STEP;
    updateLayout({ railWidth: next });
  } else {
    const limits = LAYOUT_LIMITS.explorerRatio;
    const next = event.key === 'Home' ? limits.min : event.key === 'End' ? limits.max : explorerRatio.value + direction * EXPLORER_STEP;
    updateLayout({ explorerRatio: next });
  }
  void persistLayout();
}

async function restoreLayout() {
  await resetLayout();
}

watch(search, () => { searchCursor.value = 0; });
watch(project, () => { void loadWorkspace(); });
onMounted(() => {
  window.addEventListener(PALETTE_EVENTS.refreshProject, loadWorkspace);
  if (store.pendingProjectPicker) {
    store.pendingProjectPicker = false;
    void addProject();
    return;
  }
  if (project.value && store.treeLoadedFor !== project.value.id) void loadWorkspace();
});
onBeforeUnmount(() => {
  window.removeEventListener(PALETTE_EVENTS.refreshProject, loadWorkspace);
  window.removeEventListener('pointermove', handleResize);
  window.removeEventListener('pointerup', endResize);
  window.removeEventListener('pointercancel', endResize);
});
</script>

<template>
  <div class="workspace-page" :class="{ resizing: resizing !== null }">
    <div class="page-heading workspace-heading">
      <div><span class="eyebrow">{{ t('projects.eyebrow') }}</span><h1>{{ t('projects.title') }}</h1><p class="lead">{{ t('projects.intro') }}</p></div>
      <button class="primary-button" type="button" @click="addProject">+ {{ t('projects.add') }}</button>
    </div>

    <div class="workspace-shell">
      <aside class="project-rail">
        <div class="rail-heading"><span class="eyebrow">{{ t('projects.registered') }}</span><span class="mono">{{ projects.length.toString().padStart(2, '0') }}</span></div>
        <div v-if="projects.length" class="project-list">
          <button v-for="item in projects" :key="item.id" class="project-list-item" :class="{ selected: item.id === project?.id }" type="button" @click="chooseProject(item.id)">
            <span class="project-list-dot"></span><span><strong>{{ item.name }}</strong><small class="mono">{{ item.path }}</small></span>
          </button>
        </div>
        <div v-else class="rail-empty"><span class="empty-mark">+</span><span>{{ t('projects.empty') }}</span></div>
        <div v-if="project" class="rail-selected">
          <span class="eyebrow">{{ t('projects.selected') }}</span><strong>{{ project.name }}</strong><span class="mono">{{ project.path }}</span>
          <button class="danger-text-button" type="button" @click="removeProject(project.id)">{{ t('projects.remove') }}</button>
        </div>
        <button class="layout-handle" type="button" role="separator" aria-orientation="vertical" :aria-label="t('layout.rail')" :aria-valuenow="railWidth" :aria-valuemin="LAYOUT_LIMITS.railWidth.min" :aria-valuemax="LAYOUT_LIMITS.railWidth.max" @pointerdown="startResize('rail', $event)" @keydown="resizeWithKeyboard('rail', $event)"></button>
      </aside>

      <section class="workspace-content">
        <div v-if="localError" class="inline-error" role="alert">{{ localError }}</div>
        <div v-if="!project" class="workspace-empty empty-state"><span class="empty-mark">⌘</span><strong>{{ t('projects.noSelection') }}</strong><span>{{ t('projects.noSelectionDetail') }}</span><button class="primary-button" type="button" @click="addProject">{{ t('projects.add') }}</button></div>
        <template v-else>
          <div v-if="store.error" class="inline-error" role="alert">{{ store.error }}</div>
          <div class="workspace-toolbar">
            <div class="workspace-tabs" role="tablist">
              <button class="workspace-tab" :class="{ active: store.workspaceTab === 'explorer' }" type="button" @click="selectWorkspaceTab('explorer')">{{ t('workspace.explorer') }}</button>
              <button class="workspace-tab" :class="{ active: store.workspaceTab === 'git' }" type="button" @click="selectWorkspaceTab('git')">{{ t('workspace.gitChanges') }} <span v-if="store.git?.changes.length" class="tab-count">{{ store.git.changes.length }}</span></button>
              <button class="workspace-tab" :class="{ active: store.workspaceTab === 'instructions' }" type="button" @click="selectWorkspaceTab('instructions')">{{ t('workspace.instructions') }} <span v-if="store.instructions.length" class="tab-count">{{ store.instructions.length }}</span></button>
            </div>
            <div class="toolbar-actions">
              <span v-if="busy" class="toolbar-status"><span class="loading-pulse"></span>{{ t('common.loading') }}</span>
              <button class="small-icon-button" type="button" :title="t('layout.resetTitle')" :aria-label="t('layout.reset')" @click="restoreLayout">↺</button>
            </div>
          </div>

          <div v-if="store.workspaceTab === 'explorer'" class="explorer-layout">
            <div ref="treePanel" class="tree-panel">
              <div class="panel-toolbar"><label class="search-field"><span>⌕</span><input v-model="search" type="search" :placeholder="t('workspace.searchFiles')" @keydown="handleSearchKeydown"></label><button class="small-icon-button" type="button" :title="t('workspace.toggleHidden')" @click="store.snapshot!.config.showHiddenFiles = !store.snapshot!.config.showHiddenFiles; void persist('config', store.snapshot!.config); void loadWorkspace()">◌</button></div>
              <div v-if="search" class="search-results" role="listbox">
                <button v-for="(node, index) in searchResults" :key="node.relativePath" class="search-result" :class="{ active: index === searchCursor }" type="button" @click="selectSearchResult(node)"><span>{{ node.kind === 'directory' ? '□' : '·' }}</span><span>{{ node.relativePath }}</span></button>
                <span v-if="!searchResults.length" class="search-empty">{{ t('workspace.noMatches') }}</span>
              </div>
              <div v-else-if="store.treeLoading" class="tree-empty"><span class="loading-pulse"></span>{{ t('workspace.scanning') }}</div>
              <div v-else class="file-tree" role="tree"><FileTreeNode v-for="node in store.tree" :key="node.relativePath" :node="node" :selected-path="store.selectedFilePath" @select="selectFile" /></div>
              <div class="tree-footer mono">{{ t('workspace.readOnly') }} · {{ t('workspace.gitignoreAware') }}</div>
              <button class="layout-handle" type="button" role="separator" aria-orientation="vertical" :aria-label="t('layout.explorer')" :aria-valuenow="Math.round(explorerRatio * 100)" :aria-valuemin="Math.round(LAYOUT_LIMITS.explorerRatio.min * 100)" :aria-valuemax="Math.round(LAYOUT_LIMITS.explorerRatio.max * 100)" @pointerdown="startResize('explorer', $event)" @keydown="resizeWithKeyboard('explorer', $event)"></button>
            </div>
            <FileViewer :file="store.selectedFile" :loading="store.fileLoading" :error="store.error" :context-selected="store.selectedFilePath ? store.promptFiles.some((file) => file.path === store.selectedFilePath) : false" @toggle-context="togglePromptFile" />
          </div>

          <div v-else-if="store.workspaceTab === 'git'" class="git-layout">
            <div class="git-summary"><div><span class="eyebrow">{{ t('git.branch') }}</span><strong>{{ store.git?.branch ?? t('common.unavailable') }}</strong></div><div><span class="eyebrow">{{ t('git.changes') }}</span><strong>{{ store.git?.changes.length ?? 0 }}</strong></div><button class="secondary-button" type="button" @click="loadWorkspace">{{ t('common.refresh') }}</button></div>
            <div v-if="store.git?.error" class="empty-state compact-empty"><span class="empty-mark">!</span><strong>{{ store.git.error }}</strong><span>{{ t('git.readOnlyNotice') }}</span></div>
            <div v-else-if="!store.git?.changes.length" class="empty-state compact-empty"><span class="empty-mark">✓</span><strong>{{ t('git.clean') }}</strong><span>{{ t('git.cleanDetail') }}</span></div>
            <div v-else class="git-changes-layout"><div class="change-list"><div v-for="[label, changes] in groupedChanges" :key="label" class="change-group"><div class="change-group-label"><span>{{ label }}</span><span class="mono">{{ changes.length.toString().padStart(2, '0') }}</span></div><button v-for="change in changes" :key="`${change.path}-${change.kind}`" class="change-item" :class="`change-${change.kind}`" type="button" @click="selectChange(change)"><span class="change-marker">{{ change.kind === 'modified' ? 'M' : change.kind === 'added' ? 'A' : change.kind === 'deleted' ? 'D' : change.kind === 'renamed' ? 'R' : change.kind === 'untracked' ? '?' : '!' }}</span><span>{{ change.path }}</span><span v-if="change.staged" class="change-state mono">{{ t('git.staged') }}</span><span v-if="change.unstaged" class="change-state mono">{{ t('git.unstaged') }}</span></button></div></div><div class="diff-panel"><div v-if="diffLoading" class="viewer-message"><span class="loading-pulse"></span>{{ t('git.loadingDiff') }}</div><pre v-else-if="store.gitDiff" class="diff-content">{{ store.gitDiff.content }}</pre><div v-else class="viewer-message"><span class="empty-mark">±</span><strong>{{ t('git.selectChange') }}</strong><span>{{ t('git.selectChangeDetail') }}</span></div></div></div>
          </div>

             <div v-else class="instructions-layout">
             <div class="instructions-list"><div class="panel-toolbar"><span class="eyebrow">{{ t('instructions.discovered') }}</span></div><div v-if="instructionOverlapWarning" class="instructions-warning" role="status">{{ instructionOverlapWarning }}</div><button v-for="item in store.instructions" :key="item.relativePath" class="instruction-item" :class="{ selected: item.relativePath === store.selectedInstructionPath }" type="button" @click="requestInstruction(item.relativePath)"><span class="instruction-scope">{{ item.scope === 'global' ? 'G' : item.scope === 'project' ? 'P' : 'N' }}</span><span><strong>{{ item.relativePath }}</strong><small>{{ t(`instructions.scope.${item.scope}`) }}</small></span></button><div v-if="!store.instructions.length" class="rail-empty"><span class="empty-mark">//</span><span>{{ t('instructions.empty') }}</span></div><div class="new-instruction"><label class="field-label" for="new-instruction">{{ t('instructions.newPath') }}</label><div class="inline-field"><input id="new-instruction" v-model="newInstructionPath" type="text" :placeholder="t('instructions.pathPlaceholder')"><button class="small-primary-button" type="button" @click="createInstruction">+</button></div></div></div>
              <div class="instruction-editor"><div class="editor-header"><div><span class="eyebrow">{{ t('instructions.editor') }}</span><strong>{{ store.selectedInstructionPath ?? t('instructions.select') }}</strong></div><button class="primary-button" type="button" :disabled="!store.selectedInstructionPath || !store.instructionDirty" @click="requestSaveInstruction">{{ t('common.save') }}</button></div><div v-if="store.instructionLoading" class="viewer-message"><span class="loading-pulse"></span>{{ t('common.loading') }}</div><textarea v-else v-model="store.instructionDraft" class="instruction-textarea" :placeholder="t('instructions.editorPlaceholder')" @input="store.instructionDirty = true"></textarea><div class="editor-footer mono">{{ store.instructionDirty ? t('instructions.unsaved') : t('instructions.atomicNotice') }}</div></div>
          </div>
        </template>
      </section>
     </div>
     <div v-if="draftPromptOpen" class="modal-backdrop"><section class="confirm-modal draft-confirm-modal" role="dialog" aria-modal="true"><span class="eyebrow">{{ t('instructions.unsavedEyebrow') }}</span><h2>{{ draftPromptMode === 'overwrite' ? t('instructions.overwriteTitle') : t('instructions.unsavedTitle') }}</h2><p>{{ draftPromptMode === 'overwrite' ? t('instructions.overwriteDetail') : t('instructions.unsavedDetail') }}</p><div class="modal-actions"><button class="secondary-button" type="button" @click="cancelDraftPrompt">{{ t('common.cancel') }}</button><button v-if="draftPromptMode === 'switch'" class="danger-button" type="button" @click="discardDraftAndContinue">{{ t('instructions.discardDraft') }}</button><button class="primary-button" type="button" @click="saveDraftAndContinue">{{ t('common.save') }}</button></div></section></div>
   </div>
</template>
