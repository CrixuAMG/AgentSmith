function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function inlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
}

/** A deliberately small, escaped renderer for provider suggestion markdown. */
export function renderMarkdown(value: string) {
  const output: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let paragraphOpen = false;

  const closeParagraph = () => {
    if (paragraphOpen) {
      output.push('</p>');
      paragraphOpen = false;
    }
  };
  const closeList = () => {
    if (listType) {
      output.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const rawLine of value.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      closeParagraph();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = Math.min(heading[1].length, 6);
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      closeParagraph();
      const nextType = unordered ? 'ul' : 'ol';
      if (listType !== nextType) {
        closeList();
        output.push(`<${nextType}>`);
        listType = nextType;
      }
      output.push(`<li>${inlineMarkdown((unordered ?? ordered)![1])}</li>`);
      continue;
    }
    closeList();
    if (!paragraphOpen) {
      output.push('<p>');
      paragraphOpen = true;
    } else {
      output.push('<br>');
    }
    output.push(inlineMarkdown(line));
  }
  closeParagraph();
  closeList();
  return output.join('');
}
