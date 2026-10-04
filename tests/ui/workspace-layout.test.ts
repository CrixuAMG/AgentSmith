// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/renderer/i18n';
import ProjectsPage from '@/renderer/pages/ProjectsPage.vue';
import { store } from '@/renderer/services/store';
import { DEFAULT_CONFIG, DEFAULT_GOALS, DEFAULT_GUARDRAILS, DEFAULT_PROFILES, DEFAULT_PROVIDER_SETTINGS, DEFAULT_ROLES, DEFAULT_VCS_SETTINGS } from '@/shared/defaults';
import { DEFAULT_WORKSPACE_LAYOUT } from '@/shared/layout';

const savedConfigs: Array<Record<string, unknown>> = [];
const workspaceInstructions = vi.hoisted(() => ({ files: [] as Array<Record<string, unknown>>, writes: [] as unknown[][] }));

vi.mock('@/renderer/services/api', () => ({
  api: {
    loadSnapshot: async () => ({}),
    saveResource: async (key: string, value: unknown) => {
      if (key === 'config') savedConfigs.push(JSON.parse(JSON.stringify(value)) as Record<string, unknown>);
    },
    scanProject: async () => [],
    gitStatus: async () => ({ isRepository: true, branch: 'main', ahead: 0, behind: 0, changes: [], error: null }),
    gitDiff: async () => '',
     listInstructions: async () => workspaceInstructions.files,
     readInstruction: async (_project: unknown, relativePath: string) => relativePath === 'AGENTS.md' ? '# Original' : '# Other',
     writeInstruction: async (...args: unknown[]) => { workspaceInstructions.writes.push(args); },
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
    vcsSettings: structuredClone(DEFAULT_VCS_SETTINGS),
    globalInstructions: '',
    providerInstructions: {},
    promptHistory: {},
    promptJobs: [],
    storageRoot: '/tmp/agentsmith',
    warnings: [],
  };
}

async function mountWorkspace() {
  const wrapper = mount(ProjectsPage, { global: { plugins: [i18n] }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

function layout() {
  return store.snapshot?.config.layout;
}

describe('workspace layout', () => {
  beforeEach(() => {
    savedConfigs.length = 0;
    store.snapshot = snapshot();
    store.workspaceTab = 'explorer';
    store.tree = [];
    store.treeLoadedFor = null;
    store.instructionDirty = false;
    store.instructionDraft = '';
    store.instructionOriginalContent = '';
    workspaceInstructions.files = [];
    workspaceInstructions.writes = [];
  });

  it('publishes layout changes as CSS custom properties', async () => {
    const wrapper = await mountWorkspace();
    await wrapper.find('.project-rail .layout-handle').trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();

    expect(document.documentElement.style.getPropertyValue('--rail-width')).toBe(`${layout()?.railWidth}px`);
    expect(document.documentElement.style.getPropertyValue('--explorer-ratio')).toBe(String(layout()?.explorerRatio));
    wrapper.unmount();
  });

  it('persists the selected workspace tab', async () => {
    const wrapper = await mountWorkspace();
    const gitTab = wrapper.findAll('.workspace-tab').find((tab) => tab.text().includes('Git changes'));
    expect(gitTab).toBeDefined();
    await gitTab!.trigger('click');
    await flushPromises();

    expect(store.workspaceTab).toBe('git');
    expect(layout()?.tab).toBe('git');
    expect(savedConfigs.at(-1)?.layout).toEqual({ ...DEFAULT_WORKSPACE_LAYOUT, tab: 'git' });
    wrapper.unmount();
  });

  it('requires explicit confirmation before replacing an existing instruction file', async () => {
    workspaceInstructions.files = [{ relativePath: 'AGENTS.md', absolutePath: '/tmp/example/AGENTS.md', scope: 'project', depth: 0, readable: true }];
    store.workspaceTab = 'instructions';
    const wrapper = await mountWorkspace();
    await wrapper.find('.instruction-textarea').setValue('# Changed');
    await wrapper.find('.instruction-editor .primary-button').trigger('click');
    expect(wrapper.find('.draft-confirm-modal').exists()).toBe(true);
    expect(workspaceInstructions.writes).toHaveLength(0);
    await wrapper.find('.draft-confirm-modal .primary-button').trigger('click');
    await flushPromises();
    expect(workspaceInstructions.writes[0]?.[3]).toBe(true);
    wrapper.unmount();
  });

  it('resizes the rail with the keyboard and persists the clamped value', async () => {
    const wrapper = await mountWorkspace();
    const rail = wrapper.find('.project-rail .layout-handle');

    await rail.trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    expect(layout()?.railWidth).toBeGreaterThan(DEFAULT_WORKSPACE_LAYOUT.railWidth);

    for (let index = 0; index < 40; index += 1) await rail.trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    expect(layout()?.railWidth).toBe(420);
    expect(savedConfigs.at(-1)?.layout).toEqual({ ...DEFAULT_WORKSPACE_LAYOUT, railWidth: 420 });

    for (let index = 0; index < 40; index += 1) await rail.trigger('keydown', { key: 'ArrowLeft' });
    await flushPromises();
    expect(layout()?.railWidth).toBe(180);
    wrapper.unmount();
  });

  it('restores defaults from the reset layout action', async () => {
    const wrapper = await mountWorkspace();
    await wrapper.find('.project-rail .layout-handle').trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    await wrapper.findAll('.workspace-tab')[1].trigger('click');
    await flushPromises();

    const reset = wrapper.findAll('button').find((button) => button.attributes('aria-label') === 'Reset layout');
    await reset?.trigger('click');
    await flushPromises();

    expect(layout()).toEqual(DEFAULT_WORKSPACE_LAYOUT);
    expect(store.workspaceTab).toBe('explorer');
    expect(savedConfigs.at(-1)?.layout).toEqual(DEFAULT_WORKSPACE_LAYOUT);
    wrapper.unmount();
  });
});
