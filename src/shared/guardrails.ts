import type { ContextDecision, EnforcementLayer, GuardrailProfile, GuardrailRule } from './types';

const expandBraces = (pattern: string): string[] => {
  const match = pattern.match(/^(.*)\{([^{}]+)\}(.*)$/);
  if (!match) return [pattern];
  return match[2].split(',').flatMap((part) => expandBraces(`${match[1]}${part}${match[3]}`));
};

const globToRegExp = (pattern: string): RegExp => {
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
};

const BASELINE_RULES: GuardrailRule[] = [
  { id: 'baseline-env', type: 'file_access', pattern: '**/.env*', action: 'deny', enabled: true, enforcement: 'application', description: 'Environment files are never shown by the application.' },
  { id: 'baseline-private-key', type: 'file_access', pattern: '**/*.{pem,key,p12}', action: 'deny', enabled: true, enforcement: 'application', description: 'Private key files are never shown by the application.' },
];

export function matchesGuardrail(rule: GuardrailRule, value: string): boolean {
  if (!rule.enabled || !rule.pattern.trim()) return false;
  const normalizedValue = value.replaceAll('\\', '/');
  return expandBraces(rule.pattern).some((pattern) =>
    globToRegExp(pattern).test(normalizedValue)
    || (pattern.startsWith('**/') && globToRegExp(pattern.slice(3)).test(normalizedValue)));
}

function decisionFor(rule: GuardrailRule | null) {
  if (!rule) return 'allow' as const;
  if (rule.action === 'deny' && (!rule.enforcement || rule.enforcement === 'application')) return 'deny' as const;
  if (rule.action === 'confirm') return 'confirm' as const;
  if (rule.action === 'warn' || rule.action === 'deny') return 'warn' as const;
  return 'allow' as const;
}

export function isFileReadAllowed(
  relativePath: string,
  profile: GuardrailProfile | null,
): { allowed: boolean; reason: string | null; rule: GuardrailRule | null; decision: ContextDecision; enforcement: EnforcementLayer | 'baseline' | null } {
  const rule = profile?.rules.find((candidate) =>
    candidate.type === 'file_access' && matchesGuardrail(candidate, relativePath)) ?? null;
  const baseline = BASELINE_RULES.find((candidate) => matchesGuardrail(candidate, relativePath)) ?? null;
  const effectiveRule = rule && decisionFor(rule) === 'deny' ? rule : baseline ?? rule;
  const decision = decisionFor(effectiveRule);
  return {
    allowed: decision !== 'deny',
    reason: effectiveRule?.description ?? (decision === 'deny' ? `Blocked by ${effectiveRule?.id}.` : null),
    rule: effectiveRule,
    decision,
    enforcement: effectiveRule?.id.startsWith('baseline-') ? 'baseline' : effectiveRule?.enforcement ?? null,
  };
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
