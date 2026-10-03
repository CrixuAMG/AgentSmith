<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { composePrompt } from '@/shared/prompt-composer';
import { renderMarkdown } from '@/shared/markdown';
import { parseSuggestionIdeas, type ParsedSuggestionIdea } from '@/shared/suggestion-parser';
import { composeSuggestionPrompt } from '@/shared/suggestion-composer';
import type { FeatureSuggestion, Model, PromptContextOptions, ProviderDiscovery, PromptHistoryEntry, Role } from '@/shared/types';
import { api, onProcessEvent } from '../services/api';
import { activeGuardrails, addPromptJob, refreshProviders, registerPromptJobExecution, selectedProject, selectProject, store } from '../services/store';
import { PALETTE_EVENTS } from '../services/command-palette';

const { t } = useI18n();
const project = computed(selectedProject);
const discoveries = ref<ProviderDiscovery[]>([]);
const loadingContext = ref(false);
const localError = ref<string | null>(null);
const task = ref('');
const selectedProviderId = ref('opencode');
const selectedModelId = ref<string | null>(null);
const selectedRoleId = ref<string | null>(null);
const selectedGuardrailId = ref<string | null>(null);
const selectedGoalIds = ref<string[]>([]);
const selectedVariant = ref<Record<string, string | number | boolean>>({});
const selectedSectionId = ref('contract');
const copied = ref(false);
const confirmationOpen = ref(false);
const executionId = ref<string | null>(null);
const executionState = ref<'idle' | 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled'>('idle');
const exitCode = ref<number | null>(null);
const executionCommand = ref<string | null>(null);
const historyEntryId = ref<string | null>(null);
const suggestion = ref<FeatureSuggestion | null>(null);
const suggestionStep = ref(0);
const suggestionPath = ref<string | null>(null);
const suggestionAccepted = ref(false);
const suggestionBusy = ref(false);
const suggestionModalOpen = ref(false);
const suggestionExecutionId = ref<string | null>(null);
const suggestionOutput = ref('');
const suggestionIdeas = ref<ParsedSuggestionIdea[]>([]);
const selectedSuggestionIdeas = ref<ParsedSuggestionIdea[]>([]);
const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const gitDiffSelection = ref<{ path: string; staged: boolean } | null>(null);
const contexts = reactive<PromptContextOptions>({
  globalInstructions: true,
  providerInstructions: true,
  projectInstructions: true,
  nestedInstructions: true,
  gitStatus: true,
  gitDiff: false,
  projectStructure: true,
  readme: false,
  composerJson: false,
  packageJson: false,
  selectedFiles: false,
});
const projectInstructionText = ref('');
const nestedInstructionText = ref('');
const readmeText = ref('');
const composerJsonText = ref('');
const packageJsonText = ref('');
const gitDiffText = ref('');

