const { spawn } = require('node:child_process');
const { canonicalRoot, safePath, readAllowed } = require('./project-service.cjs');

const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e';
// `for-each-ref` does not expand %x escapes, so the branch format uses literal tabs.
const BRANCH_FORMAT = '%(refname)\t%(refname:short)\t%(upstream:short)\t%(upstream:track)\t%(committerdate:iso-strict)';
const BRANCH_FIELD = '\t';
const MAX_COMMITS = 200;
const DEFAULT_COMMITS = 50;
// A revision is passed to `git log` as a positional argument, so anything that could be
// read as an option is rejected instead of being handed to Git.
const revisionPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function validRevision(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 200
    && !value.includes('..')
    && !value.includes('//')
    && revisionPattern.test(value);
}

async function repositoryRoot(project) {
  try {
    return { root: await canonicalRoot(project), error: null };
  } catch (error) {
    return { root: null, error: messageOf(error) };
  }
}

function parseBranch(header) {
  const value = header.slice(3).trim();
  if (value.startsWith('No commits yet on ')) return { branch: value.slice('No commits yet on '.length), ahead: 0, behind: 0 };
  if (value === 'HEAD (no branch)') return { branch: 'detached HEAD', ahead: 0, behind: 0 };
  const branchPart = value.split('...')[0];
  const ahead = Number(value.match(/ahead (\d+)/)?.[1] || 0);
  const behind = Number(value.match(/behind (\d+)/)?.[1] || 0);
  return { branch: branchPart === 'HEAD' ? 'detached HEAD' : branchPart, ahead, behind };
}

function changeKind(indexStatus, worktreeStatus, filePath) {
  if (indexStatus === '?' && worktreeStatus === '?') return 'untracked';
  if (indexStatus === 'U' || worktreeStatus === 'U') return 'conflicted';
  if (indexStatus === 'R' || worktreeStatus === 'R' || filePath.includes(' -> ')) return 'renamed';
  if (indexStatus === 'A' || worktreeStatus === 'A') return 'added';
  if (indexStatus === 'D' || worktreeStatus === 'D') return 'deleted';
  return 'modified';
}

function parseStatus(output) {
  const lines = output.split('\0').filter(Boolean);
  const header = lines.shift() || '';
  const branch = parseBranch(header);
  const changes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indexStatus = line[0] || ' ';
    const worktreeStatus = line[1] || ' ';
    const rawPath = line.slice(3);
    let filePath = rawPath;
    let oldPath;
    if (rawPath.includes(' -> ')) {
      [oldPath, filePath] = rawPath.split(' -> ');
    } else if (indexStatus === 'R' || worktreeStatus === 'R') {
      filePath = rawPath;
      oldPath = lines[index + 1];
      index += 1;
    }
    changes.push({
      path: filePath,
      oldPath,
      kind: changeKind(indexStatus, worktreeStatus, rawPath),
      staged: indexStatus !== ' ' && indexStatus !== '?',
      unstaged: worktreeStatus !== ' ' && worktreeStatus !== '?',
      indexStatus,
      worktreeStatus,
    });
  }
  return { ...branch, changes };
}

async function gitStatus(project) {
  let root;
  try {
    root = await canonicalRoot(project);
  } catch (error) {
    return { isRepository: false, branch: null, ahead: 0, behind: 0, changes: [], error: error instanceof Error ? error.message : String(error) };
  }
  let result;
  try {
    result = await runGit(['status', '--porcelain=v1', '-b', '-z'], root);
  } catch (error) {
    return { isRepository: false, branch: null, ahead: 0, behind: 0, changes: [], error: error instanceof Error ? error.message : String(error) };
  }
  if (result.code !== 0) {
    const notRepository = result.stderr.includes('not a git repository');
    return { isRepository: false, branch: null, ahead: 0, behind: 0, changes: [], error: notRepository ? 'This project is not a Git repository.' : result.stderr.trim() || 'Git status failed.' };
  }
  return { isRepository: true, error: null, ...parseStatus(result.stdout) };
}

async function gitDiff(project, relativePath, staged, guardrails) {
  const target = await safePath(project, relativePath, { mustExist: false });
  const permission = readAllowed(target.relativePath, guardrails);
  if (!permission.allowed) throw new Error(permission.reason);
  const tracked = await runGit(['ls-files', '--error-unmatch', '--', target.relativePath], target.root);
  if (tracked.code !== 0) {
    const untracked = await runGit(['diff', '--no-index', '--no-ext-diff', '--text', '--unified=80', '/dev/null', target.candidate], target.root);
    if (untracked.code !== 0 && untracked.code !== 1) throw new Error(untracked.stderr.trim() || 'Git diff failed.');
    return untracked.stdout || 'No diff available for this file.';
  }
  const result = await runGit([
    'diff',
    ...(staged ? ['--cached'] : []),
    '--no-ext-diff',
    '--unified=80',
    '--',
    target.relativePath,
  ], target.root);
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'Git diff failed.');
  return result.stdout || 'No diff available for this file.';
}

function parseLog(output) {
  return output
    .split('\u001e')
    .map((record) => record.replace(/^\s+|\s+$/g, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, author, date, subject] = record.split('\u001f');
      return { hash, shortHash, author, date, subject: subject ?? '' };
    })
    .filter((commit) => Boolean(commit.hash) && Boolean(commit.shortHash));
}

