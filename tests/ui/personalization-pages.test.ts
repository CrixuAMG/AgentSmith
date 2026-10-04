// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/renderer/i18n';
import AgentProfilesPage from '@/renderer/pages/AgentProfilesPage.vue';
import PersonalizationPage from '@/renderer/pages/PersonalizationPage.vue';
import { store } from '@/renderer/services/store';
import { DEFAULT_CONFIG, DEFAULT_GOALS, DEFAULT_GUARDRAILS, DEFAULT_PROFILES, DEFAULT_PROVIDER_SETTINGS, DEFAULT_ROLES, DEFAULT_VCS_SETTINGS } from '@/shared/defaults';
import type { AppSnapshot } from '@/shared/types';

const saves = vi.hoisted(() => [] as Array<{ key: string; value: unknown }>);

vi.mock('@/renderer/services/api', () => ({
  api: {
    loadSnapshot: async () => ({}),
    saveResource: async (key: string, value: unknown) => {
      saves.push({ key, value: JSON.parse(JSON.stringify(value)) });
    },
    discoverProviders: async () => [],
  },
  onProcessEvent: () => () => {},
}));

function snapshot(): AppSnapshot {
  return {
    config: structuredClone(DEFAULT_CONFIG),
    projects: [],
    goals: structuredClone(DEFAULT_GOALS),
    roles: structuredClone(DEFAULT_ROLES),
    guardrails: structuredClone(DEFAULT_GUARDRAILS),
    profiles: structuredClone(DEFAULT_PROFILES),
    providerSettings: structuredClone(DEFAULT_PROVIDER_SETTINGS),
    vcsSettings: structuredClone(DEFAULT_VCS_SETTINGS),
    globalInstructions: '',
    providerInstructions: {},
    promptHistory: {},
    promptJobs: [],
    storageRoot: '/tmp/agentsmith',
    warnings: [],
  };
}

function mountPage(component: typeof AgentProfilesPage | typeof PersonalizationPage) {
  return mount(component, { global: { plugins: [i18n] } });
}

describe('agent profiles page', () => {
  beforeEach(() => {
    saves.length = 0;
    store.snapshot = snapshot();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders the stored profiles, roles, and guardrail options', async () => {
    const wrapper = mountPage(AgentProfilesPage);
    await flushPromises();

    await wrapper.findAll('.section-tab')[1].trigger('click');
    expect(wrapper.text()).toContain('Default workspace agent');
    expect(wrapper.text()).toContain('Active');

    await wrapper.findAll('.section-tab')[2].trigger('click');
    expect(wrapper.text()).toContain('Security Reviewer');
  });

  it('persists an edited profile without cloning the reactive draft', async () => {
    const wrapper = mountPage(AgentProfilesPage);
    await flushPromises();
    await wrapper.findAll('.section-tab')[1].trigger('click');

    await wrapper.find('.editor-form input[type="text"]').setValue('Backend reviewer');
    await wrapper.findAll('.editor-actions .primary-button')[0].trigger('click');
    await flushPromises();

    expect(saves.at(-1)?.key).toBe('profiles');
    const saved = saves.at(-1)?.value as Array<{ name: string }>;
    expect(saved[0]?.name).toBe('Backend reviewer');
  });

  it('persists a reordering of goals from the personalization page', async () => {
    const wrapper = mountPage(PersonalizationPage);
    await flushPromises();

    await wrapper.find('.order-buttons .small-icon-button:nth-child(3)').trigger('click');
    await flushPromises();

    expect(saves.at(-1)?.key).toBe('goals');
    const saved = (saves.at(-1)?.value as Array<{ id: string; order: number }>).slice().sort((left, right) => left.order - right.order);
    expect(saved.map((goal) => goal.id)).toEqual(['test-coverage', 'maintainability', 'security', 'minimal-change']);
  });
});

describe('personalization page', () => {
  beforeEach(() => {
    saves.length = 0;
    store.snapshot = snapshot();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders goals and guardrail rules with their enforcement details', async () => {
    const wrapper = mountPage(PersonalizationPage);
    await flushPromises();
    expect(wrapper.text()).toContain('Maintainability');
    expect(wrapper.text()).toContain('Use this goal in new prompts');

    await wrapper.findAll('.section-tab')[1].trigger('click');
    expect(wrapper.text()).toContain('Default security');
    const patterns = wrapper.findAll('.rule-grid input[type="text"]').map((input) => (input.element as HTMLInputElement).value);
    expect(patterns).toContain('git reset --hard');
  });

  it('persists an added guardrail rule', async () => {
    const wrapper = mountPage(PersonalizationPage);
    await flushPromises();
    await wrapper.findAll('.section-tab')[1].trigger('click');

    await wrapper.find('.rules-header .secondary-button').trigger('click');
    await wrapper.findAll('.editor-actions .primary-button')[0].trigger('click');
    await flushPromises();

    expect(saves.at(-1)?.key).toBe('guardrails');
    const saved = saves.at(-1)?.value as Array<{ rules: unknown[] }>;
    const initialRuleCount = DEFAULT_GUARDRAILS[0]?.rules.length ?? 0;
    expect(saved[0]?.rules).toHaveLength(initialRuleCount + 1);
  });
});