import type {
  AgentProfile,
  AppConfig,
  Goal,
  GuardrailProfile,
  ProviderSetting,
  Project,
  Role,
} from './types';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

export function isProject(value: unknown): value is Project {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isString(value.path)
    && isString(value.lastOpenedAt);
}

export function isAppConfig(value: unknown): value is AppConfig {
  return isRecord(value)
    && value.version === 1
    && isString(value.locale)
    && (value.theme === 'dark' || value.theme === 'light')
    && isBoolean(value.showHiddenFiles)
    && (value.lastProjectId === null || isString(value.lastProjectId))
    && (value.activeProfileId === null || isString(value.activeProfileId));
}

export function isGoal(value: unknown): value is Goal {
  return isRecord(value)
    && value.version === 1
    && isString(value.id)
    && isString(value.name)
    && isString(value.description)
    && Array.isArray(value.instructions)
    && value.instructions.every(isString)
    && isBoolean(value.enabled)
    && typeof value.order === 'number';
}

export function isRole(value: unknown): value is Role {
  return isRecord(value)
    && value.version === 1
    && isString(value.id)
    && isString(value.name)
    && isString(value.description)
    && Array.isArray(value.instructions)
    && value.instructions.every(isString)
    && Array.isArray(value.tags)
    && value.tags.every(isString)
    && isBoolean(value.enabled);
}

export function isGuardrailProfile(value: unknown): value is GuardrailProfile {
  return isRecord(value)
    && value.version === 1
    && isString(value.id)
    && isString(value.name)
    && isString(value.description)
    && Array.isArray(value.rules)
    && value.rules.every((rule) => isRecord(rule)
      && isString(rule.id)
      && isString(rule.type)
      && isString(rule.pattern)
      && ['deny', 'warn', 'confirm'].includes(String(rule.action))
      && isBoolean(rule.enabled)
      && ['prompt', 'application', 'provider', 'advisory'].includes(String(rule.enforcement)));
}

export function isAgentProfile(value: unknown): value is AgentProfile {
  return isRecord(value)
    && value.version === 1
    && isString(value.id)
    && isString(value.name)
    && isString(value.providerId)
    && (value.modelId === null || isString(value.modelId))
    && isRecord(value.variant)
    && (value.roleId === null || isString(value.roleId))
    && Array.isArray(value.goalIds)
    && value.goalIds.every(isString)
    && (value.guardrailProfileId === null || isString(value.guardrailProfileId));
}

export function isProviderSetting(value: unknown): value is ProviderSetting {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && (value.executable === null || isString(value.executable))
    && isBoolean(value.enabled);
}

export function isProviderInstructions(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isString);
}

export function validateCollection<T>(value: unknown, predicate: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected a collection.');
  }
  if (!value.every(predicate)) {
    throw new Error('One or more collection items are invalid.');
  }
  return value;
}

export function validateResource(key: string, value: unknown): unknown {
  switch (key) {
    case 'config':
      if (!isAppConfig(value)) throw new Error('Invalid application configuration.');
      return value;
    case 'projects':
      return validateCollection(value, isProject);
    case 'goals':
      return validateCollection(value, isGoal);
    case 'roles':
      return validateCollection(value, isRole);
    case 'guardrails':
      return validateCollection(value, isGuardrailProfile);
    case 'profiles':
      return validateCollection(value, isAgentProfile);
    case 'providerSettings':
      return validateCollection(value, isProviderSetting);
    case 'providerInstructions':
      if (!isProviderInstructions(value)) throw new Error('Invalid provider instructions.');
      return value;
    case 'globalInstructions':
      if (!isString(value)) throw new Error('Global instructions must be text.');
      return value;
    default:
      throw new Error(`Unknown resource: ${key}`);
  }
}
