'use strict';

/**
 * Minimal GitHub-flavored-markdown subset renderer for Plan Canvas.
 * Renders .claude/plans/*.plan.md artifacts to HTML body content.
 *
 * Security model: the entire source line is HTML-escaped before any inline
 * rule runs, so raw HTML in the markdown always displays as text. Link and
 * image URLs are validated against an allowlist of protocols.
 */

// Placeholders live in the Unicode private-use area so escaped output can
// never collide with them. Pre-existing occurrences are stripped from input.
const TOKEN_OPEN = '\uE000';
const TOKEN_CLOSE = '\uE001';
const TOKEN_RE = new RegExp(TOKEN_OPEN + '(\\d+)' + TOKEN_CLOSE, 'g');
const STRIP_RE = new RegExp('[' + TOKEN_OPEN + TOKEN_CLOSE + ']', 'g');

const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const HR_RE = /^ {0,3}(-{3,}|\*{3,})\s*$/;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Strip whitespace/control characters so "Ja vaScript:" style tricks cannot
// hide a scheme, then classify against the allowlist.
function classifyUrl(rawUrl) {
  const compact = String(rawUrl)
    .split('')
    .filter((ch) => ch.charCodeAt(0) > 32)
    .join('')
    .toLowerCase();
  if (compact.startsWith('#')) return 'anchor';
  if (compact.startsWith('//')) return 'blocked';
  const scheme = compact.match(/^[a-z][a-z0-9+.-]*:/);
  if (!scheme) return 'relative';
  if (scheme[0] === 'http:' || scheme[0] === 'https:') return 'http';
  if (scheme[0] === 'mailto:') return 'mailto';
  return 'blocked';
}

function applyEmphasis(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>');
}

function renderInline(rawText) {
  const tokens = [];
  const stash = (html) => {
    tokens.push(html);
    return TOKEN_OPEN + (tokens.length - 1) + TOKEN_CLOSE;
  };

  let s = escapeHtml(rawText);

  // Code spans first: contents stay escaped and opt out of all other rules.
  s = s.replace(/`([^`]+)`/g, (_m, code) => stash('<code>' + code + '</code>'));

  s = s.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_m, alt, src) => {
    const kind = classifyUrl(src);
    if (kind !== 'http' && kind !== 'relative') return alt;
    return stash('<img src="' + src.trim() + '" alt="' + alt + '">');
  });

  s = s.replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_m, label, url) => {
    const kind = classifyUrl(url);
    const text = applyEmphasis(label);
    if (kind === 'blocked') return text;
    const extra = kind === 'http' ? ' target="_blank" rel="noopener"' : '';
    return stash('<a href="' + url.trim() + '"' + extra + '>' + text + '</a>');
  });

  s = applyEmphasis(s);

  // Stashed anchors may hold code-span tokens, so resolve until none remain.
  while (s.includes(TOKEN_OPEN)) {
    s = s.replace(TOKEN_RE, (_m, idx) => tokens[Number(idx)]);
  }
  return s;
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s
    .replace(/\\\|/g, TOKEN_OPEN)
    .split('|')
    .map((cell) => cell.split(TOKEN_OPEN).join('|').trim());
}

function isAlignmentRow(line) {
  if (!line || !line.includes('|')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function cellAlign(spec) {
  const left = spec.startsWith(':');
  const right = spec.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return '';
}

function renderListItem(text) {
  const task = text.match(/^\[([ xX])\]\s+(.*)$/);
  if (task) {
    const checked = task[1].trim() ? ' checked' : '';
    return '<li class="task"><input type="checkbox" disabled' + checked + '> ' +
      renderInline(task[2]) + '</li>';
  }
  return '<li>' + renderInline(text) + '</li>';
}

function listTag(marker) {
  return /^\d/.test(marker) ? 'ol' : 'ul';
}

function buildList(items, start, indent) {
  const tag = listTag(items[start].marker);
  const parts = [];
  let i = start;
  while (i < items.length && items[i].indent >= indent) {
    if (items[i].indent > indent) {
      // Deeper item: nest a sublist inside the previous <li>
      const nested = buildList(items, i, items[i].indent);
      if (parts.length > 0) {
        const last = parts.pop();
        parts.push(last.replace(/<\/li>$/, '\n' + nested.html + '\n</li>'));
      } else {
        parts.push('<li>\n' + nested.html + '\n</li>');
      }
      i = nested.end;
    } else {
      // A marker-type change at the same indent starts a new list
      // (CommonMark); stop here so the caller renders the next run with
      // its own tag instead of absorbing it into this one.
      if (listTag(items[i].marker) !== tag) break;
      parts.push(renderListItem(items[i].text));
      i += 1;
    }
  }
  return { html: '<' + tag + '>\n' + parts.join('\n') + '\n</' + tag + '>', end: i };
}

function buildListBlock(items) {
  let lists = [];
  let i = 0;
  while (i < items.length) {
    const list = buildList(items, i, items[i].indent);
    lists = [...lists, list.html];
    i = list.end;
  }
  return lists.join('\n');
}

function startsBlock(line, nextLine) {
  return /^```/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    HR_RE.test(line) ||
    /^ {0,3}>/.test(line) ||
    LIST_ITEM_RE.test(line) ||
    (line.includes('|') && isAlignmentRow(nextLine || ''));
}

