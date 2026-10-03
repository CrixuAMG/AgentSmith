// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PromptStudioPage from '@/renderer/pages/PromptStudioPage.vue';
import i18n from '@/renderer/i18n';
import { store } from '@/renderer/services/store';
import { DEFAULT_CONFIG, DEFAULT_GOALS, DEFAULT_GUARDRAILS, DEFAULT_PROFILES, DEFAULT_PROVIDER_SETTINGS, DEFAULT_ROLES } from '@/shared/defaults';

const savedSuggestions: string[] = [];
const suggestionFailure: { message: string | null } = { message: null };
let processCallback: ((event: { executionId: string; kind: string; text?: string }) => void) | null = null;

vi.mock('@/renderer/services/api', () => ({
  api: {
    loadSnapshot: async () => ({}),
    saveResource: async () => {},
    scanProject: async () => [],
    gitStatus: async () => ({ isRepository: false, branch: null, ahead: 0, behind: 0, changes: [], error: null }),
    listInstructions: async () => [],
    readInstruction: async () => '',
    readFile: async () => { throw new Error('unavailable'); },
     discoverProviders: async () => [{ installation: { providerId: 'opencode', installed: true, version: '1.0.0' }, models: [] }],
     saveSuggestion: async (_project: unknown, content: string) => {
      if (suggestionFailure.message) throw new Error(suggestionFailure.message);
      savedSuggestions.push(content);
       return { relativePath: `suggestions/Example/2026-10-02T0${savedSuggestions.length}.md`, absolutePath: `/tmp/${savedSuggestions.length}.md`, savedAt: '2026-10-02T00:00:00.000Z' };
     },
     startProcess: async () => ({ executionId: 'suggestion-1', command: 'opencode run <prompt>' }),
   },
   onProcessEvent: (callback: typeof processCallback) => { processCallback = callback; return () => { processCallback = null; }; },
}));

function snapshot() {
  return {
    config: { ...structuredClone(DEFAULT_CONFIG), lastProjectId: 'project-1' },
    projects: [{ id: 'project-1', name: 'Example', path: '/tmp/example', lastOpenedAt: '2026-10-02T00:00:00.000Z' }],
    goals: structuredClone(DEFAULT_GOALS),
    roles: structuredClone(DEFAULT_ROLES),
    guardrails: structuredClone(DEFAULT_GUARDRAILS),
    profiles: structuredClone(DEFAULT_PROFILES),
    providerSettings: structuredClone(DEFAULT_PROVIDER_SETTINGS),
    globalInstructions: '',
    providerInstructions: {},
    promptHistory: {},
    storageRoot: '/tmp/agentsmith',
    warnings: [],
  };
}

async function mountStudio() {
  const wrapper = mount(PromptStudioPage, { global: { plugins: [i18n] } });
  await flushPromises();
  return wrapper;
}

function buttonByText(wrapper: Awaited<ReturnType<typeof mountStudio>>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text));
}

