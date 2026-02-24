/**
 * Extracts ChatGPT assistant response as Markdown by walking the DOM tree.
 *
 * This function is designed to run inside a browser page context via
 * `page.evaluate()`. It converts the rendered HTML back into clean Markdown,
 * preserving headings, code blocks, lists, tables, inline formatting, etc.
 *
 * Because this runs in the browser (not Node), it uses `any` types and is
 * exported as a plain function that Playwright can serialize.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function extractMarkdownFromPage(): string {
  // `document` exists in the browser context where page.evaluate() runs
  const doc = (globalThis as any).document;
  const messages = doc.querySelectorAll(
    '[data-message-author-role="assistant"]'
  );
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return '';

  const root =
    lastMessage.querySelector('.markdown') ||
    lastMessage.querySelector('.prose') ||
    lastMessage;

  return nodeToMarkdown(root).replace(/\n{3,}/g, '\n\n').trim();

  function nodeToMarkdown(node: any): string {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      return node.textContent || '';
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return '';

    const el = node as any;
    const tag = (el.tagName || '').toLowerCase();

    if (el.getAttribute('aria-hidden') === 'true') return '';

    // Headings
    const hMatch = tag.match(/^h([1-6])$/);
    if (hMatch) {
      const level = parseInt(hMatch[1], 10);
      const prefix = '#'.repeat(level);
      return `\n\n${prefix} ${inlineContent(el).trim()}\n\n`;
    }

    // Code blocks
    if (tag === 'pre') {
      const codeEl = el.querySelector('code');
      const raw = codeEl ? codeEl.textContent || '' : el.textContent || '';
      let lang = '';
      if (codeEl) {
        const cls = codeEl.className || '';
        const m = cls.match(/language-(\S+)/);
        if (m) lang = m[1];
      }
      return `\n\n\`\`\`${lang}\n${raw.replace(/\n$/, '')}\n\`\`\`\n\n`;
    }

    if (tag === 'p') {
      const text = inlineContent(el).trim();
      return text ? `\n\n${text}\n\n` : '';
    }

    if (tag === 'blockquote') {
      const inner = childrenMd(el).trim();
      return '\n\n' + inner.split('\n').map((l: string) => `> ${l}`).join('\n') + '\n\n';
    }

    if (tag === 'hr') return '\n\n---\n\n';

    // Ordered list
    if (tag === 'ol') {
      const items = Array.from(el.children).filter((c: any) => (c.tagName || '').toLowerCase() === 'li');
      const startAttr = el.getAttribute('start');
      let idx = startAttr ? parseInt(startAttr, 10) : 1;
      const lines = items.map((li: any) => `${idx++}. ${liContent(li).trim()}`);
      return `\n\n${lines.join('\n')}\n\n`;
    }

    // Unordered list
    if (tag === 'ul') {
      const items = Array.from(el.children).filter((c: any) => (c.tagName || '').toLowerCase() === 'li');
      const lines = items.map((li: any) => `- ${liContent(li).trim()}`);
      return `\n\n${lines.join('\n')}\n\n`;
    }

    // Table
    if (tag === 'table') return convertTable(el);

    // Skip utility elements
    if (['button', 'svg', 'nav', 'style', 'script'].includes(tag)) return '';

    return childrenMd(el);
  }

  function childrenMd(el: any): string {
    let result = '';
    const nodes = el.childNodes || [];
    for (let i = 0; i < nodes.length; i++) {
      result += nodeToMarkdown(nodes[i]);
    }
    return result;
  }

  function inlineContent(el: any): string {
    let result = '';
    const nodes = el.childNodes || [];
    for (let i = 0; i < nodes.length; i++) {
      const child = nodes[i];
      if (child.nodeType === 3) {
        result += child.textContent || '';
        continue;
      }
      if (child.nodeType !== 1) continue;

      const childTag = (child.tagName || '').toLowerCase();

      if (childTag === 'strong' || childTag === 'b') {
        result += `**${inlineContent(child)}**`;
      } else if (childTag === 'em' || childTag === 'i') {
        result += `*${inlineContent(child)}*`;
      } else if (childTag === 'code') {
        result += '`' + (child.textContent || '') + '`';
      } else if (childTag === 'a') {
        const href = child.getAttribute('href') || '';
        result += `[${inlineContent(child)}](${href})`;
      } else if (childTag === 'br') {
        result += '\n';
      } else if (childTag === 'del' || childTag === 's') {
        result += `~~${inlineContent(child)}~~`;
      } else {
        result += inlineContent(child);
      }
    }
    return result;
  }

  function liContent(li: any): string {
    let inline = '';
    let nested = '';
    const nodes = li.childNodes || [];
    for (let i = 0; i < nodes.length; i++) {
      const child = nodes[i];
      if (child.nodeType === 3) {
        inline += child.textContent || '';
        continue;
      }
      if (child.nodeType !== 1) continue;

      const childTag = (child.tagName || '').toLowerCase();
      if (childTag === 'ul' || childTag === 'ol') {
        const nestedMd = nodeToMarkdown(child).trim();
        nested += '\n' + nestedMd.split('\n').map((l: string) => `  ${l}`).join('\n');
      } else if (childTag === 'p') {
        inline += inlineContent(child);
      } else {
        inline += inlineContent(child);
      }
    }
    return inline.trim() + nested;
  }

  function convertTable(tableEl: any): string {
    const headerRow: string[] = [];
    const thead = tableEl.querySelector('thead');
    const tbody = tableEl.querySelector('tbody');

    if (thead) {
      const ths = thead.querySelectorAll('th');
      for (let i = 0; i < ths.length; i++) {
        headerRow.push(inlineContent(ths[i]).trim());
      }
    }

    const bodyRows: string[][] = [];
    const rowEls = tbody ? tbody.querySelectorAll('tr') : tableEl.querySelectorAll('tr');
    for (let r = 0; r < rowEls.length; r++) {
      const cells: string[] = [];
      const tds = rowEls[r].querySelectorAll('td, th');
      for (let c = 0; c < tds.length; c++) {
        cells.push(inlineContent(tds[c]).trim());
      }
      if (cells.length > 0) bodyRows.push(cells);
    }

    if (headerRow.length === 0 && bodyRows.length > 0) {
      headerRow.push(...bodyRows.shift()!);
    }
    if (headerRow.length === 0) return '';

    const colWidths = headerRow.map((h: string, i: number) => {
      let max = h.length;
      for (const row of bodyRows) {
        if (row[i] && row[i].length > max) max = row[i].length;
      }
      return Math.max(max, 3);
    });

    const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));

    const headerLine = '| ' + headerRow.map((h: string, i: number) => pad(h, colWidths[i])).join(' | ') + ' |';
    const sepLine = '| ' + colWidths.map((w: number) => '-'.repeat(w)).join(' | ') + ' |';
    const bodyLines = bodyRows.map((row: string[]) =>
      '| ' + headerRow.map((_: string, i: number) => pad(row[i] || '', colWidths[i])).join(' | ') + ' |'
    );

    return `\n\n${headerLine}\n${sepLine}\n${bodyLines.join('\n')}\n\n`;
  }
}
