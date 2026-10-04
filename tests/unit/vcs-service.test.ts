import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const vcs = require('../../electron/vcs-service.cjs') as {
  apiBaseFor: (link: { providerId: string; host: string }) => string;
  credentialState: (providerId: string) => { configured: boolean; source: string };
  createRepositoryIssue: (project: unknown, draft: unknown) => Promise<{ ok: boolean; issue: unknown; error: string | null }>;
  discoverVcsProviders: () => Promise<Array<{ installation: { connected: boolean; error: string | null }; capabilities: { supportsMerge: boolean }; credential: { configured: boolean } }>>;
  listRepositoryIssues: (project: unknown, options: unknown) => Promise<{ ok: boolean; issues: unknown[]; error: string | null }>;
  setVcsCredential: (providerId: string, token: string | null) => { configured: boolean; source: string };
  updateRepositoryIssue: (project: unknown, number: number, patch: unknown) => Promise<{ ok: boolean; error: string | null }>;
  validateDraft: (draft: unknown) => { error: string | null; draft?: { title: string; labels: string[] } };
};

const project = {
  id: 'project-1',
  name: 'Example',
  path: '/tmp/example',
  lastOpenedAt: '2026-10-02T00:00:00.000Z',
  repository: { providerId: 'github', host: 'github.com', owner: 'example', name: 'agent', defaultBranch: 'main' },
};

afterEach(async () => {
  await setCredential(null);
});

async function setCredential(token: string | null) {
  vcs.setVcsCredential('github', token);
  vcs.setVcsCredential('gitlab', token);
}

describe('repository provider base URLs', () => {
  it('uses the documented API hosts and refuses an unimplemented provider', () => {
    expect(vcs.apiBaseFor({ providerId: 'github', host: 'github.com' })).toBe('https://api.github.com');
    expect(vcs.apiBaseFor({ providerId: 'github', host: 'github.enterprise.internal' })).toBe('https://github.enterprise.internal/api/v3');
    expect(() => vcs.apiBaseFor({ providerId: 'gitlab', host: 'gitlab.com' })).toThrow(/not implemented/i);
  });
});

describe('session credentials', () => {
  it('reports only whether a credential exists and never returns the token', () => {
    delete process.env.AGENTSMITH_GITHUB_TOKEN;
    expect(vcs.credentialState('github')).toEqual({ providerId: 'github', configured: false, source: 'none' });

    const state = vcs.setVcsCredential('github', 'ghp_sessionvalue');
    expect(state).toEqual({ providerId: 'github', configured: true, source: 'session' });
    expect(JSON.stringify(state)).not.toContain('ghp_sessionvalue');

    expect(vcs.setVcsCredential('github', null)).toEqual({ providerId: 'github', configured: false, source: 'none' });
  });

  it('describes provider capability without contacting the provider when unconfigured', async () => {
    delete process.env.AGENTSMITH_GITHUB_TOKEN;
    const [discovery] = await vcs.discoverVcsProviders();

    expect(discovery.installation.providerId).toBe('github');
    expect(discovery.installation.connected).toBe(false);
    expect(discovery.installation.error).toBeNull();
    expect(discovery.credential).toEqual({ providerId: 'github', configured: false, source: 'none' });
    expect(discovery.capabilities).toEqual({ supportsIssues: true, supportsBranches: true, supportsPullRequests: true, supportsMerge: false });
  });

  it('reads a credential from the environment without persisting it', () => {
    process.env.AGENTSMITH_GITHUB_TOKEN = 'ghp_environmentvalue';
    expect(vcs.credentialState('github')).toEqual({ providerId: 'github', configured: true, source: 'environment' });
    delete process.env.AGENTSMITH_GITHUB_TOKEN;
  });
});

describe('issue reads and writes', () => {
  it('refuses to act on a project that is not linked to a repository', async () => {
    expect(await vcs.listRepositoryIssues({ ...project, repository: null }, { state: 'open' })).toEqual({ ok: false, repository: '', issues: [], error: 'This project is not linked to a repository yet.' });
    expect(await vcs.createRepositoryIssue({ ...project, repository: null }, { title: 'A', body: '', labels: [] })).toMatchObject({ ok: false, issue: null });
  });

  it('does not contact a provider when no credential is configured', async () => {
    delete process.env.AGENTSMITH_GITHUB_TOKEN;
    const listed = await vcs.listRepositoryIssues(project, { state: 'open' });
    expect(listed.ok).toBe(false);
    expect(listed.error).toContain('No github credential is configured');
    expect(JSON.stringify(listed)).not.toContain('ghp_');
  });

  it('validates an issue draft before it reaches the provider', () => {
    expect(vcs.validateDraft({ title: '  ', body: '' }).error).toContain('title');
    expect(vcs.validateDraft({ title: 'A'.repeat(300), body: '' }).error).toContain('256');
    expect(vcs.validateDraft({ title: 'ok', body: 'x'.repeat(70000) }).error).toContain('65536');
    expect(vcs.validateDraft({ title: ' ok ', body: '', labels: ['bug', '', '  ', 42] })).toEqual({ error: null, draft: { title: 'ok', body: '', labels: ['bug'] } });
  });

  it('rejects an issue patch that reaches outside an issue', async () => {
    expect(await vcs.updateRepositoryIssue(project, 1, { merge: true })).toMatchObject({ ok: false, issue: null });
    expect((await vcs.updateRepositoryIssue(project, 1, { merged: true })).error).toContain('merged');
    expect((await vcs.updateRepositoryIssue(project, 1, { state: 'merged' })).error).toContain('open or closed');
    expect((await vcs.updateRepositoryIssue(project, 0, { title: 'ok' })).error).toContain('number');
    expect((await vcs.updateRepositoryIssue(project, 1, {})).error).toContain('Nothing to change');
    expect((await vcs.updateRepositoryIssue(project, 1, ['title'])).error).toContain('not valid');
  });

  it('exposes no merge operation at all', () => {
    const surface = Object.keys(vcs).join(' ');
    expect(surface).not.toMatch(/merge/i);
  });
});