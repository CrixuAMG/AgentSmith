// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import IssuesPage from '@/renderer/pages/IssuesPage.vue';
import i18n from '@/renderer/i18n';
import { store } from '@/renderer/services/store';
import { DEFAULT_CONFIG, DEFAULT_GOALS, DEFAULT_GUARDRAILS, DEFAULT_PROFILES, DEFAULT_PROVIDER_SETTINGS, DEFAULT_ROLES, DEFAULT_VCS_SETTINGS } from '@/shared/defaults';
import type { RepositoryIssue, RepositoryLink } from '@/shared/types';

const calls: { credentials: Array<string | null>; created: unknown[]; updated: Array<{ number: number; patch: unknown }> } = {
  credentials: [],
  created: [],
  updated: [],
};
let linked = true;
let instructions = '## Repository integration\n\n- issues: allow\n- branches: allow\n';
let issues: RepositoryIssue[] = [];
let issueError: string | null = null;
let processListener: ((event: { executionId: string; kind: string; text?: string }) => void) | null = null;

const issue: RepositoryIssue = {
  number: 42,
  title: 'The sync worker stops on a transient error',
  body: 'It should retry.',
  state: 'open',
  url: 'https://github.com/example/agent/issues/42',
  author: 'maintainer',
  labels: ['bug'],
  comments: 1,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
};

vi.mock('@/renderer/services/api', () => ({
  api: {
    discoverVcsProviders: async () => [{
      installation: { providerId: 'github', connected: true, account: 'octocat', error: null },
      capabilities: { supportsIssues: true, supportsBranches: true, supportsPullRequests: true, supportsMerge: false },
      credential: { providerId: 'github', configured: true, source: 'session' },
      note: 'Merging is not offered by AgentSmith, regardless of the credential scope.',
    }],
    setVcsCredential: async (_providerId: string, token: string | null) => {
      calls.credentials.push(token);
      return { providerId: 'github', configured: Boolean(token), source: token ? 'session' : 'none' };
    },
    gitRemote: async () => (linked
      ? { remote: 'origin', link: { providerId: 'github', host: 'github.com', owner: 'example', name: 'agent', defaultBranch: 'main' }, error: null }
      : { remote: null, link: null, error: 'This project has no Git remote to link a repository to.' }),
    listInstructions: async () => [{ relativePath: 'AGENTS.md', scope: 'project', title: 'AGENTS.md' }],
    readInstruction: async () => instructions,
    listRepositoryIssues: async () => ({ ok: issueError === null, repository: 'example/agent', issues, error: issueError }),
    discoverProviders: async () => [{ installation: { providerId: 'opencode', installed: true, executable: 'opencode', version: '1.0.0', error: null }, capabilities: { supportsModelDiscovery: true, supportsReasoningEffort: true, supportsStreaming: true, supportsInteractiveTerminal: true, supportsPermissionModes: true, supportsSandboxing: false, supportsWorkingDirectory: true }, models: [], modelDiscoveryAvailable: true, note: null, executionSupported: true }],
    scanProject: async () => [{ name: 'README.md', relativePath: 'README.md', kind: 'file' }],
    gitStatus: async () => ({ isRepository: true, branch: 'main', ahead: 0, behind: 0, changes: [], error: null }),
    readFile: async () => ({ relativePath: 'README.md', content: '# Example', language: 'markdown', lineCount: 1, size: 9 }),
    startProcess: async () => {
      const executionId = 'analysis-exec-1';
      queueMicrotask(() => {
        processListener?.({ executionId, kind: 'started' });
        processListener?.({ executionId, kind: 'stdout', text: JSON.stringify([{ title: 'Add retry handling', body: 'Retry transient failures.', labels: ['bug'] }]) });
        processListener?.({ executionId, kind: 'completed' });
      });
      return { executionId, command: 'opencode run <prompt>' };
    },
    onProcessEvent: (callback: typeof processListener) => {
      processListener = callback;
      return () => { processListener = null; };
    },
    createRepositoryIssue: async (_project: unknown, draft: unknown) => {
      calls.created.push(draft);
      return { ok: true, issue: { ...issue, ...(draft as RepositoryIssue) }, error: null };
    },
    updateRepositoryIssue: async (_project: unknown, number: number, patch: unknown) => {
      calls.updated.push({ number, patch });
      return { ok: true, issue: { ...issue, number, ...(patch as Partial<RepositoryIssue>) }, error: null };
    },
    saveResource: async () => {},
  },
}));

function repository(): RepositoryLink {
  return { providerId: 'github', host: 'github.com', owner: 'example', name: 'agent', defaultBranch: 'main' };
}

