import type { WorkspaceLayout, WorkspaceTab } from './types';

export const WORKSPACE_TABS: readonly WorkspaceTab[] = ['explorer', 'git', 'commits', 'instructions'];

export const LAYOUT_LIMITS = {
  railWidth: { min: 180, max: 420 },
  explorerRatio: { min: 0.2, max: 0.6 },
} as const;

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  version: 1,
  railWidth: 245,
  explorerRatio: 0.335,
  tab: 'explorer',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function clampDimension(value: unknown, limits: { min: number; max: number }, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, limits.min), limits.max);
}

/**
 * Turns any stored or untrusted layout payload into a safe desktop layout.
 * Unknown versions, non-numeric widths, and unknown tabs fall back to defaults
 * so a damaged document can never produce an unusable workspace.
 */
export function normalizeWorkspaceLayout(value: unknown): WorkspaceLayout {
  const source = isRecord(value) ? value : {};
  const tab = WORKSPACE_TABS.includes(source.tab as WorkspaceTab) ? source.tab as WorkspaceTab : DEFAULT_WORKSPACE_LAYOUT.tab;
  return {
    version: 1,
    railWidth: Math.round(clampDimension(source.railWidth, LAYOUT_LIMITS.railWidth, DEFAULT_WORKSPACE_LAYOUT.railWidth)),
    explorerRatio: Math.round(clampDimension(source.explorerRatio, LAYOUT_LIMITS.explorerRatio, DEFAULT_WORKSPACE_LAYOUT.explorerRatio) * 1000) / 1000,
    tab,
  };
}

export function isSameLayout(left: WorkspaceLayout, right: unknown): boolean {
  const normalized = normalizeWorkspaceLayout(right);
  return left.railWidth === normalized.railWidth
    && left.explorerRatio === normalized.explorerRatio
    && left.tab === normalized.tab;
}
