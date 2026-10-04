<template>
  <div v-if="open" class="modal-backdrop" @click.self="deny">
    <section ref="dialog" class="confirm-modal" role="dialog" aria-modal="true" tabindex="-1" @keydown="handleKeydown">
      <span class="eyebrow">{{ t('permissions.requested') }}</span>
      <h2>{{ t('permissions.grantTitle') }}</h2>
      <p>{{ t('permissions.toolRequest', { tool: request?.tool ?? t('permissions.unknownTool') }) }}</p>
      <code class="mono">{{ request?.path }}</code>
      <p class="muted small">{{ t('permissions.scopeDefault') }}</p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <div class="modal-actions">
        <button class="secondary-button" type="button" :disabled="submitting" @click="deny">{{ t('permissions.deny') }}</button>
        <button class="secondary-button" type="button" :disabled="submitting" @click="once">{{ t('permissions.allowOnce') }}</button>
        <button class="secondary-button" type="button" :disabled="submitting" @click="session">{{ t('permissions.allowSession') }}</button>
        <button class="primary-button" type="button" :disabled="submitting" @click="project">{{ t('permissions.allowProject') }}</button>
        <button class="secondary-button" type="button" :disabled="submitting" @click="global">{{ t('permissions.allowGlobal') }}</button>
        <button v-if="error" class="primary-button retry-action" type="button" :disabled="submitting" @click="retry">{{ t('common.retry') }}</button>
      </div>
    </section>
  </div>
</template>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

interface PermReq { path: string; tool?: string }

const props = defineProps<{ open: boolean; request: PermReq | null; error?: string | null }>()
const emit = defineEmits<{
  (e: 'grant', res: { scope: 'once'|'session'|'project'|'global' }): void
  (e: 'deny'): void
  (e: 'retry'): void
}>()
const { t } = useI18n();
const dialog = ref<HTMLElement | null>(null);
const submitting = ref(false);
let previouslyFocused: HTMLElement | null = null;

function focusDialog() {
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  void nextTick(() => dialog.value?.focus());
}
function restoreFocus() {
  previouslyFocused?.focus();
  previouslyFocused = null;
  submitting.value = false;
}
function deny(){ emit('deny') }
function grant(scope: 'once'|'session'|'project'|'global'){ if (submitting.value) return; submitting.value = true; emit('grant', { scope }) }
function once(){ grant('once') }
function session(){ grant('session') }
function project(){ grant('project') }
function global(){ grant('global') }
function retry(){ if (submitting.value) return; submitting.value = true; emit('retry') }
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); deny(); return; }
  if (event.key !== 'Tab' || !dialog.value) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
watch(() => props.open, (open) => { if (open) focusDialog(); else restoreFocus(); }, { immediate: true });
watch(() => props.error, (error) => { if (error) submitting.value = false; });
onBeforeUnmount(restoreFocus);
</script>