function snapshot() {
  return {
    config: { ...structuredClone(DEFAULT_CONFIG), lastProjectId: 'project-1' },
    projects: [{ id: 'project-1', name: 'Example', path: '/tmp/example', lastOpenedAt: '2026-10-02T00:00:00.000Z', repository: repository() }],
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

async function mountPage() {
  const wrapper = mount(IssuesPage, { global: { plugins: [i18n] } });
  await flushPromises();
  return wrapper;
}

describe('issues page', () => {
  beforeEach(() => {
    calls.credentials.length = 0;
    calls.created.length = 0;
    calls.updated.length = 0;
    linked = true;
    instructions = '## Repository integration\n\n- issues: allow\n- branches: allow\n';
    issues = [{ ...issue }];
    issueError = null;
    processListener = null;
    store.snapshot = snapshot();
    store.activeView = 'issues';
    store.repositoryHandoff = null;
  });

  it('shows the linked repository and the capabilities read from AGENTS.md', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('.issues-connection-grid').text()).toContain('example/agent');
    expect(wrapper.find('.issues-connection-grid').text()).toContain('Issues: Read and write');

    const permissions = wrapper.findAll('.prompt-card')[2].text();
    expect(permissions).toContain('allowed');
    expect(permissions).toContain('never allowed');
    expect(permissions).not.toMatch(/Merge a pull request\s*✓/);
  });

  it('hands a generated prompt to Prompt Studio', async () => {
    const wrapper = await mountPage();
    await wrapper.find('.issues-list-item').trigger('click');
    await flushPromises();

    await wrapper.findAll('button').find((button) => button.text().includes('Generate prompt'))?.trigger('click');
    await flushPromises();

    expect(store.activeView).toBe('prompt-studio');
    expect(store.repositoryHandoff).toMatchObject({ issueNumber: 42, repository: 'example/agent' });
    expect(store.repositoryHandoff?.text).toContain('Implement issue #42 in example/agent');
    expect(store.repositoryHandoff?.text).toContain('Never merge anything');
    expect(wrapper.find('.issues-actions-panel').text()).toContain('cannot merge a pull request');
  });

  it('creates an issue and reports the new number', async () => {
    const wrapper = await mountPage();
    await wrapper.findAll('button').find((button) => button.text().includes('New issue'))?.trigger('click');
    await flushPromises();

    await wrapper.find('.issues-editor input[type="text"]').setValue('Add a retry policy');
    await wrapper.find('.issues-editor textarea').setValue('Retry with backoff.');
    await wrapper.findAll('.issues-editor button').find((button) => button.text().includes('Save issue'))?.trigger('click');
    await flushPromises();

    expect(calls.created).toEqual([{ title: 'Add a retry policy', body: 'Retry with backoff.', labels: [] }]);
    expect(wrapper.find('.global-alert').text()).toContain('#42');
  });

  it('edits an existing issue through the title, body, and labels form', async () => {
    const wrapper = await mountPage();
    await wrapper.find('.issues-list-item').trigger('click');
    await flushPromises();

    await wrapper.find('.issues-editor input[type="text"]').setValue('Retry handling');
    await wrapper.find('.issues-editor textarea').setValue('Updated details.');
    await wrapper.findAll('.issues-editor input').at(1)?.setValue('bug, testing');
    await wrapper.findAll('.issues-editor button').find((button) => button.text().includes('Save issue'))?.trigger('click');
    await flushPromises();

    expect(calls.updated).toContainEqual({ number: 42, patch: { title: 'Retry handling', body: 'Updated details.', labels: ['bug', 'testing'] } });
    expect(wrapper.find('.global-alert').text()).toContain('updated');
  });

  it('analyzes the project, lets the user review drafts, and creates the selected issue', async () => {
    const wrapper = await mountPage();
    await wrapper.findAll('button').find((button) => button.text().includes('Analyze current status'))?.trigger('click');
    await flushPromises();

    expect(wrapper.findAll('.issues-proposal-item')).toHaveLength(1);
    expect(wrapper.find('.issues-proposal-item').text()).toContain('Add retry handling');
    await wrapper.find('.issues-analysis-actions .primary-button').trigger('click');
    await flushPromises();

    expect(calls.created).toContainEqual({ title: 'Add retry handling', body: 'Retry transient failures.', labels: ['bug'] });
    expect(wrapper.find('.issues-created-list').text()).toContain('#42');
  });

  it('refuses an issue without a title before calling the provider', async () => {
    const wrapper = await mountPage();
    await wrapper.findAll('button').find((button) => button.text().includes('New issue'))?.trigger('click');
    await flushPromises();

    await wrapper.findAll('.issues-editor button').find((button) => button.text().includes('Save issue'))?.trigger('click');
    await flushPromises();

    expect(calls.created).toHaveLength(0);
    expect(wrapper.find('.issues-editor .inline-error').text()).toContain('needs a title');
  });

  it('closes and reopens an existing issue without offering a merge', async () => {
    const wrapper = await mountPage();
    await wrapper.find('.issues-list-item').trigger('click');
    await flushPromises();

    await wrapper.findAll('button').find((button) => button.text().includes('Close issue'))?.trigger('click');
    await flushPromises();
    expect(calls.updated).toEqual([{ number: 42, patch: { state: 'closed' } }]);
    expect(wrapper.findAll('button').some((button) => /merge/i.test(button.text()))).toBe(false);
  });

  it('surfaces a provider error instead of an empty list', async () => {
    issueError = 'The repository provider refused the request: forbidden.';
    issues = [];
    const wrapper = await mountPage();
    expect(wrapper.find('.inline-error').text()).toContain('forbidden');
    expect(wrapper.find('.compact-empty').exists()).toBe(true);
  });

  it('offers to link a project whose remote is not detected', async () => {
    store.snapshot!.projects[0].repository = null as unknown as RepositoryLink;
    linked = false;
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('not linked to a hosted repository');
    await wrapper.findAll('button').find((button) => button.text().includes('Link from Git remote'))?.trigger('click');
    await flushPromises();

    expect(wrapper.find('.inline-error').text()).toContain('no Git remote');
  });
});
