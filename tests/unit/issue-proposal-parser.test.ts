import { describe, expect, it } from 'vitest';

import { parseIssueProposals } from '@/shared/issue-proposal-parser';

describe('issue proposal parsing', () => {
  it('parses fenced JSON and normalizes drafts for the GitHub API', () => {
    const result = parseIssueProposals([
      'Here are the drafts:',
      '```json',
      '[{"title":" Add retry handling ","body":"Document the current failure and add tests. ","labels":["bug","",42]}]',
      '```',
    ].join('\n'));

    expect(result.error).toBeNull();
    expect(result.proposals).toEqual([{
      id: 'issue-proposal-1',
      title: 'Add retry handling',
      body: 'Document the current failure and add tests.',
      labels: ['bug'],
    }]);
  });

  it('accepts a wrapped issues object and removes duplicate titles', () => {
    const result = parseIssueProposals(JSON.stringify({ issues: [
      { title: 'Add audit logging', body: 'A', labels: [] },
      { title: 'add audit logging', body: 'B', labels: ['security'] },
    ] }));

    expect(result.error).toBeNull();
    expect(result.proposals).toHaveLength(1);
  });

  it('fails closed for prose that is not a JSON issue list', () => {
    const result = parseIssueProposals('The project looks good. I could not identify any tickets.');

    expect(result.proposals).toEqual([]);
    expect(result.error).toContain('required JSON');
  });

  it('skips invalid drafts instead of creating malformed issues', () => {
    const result = parseIssueProposals(JSON.stringify([
      { title: '', body: 'missing title' },
      { title: 'Valid draft', body: 'Create tests.', labels: ['testing'] },
    ]));

    expect(result.error).toBeNull();
    expect(result.proposals[0].title).toBe('Valid draft');
  });
});
