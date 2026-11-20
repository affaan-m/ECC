/**
 * Tests for the UI Canvas server pieces (scripts/lib/ui-canvas/server-routes.js):
 * asset serving, export materialization, and export error mapping.
 *
 * Run with: node tests/lib/ui-canvas-server-routes.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const routes = require('../../scripts/lib/ui-canvas/server-routes');

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

function fakeRes() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

console.log('ui-canvas server routes');

test('serveUiAsset serves the three shell assets uncached and ignores everything else', () => {
  for (const [pathname, type] of [['/ui-canvas.css', 'text/css'], ['/ui-client.js', 'text/javascript'], ['/ui-editor.js', 'text/javascript']]) {
    const res = fakeRes();
    assert.strictEqual(routes.serveUiAsset(pathname, res), true, pathname);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].startsWith(type));
    assert.strictEqual(res.headers['cache-control'], 'no-store');
    assert.ok(res.body.length > 1000);
  }
  const res = fakeRes();
  assert.strictEqual(routes.serveUiAsset('/toString', res), false, 'prototype keys are not assets');
  assert.strictEqual(routes.serveUiAsset('/client.js', res), false);
  assert.strictEqual(res.status, null);
});

test('materializeUiExports writes snapshots beside the artifact and strips html', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-canvas-routes-'));
  try {
    const file = path.join(dir, 'card.html');
    const items = routes.materializeUiExports({ file }, [
      { kind: 'chat', text: 'hi' },
      null,
      { kind: 'edits', html: '<html>A</html>', edits: [{ kind: 'nudge', selector: 'h1', dx: 1, dy: 0 }, { kind: 'bogus' }] },
      { kind: 'finish', html: '<html>F</html>', edits: [], viewport: { preset: 'mobile', width: 393, height: 852 } }
    ]);
    assert.deepStrictEqual(items[0], { kind: 'chat', text: 'hi' });
    assert.strictEqual(items[1], null);
    assert.ok(!('html' in items[2]) && !('html' in items[3]));
    assert.strictEqual(items[2].edits.length, 1, 'edits are normalized');
    assert.match(path.basename(items[2].exportPath), /^card\.apply-.+\.edited\.html$/);
    assert.strictEqual(fs.readFileSync(items[2].exportPath, 'utf8'), '<html>A</html>');
    assert.strictEqual(items[3].exportPath, path.join(dir, 'card.edited.html'));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(items[3].editsPath, 'utf8')).viewport, { preset: 'mobile', width: 393, height: 852 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('exportErrorResponse maps snapshot failures to HTTP answers', () => {
  assert.deepStrictEqual(routes.exportErrorResponse({ code: 'EUI_HTML_TOO_LARGE' }), { status: 413, error: 'html snapshot too large' });
  assert.deepStrictEqual(routes.exportErrorResponse({ code: 'EUI_HTML_MISSING' }), { status: 400, error: 'edits and finish items need an html snapshot' });
  assert.deepStrictEqual(routes.exportErrorResponse(new Error('EACCES')), { status: 500, error: 'could not write the export next to the artifact: EACCES' });
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
