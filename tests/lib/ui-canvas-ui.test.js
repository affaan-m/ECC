/**
 * Tests for the UI Canvas browser shell and in-page editor sources
 * (scripts/lib/ui-canvas/ui.js, scripts/lib/ui-canvas/editor.js).
 *
 * The browser code ships as strings, so these tests compile them with the
 * V8 parser, check the shell/editor message contract stays in sync, and
 * make sure the rendered shell carries every element the client binds to.
 *
 * Run with: node tests/lib/ui-canvas-ui.test.js
 */

const assert = require('assert');
const vm = require('vm');

const { ICONS, renderUiCanvasHtml, uiCanvasCss, uiClientJs } = require('../../scripts/lib/ui-canvas/ui');
const { uiEditorJs } = require('../../scripts/lib/ui-canvas/editor');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}\n    ${error.stack || error.message}`);
  }
}

function messageNames(source, direction) {
  // direction 'post' finds messages a script sends; 'case' finds ones it handles.
  const pattern = direction === 'post'
    ? /post(?:ToFrame)?\(\{\s*type:\s*'(uc:[a-z-]+)'/g
    : /case '(uc:[a-z-]+)'/g;
  return new Set([...source.matchAll(pattern)].map(match => match[1]));
}

console.log('ui-canvas shell + editor');

test('editor and client scripts parse as JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(uiEditorJs(), { filename: 'ui-editor.js' }));
  assert.doesNotThrow(() => new vm.Script(uiClientJs(), { filename: 'ui-client.js' }));
});

test('editor only talks to the shell through uc:* messages it declares', () => {
  const editor = uiEditorJs();
  const client = uiClientJs();
  const editorPosts = messageNames(editor, 'post');
  const clientHandles = messageNames(client, 'case');
  for (const name of editorPosts) {
    if (name === 'uc:viewport') continue; // informational; the shell measures the stage itself
    assert.ok(clientHandles.has(name), `shell does not handle ${name}`);
  }
  const clientPosts = messageNames(client, 'post');
  const editorHandles = messageNames(editor, 'case');
  for (const name of clientPosts) assert.ok(editorHandles.has(name), `editor does not handle ${name}`);
  assert.ok(editorHandles.has('uc:restore') && editorHandles.has('uc:export') && editorHandles.has('uc:forget'));
});

test('editor accepts commands only from its parent shell', () => {
  const source = uiEditorJs();
  const start = source.indexOf("window.addEventListener('message', function (e) {");
  const end = source.indexOf('\n  });', start) + '\n  });'.length;
  assert.ok(start >= 0 && end > start);
  const parent = {};
  let listener;
  let removed = 0;
  vm.runInNewContext(source.slice(start, end), {
    window: { parent, addEventListener: (_event, callback) => { listener = callback; } },
    removeSelected: () => { removed += 1; },
  });
  listener({ source: {}, data: { type: 'uc:remove' } });
  listener({ source: null, data: { type: 'uc:remove' } });
  assert.strictEqual(removed, 0, 'A nested frame must not control the editor');
  listener({ source: parent, data: { type: 'uc:remove' } });
  assert.strictEqual(removed, 1, 'The actual parent shell retains editor control');
});

test('editor never selects or exports its own overlay', () => {
  const editor = uiEditorJs();
  assert.ok(editor.includes("setAttribute('data-ecc-ui-canvas', 'overlay')"));
  assert.ok(editor.includes('[data-ecc-ui-canvas],[data-ecc-plan-canvas]'), 'export strips injected nodes');
  assert.ok(editor.includes('if (window.parent === window) return;'));
  assert.ok(editor.includes('attachShadow'));
});

test('rendered shell contains every element the client binds and escapes the bootstrap', () => {
  const session = {
    key: 'abcdefabcdef',
    file: '/tmp/demo/<card>.html',
    status: 'open',
    chat: [{ role: 'user', kind: 'chat', text: '</script><script>alert(1)</script>', at: '2026-01-01T00:00:00.000Z' }],
    ui: { viewport: 'mobile', title: 'Card & co' },
    agent: { name: 'Claude Code', project: 'demo' }
  };
  const html = renderUiCanvasHtml(session);
  const client = uiClientJs();
  const ids = new Set([...client.matchAll(/\$\('([A-Za-z]+)'\)/g)].map(match => match[1]));
  assert.ok(ids.size > 20, 'client binds many ids');
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `shell is missing #${id}`);
  assert.ok(!html.includes('</script><script>alert(1)'), 'bootstrap JSON must escape <');
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok(html.includes('Card &amp; co · UI Canvas'));
  assert.ok(html.includes('sandbox="allow-scripts allow-forms allow-popups"'), 'iframe stays sandboxed without same-origin');
  assert.ok(html.includes('data-vp="mobile"') && html.includes('data-vp="desktop"') && html.includes('data-vp="custom"'));
  assert.ok(html.includes(ICONS.mobile) && html.includes(ICONS.desktop) && html.includes(ICONS.custom));
  assert.ok(html.includes('Save and Finish'));
});

