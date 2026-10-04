import { createRequire } from 'node:module';
import { access, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { evaluateExecutionGuardrails, closeProcessInput, normalizeMaxConcurrentJobs, hydrateJobs, listPromptJobs, providerEnvironment, stripAnsi, ensureProviderTempDirectory, cleanupProviderTempDirectory } = require('../../electron/process-service.cjs') as {
  evaluateExecutionGuardrails: (request: { prompt: string; guardrailProfile?: { rules: Array<Record<string, unknown>> } }) => void;
  closeProcessInput: (child: { stdin?: { end: () => void } | null }) => void;
  normalizeMaxConcurrentJobs: (value: unknown) => number;
  hydrateJobs: (records: Array<Record<string, unknown>>) => void;
  listPromptJobs: () => Array<Record<string, unknown>>;
  providerEnvironment: (environment: Record<string, string>) => Record<string, string>;
  stripAnsi: (value: string) => string;
  ensureProviderTempDirectory: (projectRoot: string, executionId: string) => Promise<string>;
  cleanupProviderTempDirectory: (directory: string) => Promise<void>;
};

describe('execution guardrails', () => {
  it('blocks an explicit application execution denial before provider discovery', () => {
    expect(() => evaluateExecutionGuardrails({
      prompt: 'Review the project.',
      guardrailProfile: { rules: [{ id: 'deny-run', type: 'agent_permission', pattern: 'run agent', action: 'deny', enabled: true }] },
    })).toThrow('Execution blocked');
  });

  it('rejects empty prompts', () => {
    expect(() => evaluateExecutionGuardrails({ prompt: '  ' })).toThrow('execution prompt');
  });

  it('closes stdin for one-shot provider processes', () => {
    const end = vi.fn();

    closeProcessInput({ stdin: { end } });

    expect(end).toHaveBeenCalledOnce();
  });

  it('keeps hosted repository credentials out of provider environments', () => {
    expect(providerEnvironment({ AGENTSMITH_GITHUB_TOKEN: 'secret', AGENTSMITH_GITLAB_TOKEN: 'secret', PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });

  it('removes terminal control sequences from provider output', () => {
    expect(stripAnsi('\u001b[31mError\u001b[0m\r\nnext\u001b]8;;https://example.test\u0007link\u001b]8;;\u0007')).toBe('Error\nnextlink');
  });

  it('allocates and cleans a project-scoped provider temp directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-process-'));
    try {
      const directory = await ensureProviderTempDirectory(root, 'execution-1');
      expect(directory).toBe(path.join(await realpath(root), '.AgentSmith', 'tmp', 'execution-1'));
      await cleanupProviderTempDirectory(directory);
      await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a pre-existing AgentSmith workspace symlink', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-process-root-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-process-outside-'));
    try {
      await symlink(outside, path.join(root, '.AgentSmith'));
      await expect(ensureProviderTempDirectory(root, 'execution-1')).rejects.toThrow(/safe directory|outside/i);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('normalizes the configured concurrency limit to a safe range', () => {
    expect(normalizeMaxConcurrentJobs(4)).toBe(4);
    expect(normalizeMaxConcurrentJobs(0)).toBe(1);
    expect(normalizeMaxConcurrentJobs(99)).toBe(10);
    expect(normalizeMaxConcurrentJobs('4')).toBe(2);
  });

  it('marks jobs from an interrupted host session instead of claiming they are running', () => {
    hydrateJobs([{
      id: 'job-1', projectId: 'project-1', historyEntryId: 'history-1', task: 'Inspect', state: 'running', executionId: 'exec-1', command: null,
      output: [], exitCode: null, providerId: 'opencode', modelId: null, purpose: 'task', outputBytes: 0, outputTruncated: false,
      error: null, createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', finishedAt: null,
    }]);

    expect(listPromptJobs()[0]).toMatchObject({ state: 'interrupted', executionId: null });
  });
});
