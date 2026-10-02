const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  defaultConfig,
  defaultLayout,
  defaultGoals,
  defaultRoles,
  defaultGuardrails,
  defaultProviderSettings,
  defaultProfiles,
} = require('./default-data.cjs');

const root = process.env.AGENTSMITH_CONFIG_ROOT || (process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'AgentSmith')
  : path.join(os.homedir(), '.config', 'AgentSmith'));

const directories = ['goals', 'roles', 'guardrails', 'providers', 'prompts', 'instructions', 'suggestions', 'logs'];
const resourceFiles = {
  config: 'config.json',
  projects: 'projects.json',
  profiles: 'profiles.json',
  providerSettings: path.join('providers', 'providers.json'),
  providerInstructions: path.join('providers', 'instructions.json'),
  promptHistory: path.join('prompts', 'history.json'),
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const timestamp = () => new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isBoolean = (value) => typeof value === 'boolean';
const isStringArray = (value) => Array.isArray(value) && value.every(isString);

const workspaceTabs = ['explorer', 'git', 'commits', 'instructions'];
const layoutLimits = {
  railWidth: { min: 180, max: 420 },
  explorerRatio: { min: 0.2, max: 0.6 },
};

function validRule(value) {
  return isObject(value)
    && isString(value.id)
    && ['file_access', 'filesystem_write', 'network', 'database', 'command', 'git', 'agent_permission'].includes(value.type)
    && isString(value.pattern)
    && ['deny', 'warn', 'confirm'].includes(value.action)
    && isBoolean(value.enabled)
    && ['prompt', 'application', 'provider', 'advisory'].includes(value.enforcement)
    && (value.description === undefined || isString(value.description));
}

function validProject(value) {
  return isObject(value)
    && isString(value.id)
    && isString(value.name)
    && isString(value.path)
    && isString(value.lastOpenedAt);
}

function validGoal(value) {
  return isObject(value)
    && value.version === 1
    && isString(value.id)
    && isString(value.name)
    && isString(value.description)
    && isStringArray(value.instructions)
    && isBoolean(value.enabled)
    && typeof value.order === 'number' && Number.isFinite(value.order);
}

function validRole(value) {
  return isObject(value)
    && value.version === 1
    && isString(value.id)
    && isString(value.name)
    && isString(value.description)
    && isStringArray(value.instructions)
    && isStringArray(value.tags)
    && isBoolean(value.enabled);
}

function validGuardrail(value) {
  return isObject(value)
    && value.version === 1
    && isString(value.id)
    && isString(value.name)
    && isString(value.description)
    && Array.isArray(value.rules)
    && value.rules.every(validRule);
}

function validProfile(value) {
  return isObject(value)
    && value.version === 1
    && isString(value.id)
    && isString(value.name)
    && isString(value.providerId)
    && (value.modelId === null || isString(value.modelId))
    && isObject(value.variant)
    && (value.roleId === null || isString(value.roleId))
    && isStringArray(value.goalIds)
    && (value.guardrailProfileId === null || isString(value.guardrailProfileId));
}

function validProviderSetting(value) {
  return isObject(value)
    && isString(value.id)
    && isString(value.name)
    && (value.executable === null || isString(value.executable))
    && isBoolean(value.enabled);
}

function clampLayoutDimension(value, limits, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, limits.min), limits.max);
}

// Layout is an allowlisted preference, not a schema to quarantine over: every field
// is clamped or defaulted so a damaged value never makes the configuration unloadable.
function sanitizeLayout(value) {
  const source = isObject(value) ? value : {};
  return {
    version: 1,
    railWidth: Math.round(clampLayoutDimension(source.railWidth, layoutLimits.railWidth, defaultLayout.railWidth)),
    explorerRatio: Math.round(clampLayoutDimension(source.explorerRatio, layoutLimits.explorerRatio, defaultLayout.explorerRatio) * 1000) / 1000,
    tab: workspaceTabs.includes(source.tab) ? source.tab : defaultLayout.tab,
  };
}

function validLayout(value) {
  return isObject(value)
    && value.version === 1
    && typeof value.railWidth === 'number' && Number.isFinite(value.railWidth)
    && value.railWidth >= layoutLimits.railWidth.min && value.railWidth <= layoutLimits.railWidth.max
    && typeof value.explorerRatio === 'number' && Number.isFinite(value.explorerRatio)
    && value.explorerRatio >= layoutLimits.explorerRatio.min && value.explorerRatio <= layoutLimits.explorerRatio.max
    && workspaceTabs.includes(value.tab);
}

