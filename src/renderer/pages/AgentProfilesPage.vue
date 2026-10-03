<script setup lang="ts">
import { computed, onMounted, ref, toRaw, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { AgentProfile, ProviderDiscovery, Role } from '@/shared/types';
import { api } from '../services/api';
import { persist, store as rawStore } from '../services/store';

const { t } = useI18n();
const store = rawStore as typeof rawStore & { snapshot: NonNullable<typeof rawStore.snapshot> };
const activeTab = ref<'providers' | 'profiles' | 'roles'>('providers');
const discoveries = ref<ProviderDiscovery[]>([]);
const discovering = ref(false);
const discoveryError = ref<string | null>(null);
const selectedProfileId = ref<string | null>(null);
const profileDraft = ref<AgentProfile | null>(null);
const selectedRoleId = ref<string | null>(null);
const roleDraft = ref<Role | null>(null);
const savedState = ref(true);
const roleInstructions = computed({
  get: () => roleDraft.value?.instructions.join('\n') ?? '',
  set: (value: string) => { if (roleDraft.value) roleDraft.value.instructions = value.split('\n').map((line) => line.trim()).filter(Boolean); },
});
const roleTags = computed({
  get: () => roleDraft.value?.tags.join(', ') ?? '',
  set: (value: string) => { if (roleDraft.value) roleDraft.value.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean); },
});
const profileGoals = computed(() => store.snapshot?.goals.filter((goal) => goal.enabled) ?? []);
const roleOptions = computed(() => store.snapshot?.roles.filter((role) => role.enabled) ?? []);
const guardrailOptions = computed(() => store.snapshot?.guardrails ?? []);
const selectedProviderDiscovery = computed(() => discoveries.value.find((item) => item.installation.providerId === profileDraft.value?.providerId) ?? null);

const capabilityKeys = [
  ['supportsModelDiscovery', 'capabilityModelDiscovery'],
  ['supportsReasoningEffort', 'capabilityReasoning'],
  ['supportsStreaming', 'capabilityStreaming'],
  ['supportsInteractiveTerminal', 'capabilityTerminal'],
  ['supportsPermissionModes', 'capabilityPermissions'],
  ['supportsSandboxing', 'capabilitySandbox'],
  ['supportsWorkingDirectory', 'capabilityWorkingDirectory'],
] as const;

