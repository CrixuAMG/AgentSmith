import { describe, expect, it } from 'vitest';

import { isFileReadAllowed, matchesGuardrail } from '@/shared/guardrails';
import { DEFAULT_GUARDRAILS } from '@/shared/defaults';

describe('guardrail evaluation', () => {
  it('matches root and nested sensitive files', () => {
    const rule = DEFAULT_GUARDRAILS[0].rules[0];
    expect(matchesGuardrail(rule, '.env')).toBe(true);
    expect(matchesGuardrail(rule, 'config/.env.local')).toBe(true);
    expect(matchesGuardrail(rule, 'src/config.ts')).toBe(false);
  });

  it('denies a blocked file before prompt context is read', () => {
    const result = isFileReadAllowed('.env.production', DEFAULT_GUARDRAILS[0]);
    expect(result.allowed).toBe(false);
    expect(result.rule?.id).toBe('deny-env');
  });

  it('uses the same exact glob semantics for plain patterns and baseline files', () => {
    const rule = { ...DEFAULT_GUARDRAILS[0].rules[0], pattern: 'secret.txt' };
    expect(matchesGuardrail(rule, 'secret.txt')).toBe(true);
    expect(matchesGuardrail(rule, 'src/secret.txt')).toBe(false);
    expect(isFileReadAllowed('.env.local', null).allowed).toBe(false);
  });

  it('does not treat prompt-only denial as an application read block', () => {
    const profile = { ...DEFAULT_GUARDRAILS[0], rules: [{ ...DEFAULT_GUARDRAILS[0].rules[0], pattern: 'README.md', enforcement: 'prompt' as const }] };
    const result = isFileReadAllowed('README.md', profile);
    expect(result.allowed).toBe(true);
    expect(result.decision).toBe('warn');
  });
});
