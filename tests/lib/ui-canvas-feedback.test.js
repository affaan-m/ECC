/**
 * Unit tests for the UI Canvas feedback schema (scripts/lib/ui-canvas/feedback.js).
 *
 * Run with: node tests/lib/ui-canvas-feedback.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const feedback = require('../../scripts/lib/ui-canvas/feedback');

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

console.log('ui-canvas feedback');

test('normalizeEdit accepts every supported kind and clamps fields', () => {
  const text = feedback.normalizeEdit({ kind: 'text', selector: '#t', tag: 'h1', snippet: 'x'.repeat(500), before: 'Old', after: 'New', htmlAfter: '<b>New</b>' }, 0);
  assert.strictEqual(text.kind, 'text');
  assert.strictEqual(text.snippet.length, 200);
  assert.strictEqual(text.htmlAfter, '<b>New</b>');
  assert.strictEqual(text.id, 'edit-1');

  const resize = feedback.normalizeEdit({ kind: 'resize', selector: 'img.art', width: '220.4', height: 180, before: { width: 260, height: 260 } }, 3);
  assert.deepStrictEqual([resize.width, resize.height, resize.before], [220, 180, { width: 260, height: 260 }]);

  const move = feedback.normalizeEdit({ kind: 'move', selector: 'button', from: { parent: 'div.a', index: 2 }, to: { parent: 'div.b', index: 0 } }, 0);
  assert.deepStrictEqual(move.to, { parent: 'div.b', index: 0 });

  const nudge = feedback.normalizeEdit({ kind: 'nudge', selector: 'p', dx: -4, dy: 10.6 }, 0);
  assert.deepStrictEqual([nudge.dx, nudge.dy], [-4, 10.6]);

  const remove = feedback.normalizeEdit({ kind: 'remove', selector: 'button.secondary', outerHTML: '<button>x</button>', from: { parent: 'div.actions', index: 1 } }, 0);
  assert.strictEqual(remove.outerHTML, '<button>x</button>');
  assert.strictEqual(remove.from.index, 1);

  const style = feedback.normalizeEdit({ kind: 'style', selector: '#card', property: 'border', before: '2px solid rgb(1, 2, 3)', after: null, stale: true }, 0);
  assert.strictEqual(style.after, null);
  assert.strictEqual(style.stale, true);
});

test('normalizeEdit rejects unknown kinds, bad selectors, and bad properties', () => {
  assert.strictEqual(feedback.normalizeEdit({ kind: 'bogus', selector: 'x' }, 0), null);
  assert.strictEqual(feedback.normalizeEdit({ kind: 'text', selector: '' }, 0), null);
  assert.strictEqual(feedback.normalizeEdit({ kind: 'style', selector: 'x', property: 'Background;drop' }, 0), null);
  assert.strictEqual(feedback.normalizeEdit({ kind: 'resize', selector: 'x' }, 0), null);
  assert.strictEqual(feedback.normalizeEdit({ kind: 'move', selector: 'x', from: { index: 0 } }, 0), null);
  assert.strictEqual(feedback.normalizeEdit(null, 0), null);
});

test('normalizeEdits caps the batch and drops unusable records', () => {
  const raw = Array.from({ length: feedback.MAX_EDITS + 20 }, (_, i) => ({ kind: i % 2 ? 'nudge' : 'bogus', selector: 'p', dx: 1, dy: 1 }));
  const edits = feedback.normalizeEdits(raw);
  assert.ok(edits.length <= feedback.MAX_EDITS);
  assert.ok(edits.every(edit => edit.kind === 'nudge'));
});

test('summarizeEdit renders a readable, markup-free line per kind', () => {
  const lines = [
    feedback.summarizeEdit({ kind: 'text', selector: 'h1', tag: 'h1', snippet: 'Team plan', before: 'Team plan', after: 'Team plan+' }),
    feedback.summarizeEdit({ kind: 'resize', selector: 'img.art', tag: 'img', width: 220, height: 220, before: { width: 260, height: 260 } }),
    feedback.summarizeEdit({ kind: 'move', selector: 'button', from: { parent: 'div.a', index: 1 }, to: { parent: 'div.b', index: 0 } }),
    feedback.summarizeEdit({ kind: 'nudge', selector: 'p', dx: 3, dy: -2 }),
    feedback.summarizeEdit({ kind: 'remove', selector: 'button.secondary', tag: 'button', stale: true }),
    feedback.summarizeEdit({ kind: 'style', selector: '#card', property: 'border', before: '2px solid', after: null }),
    feedback.summarizeEdit({ kind: 'style', selector: '#card', property: 'background-color', before: 'white', after: '#333' })
  ];
  assert.match(lines[0], /text of h1 <h1> "Team plan": "Team plan" → "Team plan\+"/);
  assert.match(lines[1], /resized img\.art <img> to 220px wide, 220px tall \(was 260×260\)/);
  assert.match(lines[2], /moved button from div\.a\[1\] to div\.b\[0\]/);
  assert.match(lines[3], /nudged p by 3px, -2px/);
  assert.match(lines[4], /removed button\.secondary <button> \(could not be re-applied/);
  assert.match(lines[5], /removed border from #card \(was 2px solid\)/);
  assert.match(lines[6], /set background-color on #card to #333/);
  assert.strictEqual(feedback.summarizeEdit(null), '');
  assert.ok(lines.every(line => !line.includes('<div')));
});

test('normalizeUiFeedbackItem: chat needs text, keeps anchor and edit summaries', () => {
  assert.strictEqual(feedback.normalizeUiFeedbackItem({ kind: 'chat', text: '  ' }, 1), null);
  assert.strictEqual(feedback.normalizeUiFeedbackItem({ kind: 'verdict', verdict: 'approve' }, 1), null);
  const item = feedback.normalizeUiFeedbackItem({
    kind: 'chat',
    text: 'make it gray',
    anchor: { selector: '#card', tag: 'article', snippet: 'Team plan', size: { width: 720.4, height: 361 } },
    pendingEdits: ['resized img', { kind: 'remove', selector: 'button.x', tag: 'button' }, 42]
  }, 7);
  assert.strictEqual(item.id, 'fb-7');
  assert.deepStrictEqual(item.anchor, { selector: '#card', tag: 'article', snippet: 'Team plan', size: { width: 720, height: 361 } });
  assert.deepStrictEqual(item.pendingEdits, ['resized img', 'removed button.x <button>']);
  const bare = feedback.normalizeUiFeedbackItem({ kind: 'chat', text: 'hi', anchor: { selector: 7 } }, 8);
  assert.strictEqual(bare.anchor, undefined);
});

test('normalizeUiFeedbackItem: edits and finish normalize edits, viewport, and export paths', () => {
  const item = feedback.normalizeUiFeedbackItem({
    kind: 'finish',
    text: 'ship it',
    edits: [{ kind: 'resize', selector: 'img', width: 100 }, { kind: 'nope', selector: 'x' }],
    viewport: { preset: 'tablet', width: 'wide', height: 900 },
    exportPath: '/tmp/a.edited.html',
    editsPath: '/tmp/a.edits.json',
    html: '<html></html>'
  }, 2);
  assert.strictEqual(item.kind, 'finish');
  assert.strictEqual(item.editCount, 1);
  assert.deepStrictEqual(item.viewport, { preset: 'custom', width: feedback.VIEWPORT_PRESETS.custom.width, height: 900 });
  assert.strictEqual(item.exportPath, '/tmp/a.edited.html');
  assert.strictEqual(item.html, undefined, 'html never rides along with the queued item');
  const applied = feedback.normalizeUiFeedbackItem({ kind: 'edits', edits: 'not-an-array' }, 3);
  assert.strictEqual(applied.editCount, 0);
  assert.strictEqual(applied.viewport, undefined);
});

test('normalizeViewport honours presets and falls back per dimension', () => {
  assert.deepStrictEqual(feedback.normalizeViewport({ preset: 'mobile' }), { preset: 'mobile', width: 393, height: 852 });
  assert.deepStrictEqual(feedback.normalizeViewport({ preset: 'custom', width: 1024, height: 0 }), { preset: 'custom', width: 1024, height: 800 });
  assert.strictEqual(feedback.normalizeViewport('mobile'), null);
});

test('uiChatLineFor describes each kind for the transcript', () => {
  assert.strictEqual(feedback.uiChatLineFor({ kind: 'finish', editCount: 1 }), 'Saved and finished with 1 edit');
  assert.strictEqual(feedback.uiChatLineFor({ kind: 'finish', editCount: 3, text: 'ship' }), 'Saved and finished with 3 edits: ship');
  assert.strictEqual(feedback.uiChatLineFor({ kind: 'edits', editCount: 0 }), 'Applied 0 edits to the preview');
  assert.strictEqual(feedback.uiChatLineFor({ kind: 'chat', text: 'hi', anchor: { selector: '#a', snippet: 'Title' } }), '[Title] hi');
  assert.strictEqual(feedback.uiChatLineFor({ kind: 'chat', text: 'hi' }), 'hi');
});

test('exportPathsFor keeps the artifact extension and sits beside it', () => {
  const paths = feedback.exportPathsFor('/work/previews/card.html');
  assert.strictEqual(paths.exportPath, path.join('/work/previews', 'card.edited.html'));
  assert.strictEqual(paths.editsPath, path.join('/work/previews', 'card.edits.json'));
  assert.strictEqual(feedback.exportPathsFor('/work/card').exportPath, path.join('/work', 'card.edited.html'));
  const batch = feedback.exportPathsFor('/work/previews/card.html', 'mf3k2x-9a1c');
  assert.strictEqual(batch.exportPath, path.join('/work/previews', 'card.apply-mf3k2x-9a1c.edited.html'));
  assert.strictEqual(batch.editsPath, path.join('/work/previews', 'card.apply-mf3k2x-9a1c.edits.json'));
});

test('writeExport never follows a preexisting predictable staging symlink', () => {
  if (process.platform === 'win32') return;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-canvas-staging-link-'));
  try {
    const artifact = path.join(tempDir, 'card.html');
    const victim = path.join(tempDir, 'user.txt');
    fs.writeFileSync(victim, 'Preserve user bytes');
    const expected = feedback.exportPathsFor(artifact);
    const planted = `${expected.exportPath}.tmp-${process.pid}`;
    fs.symlinkSync(victim, planted);
    const result = feedback.writeExport(artifact, { html: '<html>edited</html>', kind: 'finish' });
    assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'Preserve user bytes');
    assert.strictEqual(fs.readFileSync(result.exportPath, 'utf8'), '<html>edited</html>');
    assert.ok(fs.lstatSync(planted).isSymbolicLink(), 'Leave a preexisting entry untouched');
    assert.strictEqual(fs.statSync(result.exportPath).mode & 0o777, 0o600);
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('writeExport cleans its own staging file when publication fails', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-canvas-staging-failure-'));
  try {
    const artifact = path.join(tempDir, 'card.html');
    const { exportPath } = feedback.exportPathsFor(artifact);
    fs.mkdirSync(exportPath);
    assert.throws(() => feedback.writeExport(artifact, { html: '<html>edited</html>', kind: 'finish' }));
    assert.deepStrictEqual(fs.readdirSync(tempDir), [path.basename(exportPath)]);
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('writeExport writes markup and edit log atomically and rejects bad snapshots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-feedback-'));
  try {
    const artifact = path.join(dir, 'card.html');
    fs.writeFileSync(artifact, '<html></html>');
    const written = feedback.writeExport(artifact, {
      html: '<!DOCTYPE html>\n<html><body>x</body></html>\n',
      edits: [{ kind: 'remove', selector: 'b' }],
      viewport: { preset: 'mobile', width: 393, height: 852 },
      kind: 'finish'
    });
    assert.strictEqual(fs.readFileSync(written.exportPath, 'utf8'), '<!DOCTYPE html>\n<html><body>x</body></html>\n');
    const log = JSON.parse(fs.readFileSync(written.editsPath, 'utf8'));
    assert.strictEqual(log.kind, 'finish');
    assert.strictEqual(log.artifact, artifact);
    assert.strictEqual(log.edits.length, 1);
    assert.deepStrictEqual(log.viewport, { preset: 'mobile', width: 393, height: 852 });
    assert.ok(!fs.readdirSync(dir).some(name => name.includes('.tmp-')), 'no temp files left behind');
    assert.throws(() => feedback.writeExport(artifact, { html: '' }), /code: 'EUI_HTML_MISSING'|html snapshot is required/);
    assert.throws(() => feedback.writeExport(artifact, { html: 'x'.repeat(feedback.MAX_HTML_BYTES + 1) }), /exceeds/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
