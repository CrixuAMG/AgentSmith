<template>
  <div v-if="open" class="modal-backdrop" @click.self="deny">
    <section class="confirm-modal" role="dialog" aria-modal="true">
      <span class="eyebrow">External directory access requested</span>
      <h2>Grant access?</h2>
      <p>A tool is requesting access to:</p>
      <code class="mono">{{ request?.path }}</code>
      <p class="muted small">Scope default: project</p>
      <div class="modal-actions">
        <button class="secondary-button" type="button" @click="deny">Deny</button>
        <button class="secondary-button" type="button" @click="once">Allow once</button>
        <button class="secondary-button" type="button" @click="session">Allow this session</button>
        <button class="primary-button" type="button" @click="project">Allow for this project</button>
        <button class="secondary-button" type="button" @click="global">Allow globally</button>
      </div>
    </section>
  </div>
</template>
<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';

interface PermReq { path: string; tool?: string }

defineProps<{ open: boolean; request: PermReq | null }>()
const emit = defineEmits<{
  (e: 'grant', res: { scope: 'once'|'session'|'project'|'global' }): void
  (e: 'deny'): void
}>()
function deny(){ emit('deny') }
function once(){ emit('grant', { scope: 'once' }) }
function session(){ emit('grant', { scope: 'session' }) }
function project(){ emit('grant', { scope: 'project' }) }
function global(){ emit('grant', { scope: 'global' }) }
</script>
