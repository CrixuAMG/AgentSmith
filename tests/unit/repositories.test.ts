import { describe, expect, it } from 'vitest';

import {
  composeRepositoryContract,
  issueBranchName,
  parseRepositoryCapabilities,
  slugifyIssueTitle,
} from '@/shared/repositories';
import type { RepositoryLink } from '@/shared/types';

const link: RepositoryLink = {
  providerId: 'github',
  host: 'github.com',
  owner: 'example',
  name: 'agent',
  defaultBranch: 'main',
};

describe('repository capabilities', () => {
  it('grants only explicit allowances from the repository instructions', () => {
    const capabilities = parseRepositoryCapabilities([
      '# Project',
      '',
      '## Repository integration',
      '',
      '- issues: allow',
      '- branches: allow',
      '- pull-requests: deny',
      '',
      '## Other section',
      '',
      '- issues: deny',
    ].join('\n'));

    expect(capabilities).toEqual({
      source: 'agents-md',
      issues: true,
      branches: true,
      pullRequests: false,
      merges: false,
      mergeRequestDenied: false,
    });
  });

  it('ignores capabilities outside a repository section', () => {
    const capabilities = parseRepositoryCapabilities([
      '## Style',
      '',
      '- issues: allow',
    ].join('\n'));

    expect(capabilities.source).toBe('default');
    expect(capabilities.issues).toBe(false);
  });

  it('keeps a denial when a later section allows the same capability', () => {
    const capabilities = parseRepositoryCapabilities([
      '## Repository integration',
      '- branches: deny',
      '',
      '## Version control',
      '- branches: allow',
    ].join('\n'));

    expect(capabilities.branches).toBe(false);
  });

  it('refuses a merge request instead of granting merges', () => {
    const capabilities = parseRepositoryCapabilities([
      '## Repository integration',
      '- issues: allow',
      '- merges: allow',
    ].join('\n'));

    expect(capabilities.merges).toBe(false);
    expect(capabilities.mergeRequestDenied).toBe(true);
    expect(composeRepositoryContract(capabilities, link)).not.toMatch(/MAY merge/i);
  });

  it('fails closed for an unknown value and for an empty document', () => {
    expect(parseRepositoryCapabilities('## Repository integration\n- issues: perhaps').issues).toBe(false);
    expect(parseRepositoryCapabilities('')).toMatchObject({ source: 'default', issues: false, merges: false });
    expect(parseRepositoryCapabilities(null).merges).toBe(false);
  });
});

describe('repository contract', () => {
  it('states the authorized operations and the merge prohibition', () => {
    const capabilities = parseRepositoryCapabilities('## Repository integration\n- issues: allow\n- branches: allow\n- pull-requests: allow');
    const contract = composeRepositoryContract(capabilities, link);

    expect(contract).toContain('example/agent');
    expect(contract).toContain('MAY create and edit issues');
    expect(contract).toContain(`feature/issue-<number>-<short-slug>`);
    expect(contract).toContain('MAY open a pull request');
    expect(contract).toContain('MUST NOT merge');
  });

  it('is empty without a link or without an authorized workflow', () => {
    const capabilities = parseRepositoryCapabilities('## Repository integration\n- issues: allow');
    expect(composeRepositoryContract(capabilities, null)).toBe('');
    expect(composeRepositoryContract(parseRepositoryCapabilities(''), link)).toBe('');
  });
});

describe('branch naming', () => {
  it('derives a predictable branch name from the issue', () => {
    expect(issueBranchName({ number: 42, title: 'Add retry to the sync worker!' })).toBe('feature/issue-42-add-retry-to-the-sync-worker');
  });

  it('keeps the number when a title has no usable characters', () => {
    expect(issueBranchName({ number: 7, title: '***' })).toBe('feature/issue-7');
    expect(slugifyIssueTitle('a'.repeat(80)).length).toBeLessThanOrEqual(40);
  });
});