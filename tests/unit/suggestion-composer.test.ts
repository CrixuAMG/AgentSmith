import { describe, expect, it } from 'vitest';
import { composeSuggestionPrompt, disciplineForRole } from '@/shared/suggestion-composer';
import { DEFAULT_ROLES } from '@/shared/defaults';

describe('suggestion-composer role sensitivity', () => {
  it('maps ui/ux designer to frontend discipline', () => {
    const role = DEFAULT_ROLES.find((r) => r.id === 'ui-ux-designer');
    expect(disciplineForRole(role ?? null)).toBe('frontend');
  });

  it('includes role instructions in suggestion prompt', () => {
    const role = DEFAULT_ROLES.find((r) => r.id === 'ui-ux-designer');
    expect(role).toBeDefined();
    if (!role) return;
    const suggestion = composeSuggestionPrompt({
      project: { id: 'p1', name: 'TestApp', path: '/tmp/testapp', lastOpenedAt: '' },
      role,
      goals: [],
      step: 0,
    });
    expect(suggestion.text).toContain('Role-specific guidance');
    expect(suggestion.text).toContain('keyboard navigation');
    expect(suggestion.text).toContain('frontend files');
  });
});