test('shell falls back to the file name when no title is set', () => {
  const html = renderUiCanvasHtml({ key: 'abcdefabcdef', file: '/tmp/sidebar.html', status: 'open', chat: [] });
  assert.ok(html.includes('<title>sidebar.html · UI Canvas</title>'));
  assert.ok(html.includes('"ui":{"viewport":"desktop","title":""}'));
});

test('shell css carries the shared ECC tokens and the device frame styles', () => {
  const css = uiCanvasCss();
  assert.ok(css.includes('--bg:#080a0e'), 'shares the Plan Canvas and dashboard tokens');
  assert.ok(css.includes('.device.mobile'));
  assert.ok(css.includes('.presence[data-state="listening"]'));
  assert.ok(css.includes('.range::-webkit-slider-thumb') && css.includes('.numedit.invalid'), 'slider rows and typed values are styled');
});

test('ui canvas chrome is ECC green with no decorative gradients', () => {
  const css = uiCanvasCss();
  assert.ok(css.includes(':root{--accent:#4acb8a'), 'accent overrides the shared blue');
  const rule = selector => {
    const start = css.indexOf('\n  ' + selector + '{');
    return start < 0 ? '' : css.slice(start, css.indexOf('}', start) + 1);
  };
  for (const selector of ['.brand .logo', '.primary', '.composer .send']) {
    assert.ok(rule(selector), selector + ' rule exists');
    assert.ok(!/gradient/.test(rule(selector)), selector + ' must not use a gradient');
  }
  const editor = uiEditorJs();
  assert.ok(editor.includes("var ACCENT = '#22c55e'"), 'selection overlay is green');
  assert.ok(!/#6885e8|104,133,232|#8fa4f0/i.test(editor), 'no leftover blue in the overlay');
});

test('inspector inlines the tested field helpers and drops the old chip strip', () => {
  const client = uiClientJs();
  for (const name of ['sanitizeNumber', 'sanitizeBoxList', 'parseColor', 'hslToRgb', 'sanitizeCssText']) {
    assert.ok(client.includes('function ' + name + '('), name + ' is inlined');
  }
  assert.ok(!client.includes('${FIELD_HELPERS_JS}'), 'helpers are interpolated, not left as a placeholder');
  assert.ok(!client.includes('selectedChip') && !client.includes("type = 'color'"), 'native color input and chips are gone');
  const html = renderUiCanvasHtml({ key: 'abcdefabcdef', file: '/tmp/x.html', status: 'open', chat: [] });
  assert.ok(html.includes('id="vpW" type="text" inputmode="numeric"'), 'viewport width is a sanitized text field');
  assert.ok(!html.includes('type="number"'), 'no browser number spinners remain');
});

test('gesture release hands the finished gesture to its handler', () => {
  // Regression: mouseup cleared the shared gesture before endResize/endDrag
  // read it, so every handle resize, reorder and Alt-drag threw on release.
  const editor = uiEditorJs();
  assert.ok(editor.includes('function endResize(g) {') && editor.includes('function endDrag(g) {'));
  assert.ok(editor.includes('endResize(g);') && editor.includes('endDrag(g);'));
  const endResize = editor.slice(editor.indexOf('function endResize(g) {'), editor.indexOf('function axisOf('));
  const endDrag = editor.slice(editor.indexOf('function endDrag(g) {'), editor.indexOf('function nudgeBy('));
  for (const body of [endResize, endDrag]) assert.ok(!/\bgesture\b/.test(body), 'finish handlers must not read the cleared gesture');
});

test('editor reports border-radius from real corner properties', () => {
  const editor = uiEditorJs();
  assert.ok(editor.includes("['border-radius', radiusSummary(cs)]"));
  assert.ok(editor.includes('cs.borderTopLeftRadius') && !editor.includes("sides(cs, 'border', '-radius')"));
});

test('applied batches replay until specific acknowledgment, not an unrelated reload', () => {
  const client = uiClientJs();
  const editor = uiEditorJs();
  assert.ok(client.includes("type: 'uc:restore', baked: submitted.flatMap(batch => batch.edits), batches: submitted, edits"), 'reloads replay submitted edits');
  assert.ok(client.includes("es.addEventListener('reload', reloadArtifact)"));
  assert.ok(client.includes("es.addEventListener('ui-ack'"));
  assert.ok(editor.includes('var baked = Array.isArray(payload.baked) ? payload.baked : [];'));
});

test('viewports from the bootstrap and sessionStorage are clamped', () => {
  const client = uiClientJs();
  assert.ok(client.includes('const clampDim = n => Math.max(100, Math.min(20000'));
  assert.ok(client.includes('let vp = storedViewport(stored.viewport) || parseViewport('));
});

test('every ui-canvas source file stays under the 800-line limit', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', '..', 'scripts', 'lib', 'ui-canvas');
  for (const name of fs.readdirSync(dir)) {
    const lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n').length;
    assert.ok(lines <= 800, name + ' has ' + lines + ' lines');
  }
});

test('theme toggle keeps its icons instead of overwriting them with text', () => {
  const client = uiClientJs();
  assert.ok(!client.includes("$('themeBtn').textContent"), 'textContent would wipe the sun and moon icons');
  assert.ok(client.includes("$('themeBtn').setAttribute('aria-label', label)"));
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
