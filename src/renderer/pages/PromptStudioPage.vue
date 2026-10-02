<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { composePrompt } from '@/shared/prompt-composer';
import type { Model, PromptContextOptions, ProviderDiscovery, Role } from '@/shared/types';
import { api, onProcessEvent } from '../services/api';
import { activeGuardrails, selectedProject, selectProject, store } from '../services/store';

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
const executionOutput = ref<Array<{ kind: 'stdout' | 'stderr' | 'system'; text: string }>>([]);
const exitCode = ref<number | null>(null);
const executionCommand = ref<string | null>(null);

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
}));
const selectedSection = computed(() => composition.value.sections.find((section) => section.id === selectedSectionId.value) ?? composition.value.sections[0]);

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
    projectInstructionText.value = projectFile ? await api.readInstruction(project.value, projectFile.relativePath) : '';
    const nestedContents = await Promise.all(nestedFiles.map(async (item) => `### ${item.relativePath}\n${await api.readInstruction(project.value!, item.relativePath)}`));
    nestedInstructionText.value = nestedContents.join('\n\n');
    const readOptional = async (relativePath: string) => {
      if (!hasProjectFile(relativePath)) return '';
      try {
        return (await api.readFile(project.value!, relativePath, activeGuardrails())).content;
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
    discoveries.value = await api.discoverProviders();
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error);
  }
}

async function copyPrompt() {
  await navigator.clipboard.writeText(composition.value.text);
  copied.value = true;
  window.setTimeout(() => { copied.value = false; }, 1800);
}

function setProvider(providerId: string) {
  selectedProviderId.value = providerId;
  selectedModelId.value = null;
}

function toggleGoal(goalId: string) {
  selectedGoalIds.value = selectedGoalIds.value.includes(goalId)
    ? selectedGoalIds.value.filter((id) => id !== goalId)
    : [...selectedGoalIds.value, goalId];
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
  if (!currentDiscovery.value?.installation.installed) {
    localError.value = t('prompt.noProvider');
    return;
  }
  confirmationOpen.value = true;
  executionState.value = 'preparing';
}

async function confirmExecution() {
  if (!project.value) return;
  confirmationOpen.value = false;
  executionState.value = 'running';
  executionOutput.value = [{ kind: 'system', text: `${t('prompt.running')} · ${project.value.path}` }];
  exitCode.value = null;
  try {
    const result = await api.startProcess({ providerId: selectedProviderId.value, modelId: selectedModelId.value, prompt: composition.value.text, projectPath: project.value.path, variant: selectedVariant.value, guardrailProfile: guardrail.value });
    executionId.value = result.executionId;
    executionCommand.value = result.command;
    executionOutput.value.push({ kind: 'system', text: result.command });
  } catch (error) {
    executionState.value = 'failed';
    localError.value = error instanceof Error ? error.message : String(error);
  }
}

async function cancelExecution() {
  if (executionId.value) await api.cancelProcess(executionId.value);
  executionState.value = 'cancelled';
}

function handleProcessEvent(event: { executionId: string; kind: string; text?: string; exitCode?: number | null }) {
  if (event.executionId !== executionId.value && event.kind !== 'started') return;
  if (event.kind === 'started') executionId.value = event.executionId;
  if (event.kind === 'stdout' || event.kind === 'stderr') executionOutput.value.push({ kind: event.kind, text: event.text ?? '' });
  if (event.kind === 'completed') { executionState.value = 'completed'; exitCode.value = event.exitCode ?? 0; }
  if (event.kind === 'failed') { executionState.value = 'failed'; exitCode.value = event.exitCode ?? null; }
  if (event.kind === 'cancelled') executionState.value = 'cancelled';
}

function setTask(value: string) {
  task.value = value;
}

watch(project, () => { void loadContext(); });
watch(() => store.selectedFilePath, () => { if (store.selectedFilePath) contexts.selectedFiles = true; });
watch(() => store.promptFiles.length, () => { if (store.promptFiles.length) contexts.selectedFiles = true; });
watch(() => contexts.gitDiff, async (enabled) => {
  if (!enabled || !project.value || !store.git?.changes.length) return;
  const firstChange = store.git.changes.find((change) => change.kind !== 'deleted');
  if (firstChange) gitDiffText.value = await api.gitDiff(project.value, firstChange.path, firstChange.staged);
});

let removeProcessListener: (() => void) | null = null;
onMounted(async () => {
  applyProfileDefaults();
  await Promise.all([loadProviders(), loadContext()]);
  removeProcessListener = onProcessEvent(handleProcessEvent);
});
onUnmounted(() => { removeProcessListener?.(); });
</script>

