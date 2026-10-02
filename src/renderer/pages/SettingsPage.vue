<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { persist, store } from '../services/store';

const { t } = useI18n();
const warnings = computed(() => store.snapshot?.warnings ?? []);

async function updateTheme() {
  if (!store.snapshot) return;
  document.documentElement.dataset.theme = store.snapshot.config.theme;
  await persist('config', store.snapshot.config);
}

async function toggleHidden() {
  if (!store.snapshot) return;
  store.snapshot.config.showHiddenFiles = !store.snapshot.config.showHiddenFiles;
  await persist('config', store.snapshot.config);
}
</script>

<template>
  <div class="settings-page">
    <div class="page-heading"><div><span class="eyebrow">{{ t('settings.eyebrow') }}</span><h1>{{ t('settings.title') }}</h1><p class="lead">{{ t('settings.intro') }}</p></div></div>
    <div class="settings-cards">
      <section class="settings-card"><div class="settings-card-heading"><span class="eyebrow">{{ t('settings.appearance') }}</span><span>◐</span></div><label class="form-field"><span>{{ t('settings.theme') }}</span><select v-if="store.snapshot" v-model="store.snapshot.config.theme" @change="updateTheme"><option value="dark">{{ t('settings.dark') }}</option><option value="light">{{ t('settings.light') }}</option></select></label><label class="form-field"><span>{{ t('settings.language') }}</span><select><option value="en">{{ t('settings.english') }}</option></select></label><label class="toggle-field settings-toggle"><input type="checkbox" :checked="store.snapshot?.config.showHiddenFiles" @change="toggleHidden"><span class="toggle-track"></span><span>{{ t('workspace.toggleHidden') }}</span></label></section>
      <section class="settings-card"><div class="settings-card-heading"><span class="eyebrow">{{ t('settings.storage') }}</span><span>⌁</span></div><span class="settings-label">{{ t('settings.configRoot') }}</span><strong class="settings-path mono">{{ store.snapshot?.storageRoot }}</strong><p>{{ t('settings.storageDetail') }}</p><div class="storage-tree mono">config.json<br>projects.json<br><span>goals/</span><br><span>roles/</span><br><span>guardrails/</span><br><span>providers/</span></div></section>
      <section class="settings-card"><div class="settings-card-heading"><span class="eyebrow">{{ t('settings.diagnostics') }}</span><span>!</span></div><p>{{ t('settings.diagnosticsDetail') }}</p><span class="settings-label">{{ t('settings.warnings') }}</span><div v-if="warnings.length" class="warning-list"><span v-for="warning in warnings" :key="warning">{{ warning }}</span></div><strong v-else class="healthy-state"><span class="signal-dot"></span>{{ t('settings.noWarnings') }}</strong></section>
      <section class="settings-card security-card"><div class="settings-card-heading"><span class="eyebrow">{{ t('settings.security') }}</span><span>◇</span></div><p>{{ t('settings.securityDetail') }}</p><div class="security-lines"><span><b>01</b>{{ t('settings.securityReadOnly') }}</span><span><b>02</b>{{ t('settings.securityRootBound') }}</span><span><b>03</b>{{ t('settings.securityAllowlisted') }}</span></div></section>
    </div>
  </div>
</template>
