<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { AppSnapshot, ViewId } from '@/shared/types';
import DashboardPage from './pages/DashboardPage.vue';
import AgentProfilesPage from './pages/AgentProfilesPage.vue';
import PersonalizationPage from './pages/PersonalizationPage.vue';
import PromptStudioPage from './pages/PromptStudioPage.vue';
import PromptJobPage from './pages/PromptJobPage.vue';
import ProjectsPage from './pages/ProjectsPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import CommandPalette from './components/CommandPalette.vue';
import { PALETTE_EVENTS, type PaletteCommand } from './services/command-palette';
import { initializeStore, persist, selectedProject, store } from './services/store';
import { resetLayout, selectWorkspaceTab } from './services/store';
import PermissionGrantModal from './components/Permissions/PermissionGrantModal.vue';
import { pendingPermRequest } from './services/permissions';
import { api } from './services/api';

const { t, locale } = useI18n();
const error = ref<string | null>(null);
const appSnapshot = computed(() => store.snapshot as AppSnapshot);
const project = computed(selectedProject);
const paletteOpen = ref(false);
const paletteInvoker = ref<HTMLElement | null>(null);

const navigation = computed(() => [
  { id: 'dashboard' as const, label: t('nav.dashboard'), icon: '⌂' },
  { id: 'projects' as const, label: t('nav.projects'), icon: '⌘' },
  { id: 'prompt-studio' as const, label: t('nav.promptStudio'), icon: '>' },
  { id: 'prompt-job' as const, label: t('nav.promptJob'), icon: '◌' },
  { id: 'agent-profiles' as const, label: t('nav.agentProfiles'), icon: '◎' },
  { id: 'personalization' as const, label: t('nav.personalization'), icon: '✦' },
  { id: 'settings' as const, label: t('nav.settings'), icon: '⚙' },
]);

async function load() {
  try {
    await initializeStore();
    if (store.snapshot) {
      locale.value = store.snapshot.config.locale;
      document.documentElement.lang = locale.value;
    }
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : String(loadError);
  }
}

async function setTheme() {
  if (!store.snapshot) return;
  store.snapshot.config.theme = store.snapshot.config.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = store.snapshot.config.theme;
  await persist('config', store.snapshot.config);
}

const providerStatus = computed(() => {
  const discovery = store.providerDiscoveries.find((item) => item.installation.providerId === store.activeProviderId);
  if (!discovery?.installation.installed) return t('palette.providerUnavailable');
  if (discovery.executionSupported === false) return t('palette.providerUnsupported');
  return `${t('palette.providerReady')} · ${discovery.installation.version ?? t('common.verified')}`;
});

const providerReady = computed(() => {
  const discovery = store.providerDiscoveries.find((item) => item.installation.providerId === store.activeProviderId);
  return Boolean(discovery?.installation.installed && discovery.executionSupported !== false);
});

