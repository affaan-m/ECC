'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { renderMarkdown } = require('../../scripts/lib/plan-canvas/markdown');

const rendererPath = require.resolve('../../scripts/lib/plan-canvas/markdown');

function renderInChild(inputs) {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { renderMarkdown } = require(process.argv[1]);
    const inputs = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    for (const input of inputs) assert.equal(renderMarkdown(input), '<p>' + input + '</p>');
    console.log('completed');
  `, rendererPath], {
    input: JSON.stringify(inputs), encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'completed');
}

test('long incomplete link and image labels remain literal without repeated suffix scans', () => {
  renderInChild([
    '['.repeat(128000),
    '!['.repeat(64000),
    '['.repeat(128000) + ']not-a-link',
    '!['.repeat(64000) + ']not-an-image',
  ]);
});

test('repeated unterminated destinations remain literal within a bounded subprocess', () => {
  renderInChild(['[x]('.repeat(32000), '![x]('.repeat(25600)]);
});

test('existing link and image matching, escaping, URL rules and code spans are preserved', () => {
  const cases = [
    ['[[label](u)', '<a href="u">[label</a>'],
    ['[](/u)', '[](/u)'],
    ['![](x.png)', '<img src="x.png" alt="">'],
    ['[x]()', '<a href="">x</a>'],
    ['[x](a(b)c)', '<a href="a(b">x</a>c)'],
    ['[bad]x[good](u)', '[bad]x<a href="u">good</a>'],
    ['![a[b](x.png)', '<img src="x.png" alt="a[b">'],
    ['![a](javascript:bad)', 'a'],
    ['![a](//evil.example)', 'a'],
    ['[a](java\tscript:bad)', 'a'],
    ['[a](#here)', '<a href="#here">a</a>'],
    ['[a](mailto:a@b)', '<a href="mailto:a@b">a</a>'],
    ['[a]( /x )', '<a href="/x">a</a>'],
    ['[bad](x [good](u)', '<a href="x [good](u">bad</a>'],
    ['`[x](u)`', '<code>[x](u)</code>'],
    ['[**bold** `code`](https://example.com)',
      '<a href="https://example.com" target="_blank" rel="noopener"><strong>bold</strong> <code>code</code></a>'],
    ['[![a](x.png)](https://example.com)',
      '<a href="https://example.com" target="_blank" rel="noopener"><img src="x.png" alt="a"></a>'],
    ['[<b> & "](https://example.com)',
      '<a href="https://example.com" target="_blank" rel="noopener">&lt;b&gt; &amp; &quot;</a>'],
  ];
  for (const [input, expected] of cases) assert.equal(renderMarkdown(input), '<p>' + expected + '</p>', input);
});

test('large valid labels still render from the first matching opener', () => {
  const prefix = '['.repeat(128000);
  assert.equal(renderMarkdown(prefix + 'label](./x)'), '<p><a href="./x">' + prefix.slice(1) + 'label</a></p>');
  assert.equal(renderMarkdown('!' + prefix + 'alt](x.png)'), '<p><img src="x.png" alt="' + prefix.slice(1) + 'alt"></p>');
});

test('the real artifact HTTP route serves a large unfinished link without blocking the server', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-plan-links-'));
  try {
    const file = path.join(home, 'unfinished.plan.md');
    fs.writeFileSync(file, '['.repeat(128000));
    const result = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const { createSessionStore } = require(process.argv[1]);
      const { createPlanCanvasServer } = require(process.argv[2]);
      (async () => {
        const store = createSessionStore({ stateDir: process.argv[3] });
        const { session } = store.open(process.argv[4]);
        const canvas = createPlanCanvasServer({ store, idleTimeoutMs: 0 });
        await canvas.listen(0);
        try {
          const response = await fetch('http://127.0.0.1:' + canvas.server.address().port + '/artifact/' + session.key + '/');
          assert.equal(response.status, 200);
          assert.ok((await response.text()).includes('<p>' + '['.repeat(128000) + '</p>'));
          console.log('served');
        } finally { await canvas.close(); }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `, require.resolve('../../scripts/lib/plan-canvas/sessions'),
    require.resolve('../../scripts/lib/plan-canvas/server'), path.join(home, 'state'), file], {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'served');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
