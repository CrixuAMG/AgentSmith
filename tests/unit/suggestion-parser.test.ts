import { describe, expect, it } from 'vitest';

import { parseSuggestionIdeas } from '@/shared/suggestion-parser';

describe('suggestion output parsing', () => {
  it('keeps proposal sections together as one selectable idea', () => {
    const ideas = parseSuggestionIdeas([
      'I will inspect the repository first.',
      '',
      '**Ranked Proposals**',
      '',
      '### 1. Validated IPC Request Boundary',
      '',
      '- **Problem:** Renderer values are not validated at the boundary.',
      '- **Proposal:** Add runtime validation for IPC requests.',
      '- **Scope:** Keep provider command construction unchanged.',
      '',
      '### 2. Durable Execution Lifecycle',
      '',
      '- **Problem:** Process state is lost after a reload.',
      '- **Proposal:** Persist lifecycle metadata.',
    ].join('\n'));

    expect(ideas).toHaveLength(2);
    expect(ideas[0].title).toBe('Validated IPC Request Boundary');
    expect(ideas[0].text).toContain('- **Problem:** Renderer values');
    expect(ideas[0].text).toContain('- **Scope:** Keep provider');
    expect(ideas[1].title).toBe('Durable Execution Lifecycle');
  });

  it('supports a flat numbered list without turning continuation lines into ideas', () => {
    const ideas = parseSuggestionIdeas([
      '1. Add a command palette',
      'Users cannot find actions quickly.',
      '2. Add keyboard shortcuts',
      'Repeated mouse navigation slows the workflow.',
    ].join('\n'));

    expect(ideas).toHaveLength(2);
    expect(ideas[0].text).toContain('Users cannot find actions quickly.');
    expect(ideas[1].title).toBe('Add keyboard shortcuts');
  });

  it('uses one fallback idea for unstructured output', () => {
    const ideas = parseSuggestionIdeas('The provider returned one unstructured direction.');

    expect(ideas).toEqual([{ id: 'idea-1', title: 'Generated suggestion', detail: 'The provider returned one unstructured direction.', text: 'The provider returned one unstructured direction.' }]);
  });
});