const providerIds = computed(() => [...new Set([
  ...(store.snapshot?.providerSettings ?? []).filter((provider) => provider.enabled).map((provider) => provider.id),
  ...discoveries.value.map((provider) => provider.installation.providerId),
])]);
const currentDiscovery = computed(() => discoveries.value.find((provider) => provider.installation.providerId === selectedProviderId.value) ?? null);
const models = computed<Model[]>(() => currentDiscovery.value?.models ?? []);
const selectedModel = computed(() => models.value.find((model) => model.id === selectedModelId.value) ?? null);
const modelVariants = computed(() => selectedModel.value?.variants ?? []);
const roles = computed(() => store.snapshot?.roles.filter((role) => role.enabled) ?? []);
const goals = computed(() => store.snapshot?.goals.filter((goal) => selectedGoalIds.value.includes(goal.id)) ?? []);
const guardrail = computed(() => store.snapshot?.guardrails.find((profile) => profile.id === selectedGuardrailId.value) ?? activeGuardrails());
const selectedRole = computed<Role | null>(() => roles.value.find((role) => role.id === selectedRoleId.value) ?? null);
const selectedFiles = computed(() => store.promptFiles);
const projectStructure = computed(() => formatTree(store.tree));
const gitStatusText = computed(() => {
  if (!store.git) return '';
  if (store.git.error) return store.git.error;
  const changes = store.git.changes.length ? store.git.changes.map((change) => `${change.kind}: ${change.path}`).join('\n') : 'clean';
  return `branch: ${store.git.branch ?? 'unknown'}\n${changes}`;
});
const contextPaths = computed(() => ({
  globalInstructions: '@global/AGENTS.md',
  providerInstructions: `${selectedProviderId.value}/instructions`,
  projectInstructions: 'AGENTS.md',
  nestedInstructions: 'nested AGENTS.md',
  projectStructure: '.',
  readme: 'README.md',
  composerJson: 'composer.json',
  packageJson: 'package.json',
  gitStatus: '.git/status',
  gitDiff: gitDiffSelection.value ? `${gitDiffSelection.value.path}${gitDiffSelection.value.staged ? ' (staged)' : ''}` : null,
}));
const providerReadiness = computed(() => {
  const discovery = currentDiscovery.value;
  if (!discovery?.installation.installed) return { label: t('prompt.providerUnavailable'), detail: t('prompt.noProvider'), ready: false };
  if (discovery.executionSupported === false) return { label: t('prompt.providerUnsupported'), detail: discovery.note ?? t('prompt.providerUnsupportedDetail'), ready: false };
  const model = selectedModelId.value ? (models.value.some((item) => item.id === selectedModelId.value) ? t('prompt.verifiedModel') : t('prompt.manualModel')) : t('prompt.providerDefaultModel');
  return { label: discovery.installation.version ?? t('common.installed'), detail: `${model} · ${t('prompt.networkAdvisory')}`, ready: true };
});
const suggestionHtml = computed(() => renderMarkdown(suggestionOutput.value || t('prompt.suggesting')));
const composition = computed(() => composePrompt({
  project: project.value,
  task: task.value,
  role: selectedRole.value,
  goals: goals.value,
  guardrails: guardrail.value,
  globalInstructions: store.snapshot?.globalInstructions ?? '',
  providerInstructions: store.snapshot?.providerInstructions[selectedProviderId.value] ?? '',
  projectInstructions: projectInstructionText.value,
  nestedInstructions: nestedInstructionText.value,
  projectStructure: projectStructure.value,
  readme: readmeText.value,
  composerJson: composerJsonText.value,
  packageJson: packageJsonText.value,
  gitStatus: gitStatusText.value,
  gitDiff: gitDiffText.value,
  selectedFiles: selectedFiles.value,
  contexts,
  contextPaths: contextPaths.value,
}));
const selectedSection = computed(() => composition.value.sections.find((section) => section.id === selectedSectionId.value) ?? composition.value.sections[0]);
const promptHistory = computed(() => project.value ? (store.snapshot?.promptHistory[project.value.id] ?? []) : []);

function formatTree(nodes: typeof store.tree, depth = 0): string {
  return nodes.flatMap((node) => {
    const line = `${'  '.repeat(depth)}${node.kind === 'directory' ? '[dir] ' : ''}${node.relativePath}`;
    return node.children ? [line, formatTree(node.children, depth + 1)] : [line];
  }).join('\n');
}

function hasProjectFile(relativePath: string, nodes: typeof store.tree = store.tree): boolean {
  return nodes.some((node) => node.relativePath === relativePath || (node.children ? hasProjectFile(relativePath, node.children) : false));
}

function applyProfileDefaults() {
  const profile = store.snapshot?.profiles.find((item) => item.id === store.snapshot?.config.activeProfileId) ?? store.snapshot?.profiles[0];
  if (!profile) return;
  selectedProviderId.value = profile.providerId;
  selectedModelId.value = profile.modelId;
  selectedRoleId.value = profile.roleId;
  selectedGoalIds.value = [...profile.goalIds];
  selectedGuardrailId.value = profile.guardrailProfileId;
  selectedVariant.value = { ...profile.variant };
}

async function loadContext() {
  if (!project.value) return;
  loadingContext.value = true;
  localError.value = null;
  try {
    if (store.treeLoadedFor !== project.value.id) {
      store.tree = await api.scanProject(project.value, { showHidden: store.snapshot?.config.showHiddenFiles ?? false });
      store.treeLoadedFor = project.value.id;
      store.git = await api.gitStatus(project.value);
    }
    const instructions = await api.listInstructions(project.value);
    const projectFile = instructions.find((item) => item.scope === 'project');
    const nestedFiles = instructions.filter((item) => item.scope === 'nested');
    projectInstructionText.value = projectFile ? await api.readInstruction(project.value, projectFile.relativePath, guardrail.value) : '';
    const nestedContents = await Promise.all(nestedFiles.map(async (item) => `### ${item.relativePath}\n${await api.readInstruction(project.value!, item.relativePath, guardrail.value)}`));
    nestedInstructionText.value = nestedContents.join('\n\n');
    const readOptional = async (relativePath: string) => {
      if (!hasProjectFile(relativePath)) return '';
      try {
        return (await api.readFile(project.value!, relativePath, guardrail.value)).content;
      } catch {
        return '';
      }
    };
    [readmeText.value, composerJsonText.value, packageJsonText.value] = await Promise.all([
      readOptional('README.md'),
      readOptional('composer.json'),
      readOptional('package.json'),
    ]);
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loadingContext.value = false;
  }
}

