<script setup lang="ts">
import { computed } from 'vue';
import hljs from 'highlight.js/lib/common';

import type { FileReadResult } from '@/shared/types';

const props = defineProps<{ file: FileReadResult | null; loading?: boolean; error?: string | null }>();

const highlighted = computed(() => {
  if (!props.file) return '';
  if (props.file.language === 'plaintext') return escapeHtml(props.file.content);
  try {
    return hljs.highlight(props.file.content, { language: props.file.language }).value;
  } catch {
    return escapeHtml(props.file.content);
  }
});

const lines = computed(() => Array.from({ length: props.file?.lineCount ?? 0 }, (_, index) => index + 1));

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
</script>

<template>
  <div class="file-viewer">
    <div v-if="loading" class="viewer-message"><span class="loading-pulse"></span>{{ $t('workspace.readingFile') }}</div>
    <div v-else-if="error" class="viewer-message viewer-error"><span class="empty-mark">!</span>{{ error }}</div>
    <div v-else-if="!file" class="viewer-message"><span class="empty-mark">{ }</span><strong>{{ $t('workspace.selectFile') }}</strong><span>{{ $t('workspace.selectFileDetail') }}</span></div>
    <template v-else>
      <div class="viewer-header"><div><strong>{{ file.relativePath }}</strong><span class="mono">{{ file.language }} · {{ file.lineCount }} {{ $t('workspace.lines').toLowerCase() }}</span></div><span class="viewer-readonly">{{ $t('workspace.readOnly') }}</span></div>
      <div class="code-scroll">
        <div class="line-numbers" aria-hidden="true"><span v-for="line in lines" :key="line">{{ line }}</span></div>
        <pre class="code-content"><code v-html="highlighted"></code></pre>
      </div>
    </template>
  </div>
</template>
