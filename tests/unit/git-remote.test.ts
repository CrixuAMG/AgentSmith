import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseRemoteUrl } = require('../../electron/git-service.cjs') as {
  parseRemoteUrl: (url: string) => { providerId: string; host: string; owner: string; name: string } | null;
};

describe('Git remote parsing', () => {
  it('recognizes the common GitHub remote forms', () => {
    expect(parseRemoteUrl('https://github.com/example/agent.git')).toEqual({ providerId: 'github', host: 'github.com', owner: 'example', name: 'agent' });
    expect(parseRemoteUrl('git@github.com:example/agent.git')).toEqual({ providerId: 'github', host: 'github.com', owner: 'example', name: 'agent' });
    expect(parseRemoteUrl('ssh://git@github.com/example/agent.git')).toEqual({ providerId: 'github', host: 'github.com', owner: 'example', name: 'agent' });
  });

  it('keeps nested GitLab groups and enterprise hosts', () => {
    expect(parseRemoteUrl('https://gitlab.com/group/subgroup/agent.git')).toEqual({ providerId: 'gitlab', host: 'gitlab.com', owner: 'group/subgroup', name: 'agent' });
    expect(parseRemoteUrl('git@git.example.com:team/agent.git')).toBeNull();
    expect(parseRemoteUrl('https://git.example.com/team/agent.git')).toBeNull();
  });

  it('drops an embedded credential instead of carrying it forward', () => {
    const parsed = parseRemoteUrl('https://user:ghp_secrettokenvalue@example.com@example/agent.git');
    expect(parsed).toBeNull();
    expect(parseRemoteUrl('https://x-access-token:ghp_secrettokenvalue@github.com/example/agent.git')).toEqual({ providerId: 'github', host: 'github.com', owner: 'example', name: 'agent' });
  });

  it('rejects a value that is not a repository URL', () => {
    expect(parseRemoteUrl('')).toBeNull();
    expect(parseRemoteUrl('origin')).toBeNull();
    expect(parseRemoteUrl('https://github.com/example')).toBeNull();
    expect(parseRemoteUrl(null)).toBeNull();
  });
});