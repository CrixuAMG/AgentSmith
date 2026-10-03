export interface ParsedSuggestionIdea {
  id: string;
  title: string;
  detail: string;
  text: string;
}

interface IdeaStart {
  raw: string;
  title: string;
}

const markdownHeadingPattern = /^#{2,6}\s+(.+?)\s*$/;
const numberedPattern = /^(?:\*\*)?(?:proposal|idea\s*)?(\d+)[.)-:]\s*(.+?)(?:\*\*)?$/i;
const numberedLinePattern = /^(?:\*\*)?\d+[.)]\s+(.+?)(?:\*\*)?$/;
const bulletLinePattern = /^([-*]|\u2022)\s+(.+)$/;
const sectionTitles = /^(?:ranked proposals?|proposals?|ideas?|todos?|summary|recommendation)$/i;

function cleanTitle(value: string) {
  return value
    .replace(/^\*+|\*+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function headingStart(line: string): IdeaStart | null {
  const heading = line.trim().match(markdownHeadingPattern);
  if (!heading) return null;
  const value = cleanTitle(heading[1]);
  const numbered = value.match(numberedPattern);
  if (numbered) return { raw: line.trim(), title: cleanTitle(numbered[2]) };
  if (!sectionTitles.test(value) && /^\d+\s+/.test(value)) return { raw: line.trim(), title: value };
  return null;
}

function numberedStart(line: string): IdeaStart | null {
  const match = line.trim().match(numberedLinePattern);
  return match ? { raw: line.trim(), title: cleanTitle(match[1]) } : null;
}

function bulletStart(line: string): IdeaStart | null {
  if (/^\s+/.test(line)) return null;
  const match = line.match(bulletLinePattern);
  if (!match || /^\*\*(?:problem|proposal|scope|acceptance criteria|risks?|effort)\b/i.test(match[2])) return null;
  return { raw: line.trim(), title: cleanTitle(match[2]) };
}

function finishIdea(current: { start: IdeaStart; body: string[] }, index: number): ParsedSuggestionIdea {
  const body = current.body.join('\n').trim();
  return {
    id: `idea-${index + 1}`,
    title: current.start.title,
    detail: body,
    text: [current.start.raw, body].filter(Boolean).join('\n\n'),
  };
}

/**
 * Extracts proposal-level ideas while keeping each proposal's labeled sections
 * together. Provider tool logs and preamble text before the first proposal are
 * intentionally ignored once a structured proposal format is detected.
 */
export function parseSuggestionIdeas(text: string): ParsedSuggestionIdea[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const hasHeadings = lines.some((line) => headingStart(line));
  const hasNumberedItems = lines.some((line) => numberedStart(line));
  const mode = hasHeadings ? 'heading' : hasNumberedItems ? 'numbered' : 'bullet';
  const ideas: ParsedSuggestionIdea[] = [];
  let current: { start: IdeaStart; body: string[] } | null = null;

  for (const line of lines) {
    const start = mode === 'heading'
      ? headingStart(line)
      : mode === 'numbered'
        ? numberedStart(line)
        : bulletStart(line);
    if (start) {
      if (current) ideas.push(finishIdea(current, ideas.length));
      current = { start, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }

  if (current) ideas.push(finishIdea(current, ideas.length));
  if (ideas.length) return ideas;

  const fallback = text.trim();
  return fallback
    ? [{ id: 'idea-1', title: 'Generated suggestion', detail: fallback, text: fallback }]
    : [];
}
