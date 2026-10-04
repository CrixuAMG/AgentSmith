import type { RepositoryCapabilities, RepositoryIssue, RepositoryLink } from './types';

/**
 * A project author enables agent repository automation from `AGENTS.md` with a
 * dedicated section, so the authorization lives next to the other instructions
 * instead of in a second AgentSmith-only settings file:
 *
 * ```markdown
 * ## Repository integration
 *
 * - issues: allow
 * - branches: allow
 * - pull-requests: allow
 * - merges: deny
 * ```
 *
 * Only `allow` grants a capability. Anything else, including an unknown value, is
 * a denial: a safety boundary is never opened by an ambiguous instruction.
 */
export const REPOSITORY_SECTION_TITLES = /^(repository\s+(integration|workflow|automation)|version\s+control|versiebeheer)$/i;
export const ISSUE_BRANCH_PREFIX = 'feature/issue-';

const HEADING = /^(#{1,6})\s+(.*)$/;
const DIRECTIVE = /^[-*+]\s*([A-Za-z][A-Za-z -]*?)\s*[:=]\s*([A-Za-z]+)\s*$/;

type GrantableCapability = 'issues' | 'branches' | 'pullRequests';
type CapabilityDirective = GrantableCapability | 'merges';

const CAPABILITY_NAMES: Record<string, GrantableCapability> = {
  issue: 'issues',
  issues: 'issues',
  branch: 'branches',
  branches: 'branches',
  'pull request': 'pullRequests',
  'pull requests': 'pullRequests',
  'pull-request': 'pullRequests',
  'pull-requests': 'pullRequests',
  pr: 'pullRequests',
  prs: 'pullRequests',
};

const ALLOWED_VALUES = new Set(['allow', 'allowed', 'allows', 'enable', 'enabled', 'true', 'yes']);

export const NO_REPOSITORY_CAPABILITIES: RepositoryCapabilities = Object.freeze({
  source: 'default',
  issues: false,
  branches: false,
  pullRequests: false,
  merges: false,
  mergeRequestDenied: false,
});

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseCapabilityName(value: string): CapabilityDirective | null {
  const normalized = normalizeName(value);
  if (normalized === 'merge' || normalized === 'merges' || normalized === 'merging') return 'merges';
  return CAPABILITY_NAMES[normalized] ?? null;
}

/**
 * Reads repository automation directives from an instruction document. Directives in
 * several sections combine, and an explicit denial always wins over an allowance.
 * Merging is denied unconditionally and is reported separately so the interface can
 * state that the request was refused instead of silently ignoring it.
 */
export function parseRepositoryCapabilities(markdown: string | null | undefined): RepositoryCapabilities {
  if (typeof markdown !== 'string' || !markdown.trim()) return { ...NO_REPOSITORY_CAPABILITIES };
  const granted: Record<GrantableCapability, boolean> = { issues: false, branches: false, pullRequests: false };
  const denied = new Set<CapabilityDirective>();
  let found = false;
  let mergeRequestDenied = false;
  let inSection = false;
  let sectionLevel = 0;

  for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      if (inSection && level <= sectionLevel) inSection = false;
      const title = heading[2].trim().replace(/:$/, '').trim();
      if (REPOSITORY_SECTION_TITLES.test(title)) {
        inSection = true;
        sectionLevel = level;
      }
      continue;
    }
    if (!inSection) continue;
    const directive = line.trim().match(DIRECTIVE);
    if (!directive) continue;
    const capability = parseCapabilityName(directive[1]);
    if (!capability) continue;
    found = true;
    const allowed = ALLOWED_VALUES.has(directive[2].trim().toLowerCase());
    if (!allowed) {
      denied.add(capability);
      continue;
    }
    if (capability === 'merges') {
      mergeRequestDenied = true;
      continue;
    }
    if (!denied.has(capability)) granted[capability] = true;
  }

  return {
    source: found ? 'agents-md' : 'default',
    issues: granted.issues,
    branches: granted.branches,
    pullRequests: granted.pullRequests,
    merges: false,
    mergeRequestDenied,
  };
}

export function hasRepositoryWorkflow(capabilities: RepositoryCapabilities | null | undefined): boolean {
  return Boolean(capabilities && (capabilities.issues || capabilities.branches || capabilities.pullRequests));
}

export function slugifyIssueTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** Branch naming convention handed to the agent so issue work lands on a predictable branch. */
export function issueBranchName(issue: Pick<RepositoryIssue, 'number' | 'title'>): string {
  const slug = slugifyIssueTitle(issue.title);
  return `${ISSUE_BRANCH_PREFIX}${issue.number}${slug ? `-${slug}` : ''}`;
}

/**
 * Prompt text that restates the authorized repository operations. The merge
 * prohibition is always present when any repository operation is authorized, so an
 * allowed issue or pull-request workflow never implies merge permission.
 */
export function composeRepositoryContract(
  capabilities: RepositoryCapabilities | null | undefined,
  link: RepositoryLink | null | undefined,
): string {
  if (!link || !hasRepositoryWorkflow(capabilities)) return '';
  const lines = [`Repository: ${link.owner}/${link.name} on ${link.host} (${link.providerId}).`];
  if (capabilities?.issues) lines.push('- You MAY create and edit issues in this repository when the task requires it.');
  if (capabilities?.branches) lines.push(`- You MAY create a branch for the issue you work on, named ${ISSUE_BRANCH_PREFIX}<number>-<short-slug>.`);
  if (capabilities?.pullRequests) lines.push('- You MAY open a pull request for a branch you created.');
  lines.push('- You MUST NOT merge a branch, pull request, or any other change. Merging is not available to you and stays with a human reviewer.');
  return lines.join('\n');
}