describe('prompt studio suggestions', () => {
  beforeEach(() => {
    savedSuggestions.length = 0;
    suggestionFailure.message = null;
    store.snapshot = snapshot();
    store.activeView = 'prompt-studio';
    store.tree = [];
    store.treeLoadedFor = null;
    store.promptFiles = [];
    store.git = null;
    processCallback = null;
  });

  it('reveals the composer action, saves the prompt, and rotates on another suggestion', async () => {
    const wrapper = await mountStudio();
    expect(wrapper.find('button.suggestion-trigger').exists()).toBe(true);
    expect(wrapper.find('.suggestion-panel').exists()).toBe(false);

    await wrapper.find('button.suggestion-trigger').trigger('click');
    await flushPromises();
    expect(processCallback).not.toBeNull();
    processCallback?.({ executionId: 'suggestion-1', kind: 'stdout', text: '1. Add a searchable command palette\n2. Add keyboard shortcuts' });
    processCallback?.({ executionId: 'suggestion-1', kind: 'completed' });
    await flushPromises();
    expect(wrapper.find('.suggestion-panel').exists()).toBe(true);
    expect(savedSuggestions).toHaveLength(1);
    expect(wrapper.find('.suggestion-panel').text()).toContain('suggestions/Example/2026-10-02T01.md');
    expect(wrapper.find('.suggestion-text').text()).toContain('Perspective: Senior Backend Engineer');

    await buttonByText(wrapper, 'Another suggestion')?.trigger('click');
    await flushPromises();
    processCallback?.({ executionId: 'suggestion-1', kind: 'stdout', text: '1. Add a resilient queue' });
    processCallback?.({ executionId: 'suggestion-1', kind: 'completed' });
    await flushPromises();
    expect(savedSuggestions).toHaveLength(2);
    expect(savedSuggestions[1]).not.toBe(savedSuggestions[0]);
    expect(wrapper.find('.suggestion-text').text()).not.toBe(savedSuggestions[0]);
  });

  it('accepts a suggestion into the task without discarding existing text', async () => {
    const wrapper = await mountStudio();
    const textarea = wrapper.find('.task-editor textarea');
    await textarea.setValue('Keep the existing request.');
    await wrapper.find('button.suggestion-trigger').trigger('click');
    await flushPromises();
    processCallback?.({ executionId: 'suggestion-1', kind: 'stdout', text: '1. Add a test matrix' });
    processCallback?.({ executionId: 'suggestion-1', kind: 'completed' });
    await flushPromises();

    await wrapper.find('.suggestion-ideas input').setValue(true);
    await buttonByText(wrapper, 'Execute selected ideas')?.trigger('click');
    await flushPromises();

    const value = (textarea.element as HTMLTextAreaElement).value;
    expect(value).toContain('Add a test matrix');
    expect(value).toContain('Keep the existing request.');
    expect(value.indexOf(savedSuggestions[0])).toBeLessThan(value.indexOf('Keep the existing request.'));
    expect(wrapper.find('.suggestion-meta').text()).toContain('Accepted into the task');
  });

  it('surfaces storage failures instead of showing an unsaved suggestion', async () => {
    suggestionFailure.message = 'Suggestion storage requires the desktop application.';
    const wrapper = await mountStudio();

    await wrapper.find('button.suggestion-trigger').trigger('click');
    await flushPromises();
    processCallback?.({ executionId: 'suggestion-1', kind: 'stdout', text: '1. A suggestion' });
    processCallback?.({ executionId: 'suggestion-1', kind: 'completed' });
    await flushPromises();

    expect(savedSuggestions).toHaveLength(0);
    expect(wrapper.find('.suggestion-panel').exists()).toBe(false);
    expect(wrapper.find('.inline-error').text()).toContain('Suggestion storage requires the desktop application.');
  });

  it('does not offer the action without a selected project', async () => {
    store.snapshot = { ...snapshot(), config: { ...structuredClone(DEFAULT_CONFIG), lastProjectId: null } };
    const wrapper = await mountStudio();
    expect(wrapper.find('button.suggestion-trigger').exists()).toBe(false);
  });

  it('shows the executed prompt, timestamp, and applied settings', async () => {
    store.snapshot = {
      ...snapshot(),
      promptHistory: {
        'project-1': [{
          id: 'run-1',
          executedAt: '2026-10-02T12:34:56.000Z',
          task: 'Inspect the project',
          prompt: 'Inspect the project with the selected context.',
          providerId: 'opencode',
          modelId: 'gpt-5',
          variant: { reasoningEffort: 'high' },
          roleId: 'role-1',
          roleName: 'Senior Engineer',
          goalIds: ['goal-1'],
          goalNames: ['Keep changes focused'],
          guardrailProfileId: 'default-security',
          guardrailProfileName: 'Default security',
          contexts: {
            globalInstructions: true,
            providerInstructions: false,
            projectInstructions: true,
            nestedInstructions: false,
            gitStatus: true,
            gitDiff: false,
            projectStructure: true,
            readme: false,
            composerJson: false,
            packageJson: false,
            selectedFiles: false,
          },
          command: 'opencode run <prompt>',
          status: 'completed',
          exitCode: 0,
        }],
      },
    };
    const wrapper = await mountStudio();

    expect(wrapper.find('.prompt-history-entry').text()).toContain('Inspect the project with the selected context.');
    expect(wrapper.find('time').attributes('datetime')).toBe('2026-10-02T12:34:56.000Z');
    expect(wrapper.find('.history-settings').text()).toContain('Keep changes focused');
    expect(wrapper.find('.history-settings').text()).toContain('Global instructions');
    expect(wrapper.find('.history-settings').text()).toContain('reasoningEffort: high');
  });
});
