<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { api } from '../services/api';
import { PALETTE_EVENTS } from '../services/command-palette';
import { selectedProject, store } from '../services/store';

const { t } = useI18n();
const outputContainer = ref<HTMLElement | null>(null);
const job = computed(() => store.jobs.find((item) => item.id === store.activeJobId) ?? store.jobs[0] ?? null);
const project = computed(() => job.value ? store.snapshot?.projects.find((item) => item.id === job.value?.projectId) : selectedProject());
const historyEntry = computed(() => {
  if (!job.value || !project.value) return null;
  return store.snapshot?.promptHistory[project.value.id]?.find((entry) => entry.id === job.value?.historyEntryId) ?? null;
});

function contextNames() {
  const contexts = historyEntry.value?.contexts;
  if (!contexts) return t('prompt.historyLegacySettings');
  return Object.entries(contexts)
    .filter(([, enabled]) => enabled)
    .map(([key]) => t(`prompt.contextLabels.${key}`))
    .join(', ') || t('common.none');
}

function detach() {
  store.activeView = 'dashboard';
}

async function cancel() {
  if (job.value?.executionId) await api.cancelProcess(job.value.executionId);
}

function handlePaletteEvent(event: Event) {
  if (event.type === PALETTE_EVENTS.cancelJob) void cancel();
}

async function copyOutput() {
  if (!job.value) return;
  await navigator.clipboard.writeText(job.value.output.map((line) => line.text).join(''));
}

watch(() => job.value?.output.length, async () => {
  await nextTick();
  if (outputContainer.value) outputContainer.value.scrollTop = outputContainer.value.scrollHeight;
});
window.addEventListener(PALETTE_EVENTS.cancelJob, handlePaletteEvent);
onBeforeUnmount(() => window.removeEventListener(PALETTE_EVENTS.cancelJob, handlePaletteEvent));
</script>

<template>
  <div v-if="job" class="prompt-page">
    <div v-if="store.jobs.length > 1" class="job-switcher"><span class="eyebrow">{{ t('prompt.jobs') }}</span><button v-for="item in store.jobs.slice(0, 12)" :key="item.id" type="button" :class="{ active: item.id === job.id }" @click="store.activeJobId = item.id"><strong>{{ item.task }}</strong><small>{{ t(`prompt.${item.state}`) }}</small></button></div>
    <div class="page-heading prompt-heading"><div><span class="eyebrow">{{ t('prompt.jobEyebrow') }}</span><h1>{{ project?.name ?? t('prompt.jobTitle') }}</h1><p class="lead prompt-job-task">{{ job.task }}</p><p class="lead">{{ t(`prompt.${job.state}`) }}</p></div><button class="secondary-button" type="button" @click="detach">{{ t('prompt.detach') }}</button></div>
    <section v-if="historyEntry" class="prompt-job-settings prompt-section-card"><div class="prompt-card-heading"><div><span class="eyebrow">{{ t('prompt.jobSettings') }}</span><p>{{ t('prompt.jobSettingsDetail') }}</p></div></div><div class="history-settings"><span><b>{{ t('prompt.provider') }}</b>{{ historyEntry.providerId }}</span><span><b>{{ t('prompt.model') }}</b>{{ historyEntry.modelId ?? t('profiles.noModel') }}</span><span><b>{{ t('prompt.role') }}</b>{{ historyEntry.roleName ?? t('profiles.noRole') }}</span><span><b>{{ t('prompt.goals') }}</b>{{ historyEntry.goalNames?.join(', ') || t('common.none') }}</span><span><b>{{ t('prompt.guardrail') }}</b>{{ historyEntry.guardrailProfileName ?? t('profiles.noGuardrail') }}</span><span><b>{{ t('prompt.context') }}</b>{{ contextNames() }}</span><span v-if="Object.keys(historyEntry.variant).length"><b>{{ t('prompt.modelVariant') }}</b>{{ Object.entries(historyEntry.variant).map(([key, value]) => `${key}: ${value}`).join(', ') }}</span></div></section>
    <section class="execution-panel prompt-job-output"><div class="execution-header"><div><span class="eyebrow">{{ t('prompt.output') }}</span><strong>{{ t(`prompt.${job.state}`) }}</strong></div><div class="execution-actions"><span v-if="job.command" class="mono execution-command">{{ job.command }}</span><span v-if="job.exitCode !== null" class="mono">{{ t('prompt.exitCode') }} {{ job.exitCode }}</span><span v-if="job.outputTruncated" class="mono output-warning">{{ t('prompt.outputTruncated') }}</span><button v-if="job.output.length" class="secondary-button" type="button" @click="copyOutput">{{ t('prompt.copyOutput') }}</button><button v-if="['queued', 'starting', 'running'].includes(job.state)" class="danger-button" type="button" @click="cancel">{{ t('prompt.cancel') }}</button></div></div><div v-if="job.output.length" ref="outputContainer" class="execution-output"><div v-for="(line, index) in job.output" :key="`${index}-${line.text}`" class="output-line" :class="`output-${line.kind}`"><span class="mono">{{ line.kind === 'stderr' ? 'LOG' : line.kind === 'error' ? 'ERR' : line.kind === 'system' ? 'SYS' : 'OUT' }}</span><span>{{ line.text }}</span></div></div><div v-else class="execution-idle"><span class="empty-mark">›_</span><span>{{ t('prompt.confirmation') }}</span></div></section>
  </div>
  <div v-else class="empty-state"><strong>{{ t('prompt.jobUnavailable') }}</strong></div>
</template>