function parseBranches(output, current) {
  return output
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter(Boolean)
    .map((line) => {
      const [ref, name, upstream, track, date] = line.split(BRANCH_FIELD);
      const ahead = Number((track || '').match(/ahead (\d+)/)?.[1] || 0);
      const behind = Number((track || '').match(/behind (\d+)/)?.[1] || 0);
      return {
        name,
        isCurrent: name === current,
        isRemote: ref.startsWith('refs/remotes/'),
        upstream: upstream || null,
        ahead,
        behind,
        date: date || null,
      };
    })
    .filter((branch) => Boolean(branch.name) && !branch.name.endsWith('/HEAD'));
}

async function gitLog(project, options = {}) {
  const requested = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? Math.min(Math.max(Math.trunc(options.limit), 1), MAX_COMMITS)
    : DEFAULT_COMMITS;
  const revision = options.branch ? options.branch : 'HEAD';
  if (!validRevision(revision)) {
    return { isRepository: true, branch: null, commits: [], error: 'That branch name is not valid.' };
  }
  const { root, error } = await repositoryRoot(project);
  if (!root) return { isRepository: false, branch: null, commits: [], error };
  // Resolve the revision to a commit hash first: an unborn branch or a stale branch
  // name is an empty history, not a failure, and a hash cannot be re-interpreted.
  const resolved = await runGit(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`], root);
  if (resolved.code !== 0) return { isRepository: true, branch: revision, commits: [], error: null };
  const result = await runGit(['log', `--max-count=${requested}`, '--no-color', `--pretty=format:${LOG_FORMAT}`, resolved.stdout.trim(), '--'], root);
  if (result.code !== 0) {
    return { isRepository: true, branch: revision, commits: [], error: result.stderr.trim() || 'Git log failed.' };
  }
  return { isRepository: true, branch: revision, commits: parseLog(result.stdout), error: null };
}

async function gitBranches(project) {
  const { root, error } = await repositoryRoot(project);
  if (!root) return { isRepository: false, current: null, branches: [], error };
  const current = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], root);
  const currentName = current.code === 0 ? current.stdout.trim() : null;
  const result = await runGit(['for-each-ref', '--sort=-committerdate', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes'], root);
  if (result.code !== 0) {
    return { isRepository: true, current: currentName, branches: [], error: result.stderr.trim() || 'Git branch listing failed.' };
  }
  return { isRepository: true, current: currentName, branches: parseBranches(result.stdout, currentName), error: null };
}

// Pushes the branch that is already checked out, using the remote and upstream the
// user configured. No arguments, flags, or credentials are accepted from the renderer.
async function gitPush(project) {
  const { root, error } = await repositoryRoot(project);
  if (!root) return { ok: false, message: error };
  const result = await runGit(['push'], root);
  const output = (result.stderr.trim() || result.stdout.trim());
  const message = output || (result.code === 0 ? 'Git push completed.' : 'Git push failed.');
  return { ok: result.code === 0, message };
}

/**
 * Maps a Git remote URL to a hosted repository. Only the host decides the provider, so
 * a crafted remote cannot claim a provider the host does not serve. The URL may contain
 * an embedded credential for HTTPS remotes; that part is dropped here and never stored.
 */
function parseRemoteUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  const trimmed = url.trim();
  const scpLike = trimmed.match(/^(?:([^@/]+)@)?([^:/@]+):(?!\/)(.+)$/);
  let host = null;
  let path = null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    host = parsed.hostname.toLowerCase();
    path = decodeURIComponent(parsed.pathname);
  } else if (scpLike) {
    host = scpLike[2].toLowerCase();
    path = scpLike[3];
  } else {
    return null;
  }
  const segments = (path ?? '').replace(/^\/+/, '').replace(/\.git$/i, '').split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const providerId = host === 'github.com' || host.endsWith('.github.com')
    ? 'github'
    : host === 'gitlab.com' || host.includes('gitlab')
      ? 'gitlab'
      : null;
  if (!providerId) return null;
  return { providerId, host, owner: segments.slice(0, -1).join('/'), name: segments.at(-1) ?? '' };
}

async function defaultBranchOf(root) {
  const head = await runGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root);
  const remoteBranch = head.code === 0 ? head.stdout.trim().split('/').slice(1).join('/') : '';
  if (remoteBranch) return remoteBranch;
  const current = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], root);
  const branch = current.code === 0 ? current.stdout.trim() : '';
  return branch || 'main';
}

/**
 * Detects the hosted repository of a project from its `origin` remote. This runs only
 * local Git plumbing: nothing here contacts the provider.
 */
async function gitRemote(project, remote = 'origin') {
  const { root, error } = await repositoryRoot(project);
  if (!root) return { remote: null, link: null, error };
  const result = await runGit(['remote', 'get-url', remote], root);
  if (result.code !== 0) {
    return { remote: null, link: null, error: 'This project has no Git remote to link a repository to.' };
  }
  const url = result.stdout.trim();
  const parsed = parseRemoteUrl(url);
  if (!parsed) {
    return { remote, link: null, error: 'The Git remote is not a supported GitHub or GitLab repository.' };
  }
  return {
    remote,
    link: { ...parsed, defaultBranch: await defaultBranchOf(root) },
    error: null,
  };
}

module.exports = { gitStatus, gitDiff, gitLog, gitBranches, gitPush, gitRemote, parseRemoteUrl, parseStatus, parseLog, parseBranches };
