<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { composeIssueAuditPrompt } from '@/shared/issue-audit';
import { composeIssuePrompt } from '@/shared/issue-composer';
import { issueBranchName, parseRepositoryCapabilities } from '@/shared/repositories';
import { parseIssueProposals, type ParsedIssueProposal } from '@/shared/issue-proposal-parser';
import type { IssueDraft, ProjectFileNode, ProviderDiscovery, RepositoryIssue, RepositoryLink, VcsProviderDiscovery } from '@/shared/types';
import { api } from '../services/api';
import { activeGuardrails, addPromptJob, handoffIssuePrompt, persist, registerPromptJobExecution, selectedProject, store as rawStore } from '../services/store';

const { t } = useI18n();
const store = rawStore as typeof rawStore & { snapshot: NonNullable<typeof rawStore.snapshot> };
const project = computed(selectedProject);

const discovery = ref<VcsProviderDiscovery | null>(null);
const discovering = ref(false);
const localError = ref<string | null>(null);
const status = ref<string | null>(null);
const busy = ref(false);
const stateFilter = ref<'open' | 'closed' | 'all'>('open');
const issues = ref<RepositoryIssue[]>([]);
const issuesLoading = ref(false);
const tokenDraft = ref('');
const instructionText = ref('');
const selectedIssue = ref<RepositoryIssue | null>(null);
const draft = ref<IssueDraft>({ title: '', body: '', labels: [] });
const draftOpen = ref(false);
const draftError = ref<string | null>(null);
const analysisProviders = ref<ProviderDiscovery[]>([]);
const analysisProviderId = ref(rawStore.activeProviderId);
const analysisBusy = ref(false);
const analysisError = ref<string | null>(null);
const analysisOutput = ref('');
const analysisPrompt = ref('');
const analysisExecutionId = ref<string | null>(null);
const analysisJobId = ref<string | null>(null);
const analysisProposals = ref<ParsedIssueProposal[]>([]);
const selectedProposalIds = ref<string[]>([]);
const creatingProposals = ref(false);
const createdIssues = ref<RepositoryIssue[]>([]);
const creationErrors = ref<string[]>([]);
const maxAnalysisOutputChars = 256 * 1024;
const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

const link = computed<RepositoryLink | null>(() => project.value?.repository ?? null);
const capabilities = computed(() => parseRepositoryCapabilities(instructionText.value));
const credentialState = computed(() => discovery.value?.credential ?? null);
const connected = computed(() => discovery.value?.installation.connected === true);
const labelsText = computed({
  get: () => draft.value.labels.join(', '),
  set: (value: string) => { draft.value.labels = value.split(',').map((label) => label.trim()).filter(Boolean); },
});
const canWrite = computed(() => Boolean(link.value) && credentialState.value?.configured === true);
const openCount = computed(() => issues.value.filter((issue) => issue.state === 'open').length);
const analysisProvider = computed(() => analysisProviders.value.find((provider) => provider.installation.providerId === analysisProviderId.value) ?? null);
const analysisReady = computed(() => Boolean(analysisProvider.value?.installation.installed && analysisProvider.value.executionSupported !== false));
const analysisModelId = computed(() => {
  const profile = store.snapshot?.profiles.find((item) => item.id === store.snapshot?.config.activeProfileId);
  return profile?.providerId === analysisProviderId.value ? profile.modelId : null;
});
const analysisVariant = computed(() => {
  const profile = store.snapshot?.profiles.find((item) => item.id === store.snapshot?.config.activeProfileId);
  return profile?.providerId === analysisProviderId.value ? { ...profile.variant } : {};
});
const selectedProposalCount = computed(() => selectedProposalIds.value.length);
const analysisStatus = computed(() => {
  if (!analysisProvider.value) return t('issues.providerUnavailable');
  if (!analysisProvider.value.installation.installed || analysisProvider.value.executionSupported === false) {
    return t('issues.providerUnavailable');
  }
  return `${analysisProvider.value.installation.providerId} · ${analysisProvider.value.installation.version ?? t('common.installed')}`;
});

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatAuditTree(nodes: ProjectFileNode[], depth = 0): string {
  return nodes.flatMap((node) => {
    const line = `${'  '.repeat(depth)}${node.kind === 'directory' ? '[dir] ' : ''}${node.relativePath}`;
    return node.children ? [line, formatAuditTree(node.children, depth + 1)] : [line];
  }).join('\n');
}

