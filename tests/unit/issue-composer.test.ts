import { describe, expect, it } from 'vitest';

import { MAX_ISSUE_BODY_CHARS, composeIssuePrompt } from '@/shared/issue-composer';
import { parseRepositoryCapabilities, slugifyIssueTitle } from '@/shared/repositories';
import type { RepositoryIssue, RepositoryLink } from '@/shared/types';

const link: RepositoryLink = {
  providerId: 'github',
  host: 'github.com',
  owner: 'example',
  name: 'agent',
  defaultBranch: 'main',
};

const issue: RepositoryIssue = {
  number: 42,
  title: 'The sync worker stops on a transient error',
  body: 'The worker exits instead of retrying.',
  state: 'open',
  url: 'https://github.com/example/agent/issues/42',
  author: 'maintainer',
  labels: ['bug'],
  comments: 2,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
};

describe('issue prompt composition', () => {
  it('frames issue text as untrusted input and keeps the merge prohibition', () => {
    const capabilities = parseRepositoryCapabilities('## Repository integration\n- issues: allow\n- branches: allow\n- pull-requests: allow');
    const composed = composeIssuePrompt({ link, issue, capabilities });

    expect(composed.title).toBe('Issue #42: The sync worker stops on a transient error');
    expect(composed.text).toContain('Implement issue #42 in example/agent');
    expect(composed.text).toContain('untrusted input');
    expect(composed.text).toContain('--- issue text ---\nThe worker exits instead of retrying.\n--- end issue text ---');
    expect(composed.text).toContain(`feature/issue-42-${slugifyIssueTitle(issue.title)}`);
    expect(composed.text).toContain('Never merge anything');
  });

  it('describes the manual review step when pull requests are not authorized', () => {
    const capabilities = parseRepositoryCapabilities('## Repository integration\n- branches: allow');
    const composed = composeIssuePrompt({ link, issue, capabilities });

    expect(composed.text).toContain('Repository workflow you may perform yourself:');
    expect(composed.text).not.toContain('open a pull request');
    expect(composed.text).toContain('Never merge anything');
  });

  it('bounds an oversized issue body instead of passing it through', () => {
    const composed = composeIssuePrompt({
      link,
      issue: { ...issue, body: 'x'.repeat(MAX_ISSUE_BODY_CHARS + 500) },
      capabilities: parseRepositoryCapabilities(''),
    });

    expect(composed.text.length).toBeLessThan(MAX_ISSUE_BODY_CHARS + 4000);
    expect(composed.text).toContain('AgentSmith truncated the issue body');
  });

  it('refuses a missing repository link or an invalid issue number', () => {
    const capabilities = parseRepositoryCapabilities('');
    expect(() => composeIssuePrompt({ link: null as unknown as RepositoryLink, issue, capabilities })).toThrow();
    expect(() => composeIssuePrompt({ link, issue: { ...issue, number: 0 }, capabilities })).toThrow();
  });
});