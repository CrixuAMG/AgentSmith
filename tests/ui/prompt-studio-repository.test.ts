// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PromptStudioPage from '@/renderer/pages/PromptStudioPage.vue';
import i18n from '@/renderer/i18n';
import { store } from '@/renderer/services/store';
import { DEFAULT_CONFIG, DEFAULT_GOALS, DEFAULT_GUARDRAILS, DEFAULT_PROFILES, DEFAULT_PROVIDER_SETTINGS, DEFAULT_ROLES, DEFAULT_VCS_SETTINGS } from '@/shared/defaults';

let projectInstructions = '## Repository integration\n\n- issues: allow\n- branches: allow\n- pull-requests: allow\n';
let processListener: ((event: { executionId: string; kind: string; text?: string }) => void) | null = null;
const mountedWrappers: Array<{ unmount: () => void }> = [];

vi.mock('@/renderer/services/api', () => ({
  api: {
    loadSnapshot: async () => ({}),
    saveResource: async () => {},
    scanProject: async () => [],
    gitStatus: async () => ({ isRepository: false, branch: null, ahead: 0, behind: 0, changes: [], error: null }),
    listInstructions: async () => [{ relativePath: 'AGENTS.md', scope: 'project', title: 'AGENTS.md' }],
    readInstruction: async () => projectInstructions,
    readFile: async () => { throw new Error('unavailable'); },
    discoverProviders: async () => [{ installation: { providerId: 'opencode', installed: true, version: '1.0.0' }, models: [] }],
     startProcess: async (request: { prompt?: string }) => {
       const executionId = 'exec-1';
       if (request.prompt?.startsWith('Rewrite and improve')) {
         queueMicrotask(() => {
           processListener?.({ executionId, kind: 'stdout', text: 'build · gpt-5.6-luna\n\nRewritten task description.' });
           processListener?.({ executionId, kind: 'completed' });
         });
       }
       return { executionId, command: 'opencode run <prompt>' };
     },
   },
   onProcessEvent: (callback: typeof processListener) => {
     processListener = callback;
     return () => { processListener = null; };
   },
}));

function snapshot() {
  return {
    config: { ...structuredClone(DEFAULT_CONFIG), lastProjectId: 'project-1' },
    projects: [{
      id: 'project-1',
      name: 'Example',
      path: '/tmp/example',
      lastOpenedAt: '2026-10-02T00:00:00.000Z',
       repository: { providerId: 'github' as const, host: 'github.com', owner: 'example', name: 'agent', defaultBranch: 'main' },
    }],
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

async function mountStudio() {
  const wrapper = mount(PromptStudioPage, { global: { plugins: [i18n] } });
  mountedWrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

describe('prompt studio repository workflow', () => {
  beforeEach(() => {
    projectInstructions = '## Repository integration\n\n- issues: allow\n- branches: allow\n- pull-requests: allow\n';
    store.snapshot = snapshot();
    store.activeView = 'prompt-studio';
    store.repositoryHandoff = null;
    store.tree = [];
    store.treeLoadedFor = null;
    store.promptFiles = [];
    processListener = null;
  });

  it('adds the authorized repository operations and the merge prohibition', async () => {
    const wrapper = await mountStudio();
    const sections = wrapper.findAll('.preview-section-tab').map((tab) => tab.text());
    expect(sections.some((label) => label.includes('Repository workflow'))).toBe(true);

    const contractTab = wrapper.findAll('.preview-section-tab').find((tab) => tab.text().includes('Repository workflow'));
    await contractTab?.trigger('click');
    const contract = wrapper.find('.selected-section pre').text();
    expect(contract).toContain('example/agent');
    expect(contract).toContain('MAY create and edit issues');
    expect(contract).toContain('MAY open a pull request');
    expect(contract).toContain('MUST NOT merge');
  });

  it('omits the repository section when no operation is authorized', async () => {
    projectInstructions = '## Repository integration\n\n- issues: deny\n';
    const wrapper = await mountStudio();
    const labels = wrapper.findAll('.preview-section-tab').map((tab) => tab.text());
    expect(labels.some((label) => label.includes('Repository workflow'))).toBe(false);
  });

  it('loads a handed-over issue prompt once and then clears it', async () => {
    store.repositoryHandoff = { title: 'Issue #42', text: 'Implement issue #42 in example/agent', issueNumber: 42, repository: 'example/agent' };
    const wrapper = await mountStudio();

    const textarea = wrapper.find('.task-editor textarea').element as HTMLTextAreaElement;
    expect(textarea.value).toContain('Implement issue #42 in example/agent');
    expect(wrapper.find('.task-editor .toolbar-status').text()).toContain('issue #42');
    expect(store.repositoryHandoff).toBeNull();

    await wrapper.find('.task-editor textarea').setValue('Replaced by hand.');
    await flushPromises();
    expect((wrapper.find('.task-editor textarea').element as HTMLTextAreaElement).value).toBe('Replaced by hand.');
  });

  it('does not put provider build metadata into a rewritten task', async () => {
    const wrapper = await mountStudio();
    await wrapper.find('.task-editor textarea').setValue('Describe the retry behavior.');
    await wrapper.findAll('button').find((button) => button.text().includes('Rewrite prompt'))?.trigger('click');
    await flushPromises();
    await flushPromises();

    expect((wrapper.find('.task-editor textarea').element as HTMLTextAreaElement).value).toBe('Rewritten task description.');
  });
});
