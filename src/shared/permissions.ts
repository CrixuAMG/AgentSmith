import path from 'node:path';

export interface ExternalPermissionGrant {
  path: string;
  scope: 'project' | 'global' | 'session';
}

export function normalizeExternalPath(p: string): string {
  const cleaned = p.trim();
  if (!cleaned) return '';
  // Ensure we end with /* for directories we want to allow, or keep as-is
  if (cleaned.endsWith('/*') || cleaned.endsWith('*')) return cleaned;
  // If it's a directory, add /*
  try {
    // In renderer we won't stat, but in main process we could; keep simple heuristic
    if (!cleaned.includes('.')) return cleaned.endsWith('/') ? cleaned + '*' : cleaned + '/*';
  } catch (e) {
    // ignore
  }
  return cleaned;
}

export function mergePermissions(existing: Record<string, string> = {}, additions: string[], scope: 'project' | 'global'): Record<string, string> {
  const result = { ...existing };
  for (const add of additions) {
    const norm = normalizeExternalPath(add);
    if (!norm) continue;
    result[norm] = 'allow';
  }
  return result;
}

export async function writeOpencodePermissions(targetDir: string, permissions: Record<string, string>): Promise<void> {
  // Lazy import fs to avoid bundling issues in renderer
  const fs = await import('node:fs/promises');
  const file = path.join(targetDir, '.opencode.jsonc');
  const content = `{
  "$schema": "https://opencode.ai/config.json",
  "permissions": {
    "external_directory": ${JSON.stringify(permissions, null, 2)}
  }
}
`;
  try {
    await fs.writeFile(file, content, 'utf8');
  } catch (e) {
    throw e;
  }
}
