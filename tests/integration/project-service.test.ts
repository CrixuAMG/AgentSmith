import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const projectService = require('../../electron/project-service.cjs') as {
  scanProject: (project: { path: string }, options: { showHidden: boolean }) => Promise<Array<{ relativePath: string }>>;
  readFile: (project: { path: string }, relativePath: string, guardrails: unknown) => Promise<{ content: string }>;
  listInstructions: (project: { path: string }, globalPath: string) => Promise<Array<{ relativePath: string; scope: string }>>;
  writeInstruction: (project: { path: string }, relativePath: string, content: string, overwrite: boolean, globalPath: string) => Promise<void>;
};

const temporaryDirectories: string[] = [];

async function projectFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-project-'));
  temporaryDirectories.push(root);
  await writeFile(path.join(root, '.gitignore'), 'ignored.txt\n');
  await writeFile(path.join(root, 'visible.ts'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'ignored.txt'), 'not context\n');
  await writeFile(path.join(root, '.env'), 'TOKEN=secret\n');
  return { path: root };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('project filesystem boundaries', () => {
  it('scans with .gitignore awareness and rejects guarded reads', async () => {
    const project = await projectFixture();
    const tree = await projectService.scanProject(project, { showHidden: true });
    expect(tree.map((node) => node.relativePath)).toContain('visible.ts');
    expect(tree.map((node) => node.relativePath)).not.toContain('ignored.txt');
    await expect(projectService.readFile(project, '.env', {
      rules: [{ id: 'deny-env', type: 'file_access', pattern: '**/.env*', action: 'deny', enabled: true }],
    })).rejects.toThrow();
    await expect(projectService.readFile(project, '.env', null)).rejects.toThrow('Environment files');
  });

  it('rejects traversal and symlink escapes', async () => {
    const project = await projectFixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-outside-'));
    temporaryDirectories.push(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'outside\n');
    await symlink(path.join(outside, 'secret.txt'), path.join(project.path, 'link.txt'));
    await symlink(outside, path.join(project.path, 'escape'));
    await mkdir(path.join(project.path, 'linked'), { recursive: true });
    await writeFile(path.join(project.path, 'target.md'), '# Target\n');
    await symlink(path.join(project.path, 'target.md'), path.join(project.path, 'linked', 'AGENTS.md'));
    await expect(projectService.readFile(project, '../secret.txt', null)).rejects.toThrow();
    await expect(projectService.readFile(project, 'link.txt', null)).rejects.toThrow();
    await expect(projectService.writeInstruction(project, 'escape/AGENTS.md', '# Escape\n', false, path.join(project.path, 'global.md'))).rejects.toThrow();
    await expect(projectService.writeInstruction(project, 'linked/AGENTS.md', '# Linked\n', false, path.join(project.path, 'global.md'))).rejects.toThrow('existing symlink');
  });

  it('discovers and atomically creates scoped instruction files', async () => {
    const project = await projectFixture();
    const globalPath = path.join(project.path, 'global.md');
    await writeFile(path.join(project.path, 'AGENTS.md'), '# Project\n');
    await projectService.writeInstruction(project, 'frontend/AGENTS.md', '# Frontend\n', false, globalPath);
    const instructions = await projectService.listInstructions(project, globalPath);
    expect(instructions.map((item) => item.relativePath)).toEqual(['@global/AGENTS.md', 'AGENTS.md', 'frontend/AGENTS.md']);
    expect(await readFile(path.join(project.path, 'frontend/AGENTS.md'), 'utf8')).toBe('# Frontend\n');
    await expect(projectService.writeInstruction(project, 'AGENTS.md', 'replacement', false, globalPath)).rejects.toThrow();
  });
});
