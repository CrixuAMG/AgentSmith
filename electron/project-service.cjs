const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ignore = require('ignore');

const MAX_FILE_SIZE = 1024 * 1024;
const MAX_TREE_NODES = 6000;
const MAX_TREE_DEPTH = 14;
const globalInstructionToken = '@global/AGENTS.md';

const isWithin = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

const normalizeRelative = (value) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A relative project path is required.');
  const normalized = value.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error('The requested path leaves the project root.');
  }
  return normalized.replace(/^\.\//, '');
};

async function canonicalRoot(project) {
  if (!project || typeof project.path !== 'string') throw new Error('Project path is missing.');
  const root = await fs.realpath(project.path);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error('The selected project is not a directory.');
  return root;
}

async function safePath(project, relativePath, options = {}) {
  const root = await canonicalRoot(project);
  const normalized = normalizeRelative(relativePath);
  const candidate = path.resolve(root, normalized);
  if (!isWithin(root, candidate)) throw new Error('The requested path leaves the project root.');
  if (options.mustExist === false) return { root, candidate, relativePath: normalized };
  const target = await fs.realpath(candidate);
  if (!isWithin(root, target)) throw new Error('The requested symlink resolves outside the project root.');
  return { root, candidate: target, relativePath: normalized };
}

function expandBraces(pattern) {
  const match = pattern.match(/^(.*)\{([^{}]+)\}(.*)$/);
  if (!match) return [pattern];
  return match[2].split(',').flatMap((part) => expandBraces(`${match[1]}${part}${match[3]}`));
}

function globRegex(pattern) {
  const normalized = pattern.replaceAll('\\', '/');
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '.';
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, 'i');
}

function guardrailMatches(pattern, relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  return expandBraces(pattern).some((candidate) => {
    const normalizedPattern = candidate.replaceAll('\\', '/');
    if (globRegex(normalizedPattern).test(normalized)) return true;
    if (normalizedPattern.startsWith('**/')) return globRegex(normalizedPattern.slice(3)).test(normalized);
    return false;
  });
}

function readAllowed(relativePath, profile) {
  const rules = profile?.rules || [];
  const matched = rules.find((rule) => rule.enabled && rule.type === 'file_access' && guardrailMatches(rule.pattern, relativePath));
  if (matched?.action === 'deny') {
    return { allowed: false, reason: matched.description || `Blocked by guardrail ${matched.id}.` };
  }
  return { allowed: true, reason: null };
}

async function createIgnoreFilter(root) {
  const filter = ignore();
  const gitignorePath = path.join(root, '.gitignore');
  try {
    filter.add(await fs.readFile(gitignorePath, 'utf8'));
  } catch {
    // A repository without .gitignore is still a valid project.
  }
  return filter;
}

async function scanProject(project, options = {}) {
  const root = await canonicalRoot(project);
  const filter = await createIgnoreFilter(root);
  const showHidden = Boolean(options.showHidden);
  let nodeCount = 0;

  async function walk(directory, relativeDirectory, depth) {
    if (depth > MAX_TREE_DEPTH || nodeCount >= MAX_TREE_NODES) return [];
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const nodes = [];
    for (const entry of entries) {
      if (nodeCount >= MAX_TREE_NODES) break;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (!showHidden && entry.name.startsWith('.')) continue;
      if (entry.name === '.git') continue;
      if (filter.ignores(`${relativePath}${entry.isDirectory() ? '/' : ''}`)) continue;
      nodeCount += 1;
      if (entry.isSymbolicLink()) {
        nodes.push({ name: entry.name, relativePath, kind: 'symlink' });
        continue;
      }
      if (entry.isDirectory()) {
        const children = await walk(path.join(directory, entry.name), relativePath, depth + 1);
        nodes.push({ name: entry.name, relativePath, kind: 'directory', children });
      } else if (entry.isFile()) {
        const stat = await fs.stat(path.join(directory, entry.name));
        nodes.push({ name: entry.name, relativePath, kind: 'file', size: stat.size });
      }
    }
    return nodes.sort((left, right) => {
      if (left.kind === 'directory' && right.kind !== 'directory') return -1;
      if (left.kind !== 'directory' && right.kind === 'directory') return 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });
  }

  return walk(root, '', 0);
}

function languageFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const names = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.vue': 'xml', '.html': 'xml', '.css': 'css', '.scss': 'scss', '.json': 'json',
    '.md': 'markdown', '.yml': 'yaml', '.yaml': 'yaml', '.php': 'php', '.py': 'python',
    '.rs': 'rust', '.go': 'go', '.java': 'java', '.rb': 'ruby', '.sh': 'shell',
  };
  return names[extension] || 'plaintext';
}

async function readFile(project, relativePath, guardrails) {
  const normalized = normalizeRelative(relativePath);
  const permission = readAllowed(normalized, guardrails);
  if (!permission.allowed) throw new Error(permission.reason);
  const target = await safePath(project, normalized);
  const stat = await fs.stat(target.candidate);
  if (!stat.isFile()) throw new Error('Only files can be previewed.');
  if (stat.size > MAX_FILE_SIZE) throw new Error('This file is larger than the 1 MB preview limit.');
  const buffer = await fs.readFile(target.candidate);
  if (buffer.includes(0)) throw new Error('Binary files are not shown in the viewer.');
  const content = buffer.toString('utf8');
  return { relativePath: normalized, content, language: languageFor(normalized), lineCount: content ? content.split('\n').length : 1, size: stat.size };
}

async function validateProject(project) {
  try {
    await canonicalRoot(project);
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function atomicTextWrite(filePath, content, overwrite) {
  let existing = false;
  try {
    await fs.access(filePath);
    existing = true;
  } catch {
    existing = false;
  }
  if (existing && !overwrite) throw new Error('The instruction file already exists. Confirm replacement first.');
  if (existing) await fs.copyFile(filePath, `${filePath}.bak-${Date.now()}`);
  const temporary = `${filePath}.tmp-${crypto.randomUUID()}`;
  await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, filePath);
}

async function listInstructions(project, globalPath) {
  const root = await canonicalRoot(project);
  const found = [{ relativePath: globalInstructionToken, absolutePath: globalPath, scope: 'global', depth: 0, readable: true }];
  async function walk(directory, relativeDirectory, depth) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), relativePath, depth + 1);
      } else if (entry.isFile() && entry.name === 'AGENTS.md') {
        found.push({
          relativePath,
          absolutePath: path.join(directory, entry.name),
          scope: depth === 0 ? 'project' : 'nested',
          depth,
          readable: true,
        });
      }
    }
  }
  await walk(root, '', 0);
  return found.sort((left, right) => left.depth - right.depth || left.relativePath.localeCompare(right.relativePath));
}

async function readInstruction(project, relativePath, globalPath) {
  if (relativePath === globalInstructionToken) return fs.readFile(globalPath, 'utf8');
  if (!relativePath.endsWith('/AGENTS.md') && relativePath !== 'AGENTS.md') throw new Error('Only AGENTS.md instruction files can be managed.');
  const target = await safePath(project, relativePath);
  return fs.readFile(target.candidate, 'utf8');
}

async function writeInstruction(project, relativePath, content, overwrite, globalPath) {
  if (typeof content !== 'string' || content.length > MAX_FILE_SIZE) throw new Error('Instruction content must be text smaller than 1 MB.');
  if (relativePath === globalInstructionToken) {
    await atomicTextWrite(globalPath, content, overwrite);
    return;
  }
  if (!relativePath.endsWith('/AGENTS.md') && relativePath !== 'AGENTS.md') throw new Error('Instruction files must be named AGENTS.md.');
  const target = await safePath(project, relativePath, { mustExist: false });
  await fs.mkdir(path.dirname(target.candidate), { recursive: true });
  await atomicTextWrite(target.candidate, content, overwrite);
}

module.exports = {
  globalInstructionToken,
  canonicalRoot,
  safePath,
  validateProject,
  scanProject,
  readFile,
  listInstructions,
  readInstruction,
  writeInstruction,
};
