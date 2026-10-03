import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterAll, describe, expect, it } from 'vitest';

const configRoot = mkdtempSync(path.join(os.tmpdir(), 'agentsmith-config-'));
process.env.AGENTSMITH_CONFIG_ROOT = configRoot;
const require = createRequire(import.meta.url);
const configStore = require('../../electron/config-store.cjs') as {
  loadSnapshot: () => Promise<{ config: { theme: string; maxConcurrentJobs: number; layout: { version: number; railWidth: number; explorerRatio: number; tab: string } }; providerInstructions: Record<string, string>; promptHistory: Record<string, Array<{ prompt: string }>>; promptJobs: Array<{ state: string }>; storageRoot: string; warnings: string[] }>;
  saveResource: (key: string, value: unknown) => Promise<void>;
};

afterAll(() => {
  delete process.env.AGENTSMITH_CONFIG_ROOT;
  rmSync(configRoot, { recursive: true, force: true });
});

describe('configuration storage', () => {
  it('creates modular defaults and persists an atomic resource', async () => {
    const initial = await configStore.loadSnapshot();
    expect(initial.storageRoot).toBe(configRoot);
    expect(initial.config.theme).toBe('dark');
    expect(initial.config.maxConcurrentJobs).toBe(2);
    await configStore.saveResource('config', { ...initial.config, theme: 'light' });
    const saved = await configStore.loadSnapshot();
    expect(saved.config.theme).toBe('light');
    expect(readFileSync(path.join(configRoot, 'config.json'), 'utf8')).toContain('"theme": "light"');
    await configStore.saveResource('providerInstructions', { opencode: 'Use read-only inspection first.' });
    const withInstructions = await configStore.loadSnapshot();
    expect(withInstructions.providerInstructions).toEqual({ opencode: 'Use read-only inspection first.' });
    expect(existsSync(path.join(configRoot, 'providers', 'instructions.json'))).toBe(true);
    await configStore.saveResource('promptHistory', { 'project-1': [{
     id: 'run-1', executedAt: '2026-10-02T00:00:00.000Z', task: 'Inspect the project', prompt: 'Inspect the project', providerId: 'opencode', modelId: null, variant: {}, roleId: null, roleName: null, goalIds: [], guardrailProfileId: null, guardrailProfileName: null, command: 'opencode run', status: 'completed', exitCode: 0,
       goalNames: [], contexts: { globalInstructions: true, providerInstructions: false, projectInstructions: true, nestedInstructions: false, gitStatus: true, gitDiff: false, projectStructure: true, readme: false, composerJson: false, packageJson: false, selectedFiles: false },
     }] });
    expect((await configStore.loadSnapshot()).promptHistory['project-1'][0].prompt).toBe('Inspect the project');
    await configStore.saveResource('promptJobs', [{
      id: 'job-1', projectId: 'project-1', historyEntryId: 'run-1', task: 'Inspect the project', state: 'completed', executionId: 'exec-1', command: 'opencode run',
      output: [{ kind: 'stdout', text: 'done' }], exitCode: 0, providerId: 'opencode', modelId: null, purpose: 'task', outputBytes: 4, outputTruncated: false,
      error: null, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:01.000Z', finishedAt: '2026-10-02T00:00:01.000Z',
    }]);
    expect((await configStore.loadSnapshot()).promptJobs[0].state).toBe('completed');
  });

  it('persists a workspace layout and repairs malformed layout values in place', async () => {
    const initial = await configStore.loadSnapshot();
    expect(initial.config.layout).toEqual({ version: 1, railWidth: 245, explorerRatio: 0.335, tab: 'explorer' });

    await configStore.saveResource('config', { ...initial.config, layout: { version: 1, railWidth: 320, explorerRatio: 0.4, tab: 'git' } });
    const saved = await configStore.loadSnapshot();
    expect(saved.config.layout).toEqual({ version: 1, railWidth: 320, explorerRatio: 0.4, tab: 'git' });

    // A document written before the layout existed keeps loading and gains defaults.
    const legacy = { version: 1, locale: 'en', theme: 'light', showHiddenFiles: false, lastProjectId: null, activeProfileId: null };
    writeFileSync(path.join(configRoot, 'config.json'), JSON.stringify(legacy), 'utf8');
    const upgraded = await configStore.loadSnapshot();
    expect(upgraded.config.theme).toBe('light');
    expect(upgraded.config.layout).toEqual({ version: 1, railWidth: 245, explorerRatio: 0.335, tab: 'explorer' });
    expect(JSON.parse(readFileSync(path.join(configRoot, 'config.json'), 'utf8')).layout.tab).toBe('explorer');

    // Out-of-range and unknown values are clamped instead of quarantining the whole config.
    writeFileSync(path.join(configRoot, 'config.json'), JSON.stringify({ ...legacy, layout: { version: 7, railWidth: 'wide', explorerRatio: 99, tab: 'not-a-tab' } }), 'utf8');
    const clamped = await configStore.loadSnapshot();
    expect(clamped.warnings).toEqual([]);
    expect(clamped.config.layout).toEqual({ version: 1, railWidth: 245, explorerRatio: 0.6, tab: 'explorer' });

    await expect(configStore.saveResource('config', { ...legacy, layout: { version: 1, railWidth: 9999, explorerRatio: -4, tab: 'instructions' } })).resolves.toBeUndefined();
    expect((await configStore.loadSnapshot()).config.layout).toEqual({ version: 1, railWidth: 420, explorerRatio: 0.2, tab: 'instructions' });
  });

  it('quarantines malformed JSON instead of crashing', async () => {
    writeFileSync(path.join(configRoot, 'config.json'), '{ malformed', 'utf8');
    const recovered = await configStore.loadSnapshot();
    expect(recovered.config.theme).toBe('dark');
    expect(recovered.warnings.some((warning) => warning.includes('config.json'))).toBe(true);
  });

  it('rejects invalid resource shapes before writing them', async () => {
    await expect(configStore.saveResource('config', { theme: 'dark' })).rejects.toThrow('Invalid config resource');
    await expect(configStore.saveResource('providerInstructions', { opencode: 42 })).rejects.toThrow('Invalid providerInstructions resource');
  });

  it('migrates version zero documents and preserves envelope fields', async () => {
    writeFileSync(path.join(configRoot, 'config.json'), JSON.stringify({ version: 0, locale: 'en', theme: 'light', showHiddenFiles: false, lastProjectId: null, activeProfileId: null, customField: 'keep' }), 'utf8');
    const migrated = await configStore.loadSnapshot();
    expect(migrated.config.theme).toBe('light');
    expect(JSON.parse(readFileSync(path.join(configRoot, 'config.json'), 'utf8')).version).toBe(1);

    writeFileSync(path.join(configRoot, 'projects.json'), JSON.stringify({ version: 1, projects: [], customField: 'keep' }), 'utf8');
    await configStore.saveResource('projects', []);
    expect(JSON.parse(readFileSync(path.join(configRoot, 'projects.json'), 'utf8')).customField).toBe('keep');
  });

  it('does not quarantine or overwrite future schema versions', async () => {
    const future = { version: 99, theme: 'future', untouched: true };
    writeFileSync(path.join(configRoot, 'config.json'), JSON.stringify(future), 'utf8');
    const snapshot = await configStore.loadSnapshot();
    expect(snapshot.warnings.some((warning) => warning.includes('newer schema version'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(configRoot, 'config.json'), 'utf8'))).toEqual(future);
  });
});
