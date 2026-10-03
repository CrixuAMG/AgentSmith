import type { ViewId, WorkspaceTab } from '@/shared/types';

export const PALETTE_EVENTS = {
  refreshProject: 'agentsmith:refresh-project',
  refreshProviders: 'agentsmith:refresh-providers',
  executePrompt: 'agentsmith:execute-prompt',
  cancelJob: 'agentsmith:cancel-job',
} as const;

export type PaletteAction =
  | { kind: 'view'; view: ViewId }
  | { kind: 'project-picker' }
  | { kind: 'workspace-tab'; tab: WorkspaceTab }
  | { kind: 'layout-reset' }
  | { kind: 'theme' }
  | { kind: 'event'; name: string };

export interface PaletteCommand {
  id: string;
  label: string;
  keywords: string;
  shortcut?: string;
  action: PaletteAction;
  disabled?: boolean;
}

export function commandMatches(command: PaletteCommand, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized || `${command.label} ${command.keywords}`.toLocaleLowerCase().includes(normalized);
}
