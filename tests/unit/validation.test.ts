import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, DEFAULT_GOALS } from '@/shared/defaults';
import { isAppConfig, isGoal, validateCollection, validateResource } from '@/shared/validation';

describe('configuration validation', () => {
  it('accepts versioned defaults', () => {
    expect(isAppConfig(DEFAULT_CONFIG)).toBe(true);
    expect(DEFAULT_GOALS.every(isGoal)).toBe(true);
  });

  it('rejects malformed configuration', () => {
    expect(isAppConfig({ ...DEFAULT_CONFIG, theme: 'sepia' })).toBe(false);
    expect(() => validateResource('goals', [{ id: 'broken' }])).toThrow();
  });

  it('validates collections without mutating them', () => {
    const source = [...DEFAULT_GOALS];
    expect(validateCollection(source, isGoal)).toEqual(source);
    expect(source).toHaveLength(DEFAULT_GOALS.length);
  });
});
