import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

import { isValidExternalPath, normalizeExternalPath } from '@/shared/permission-rules';

const require = createRequire(import.meta.url);
const electronPermissions = require('../../electron/permissions-service.cjs') as {
  buildExternalPermissions: (paths: string[]) => Record<string, string>;
  isValidExternalPath: (value: unknown) => boolean;
};

describe('external permissions', () => {
  it('accepts absolute paths and normalizes directory grants', () => {
    expect(isValidExternalPath('/tmp/work')).toBe(true);
    expect(normalizeExternalPath('/tmp/work')).toBe('/tmp/work/*');
    expect(electronPermissions.buildExternalPermissions(['/tmp/work', '/tmp/work/*'])).toEqual({ '/tmp/work/*': 'allow' });
  });

  it('rejects malformed or relative paths at both boundaries', () => {
    expect(isValidExternalPath('relative/path')).toBe(false);
    expect(isValidExternalPath('/tmp/bad\0path')).toBe(false);
    expect(electronPermissions.isValidExternalPath('relative/path')).toBe(false);
    expect(() => electronPermissions.buildExternalPermissions(['relative/path'])).toThrow('Invalid external permission path');
  });
});
