import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseBranches, parseLog, parseStatus } = require('../../electron/git-service.cjs') as {
  parseStatus: (output: string) => { branch: string; ahead: number; behind: number; changes: Array<Record<string, unknown>> };
  parseLog: (output: string) => Array<{ hash: string; shortHash: string; author: string; date: string; subject: string }>;
  parseBranches: (output: string, current: string) => Array<{ name: string; isCurrent: boolean; isRemote: boolean; upstream: string | null; ahead: number; behind: number }>;
};

describe('Git status parsing', () => {
  it('parses branch tracking and machine-readable change states', () => {
    const parsed = parseStatus('## feature/profile...origin/feature/profile [ahead 2, behind 1]\0MM src/User.ts\0A  src/Profile.ts\0?? notes.md\0R  new.md\0old.md\0');
    expect(parsed.branch).toBe('feature/profile');
    expect(parsed.ahead).toBe(2);
    expect(parsed.behind).toBe(1);
    expect(parsed.changes).toEqual(expect.arrayContaining([
       expect.objectContaining({ path: 'src/User.ts', kind: 'modified', unstaged: true }),
       expect.objectContaining({ path: 'src/User.ts', staged: true }),
      expect.objectContaining({ path: 'src/Profile.ts', kind: 'added', staged: true }),
      expect.objectContaining({ path: 'notes.md', kind: 'untracked' }),
      expect.objectContaining({ path: 'new.md', oldPath: 'old.md', kind: 'renamed' }),
    ]));
  });

  it('handles porcelain branch edge cases and legacy rename text', () => {
    expect(parseStatus('## No commits yet on trunk\0').branch).toBe('trunk');
    expect(parseStatus('## HEAD (no branch)\0').branch).toBe('detached HEAD');
    expect(parseStatus('## main\0R  old.md -> new.md\0').changes[0]).toEqual(expect.objectContaining({ path: 'new.md', oldPath: 'old.md' }));
  });
});

describe('Git commit log parsing', () => {
  it('splits record and field separators without losing subjects', () => {
    const record = (hash: string, short: string, subject: string) => `${hash}\u001f${short}\u001fAda Lovelace\u001f2026-10-02T09:15:00+00:00\u001f${subject}\u001e`;
    expect(parseLog(`${record('a'.repeat(40), 'aaaaaaa', 'feat: add commits browser')}\n${record('b'.repeat(40), 'bbbbbbb', 'fix: clamp layout values')}`)).toEqual([
      { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'Ada Lovelace', date: '2026-10-02T09:15:00+00:00', subject: 'feat: add commits browser' },
      { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', author: 'Ada Lovelace', date: '2026-10-02T09:15:00+00:00', subject: 'fix: clamp layout values' },
    ]);
  });

  it('ignores empty records from the trailing separator', () => {
    expect(parseLog('')).toEqual([]);
    expect(parseLog('\n')).toEqual([]);
  });
});

describe('Git branch listing parsing', () => {
  it('maps refs to names, upstream tracking, and remote markers', () => {
    const row = (ref: string, name: string, upstream: string, track: string) => [ref, name, upstream, track, '2026-10-02T09:15:00+00:00'].join('\t');
    const output = [
      row('refs/heads/main', 'main', 'origin/main', '[ahead 2, behind 1]'),
      row('refs/heads/feature/commits', 'feature/commits', '', ''),
      row('refs/remotes/origin/main', 'origin/main', '', ''),
      row('refs/remotes/origin/HEAD', 'origin/HEAD', '', ''),
    ].join('\n');

    expect(parseBranches(output, 'main')).toEqual([
      expect.objectContaining({ name: 'main', isCurrent: true, isRemote: false, upstream: 'origin/main', ahead: 2, behind: 1 }),
      expect.objectContaining({ name: 'feature/commits', isCurrent: false, isRemote: false, upstream: null, ahead: 0, behind: 0 }),
      expect.objectContaining({ name: 'origin/main', isCurrent: false, isRemote: true, upstream: null }),
    ]);
  });
});
