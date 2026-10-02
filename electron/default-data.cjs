const defaultConfig = {
  version: 1,
  locale: 'en',
  theme: 'dark',
  showHiddenFiles: false,
  lastProjectId: null,
  activeProfileId: 'default-agent',
};

const defaultGoals = [
  {
    version: 1,
    id: 'maintainability',
    name: 'Maintainability',
    description: 'Keep changes readable, focused, and aligned with the existing architecture.',
    instructions: ['Follow existing project conventions before introducing new patterns.', 'Prefer small, focused changes over speculative abstractions.', 'Preserve architectural boundaries and explain meaningful tradeoffs.'],
    enabled: true,
    order: 1,
  },
  {
    version: 1,
    id: 'test-coverage',
    name: 'Test coverage',
    description: 'Treat regression protection and executable specifications as part of the change.',
    instructions: ['Add or update focused automated tests for behavior that changes.', 'Cover important edge cases and failure modes, not only the happy path.'],
    enabled: true,
    order: 2,
  },
  {
    version: 1,
    id: 'security',
    name: 'Security',
    description: 'Consider trust boundaries, sensitive data, and safe failure behavior.',
    instructions: ['Do not expose secrets, credentials, or private project data in output.', 'Validate untrusted input and fail closed when a safety boundary is unclear.'],
    enabled: true,
    order: 3,
  },
  {
    version: 1,
    id: 'minimal-change',
    name: 'Minimal change',
    description: 'Reduce risk by changing only what the task requires.',
    instructions: ['Avoid unrelated refactors, dependency changes, and generated churn.', 'State assumptions when the requested change is underspecified.'],
    enabled: false,
    order: 4,
  },
];

const defaultRoles = [
  {
    version: 1,
    id: 'senior-backend',
    name: 'Senior Backend Engineer',
    description: 'Experienced backend engineer focused on maintainable systems and failure modes.',
    instructions: ['Understand the existing architecture and data flow before changing code.', 'Consider validation, observability, concurrency, and operational failure modes.', 'Prefer established project conventions over introducing a new framework pattern.'],
    tags: ['backend', 'architecture'],
    enabled: true,
  },
  {
    version: 1,
    id: 'senior-frontend',
    name: 'Senior Frontend Engineer',
    description: 'Frontend engineer balancing interaction quality, accessibility, and maintainability.',
    instructions: ['Preserve the application visual language and component boundaries.', 'Consider keyboard access, responsive behavior, loading states, and error recovery.', 'Keep state ownership clear and avoid unnecessary reactive complexity.'],
    tags: ['frontend', 'accessibility'],
    enabled: true,
  },
  {
    version: 1,
    id: 'qa-engineer',
    name: 'QA Engineer',
    description: 'Quality engineer focused on observable behavior, regressions, and edge cases.',
    instructions: ['Translate requirements into concrete acceptance scenarios.', 'Look for boundary conditions, invalid input, and recovery paths.', 'Recommend the smallest reliable automated test set for the change.'],
    tags: ['quality', 'testing'],
    enabled: true,
  },
  {
    version: 1,
    id: 'security-reviewer',
    name: 'Security Reviewer',
    description: 'Security-minded reviewer focused on trust boundaries and least privilege.',
    instructions: ['Identify untrusted inputs, privilege boundaries, and data exposure risks.', 'Distinguish advisory instructions from controls the application can actually enforce.', 'Prefer explicit denial and actionable errors over silent fallback behavior.'],
    tags: ['security', 'review'],
    enabled: true,
  },
  {
    version: 1,
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'Pragmatic reviewer prioritizing defects, regressions, and missing tests.',
    instructions: ['Review behavior and risk before style or refactoring opportunities.', 'Call out concrete findings with file and line context when possible.', 'Check whether tests cover the changed behavior and failure cases.'],
    tags: ['review', 'quality'],
    enabled: true,
  },
];

const defaultGuardrails = [
  {
    version: 1,
    id: 'default-security',
    name: 'Default security',
    description: 'Safe defaults for local project inspection and provider execution.',
    rules: [
      { id: 'deny-env', type: 'file_access', pattern: '**/.env*', action: 'deny', enabled: true, enforcement: 'application', description: 'Block environment files and their variants from the viewer and prompt context.' },
      { id: 'deny-private-keys', type: 'file_access', pattern: '**/*.{pem,key,p12}', action: 'deny', enabled: true, enforcement: 'application', description: 'Block common private key files.' },
      { id: 'no-destructive-git', type: 'command', pattern: 'git reset --hard', action: 'deny', enabled: true, enforcement: 'prompt', description: 'Tell the provider not to run destructive Git operations.' },
      { id: 'project-root', type: 'filesystem_write', pattern: 'outside project root', action: 'deny', enabled: true, enforcement: 'application', description: 'AgentSmith project writes stay inside the selected project root.' },
      { id: 'confirm-dependencies', type: 'command', pattern: 'install dependencies', action: 'confirm', enabled: true, enforcement: 'prompt', description: 'Require explicit user confirmation before dependency installation.' },
    ],
  },
  {
    version: 1,
    id: 'strict',
    name: 'Strict review',
    description: 'A prompt-focused profile for sensitive review work.',
    rules: [
      { id: 'strict-no-network', type: 'network', pattern: 'external network requests', action: 'deny', enabled: true, enforcement: 'advisory', description: 'The provider must not make external requests; this is advisory unless sandboxed.' },
      { id: 'strict-no-config', type: 'filesystem_write', pattern: 'configuration files', action: 'confirm', enabled: true, enforcement: 'prompt', description: 'Ask before changing configuration files.' },
      { id: 'strict-no-delete', type: 'filesystem_write', pattern: 'delete files', action: 'deny', enabled: true, enforcement: 'prompt', description: 'Do not delete files without explicit direction.' },
    ],
  },
];

const defaultProviderSettings = [
  { id: 'opencode', name: 'OpenCode', executable: 'opencode', enabled: true },
  { id: 'codex', name: 'Codex', executable: 'codex', enabled: true },
];

const defaultProfiles = [{
  version: 1,
  id: 'default-agent',
  name: 'Default workspace agent',
  providerId: 'opencode',
  modelId: null,
  variant: {},
  roleId: 'senior-backend',
  goalIds: ['maintainability', 'test-coverage', 'security'],
  guardrailProfileId: 'default-security',
}];

module.exports = { defaultConfig, defaultGoals, defaultRoles, defaultGuardrails, defaultProviderSettings, defaultProfiles };
