<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { api } from '../services/api';
import { selectedProject, store } from '../services/store';

const { t } = useI18n();
const outputContainer = ref<HTMLElement | null>(null);
const job = computed(() => store.jobs.find((item) => item.id === store.activeJobId) ?? null);
const project = computed(() => job.value ? store.snapshot?.projects.find((item) => item.id === job.value?.projectId) : selectedProject());

function detach() {
  store.activeView = 'dashboard';
}

async function cancel() {
  if (job.value?.executionId) await api.cancelProcess(job.value.executionId);
}

watch(() => job.value?.output.length, async () => {
  await nextTick();
  if (outputContainer.value) outputContainer.value.scrollTop = outputContainer.value.scrollHeight;
});
</script>

<template>
  <div v-if="job" class="prompt-page">
    <div class="page-heading prompt-heading"><div><span class="eyebrow">{{ t('prompt.jobEyebrow') }}</span><h1>{{ job.task }}</h1><p class="lead">{{ project?.name }} · {{ t(`prompt.${job.state}`) }}</p></div><button class="secondary-button" type="button" @click="detach">{{ t('prompt.detach') }}</button></div>
    <section class="execution-panel"><div class="execution-header"><div><span class="eyebrow">{{ t('prompt.output') }}</span><strong>{{ t(`prompt.${job.state}`) }}</strong></div><div class="execution-actions"><span v-if="job.command" class="mono execution-command">{{ job.command }}</span><span v-if="job.exitCode !== null" class="mono">{{ t('prompt.exitCode') }} {{ job.exitCode }}</span><button v-if="job.state === 'running'" class="danger-button" type="button" @click="cancel">{{ t('prompt.cancel') }}</button></div></div><div v-if="job.output.length" ref="outputContainer" class="execution-output"><div v-for="(line, index) in job.output" :key="`${index}-${line.text}`" class="output-line" :class="`output-${line.kind}`"><span class="mono">{{ line.kind === 'stderr' ? 'LOG' : line.kind === 'error' ? 'ERR' : line.kind === 'system' ? 'SYS' : 'OUT' }}</span><span>{{ line.text }}</span></div></div><div v-else class="execution-idle"><span class="empty-mark">›_</span><span>{{ t('prompt.confirmation') }}</span></div></section>
  </div>
  <div v-else class="empty-state"><strong>{{ t('prompt.jobUnavailable') }}</strong></div>
</template>
