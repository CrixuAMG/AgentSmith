<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { PaletteCommand } from '../services/command-palette';
import { commandMatches } from '../services/command-palette';

const props = defineProps<{ open: boolean; commands: PaletteCommand[]; providerStatus: string }>();
const emit = defineEmits<{ close: []; execute: [command: PaletteCommand] }>();
const { t } = useI18n();
const query = ref('');
const cursor = ref(0);
const input = ref<HTMLInputElement | null>(null);
const invoker = ref<HTMLElement | null>(null);

const filteredCommands = computed(() => props.commands.filter((command) => commandMatches(command, query.value)));

function openFrom(element: HTMLElement | null) {
  invoker.value = element;
  query.value = '';
  cursor.value = 0;
  void nextTick(() => input.value?.focus());
}

function close() {
  emit('close');
  void nextTick(() => invoker.value?.focus());
}

function execute(command: PaletteCommand) {
  if (command.disabled) return;
  emit('execute', command);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    cursor.value = Math.min(cursor.value + 1, Math.max(filteredCommands.value.length - 1, 0));
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    cursor.value = Math.max(cursor.value - 1, 0);
  } else if (event.key === 'Enter' && filteredCommands.value[cursor.value]) {
    event.preventDefault();
    execute(filteredCommands.value[cursor.value]);
  }
}

watch(() => props.open, (open) => { if (open) openFrom(document.activeElement instanceof HTMLElement ? document.activeElement : null); });
watch(query, () => { cursor.value = 0; });
</script>

<template>
  <div v-if="open" class="command-palette-backdrop" @mousedown.self="close">
    <section class="command-palette" role="dialog" aria-modal="true" :aria-label="t('shell.commandPalette')" @keydown="handleKeydown">
      <div class="command-palette-header">
        <label class="command-palette-search"><span aria-hidden="true">⌕</span><input ref="input" v-model="query" type="search" :placeholder="t('palette.search')" :aria-label="t('palette.search')"></label>
        <button class="quiet-button" type="button" @click="close">{{ t('common.close') }} <kbd>Esc</kbd></button>
      </div>
      <div class="command-palette-status" role="status"><span class="status-dot"></span>{{ t('palette.providerStatus') }}: {{ providerStatus }}</div>
      <div v-if="filteredCommands.length" class="command-palette-list" role="listbox" :aria-label="t('palette.commands')">
        <button v-for="(command, index) in filteredCommands" :key="command.id" class="command-palette-item" :class="{ active: index === cursor }" type="button" role="option" :aria-selected="index === cursor" :disabled="command.disabled" @mouseenter="cursor = index" @click="execute(command)">
          <span><strong>{{ command.label }}</strong><small>{{ command.keywords }}</small></span><kbd v-if="command.shortcut">{{ command.shortcut }}</kbd>
        </button>
      </div>
      <p v-else class="command-palette-empty">{{ t('palette.noCommands') }}</p>
    </section>
  </div>
</template>
