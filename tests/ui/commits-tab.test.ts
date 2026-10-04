// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/renderer/i18n';
import ProjectsPage from '@/renderer/pages/ProjectsPage.vue';
import { store } from '@/renderer/services/store';
import { DEFAULT_CONFIG, DEFAULT_GOALS, DEFAULT_GUARDRAILS, DEFAULT_PROFILES, DEFAULT_PROVIDER_SETTINGS, DEFAULT_ROLES } from '@/shared/defaults';

const commits = [
  {
    hash: 'abc1234567890',
    shortHash: 'abc1234',
    author: 'Test Author',
    date: '2026-10-03T12:00:00Z',
    subject: 'Initial commit',
  },
];

const branches = [
  { name: 'main', isCurrent: true, isRemote: false, upstream: null, ahead: 0, behind: 0, date: '2026-10-03T12:00:00Z' },
];

vi.mock('@/renderer/services/api', () => ({
  api: {
    loadSnapshot: async () => ({}),
    saveResource: async () => {},
    scanProject: async () => [],
    gitStatus: async () => ({ isRepository: true, branch: 'main', ahead: 0, behind: 0, changes: [], error: null }),
    gitDiff: async () => '',
    gitLog: async () => ({ isRepository: true, branch: 'main', commits, error: null }),
    gitBranches: async () => ({ isRepository: true, current: 'main', branches, error: null }),
    listInstructions: async () => [],
    readInstruction: async () => '',
    writeInstruction: async () => {},
    readFile: async () => { throw new Error('unavailable'); },
    discoverProviders: async () => [],
    saveSuggestion: async () => ({ relativePath: '', absolutePath: '', savedAt: '' }),
  },
  onProcessEvent: () => () => {},
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
    promptJobs: [],
    storageRoot: '/tmp/agentsmith',
    warnings: [],
  };
}

describe('commits tab', () => {
  beforeEach(() => {
    store.snapshot = snapshot();
    store.workspaceTab = 'commits';
    store.tree = [];
    store.treeLoadedFor = null;
    store.instructionDirty = false;
    store.instructionDraft = '';
    store.instructionOriginalContent = '';
    store.commits = [];
    store.branches = [];
  });

  it('renders commits when opened', async () => {
    const wrapper = mount(ProjectsPage, { global: { plugins: [i18n] }, attachTo: document.body });
    await flushPromises();

    expect(wrapper.text()).toContain('Initial commit');
    expect(wrapper.text()).toContain('abc1234');
    expect(wrapper.text()).toContain('Test Author');
    wrapper.unmount();
  });
});
