import { describe, expect, it } from 'vitest';

import { DEFAULT_GUARDRAILS } from '@/shared/defaults';
import { composePrompt } from '@/shared/prompt-composer';

describe('prompt composition', () => {
  it('uses deterministic sections for provider and repository context', () => {
    const composition = composePrompt({
      project: { id: 'project', name: 'Example', path: '/tmp/example', lastOpenedAt: '2026-10-02T00:00:00.000Z' },
      task: 'Review the change.',
      role: null,
      goals: [],
      guardrails: null,
      globalInstructions: 'Global rules',
      providerInstructions: 'OpenCode rules',
      projectInstructions: 'Project rules',
      nestedInstructions: '',
      projectStructure: 'src/',
      readme: '# Example',
      composerJson: '{"name":"example"}',
      packageJson: '',
      gitStatus: 'clean',
      gitDiff: '',
      selectedFiles: [],
      contexts: {
        globalInstructions: true,
        providerInstructions: true,
        projectInstructions: true,
        nestedInstructions: false,
        gitStatus: true,
        gitDiff: false,
        projectStructure: true,
        readme: true,
        composerJson: true,
        packageJson: false,
        selectedFiles: false,
      },
    });

    expect(composition.sections.map((section) => section.id)).toEqual([
      'contract',
      'global-instructions',
      'provider-instructions',
      'project-instructions',
      'nested-instructions',
      'role',
      'goals',
      'guardrails',
      'project',
      'project-structure',
      'readme',
      'composer-json',
      'package-json',
      'git-status',
      'git-diff',
      'selected-files',
      'task',
    ]);
    expect(composition.text).toContain('## Provider instructions');
    expect(composition.text).toContain('## composer.json');
    expect(composition.text).not.toContain('## package.json');
  });

  it('excludes selected files denied by the active guardrail', () => {
    const composition = composePrompt({
      project: null,
      task: 'Inspect safely.',
      role: null,
      goals: [],
      guardrails: DEFAULT_GUARDRAILS[0],
      globalInstructions: '',
      providerInstructions: '',
      projectInstructions: '',
      nestedInstructions: '',
      projectStructure: '',
      readme: '',
      composerJson: '',
      packageJson: '',
      gitStatus: '',
      gitDiff: '',
      selectedFiles: [{ path: '.env', content: 'TOKEN=secret' }],
      contexts: {
        globalInstructions: false,
        providerInstructions: false,
        projectInstructions: false,
        nestedInstructions: false,
        gitStatus: false,
        gitDiff: false,
        projectStructure: false,
        readme: false,
        composerJson: false,
        packageJson: false,
        selectedFiles: true,
      },
    });

    expect(composition.text).not.toContain('TOKEN=secret');
    expect(composition.blockedContexts).toEqual([expect.objectContaining({ path: '.env' })]);
  });
});
