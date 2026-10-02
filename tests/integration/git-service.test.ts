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
  gitStatus: (project: { path: string }) => Promise<{ isRepository: boolean; branch: string | null; changes: Array<{ path: string; kind: string }> }>;
  gitDiff: (project: { path: string }, relativePath: string, staged: boolean) => Promise<string>;
  gitLog: (project: { path: string }, options: { branch?: string | null; limit: number }) => Promise<{ commits: Array<{ subject: string; shortHash: string }>; error: string | null }>;
  gitBranches: (project: { path: string }) => Promise<{ current: string | null; branches: Array<{ name: string; isCurrent: boolean; upstream: string | null }>; error: string | null }>;
  gitPush: (project: { path: string }) => Promise<{ ok: boolean; message: string }>;
};

const directories: string[] = [];

async function seedRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-git-'));
  directories.push(root);
  await execFileAsync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'dev@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Ada Lovelace'], { cwd: root });
  return root;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Git inspection integration', () => {
  it('shows an untracked file diff without invoking a shell', async () => {
    const root = await seedRepository();
    await writeFile(path.join(root, 'notes.md'), '# Notes\n');

    const project = { path: root };
    const status = await gitService.gitStatus(project);
    expect(status.isRepository).toBe(true);
    expect(status.changes).toEqual([expect.objectContaining({ path: 'notes.md', kind: 'untracked' })]);
    expect(await gitService.gitDiff(project, 'notes.md', false)).toContain('+# Notes');
  });
});

describe('Git history integration', () => {
  it('lists commits for the checked-out branch and for a selected branch', async () => {
    const root = await seedRepository();
    await writeFile(path.join(root, 'first.txt'), 'first\n');
    await execFileAsync('git', ['add', '.'], { cwd: root });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'feat: first commit'], { cwd: root });
    await execFileAsync('git', ['branch', 'feature/commits'], { cwd: root });
    await writeFile(path.join(root, 'second.txt'), 'second\n');
    await execFileAsync('git', ['add', '.'], { cwd: root });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'fix: second commit'], { cwd: root });

    const project = { path: root };
    const head = await gitService.gitLog(project, { limit: 10 });
    expect(head.error).toBeNull();
    expect(head.commits.map((commit) => commit.subject)).toEqual(['fix: second commit', 'feat: first commit']);
    expect(head.commits[0].shortHash).toHaveLength(7);

    const branch = await gitService.gitLog(project, { branch: 'feature/commits', limit: 10 });
    expect(branch.commits.map((commit) => commit.subject)).toEqual(['feat: first commit']);

    const limited = await gitService.gitLog(project, { limit: 1 });
    expect(limited.commits).toHaveLength(1);

    const branches = await gitService.gitBranches(project);
    expect(branches.error).toBeNull();
    expect(branches.current).toBe('main');
    expect(branches.branches.map((item) => item.name)).toHaveLength(2);
    expect(branches.branches.map((item) => item.name)).toEqual(expect.arrayContaining(['main', 'feature/commits']));
    expect(branches.branches.find((item) => item.name === 'main')).toMatchObject({ isCurrent: true, upstream: null });
  });

  it('reports an empty history for a repository without commits', async () => {
    const root = await seedRepository();
    const log = await gitService.gitLog({ path: root }, { limit: 10 });
    expect(log.error).toBeNull();
    expect(log.commits).toEqual([]);
  });

  it('rejects a revision that could be read as a Git option', async () => {
    const root = await seedRepository();
    await writeFile(path.join(root, 'first.txt'), 'first\n');
    await execFileAsync('git', ['add', '.'], { cwd: root });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'feat: first commit'], { cwd: root });

    const log = await gitService.gitLog({ path: root }, { branch: '--upload-pack=touch /tmp/agentsmith-should-not-exist', limit: 10 });
    expect(log.commits).toEqual([]);
    expect(log.error).toBe('That branch name is not valid.');
  });

  it('fails the push without an upstream remote instead of inventing a target', async () => {
    const root = await seedRepository();
    await writeFile(path.join(root, 'first.txt'), 'first\n');
    await execFileAsync('git', ['add', '.'], { cwd: root });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'feat: first commit'], { cwd: root });

    const result = await gitService.gitPush({ path: root });
    expect(result.ok).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });
});
