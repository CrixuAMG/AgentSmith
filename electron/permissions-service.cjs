const fs = require('node:fs/promises');
const path = require('node:path');

function normalizeExternalPath(p) {
  const cleaned = (p || '').trim();
  if (!cleaned) return '';
  if (cleaned.endsWith('/*') || cleaned.endsWith('*')) return cleaned;
  if (!cleaned.includes('.')) return cleaned.endsWith('/') ? cleaned + '*' : cleaned + '/*';
  return cleaned;
}

function isValidExternalPath(value) {
  if (typeof value !== 'string') return false;
  const cleaned = value.trim().replace(/\/*\*$/, '');
  return cleaned.length > 0 && !cleaned.includes('\0')
    && (cleaned.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cleaned));
}

function buildExternalPermissions(additions = []) {
  const result = {};
  const seen = new Set();
  for (const a of additions) {
    if (!isValidExternalPath(a)) throw new Error('Invalid external permission path.');
    const n = normalizeExternalPath(a);
    if (n && !seen.has(n)) {
      seen.add(n);
      result[n] = 'allow';
    }
  }
  return result;
}

async function writeOpencodeJsonc(targetDir, externalPerms = {}) {
  const file = path.join(targetDir, '.opencode.jsonc');
  const content = `{
  "$schema": "https://opencode.ai/config.json",
  "permissions": {
    "external_directory": ${JSON.stringify(externalPerms, null, 2)}
  }
}
`;
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

module.exports = {
  normalizeExternalPath,
  isValidExternalPath,
  buildExternalPermissions,
  writeOpencodeJsonc,
};