function hasProjectFile(relativePath: string, nodes: ProjectFileNode[]): boolean {
  return nodes.some((node) => node.relativePath === relativePath || (node.children ? hasProjectFile(relativePath, node.children) : false));
}

async function loadAnalysisProviders() {
  if (typeof api.discoverProviders !== 'function') return;
  try {
    analysisProviders.value = await api.discoverProviders();
    const current = analysisProviders.value.find((provider) => provider.installation.providerId === rawStore.activeProviderId);
    const preferred = (current?.installation.installed && current.executionSupported !== false ? current : null)
      ?? analysisProviders.value.find((provider) => provider.installation.installed && provider.executionSupported !== false)
      ?? analysisProviders.value[0];
    if (preferred && !analysisProviders.value.some((provider) => provider.installation.providerId === analysisProviderId.value)) {
      analysisProviderId.value = preferred.installation.providerId;
    }
  } catch (error) {
    analysisError.value = messageOf(error);
  }
}

async function readAuditContext(target: NonNullable<typeof project.value>) {
  const guardrails = activeGuardrails();
  const [tree, git, instructionFiles] = await Promise.all([
    api.scanProject(target, { showHidden: false }),
    api.gitStatus(target),
    api.listInstructions(target),
  ]);
  const instructionContents = await Promise.all(instructionFiles
    .filter((file) => file.scope !== 'global')
    .map(async (file) => {
      try {
        return `### ${file.relativePath}\n${await api.readInstruction(target, file.relativePath, guardrails)}`;
      } catch {
        return '';
      }
    }));
  const readOptional = async (relativePath: string) => {
    if (!hasProjectFile(relativePath, tree)) return '';
    try {
      return (await api.readFile(target, relativePath, guardrails)).content;
    } catch {
      return '';
    }
  };
  const [readme, packageJson, composerJson] = await Promise.all([
    readOptional('README.md'),
    readOptional('package.json'),
    readOptional('composer.json'),
  ]);
  const changes = git.changes.length
    ? git.changes.map((change) => `${change.kind}: ${change.path}`).join('\n')
    : 'clean';
  return {
    projectStructure: formatAuditTree(tree) || '(empty project)',
    gitStatus: git.error ?? `branch: ${git.branch ?? 'unknown'}\n${changes}`,
    readme,
    packageJson,
    composerJson,
    instructions: instructionContents.filter(Boolean).join('\n\n'),
  };
}

async function discover() {
  discovering.value = true;
  localError.value = null;
  try {
    const discoveries = await api.discoverVcsProviders();
    discovery.value = discoveries.find((item) => item.installation.providerId === 'github') ?? null;
    if (discovery.value?.installation.error) localError.value = discovery.value.installation.error;
  } catch (error) {
    localError.value = messageOf(error);
  } finally {
    discovering.value = false;
  }
}

async function connect() {
  if (!tokenDraft.value.trim()) return;
  busy.value = true;
  localError.value = null;
  status.value = null;
  try {
    const state = await api.setVcsCredential('github', tokenDraft.value);
    tokenDraft.value = '';
    status.value = state.configured ? t('issues.credentialStored') : t('issues.credentialMissing');
    await discover();
  } catch (error) {
    localError.value = messageOf(error);
  } finally {
    busy.value = false;
  }
}

async function disconnect() {
  busy.value = true;
  localError.value = null;
  try {
    await api.setVcsCredential('github', null);
    tokenDraft.value = '';
    status.value = t('issues.credentialCleared');
    await discover();
  } catch (error) {
    localError.value = messageOf(error);
  } finally {
    busy.value = false;
  }
}

