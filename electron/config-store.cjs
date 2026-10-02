const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  defaultConfig,
  defaultGoals,
  defaultRoles,
  defaultGuardrails,
  defaultProviderSettings,
  defaultProfiles,
} = require('./default-data.cjs');

const root = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'AgentSmith')
  : path.join(os.homedir(), '.config', 'AgentSmith');

const directories = ['goals', 'roles', 'guardrails', 'providers', 'prompts', 'instructions', 'logs'];
const resourceFiles = {
  config: 'config.json',
  projects: 'projects.json',
  profiles: 'profiles.json',
  providerSettings: path.join('providers', 'providers.json'),
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const timestamp = () => new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');

async function ensureRoot() {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await Promise.all(directories.map((directory) => fs.mkdir(path.join(root, directory), { recursive: true, mode: 0o700 })));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomic(filePath, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  if (await exists(filePath)) {
    await fs.copyFile(filePath, `${filePath}.bak-${timestamp()}`);
  }
  await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, filePath);
}

async function readJson(filePath, fallback, warnings) {
  if (!(await exists(filePath))) {
    await writeAtomic(filePath, fallback);
    return clone(fallback);
  }
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!parsed || parsed.version !== 1) throw new Error('unsupported schema version');
    return parsed;
  } catch {
    const invalidPath = `${filePath}.invalid-${timestamp()}`;
    await fs.rename(filePath, invalidPath).catch(() => {});
    warnings.push(`Configuration recovery: ${path.basename(filePath)} was invalid and moved aside.`);
    await writeAtomic(filePath, fallback);
    return clone(fallback);
  }
}

async function readCollection(directory, defaults, warnings) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  if (jsonFiles.length === 0) {
    await Promise.all(defaults.map((item) => writeAtomic(path.join(directory, `${item.id}.json`), item)));
    return clone(defaults);
  }
  const values = [];
  for (const entry of jsonFiles) {
    const fallback = defaults.find((item) => item.id === path.basename(entry.name, '.json')) || defaults[0];
    values.push(await readJson(path.join(directory, entry.name), fallback, warnings));
  }
  return values;
}

async function loadSnapshot() {
  await ensureRoot();
  const warnings = [];
  const config = await readJson(path.join(root, resourceFiles.config), defaultConfig, warnings);
  const projectsEnvelope = await readJson(path.join(root, resourceFiles.projects), { version: 1, projects: [] }, warnings);
  const profilesEnvelope = await readJson(path.join(root, resourceFiles.profiles), { version: 1, profiles: defaultProfiles }, warnings);
  const providerEnvelope = await readJson(path.join(root, resourceFiles.providerSettings), { version: 1, providers: defaultProviderSettings }, warnings);
  const goals = await readCollection(path.join(root, 'goals'), defaultGoals, warnings);
  const roles = await readCollection(path.join(root, 'roles'), defaultRoles, warnings);
  const guardrails = await readCollection(path.join(root, 'guardrails'), defaultGuardrails, warnings);
  const globalPath = path.join(root, 'instructions', 'global.md');
  if (!(await exists(globalPath))) await fs.writeFile(globalPath, '', { encoding: 'utf8', mode: 0o600 });
  const globalInstructions = await fs.readFile(globalPath, 'utf8');
  return {
    config,
    projects: Array.isArray(projectsEnvelope.projects) ? projectsEnvelope.projects : [],
    goals,
    roles,
    guardrails,
    profiles: Array.isArray(profilesEnvelope.profiles) ? profilesEnvelope.profiles : clone(defaultProfiles),
    providerSettings: Array.isArray(providerEnvelope.providers) ? providerEnvelope.providers : clone(defaultProviderSettings),
    globalInstructions,
    storageRoot: root,
    warnings,
  };
}

function assertCollection(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
}

async function saveResource(key, value) {
  await ensureRoot();
  if (key === 'globalInstructions') {
    const globalPath = path.join(root, 'instructions', 'global.md');
    const temporary = `${globalPath}.tmp-${process.pid}-${Date.now()}`;
    if (await exists(globalPath)) await fs.copyFile(globalPath, `${globalPath}.bak-${timestamp()}`);
    await fs.writeFile(temporary, String(value), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, globalPath);
    return;
  }
  if (key === 'config') {
    await writeAtomic(path.join(root, resourceFiles.config), { ...clone(value), version: 1 });
    return;
  }
  if (key === 'projects') {
    assertCollection(value, 'projects');
    await writeAtomic(path.join(root, resourceFiles.projects), { version: 1, projects: clone(value) });
    return;
  }
  if (key === 'profiles') {
    assertCollection(value, 'profiles');
    await writeAtomic(path.join(root, resourceFiles.profiles), { version: 1, profiles: clone(value) });
    return;
  }
  if (key === 'providerSettings') {
    assertCollection(value, 'providers');
    await writeAtomic(path.join(root, resourceFiles.providerSettings), { version: 1, providers: clone(value) });
    return;
  }
  if (!['goals', 'roles', 'guardrails'].includes(key)) throw new Error(`Unsupported resource: ${key}`);
  assertCollection(value, key);
  const directory = path.join(root, key);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const existing = await fs.readdir(directory, { withFileTypes: true });
  const expected = new Set(value.map((item) => `${item.id}.json`));
  await Promise.all(existing
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !expected.has(entry.name))
    .map((entry) => fs.rename(path.join(directory, entry.name), `${path.join(directory, entry.name)}.bak-${timestamp()}`)));
  await Promise.all(value.map((item) => writeAtomic(path.join(directory, `${item.id}.json`), { ...clone(item), version: 1 })));
}

module.exports = { root, loadSnapshot, saveResource, writeAtomic };
