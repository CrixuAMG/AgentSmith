<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { persist, store } from '../services/store';

const { t, locale } = useI18n();
const warnings = computed(() => store.snapshot?.warnings ?? []);
const globalDraft = ref(store.snapshot?.globalInstructions ?? '');
const globalSaved = ref(true);
const providerDrafts = ref<Record<string, string>>({ ...(store.snapshot?.providerInstructions ?? {}) });
const providerSaved = ref<Record<string, boolean>>({});
const globalSaving = ref(false);
const globalError = ref<string | null>(null);
const providerSaving = ref<Record<string, boolean>>({});
const providerErrors = ref<Record<string, string | null>>({});

async function updateTheme() {
  if (!store.snapshot) return;
  document.documentElement.dataset.theme = store.snapshot.config.theme;
  await persist('config', store.snapshot.config);
}

async function updateLocale() {
  if (!store.snapshot) return;
  store.snapshot.config.locale = locale.value;
  document.documentElement.lang = locale.value;
  await persist('config', store.snapshot.config);
}

async function toggleHidden() {
  if (!store.snapshot) return;
  store.snapshot.config.showHiddenFiles = !store.snapshot.config.showHiddenFiles;
  await persist('config', store.snapshot.config);
}

async function updateMaxConcurrentJobs() {
  if (!store.snapshot) return;
  store.snapshot.config.maxConcurrentJobs = Math.min(Math.max(Math.round(store.snapshot.config.maxConcurrentJobs), 1), 10);
  await persist('config', store.snapshot.config);
}

async function saveGlobalInstructions() {
  if (!store.snapshot) return;
  globalSaving.value = true;
  globalError.value = null;
  try {
    await persist('globalInstructions', globalDraft.value);
    store.snapshot.globalInstructions = globalDraft.value;
    globalSaved.value = true;
  } catch (error) {
    globalError.value = error instanceof Error ? error.message : String(error);
  } finally { globalSaving.value = false; }
}

async function saveProviderInstructions(providerId: string) {
  if (!store.snapshot) return;
  providerSaving.value[providerId] = true;
  providerErrors.value[providerId] = null;
  const nextInstructions = { ...store.snapshot.providerInstructions, [providerId]: providerDrafts.value[providerId] ?? '' };
  try {
    await persist('providerInstructions', nextInstructions);
    store.snapshot.providerInstructions = nextInstructions;
    providerSaved.value[providerId] = true;
  } catch (error) {
    providerErrors.value[providerId] = error instanceof Error ? error.message : String(error);
  } finally { providerSaving.value[providerId] = false; }
}
</script>