/**
 * Links the project to the repository of its Git remote. Only the derived host and path
 * are stored; a remote URL that embeds a credential is reduced to those fields.
 */
async function linkFromRemote() {
  if (!project.value) return;
  busy.value = true;
  localError.value = null;
  status.value = null;
  try {
    const detection = await api.gitRemote(project.value);
    if (!detection.link) {
      localError.value = detection.error ?? t('issues.remoteUnsupported');
      return;
    }
    const index = store.snapshot.projects.findIndex((item) => item.id === project.value?.id);
    if (index >= 0) {
      store.snapshot.projects[index] = { ...store.snapshot.projects[index], repository: detection.link };
      await persist('projects', store.snapshot.projects);
    }
    status.value = t('issues.linked', { repository: `${detection.link.owner}/${detection.link.name}` });
  } catch (error) {
    localError.value = messageOf(error);
  } finally {
    busy.value = false;
  }
}

async function unlinkRepository() {
  if (!project.value) return;
  const index = store.snapshot.projects.findIndex((item) => item.id === project.value?.id);
  if (index < 0) return;
  store.snapshot.projects[index] = { ...store.snapshot.projects[index], repository: null };
  await persist('projects', store.snapshot.projects);
  issues.value = [];
  status.value = t('issues.unlinked');
}

async function loadInstructions() {
  if (!project.value) {
    instructionText.value = '';
    return;
  }
  try {
    const files = await api.listInstructions(project.value);
    const projectFile = files.find((item) => item.scope === 'project');
    instructionText.value = projectFile ? await api.readInstruction(project.value, projectFile.relativePath, null) : '';
  } catch {
    instructionText.value = '';
  }
}

async function loadIssues() {
  if (!project.value || !link.value) {
    issues.value = [];
    return;
  }
  issuesLoading.value = true;
  localError.value = null;
  try {
    const result = await api.listRepositoryIssues(project.value, { state: stateFilter.value });
    issues.value = result.issues;
    if (result.error) localError.value = result.error;
  } catch (error) {
    localError.value = messageOf(error);
    issues.value = [];
  } finally {
    issuesLoading.value = false;
  }
}