const paletteCommands = computed<PaletteCommand[]>(() => [
  ...navigation.value.map((item) => ({ id: `view-${item.id}`, label: item.label, keywords: `navigation ${item.id}`, action: { kind: 'view' as const, view: item.id } })),
  { id: 'project-picker', label: t('shell.openProject'), keywords: 'project select switch', shortcut: '⌘P', action: { kind: 'project-picker' as const } },
  { id: 'tab-explorer', label: t('workspace.explorer'), keywords: 'workspace tab files', action: { kind: 'workspace-tab' as const, tab: 'explorer' } },
  { id: 'tab-git', label: t('workspace.gitChanges'), keywords: 'workspace tab git', action: { kind: 'workspace-tab' as const, tab: 'git' } },
  { id: 'tab-commits', label: t('commits.title'), keywords: 'workspace tab commits history', action: { kind: 'workspace-tab' as const, tab: 'commits' } },
  { id: 'tab-instructions', label: t('workspace.instructions'), keywords: 'workspace tab agents', action: { kind: 'workspace-tab' as const, tab: 'instructions' } },
  { id: 'layout-reset', label: t('layout.reset'), keywords: 'layout panels restore', action: { kind: 'layout-reset' as const } },
  { id: 'refresh-project', label: t('palette.refreshProject'), keywords: 'project reload scan git', action: { kind: 'event' as const, name: PALETTE_EVENTS.refreshProject } },
  { id: 'refresh-providers', label: t('palette.refreshProviders'), keywords: 'provider opencode codex discover', action: { kind: 'event' as const, name: PALETTE_EVENTS.refreshProviders } },
  { id: 'execute-prompt', label: t('palette.executePrompt'), keywords: 'prompt run execute provider', action: { kind: 'event' as const, name: PALETTE_EVENTS.executePrompt }, disabled: !providerReady.value },
  { id: 'cancel-job', label: t('palette.cancelJob'), keywords: 'job stop cancel process', action: { kind: 'event' as const, name: PALETTE_EVENTS.cancelJob }, disabled: !store.jobs.some((job) => ['queued', 'starting', 'running'].includes(job.state)) },
  { id: 'theme', label: t('palette.switchTheme'), keywords: 'theme dark light appearance', action: { kind: 'theme' as const } },
]);

function openPalette() {
  paletteInvoker.value = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  paletteOpen.value = true;
}
function closePalette() {
  paletteOpen.value = false;
  void nextTick(() => paletteInvoker.value?.focus());
}

async function executePaletteCommand(command: PaletteCommand) {
  if (command.disabled) return;
  const action = command.action;
  if (action.kind === 'view') selectView(action.view);
  if (action.kind === 'project-picker') openProjectPicker();
  if (action.kind === 'workspace-tab') { selectView('projects'); await selectWorkspaceTab(action.tab); }
  if (action.kind === 'layout-reset') await resetLayout();
  if (action.kind === 'theme') await setTheme();
  if (action.kind === 'event') {
    if (action.name === PALETTE_EVENTS.refreshProject || action.name === PALETTE_EVENTS.refreshProviders) selectView(action.name === PALETTE_EVENTS.refreshProject ? 'projects' : 'prompt-studio');
    if (action.name === PALETTE_EVENTS.executePrompt) selectView('prompt-studio');
    if (action.name === PALETTE_EVENTS.cancelJob) selectView('prompt-job');
    await nextTick();
    window.dispatchEvent(new Event(action.name));
  }
  closePalette();
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (paletteOpen.value) closePalette();
    else openPalette();
  } else if (event.key === 'Escape' && paletteOpen.value) {
    closePalette();
  }
}

function selectView(view: ViewId) {
  if (store.activeView === 'projects' && view !== 'projects' && store.instructionDirty) {
    if (!window.confirm(t('instructions.discardDraftConfirm'))) return;
    store.instructionDraft = store.instructionOriginalContent;
    store.instructionDirty = false;
  }
  store.activeView = view;
}

async function handlePermGrant(_res: { scope: 'global' | 'project' | 'once' | 'session' }) {
  if (!pendingPermRequest.value) return;
  const request = pendingPermRequest.value;
  const targetPath = request.path;
  try {
    await api.syncPermissions({ allowedExternalPaths: [targetPath] });
  } catch {
    // ignore
  }
  if (request.callback) {
    request.callback({ allowed: true, path: targetPath });
  }
  pendingPermRequest.value = null;
}

async function handlePermDeny() {
  if (!pendingPermRequest.value) return;
  const request = pendingPermRequest.value;
  if (request.callback) {
    request.callback({ allowed: false });
  }
  pendingPermRequest.value = null;
}

function openProjectPicker() {
  store.pendingProjectPicker = true;
  selectView('projects');
}

onMounted(() => { void load(); window.addEventListener('keydown', handleGlobalKeydown); });
onBeforeUnmount(() => window.removeEventListener('keydown', handleGlobalKeydown));
</script>