async function loadProviders() {
  try {
    discoveries.value = await refreshProviders();
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error);
  }
}

async function copyPrompt() {
  await navigator.clipboard.writeText(composition.value.text);
  copied.value = true;
  window.setTimeout(() => { copied.value = false; }, 1800);
}

function removePromptFile(path: string) {
  const index = store.promptFiles.findIndex((file) => file.path === path);
  if (index >= 0) store.promptFiles.splice(index, 1);
}

function setProvider(providerId: string) {
  selectedProviderId.value = providerId;
  store.activeProviderId = providerId;
  selectedModelId.value = null;
}

function toggleGoal(goalId: string) {
  selectedGoalIds.value = selectedGoalIds.value.includes(goalId)
    ? selectedGoalIds.value.filter((id) => id !== goalId)
    : [...selectedGoalIds.value, goalId];
}

async function saveHistoryEntry(patch: Partial<PromptHistoryEntry>) {
  if (!project.value || !store.snapshot || !historyEntryId.value) return;
  const entries = store.snapshot.promptHistory[project.value.id] ?? [];
  const index = entries.findIndex((entry) => entry.id === historyEntryId.value);
  if (index < 0) return;
  entries[index] = { ...entries[index], ...patch };
  store.snapshot.promptHistory[project.value.id] = entries;
  await api.saveResource('promptHistory', store.snapshot.promptHistory);
}

function historySettings(entry: PromptHistoryEntry) {
  return [entry.providerId, entry.modelId ?? t('profiles.noModel'), entry.roleName ?? t('profiles.noRole')].join(' · ');
}

function historyContextNames(entry: PromptHistoryEntry) {
  if (!entry.contexts) return t('prompt.historyLegacySettings');
  return Object.entries(entry.contexts)
    .filter(([, enabled]) => enabled)
    .map(([key]) => t(`prompt.contextLabels.${key}`))
    .join(', ') || t('common.none');
}

function requestExecution() {
  if (!project.value) {
    localError.value = t('prompt.noProject');
    return;
  }
  if (!task.value.trim()) {
    localError.value = t('prompt.noTask');
    return;
  }
  if (!providerReadiness.value.ready) {
    localError.value = providerReadiness.value.detail;
    return;
  }
  confirmationOpen.value = true;
  executionState.value = 'preparing';
}

async function confirmExecution() {
  if (!project.value || !store.snapshot) return;
  confirmationOpen.value = false;
  executionState.value = 'running';
  exitCode.value = null;
  const entry: PromptHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    executedAt: new Date().toISOString(),
    task: task.value,
    prompt: composition.value.text,
    providerId: selectedProviderId.value,
    modelId: selectedModelId.value,
    variant: { ...selectedVariant.value },
    roleId: selectedRole.value?.id ?? null,
    roleName: selectedRole.value?.name ?? null,
    goalIds: [...selectedGoalIds.value],
    goalNames: goals.value.map((goal) => goal.name),
    guardrailProfileId: guardrail.value?.id ?? null,
    guardrailProfileName: guardrail.value?.name ?? null,
    contexts: { ...contexts },
    command: null,
    status: 'started',
    exitCode: null,
  };
  historyEntryId.value = entry.id;
  const jobId = `job-${entry.id}`;
  entry.jobId = jobId;
  store.snapshot.promptHistory[project.value.id] = [entry, ...(store.snapshot.promptHistory[project.value.id] ?? [])].slice(0, 50);
  try {
    await api.saveResource('promptHistory', store.snapshot.promptHistory);
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error);
    historyEntryId.value = null;
    return;
  }
  addPromptJob({ id: jobId, projectId: project.value.id, historyEntryId: entry.id, task: entry.task, state: 'queued', executionId: null, command: null, output: [{ kind: 'system', text: `${t('prompt.queued')} · ${project.value.path}` }], exitCode: null, providerId: selectedProviderId.value, modelId: selectedModelId.value, purpose: 'task' });
  try {
    const result = await api.startProcess({ jobId, historyEntryId: entry.id, projectId: project.value.id, task: entry.task, purpose: 'task', providerId: selectedProviderId.value, modelId: selectedModelId.value, prompt: composition.value.text, projectPath: project.value.path, variant: selectedVariant.value, guardrailProfile: guardrail.value, guardrailProfileId: guardrail.value?.id ?? null, contextManifest: composition.value.contextManifest });
    executionId.value = result.executionId;
    executionCommand.value = result.command;
    const job = store.jobs.find((item) => item.id === jobId);
    if (job) { job.command = result.command; if (result.command) job.output.push({ kind: 'system', text: result.command }); }
    registerPromptJobExecution(jobId, result.executionId);
    await saveHistoryEntry({ command: result.command });
    store.activeJobId = jobId;
    store.activeView = 'prompt-job';
  } catch (error) {
    executionState.value = 'failed';
    const job = store.jobs.find((item) => item.id === jobId);
    if (job) { job.state = 'failed'; job.output.push({ kind: 'error', text: error instanceof Error ? error.message : String(error) }); }
    await saveHistoryEntry({ status: 'failed' });
    localError.value = error instanceof Error ? error.message : String(error);
  }
}

