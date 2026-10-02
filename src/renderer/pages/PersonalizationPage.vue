<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { Goal, GuardrailProfile } from '@/shared/types';
import { persist, store } from '../services/store';

const { t } = useI18n();
const activeTab = ref<'goals' | 'guardrails'>('goals');
const selectedGoalId = ref<string | null>(null);
const goalDraft = ref<Goal | null>(null);
const selectedGuardrailId = ref<string | null>(null);
const guardrailDraft = ref<GuardrailProfile | null>(null);
const savedState = ref(true);

const goals = computed(() => [...(store.snapshot?.goals ?? [])].sort((left, right) => left.order - right.order));
const guardrails = computed(() => store.snapshot?.guardrails ?? []);
const goalInstructions = computed({
  get: () => goalDraft.value?.instructions.join('\n') ?? '',
  set: (value: string) => { if (goalDraft.value) goalDraft.value.instructions = value.split('\n').map((line) => line.trim()).filter(Boolean); },
});

function idFor(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function selectGoal(goal: Goal) {
  selectedGoalId.value = goal.id;
  goalDraft.value = structuredClone(goal);
  savedState.value = true;
}

function newGoal() {
  const highestOrder = goals.value.reduce((highest, goal) => Math.max(highest, goal.order), 0);
  goalDraft.value = { version: 1, id: idFor('goal'), name: '', description: '', instructions: [], enabled: true, order: highestOrder + 1 };
  selectedGoalId.value = null;
  savedState.value = false;
}

async function saveGoal() {
  if (!store.snapshot || !goalDraft.value || !goalDraft.value.name.trim()) return;
  goalDraft.value.name = goalDraft.value.name.trim();
  const existingIndex = store.snapshot.goals.findIndex((goal) => goal.id === goalDraft.value?.id);
  if (existingIndex === -1) store.snapshot.goals.push(structuredClone(goalDraft.value));
  else store.snapshot.goals[existingIndex] = structuredClone(goalDraft.value);
  selectedGoalId.value = goalDraft.value.id;
  await persist('goals', store.snapshot.goals);
  selectGoal(store.snapshot.goals.find((goal) => goal.id === goalDraft.value?.id)!);
}

async function deleteGoal() {
  if (!store.snapshot || !goalDraft.value || !window.confirm(t('personalization.deleteGoalConfirm'))) return;
  store.snapshot.goals = store.snapshot.goals.filter((goal) => goal.id !== goalDraft.value?.id);
  await persist('goals', store.snapshot.goals);
  goalDraft.value = null;
  selectedGoalId.value = null;
}

async function moveGoal(direction: -1 | 1) {
  if (!store.snapshot || !goalDraft.value) return;
  const ordered = goals.value;
  const index = ordered.findIndex((goal) => goal.id === goalDraft.value?.id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return;
  const currentOrder = ordered[index].order;
  ordered[index].order = ordered[target].order;
  ordered[target].order = currentOrder;
  store.snapshot.goals = ordered;
  await persist('goals', store.snapshot.goals);
  selectGoal(ordered[index]);
}

function selectGuardrail(profile: GuardrailProfile) {
  selectedGuardrailId.value = profile.id;
  guardrailDraft.value = structuredClone(profile);
  savedState.value = true;
}

function newGuardrail() {
  guardrailDraft.value = { version: 1, id: idFor('guardrail'), name: '', description: '', rules: [] };
  selectedGuardrailId.value = null;
  savedState.value = false;
}

function addRule() {
  if (!guardrailDraft.value) return;
  guardrailDraft.value.rules.push({ id: idFor('rule'), type: 'file_access', pattern: '', action: 'deny', enabled: true, enforcement: 'application', description: '' });
  savedState.value = false;
}

function removeRule(ruleId: string) {
  if (!guardrailDraft.value) return;
  guardrailDraft.value.rules = guardrailDraft.value.rules.filter((rule) => rule.id !== ruleId);
  savedState.value = false;
}

async function saveGuardrail() {
  if (!store.snapshot || !guardrailDraft.value || !guardrailDraft.value.name.trim()) return;
  guardrailDraft.value.name = guardrailDraft.value.name.trim();
  const existingIndex = store.snapshot.guardrails.findIndex((profile) => profile.id === guardrailDraft.value?.id);
  if (existingIndex === -1) store.snapshot.guardrails.push(structuredClone(guardrailDraft.value));
  else store.snapshot.guardrails[existingIndex] = structuredClone(guardrailDraft.value);
  selectedGuardrailId.value = guardrailDraft.value.id;
  await persist('guardrails', store.snapshot.guardrails);
  selectGuardrail(store.snapshot.guardrails.find((profile) => profile.id === guardrailDraft.value?.id)!);
}

async function deleteGuardrail() {
  if (!store.snapshot || !guardrailDraft.value || !window.confirm(t('personalization.deleteProfileConfirm'))) return;
  store.snapshot.guardrails = store.snapshot.guardrails.filter((profile) => profile.id !== guardrailDraft.value?.id);
  await persist('guardrails', store.snapshot.guardrails);
  guardrailDraft.value = null;
  selectedGuardrailId.value = null;
}

watch(activeTab, (tab) => {
  if (tab === 'goals' && !goalDraft.value && goals.value[0]) selectGoal(goals.value[0]);
  if (tab === 'guardrails' && !guardrailDraft.value && guardrails.value[0]) selectGuardrail(guardrails.value[0]);
});

if (goals.value[0]) selectGoal(goals.value[0]);
if (guardrails.value[0]) selectGuardrail(guardrails.value[0]);
</script>

<template>
  <div class="personalization-page">
    <div class="page-heading"><div><span class="eyebrow">{{ t('personalization.eyebrow') }}</span><h1>{{ t('personalization.title') }}</h1><p class="lead">{{ t('personalization.intro') }}</p></div></div>
    <div class="section-tabs"><button class="section-tab" :class="{ active: activeTab === 'goals' }" type="button" @click="activeTab = 'goals'">{{ t('personalization.goalsTab') }}</button><button class="section-tab" :class="{ active: activeTab === 'guardrails' }" type="button" @click="activeTab = 'guardrails'">{{ t('personalization.guardrailsTab') }}</button></div>

    <div v-if="activeTab === 'goals'" class="settings-editor-grid">
      <div class="resource-list-panel"><div class="resource-list-header"><div><span class="eyebrow">{{ t('personalization.goalList') }}</span><strong>{{ goals.length }}</strong></div><button class="small-primary-button" type="button" :title="t('personalization.newGoal')" @click="newGoal">+</button></div><button v-for="goal in goals" :key="goal.id" class="resource-list-item" :class="{ selected: goal.id === goalDraft?.id }" type="button" @click="selectGoal(goal)"><span class="resource-status" :class="{ on: goal.enabled }"></span><span><strong>{{ goal.name }}</strong><small>{{ goal.description }}</small></span><span class="mono">{{ goal.order.toString().padStart(2, '0') }}</span></button><div v-if="!goals.length" class="empty-state compact-empty"><span class="empty-mark">+</span><strong>{{ t('personalization.goalEmpty') }}</strong></div></div>
      <div class="resource-editor-panel"><div v-if="goalDraft" class="editor-form"><div class="resource-editor-header"><div><span class="eyebrow">{{ t('personalization.goalEditor') }}</span><strong>{{ goalDraft.name || t('personalization.newGoal') }}</strong></div><span class="save-state" :class="{ dirty: !savedState }">{{ savedState ? t('personalization.saved') : t('personalization.unsaved') }}</span></div><label class="form-field"><span>{{ t('common.name') }}</span><input v-model="goalDraft.name" type="text" @input="savedState = false"></label><label class="form-field"><span>{{ t('common.description') }}</span><textarea v-model="goalDraft.description" rows="3" @input="savedState = false"></textarea></label><label class="form-field"><span>{{ t('common.instructions') }} <small>{{ t('personalization.goalInstructions') }}</small></span><textarea v-model="goalInstructions" rows="8" :placeholder="t('personalization.goalInstructionsPlaceholder')" @input="savedState = false"></textarea></label><div class="form-row"><label class="toggle-field"><input v-model="goalDraft.enabled" type="checkbox" @change="savedState = false"><span class="toggle-track"></span><span>{{ t('personalization.goalEnabled') }}</span></label><div class="order-buttons"><span class="field-label">{{ t('personalization.goalOrder') }}</span><button class="small-icon-button" type="button" @click="moveGoal(-1)">↑</button><button class="small-icon-button" type="button" @click="moveGoal(1)">↓</button></div></div><div class="editor-actions"><button class="danger-text-button" type="button" @click="deleteGoal">{{ t('common.delete') }}</button><button class="primary-button" type="button" @click="saveGoal">{{ t('common.save') }}</button></div></div><div v-else class="empty-state"><span class="empty-mark">✦</span><strong>{{ t('personalization.goalEmpty') }}</strong><button class="primary-button" type="button" @click="newGoal">{{ t('personalization.newGoal') }}</button></div></div>
    </div>

    <div v-else class="settings-editor-grid">
      <div class="resource-list-panel"><div class="resource-list-header"><div><span class="eyebrow">{{ t('personalization.profileList') }}</span><strong>{{ guardrails.length }}</strong></div><button class="small-primary-button" type="button" :title="t('personalization.newProfile')" @click="newGuardrail">+</button></div><button v-for="profile in guardrails" :key="profile.id" class="resource-list-item" :class="{ selected: profile.id === guardrailDraft?.id }" type="button" @click="selectGuardrail(profile)"><span class="resource-status on"></span><span><strong>{{ profile.name }}</strong><small>{{ profile.rules.length }} {{ t('personalization.rules').toLowerCase() }}</small></span><span class="mono">{{ profile.id }}</span></button><div v-if="!guardrails.length" class="empty-state compact-empty"><span class="empty-mark">+</span><strong>{{ t('personalization.profileEmpty') }}</strong></div></div>
      <div class="resource-editor-panel"><div v-if="guardrailDraft" class="editor-form"><div class="resource-editor-header"><div><span class="eyebrow">{{ t('personalization.profileEditor') }}</span><strong>{{ guardrailDraft.name || t('personalization.newProfile') }}</strong></div><span class="save-state" :class="{ dirty: !savedState }">{{ savedState ? t('personalization.saved') : t('personalization.unsaved') }}</span></div><label class="form-field"><span>{{ t('common.name') }}</span><input v-model="guardrailDraft.name" type="text" @input="savedState = false"></label><label class="form-field"><span>{{ t('common.description') }}</span><textarea v-model="guardrailDraft.description" rows="2" @input="savedState = false"></textarea></label><div class="rules-header"><div><span class="eyebrow">{{ t('personalization.rules') }}</span><span class="mono">{{ guardrailDraft.rules.length.toString().padStart(2, '0') }}</span></div><button class="secondary-button" type="button" @click="addRule">+ {{ t('personalization.addRule') }}</button></div><div class="rule-list"><div v-for="rule in guardrailDraft.rules" :key="rule.id" class="rule-card"><div class="rule-card-top"><label class="toggle-field"><input v-model="rule.enabled" type="checkbox" @change="savedState = false"><span class="toggle-track"></span><span>{{ t('personalization.enabledRule') }}</span></label><button class="danger-text-button" type="button" :aria-label="t('personalization.deleteRule')" @click="removeRule(rule.id)">{{ t('common.delete') }}</button></div><div class="rule-grid"><label class="form-field"><span>{{ t('personalization.ruleType') }}</span><select v-model="rule.type" @change="savedState = false"><option value="file_access">{{ t('personalization.typeFileAccess') }}</option><option value="filesystem_write">{{ t('personalization.typeFilesystemWrite') }}</option><option value="network">{{ t('personalization.typeNetwork') }}</option><option value="database">{{ t('personalization.typeDatabase') }}</option><option value="command">{{ t('personalization.typeCommand') }}</option><option value="git">{{ t('personalization.typeGit') }}</option><option value="agent_permission">{{ t('personalization.typeAgentPermission') }}</option></select></label><label class="form-field"><span>{{ t('personalization.ruleAction') }}</span><select v-model="rule.action" @change="savedState = false"><option value="deny">{{ t('personalization.actionDeny') }}</option><option value="warn">{{ t('personalization.actionWarn') }}</option><option value="confirm">{{ t('personalization.actionConfirm') }}</option></select></label><label class="form-field rule-pattern"><span>{{ t('personalization.rulePattern') }}</span><input v-model="rule.pattern" type="text" :placeholder="t('personalization.rulePlaceholder')" @input="savedState = false"></label><label class="form-field"><span>{{ t('personalization.enforcement') }}</span><select v-model="rule.enforcement" @change="savedState = false"><option value="prompt">{{ t('personalization.enforcementPrompt') }}</option><option value="application">{{ t('personalization.enforcementApplication') }}</option><option value="provider">{{ t('personalization.enforcementProvider') }}</option><option value="advisory">{{ t('personalization.enforcementAdvisory') }}</option></select></label><label class="form-field rule-description"><span>{{ t('personalization.ruleDescription') }}</span><input v-model="rule.description" type="text" @input="savedState = false"></label></div></div></div><div v-if="!guardrailDraft.rules.length" class="empty-state compact-empty"><span class="empty-mark">+</span><strong>{{ t('personalization.rules') }}</strong><span>{{ t('personalization.profileEmpty') }}</span></div><div class="editor-actions"><button class="danger-text-button" type="button" @click="deleteGuardrail">{{ t('common.delete') }}</button><button class="primary-button" type="button" @click="saveGuardrail">{{ t('common.save') }}</button></div></div><div v-else class="empty-state"><span class="empty-mark">!</span><strong>{{ t('personalization.profileEmpty') }}</strong><button class="primary-button" type="button" @click="newGuardrail">{{ t('personalization.newProfile') }}</button></div></div>
    </div>
  </div>
</template>
