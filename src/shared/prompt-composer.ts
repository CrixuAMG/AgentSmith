import { isFileReadAllowed, promptGuardrailText } from './guardrails';
import type { PromptComposition, PromptCompositionInput, PromptContextManifestEntry, PromptContextOptions, PromptSection } from './types';

const clean = (value: string): string => value.trim();
const bytesOf = (value: string): number => new TextEncoder().encode(value).length;

const section = (id: string, title: string, content: string, included = true): PromptSection => ({
  id,
  title,
  content: clean(content),
  included,
});

export function composePrompt(input: PromptCompositionInput): PromptComposition {
  const blockedContexts: Array<{ path: string; reason: string }> = [];
  const sections: PromptSection[] = [
    section(
      'contract',
      'Operating contract',
      'You are working as a careful software engineering agent. Inspect existing context before changing anything. Keep changes focused, explain assumptions, and report verification honestly.',
    ),
    section('global-instructions', 'Global instructions', input.globalInstructions, input.contexts.globalInstructions && Boolean(clean(input.globalInstructions))),
    section('provider-instructions', 'Provider instructions', input.providerInstructions, input.contexts.providerInstructions && Boolean(clean(input.providerInstructions))),
    section('project-instructions', 'Project instructions', input.projectInstructions, input.contexts.projectInstructions && Boolean(clean(input.projectInstructions))),
    section('nested-instructions', 'Nested instructions', input.nestedInstructions, input.contexts.nestedInstructions && Boolean(clean(input.nestedInstructions))),
    section(
      'role',
      input.role ? `Role: ${input.role.name}` : 'Role',
      input.role ? input.role.instructions.join('\n') : '',
      Boolean(input.role?.enabled),
    ),
    section(
      'goals',
      'Development goals',
      input.goals.filter((goal) => goal.enabled).map((goal) => `### ${goal.name}\n${goal.instructions.join('\n')}`).join('\n\n'),
      input.goals.some((goal) => goal.enabled),
    ),
    section(
      'guardrails',
      input.guardrails ? `Guardrails: ${input.guardrails.name}` : 'Guardrails',
      promptGuardrailText(input.guardrails),
      Boolean(input.guardrails),
    ),
    section('repository-workflow', 'Repository workflow', input.repositoryWorkflow ?? '', Boolean(clean(input.repositoryWorkflow ?? ''))),
    section(
      'project',
      'Selected project',
      input.project ? `Project: ${input.project.name}\nPath: ${input.project.path}` : 'No project selected.',
      Boolean(input.project),
    ),
    section('project-structure', 'Project structure', input.projectStructure, input.contexts.projectStructure && Boolean(clean(input.projectStructure))),
    section('readme', 'README.md', input.readme, input.contexts.readme && Boolean(clean(input.readme))),
    section('composer-json', 'composer.json', input.composerJson, input.contexts.composerJson && Boolean(clean(input.composerJson))),
    section('package-json', 'package.json', input.packageJson, input.contexts.packageJson && Boolean(clean(input.packageJson))),
    section('git-status', 'Git status', input.gitStatus, input.contexts.gitStatus && Boolean(clean(input.gitStatus))),
    section('git-diff', 'Git diff', input.gitDiff, input.contexts.gitDiff && Boolean(clean(input.gitDiff))),
  ];

  const selectedFileContents = input.selectedFiles.flatMap((file) => {
    const result = isFileReadAllowed(file.path, input.guardrails);
    if (!result.allowed) {
      blockedContexts.push({ path: file.path, reason: result.reason ?? 'Blocked by active guardrails.' });
      return [];
    }
    return [`### ${file.path}\n${file.content}`];
  });
  sections.push(section('selected-files', 'Selected files', selectedFileContents.join('\n\n'), input.contexts.selectedFiles && selectedFileContents.length > 0));
  sections.push(section('task', 'Task', clean(input.task) || 'Describe the development task.', true));

  const sourceSections = new Set([
    'global-instructions', 'provider-instructions', 'project-instructions', 'nested-instructions',
    'project-structure', 'readme', 'composer-json', 'package-json', 'git-status', 'git-diff', 'selected-files',
  ]);
  const fileSections = new Set(['project-instructions', 'nested-instructions', 'readme', 'composer-json', 'package-json', 'git-diff']);
  const pathKeyById: Record<string, keyof PromptContextOptions> = {
    'global-instructions': 'globalInstructions',
    'provider-instructions': 'providerInstructions',
    'project-instructions': 'projectInstructions',
    'nested-instructions': 'nestedInstructions',
    'project-structure': 'projectStructure',
    readme: 'readme',
    'composer-json': 'composerJson',
    'package-json': 'packageJson',
    'git-status': 'gitStatus',
    'git-diff': 'gitDiff',
  };
  const kindFor = (id: string): PromptContextManifestEntry['kind'] => {
    if (id === 'git-diff') return 'diff';
    if (id.includes('instruction')) return 'instruction';
    if (id === 'project-structure') return 'structure';
    if (id === 'git-status') return 'git-status';
    if (id === 'global-instructions') return 'global';
    if (id === 'provider-instructions') return 'provider';
    if (id === 'project') return 'project';
    if (id === 'role') return 'role';
    if (id === 'goals') return 'goals';
    if (id === 'guardrails') return 'guardrails';
    if (id === 'repository-workflow') return 'repository';
    if (id === 'task') return 'task';
    return 'file';
  };
  const entries: PromptContextManifestEntry[] = [];
  for (const item of sections) {
    const path = pathKeyById[item.id] ? input.contextPaths?.[pathKeyById[item.id]] ?? null : null;
    let decision: PromptContextManifestEntry['decision'] = 'allow';
    let enforcement: PromptContextManifestEntry['enforcement'] = null;
    let ruleId: string | null = null;
    let reason: string | null = null;
    if (fileSections.has(item.id) && path) {
      const permission = isFileReadAllowed(path, input.guardrails);
      decision = permission.decision;
      enforcement = permission.enforcement;
      ruleId = permission.rule?.id ?? null;
      reason = permission.reason;
      if (decision === 'deny' && item.included) {
        item.included = false;
        blockedContexts.push({ path, reason: reason ?? 'Blocked by active guardrails.' });
      }
    }
    if (!sourceSections.has(item.id) && !['task', 'project', 'role', 'goals', 'guardrails', 'repository-workflow'].includes(item.id)) continue;
    const content = item.content;
    entries.push({
      id: item.id,
      kind: kindFor(item.id),
      path,
      included: item.included && Boolean(content),
      bytes: content ? bytesOf(content) : 0,
      chars: content.length,
      lines: content ? content.split('\n').length : 0,
      decision,
      enforcement,
      ruleId,
      reason,
    });
  }
  for (const file of input.selectedFiles) {
    const permission = isFileReadAllowed(file.path, input.guardrails);
    const decision = permission.decision;
    entries.push({
      id: `selected-file:${file.path}`,
      kind: 'file',
      path: file.path,
      included: input.contexts.selectedFiles && decision !== 'deny',
      bytes: bytesOf(file.content),
      chars: file.content.length,
      lines: file.content ? file.content.split('\n').length : 0,
      decision,
      enforcement: permission.enforcement,
      ruleId: permission.rule?.id ?? null,
      reason: permission.reason,
    });
  }

  const included = sections.filter((item) => item.included && item.content);
  const text = included.map((item) => `## ${item.title}\n\n${item.content}`).join('\n\n');
  const includedEntries = entries.filter((entry) => entry.included);
  return {
    text,
    sections,
    blockedContexts: [...new Map(blockedContexts.map((item) => [item.path, item])).values()],
    contextManifest: {
      version: 1,
      entries,
      totals: {
        includedEntries: includedEntries.length,
        includedBytes: includedEntries.reduce((total, entry) => total + (entry.bytes ?? 0), 0),
        includedChars: includedEntries.reduce((total, entry) => total + (entry.chars ?? 0), 0),
        includedLines: includedEntries.reduce((total, entry) => total + (entry.lines ?? 0), 0),
      },
    },
  };
}
