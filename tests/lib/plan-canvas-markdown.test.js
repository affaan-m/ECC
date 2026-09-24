/**
 * Tests for scripts/lib/plan-canvas/markdown.js
 *
 * Run with: node tests/lib/plan-canvas-markdown.test.js
 */

const assert = require('assert');

// Import the module
const { renderMarkdown, escapeHtml, slugify } = require('../../scripts/lib/plan-canvas/markdown');

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

// Test suite
function runTests() {
  console.log('\n=== Testing plan-canvas/markdown.js ===\n');

  let passed = 0;
  let failed = 0;

  // escapeHtml tests
  console.log('escapeHtml:');

  if (test('escapes & < > " \'', () => {
    assert.strictEqual(
      escapeHtml('<a href="x" & \'y\'>'),
      '&lt;a href=&quot;x&quot; &amp; &#39;y&#39;&gt;'
    );
  })) passed++; else failed++;

  if (test('leaves safe text unchanged', () => {
    assert.strictEqual(escapeHtml('plain text 123'), 'plain text 123');
  })) passed++; else failed++;

  if (test('handles null/undefined as empty string', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
  })) passed++; else failed++;

  // slugify tests
  console.log('\nslugify:');

  if (test('lowercases and hyphenates spaces', () => {
    assert.strictEqual(slugify('Plan Overview'), 'plan-overview');
  })) passed++; else failed++;

  if (test('strips punctuation', () => {
    assert.strictEqual(slugify('Files to Change: Phase 1!'), 'files-to-change-phase-1');
  })) passed++; else failed++;

  if (test('collapses repeated separators and trims', () => {
    assert.strictEqual(slugify('  A   B--C  '), 'a-b-c');
  })) passed++; else failed++;

  if (test('returns empty string for symbol-only input', () => {
    assert.strictEqual(slugify('***'), '');
  })) passed++; else failed++;

  // Heading tests
  console.log('\nHeadings:');

  for (let level = 1; level <= 6; level++) {
    if (test(`renders h${level} with slug id`, () => {
      const md = `${'#'.repeat(level)} Title ${level}`;
      assert.strictEqual(
        renderMarkdown(md),
        `<h${level} id="title-${level}">Title ${level}</h${level}>`
      );
    })) passed++; else failed++;
  }

  if (test('heading supports inline formatting, slug ignores markers', () => {
    assert.strictEqual(
      renderMarkdown('## Rollout **Plan**'),
      '<h2 id="rollout-plan">Rollout <strong>Plan</strong></h2>'
    );
  })) passed++; else failed++;

  // Paragraph and inline tests
  console.log('\nParagraphs and Inline:');

  if (test('splits paragraphs on blank lines', () => {
    assert.strictEqual(
      renderMarkdown('first para\n\nsecond para'),
      '<p>first para</p>\n<p>second para</p>'
    );
  })) passed++; else failed++;

  if (test('joins consecutive lines into one paragraph', () => {
    assert.strictEqual(renderMarkdown('line a\nline b'), '<p>line a\nline b</p>');
  })) passed++; else failed++;

  if (test('renders bold, italic, strikethrough, inline code', () => {
    const out = renderMarkdown('has **bold**, *ital*, _emph_, ~~gone~~, and `a < b`.');
    assert.strictEqual(
      out,
      '<p>has <strong>bold</strong>, <em>ital</em>, <em>emph</em>, <del>gone</del>, and <code>a &lt; b</code>.</p>'
    );
  })) passed++; else failed++;

  if (test('does not italicize snake_case identifiers', () => {
    const out = renderMarkdown('use snake_case_name here');
    assert.ok(!out.includes('<em>'), `No <em> expected, got ${out}`);
  })) passed++; else failed++;

  if (test('inline code contents are not parsed further', () => {
    assert.strictEqual(renderMarkdown('`**x**`'), '<p><code>**x**</code></p>');
  })) passed++; else failed++;

  // List tests
  console.log('\nLists:');

  if (test('renders nested unordered list (2 levels)', () => {
    const out = renderMarkdown('- top one\n  - child one\n  - child two\n- top two');
    assert.ok(out.startsWith('<ul>'), 'Should start with <ul>');
    assert.ok(out.includes('<li>top one\n<ul>'), 'Nested list should sit inside first <li>');
    assert.ok(out.includes('<li>child one</li>'), 'Should contain first child');
    assert.ok(out.includes('</ul>\n</li>\n<li>top two</li>'), 'Second top item follows nested list');
  })) passed++; else failed++;

  if (test('renders ordered list', () => {
    assert.strictEqual(
      renderMarkdown('1. first\n2. second'),
      '<ol>\n<li>first</li>\n<li>second</li>\n</ol>'
    );
  })) passed++; else failed++;

  if (test('renders unordered list nested inside ordered list', () => {
    const out = renderMarkdown('1. step one\n   - detail\n2. step two');
    assert.ok(out.startsWith('<ol>'), 'Outer list should be <ol>');
    assert.ok(out.includes('<li>step one\n<ul>\n<li>detail</li>\n</ul>\n</li>'), `Nested <ul> expected, got ${out}`);
  })) passed++; else failed++;

  if (test('renders task list items (checked and unchecked)', () => {
    const out = renderMarkdown('- [ ] draft plan\n- [x] review plan');
    assert.ok(out.includes('<li class="task"><input type="checkbox" disabled> draft plan</li>'), `Unchecked task expected, got ${out}`);
    assert.ok(out.includes('<li class="task"><input type="checkbox" disabled checked> review plan</li>'), `Checked task expected, got ${out}`);
  })) passed++; else failed++;

  if (test('asterisk bullets work like hyphen bullets', () => {
    assert.strictEqual(renderMarkdown('* a\n* b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  })) passed++; else failed++;

  if (test('preserves items that outdent below the first item', () => {
    assert.strictEqual(
      renderMarkdown('  - alpha\n- beta\n- gamma'),
      '<ul>\n<li>alpha</li>\n</ul>\n<ul>\n<li>beta</li>\n<li>gamma</li>\n</ul>'
    );
  })) passed++; else failed++;

  if (test('uses each outdented run marker for its list type', () => {
    assert.strictEqual(
      renderMarkdown('  - prep\n1. phase one\n2. phase two'),
      '<ul>\n<li>prep</li>\n</ul>\n<ol>\n<li>phase one</li>\n<li>phase two</li>\n</ol>'
    );
  })) passed++; else failed++;

  if (test('marker type change at the same indent starts a new list', () => {
    assert.strictEqual(
      renderMarkdown('- prep\n1. phase one\n2. phase two'),
      '<ul>\n<li>prep</li>\n</ul>\n<ol>\n<li>phase one</li>\n<li>phase two</li>\n</ol>'
    );
  })) passed++; else failed++;

  if (test('switching back to bullets after a numbered run starts a third list', () => {
    assert.strictEqual(
      renderMarkdown('1. one\n- bullet\n2. two'),
      '<ol>\n<li>one</li>\n</ol>\n<ul>\n<li>bullet</li>\n</ul>\n<ol>\n<li>two</li>\n</ol>'
    );
  })) passed++; else failed++;

  if (test('renders repeated outdents without empty parent items', () => {
    const out = renderMarkdown('    - deep one\n    - deep two\n  - middle\n- shallow');
    assert.strictEqual(
      out,
      '<ul>\n<li>deep one</li>\n<li>deep two</li>\n</ul>\n' +
      '<ul>\n<li>middle</li>\n</ul>\n<ul>\n<li>shallow</li>\n</ul>'
    );
    assert.ok(!out.includes('<li>\n<ul>'), `No empty parent item expected, got ${out}`);
  })) passed++; else failed++;

  // Table tests
  console.log('\nTables:');

  const planTable = [
    '| File | Action | Why |',
    '|:-----|:------:|----:|',
    '| `scripts/lib/plan-canvas/markdown.js` | Create | GFM renderer |',
    '| `tests/lib/plan-canvas-markdown.test.js` | Create | **Required** coverage |'
  ].join('\n');

  if (test('renders plan-artifact table with thead/tbody', () => {
    const out = renderMarkdown(planTable);
    assert.ok(out.startsWith('<table>'), 'Should start with <table>');
    assert.ok(out.includes('<thead>'), 'Should contain <thead>');
    assert.ok(out.includes('<tbody>'), 'Should contain <tbody>');
  })) passed++; else failed++;

  if (test('applies alignment styles to header and body cells', () => {
    const out = renderMarkdown(planTable);
    assert.ok(out.includes('<th style="text-align:left">File</th>'), 'Left-aligned header');
    assert.ok(out.includes('<th style="text-align:center">Action</th>'), 'Center-aligned header');
    assert.ok(out.includes('<th style="text-align:right">Why</th>'), 'Right-aligned header');
    assert.ok(out.includes('<td style="text-align:center">Create</td>'), 'Center-aligned cell');
  })) passed++; else failed++;

  if (test('renders inline code and bold inside table cells', () => {
    const out = renderMarkdown(planTable);
    assert.ok(out.includes('<code>scripts/lib/plan-canvas/markdown.js</code>'), 'Code span in cell');
    assert.ok(out.includes('<strong>Required</strong> coverage'), 'Bold in cell');
  })) passed++; else failed++;

  if (test('omits style attribute when column has no alignment', () => {
    const out = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    assert.ok(out.includes('<th>A</th>'), 'Header without style');
    assert.ok(out.includes('<td>1</td>'), 'Cell without style');
    assert.ok(!out.includes('style='), 'No style attributes at all');
  })) passed++; else failed++;

  // Code fence tests
  console.log('\nFenced Code Blocks:');

  if (test('renders fence with language class and escaped content', () => {
    assert.strictEqual(
      renderMarkdown('```js\nconst x = 1 < 2;\n```'),
      '<pre><code class="language-js">const x = 1 &lt; 2;</code></pre>'
    );
  })) passed++; else failed++;

  if (test('escapes <script> inside code blocks', () => {
    const out = renderMarkdown('```html\n<script>alert(1)</script>\n```');
    assert.ok(!out.includes('<script>'), 'Raw script tag must not survive');
    assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Escaped script expected');
  })) passed++; else failed++;

  if (test('does not parse inline markdown inside code blocks', () => {
    const out = renderMarkdown('```\n**not bold**\n```');
    assert.ok(out.includes('**not bold**'), 'Literal asterisks expected');
    assert.ok(!out.includes('<strong>'), 'No strong tag expected');
  })) passed++; else failed++;

  if (test('sanitizes language attribute to [a-z0-9-]', () => {
    const out = renderMarkdown('```C++ extra info\ncode\n```');
    assert.ok(out.includes('class="language-c"'), `Sanitized lang expected, got ${out}`);
  })) passed++; else failed++;

  if (test('unclosed fence consumes to end of input', () => {
    const out = renderMarkdown('```\nno closing fence');
    assert.strictEqual(out, '<pre><code>no closing fence</code></pre>');
  })) passed++; else failed++;

  // Blockquote and horizontal rule tests
  console.log('\nBlockquotes and Rules:');

  if (test('renders blockquote with inline formatting', () => {
    assert.strictEqual(
      renderMarkdown('> planning note with **bold**'),
      '<blockquote>\n<p>planning note with <strong>bold</strong></p>\n</blockquote>'
    );
  })) passed++; else failed++;

  if (test('renders nested blockquotes', () => {
    const out = renderMarkdown('> outer\n> > inner');
    const opens = out.split('<blockquote>').length - 1;
    assert.strictEqual(opens, 2, `Expected 2 blockquotes, got ${opens}`);
    assert.ok(out.includes('<p>outer</p>'), 'Outer text expected');
    assert.ok(out.includes('<p>inner</p>'), 'Inner text expected');
  })) passed++; else failed++;

  if (test('renders --- and *** as horizontal rules', () => {
    assert.strictEqual(
      renderMarkdown('above\n\n---\n\nbelow'),
      '<p>above</p>\n<hr>\n<p>below</p>'
    );
    assert.strictEqual(renderMarkdown('***'), '<hr>');
  })) passed++; else failed++;

  // XSS tests
  console.log('\nXSS Hardening:');

  if (test('escapes raw <script> in a paragraph', () => {
    const out = renderMarkdown('<script>alert(1)</script>');
    assert.strictEqual(out, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  })) passed++; else failed++;

  if (test('javascript: link renders as plain label text', () => {
    const out = renderMarkdown('[x](javascript:alert(1))');
    assert.ok(!out.includes('<a'), 'No anchor expected');
    assert.ok(!out.includes('javascript'), 'Payload URL must be dropped');
    assert.ok(out.includes('x'), 'Label text should remain');
  })) passed++; else failed++;

  if (test('mixed-case JaVaScRiPt: link is blocked', () => {
    const out = renderMarkdown('[x](JaVaScRiPt:alert(1))');
    assert.ok(!out.includes('<a'), 'No anchor expected');
    assert.ok(!/javascript/i.test(out), 'Payload URL must be dropped');
  })) passed++; else failed++;

  if (test('whitespace-obfuscated scheme is blocked', () => {
    const out = renderMarkdown('[x](java\tscript:alert(1))');
    assert.ok(!out.includes('<a'), 'No anchor expected');
    assert.ok(!out.includes('script:'), 'Payload URL must be dropped');
  })) passed++; else failed++;

  if (test('data: and vbscript: links are blocked', () => {
    assert.strictEqual(renderMarkdown('[x](data:text/html;base64,AAAA)'), '<p>x</p>');
    const vb = renderMarkdown('[x](vbscript:msgbox(1))');
    assert.ok(!vb.includes('<a'), 'No anchor expected');
    assert.ok(!vb.includes('vbscript'), 'Payload URL must be dropped');
  })) passed++; else failed++;

  if (test('javascript: image renders as plain alt text', () => {
    const out = renderMarkdown('![x](javascript:alert(1))');
    assert.ok(!out.includes('<img'), 'No img expected');
    assert.ok(!out.includes('javascript'), 'Payload URL must be dropped');
  })) passed++; else failed++;

  if (test('raw <img onerror> HTML is escaped', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>');
    assert.strictEqual(out, '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  })) passed++; else failed++;

  if (test('event-handler injection via link text is escaped', () => {
    const out = renderMarkdown('["><img src=x onerror=alert(1)>](https://evil.example)');
    assert.ok(!out.includes('<img'), 'No raw img expected');
    assert.ok(out.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'), `Escaped label expected, got ${out}`);
  })) passed++; else failed++;

  if (test('image alt attribute value is escaped', () => {
    assert.strictEqual(
      renderMarkdown('![a"b](x.png)'),
      '<p><img src="x.png" alt="a&quot;b"></p>'
    );
  })) passed++; else failed++;

  // Link protocol tests
  console.log('\nLink Protocols:');

  if (test('https link gets target=_blank and rel=noopener', () => {
    assert.strictEqual(
      renderMarkdown('[docs](https://example.com)'),
      '<p><a href="https://example.com" target="_blank" rel="noopener">docs</a></p>'
    );
  })) passed++; else failed++;

  if (test('#anchor link has no target/rel', () => {
    assert.strictEqual(
      renderMarkdown('[phase](#phase-1)'),
      '<p><a href="#phase-1">phase</a></p>'
    );
  })) passed++; else failed++;

  if (test('relative link has no target/rel', () => {
    assert.strictEqual(
      renderMarkdown('[utils](./scripts/lib/utils.js)'),
      '<p><a href="./scripts/lib/utils.js">utils</a></p>'
    );
  })) passed++; else failed++;

  if (test('mailto link allowed without target/rel', () => {
    assert.strictEqual(
      renderMarkdown('[mail](mailto:team@example.com)'),
      '<p><a href="mailto:team@example.com">mail</a></p>'
    );
  })) passed++; else failed++;

  if (test('relative image src allowed', () => {
    assert.strictEqual(
      renderMarkdown('![diagram](assets/plan.png)'),
      '<p><img src="assets/plan.png" alt="diagram"></p>'
    );
  })) passed++; else failed++;

  if (test('inline formatting works inside link labels', () => {
    const out = renderMarkdown('[`code` and **bold** docs](https://example.com)');
    assert.ok(out.includes('<code>code</code> and <strong>bold</strong> docs</a>'), `Formatted label expected, got ${out}`);
  })) passed++; else failed++;

  // Edge case tests
  console.log('\nEdge Cases:');

  if (test('empty input returns empty string', () => {
    assert.strictEqual(renderMarkdown(''), '');
    assert.strictEqual(renderMarkdown(null), '');
    assert.strictEqual(renderMarkdown(undefined), '');
  })) passed++; else failed++;

  if (test('input without trailing newline works', () => {
    assert.strictEqual(renderMarkdown('final line'), '<p>final line</p>');
  })) passed++; else failed++;

  if (test('CRLF line endings are normalized', () => {
    assert.strictEqual(renderMarkdown('one\r\n\r\ntwo'), '<p>one</p>\n<p>two</p>');
  })) passed++; else failed++;

  if (test('whitespace-only input returns empty string', () => {
    assert.strictEqual(renderMarkdown('  \n\n  '), '');
  })) passed++; else failed++;

  console.log('\nMermaid diagrams:');

  if (test('```mermaid becomes <pre class="mermaid">, not a code block', () => {
    const html = renderMarkdown('```mermaid\nflowchart LR\n  A --> B\n```');
    assert.ok(html.includes('<pre class="mermaid">'), 'expected mermaid container');
    assert.ok(!html.includes('language-mermaid'), 'should not render as a code block');
  })) passed++; else failed++;

  if (test('mermaid arrows are entity-escaped so textContent decodes them', () => {
    // The browser decodes &gt; back to > in textContent, so the renderer
    // still receives valid `-->` while HTML injection is prevented.
    const html = renderMarkdown('```mermaid\nA --> B\n```');
    assert.ok(html.includes('A --&gt; B'));
  })) passed++; else failed++;

  if (test('script tags inside a mermaid block are inert', () => {
    const html = renderMarkdown('```mermaid\n<script>alert(1)</script>\n```');
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  })) passed++; else failed++;

  if (test('a </pre> in the source cannot break out of the container', () => {
    const html = renderMarkdown('```mermaid\nA</pre><img src=x onerror=1>\n```');
    assert.ok(!html.includes('</pre><img'));
    assert.ok(html.includes('&lt;/pre&gt;&lt;img'));
  })) passed++; else failed++;

  // Summary
  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
