import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterAll, describe, expect, it } from 'vitest';

const configRoot = mkdtempSync(path.join(os.tmpdir(), 'agentsmith-config-'));
process.env.AGENTSMITH_CONFIG_ROOT = configRoot;
const require = createRequire(import.meta.url);
const configStore = require('../../electron/config-store.cjs') as {
  loadSnapshot: () => Promise<{ config: { theme: string }; providerInstructions: Record<string, string>; storageRoot: string; warnings: string[] }>;
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
    await configStore.saveResource('config', { ...initial.config, theme: 'light' });
    const saved = await configStore.loadSnapshot();
    expect(saved.config.theme).toBe('light');
    expect(readFileSync(path.join(configRoot, 'config.json'), 'utf8')).toContain('"theme": "light"');
    await configStore.saveResource('providerInstructions', { opencode: 'Use read-only inspection first.' });
    const withInstructions = await configStore.loadSnapshot();
    expect(withInstructions.providerInstructions).toEqual({ opencode: 'Use read-only inspection first.' });
    expect(existsSync(path.join(configRoot, 'providers', 'instructions.json'))).toBe(true);
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
});
