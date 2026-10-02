<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { AppSnapshot, ViewId } from '@/shared/types';
import DashboardPage from './pages/DashboardPage.vue';
import AgentProfilesPage from './pages/AgentProfilesPage.vue';
import PersonalizationPage from './pages/PersonalizationPage.vue';
import PromptStudioPage from './pages/PromptStudioPage.vue';
import ProjectsPage from './pages/ProjectsPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import { initializeStore, persist, selectedProject, store } from './services/store';

const { t, locale } = useI18n();
const error = ref<string | null>(null);
const appSnapshot = computed(() => store.snapshot as AppSnapshot);
const project = computed(selectedProject);

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

function selectView(view: ViewId) {
  store.activeView = view;
}

onMounted(load);
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
        <button class="quiet-button" type="button" @click="selectView('projects')"><span aria-hidden="true">+</span> {{ t('shell.openProject') }}</button>
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
        <div class="topbar-actions"><button class="icon-button" type="button" :aria-label="t('shell.theme')" :title="t('shell.theme')" @click="setTheme">{{ appSnapshot.config.theme === 'dark' ? '☼' : '☾' }}</button><button class="avatar-button" type="button" @click="selectView('settings')">AS</button></div>
      </header>

      <div v-if="error" class="global-alert" role="alert">{{ error }}</div>
      <div v-if="appSnapshot.warnings.length" class="global-alert warning" role="status">{{ appSnapshot.warnings[0] }}</div>

      <section class="page-frame">
        <DashboardPage v-if="store.activeView === 'dashboard'" @navigate="selectView" />
        <ProjectsPage v-else-if="store.activeView === 'projects'" />
        <PromptStudioPage v-else-if="store.activeView === 'prompt-studio'" />
        <AgentProfilesPage v-else-if="store.activeView === 'agent-profiles'" />
        <PersonalizationPage v-else-if="store.activeView === 'personalization'" />
        <SettingsPage v-else-if="store.activeView === 'settings'" />
        <div v-else class="foundation-page"><span class="eyebrow">{{ navigation.find((item) => item.id === store.activeView)?.label }}</span><h1>{{ t('foundation.unavailableTitle') }}</h1><p class="lead">{{ t('foundation.unavailableDetail') }}</p><button class="primary-button" type="button" @click="selectView('dashboard')">{{ t('common.back') }}</button></div>
      </section>
    </main>
  </div>
</template>
