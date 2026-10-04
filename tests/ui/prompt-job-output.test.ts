// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PromptJobPage from '@/renderer/pages/PromptJobPage.vue';
import i18n from '@/renderer/i18n';
import { store } from '@/renderer/services/store';
import { DEFAULT_CONFIG, DEFAULT_GOALS, DEFAULT_GUARDRAILS, DEFAULT_PROFILES, DEFAULT_PROVIDER_SETTINGS, DEFAULT_ROLES, DEFAULT_VCS_SETTINGS } from '@/shared/defaults';
import type { PromptJob } from '@/shared/types';

vi.mock('@/renderer/services/api', () => ({
  api: {
    cancelProcess: async () => {},
    onProcessEvent: () => () => {},
  },
}));

function snapshot() {
  return {
    config: { ...structuredClone(DEFAULT_CONFIG), lastProjectId: 'project-1' },
    projects: [{ id: 'project-1', name: 'Example', path: '/tmp/example', lastOpenedAt: '2026-10-04T00:00:00.000Z' }],
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

const job: PromptJob = {
  id: 'job-1',
  projectId: 'project-1',
  historyEntryId: null,
  task: 'Inspect the repository',
  state: 'completed',
  executionId: 'exec-1',
  command: 'opencode run <prompt>',
  output: [
    { kind: 'system', text: '\u001b[33mQueued\u001b[0m' },
    { kind: 'stderr', text: '\u001b[2mprovider log\u001b[0m' },
    { kind: 'stdout', text: '\u001b[32mAgent answer\u001b[0m' },
    { kind: 'error', text: 'A failure detail' },
  ],
  exitCode: 0,
  providerId: 'opencode',
  modelId: null,
  purpose: 'task',
};

describe('prompt job output', () => {
  beforeEach(() => {
    store.snapshot = snapshot();
    store.jobs = [{ ...job, output: [...job.output] }];
    store.activeJobId = job.id;
  });

  it('removes ANSI escapes and filters the output streams', async () => {
    const wrapper = mount(PromptJobPage, { global: { plugins: [i18n] } });
    await flushPromises();

    expect(wrapper.find('.execution-output').text()).toContain('Agent answer');
    expect(wrapper.find('.execution-output').text()).not.toContain('\u001b');
    expect(wrapper.find('.output-filter-bar').text()).toContain('Agent output');

    const agentFilter = wrapper.findAll('.output-filter-bar button').find((button) => button.text().includes('Agent output'));
    await agentFilter?.trigger('click');
    await flushPromises();

    expect(wrapper.find('.execution-output').text()).toContain('OUTAgent answer');
    expect(wrapper.find('.execution-output').text()).not.toContain('provider log');
    expect(wrapper.find('.execution-output').text()).not.toContain('Queued');
    wrapper.unmount();
  });
});
