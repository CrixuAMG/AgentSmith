const { spawn } = require('node:child_process');
const { canonicalRoot, safePath } = require('./project-service.cjs');

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

async function gitDiff(project, relativePath, staged) {
  const target = await safePath(project, relativePath, { mustExist: false });
  const tracked = await runGit(['ls-files', '--error-unmatch', '--', target.relativePath], target.root);
  if (tracked.code !== 0) {
    const untracked = await runGit(['diff', '--no-index', '--unified=80', '/dev/null', target.candidate], target.root);
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

module.exports = { gitStatus, gitDiff, parseStatus };
