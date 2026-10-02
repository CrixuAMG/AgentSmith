import type { GuardrailProfile, GuardrailRule } from './types';

const globToRegExp = (pattern: string): RegExp => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
};

export function matchesGuardrail(rule: GuardrailRule, value: string): boolean {
  if (!rule.enabled || !rule.pattern.trim()) return false;
  if (rule.pattern.includes('*') || rule.pattern.includes('?')) {
    return globToRegExp(rule.pattern).test(value.replaceAll('\\', '/'));
  }
  return value.toLowerCase().includes(rule.pattern.toLowerCase());
}

export function isFileReadAllowed(
  relativePath: string,
  profile: GuardrailProfile | null,
): { allowed: boolean; reason: string | null; rule: GuardrailRule | null } {
  if (!profile) return { allowed: true, reason: null, rule: null };
  const rule = profile.rules.find((candidate) =>
    candidate.type === 'file_access' && matchesGuardrail(candidate, relativePath));
  if (!rule) return { allowed: true, reason: null, rule: null };
  if (rule.action === 'deny') {
    return { allowed: false, reason: rule.description ?? `Blocked by ${rule.id}.`, rule };
  }
  return { allowed: true, reason: rule.description ?? null, rule };
}

export function promptGuardrailText(profile: GuardrailProfile | null): string {
  if (!profile) return '';
  const active = profile.rules.filter((rule) => rule.enabled);
  return active.map((rule) => {
    const action = rule.action === 'deny' ? 'MUST NOT' : rule.action === 'confirm' ? 'MUST ASK BEFORE' : 'SHOULD WARN BEFORE';
    const enforcement = rule.enforcement === 'prompt'
      ? 'prompt instruction only'
      : `${rule.enforcement} enforcement`;
    return `- ${action}: ${rule.pattern} (${enforcement}).`;
  }).join('\n');
}
