import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, DEFAULT_GOALS } from '@/shared/defaults';
import { DEFAULT_WORKSPACE_LAYOUT, isSameLayout, normalizeWorkspaceLayout } from '@/shared/layout';
import { isAppConfig, isGoal, isWorkspaceLayout, validateCollection, validateResource } from '@/shared/validation';

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

describe('workspace layout validation', () => {
  it('treats a missing layout as an invalid document so it is normalized instead', () => {
    expect(isWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT)).toBe(true);
    expect(isAppConfig({ ...DEFAULT_CONFIG, layout: undefined })).toBe(false);
    expect(isWorkspaceLayout({ ...DEFAULT_WORKSPACE_LAYOUT, tab: 'terminal' })).toBe(false);
    expect(isWorkspaceLayout({ ...DEFAULT_WORKSPACE_LAYOUT, railWidth: 9999 })).toBe(false);
  });

  it('clamps hostile or unknown layout values back to safe desktop bounds', () => {
    expect(normalizeWorkspaceLayout(null)).toEqual(DEFAULT_WORKSPACE_LAYOUT);
    expect(normalizeWorkspaceLayout({ version: 7, railWidth: 5000, explorerRatio: -3, tab: 'hacked' }))
      .toEqual({ version: 1, railWidth: 420, explorerRatio: 0.2, tab: 'explorer' });
    expect(normalizeWorkspaceLayout({ railWidth: 260.4, explorerRatio: 0.4567, tab: 'commits' }))
      .toEqual({ version: 1, railWidth: 260, explorerRatio: 0.457, tab: 'commits' });
  });

  it('reports whether a stored layout already matches the normalized value', () => {
    expect(isSameLayout(DEFAULT_WORKSPACE_LAYOUT, structuredClone(DEFAULT_WORKSPACE_LAYOUT))).toBe(true);
    expect(isSameLayout(DEFAULT_WORKSPACE_LAYOUT, { ...DEFAULT_WORKSPACE_LAYOUT, tab: 'git' })).toBe(false);
    expect(isSameLayout(DEFAULT_WORKSPACE_LAYOUT, undefined)).toBe(true);
  });
});
