import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { evaluateExecutionGuardrails, closeProcessInput } = require('../../electron/process-service.cjs') as {
  evaluateExecutionGuardrails: (request: { prompt: string; guardrailProfile?: { rules: Array<Record<string, unknown>> } }) => void;
  closeProcessInput: (child: { stdin?: { end: () => void } | null }) => void;
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
});