<template>
  <div class="prompt-page">
    <div class="page-heading prompt-heading"><div><span class="eyebrow">{{ t('prompt.eyebrow') }}</span><h1>{{ t('prompt.title') }}</h1><p class="lead">{{ t('prompt.intro') }}</p></div><button class="primary-button" type="button" :disabled="!project || executionState === 'running'" @click="requestExecution">{{ t('prompt.execute') }} <span>↗</span></button></div>
    <div v-if="localError" class="inline-error" role="alert">{{ localError }}</div>
    <div v-if="!project" class="empty-state prompt-empty"><span class="empty-mark">&gt;</span><strong>{{ t('prompt.noProject') }}</strong><button class="secondary-button" type="button" @click="store.activeView = 'projects'">{{ t('nav.projects') }}</button></div>
    <template v-else>
      <div class="prompt-config-grid">
        <section class="prompt-card"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.project') }}</span><span class="mono">01</span></div><select v-if="store.snapshot" :value="project.id" @change="selectProject(($event.target as HTMLSelectElement).value)"><option v-for="item in store.snapshot.projects" :key="item.id" :value="item.id">{{ item.name }}</option></select><span class="mono prompt-path">{{ project.path }}</span></section>
        <section class="prompt-card"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.provider') }}</span><span class="mono">02</span></div><select :value="selectedProviderId" @change="setProvider(($event.target as HTMLSelectElement).value)"><option v-for="providerId in providerIds" :key="providerId" :value="providerId">{{ providerId }}</option></select><span class="mono prompt-path">{{ currentDiscovery?.installation.installed ? currentDiscovery.installation.version : t('profiles.notInstalled') }}</span></section>
        <section class="prompt-card"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.model') }}</span><span class="mono">03</span></div><select v-model="selectedModelId"><option :value="null">{{ t('profiles.noModel') }}</option><option v-for="model in models" :key="model.id" :value="model.id">{{ model.id }}</option></select><input v-if="!models.length" v-model="selectedModelId" type="text" :placeholder="t('profiles.manualModelPlaceholder')" :aria-label="t('profiles.manualModel')"><select v-if="modelVariants.length" v-model="selectedVariant.reasoningEffort"><option :value="undefined">{{ t('prompt.noVariant') }}</option><option v-for="variant in modelVariants" :key="variant.id" :value="variant.id">{{ variant.label }}</option></select><span class="mono prompt-path">{{ modelVariants.length ? t('prompt.modelVariant') : models.length ? t('common.verified') : t('common.manual') }}</span></section>
      </div>

      <div class="prompt-main-grid"><div class="prompt-controls"><section class="prompt-section-card"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.role') }} / {{ t('prompt.guardrail') }}</span></div><label class="form-field"><span>{{ t('prompt.role') }}</span><select v-model="selectedRoleId"><option :value="null">{{ t('profiles.noRole') }}</option><option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option></select></label><label class="form-field"><span>{{ t('prompt.guardrail') }}</span><select v-model="selectedGuardrailId"><option :value="null">{{ t('profiles.noGuardrail') }}</option><option v-for="profile in store.snapshot?.guardrails" :key="profile.id" :value="profile.id">{{ profile.name }}</option></select></label></section><section class="prompt-section-card"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.goals') }}</span><span class="mono">{{ selectedGoalIds.length.toString().padStart(2, '0') }}</span></div><div class="goal-check-list"><label v-for="goal in store.snapshot?.goals" :key="goal.id" class="check-field"><input type="checkbox" :checked="selectedGoalIds.includes(goal.id)" :disabled="!goal.enabled" @change="toggleGoal(goal.id)"><span>{{ goal.name }}</span></label></div></section><section class="prompt-section-card"><div class="prompt-card-heading"><div><span class="eyebrow">{{ t('prompt.context') }}</span><p>{{ t('prompt.contextDetail') }}</p></div></div><label class="context-check"><input v-model="contexts.globalInstructions" type="checkbox"><span>{{ t('prompt.global') }}</span></label><label class="context-check"><input v-model="contexts.projectInstructions" type="checkbox"><span>{{ t('prompt.projectInstructions') }}</span></label><label class="context-check"><input v-model="contexts.nestedInstructions" type="checkbox"><span>{{ t('prompt.nestedInstructions') }}</span></label><label class="context-check"><input v-model="contexts.gitStatus" type="checkbox"><span>{{ t('prompt.gitStatus') }}</span></label><label class="context-check"><input v-model="contexts.gitDiff" type="checkbox"><span>{{ t('prompt.gitDiff') }}</span></label><label class="context-check"><input v-model="contexts.projectStructure" type="checkbox"><span>{{ t('prompt.structure') }}</span></label><label class="context-check"><input v-model="contexts.selectedFiles" type="checkbox" :disabled="!store.selectedFile"><span>{{ t('prompt.selectedFiles') }}</span></label><span class="context-hint">{{ store.selectedFile ? store.selectedFile.relativePath : t('prompt.selectFilesHint') }}</span></section></div><div class="prompt-composer-area"><section class="task-editor"><div class="prompt-card-heading"><span class="eyebrow">{{ t('prompt.task') }}</span><span class="mono">INPUT</span></div><textarea :value="task" :placeholder="t('prompt.taskPlaceholder')" @input="setTask(($event.target as HTMLTextAreaElement).value)"></textarea><div class="task-footer"><span class="mono">{{ task.length }} chars</span><span v-if="loadingContext" class="toolbar-status"><span class="loading-pulse"></span>{{ t('common.loading') }}</span></div></section><section class="prompt-preview"><div class="preview-header"><div><span class="eyebrow">{{ t('prompt.preview') }}</span><strong>{{ composition.text.length.toLocaleString() }} chars</strong></div><button class="secondary-button" type="button" @click="copyPrompt">{{ copied ? t('prompt.copied') : t('prompt.copy') }}</button></div><div class="preview-sections"><button v-for="section in composition.sections" :key="section.id" class="preview-section-tab" :class="{ active: selectedSectionId === section.id, included: section.included }" type="button" @click="selectedSectionId = section.id"><span>{{ section.included ? '✓' : '—' }}</span>{{ section.title }}</button></div><div class="selected-section"><div class="selected-section-heading"><span>{{ selectedSection?.title }}</span><span class="mono">{{ selectedSection?.included ? t('common.enabled') : t('common.disabled') }}</span></div><pre>{{ selectedSection?.content || t('common.none') }}</pre></div><details class="full-prompt-details"><summary>{{ t('prompt.preview') }} / {{ t('prompt.sections') }}</summary><pre>{{ composition.text }}</pre></details><div v-if="composition.blockedContexts.length" class="blocked-contexts"><strong>{{ t('prompt.blocked') }}</strong><span v-for="blocked in composition.blockedContexts" :key="blocked.path">{{ blocked.path }} · {{ blocked.reason }}</span></div></section></div></div>

      <section class="execution-panel"><div class="execution-header"><div><span class="eyebrow">{{ t('prompt.output') }}</span><strong>{{ executionState === 'idle' ? t('prompt.idle') : t(`prompt.${executionState}`) }}</strong></div><div class="execution-actions"><span v-if="executionCommand" class="mono execution-command">{{ executionCommand }}</span><span v-if="exitCode !== null" class="mono">{{ t('prompt.exitCode') }} {{ exitCode }}</span><button v-if="executionState === 'running'" class="danger-button" type="button" @click="cancelExecution">{{ t('prompt.cancel') }}</button><button v-else-if="executionOutput.length" class="secondary-button" type="button" @click="executionOutput = []">{{ t('prompt.clearOutput') }}</button></div></div><div v-if="executionOutput.length" class="execution-output"><div v-for="(line, index) in executionOutput" :key="`${index}-${line.text}`" class="output-line" :class="`output-${line.kind}`"><span class="mono">{{ line.kind === 'stderr' ? 'ERR' : line.kind === 'system' ? 'SYS' : 'OUT' }}</span><span>{{ line.text }}</span></div></div><div v-else class="execution-idle"><span class="empty-mark">›_</span><span>{{ t('prompt.confirmation') }}</span></div></section>
    </template>

    <div v-if="confirmationOpen" class="modal-backdrop"><section class="confirm-modal" role="dialog" aria-modal="true"><span class="eyebrow">{{ t('prompt.preflight') }}</span><h2>{{ t('prompt.confirm') }}</h2><p>{{ t('prompt.confirmation') }}</p><div class="confirm-summary"><span><b>{{ t('prompt.provider') }}</b>{{ selectedProviderId }}</span><span><b>{{ t('prompt.model') }}</b>{{ selectedModelId ?? t('profiles.noModel') }}</span><span><b>{{ t('prompt.project') }}</b>{{ project?.path }}</span><span><b>{{ t('prompt.guardrail') }}</b>{{ guardrail?.name ?? t('profiles.noGuardrail') }}</span></div><div class="modal-actions"><button class="secondary-button" type="button" @click="confirmationOpen = false; executionState = 'idle'">{{ t('prompt.cancel') }}</button><button class="primary-button" type="button" @click="confirmExecution">{{ t('prompt.confirm') }} <span>↗</span></button></div></section></div>
  </div>
  <section v-if="project" class="prompt-section-card prompt-context-extra"><div class="prompt-card-heading"><div><span class="eyebrow">{{ t('prompt.context') }} / {{ t('prompt.project') }}</span><p>{{ t('prompt.contextDetail') }}</p></div></div><label class="context-check"><input v-model="contexts.providerInstructions" type="checkbox"><span>{{ t('prompt.providerInstructions') }}</span></label><label class="context-check"><input v-model="contexts.readme" type="checkbox"><span>{{ t('prompt.readme') }}</span></label><label class="context-check"><input v-model="contexts.composerJson" type="checkbox"><span>{{ t('prompt.composerJson') }}</span></label><label class="context-check"><input v-model="contexts.packageJson" type="checkbox"><span>{{ t('prompt.packageJson') }}</span></label></section>
</template>