async function finishSuggestion() {
  if (!project.value || !suggestion.value) return;
  suggestionIdeas.value = parseSuggestionIdeas(suggestionOutput.value);
  selectedSuggestionIdeas.value = [];
  try {
    const saved = await api.saveSuggestion(project.value, suggestionOutput.value);
    suggestionPath.value = saved.relativePath;
  } catch (error) {
    suggestion.value = null;
    suggestionIdeas.value = [];
    localError.value = error instanceof Error ? error.message : String(error);
  } finally {
    suggestionBusy.value = false;
    suggestionExecutionId.value = null;
  }
}

function handleSuggestionEvent(event: { executionId: string; kind: string; text?: string }) {
  if (!suggestionBusy.value) return;
  if (!suggestionExecutionId.value) suggestionExecutionId.value = event.executionId;
  if (event.executionId !== suggestionExecutionId.value) return;
  if (event.kind === 'stdout' || event.kind === 'stderr') suggestionOutput.value += (event.text ?? '').replace(ansiEscapePattern, '');
  if (event.kind === 'completed') void finishSuggestion();
  if (event.kind === 'failed' || event.kind === 'cancelled') {
    suggestionBusy.value = false;
    suggestionExecutionId.value = null;
    localError.value = event.text ?? t('prompt.suggestionFailed');
  }
}

function handleProcessEvent(event: { executionId: string; kind: string; text?: string; exitCode?: number | null }) {
  handleSuggestionEvent(event);
  if (event.executionId !== executionId.value && event.kind !== 'started') return;
  if (event.kind === 'started') executionId.value = event.executionId;
  if (event.kind === 'completed') { executionState.value = 'completed'; exitCode.value = event.exitCode ?? 0; void saveHistoryEntry({ status: 'completed', exitCode: exitCode.value }); }
  if (event.kind === 'failed') {
    executionState.value = 'failed';
    exitCode.value = event.exitCode ?? null;
    void saveHistoryEntry({ status: 'failed', exitCode: exitCode.value });
  }
  if (event.kind === 'cancelled') { executionState.value = 'cancelled'; void saveHistoryEntry({ status: 'cancelled' }); }
}

function setTask(value: string) {
  task.value = value;
}

