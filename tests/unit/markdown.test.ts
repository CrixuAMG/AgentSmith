import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '@/shared/markdown';

describe('suggestion markdown rendering', () => {
  it('renders common markdown and escapes HTML', () => {
    const html = renderMarkdown('# Proposal\n\n- **Problem:** <unsafe>\n- Add `tests`');

    expect(html).toContain('<h1>Proposal</h1>');
    expect(html).toContain('<strong>Problem:</strong> &lt;unsafe&gt;');
    expect(html).toContain('<code>tests</code>');
    expect(html).not.toContain('<unsafe>');
  });
});