function normalizeDocument(value, kind) {
  if (kind !== 'config' || !isObject(value)) return value;
  const layout = sanitizeLayout(value.layout);
  const current = isObject(value.layout) ? value.layout : {};
  if (current.version === layout.version
    && current.railWidth === layout.railWidth
    && current.explorerRatio === layout.explorerRatio
    && current.tab === layout.tab) return value;
  return { ...value, layout };
}

function validConfig(value) {
  return isObject(value)
    && value.version === 1
    && isString(value.locale)
    && (value.theme === 'dark' || value.theme === 'light')
    && isBoolean(value.showHiddenFiles)
    && (value.lastProjectId === null || isString(value.lastProjectId))
    && (value.activeProfileId === null || isString(value.activeProfileId))
    && validLayout(value.layout);
}

function validProviderInstructions(value) {
  return isObject(value) && Object.values(value).every(isString);
}

function validPromptHistoryEntry(value) {
  return isObject(value)
    && isString(value.id)
    && isString(value.executedAt)
    && isString(value.task)
    && isString(value.prompt)
    && isString(value.providerId)
    && (value.modelId === null || isString(value.modelId))
    && isObject(value.variant)
    && (value.roleId === null || isString(value.roleId))
    && (value.roleName === null || isString(value.roleName))
    && isStringArray(value.goalIds)
    && (value.guardrailProfileId === null || isString(value.guardrailProfileId))
    && (value.guardrailProfileName === null || isString(value.guardrailProfileName))
    && (value.command === null || isString(value.command))
    && ['started', 'completed', 'failed', 'cancelled'].includes(value.status)
    && (value.exitCode === null || (typeof value.exitCode === 'number' && Number.isFinite(value.exitCode)));
}

function validPromptHistory(value) {
  return isObject(value) && Object.values(value).every((entries) => Array.isArray(entries) && entries.length <= 50 && entries.every(validPromptHistoryEntry));
}

function validDocument(value, kind) {
  if (!isObject(value) || value.version !== 1) return false;
  if (kind === 'config') return validConfig(value);
  if (kind === 'projects') return Array.isArray(value.projects) && value.projects.every(validProject);
  if (kind === 'profiles') return Array.isArray(value.profiles) && value.profiles.every(validProfile);
  if (kind === 'providerSettings') return Array.isArray(value.providers) && value.providers.every(validProviderSetting);
  if (kind === 'providerInstructions') return validProviderInstructions(value.instructions);
  if (kind === 'promptHistory') return validPromptHistory(value.entries);
  if (kind === 'goals') return validGoal(value);
  if (kind === 'roles') return validRole(value);
  if (kind === 'guardrails') return validGuardrail(value);
  return false;
}

function migrateDocument(value) {
  if (!isObject(value)) return null;
  if (value.version === 1) return value;
  // Version zero was the un-migrated shape used by the first development build.
  // It intentionally keeps every unknown field while adding the current envelope version.
  if (value.version === 0) return { ...value, version: 1 };
  return null;
}

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

async function readJson(filePath, fallback, warnings, kind = 'generic') {
  if (!(await exists(filePath))) {
    await writeAtomic(filePath, fallback);
    return clone(fallback);
  }
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (isObject(parsed) && typeof parsed.version === 'number' && parsed.version > 1) {
      warnings.push(`Configuration warning: ${path.basename(filePath)} uses a newer schema version and was left untouched.`);
      return clone(fallback);
    }
    const migrated = migrateDocument(parsed);
    if (!migrated || !validDocument(normalizeDocument(migrated, kind), kind)) throw new Error('invalid schema');
    if (migrated !== parsed) {
      const rewritten = normalizeDocument(migrated, kind);
      await writeAtomic(filePath, rewritten);
      return rewritten;
    }
    const normalized = normalizeDocument(migrated, kind);
    if (normalized !== migrated) await writeAtomic(filePath, normalized);
    return normalized;
  } catch {
    const invalidPath = `${filePath}.invalid-${timestamp()}`;
    await fs.rename(filePath, invalidPath).catch(() => {});
    warnings.push(`Configuration recovery: ${path.basename(filePath)} was invalid and moved aside.`);
    await writeAtomic(filePath, fallback);
    return clone(fallback);
  }
}

async function mergeEnvelope(filePath, patch) {
  let existing = {};
  if (await exists(filePath)) {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (isObject(parsed) && typeof parsed.version === 'number' && parsed.version > 1) {
      throw new Error(`${path.basename(filePath)} uses a newer schema version and cannot be overwritten.`);
    }
    if (!isObject(parsed)) throw new Error(`${path.basename(filePath)} has an invalid document shape.`);
    existing = parsed;
  }
  return { ...existing, ...clone(patch), version: 1 };
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
    values.push(await readJson(path.join(directory, entry.name), fallback, warnings, path.basename(directory)));
  }
  return values;
}