<template>
  <div class="settings-page">
    <div class="page-heading"><div><span class="eyebrow">{{ t('settings.eyebrow') }}</span><h1>{{ t('settings.title') }}</h1><p class="lead">{{ t('settings.intro') }}</p></div></div>
    <div class="settings-cards">
      <section class="settings-card"><div class="settings-card-heading"><span class="eyebrow">{{ t('settings.appearance') }}</span><span>◐</span></div><label class="form-field"><span>{{ t('settings.theme') }}</span><select v-if="store.snapshot" v-model="store.snapshot.config.theme" @change="updateTheme"><option value="dark">{{ t('settings.dark') }}</option><option value="light">{{ t('settings.light') }}</option></select></label><label class="form-field"><span>{{ t('settings.language') }}</span><select v-model="locale" @change="updateLocale"><option value="en">{{ t('settings.english') }}</option></select></label><label class="form-field"><span>{{ t('settings.maxConcurrentJobs') }}</span><input v-if="store.snapshot" v-model.number="store.snapshot.config.maxConcurrentJobs" type="number" min="1" max="10" @change="updateMaxConcurrentJobs"></label><label class="toggle-field settings-toggle"><input type="checkbox" :checked="store.snapshot?.config.showHiddenFiles" @change="toggleHidden"><span class="toggle-track"></span><span>{{ t('workspace.toggleHidden') }}</span></label></section>
      <section class="settings-card"><div class="settings-card-heading"><span class="eyebrow">{{ t('settings.storage') }}</span><span>⌁</span></div><span class="settings-label">{{ t('settings.configRoot') }}</span><strong class="settings-path mono">{{ store.snapshot?.storageRoot }}</strong><p>{{ t('settings.storageDetail') }}</p><div class="storage-tree mono">config.json<br>projects.json<br><span>goals/</span><br><span>roles/</span><br><span>guardrails/</span><br><span>providers/</span></div></section>
      <section class="settings-card"><div class="settings-card-heading"><span class="eyebrow">{{ t('settings.diagnostics') }}</span><span>!</span></div><p>{{ t('settings.diagnosticsDetail') }}</p><span class="settings-label">{{ t('settings.warnings') }}</span><div v-if="warnings.length" class="warning-list"><span v-for="warning in warnings" :key="warning">{{ warning }}</span></div><strong v-else class="healthy-state"><span class="signal-dot"></span>{{ t('settings.noWarnings') }}</strong></section>
      <section class="settings-card security-card"><div class="settings-card-heading"><span class="eyebrow">{{ t('settings.security') }}</span><span>◇</span></div><p>{{ t('settings.securityDetail') }}</p><div class="security-lines"><span><b>01</b>{{ t('settings.securityReadOnly') }}</span><span><b>02</b>{{ t('settings.securityRootBound') }}</span><span><b>03</b>{{ t('settings.securityAllowlisted') }}</span></div></section>
      <section class="settings-card global-instructions-card"><div class="settings-card-heading"><div><span class="eyebrow">{{ t('settings.globalInstructions') }}</span><p>{{ t('settings.globalInstructionsDetail') }}</p></div><span class="mono">AGENTS</span></div><textarea v-model="globalDraft" class="global-instructions-textarea" :placeholder="t('settings.globalInstructionsPlaceholder')" @input="globalSaved = false; globalError = null"></textarea><p v-if="globalError" class="inline-error" role="alert">{{ globalError }}</p><div class="settings-card-actions"><span class="save-state" :class="{ dirty: !globalSaved }">{{ globalSaved ? t('personalization.saved') : t('personalization.unsaved') }}</span><button class="primary-button" :class="{ 'retry-action': globalError }" type="button" :disabled="globalSaved || globalSaving" @click="saveGlobalInstructions">{{ globalSaving ? t('common.saving') : globalError ? t('common.retry') : t('settings.saveGlobalInstructions') }}</button></div></section>
      <section class="settings-card provider-instructions-card"><div class="settings-card-heading"><div><span class="eyebrow">{{ t('settings.providerInstructions') }}</span><p>{{ t('settings.providerInstructionsDetail') }}</p></div><span class="mono">SCOPED</span></div><div v-for="provider in store.snapshot?.providerSettings" :key="provider.id" class="provider-instruction-editor"><label class="settings-label" :for="`provider-instructions-${provider.id}`">{{ provider.name }}</label><textarea :id="`provider-instructions-${provider.id}`" v-model="providerDrafts[provider.id]" class="global-instructions-textarea" :placeholder="t('settings.providerInstructionsPlaceholder')" @input="providerSaved[provider.id] = false; providerErrors[provider.id] = null"></textarea><p v-if="providerErrors[provider.id]" class="inline-error" role="alert">{{ providerErrors[provider.id] }}</p><div class="settings-card-actions"><span class="save-state" :class="{ dirty: providerSaved[provider.id] === false }">{{ providerSaved[provider.id] === false ? t('personalization.unsaved') : t('personalization.saved') }}</span><button class="primary-button" type="button" :disabled="providerSaved[provider.id] !== false || providerSaving[provider.id]" @click="saveProviderInstructions(provider.id)">{{ providerSaving[provider.id] ? t('common.saving') : providerErrors[provider.id] ? t('common.retry') : t('settings.saveProviderInstructions') }}</button></div></div></section>
    </div>
  </div>
</template>