<template>
  <div v-if="!store.snapshot" class="boot-screen">
    <div class="boot-mark">AS</div>
    <span>{{ t('app.loading') }}</span>
  </div>

  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true"><span>01</span><span>10</span></div>
        <div><strong>{{ t('app.name') }}</strong><small>{{ t('shell.local') }}</small></div>
      </div>

      <div class="sidebar-project">
        <span class="eyebrow">{{ t('shell.project') }}</span>
        <strong>{{ project?.name ?? t('shell.noProject') }}</strong>
        <span v-if="project" class="mono truncate">{{ project.path }}</span>
        <button class="quiet-button" type="button" @click="openProjectPicker"><span aria-hidden="true">+</span> {{ t('shell.openProject') }}</button>
      </div>

      <nav class="primary-nav" :aria-label="t('nav.workspace')">
        <span class="eyebrow nav-label">{{ t('nav.workspace') }}</span>
        <button v-for="item in navigation" :key="item.id" class="nav-item" :class="{ active: store.activeView === item.id }" type="button" @click="selectView(item.id)">
          <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span><span>{{ item.label }}</span><span v-if="item.id === 'projects'" class="nav-count">{{ appSnapshot.projects.length }}</span>
        </button>
      </nav>

      <div class="sidebar-footer"><div class="signal-line"><span class="signal-dot"></span> {{ t('dashboard.ready') }}</div><span class="mono version-label">AGENTSMITH / 0.1.0</span></div>
    </aside>

    <main class="main-column">
      <header class="topbar">
        <div class="breadcrumb"><span class="breadcrumb-root">AGENTSMITH</span><span class="breadcrumb-slash">/</span><span>{{ navigation.find((item) => item.id === store.activeView)?.label }}</span><span v-if="project" class="breadcrumb-project"><span class="status-dot"></span>{{ project.name }}</span></div>
        <div class="topbar-actions"><button class="command-palette-trigger" type="button" @click="openPalette">{{ t('shell.commandPalette') }} <kbd>⌘K</kbd></button><button class="icon-button" type="button" :aria-label="t('shell.theme')" :title="t('shell.theme')" @click="setTheme">{{ appSnapshot.config.theme === 'dark' ? '☼' : '☾' }}</button><button class="avatar-button" type="button" @click="selectView('settings')">AS</button></div>
      </header>

      <div v-if="error" class="global-alert" role="alert">{{ error }}</div>
      <div v-if="appSnapshot.warnings.length" class="global-alert warning" role="status">{{ appSnapshot.warnings[0] }}</div>

      <section class="page-frame">
        <DashboardPage v-if="store.activeView === 'dashboard'" @navigate="selectView" />
        <ProjectsPage v-else-if="store.activeView === 'projects'" />
        <PromptStudioPage v-else-if="store.activeView === 'prompt-studio'" />
        <PromptJobPage v-else-if="store.activeView === 'prompt-job'" />
        <AgentProfilesPage v-else-if="store.activeView === 'agent-profiles'" />
        <PersonalizationPage v-else-if="store.activeView === 'personalization'" />
        <SettingsPage v-else-if="store.activeView === 'settings'" />
        <div v-else class="foundation-page"><span class="eyebrow">{{ navigation.find((item) => item.id === store.activeView)?.label }}</span><h1>{{ t('foundation.unavailableTitle') }}</h1><p class="lead">{{ t('foundation.unavailableDetail') }}</p><button class="primary-button" type="button" @click="selectView('dashboard')">{{ t('common.back') }}</button></div>
      </section>
    </main>
  </div>
  <CommandPalette :open="paletteOpen" :commands="paletteCommands" :provider-status="providerStatus" @close="closePalette" @execute="executePaletteCommand" />
  <PermissionGrantModal :open="!!pendingPermRequest" :request="pendingPermRequest" @grant="handlePermGrant" @deny="handlePermDeny" />
</template>
