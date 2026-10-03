import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { evaluateExecutionGuardrails, closeProcessInput, normalizeMaxConcurrentJobs, hydrateJobs, listPromptJobs } = require('../../electron/process-service.cjs') as {
  evaluateExecutionGuardrails: (request: { prompt: string; guardrailProfile?: { rules: Array<Record<string, unknown>> } }) => void;
  closeProcessInput: (child: { stdin?: { end: () => void } | null }) => void;
  normalizeMaxConcurrentJobs: (value: unknown) => number;
  hydrateJobs: (records: Array<Record<string, unknown>>) => void;
  listPromptJobs: () => Array<Record<string, unknown>>;
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
