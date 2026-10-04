<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { GitCommit } from '@/shared/types';
import { loadCommits, store } from '../services/store';

const { t } = useI18n();

const selectedCommitHash = ref<string | null>(null);

const selectedCommit = computed<GitCommit | null>(
  () => store.commits.find((commit) => commit.hash === selectedCommitHash.value) ?? null,
);

const selectedBranch = computed({
  get: () => store.selectedBranch ?? '',
  set: (branch: string) => {
    store.selectedBranch = branch || null;
    selectedCommitHash.value = null;
    void loadCommits();
  },
});

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function selectCommit(commit: GitCommit) {
  selectedCommitHash.value = selectedCommitHash.value === commit.hash ? null : commit.hash;
}
</script>

<template>
  <div class="commits-layout">
    <div class="git-summary">
      <div>
        <span class="eyebrow">{{ t('commits.branch') }}</span>
        <strong>{{ store.selectedBranch ?? t('common.unavailable') }}</strong>
      </div>
      <div>
        <span class="eyebrow">{{ t('commits.count') }}</span>
        <strong>{{ store.commits.length }}</strong>
      </div>
      <label class="branch-select">
        <span class="visually-hidden">{{ t('commits.selectBranch') }}</span>
        <select v-model="selectedBranch" :disabled="store.commitsLoading">
          <option v-for="branch in store.branches" :key="branch.name" :value="branch.name">
            {{ branch.name }}{{ branch.isCurrent ? ` · ${t('commits.current')}` : '' }}
          </option>
        </select>
      </label>
      <button class="secondary-button" type="button" @click="loadCommits">{{ t('common.refresh') }}</button>
    </div>

    <div v-if="store.commitsLoading" class="empty-state compact-empty">
      <span class="loading-pulse"></span>{{ t('commits.loading') }}
    </div>
    <div v-else-if="store.commitsError" class="empty-state compact-empty">
      <span class="empty-mark">!</span>
      <strong>{{ store.commitsError }}</strong>
      <span>{{ t('commits.readOnlyNotice') }}</span>
    </div>
    <div v-else-if="!store.commits.length" class="empty-state compact-empty">
      <span class="empty-mark">○</span>
      <strong>{{ t('commits.empty') }}</strong>
      <span>{{ t('commits.emptyDetail') }}</span>
    </div>
    <div v-else class="git-changes-layout">
      <div class="change-list">
        <div class="change-group">
          <div class="change-group-label">
            <span>{{ store.selectedBranch ?? t('commits.allBranches') }}</span>
            <span class="mono">{{ store.commits.length.toString().padStart(2, '0') }}</span>
          </div>
          <button
            v-for="commit in store.commits"
            :key="commit.hash"
            class="change-item commit-item"
            :class="{ active: selectedCommitHash === commit.hash }"
            type="button"
            :aria-pressed="selectedCommitHash === commit.hash"
            @click="selectCommit(commit)"
          >
            <span class="commit-hash mono">{{ commit.shortHash }}</span>
            <span class="commit-subject">{{ commit.subject }}</span>
            <span class="commit-author">{{ commit.author }}</span>
            <span class="commit-date mono">{{ formatDate(commit.date) }}</span>
          </button>
        </div>
      </div>
      <div class="diff-panel commit-detail">
        <template v-if="selectedCommit">
          <dl class="commit-detail-body">
            <div><dt>{{ t('commits.subject') }}</dt><dd>{{ selectedCommit.subject }}</dd></div>
            <div><dt>{{ t('commits.hash') }}</dt><dd class="mono">{{ selectedCommit.hash }}</dd></div>
            <div><dt>{{ t('commits.author') }}</dt><dd>{{ selectedCommit.author }}</dd></div>
            <div><dt>{{ t('commits.date') }}</dt><dd class="mono">{{ formatDate(selectedCommit.date) }}</dd></div>
          </dl>
        </template>
        <div v-else class="viewer-message">
          <span class="empty-mark">#</span>
          <strong>{{ t('commits.selectCommit') }}</strong>
          <span>{{ t('commits.selectCommitDetail') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>