async function loadSnapshot() {
  await ensureRoot();
  const warnings = [];
  const config = await readJson(path.join(root, resourceFiles.config), defaultConfig, warnings, 'config');
  const projectsEnvelope = await readJson(path.join(root, resourceFiles.projects), { version: 1, projects: [] }, warnings, 'projects');
  const profilesEnvelope = await readJson(path.join(root, resourceFiles.profiles), { version: 1, profiles: defaultProfiles }, warnings, 'profiles');
  const providerEnvelope = await readJson(path.join(root, resourceFiles.providerSettings), { version: 1, providers: defaultProviderSettings }, warnings, 'providerSettings');
  const providerInstructionsEnvelope = await readJson(path.join(root, resourceFiles.providerInstructions), { version: 1, instructions: {} }, warnings, 'providerInstructions');
  const promptHistoryEnvelope = await readJson(path.join(root, resourceFiles.promptHistory), { version: 1, entries: {} }, warnings, 'promptHistory');
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
    providerInstructions: isObject(providerInstructionsEnvelope.instructions) ? providerInstructionsEnvelope.instructions : {},
    promptHistory: isObject(promptHistoryEnvelope.entries) ? promptHistoryEnvelope.entries : {},
    storageRoot: root,
    warnings,
  };
}

function assertValidResource(key, value) {
  if (['goals', 'roles', 'guardrails'].includes(key)) {
    const validators = { goals: validGoal, roles: validRole, guardrails: validGuardrail };
    if (!Array.isArray(value) || !value.every(validators[key])) throw new Error(`Invalid ${key} resource.`);
    return;
  }
  const documents = {
    config: value,
    projects: { version: 1, projects: value },
    profiles: { version: 1, profiles: value },
    providerSettings: { version: 1, providers: value },
    providerInstructions: { version: 1, instructions: value },
    promptHistory: { version: 1, entries: value },
  };
  if (!Object.hasOwn(documents, key)) throw new Error(`Unsupported resource: ${key}`);
  const document = documents[key];
  const kind = key;
  if (!validDocument(document, kind)) throw new Error(`Invalid ${key} resource.`);
}

async function saveResource(key, value) {
  await ensureRoot();
  if (key === 'globalInstructions') {
    if (!isString(value)) throw new Error('Global instructions must be text.');
    const globalPath = path.join(root, 'instructions', 'global.md');
    const temporary = `${globalPath}.tmp-${process.pid}-${Date.now()}`;
    if (await exists(globalPath)) await fs.copyFile(globalPath, `${globalPath}.bak-${timestamp()}`);
    await fs.writeFile(temporary, String(value), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, globalPath);
    return;
  }
  if (key === 'config') {
    const config = isObject(value) ? normalizeDocument(clone(value), 'config') : value;
    assertValidResource(key, config);
    await writeAtomic(path.join(root, resourceFiles.config), { ...config, version: 1 });
    return;
  }
  if (key === 'projects') {
    assertValidResource(key, value);
    const filePath = path.join(root, resourceFiles.projects);
    await writeAtomic(filePath, await mergeEnvelope(filePath, { projects: clone(value) }));
    return;
  }
  if (key === 'profiles') {
    assertValidResource(key, value);
    const filePath = path.join(root, resourceFiles.profiles);
    await writeAtomic(filePath, await mergeEnvelope(filePath, { profiles: clone(value) }));
    return;
  }
  if (key === 'providerSettings') {
    assertValidResource(key, value);
    const filePath = path.join(root, resourceFiles.providerSettings);
    await writeAtomic(filePath, await mergeEnvelope(filePath, { providers: clone(value) }));
    return;
  }
  if (key === 'providerInstructions') {
    assertValidResource(key, value);
    const filePath = path.join(root, resourceFiles.providerInstructions);
    await writeAtomic(filePath, await mergeEnvelope(filePath, { instructions: clone(value) }));
    return;
  }
  if (key === 'promptHistory') {
    assertValidResource(key, value);
    const filePath = path.join(root, resourceFiles.promptHistory);
    await writeAtomic(filePath, await mergeEnvelope(filePath, { entries: clone(value) }));
    return;
  }
  if (!['goals', 'roles', 'guardrails'].includes(key)) throw new Error(`Unsupported resource: ${key}`);
  assertValidResource(key, value);
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
