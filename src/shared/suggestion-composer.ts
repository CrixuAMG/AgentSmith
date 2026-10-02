import type { FeatureSuggestion, Goal, Project, Role, SuggestionDiscipline } from './types';

export interface SuggestionAngle {
  id: string;
  label: string;
  directive: string;
}

export interface SuggestionInput {
  project: Project | null;
  role: Role | null;
  goals: Goal[];
  step: number;
}

/**
 * Each round of "Another suggestion" advances one angle so repeated clicks
 * explore a different facet instead of re-rolling the same wording.
 */
export const SUGGESTION_ANGLES: SuggestionAngle[] = [
  { id: 'capability', label: 'New capability', directive: 'Look for a capability the project does not have yet but is clearly missing.' },
  { id: 'integration', label: 'Integration surface', directive: 'Look for an integration with another tool, provider, or platform that would remove a manual step.' },
  { id: 'reliability', label: 'Reliability', directive: 'Look for a failure mode that is currently silent, slow to detect, or expensive to recover from.' },
  { id: 'performance', label: 'Performance', directive: 'Look for a measurable performance or resource problem in the current implementation.' },
  { id: 'developer-experience', label: 'Developer experience', directive: 'Look for friction in the inner loop: build, test, debug, or local setup.' },
  { id: 'observability', label: 'Observability', directive: 'Look for state that an operator or user cannot currently see, explain, or act on.' },
  { id: 'security', label: 'Security boundary', directive: 'Look for a trust boundary, secret-handling path, or privilege that is implicit rather than enforced.' },
  { id: 'accessibility', label: 'Accessibility', directive: 'Look for an interaction that is harder to use with a keyboard, a screen reader, or reduced motion.' },
  { id: 'verification', label: 'Verification', directive: 'Look for behaviour that could change without any test failing.' },
  { id: 'simplification', label: 'Simplification', directive: 'Look for code, configuration, or interface that could be removed without losing capability.' },
  { id: 'data', label: 'Data and persistence', directive: 'Look for locally stored data that is unversioned, unvalidated, or hard to migrate.' },
  { id: 'workflow', label: 'Workflow', directive: 'Look for a repeated sequence of manual steps that could become a single action.' },
];

const DISCIPLINE_RULES: Array<{ discipline: SuggestionDiscipline; pattern: RegExp }> = [
  { discipline: 'security', pattern: /secur|privacy|trust|threat/i },
  { discipline: 'frontend', pattern: /front|\bui\b|\bux\b|vue|accessib|visual|theme|interaction/i },
  { discipline: 'quality', pattern: /quality|\bqa\b|test|verif|regression/i },
  { discipline: 'backend', pattern: /back|\bapi\b|php|symfony|server|platform|services?|database/i },
  { discipline: 'architecture', pattern: /architect|design|structure|boundar/i },
];

const DISCIPLINE_LABELS: Record<SuggestionDiscipline, string> = {
  backend: 'backend engineering',
  frontend: 'interface and interaction design',
  quality: 'quality and verification',
  architecture: 'architecture and module boundaries',
  security: 'security and trust boundaries',
  general: 'general software engineering',
};

const DISCIPLINE_SEEDS: Record<SuggestionDiscipline, string[]> = {
  backend: [
    'a new AI agent provider adapter with installation detection and capability reporting',
    'structured validation of untrusted request data at the service boundary',
    'a retryable and cancellable runner for long-running local operations',
    'an execution queue that decouples request construction from process launching',
    'an idempotent write path with atomic replace and backup semantics',
  ],
  frontend: [
    'a new theme built on tokenized colour, spacing, and typography scales',
    'page and panel transitions that respect reduced-motion preferences',
    'a keyboard-driven command palette over the current workspace actions',
    'a saved view layout so panel sizes and visibility survive a restart',
    'one consistent pattern for inline validation and error recovery',
  ],
  quality: [
    'a deterministic test matrix for the highest-risk pure domain functions',
    'a failure-injection harness that exercises error branches without mocking the subject',
    'a behavioural regression fixture that runs against the production build output',
    'property-based checks for parsers, normalizers, and path handling',
    'an explicit test for each documented limitation rather than an implicit one',
  ],
  architecture: [
    'a boundary that moves provider-specific knowledge out of the presentation layer',
    'module ownership enforced by explicit import rules rather than convention',
    'a versioned migration path for every locally stored document',
    'a host-independent interface that keeps the domain free of runtime dependencies',
    'a capability switch that allows staged rollout without a flag day',
  ],
  security: [
    'a least-privilege split between read and write capabilities',
    'a secret-scanning check that runs before any content leaves the machine',
    'an audit trail of sensitive operations that records intent without recording content',
    'an explicit trust-boundary check on every externally supplied path or argument',
    'a default that rejects unknown configuration shapes instead of merging them',
  ],
  general: [
    'a focused feature that removes one repeated manual step',
    'a signal that makes a currently silent failure visible',
    'a usability improvement on the screen that is used most often',
    'a fix for the slowest measured interaction in the primary workflow',
    'a first-class way to export or back up locally stored state',
  ],
};

const OUTLINE = [
  'For each proposal return:',
  '- Problem: the concrete pain, and who has it.',
  '- Proposal: what to add, in one paragraph.',
  '- Scope: the modules and files it touches, and what it deliberately leaves alone.',
  '- Acceptance criteria: observable outcomes that can be verified.',
  '- Risks, and the plausible alternative you rejected.',
  '- Effort: small, medium, or large, with the reason.',
];

export function disciplineForRole(role: Role | null): SuggestionDiscipline {
  if (!role) return 'general';
  const haystack = [role.id, role.name, ...role.tags].join(' ');
  return DISCIPLINE_RULES.find((rule) => rule.pattern.test(haystack))?.discipline ?? 'general';
}

/**
 * Deterministic feature-proposal prompt. The result is intended to be used as the
 * composed prompt's task, so guardrails and context selection still apply.
 */
export function composeSuggestionPrompt(input: SuggestionInput): FeatureSuggestion {
  if (!input.project) throw new Error('A project is required before composing a suggestion.');
  const step = Number.isFinite(input.step) ? Math.max(0, Math.floor(input.step)) : 0;
  const angle = SUGGESTION_ANGLES[step % SUGGESTION_ANGLES.length];
  const round = Math.floor(step / SUGGESTION_ANGLES.length) + 1;
  const discipline = disciplineForRole(input.role);
  const goals = input.goals.filter((goal) => goal.enabled);
  const perspective = input.role
    ? `Perspective: ${input.role.name} (${DISCIPLINE_LABELS[discipline]}).`
    : `Perspective: ${DISCIPLINE_LABELS[discipline]}; no role is selected, so state the assumptions a role would have made.`;
  const priorities = goals.length
    ? `Priorities in scope: ${goals.map((goal) => goal.name).join(', ')}.`
    : 'No development goals are selected, so make the tradeoffs explicit instead.';

  const text = [
    `# ${angle.label}: ${input.project.name}`,
    '',
    angle.directive,
    '',
    'Propose new features for this project through that lens. Ground every proposal in what the repository already contains; do not assume modules, services, or tooling that are not present.',
    '',
    perspective,
    priorities,
    '',
    'Consider these directions if they fit the codebase:',
    ...DISCIPLINE_SEEDS[discipline].map((seed) => `- ${seed}`),
    '',
    ...OUTLINE,
    '',
    'Rank the proposals, recommend one, and name the first step you would take. Do not write code yet.',
  ].join('\n');

  return { angleId: angle.id, angleLabel: angle.label, discipline, round, title: `${angle.label}: ${input.project.name}`, text };
}