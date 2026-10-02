<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { persist, selectProject, selectedProject, store } from '../services/store';

const emit = defineEmits<{ navigate: [view: 'projects' | 'prompt-studio'] }>();
const { t } = useI18n();
const project = computed(selectedProject);
const activeProfile = computed(() => store.snapshot?.profiles.find((profile) => profile.id === store.snapshot?.config.activeProfileId) ?? null);
const enabledGoals = computed(() => store.snapshot?.goals.filter((goal) => goal.enabled).length ?? 0);
const activeGuardrail = computed(() => {
  const profile = activeProfile.value;
  return store.snapshot?.guardrails.find((guardrail) => guardrail.id === profile?.guardrailProfileId) ?? null;
});
const recentProjects = computed(() => [...(store.snapshot?.projects ?? [])].sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt)).slice(0, 4));

async function openProject(projectId: string) {
  const candidate = store.snapshot?.projects.find((item) => item.id === projectId);
  if (candidate) {
    candidate.lastOpenedAt = new Date().toISOString();
    await persist('projects', store.snapshot!.projects);
  }
  await selectProject(projectId);
  emit('navigate', 'projects');
}

function addProject() {
  store.pendingProjectPicker = true;
  emit('navigate', 'projects');
}
</script>

<template>
  <div class="dashboard-page">
    <div class="page-heading dashboard-heading">
      <div>
        <span class="eyebrow">{{ t('dashboard.eyebrow') }}</span>
        <h1>{{ t('dashboard.title') }}</h1>
        <p class="lead">{{ t('dashboard.intro') }}</p>
      </div>
      <div class="heading-actions">
        <button class="secondary-button" type="button" @click="emit('navigate', 'projects')">{{ t('dashboard.inspectProject') }}</button>
        <button class="primary-button" type="button" @click="emit('navigate', 'prompt-studio')">{{ t('dashboard.newTask') }} <span>↗</span></button>
      </div>
    </div>

    <div class="dashboard-grid">
      <article class="dashboard-panel active-project-panel">
        <div class="panel-kicker"><span class="signal-dot"></span>{{ t('dashboard.activeProject') }}</div>
        <div v-if="project" class="active-project-copy">
          <h2>{{ project.name }}</h2>
          <span class="mono project-path">{{ project.path }}</span>
          <button class="text-button" type="button" @click="emit('navigate', 'projects')">{{ t('dashboard.inspectProject') }} <span>→</span></button>
        </div>
        <div v-else class="empty-card-copy">
          <h2>{{ t('dashboard.noProjects') }}</h2>
          <p>{{ t('dashboard.readyDetail') }}</p>
          <button class="text-button" type="button" @click="addProject">{{ t('dashboard.addFirst') }} <span>→</span></button>
        </div>
      </article>
      <article class="dashboard-panel profile-panel">
        <div class="panel-kicker">{{ t('dashboard.profile') }}</div>
        <h2>{{ activeProfile?.name ?? t('common.none') }}</h2>
        <div class="profile-meta"><span class="status-pill">{{ activeProfile?.providerId ?? t('common.unavailable') }}</span><span class="mono">{{ enabledGoals }} {{ t('dashboard.goals').toLowerCase() }}</span></div>
      </article>
      <article class="dashboard-panel guardrail-panel">
        <div class="panel-kicker">{{ t('dashboard.guardrails') }}</div>
        <h2>{{ activeGuardrail?.name ?? t('common.none') }}</h2>
        <p>{{ activeGuardrail?.description ?? t('dashboard.readyDetail') }}</p>
        <span class="mono enforcement-note">{{ activeGuardrail?.rules.length ?? 0 }} {{ t('dashboard.rules').toLowerCase() }}</span>
      </article>
    </div>

    <section class="recent-section">
      <div class="section-heading"><div><span class="eyebrow">{{ t('dashboard.recentLabel') }}</span><h2>{{ t('dashboard.recentProjects') }}</h2></div><span class="mono">{{ recentProjects.length.toString().padStart(2, '0') }} / {{ (store.snapshot?.projects.length ?? 0).toString().padStart(2, '0') }}</span></div>
      <div v-if="recentProjects.length" class="recent-list">
        <button v-for="item in recentProjects" :key="item.id" class="recent-item" type="button" @click="openProject(item.id)">
          <span class="recent-icon">↗</span><span class="recent-name"><strong>{{ item.name }}</strong><small class="mono">{{ item.path }}</small></span><span class="recent-date mono">{{ new Date(item.lastOpenedAt).toLocaleDateString() }}</span><span class="recent-arrow">→</span>
        </button>
      </div>
      <div v-else class="empty-state compact-empty"><span class="empty-mark">//</span><strong>{{ t('dashboard.noProjects') }}</strong><span>{{ t('dashboard.readyDetail') }}</span></div>
    </section>

    <section class="dashboard-footer-strip">
      <div><span class="eyebrow">{{ t('dashboard.instructions') }}</span><strong>{{ store.snapshot?.globalInstructions ? t('dashboard.linked') : t('dashboard.notConfigured') }}</strong></div>
      <div><span class="eyebrow">{{ t('dashboard.storage') }}</span><strong class="mono">{{ store.snapshot?.storageRoot }}</strong></div>
      <div><span class="eyebrow">{{ t('dashboard.mode') }}</span><strong>{{ t('dashboard.localFirst') }}</strong></div>
    </section>
  </div>
</template>
