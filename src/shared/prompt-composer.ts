import { isFileReadAllowed, promptGuardrailText } from './guardrails';
import type { PromptComposition, PromptCompositionInput, PromptSection } from './types';

const clean = (value: string): string => value.trim();

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
    section(
      'project',
      'Selected project',
      input.project ? `Project: ${input.project.name}\nPath: ${input.project.path}` : 'No project selected.',
      Boolean(input.project),
    ),
    section('project-structure', 'Project structure', input.projectStructure, input.contexts.projectStructure && Boolean(clean(input.projectStructure))),
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

  const included = sections.filter((item) => item.included && item.content);
  const text = included.map((item) => `## ${item.title}\n\n${item.content}`).join('\n\n');
  return { text, sections, blockedContexts };
}
