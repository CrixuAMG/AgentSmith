import { describe, expect, it } from 'vitest';

import { composeIssueAuditPrompt } from '@/shared/issue-audit';
import type { Project, RepositoryLink } from '@/shared/types';

const project: Project = {
  id: 'project-1',
  name: 'AgentSmith',
  path: '/tmp/agentsmith',
  lastOpenedAt: '2026-10-04T00:00:00.000Z',
  repository: null,
};

const link: RepositoryLink = {
  providerId: 'github',
  host: 'github.com',
  owner: 'example',
  name: 'agentsmith',
  defaultBranch: 'main',
};

describe('issue audit prompt', () => {
  it('requests reviewable JSON drafts from the current repository context', () => {
    const prompt = composeIssueAuditPrompt({
      project,
      link,
      projectStructure: 'src/\nREADME.md',
      gitStatus: 'branch: main\nmodified: src/main.ts',
      readme: '# AgentSmith',
      packageJson: '{"name":"agentsmith"}',
      composerJson: '',
      instructions: '- issues: allow',
    });

    expect(prompt.title).toContain('example/agentsmith');
    expect(prompt.text).toContain('Return ONLY a JSON array');
    expect(prompt.text).toContain('modified: src/main.ts');
    expect(prompt.text).toContain('untrusted repository data');
    expect(prompt.text).toContain('Do not change files');
  });

  it('bounds a large repository context before sending it to a provider', () => {
    const prompt = composeIssueAuditPrompt({
      project,
      link,
      projectStructure: 'x'.repeat(20000),
      gitStatus: '',
      readme: '',
      packageJson: '',
      composerJson: '',
      instructions: '',
    });

    expect(prompt.text).toContain('[AgentSmith truncated this repository context.]');
    expect(prompt.text).not.toContain('x'.repeat(20000));
  });
});
