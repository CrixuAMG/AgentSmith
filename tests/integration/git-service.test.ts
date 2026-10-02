import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const gitService = require('../../electron/git-service.cjs') as {
  gitStatus: (project: { path: string }) => Promise<{ isRepository: boolean; changes: Array<{ path: string; kind: string }> }>;
  gitDiff: (project: { path: string }, relativePath: string, staged: boolean) => Promise<string>;
};

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Git inspection integration', () => {
  it('shows an untracked file diff without invoking a shell', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-git-'));
    directories.push(root);
    await execFileAsync('git', ['init', '--quiet'], { cwd: root });
    await writeFile(path.join(root, 'notes.md'), '# Notes\n');

    const project = { path: root };
    const status = await gitService.gitStatus(project);
    expect(status.isRepository).toBe(true);
    expect(status.changes).toEqual([expect.objectContaining({ path: 'notes.md', kind: 'untracked' })]);
    expect(await gitService.gitDiff(project, 'notes.md', false)).toContain('+# Notes');
  });
});