async function analyzeCurrentProject() {
  const targetProject = project.value;
  const targetLink = link.value;
  if (!targetProject || !targetLink) {
    analysisError.value = t('issues.noRepository');
    return;
  }
  if (!analysisReady.value) {
    analysisError.value = analysisStatus.value;
    return;
  }
  analysisBusy.value = true;
  analysisError.value = null;
  analysisOutput.value = '';
  analysisPrompt.value = '';
  analysisExecutionId.value = null;
  analysisJobId.value = null;
  analysisProposals.value = [];
  selectedProposalIds.value = [];
  createdIssues.value = [];
  creationErrors.value = [];
  try {
    const context = await readAuditContext(targetProject);
    const composed = composeIssueAuditPrompt({ project: targetProject, link: targetLink, ...context });
    analysisPrompt.value = composed.text;
    const jobId = `issue-analysis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    analysisJobId.value = jobId;
    const guardrails = activeGuardrails();
    addPromptJob({
      id: jobId,
      projectId: targetProject.id,
      historyEntryId: null,
      task: composed.title,
      state: 'queued',
      executionId: null,
      command: null,
      output: [],
      exitCode: null,
      providerId: analysisProviderId.value,
      modelId: analysisModelId.value,
      purpose: 'issue-analysis',
    });
    const result = await api.startProcess({
      jobId,
      projectId: targetProject.id,
      task: composed.title,
      purpose: 'issue-analysis',
      providerId: analysisProviderId.value,
      modelId: analysisModelId.value,
      prompt: composed.text,
      projectPath: targetProject.path,
      variant: analysisVariant.value,
      guardrailProfile: guardrails,
      guardrailProfileId: guardrails?.id ?? null,
    });
    analysisExecutionId.value = result.executionId;
    registerPromptJobExecution(jobId, result.executionId);
  } catch (error) {
    analysisBusy.value = false;
    analysisError.value = messageOf(error);
  }
}

function handleAnalysisEvent(event: { executionId: string; jobId?: string; kind: string; text?: string }) {
  if (!analysisBusy.value) return;
  if (analysisJobId.value && event.jobId && event.jobId !== analysisJobId.value) return;
  // A queued process event can arrive before startProcess resolves with the ID. The
  // event itself is the authoritative ID for this analysis run.
  if (!analysisExecutionId.value) analysisExecutionId.value = event.executionId;
  if (event.executionId !== analysisExecutionId.value) return;
  if (event.kind === 'stdout' || event.kind === 'stderr') {
    const nextOutput = `${analysisOutput.value}${(event.text ?? '').replace(ansiEscapePattern, '')}`;
    analysisOutput.value = nextOutput.length > maxAnalysisOutputChars
      ? `${nextOutput.slice(0, maxAnalysisOutputChars)}\n[AgentSmith truncated further analysis output.]`
      : nextOutput;
  }
  if (event.kind === 'completed') {
    analysisBusy.value = false;
    analysisExecutionId.value = null;
    analysisJobId.value = null;
    const parsed = parseIssueProposals(analysisOutput.value);
    analysisProposals.value = parsed.proposals;
    selectedProposalIds.value = parsed.proposals.map((proposal) => proposal.id);
    analysisError.value = parsed.error;
    if (parsed.proposals.length) status.value = t('issues.analysisReady', { count: parsed.proposals.length });
  }
  if (event.kind === 'failed' || event.kind === 'cancelled') {
    analysisBusy.value = false;
    analysisExecutionId.value = null;
    analysisJobId.value = null;
    analysisError.value = event.text ?? t('issues.analysisFailed');
  }
}

async function cancelAnalysis() {
  if (!analysisExecutionId.value) return;
  try {
    await api.cancelProcess(analysisExecutionId.value);
  } catch (error) {
    analysisError.value = messageOf(error);
  }
}

async function createSelectedIssues() {
  const targetProject = project.value;
  if (!targetProject || !canWrite.value) {
    analysisError.value = t('issues.credentialRequired');
    return;
  }
  const selected = analysisProposals.value.filter((proposal) => selectedProposalIds.value.includes(proposal.id));
  if (!selected.length) {
    analysisError.value = t('issues.selectProposal');
    return;
  }
  creatingProposals.value = true;
  analysisError.value = null;
  creationErrors.value = [];
  createdIssues.value = [];
  const createdProposalIds = new Set<string>();
  try {
    for (const proposal of selected) {
      try {
        const result = await api.createRepositoryIssue(targetProject, {
          title: proposal.title,
          body: proposal.body,
          labels: proposal.labels,
        });
        if (result.ok && result.issue) {
          createdIssues.value.push(result.issue);
          createdProposalIds.add(proposal.id);
        }
        else creationErrors.value.push(result.error ?? t('issues.saveFailed'));
      } catch (error) {
        creationErrors.value.push(messageOf(error));
      }
    }
    selectedProposalIds.value = selected.filter((proposal) => !createdProposalIds.has(proposal.id)).map((proposal) => proposal.id);
    if (createdIssues.value.length) {
      status.value = t('issues.batchCreated', { count: createdIssues.value.length });
      await loadIssues();
    }
    if (creationErrors.value.length) {
      analysisError.value = t('issues.batchCreatePartial', { count: creationErrors.value.length });
    }
  } finally {
    creatingProposals.value = false;
  }
}

function openNewIssue() {
  draft.value = { title: '', body: '', labels: [] };
  selectedIssue.value = null;
  draftError.value = null;
  draftOpen.value = true;
}

function openExistingIssue(issue: RepositoryIssue) {
  draft.value = { title: issue.title, body: issue.body, labels: [...issue.labels] };
  selectedIssue.value = issue;
  draftError.value = null;
  draftOpen.value = true;
}

function closeDraft() {
  draftOpen.value = false;
  draftError.value = null;
}

async function saveIssue() {
  if (!project.value) return;
  draftError.value = null;
  if (!draft.value.title.trim()) {
    draftError.value = t('issues.titleRequired');
    return;
  }
  busy.value = true;
  try {
    const result = selectedIssue.value
      ? await api.updateRepositoryIssue(project.value, selectedIssue.value.number, { title: draft.value.title, body: draft.value.body, labels: draft.value.labels })
      : await api.createRepositoryIssue(project.value, draft.value);
    if (!result.ok || !result.issue) {
      draftError.value = result.error ?? t('issues.saveFailed');
      return;
    }
    status.value = selectedIssue.value ? t('issues.updated', { number: result.issue.number }) : t('issues.created', { number: result.issue.number });
    closeDraft();
    await loadIssues();
  } catch (error) {
    draftError.value = messageOf(error);
  } finally {
    busy.value = false;
  }
}

async function setIssueState(issue: RepositoryIssue, state: 'open' | 'closed') {
  if (!project.value || issue.state === state) return;
  busy.value = true;
  localError.value = null;
  try {
    const result = await api.updateRepositoryIssue(project.value, issue.number, { state });
    if (!result.ok) localError.value = result.error ?? t('issues.saveFailed');
    else status.value = t(state === 'closed' ? 'issues.closed' : 'issues.reopened', { number: issue.number });
    await loadIssues();
    if (selectedIssue.value?.number === issue.number) selectedIssue.value = issues.value.find((item) => item.number === issue.number) ?? selectedIssue.value;
  } catch (error) {
    localError.value = messageOf(error);
  } finally {
    busy.value = false;
  }
}

/** Turns an issue into an execution-ready task and hands it to Prompt Studio. */
function generatePrompt(issue: RepositoryIssue | null) {
  if (!issue) return;
  if (!link.value) {
    localError.value = t('issues.noRepository');
    return;
  }
  const composed = composeIssuePrompt({ link: link.value, issue, capabilities: capabilities.value });
  handoffIssuePrompt({ title: composed.title, text: composed.text, issueNumber: issue.number, repository: `${link.value.owner}/${link.value.name}` });
}

function branchFor(issue: RepositoryIssue) {
  return issueBranchName(issue);
}

watch(project, async () => {
  selectedIssue.value = null;
  draftOpen.value = false;
  status.value = null;
  localError.value = null;
  analysisError.value = null;
  analysisOutput.value = '';
  analysisPrompt.value = '';
  analysisExecutionId.value = null;
  analysisJobId.value = null;
  analysisProposals.value = [];
  selectedProposalIds.value = [];
  createdIssues.value = [];
  creationErrors.value = [];
  issues.value = [];
  await loadInstructions();
  await loadIssues();
});
watch(stateFilter, () => { void loadIssues(); });

let removeProcessListener: (() => void) | null = null;
onMounted(async () => {
  if (typeof api.onProcessEvent === 'function') removeProcessListener = api.onProcessEvent(handleAnalysisEvent);
  await Promise.all([discover(), loadInstructions(), loadIssues(), loadAnalysisProviders()]);
});
onUnmounted(() => removeProcessListener?.());
</script>

<template>
  <div class="issues-page">
    <div class="page-heading"><div><span class="eyebrow">{{ t('issues.eyebrow') }}</span><h1>{{ t('issues.title') }}</h1><p class="lead">{{ t('issues.intro') }}</p></div><div class="heading-actions"><button class="secondary-button" type="button" :disabled="!link || !analysisReady || analysisBusy || busy" @click="analyzeCurrentProject">{{ analysisBusy ? t('issues.analyzing') : t('issues.analyzeProject') }} <span v-if="!analysisBusy">⌁</span></button><button class="primary-button" type="button" :disabled="!canWrite || busy" @click="openNewIssue">{{ t('issues.newIssue') }} <span>+</span></button></div></div>

    <div v-if="localError" class="inline-error" role="alert">{{ localError }}</div>
    <div v-if="status" class="global-alert" role="status">{{ status }}</div>

    <div v-if="!project" class="empty-state"><span class="empty-mark">⌘</span><strong>{{ t('issues.noProject') }}</strong><button class="secondary-button" type="button" @click="store.activeView = 'projects'">{{ t('nav.projects') }}</button></div>

    <template v-else>
      <div class="issues-connection-grid">
        <section class="prompt-card">
          <div class="prompt-card-heading"><span class="eyebrow">{{ t('issues.repository') }}</span><span class="mono">{{ link ? 'LINKED' : 'UNLINKED' }}</span></div>
          <template v-if="link">
            <strong>{{ link.owner }}/{{ link.name }}</strong>
            <span class="mono prompt-path">{{ link.host }} · {{ t('issues.defaultBranch') }} {{ link.defaultBranch }}</span>
            <div class="task-footer-actions"><button class="secondary-button" type="button" :disabled="busy" @click="loadIssues">{{ t('issues.refresh') }}</button><button class="quiet-button" type="button" :disabled="busy" @click="unlinkRepository">{{ t('issues.unlink') }}</button></div>
          </template>
          <template v-else>
            <p class="muted-copy">{{ t('issues.noRepository') }}</p>
            <div class="task-footer-actions"><button class="secondary-button" type="button" :disabled="busy" @click="linkFromRemote">{{ t('issues.linkFromRemote') }}</button></div>
          </template>
        </section>

        <section class="prompt-card">
          <div class="prompt-card-heading"><span class="eyebrow">{{ t('issues.credential') }}</span><span class="mono">{{ credentialState?.configured ? credentialState.source.toUpperCase() : 'NONE' }}</span></div>
          <p class="muted-copy">{{ t('issues.credentialDetail') }}</p>
          <label class="form-field"><span>{{ t('issues.token') }}</span><input v-model="tokenDraft" type="password" autocomplete="off" :placeholder="t('issues.tokenPlaceholder')" :disabled="busy"></label>
          <div class="task-footer-actions"><button class="secondary-button" type="button" :disabled="busy || !tokenDraft.trim()" @click="connect">{{ t('issues.connect') }}</button><button class="quiet-button" type="button" :disabled="busy || credentialState?.source !== 'session'" @click="disconnect">{{ t('issues.clearCredential') }}</button><button class="quiet-button" type="button" :disabled="discovering" @click="discover"><span v-if="discovering" class="loading-pulse"></span>{{ t('issues.verify') }}</button></div>
          <p v-if="discovery?.note" class="muted-copy">{{ discovery.note }}</p>
          <p class="muted-copy">{{ t('issues.tokenPermissions') }}</p>
          <p v-if="connected" class="toolbar-status"><span class="status-dot"></span>{{ t('issues.connectedAs', { account: discovery?.installation.account ?? '' }) }}</p>
        </section>

        <section class="prompt-card">
          <div class="prompt-card-heading"><span class="eyebrow">{{ t('issues.agentPermissions') }}</span><span class="mono">{{ capabilities.source === 'agents-md' ? 'AGENTS.md' : 'DEFAULT' }}</span></div>
          <div class="capability-list">
            <div class="capability-row"><span>{{ t('issues.capabilityIssues') }}</span><span :class="capabilities.issues ? 'cap-yes' : 'cap-no'">{{ capabilities.issues ? '✓' : '—' }} {{ capabilities.issues ? t('issues.allowed') : t('issues.denied') }}</span></div>
            <div class="capability-row"><span>{{ t('issues.capabilityBranches') }}</span><span :class="capabilities.branches ? 'cap-yes' : 'cap-no'">{{ capabilities.branches ? '✓' : '—' }} {{ capabilities.branches ? t('issues.allowed') : t('issues.denied') }}</span></div>
            <div class="capability-row"><span>{{ t('issues.capabilityPullRequests') }}</span><span :class="capabilities.pullRequests ? 'cap-yes' : 'cap-no'">{{ capabilities.pullRequests ? '✓' : '—' }} {{ capabilities.pullRequests ? t('issues.allowed') : t('issues.denied') }}</span></div>
            <div class="capability-row"><span>{{ t('issues.capabilityMerges') }}</span><span class="cap-no">— {{ t('issues.alwaysDenied') }}</span></div>
          </div>
          <p class="muted-copy">{{ t('issues.permissionsDetail') }}</p>
          <p v-if="capabilities.mergeRequestDenied" class="toolbar-status"><span class="status-dot"></span>{{ t('issues.mergeRequestRefused') }}</p>
        </section>
      </div>

      <section v-if="link" class="issues-analysis-panel">
        <div class="prompt-card-heading"><div><span class="eyebrow">{{ t('issues.analysisEyebrow') }}</span><p>{{ t('issues.analysisDetail') }}</p></div><span class="mono">{{ analysisProviderId }}</span></div>
        <div class="issues-analysis-toolbar">
          <label class="form-field"><span>{{ t('issues.analysisProvider') }}</span><select v-model="analysisProviderId" :disabled="analysisBusy || creatingProposals"><option v-for="provider in analysisProviders" :key="provider.installation.providerId" :value="provider.installation.providerId">{{ provider.installation.providerId }}</option></select></label>
          <div class="issues-analysis-status"><span class="eyebrow">{{ t('issues.analysisStatus') }}</span><span class="mono">{{ analysisStatus }}</span></div>
          <div class="task-footer-actions"><button v-if="analysisBusy" class="quiet-button" type="button" @click="cancelAnalysis">{{ t('issues.cancelAnalysis') }}</button><button v-else class="secondary-button" type="button" :disabled="!analysisReady || creatingProposals" @click="analyzeCurrentProject">{{ t('issues.analyzeProject') }} <span>⌁</span></button></div>
        </div>
        <p v-if="analysisProvider?.note" class="muted-copy">{{ analysisProvider.note }}</p>
        <p v-if="analysisError" class="inline-error" role="alert">{{ analysisError }}</p>
        <div v-if="analysisBusy" class="suggestion-progress"><span class="loading-pulse"></span><span>{{ t('issues.analyzing') }}</span></div>
        <template v-if="analysisProposals.length">
          <div class="issues-proposal-header"><span class="eyebrow">{{ t('issues.proposals') }}</span><span class="mono">{{ selectedProposalCount }}/{{ analysisProposals.length }}</span></div>
          <div class="issues-proposal-list">
            <label v-for="proposal in analysisProposals" :key="proposal.id" class="issues-proposal-item"><input v-model="selectedProposalIds" type="checkbox" :value="proposal.id" :disabled="creatingProposals"><span><strong>{{ proposal.title }}</strong><small>{{ proposal.body }}</small><span v-if="proposal.labels.length" class="model-tags"><span v-for="label in proposal.labels" :key="label" class="model-tag">{{ label }}</span></span></span></label>
          </div>
          <div class="issues-analysis-actions"><span class="muted-copy">{{ canWrite ? t('issues.createDetail') : t('issues.credentialRequired') }}</span><button class="primary-button" type="button" :disabled="creatingProposals || !selectedProposalCount || !canWrite" @click="createSelectedIssues">{{ creatingProposals ? t('issues.creating') : t('issues.createSelected', { count: selectedProposalCount }) }} <span>↗</span></button></div>
        </template>
        <div v-if="createdIssues.length" class="issues-created-list"><span class="eyebrow">{{ t('issues.createdList') }}</span><span v-for="issue in createdIssues" :key="issue.number" class="mono">#{{ issue.number }} {{ issue.title }}</span></div>
        <div v-if="creationErrors.length" class="issues-creation-errors" role="alert"><span v-for="(error, index) in creationErrors" :key="`${index}-${error}`">{{ error }}</span></div>
        <details v-if="analysisPrompt" class="suggestion-source"><summary>{{ t('issues.viewAnalysisPrompt') }}</summary><pre class="suggestion-text">{{ analysisPrompt }}</pre></details>
        <details v-if="analysisOutput && !analysisBusy" class="suggestion-source"><summary>{{ t('issues.viewAnalysisOutput') }}</summary><pre class="suggestion-text">{{ analysisOutput }}</pre></details>
      </section>

      <section class="issues-list-panel">
        <div class="prompt-card-heading"><div><span class="eyebrow">{{ t('issues.listTitle') }}</span><p>{{ t('issues.listDetail', { open: openCount, total: issues.length }) }}</p></div><div class="task-footer-actions"><select v-model="stateFilter" :aria-label="t('issues.stateFilter')"><option value="open">{{ t('issues.stateOpen') }}</option><option value="closed">{{ t('issues.stateClosed') }}</option><option value="all">{{ t('issues.stateAll') }}</option></select><span v-if="issuesLoading" class="toolbar-status"><span class="loading-pulse"></span>{{ t('common.loading') }}</span></div></div>

        <div v-if="issues.length" class="resource-list-panel">
          <button v-for="issue in issues" :key="issue.number" class="resource-list-item issues-list-item" :class="{ selected: selectedIssue?.number === issue.number }" type="button" @click="openExistingIssue(issue)">
            <span class="resource-status" :class="issue.state === 'open' ? 'on' : ''"></span>
            <span><strong>#{{ issue.number }} {{ issue.title }}</strong><small>{{ issue.author }} · {{ branchFor(issue) }} · <span class="mono">#{{ issue.comments }}</span></small></span>
            <span v-if="issue.labels.length" class="model-tags"><span v-for="label in issue.labels" :key="label" class="model-tag">{{ label }}</span></span>
          </button>
        </div>
        <div v-else class="empty-state compact-empty"><span class="empty-mark">#</span><strong>{{ t('issues.empty') }}</strong></div>

        <div v-if="draftOpen" class="resource-editor-panel issues-editor">
          <div class="resource-editor-header"><div><span class="eyebrow">{{ selectedIssue ? t('issues.editIssue', { number: selectedIssue.number }) : t('issues.newIssue') }}</span><strong>{{ draft.title || t('issues.untitled') }}</strong></div><span class="mono">#{{ selectedIssue?.number ?? 'NEW' }}</span></div>
          <p v-if="draftError" class="inline-error" role="alert">{{ draftError }}</p>
          <label class="form-field"><span>{{ t('issues.title') }}</span><input v-model="draft.title" type="text" :placeholder="t('issues.titlePlaceholder')"></label>
          <label class="form-field"><span>{{ t('issues.description') }}</span><textarea v-model="draft.body" rows="9" :placeholder="t('issues.descriptionPlaceholder')"></textarea></label>
          <label class="form-field"><span>{{ t('issues.labels') }}</span><input v-model="labelsText" type="text" :placeholder="t('issues.labelsPlaceholder')"></label>
          <div class="modal-actions"><button class="secondary-button" type="button" @click="closeDraft">{{ t('prompt.cancel') }}</button><button class="primary-button" type="button" :disabled="busy" @click="saveIssue">{{ t('issues.save') }} <span>✓</span></button></div>
        </div>
      </section>

      <section v-if="selectedIssue" class="issues-actions-panel">
        <div class="prompt-card-heading"><div><span class="eyebrow">{{ t('issues.nextSteps') }}</span><p>{{ t('issues.nextStepsDetail') }}</p></div></div>
        <div class="task-footer-actions">
          <button class="primary-button" type="button" :disabled="!link" @click="generatePrompt(selectedIssue)">{{ t('issues.generatePrompt') }} <span>↗</span></button>
          <button class="secondary-button" type="button" :disabled="busy || selectedIssue.state === 'closed'" @click="setIssueState(selectedIssue, 'closed')">{{ t('issues.closeIssue') }}</button>
          <button class="secondary-button" type="button" :disabled="busy || selectedIssue.state === 'open'" @click="setIssueState(selectedIssue, 'open')">{{ t('issues.reopenIssue') }}</button>
        </div>
        <p class="muted-copy">{{ t('issues.noMergeAction') }}</p>
      </section>
    </template>
  </div>
</template>
