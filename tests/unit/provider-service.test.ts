import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildExecutionCommand } = require('../../electron/provider-service.cjs') as {
  buildExecutionCommand: (request: Record<string, unknown>, discovery: Array<Record<string, unknown>>) => { executable: string; args: string[]; cwd: string; displayCommand: string };
};

const installedProvider = (providerId: string, executable: string) => [{
  installation: { providerId, installed: true, executable },
}];

describe('provider command construction', () => {
  it('builds OpenCode arguments without shell concatenation or auto approval', () => {
    const result = buildExecutionCommand({ providerId: 'opencode', modelId: 'opencode/gpt-5.5', prompt: 'Inspect this change; do not mutate files.', projectPath: '/tmp/project', variant: { reasoningEffort: 'high' } }, installedProvider('opencode', '/usr/local/bin/opencode'));
    expect(result.executable).toBe('/usr/local/bin/opencode');
    expect(result.args).toEqual(['run', '--model', 'opencode/gpt-5.5', '--variant', 'high', 'Inspect this change; do not mutate files.']);
    expect(result.args).not.toContain('--auto');
    expect(result.cwd).toBe('/tmp/project');
  });

  it('keeps Codex construction provider-specific', () => {
    const result = buildExecutionCommand({ providerId: 'codex', modelId: null, prompt: 'Review the tests.', projectPath: '/tmp/project', variant: {} }, installedProvider('codex', '/usr/local/bin/codex'));
    expect(result.args).toEqual(['exec', 'Review the tests.']);
    expect(result.displayCommand).toContain('<prompt>');
  });
});
