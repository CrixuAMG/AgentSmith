import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const suggestionService = require('../../electron/suggestion-service.cjs') as {
  saveSuggestion: (root: string, project: { name: string }, content: string) => Promise<{ relativePath: string; absolutePath: string; savedAt: string }>;
  MAX_SUGGESTION_BYTES: number;
};

const temporaryDirectories: string[] = [];

async function suggestionsRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-suggestions-'));
  temporaryDirectories.push(root);
  return root;
}

const project = { name: 'AgentSmith' };

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('suggestion storage', () => {
  it('writes each suggestion under the project folder with a dated markdown name', async () => {
    const root = await suggestionsRoot();
    const saved = await suggestionService.saveSuggestion(root, project, '# New capability: AgentSmith\n\nPropose a feature.\n');

    expect(saved.relativePath).toMatch(/^suggestions[\\/]AgentSmith[\\/]\d{4}-\d{2}-\d{2}T[\d-]+Z\.md$/);
    expect(saved.absolutePath.startsWith(path.join(root, 'suggestions', 'AgentSmith'))).toBe(true);
    expect(await readFile(saved.absolutePath, 'utf8')).toContain('Propose a feature.');
    expect(Number.isNaN(Date.parse(saved.savedAt))).toBe(false);

    const mode = (await stat(saved.absolutePath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('never overwrites an earlier suggestion with the same content', async () => {
    const root = await suggestionsRoot();
    const first = await suggestionService.saveSuggestion(root, project, 'identical body');
    const second = await suggestionService.saveSuggestion(root, project, 'identical body');

    expect(second.absolutePath).not.toBe(first.absolutePath);
    const files = await readdir(path.join(root, 'suggestions', 'AgentSmith'));
    expect(files).toHaveLength(2);
    expect(await readFile(first.absolutePath, 'utf8')).toBe('identical body');
  });

  it('rejects project names that could escape the suggestions root', async () => {
    const root = await suggestionsRoot();
    for (const name of ['../escape', 'nested/name', 'nested\\name', '..', '.', 'bad\u0000name', 'x'.repeat(200)]) {
      await expect(suggestionService.saveSuggestion(root, { name }, 'body')).rejects.toThrow();
    }
    await expect(suggestionService.saveSuggestion(root, { name: 42 as unknown as string }, 'body')).rejects.toThrow('project name is required');
    expect(await readdir(root)).toEqual([]);
  });

  it('refuses a symlinked project folder instead of writing through it', async () => {
    const root = await suggestionsRoot();
    const outside = await suggestionsRoot();
    await symlink(outside, path.join(root, 'AgentSmith'));

    await expect(suggestionService.saveSuggestion(root, project, 'body')).rejects.toThrow('outside the suggestions root');
    expect(await readdir(outside)).toEqual([]);
  });

  it('rejects empty, non-text, and oversized suggestion bodies', async () => {
    const root = await suggestionsRoot();
    await expect(suggestionService.saveSuggestion(root, project, '   ')).rejects.toThrow('body is required');
    await expect(suggestionService.saveSuggestion(root, project, null as unknown as string)).rejects.toThrow('body is required');
    await expect(suggestionService.saveSuggestion(root, project, 'x'.repeat(suggestionService.MAX_SUGGESTION_BYTES + 1))).rejects.toThrow('256 KB storage limit');
    expect(await readdir(path.join(root, 'suggestions'))).toEqual([]);
  });

  it('creates the suggestions root when it does not exist yet', async () => {
    const parent = await suggestionsRoot();
    const root = path.join(parent, 'nested', 'suggestions');
    const saved = await suggestionService.saveSuggestion(root, project, 'body');
    await writeFile(path.join(parent, 'marker.txt'), 'kept', 'utf8');
    expect(await readFile(saved.absolutePath, 'utf8')).toBe('body');
    expect(await readFile(path.join(parent, 'marker.txt'), 'utf8')).toBe('kept');
  });
});