function renderMarkdown(text) {
  if (!text) return '';
  const lines = String(text)
    .replace(STRIP_RE, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(/^```(.*)$/);
    if (fence) {
      const lang = fence[1].trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
      const body = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence (or run off EOF)
      if (lang === 'mermaid') {
        // Mermaid reads the element's textContent, and the browser decodes
        // character references there — so escaping keeps `-->`/`<` intact for
        // the renderer while preventing HTML injection or a </pre> breakout.
        out.push('<pre class="mermaid">' + escapeHtml(body.join('\n')) + '</pre>');
        continue;
      }
      const cls = lang ? ' class="language-' + lang + '"' : '';
      out.push('<pre><code' + cls + '>' + escapeHtml(body.join('\n')) + '</code></pre>');
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      out.push('<h' + level + ' id="' + slugify(heading[2]) + '">' +
        renderInline(heading[2]) + '</h' + level + '>');
      i += 1;
      continue;
    }

    // Horizontal rule (alignment rows never reach here: tables consume them)
    if (HR_RE.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    // Blockquote: strip one `>` level and recurse, which handles nesting
    if (/^ {0,3}>/.test(line)) {
      const inner = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
        inner.push(lines[i].replace(/^ {0,3}> ?/, ''));
        i += 1;
      }
      out.push('<blockquote>\n' + renderMarkdown(inner.join('\n')) + '\n</blockquote>');
      continue;
    }

    // Table: header row followed by an alignment row
    if (line.includes('|') && isAlignmentRow(lines[i + 1] || '')) {
      const aligns = splitTableRow(lines[i + 1]).map(cellAlign);
      const row = (tag, cells) => '<tr>' + cells.map((cell, idx) => {
        const style = aligns[idx] ? ' style="text-align:' + aligns[idx] + '"' : '';
        return '<' + tag + style + '>' + renderInline(cell) + '</' + tag + '>';
      }).join('') + '</tr>';
      const head = row('th', splitTableRow(line));
      const body = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        body.push(row('td', splitTableRow(lines[i])));
        i += 1;
      }
      out.push('<table>\n<thead>\n' + head + '\n</thead>\n<tbody>\n' +
        body.join('\n') + '\n</tbody>\n</table>');
      continue;
    }

    if (LIST_ITEM_RE.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM_RE);
        if (!m) break;
        items.push({ indent: m[1].length, marker: m[2], text: m[3] });
        i += 1;
      }
      // An outdent below the first item's indentation ends that list. Render
      // the remaining run as a sibling list so malformed indentation cannot
      // silently drop content or create an empty parent item.
      out.push(buildListBlock(items));
      continue;
    }

    // Paragraph: run of plain lines up to a blank line or block start
    const para = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push('<p>' + renderInline(para.join('\n')) + '</p>');
  }

  return out.join('\n');
}

module.exports = { renderMarkdown, escapeHtml, slugify };
