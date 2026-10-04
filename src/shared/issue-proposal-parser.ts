export interface ParsedIssueProposal {
  id: string;
  title: string;
  body: string;
  labels: string[];
}

export interface IssueProposalParseResult {
  proposals: ParsedIssueProposal[];
  error: string | null;
}

export const MAX_ISSUE_PROPOSALS = 20;
const MAX_TITLE_CHARS = 256;
const MAX_BODY_CHARS = 65536;
const MAX_LABELS = 20;

function balancedJson(text: string, start: number): string | null {
  const opening = text[start];
  const closing = opening === '[' ? ']' : opening === '{' ? '}' : null;
  if (!closing) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function candidates(text: string): string[] {
  const result = [text.trim()];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]?.trim()) result.push(match[1].trim());
  }
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '[' && text[index] !== '{') continue;
    const candidate = balancedJson(text, index);
    if (candidate) result.push(candidate);
  }
  return [...new Set(result)];
}

function asEntries(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const wrapped = (value as { issues?: unknown }).issues;
    if (Array.isArray(wrapped)) return wrapped;
    if (typeof (value as { title?: unknown }).title === 'string') return [value];
  }
  return null;
}

function normalizeProposal(value: unknown, index: number): ParsedIssueProposal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as { title?: unknown; body?: unknown; labels?: unknown };
  const title = typeof source.title === 'string' ? source.title.trim() : '';
  if (!title || title.length > MAX_TITLE_CHARS) return null;
  const body = typeof source.body === 'string' ? source.body.trim() : '';
  if (body.length > MAX_BODY_CHARS) return null;
  const labels = Array.isArray(source.labels)
    ? source.labels
      .filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
      .map((label) => label.trim())
      .slice(0, MAX_LABELS)
    : [];
  return { id: `issue-proposal-${index + 1}`, title, body, labels };
}

/**
 * Accepts only JSON-shaped provider output. Markdown or prose is never silently turned
 * into a ticket, which keeps the later GitHub write behind an explicit review step.
 */
export function parseIssueProposals(text: string): IssueProposalParseResult {
  if (typeof text !== 'string' || !text.trim()) {
    return { proposals: [], error: 'The provider returned no issue proposals.' };
  }
  let sawJson = false;
  for (const candidate of candidates(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const entries = asEntries(parsed);
    if (!entries) continue;
    sawJson = true;
    const proposals: ParsedIssueProposal[] = [];
    const titles = new Set<string>();
    for (const entry of entries) {
      if (proposals.length >= MAX_ISSUE_PROPOSALS) break;
      const proposal = normalizeProposal(entry, proposals.length);
      if (!proposal) continue;
      const key = proposal.title.toLowerCase();
      if (titles.has(key)) continue;
      titles.add(key);
      proposals.push(proposal);
    }
    if (proposals.length) return { proposals, error: null };
    return { proposals: [], error: 'The provider returned JSON, but no valid issue proposals were found.' };
  }
  return {
    proposals: [],
    error: sawJson
      ? 'The provider returned JSON, but no valid issue proposals were found.'
      : 'The provider did not return the required JSON issue format.',
  };
}
