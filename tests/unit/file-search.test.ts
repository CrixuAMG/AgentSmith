import { describe, expect, it } from 'vitest';

import { fuzzySearch, indexProjectTree } from '@/renderer/services/file-search';

describe('file fuzzy search', () => {
  it('indexes nested paths and returns fuzzy matches', () => {
    const entries = indexProjectTree([
      { name: 'src', relativePath: 'src', kind: 'directory', children: [{ name: 'UserController.php', relativePath: 'src/UserController.php', kind: 'file' }] },
      { name: 'README.md', relativePath: 'README.md', kind: 'file' },
    ]);
    expect(fuzzySearch(entries, 'usrctrl')).toEqual([expect.objectContaining({ relativePath: 'src/UserController.php' })]);
  });
});
