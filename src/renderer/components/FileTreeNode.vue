<script setup lang="ts">
import { ref } from 'vue';

import type { ProjectFileNode } from '@/shared/types';

defineOptions({ name: 'FileTreeNode' });

defineProps<{
  node: ProjectFileNode;
  selectedPath: string | null;
  depth?: number;
}>();

const emit = defineEmits<{ select: [node: ProjectFileNode] }>();
const expanded = ref(false);
</script>

<template>
  <div class="tree-node">
    <button
      class="tree-row"
      :class="{ selected: selectedPath === node.relativePath }"
      type="button"
      :style="{ '--depth': depth ?? 0 }"
      @click="node.kind === 'directory' ? expanded = !expanded : emit('select', node)"
      @dblclick="node.kind === 'directory' ? expanded = !expanded : emit('select', node)"
    >
      <span class="tree-chevron" :class="{ open: expanded }">{{ node.kind === 'directory' ? '›' : '' }}</span>
      <span class="tree-file-icon" :class="`kind-${node.kind}`">{{ node.kind === 'directory' ? '□' : node.kind === 'symlink' ? '↗' : '·' }}</span>
      <span class="tree-name">{{ node.name }}</span>
      <span v-if="node.kind === 'symlink'" class="tree-type mono">{{ $t('workspace.symlink') }}</span>
    </button>
    <div v-if="expanded && node.children" class="tree-children">
      <FileTreeNode v-for="child in node.children" :key="child.relativePath" :node="child" :selected-path="selectedPath" :depth="(depth ?? 0) + 1" @select="emit('select', $event)" />
    </div>
  </div>
</template>