function idFor(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

// Records come from the reactive store, and structuredClone rejects Vue proxies.
function cloneProfile(profile: AgentProfile): AgentProfile {
  return structuredClone(toRaw(profile));
}

async function discover() {
  discovering.value = true;
  discoveryError.value = null;
  try {
    discoveries.value = await api.discoverProviders();
  } catch (error) {
    discoveryError.value = error instanceof Error ? error.message : String(error);
  } finally {
    discovering.value = false;
  }
}

function selectProfile(profile: AgentProfile) {
  selectedProfileId.value = profile.id;
  profileDraft.value = cloneProfile(profile);
  savedState.value = true;
}

function newProfile() {
  profileDraft.value = { version: 1, id: idFor('profile'), name: '', providerId: discoveries.value.find((item) => item.installation.installed)?.installation.providerId ?? 'opencode', modelId: null, variant: {}, roleId: roleOptions.value[0]?.id ?? null, goalIds: profileGoals.value.slice(0, 2).map((goal) => goal.id), guardrailProfileId: guardrailOptions.value[0]?.id ?? null };
  selectedProfileId.value = null;
  savedState.value = false;
}

function toggleGoal(goalId: string) {
  if (!profileDraft.value) return;
  profileDraft.value.goalIds = profileDraft.value.goalIds.includes(goalId)
    ? profileDraft.value.goalIds.filter((id) => id !== goalId)
    : [...profileDraft.value.goalIds, goalId];
  savedState.value = false;
}

async function saveProfile() {
  if (!store.snapshot || !profileDraft.value || !profileDraft.value.name.trim()) return;
  profileDraft.value.name = profileDraft.value.name.trim();
  const existingIndex = store.snapshot.profiles.findIndex((profile) => profile.id === profileDraft.value?.id);
  if (existingIndex === -1) store.snapshot.profiles.push(cloneProfile(profileDraft.value));
  else store.snapshot.profiles[existingIndex] = cloneProfile(profileDraft.value);
  selectedProfileId.value = profileDraft.value.id;
  await persist('profiles', store.snapshot.profiles);
  selectProfile(store.snapshot.profiles.find((profile) => profile.id === profileDraft.value?.id)!);
}

async function deleteProfile() {
  if (!store.snapshot || !profileDraft.value || !window.confirm(t('profiles.deleteProfileConfirm'))) return;
  store.snapshot.profiles = store.snapshot.profiles.filter((profile) => profile.id !== profileDraft.value?.id);
  await persist('profiles', store.snapshot.profiles);
  profileDraft.value = null;
  selectedProfileId.value = null;
}

async function activateProfile(profileId: string) {
  if (!store.snapshot) return;
  store.snapshot.config.activeProfileId = profileId;
  await persist('config', store.snapshot.config);
}

function selectRole(role: Role) {
  selectedRoleId.value = role.id;
  roleDraft.value = structuredClone(toRaw(role));
  savedState.value = true;
}

function newRole() {
  roleDraft.value = { version: 1, id: idFor('role'), name: '', description: '', instructions: [], tags: [], enabled: true };
  selectedRoleId.value = null;
  savedState.value = false;
}

async function saveRole() {
  if (!store.snapshot || !roleDraft.value || !roleDraft.value.name.trim()) return;
  roleDraft.value.name = roleDraft.value.name.trim();
  const existingIndex = store.snapshot.roles.findIndex((role) => role.id === roleDraft.value?.id);
  if (existingIndex === -1) store.snapshot.roles.push(structuredClone(toRaw(roleDraft.value)));
  else store.snapshot.roles[existingIndex] = structuredClone(toRaw(roleDraft.value));
  selectedRoleId.value = roleDraft.value.id;
  await persist('roles', store.snapshot.roles);
  selectRole(store.snapshot.roles.find((role) => role.id === roleDraft.value?.id)!);
}

async function deleteRole() {
  if (!store.snapshot || !roleDraft.value || !window.confirm(t('profiles.deleteRoleConfirm'))) return;
  store.snapshot.roles = store.snapshot.roles.filter((role) => role.id !== roleDraft.value?.id);
  await persist('roles', store.snapshot.roles);
  roleDraft.value = null;
  selectedRoleId.value = null;
}

watch(activeTab, (tab) => {
  if (tab === 'profiles' && !profileDraft.value && store.snapshot?.profiles[0]) selectProfile(store.snapshot.profiles[0]);
  if (tab === 'roles' && !roleDraft.value && store.snapshot?.roles[0]) selectRole(store.snapshot.roles[0]);
});
watch(() => profileDraft.value?.providerId, () => {
  if (profileDraft.value && selectedProviderDiscovery.value && profileDraft.value.modelId && !selectedProviderDiscovery.value.models.some((model) => model.id === profileDraft.value?.modelId)) profileDraft.value.modelId = null;
});

if (store.snapshot?.profiles[0]) selectProfile(store.snapshot.profiles[0]);
if (store.snapshot?.roles[0]) selectRole(store.snapshot.roles[0]);
onMounted(discover);
</script>

<template>
  <div class="profiles-page">
    <div class="page-heading"><div><span class="eyebrow">{{ t('profiles.eyebrow') }}</span><h1>{{ t('profiles.title') }}</h1><p class="lead">{{ t('profiles.intro') }}</p></div></div>
    <div class="section-tabs"><button class="section-tab" :class="{ active: activeTab === 'providers' }" type="button" @click="activeTab = 'providers'">{{ t('profiles.providersTab') }}</button><button class="section-tab" :class="{ active: activeTab === 'profiles' }" type="button" @click="activeTab = 'profiles'">{{ t('profiles.profilesTab') }}</button><button class="section-tab" :class="{ active: activeTab === 'roles' }" type="button" @click="activeTab = 'roles'">{{ t('profiles.rolesTab') }}</button></div>

    <div v-if="activeTab === 'providers'" class="providers-page"><div class="provider-toolbar"><div><span class="eyebrow">{{ t('profiles.providerNote') }}</span><p>{{ discoveryError ?? t('profiles.providerNote') }}</p></div><button class="secondary-button" type="button" :disabled="discovering" @click="discover"><span v-if="discovering" class="loading-pulse"></span>{{ discovering ? t('profiles.discovering') : t('profiles.discover') }}</button></div><div class="provider-grid"><article v-for="provider in discoveries" :key="provider.installation.providerId" class="provider-card"><div class="provider-card-header"><div class="provider-logo">{{ provider.installation.providerId === 'opencode' ? 'OC' : 'CX' }}</div><div><h2>{{ provider.installation.providerId === 'opencode' ? 'OpenCode' : 'Codex' }}</h2><span class="mono">{{ provider.installation.version ?? t('profiles.notInstalled') }}</span></div><span class="provider-status" :class="{ installed: provider.installation.installed }">{{ provider.installation.installed ? t('profiles.installed') : t('profiles.notInstalled') }}</span></div><p v-if="provider.installation.error" class="provider-error">{{ provider.installation.error }}</p><div class="capability-list"><div v-for="[key, label] in capabilityKeys" :key="key" class="capability-row"><span>{{ t(`profiles.${label}`) }}</span><span :class="provider.capabilities[key] ? 'cap-yes' : 'cap-no'">{{ provider.capabilities[key] ? '✓' : '—' }} {{ provider.capabilities[key] ? t('profiles.supported') : t('profiles.unsupported') }}</span></div></div><div class="model-list"><div class="model-list-header"><span class="eyebrow">{{ t('profiles.models') }}</span><span class="status-pill">{{ provider.modelDiscoveryAvailable ? t('common.verified') : t('common.manual') }}</span></div><div v-if="provider.models.length" class="model-tags"><span v-for="model in provider.models.slice(0, 16)" :key="model.id" class="model-tag">{{ model.id }}</span></div><p v-else class="muted-copy">{{ provider.note ?? t('profiles.noModels') }}</p></div></article><div v-if="!discoveries.length && !discovering" class="empty-state"><span class="empty-mark">◎</span><strong>{{ t('profiles.notInstalled') }}</strong><span>{{ t('profiles.providerNote') }}</span></div></div></div>

    <div v-else-if="activeTab === 'profiles'" class="settings-editor-grid"><div class="resource-list-panel"><div class="resource-list-header"><div><span class="eyebrow">{{ t('profiles.profileList') }}</span><strong>{{ store.snapshot?.profiles.length ?? 0 }}</strong></div><button class="small-primary-button" type="button" :title="t('profiles.newProfile')" @click="newProfile">+</button></div><button v-for="profile in store.snapshot?.profiles" :key="profile.id" class="resource-list-item" :class="{ selected: profile.id === profileDraft?.id }" type="button" @click="selectProfile(profile)"><span class="resource-status on"></span><span><strong>{{ profile.name }}</strong><small>{{ profile.providerId }} · {{ profile.roleId ?? t('profiles.noRole') }}</small></span><span v-if="profile.id === store.snapshot?.config.activeProfileId" class="status-pill">{{ t('profiles.active') }}</span></button><div v-if="!store.snapshot?.profiles.length" class="empty-state compact-empty"><span class="empty-mark">+</span><strong>{{ t('profiles.profileEmpty') }}</strong></div></div><div class="resource-editor-panel"><div v-if="profileDraft" class="editor-form"><div class="resource-editor-header"><div><span class="eyebrow">{{ t('profiles.profileEditor') }}</span><strong>{{ profileDraft.name || t('profiles.newProfile') }}</strong></div><span class="save-state" :class="{ dirty: !savedState }">{{ savedState ? t('personalization.saved') : t('personalization.unsaved') }}</span></div><label class="form-field"><span>{{ t('common.name') }}</span><input v-model="profileDraft.name" type="text" @input="savedState = false"></label><div class="form-row two-columns"><label class="form-field"><span>{{ t('profiles.provider') }}</span><select v-model="profileDraft.providerId" @change="savedState = false"><option v-for="provider in discoveries" :key="provider.installation.providerId" :value="provider.installation.providerId">{{ provider.installation.providerId === 'opencode' ? 'OpenCode' : 'Codex' }} · {{ provider.installation.installed ? t('profiles.installed') : t('profiles.notInstalled') }}</option></select></label><label class="form-field"><span>{{ t('profiles.model') }}</span><select v-model="profileDraft.modelId" @change="savedState = false"><option :value="null">{{ t('profiles.noModel') }}</option><option v-for="model in selectedProviderDiscovery?.models" :key="model.id" :value="model.id">{{ model.id }}</option></select></label></div><label v-if="selectedProviderDiscovery?.capabilities.supportsReasoningEffort" class="form-field"><span>{{ t('profiles.reasoning') }}</span><select v-model="profileDraft.variant.reasoningEffort" @change="savedState = false"><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="max">Maximum</option></select></label><div class="form-row two-columns"><label class="form-field"><span>{{ t('profiles.role') }}</span><select v-model="profileDraft.roleId" @change="savedState = false"><option :value="null">{{ t('profiles.noRole') }}</option><option v-for="role in roleOptions" :key="role.id" :value="role.id">{{ role.name }}</option></select></label><label class="form-field"><span>{{ t('profiles.guardrail') }}</span><select v-model="profileDraft.guardrailProfileId" @change="savedState = false"><option :value="null">{{ t('profiles.noGuardrail') }}</option><option v-for="guardrail in guardrailOptions" :key="guardrail.id" :value="guardrail.id">{{ guardrail.name }}</option></select></label></div><div class="form-field"><span>{{ t('profiles.goals') }}</span><div class="check-grid"><label v-for="goal in profileGoals" :key="goal.id" class="check-field"><input type="checkbox" :checked="profileDraft.goalIds.includes(goal.id)" @change="toggleGoal(goal.id)"><span>{{ goal.name }}</span></label></div></div><div class="editor-actions"><button class="danger-text-button" type="button" @click="deleteProfile">{{ t('common.delete') }}</button><div class="editor-actions-right"><button class="secondary-button" type="button" :disabled="store.snapshot.config.activeProfileId === profileDraft.id" @click="activateProfile(profileDraft.id)">{{ store.snapshot.config.activeProfileId === profileDraft.id ? t('profiles.active') : t('profiles.activate') }}</button><button class="primary-button" type="button" @click="saveProfile">{{ t('common.save') }}</button></div></div></div><div v-else class="empty-state"><span class="empty-mark">◎</span><strong>{{ t('profiles.profileEmpty') }}</strong><button class="primary-button" type="button" @click="newProfile">{{ t('profiles.newProfile') }}</button></div></div></div>

    <div v-else class="settings-editor-grid"><div class="resource-list-panel"><div class="resource-list-header"><div><span class="eyebrow">{{ t('profiles.roleList') }}</span><strong>{{ store.snapshot?.roles.length ?? 0 }}</strong></div><button class="small-primary-button" type="button" :title="t('profiles.newRole')" @click="newRole">+</button></div><button v-for="role in store.snapshot?.roles" :key="role.id" class="resource-list-item" :class="{ selected: role.id === roleDraft?.id }" type="button" @click="selectRole(role)"><span class="resource-status" :class="{ on: role.enabled }"></span><span><strong>{{ role.name }}</strong><small>{{ role.tags.join(' · ') }}</small></span></button><div v-if="!store.snapshot?.roles.length" class="empty-state compact-empty"><span class="empty-mark">+</span><strong>{{ t('profiles.roleEmpty') }}</strong></div></div><div class="resource-editor-panel"><div v-if="roleDraft" class="editor-form"><div class="resource-editor-header"><div><span class="eyebrow">{{ t('profiles.roleEditor') }}</span><strong>{{ roleDraft.name || t('profiles.newRole') }}</strong></div><span class="save-state" :class="{ dirty: !savedState }">{{ savedState ? t('personalization.saved') : t('personalization.unsaved') }}</span></div><label class="form-field"><span>{{ t('common.name') }}</span><input v-model="roleDraft.name" type="text" @input="savedState = false"></label><label class="form-field"><span>{{ t('common.description') }}</span><textarea v-model="roleDraft.description" rows="3" @input="savedState = false"></textarea></label><label class="form-field"><span>{{ t('profiles.tags') }}</span><input v-model="roleTags" type="text" :placeholder="t('profiles.tagsPlaceholder')" @input="savedState = false"></label><label class="form-field"><span>{{ t('common.instructions') }} <small>{{ t('profiles.roleInstructions') }}</small></span><textarea v-model="roleInstructions" rows="9" :placeholder="t('profiles.roleInstructionsPlaceholder')" @input="savedState = false"></textarea></label><label class="toggle-field"><input v-model="roleDraft.enabled" type="checkbox" @change="savedState = false"><span class="toggle-track"></span><span>{{ t('common.enabled') }}</span></label><div class="editor-actions"><button class="danger-text-button" type="button" @click="deleteRole">{{ t('common.delete') }}</button><button class="primary-button" type="button" @click="saveRole">{{ t('common.save') }}</button></div></div><div v-else class="empty-state"><span class="empty-mark">◎</span><strong>{{ t('profiles.roleEmpty') }}</strong><button class="primary-button" type="button" @click="newRole">{{ t('profiles.newRole') }}</button></div></div></div>
  </div>
</template>