async function generateSuggestion() {
  if (!project.value || suggestionBusy.value) return;
  suggestionBusy.value = true;
  localError.value = null;
  try {
    const next = composeSuggestionPrompt({
      project: project.value,
      role: selectedRole.value,
      goals: goals.value,
      step: suggestionStep.value,
    });
    if (!providerReadiness.value.ready) throw new Error(providerReadiness.value.detail);
    suggestionOutput.value = '';
    suggestionIdeas.value = [];
    selectedSuggestionIdeas.value = [];
    suggestion.value = next;
    suggestionModalOpen.value = true;
    const suggestionJobId = `suggestion-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    addPromptJob({ id: suggestionJobId, projectId: project.value.id, historyEntryId: null, task: next.title, state: 'queued', executionId: null, command: null, output: [], exitCode: null, providerId: selectedProviderId.value, modelId: selectedModelId.value, purpose: 'suggestion' });
    const result = await api.startProcess({ jobId: suggestionJobId, projectId: project.value.id, task: next.title, purpose: 'suggestion', providerId: selectedProviderId.value, modelId: selectedModelId.value, prompt: next.text, projectPath: project.value.path, variant: selectedVariant.value, guardrailProfile: guardrail.value, guardrailProfileId: guardrail.value?.id ?? null, contextManifest: composition.value.contextManifest });
    suggestionExecutionId.value = result.executionId;
    suggestionStep.value += 1;
    suggestionPath.value = null;
    suggestionAccepted.value = false;
  } catch (error) {
    suggestionBusy.value = false;
    localError.value = error instanceof Error ? error.message : String(error);
  }
}

function acceptSelectedSuggestions() {
  if (!selectedSuggestionIdeas.value.length) return;
  const selected = selectedSuggestionIdeas.value.map((idea) => idea.text).join('\n\n');
  const existing = task.value.trim();
  task.value = existing ? `${selected}\n\n---\n\n${existing}` : selected;
  suggestionAccepted.value = true;
  suggestionModalOpen.value = false;
}

watch(project, () => { void loadContext(); });
watch(() => store.selectedFilePath, () => { if (store.selectedFilePath) contexts.selectedFiles = true; });
watch(() => store.promptFiles.length, () => { if (store.promptFiles.length) contexts.selectedFiles = true; });
watch(() => contexts.gitDiff, async (enabled) => {
  if (!enabled || !project.value || !store.git?.changes.length) return;
  const firstChange = store.git.changes.find((change) => change.kind !== 'deleted');
  if (firstChange) {
    gitDiffSelection.value = { path: firstChange.path, staged: firstChange.staged };
    gitDiffText.value = await api.gitDiff(project.value, firstChange.path, firstChange.staged, guardrail.value);
  }
});
watch(() => contexts.gitDiff, (enabled) => {
  if (!enabled) {
    gitDiffText.value = '';
    gitDiffSelection.value = null;
  }
});
watch(() => guardrail.value?.id, () => { if (project.value) void loadContext(); });

let removeProcessListener: (() => void) | null = null;
function handlePaletteEvent(event: Event) {
  if (event.type === PALETTE_EVENTS.refreshProviders) void loadProviders();
  if (event.type === PALETTE_EVENTS.executePrompt) requestExecution();
}
onMounted(async () => {
  applyProfileDefaults();
  store.activeProviderId = selectedProviderId.value;
  window.addEventListener(PALETTE_EVENTS.refreshProviders, handlePaletteEvent);
  window.addEventListener(PALETTE_EVENTS.executePrompt, handlePaletteEvent);
  await Promise.all([loadProviders(), loadContext()]);
  removeProcessListener = onProcessEvent(handleProcessEvent);
});
onUnmounted(() => {
  removeProcessListener?.();
  window.removeEventListener(PALETTE_EVENTS.refreshProviders, handlePaletteEvent);
  window.removeEventListener(PALETTE_EVENTS.executePrompt, handlePaletteEvent);
});
</script>

<template>
  <div class="prompt-page">
    <div class="page-heading prompt-heading">
      <div>
        <span class="eyebrow">{{ t('prompt.eyebrow') }}</span>
        <h1>{{ t('prompt.title') }}</h1>
        <p class="lead">{{ t('prompt.intro') }}</p>
      </div>
      <button class="primary-button" type="button" :disabled="!project || executionState === 'running'" @click="requestExecution">{{ t('prompt.execute') }} <span>↗</span></button>
    </div>

    <div v-if="localError" class="inline-error" role="alert">{{ localError }}</div>
    <div v-if="!project" class="empty-state prompt-empty"><span class="empty-mark">&gt;</span><strong>{{ t('prompt.noProject') }}</strong><button class="secondary-button" type="button" @click="store.activeView = 'projects'">{{ t('nav.projects') }}</button></div>

    <template v-else>
      <div class="prompt-config-grid">
        <section class="prompt-card"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.project') }}</span><span class="mono">01</span></div><select v-if="store.snapshot" :value="project.id" @change="selectProject(($event.target as HTMLSelectElement).value)"><option v-for="item in store.snapshot.projects" :key="item.id" :value="item.id">{{ item.name }}</option></select><span class="mono prompt-path">{{ project.path }}</span></section>
        <section class="prompt-card"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.provider') }}</span><span class="mono">02</span></div><select :value="selectedProviderId" @change="setProvider(($event.target as HTMLSelectElement).value)"><option v-for="providerId in providerIds" :key="providerId" :value="providerId">{{ providerId }}</option></select><span class="mono prompt-path">{{ providerReadiness.label }}</span><span class="prompt-readiness">{{ providerReadiness.detail }}</span></section>
        <section class="prompt-card"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.model') }}</span><span class="mono">03</span></div><select v-model="selectedModelId"><option :value="null">{{ t('profiles.noModel') }}</option><option v-for="model in models" :key="model.id" :value="model.id">{{ model.id }}</option></select><input v-if="!models.length" v-model="selectedModelId" type="text" :placeholder="t('profiles.manualModelPlaceholder')" :aria-label="t('profiles.manualModel')"><select v-if="modelVariants.length" v-model="selectedVariant.reasoningEffort"><option :value="undefined">{{ t('prompt.noVariant') }}</option><option v-for="variant in modelVariants" :key="variant.id" :value="variant.id">{{ variant.label }}</option></select><span class="mono prompt-path">{{ modelVariants.length ? t('prompt.modelVariant') : models.length ? t('common.verified') : t('common.manual') }}</span></section>
      </div>

      <div class="prompt-main-grid">
        <div class="prompt-controls">
          <section class="prompt-section-card"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.role') }} / {{ t('prompt.guardrail') }}</span></div><label class="form-field"><span>{{ t('prompt.role') }}</span><select v-model="selectedRoleId"><option :value="null">{{ t('profiles.noRole') }}</option><option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option></select></label><label class="form-field"><span>{{ t('prompt.guardrail') }}</span><select v-model="selectedGuardrailId"><option :value="null">{{ t('profiles.noGuardrail') }}</option><option v-for="profile in store.snapshot?.guardrails" :key="profile.id" :value="profile.id">{{ profile.name }}</option></select></label></section>
          <section class="prompt-section-card"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.goals') }}</span><span class="mono">{{ selectedGoalIds.length.toString().padStart(2, '0') }}</span></div><div class="goal-check-list"><label v-for="goal in store.snapshot?.goals" :key="goal.id" class="check-field"><input type="checkbox" :checked="selectedGoalIds.includes(goal.id)" :disabled="!goal.enabled" @change="toggleGoal(goal.id)"><span>{{ goal.name }}</span></label></div></section>
          <section class="prompt-section-card"><div class="prompt-card-heading"><div><span class="eyebrow">{{ t('prompt.context') }}</span><p>{{ t('prompt.contextDetail') }}</p></div></div><label class="context-check"><input v-model="contexts.globalInstructions" type="checkbox"><span>{{ t('prompt.global') }}</span></label><label class="context-check"><input v-model="contexts.projectInstructions" type="checkbox"><span>{{ t('prompt.projectInstructions') }}</span></label><label class="context-check"><input v-model="contexts.nestedInstructions" type="checkbox"><span>{{ t('prompt.nestedInstructions') }}</span></label><label class="context-check"><input v-model="contexts.gitStatus" type="checkbox"><span>{{ t('prompt.gitStatus') }}</span></label><label class="context-check"><input v-model="contexts.gitDiff" type="checkbox"><span>{{ t('prompt.gitDiff') }}</span></label><label class="context-check"><input v-model="contexts.projectStructure" type="checkbox"><span>{{ t('prompt.structure') }}</span></label><label class="context-check"><input v-model="contexts.selectedFiles" type="checkbox" :disabled="!store.selectedFile"><span>{{ t('prompt.selectedFiles') }}</span></label><span class="context-hint">{{ store.selectedFile ? store.selectedFile.relativePath : t('prompt.selectFilesHint') }}</span><div v-if="store.promptFiles.length" class="prompt-context-files"><button v-for="file in store.promptFiles" :key="file.path" type="button" @click="removePromptFile(file.path)"><span>{{ file.path }}</span><b>×</b></button></div></section>
          <section class="prompt-section-card prompt-context-extra"><div class="prompt-card-heading"><div><span class="eyebrow">{{ t('prompt.context') }} / {{ t('prompt.project') }}</span><p>{{ t('prompt.contextDetail') }}</p></div></div><label class="context-check"><input v-model="contexts.providerInstructions" type="checkbox"><span>{{ t('prompt.providerInstructions') }}</span></label><label class="context-check"><input v-model="contexts.readme" type="checkbox"><span>{{ t('prompt.readme') }}</span></label><label class="context-check"><input v-model="contexts.composerJson" type="checkbox"><span>{{ t('prompt.composerJson') }}</span></label><label class="context-check"><input v-model="contexts.packageJson" type="checkbox"><span>{{ t('prompt.packageJson') }}</span></label></section>
        </div>

        <div class="prompt-composer-area">
          <section class="task-editor"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.task') }}</span><span class="mono">INPUT</span></div><textarea :value="task" :placeholder="t('prompt.taskPlaceholder')" @input="setTask(($event.target as HTMLTextAreaElement).value)"></textarea><div class="task-footer"><span class="mono">{{ task.length }} chars</span><div class="task-footer-actions"><button class="secondary-button suggestion-trigger" type="button" :disabled="suggestionBusy" @click="generateSuggestion">{{ suggestionBusy ? t('prompt.suggesting') : t('prompt.suggest') }}</button><span v-if="loadingContext" class="toolbar-status"><span class="loading-pulse"></span>{{ t('common.loading') }}</span></div></div></section>

          <section v-if="suggestion" class="suggestion-panel"><div class="prompt-card-heading"><div><span class="eyebrow">{{ t('prompt.suggestion') }} / {{ suggestion.angleLabel }}</span><p>{{ t('prompt.suggestionDetail') }}</p></div><span class="mono">{{ selectedSuggestionIdeas.length }}/{{ suggestionIdeas.length || '...' }}</span></div><div class="suggestion-provider-meta"><span>{{ selectedProviderId }} · {{ selectedModelId ?? t('profiles.noModel') }}</span><span>{{ t('prompt.networkAdvisory') }}</span></div><div class="suggestion-summary"><span v-if="suggestionBusy"><span class="loading-pulse"></span>{{ t('prompt.suggesting') }}</span><span v-else>{{ suggestionIdeas.length }} {{ t('prompt.suggestion') }}</span><button v-if="!suggestionBusy" class="secondary-button" type="button" @click="suggestionModalOpen = true">{{ t('prompt.openSuggestions') }}</button></div><div class="suggestion-meta"><span class="mono truncate">{{ suggestionPath ?? t('prompt.suggesting') }}</span><span v-if="suggestionAccepted" class="status-pill">{{ t('prompt.suggestionAccepted') }}</span></div><div class="suggestion-actions"><button class="secondary-button" type="button" :disabled="suggestionBusy" @click="generateSuggestion">{{ t('prompt.anotherSuggestion') }} <span>↻</span></button><button class="secondary-button" type="button" :disabled="suggestionBusy" @click="suggestionModalOpen = true">{{ t('prompt.openSuggestions') }}</button></div></section>

          <section class="prompt-preview"><div class="preview-header"><div><span class="eyebrow">{{ t('prompt.preview') }}</span><strong>{{ composition.text.length.toLocaleString() }} chars</strong></div><button class="secondary-button" type="button" @click="copyPrompt">{{ copied ? t('prompt.copied') : t('prompt.copy') }}</button></div><div class="preview-sections"><button v-for="section in composition.sections" :key="section.id" class="preview-section-tab" :class="{ active: selectedSectionId === section.id, included: section.included }" type="button" @click="selectedSectionId = section.id"><span>{{ section.included ? '✓' : '—' }}</span>{{ section.title }}</button></div><div class="selected-section"><div class="selected-section-heading"><span>{{ selectedSection?.title }}</span><span class="mono">{{ selectedSection?.included ? t('common.enabled') : t('common.disabled') }}</span></div><pre>{{ selectedSection?.content || t('common.none') }}</pre></div><details class="full-prompt-details"><summary>{{ t('prompt.preview') }} / {{ t('prompt.sections') }}</summary><pre>{{ composition.text }}</pre></details><div class="context-manifest"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.contextManifest') }}</span><span class="mono">{{ composition.contextManifest.totals.includedBytes.toLocaleString() }} bytes</span></div><div class="context-manifest-list"><span v-for="entry in composition.contextManifest.entries.filter((item) => item.included)" :key="entry.id"><b>{{ entry.path ?? entry.id }}</b><small>{{ entry.bytes?.toLocaleString() }} bytes</small></span></div></div><div v-if="composition.blockedContexts.length" class="blocked-contexts"><strong>{{ t('prompt.blocked') }}</strong><span v-for="blocked in composition.blockedContexts" :key="blocked.path">{{ blocked.path }} · {{ blocked.reason }}</span></div></section>
        </div>
      </div>
    </template>

    <section v-if="project" class="prompt-history-panel"><div class="prompt-card-heading"><div><span class="eyebrow">{{ t('prompt.history') }}</span><p>{{ t('prompt.historyDetail') }}</p></div><span class="mono">{{ promptHistory.length.toString().padStart(2, '0') }}</span></div><div v-if="promptHistory.length" class="prompt-history-list"><details v-for="entry in promptHistory" :key="entry.id" class="prompt-history-entry"><summary><span><strong>{{ entry.task }}</strong><time class="mono" :datetime="entry.executedAt">{{ new Date(entry.executedAt).toLocaleString() }}</time></span><span class="history-status" :class="`history-${entry.status}`">{{ t(`prompt.${entry.status}`) }}</span></summary><div class="history-detail"><div class="history-settings"><span><b>{{ t('prompt.provider') }}</b>{{ historySettings(entry) }}</span><span><b>{{ t('prompt.role') }}</b>{{ entry.roleName ?? t('profiles.noRole') }}</span><span><b>{{ t('prompt.goals') }}</b>{{ entry.goalNames?.join(', ') || t('common.none') }}</span><span><b>{{ t('prompt.guardrail') }}</b>{{ entry.guardrailProfileName ?? t('profiles.noGuardrail') }}</span><span><b>{{ t('prompt.context') }}</b>{{ historyContextNames(entry) }}</span><span v-if="entry.variant && Object.keys(entry.variant).length"><b>{{ t('prompt.modelVariant') }}</b>{{ Object.entries(entry.variant).map(([key, value]) => `${key}: ${value}`).join(', ') }}</span><span v-if="entry.command"><b>{{ t('prompt.command') }}</b><code>{{ entry.command }}</code></span></div><pre>{{ entry.prompt }}</pre></div></details></div><div v-else class="history-empty">{{ t('prompt.historyEmpty') }}</div></section>

    <div v-if="suggestionModalOpen && suggestion" class="modal-backdrop suggestion-modal-backdrop" @click.self="suggestionModalOpen = false"><section class="suggestion-modal" role="dialog" aria-modal="true" :aria-label="t('prompt.suggestionModal')"><div class="suggestion-modal-header"><div><span class="eyebrow">{{ t('prompt.suggestionModal') }}</span><h2>{{ suggestion.title }}</h2><p>{{ selectedProviderId }} · {{ selectedModelId ?? t('profiles.noModel') }} · {{ t('prompt.networkAdvisory') }}</p></div><button class="secondary-button" type="button" @click="suggestionModalOpen = false">{{ t('prompt.closeSuggestions') }}</button></div><div v-if="suggestionBusy" class="suggestion-progress"><span class="loading-pulse"></span><span>{{ t('prompt.suggesting') }}</span></div><template v-else><div class="suggestion-modal-grid"><div class="suggestion-modal-output"><div class="eyebrow">{{ t('prompt.suggestionOutput') }}</div><div class="suggestion-markdown" v-html="suggestionHtml"></div></div><div class="suggestion-modal-selection"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.suggestion') }}</span><span class="mono">{{ selectedSuggestionIdeas.length }}/{{ suggestionIdeas.length }}</span></div><div class="suggestion-ideas"><label v-for="idea in suggestionIdeas" :key="idea.id" class="suggestion-idea"><input v-model="selectedSuggestionIdeas" type="checkbox" :value="idea"><span class="suggestion-idea-copy"><strong>{{ idea.title }}</strong><small v-if="idea.detail">{{ idea.detail }}</small></span></label></div></div></div><details class="suggestion-source"><summary>{{ t('prompt.suggestionPrompt') }}</summary><pre class="suggestion-text suggestion-prompt-text">{{ suggestion.text }}</pre></details><div class="suggestion-actions"><button class="secondary-button" type="button" :disabled="suggestionBusy" @click="generateSuggestion">{{ t('prompt.anotherSuggestion') }} <span>↻</span></button><button class="primary-button" type="button" :disabled="!selectedSuggestionIdeas.length || suggestionAccepted" @click="acceptSelectedSuggestions">{{ t('prompt.acceptSuggestion') }} <span>↗</span></button></div></template></section></div>
    <div v-if="confirmationOpen" class="modal-backdrop"><section class="confirm-modal" role="dialog" aria-modal="true"><span class="eyebrow">{{ t('prompt.preflight') }}</span><h2>{{ t('prompt.confirm') }}</h2><p>{{ t('prompt.confirmation') }}</p><div class="confirm-summary"><span><b>{{ t('prompt.provider') }}</b>{{ selectedProviderId }}</span><span><b>{{ t('prompt.model') }}</b>{{ selectedModelId ?? t('profiles.noModel') }}</span><span><b>{{ t('prompt.project') }}</b>{{ project?.path }}</span><span><b>{{ t('prompt.guardrail') }}</b>{{ guardrail?.name ?? t('profiles.noGuardrail') }}</span><span><b>{{ t('prompt.contextManifest') }}</b>{{ composition.contextManifest.totals.includedEntries }} bronnen · {{ composition.contextManifest.totals.includedBytes.toLocaleString() }} bytes</span></div><div class="preflight-context-list"><span v-for="entry in composition.contextManifest.entries.filter((item) => item.included)" :key="entry.id"><b>{{ entry.path ?? entry.id }}</b><small>{{ entry.decision }} · {{ entry.bytes?.toLocaleString() }} bytes</small></span></div><div v-if="composition.blockedContexts.length" class="blocked-contexts"><strong>{{ t('prompt.blocked') }}</strong><span v-for="blocked in composition.blockedContexts" :key="blocked.path">{{ blocked.path }} · {{ blocked.reason }}</span></div><div class="modal-actions"><button class="secondary-button" type="button" @click="confirmationOpen = false; executionState = 'idle'">{{ t('prompt.cancel') }}</button><button class="primary-button" type="button" @click="confirmExecution">{{ t('prompt.confirm') }} <span>↗</span></button></div></section></div>
  </div>
</template>
