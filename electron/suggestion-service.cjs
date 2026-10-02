const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_SUGGESTION_BYTES = 256 * 1024;
const MAX_FOLDER_NAME_LENGTH = 80;
const MAX_NAME_ATTEMPTS = 20;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const isWithin = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const timestamp = () => new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');

/**
 * The renderer supplies the project display name, which is untrusted input. It is
 * rejected unless it can be used as a single directory segment inside the
 * suggestions root, so a crafted name can never redirect the write.
 */
function suggestionFolderName(value) {
  if (typeof value !== 'string') throw new Error('A project name is required to save a suggestion.');
  const name = value.trim();
  if (!name || name.length > MAX_FOLDER_NAME_LENGTH) throw new Error('The project name is not usable as a suggestion folder.');
  if (name === '.' || name === '..') throw new Error('The project name is not usable as a suggestion folder.');
  if (/[/\\]/.test(name)) throw new Error('The project name must not contain path separators.');
  if (CONTROL_CHARACTERS.test(name)) throw new Error('The project name must not contain control characters.');
  return name;
}

function assertSuggestionContent(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A suggestion body is required.');
  if (Buffer.byteLength(value, 'utf8') > MAX_SUGGESTION_BYTES) throw new Error('The suggestion is larger than the 256 KB storage limit.');
  return value;
}

async function resolveSuggestionDirectory(root, folder) {
  const logicalRoot = path.resolve(root);
  let base;
  try {
    base = await fs.realpath(logicalRoot);
  } catch (error) {
    if (!(error instanceof Error && error.code === 'ENOENT')) throw error;
    await fs.mkdir(logicalRoot, { recursive: true, mode: 0o700 });
    base = await fs.realpath(logicalRoot);
  }
  const logicalDirectory = path.resolve(logicalRoot, folder);
  if (!isWithin(logicalRoot, logicalDirectory)) throw new Error('The suggestion folder resolves outside the suggestions root.');
  await fs.mkdir(logicalDirectory, { recursive: true, mode: 0o700 });
  // A pre-existing symlink at the folder name must not redirect the write.
  const resolvedDirectory = await fs.realpath(logicalDirectory);
  if (!isWithin(base, resolvedDirectory)) throw new Error('The suggestion folder resolves outside the suggestions root.');
  return { resolvedDirectory, logicalDirectory };
}

async function writeSuggestionFile(directory, fileNameBase, content) {
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const fileName = attempt === 0 ? `${fileNameBase}.md` : `${fileNameBase}-${attempt + 1}.md`;
    const absolutePath = path.join(directory, fileName);
    try {
      // 'wx' fails instead of truncating, so an existing suggestion is never lost.
      await fs.writeFile(absolutePath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      return { fileName, absolutePath };
    } catch (error) {
      if (!(error instanceof Error && error.code === 'EEXIST')) throw error;
    }
  }
  throw new Error('A unique suggestion file name could not be allocated.');
}

async function saveSuggestion(root, project, content) {
  const folder = suggestionFolderName(project?.name);
  assertSuggestionContent(content);
  const { resolvedDirectory, logicalDirectory } = await resolveSuggestionDirectory(root, folder);
  const { fileName } = await writeSuggestionFile(resolvedDirectory, timestamp(), content);
  return {
    relativePath: path.join('suggestions', folder, fileName),
    absolutePath: path.join(logicalDirectory, fileName),
    savedAt: new Date().toISOString(),
  };
}

module.exports = { saveSuggestion, suggestionFolderName, MAX_SUGGESTION_BYTES };