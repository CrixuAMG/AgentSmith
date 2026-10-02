import { describe, expect, it } from 'vitest';

import { DEFAULT_GOALS, DEFAULT_ROLES } from '@/shared/defaults';
import { composeSuggestionPrompt, disciplineForRole, SUGGESTION_ANGLES } from '@/shared/suggestion-composer';
import type { Goal } from '@/shared/types';

const project = { id: 'project', name: 'AgentSmith', path: '/private/tmp/AgentSmith', lastOpenedAt: '2026-10-02T00:00:00.000Z' };

const role = (id: string) => {
  const found = DEFAULT_ROLES.find((item) => item.id === id);
  if (!found) throw new Error(`missing role ${id}`);
  return found;
};

const goal = (id: string): Goal => {
  const found = DEFAULT_GOALS.find((item) => item.id === id);
  if (!found) throw new Error(`missing goal ${id}`);
  return found;
};

describe('suggestion composition', () => {
  it('derives a discipline from the selected role', () => {
    expect(disciplineForRole(role('senior-backend'))).toBe('backend');
    expect(disciplineForRole(role('senior-frontend'))).toBe('frontend');
    expect(disciplineForRole(role('senior-symfony'))).toBe('backend');
    expect(disciplineForRole(role('software-architect'))).toBe('architecture');
    expect(disciplineForRole(role('security-reviewer'))).toBe('security');
    expect(disciplineForRole(role('test-engineer'))).toBe('quality');
    expect(disciplineForRole(null)).toBe('general');
  });

  it('grounds the prompt in role-specific directions without leaking the project path', () => {
    const backend = composeSuggestionPrompt({ project, role: role('senior-backend'), goals: [goal('maintainability')], step: 0 });
    expect(backend.discipline).toBe('backend');
    expect(backend.text).toContain('Perspective: Senior Backend Engineer (backend engineering).');
    expect(backend.text).toContain('Priorities in scope: Maintainability.');
    expect(backend.text).toContain('a new AI agent provider adapter');
    expect(backend.text).not.toContain(project.path);

    const frontend = composeSuggestionPrompt({ project, role: role('senior-frontend'), goals: [], step: 0 });
    expect(frontend.text).toContain('a new theme built on tokenized colour');
    expect(frontend.text).toContain('page and panel transitions');
    expect(frontend.text).toContain('No development goals are selected');
  });

  it('is deterministic and produces a distinct prompt for every consecutive suggestion', () => {
    const input = { project, role: role('senior-backend'), goals: [] };
    expect(composeSuggestionPrompt({ ...input, step: 3 })).toEqual(composeSuggestionPrompt({ ...input, step: 3 }));

    const texts = Array.from({ length: SUGGESTION_ANGLES.length }, (_unused, step) => composeSuggestionPrompt({ ...input, step }).text);
    expect(new Set(texts).size).toBe(SUGGESTION_ANGLES.length);
    expect(composeSuggestionPrompt({ ...input, step: 0 }).round).toBe(1);
    expect(composeSuggestionPrompt({ ...input, step: SUGGESTION_ANGLES.length }).round).toBe(2);
    expect(composeSuggestionPrompt({ ...input, step: SUGGESTION_ANGLES.length }).angleId).toBe(SUGGESTION_ANGLES[0].id);
  });

  it('requires a project and rejects a non-numeric step', () => {
    expect(() => composeSuggestionPrompt({ project: null, role: null, goals: [], step: 0 })).toThrow('project is required');
    const suggestion = composeSuggestionPrompt({ project, role: null, goals: [], step: Number.NaN });
    expect(suggestion.round).toBe(1);
    expect(suggestion.discipline).toBe('general');
  });
});