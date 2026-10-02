import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseStatus } = require('../../electron/git-service.cjs') as {
  parseStatus: (output: string) => { branch: string; ahead: number; behind: number; changes: Array<Record<string, unknown>> };
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
