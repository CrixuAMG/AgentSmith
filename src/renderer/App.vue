<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { DEFAULT_CONFIG } from '@/shared/defaults';
import type { AppSnapshot, ViewId } from '@/shared/types';
import { api } from './services/api';

const { t } = useI18n();
const snapshot = ref<AppSnapshot | null>(null);
const activeView = ref<ViewId>('dashboard');
const error = ref<string | null>(null);
const appSnapshot = computed(() => snapshot.value as AppSnapshot);

const selectedProject = computed(() => {
  if (!snapshot.value?.config.lastProjectId) return null;
  return snapshot.value.projects.find((project) => project.id === snapshot.value?.config.lastProjectId) ?? null;
});

const navigation = computed(() => [
  { id: 'dashboard' as const, label: t('nav.dashboard'), icon: '⌂' },
  { id: 'projects' as const, label: t('nav.projects'), icon: '⌘' },
  { id: 'prompt-studio' as const, label: t('nav.promptStudio'), icon: '>' },
  { id: 'agent-profiles' as const, label: t('nav.agentProfiles'), icon: '◎' },
  { id: 'personalization' as const, label: t('nav.personalization'), icon: '✦' },
  { id: 'settings' as const, label: t('nav.settings'), icon: '⚙' },
]);

async function load() {
  try {
    snapshot.value = await api.loadSnapshot();
    document.documentElement.dataset.theme = snapshot.value.config.theme;
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : String(loadError);
    snapshot.value = {
      config: structuredClone(DEFAULT_CONFIG),
      projects: [],
      goals: [],
      roles: [],
      guardrails: [],
      profiles: [],
      providerSettings: [],
      globalInstructions: '',
      storageRoot: '~/.config/AgentSmith',
      warnings: [],
    };
  }
}

function setTheme() {
  if (!snapshot.value) return;
  snapshot.value.config.theme = snapshot.value.config.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = snapshot.value.config.theme;
  void api.saveResource('config', snapshot.value.config);
}

function selectView(view: ViewId) {
  activeView.value = view;
}

onMounted(load);
</script>

<template>
  <div v-if="!snapshot" class="boot-screen">
    <div class="boot-mark">AS</div>
    <span>{{ t('app.loading') }}</span>
  </div>

  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true"><span>01</span><span>10</span></div>
        <div>
          <strong>{{ t('app.name') }}</strong>
          <small>{{ t('shell.local') }}</small>
        </div>
      </div>

      <div class="sidebar-project">
        <span class="eyebrow">{{ t('shell.project') }}</span>
        <strong>{{ selectedProject?.name ?? t('shell.noProject') }}</strong>
        <span v-if="selectedProject" class="mono truncate">{{ selectedProject.path }}</span>
        <button class="quiet-button" type="button" @click="selectView('projects')">
          <span aria-hidden="true">+</span> {{ t('shell.openProject') }}
        </button>
      </div>

      <nav class="primary-nav" :aria-label="t('nav.workspace')">
        <span class="eyebrow nav-label">{{ t('nav.workspace') }}</span>
        <button
          v-for="item in navigation"
          :key="item.id"
          class="nav-item"
          :class="{ active: activeView === item.id }"
          type="button"
          @click="selectView(item.id)"
        >
          <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
          <span v-if="item.id === 'projects'" class="nav-count">{{ appSnapshot.projects.length }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="signal-line"><span class="signal-dot"></span> {{ t('dashboard.ready') }}</div>
        <span class="mono version-label">AGENTSMITH / 0.1.0</span>
      </div>
    </aside>

    <main class="main-column">
      <header class="topbar">
        <div class="breadcrumb">
          <span class="breadcrumb-root">AGENTSMITH</span>
          <span class="breadcrumb-slash">/</span>
          <span>{{ navigation.find((item) => item.id === activeView)?.label }}</span>
          <span v-if="selectedProject" class="breadcrumb-project"><span class="status-dot"></span>{{ selectedProject.name }}</span>
        </div>
        <div class="topbar-actions">
          <button class="icon-button" type="button" :aria-label="t('shell.theme')" :title="t('shell.theme')" @click="setTheme">
            {{ appSnapshot.config.theme === 'dark' ? '☼' : '☾' }}
          </button>
          <button class="avatar-button" type="button" @click="selectView('settings')">AS</button>
        </div>
      </header>

      <div v-if="error" class="global-alert" role="alert">{{ error }}</div>
      <div v-if="appSnapshot.warnings.length" class="global-alert warning" role="status">{{ appSnapshot.warnings[0] }}</div>

      <section class="page-frame">
        <div v-if="activeView === 'dashboard'" class="foundation-page">
          <span class="eyebrow">{{ t('dashboard.eyebrow') }}</span>
          <h1>{{ t('dashboard.title') }}</h1>
          <p class="lead">{{ t('dashboard.intro') }}</p>
          <div class="foundation-actions">
            <button class="primary-button" type="button" @click="selectView('prompt-studio')">{{ t('dashboard.newTask') }} <span>↗</span></button>
            <button class="secondary-button" type="button" @click="selectView('projects')">{{ t('dashboard.inspectProject') }}</button>
          </div>
          <div class="foundation-grid">
            <article class="metric-card">
              <span class="eyebrow">{{ t('dashboard.activeProject') }}</span>
              <strong>{{ selectedProject?.name ?? t('dashboard.noProjects') }}</strong>
              <span class="mono">{{ selectedProject?.path ?? t('dashboard.readyDetail') }}</span>
            </article>
            <article class="metric-card">
              <span class="eyebrow">{{ t('dashboard.profile') }}</span>
              <strong>{{ appSnapshot.profiles.find((profile) => profile.id === appSnapshot.config.activeProfileId)?.name ?? t('common.none') }}</strong>
              <span class="mono">{{ appSnapshot.goals.filter((goal) => goal.enabled).length }} {{ t('dashboard.goals').toLowerCase() }}</span>
            </article>
            <article class="metric-card accent-card">
              <span class="eyebrow">{{ t('dashboard.guardrails') }}</span>
              <strong>{{ appSnapshot.guardrails.length }} {{ t('nav.guardrails').toLowerCase() }}</strong>
              <span class="mono">{{ t('dashboard.instructions') }} {{ appSnapshot.globalInstructions ? 'linked' : 'not configured' }}</span>
            </article>
          </div>
        </div>
        <div v-else class="foundation-page">
          <span class="eyebrow">{{ navigation.find((item) => item.id === activeView)?.label }}</span>
          <h1>{{ t('foundation.unavailableTitle') }}</h1>
          <p class="lead">{{ t('foundation.unavailableDetail') }}</p>
          <button class="primary-button" type="button" @click="selectView('dashboard')">{{ t('common.back') }}</button>
        </div>
      </section>
    </main>
  </div>
</template>
