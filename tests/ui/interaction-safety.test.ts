// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/renderer/i18n';
import PermissionGrantModal from '@/renderer/components/Permissions/PermissionGrantModal.vue';
import SettingsPage from '@/renderer/pages/SettingsPage.vue';
import { store } from '@/renderer/services/store';
import { DEFAULT_CONFIG, DEFAULT_GOALS, DEFAULT_GUARDRAILS, DEFAULT_PROFILES, DEFAULT_PROVIDER_SETTINGS, DEFAULT_ROLES, DEFAULT_VCS_SETTINGS } from '@/shared/defaults';
import type { AppSnapshot } from '@/shared/types';

const persistence = vi.hoisted(() => ({ error: null as Error | null, calls: 0 }));

vi.mock('@/renderer/services/api', () => ({
  api: {
    saveResource: async () => {
      persistence.calls += 1;
      if (persistence.error) throw persistence.error;
    },
  },
}));

function snapshot(): AppSnapshot {
  return {
    config: structuredClone(DEFAULT_CONFIG), projects: [], goals: structuredClone(DEFAULT_GOALS),
    roles: structuredClone(DEFAULT_ROLES), guardrails: structuredClone(DEFAULT_GUARDRAILS), profiles: structuredClone(DEFAULT_PROFILES),
    providerSettings: structuredClone(DEFAULT_PROVIDER_SETTINGS), vcsSettings: structuredClone(DEFAULT_VCS_SETTINGS),
    globalInstructions: '', providerInstructions: {}, promptHistory: {}, promptJobs: [], storageRoot: '/tmp/agentsmith', warnings: [],
  };
}

describe('permission grant modal', () => {
  it('identifies the tool, restores focus, and closes on Escape', async () => {
    const origin = document.createElement('button');
    document.body.append(origin);
    origin.focus();
    const wrapper = mount(PermissionGrantModal, {
      attachTo: document.body,
      props: { open: true, request: { path: '/tmp/shared', tool: 'Review Bot' } },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Review Bot');
    expect(document.activeElement).toBe(wrapper.find('section[role="dialog"]').element);
    await wrapper.find('section[role="dialog"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('deny')).toHaveLength(1);
    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(origin);
    wrapper.unmount();
    origin.remove();
  });
});

describe('settings save recovery', () => {
  beforeEach(() => {
    persistence.error = new Error('Storage is unavailable');
    persistence.calls = 0;
    store.snapshot = snapshot();
  });

  it('retains the draft and exposes retry after a failed save', async () => {
    const wrapper = mount(SettingsPage, { global: { plugins: [i18n] } });
    const textarea = wrapper.find('.global-instructions-textarea');
    await textarea.setValue('Keep this draft');
    await wrapper.find('button.primary-button').trigger('click');
    await flushPromises();

    expect(textarea.element).toHaveProperty('value', 'Keep this draft');
    expect(wrapper.find('[role="alert"]').text()).toContain('Storage is unavailable');
    expect(wrapper.find('button.retry-action').exists()).toBe(true);
    persistence.error = null;
    await wrapper.find('button.retry-action').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
