'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { getSessionStats } = require('../../scripts/lib/session-manager');

const repoRoot = path.resolve(__dirname, '../..');
const emptyStats = { totalItems: 0, completedItems: 0, inProgressItems: 0, lineCount: 0, hasNotes: false, hasContext: false };

function fixture(t, body = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-lines-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'data');
  const directory = path.join(home, 'session-data');
  fs.mkdirSync(directory, { recursive: true });
  const filename = '2026-11-24-lines-session.tmp';
  const sessionPath = path.join(directory, filename);
  fs.writeFileSync(sessionPath, body);
  return { root, home, filename, sessionPath };
}

function boundedChild(f, args) {
  const child = spawnSync(process.execPath, ['--max-old-space-size=64', ...args], {
    cwd: f.root, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
    env: { ...process.env, ECC_AGENT_DATA_HOME: f.home, ECC_SESSION_RECORDING_DIR: path.join(f.root, 'recordings') }
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, `child signal=${child.signal}: ${child.stderr}`);
  return JSON.parse(child.stdout);
}

test('line counts preserve empty, trailing, repeated and non-LF separator semantics', () => {
  for (const content of ['', 'one', '\n', '\n\n', 'one\n', '\none', 'one\ntwo', 'one\r\ntwo\r\n',
    'one\rtwo', 'one\u2028two\u2029three', '猫\n狗', '\u{1f600}\n\u{1f600}\n', '\0\n\0']) {
    assert.deepEqual(getSessionStats(content), { ...emptyStats, lineCount: content ? content.split('\n').length : 0 });
  }
});

test('mixed seeded text has the same line count as the existing public contract', () => {
  let state = 19790418;
  const parts = ['text', '\n', '\r\n', '\r', '猫', '\u2028', '\0'];
  for (let sample = 0; sample < 200; sample++) {
    let content = '';
    for (let index = 0; index < sample; index++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      content += parts[state % parts.length];
    }
    assert.equal(getSessionStats(content).lineCount, content ? content.split('\n').length : 0);
  }
});

test('file-path and already-read content statistics remain identical', t => {
  const content = '# Session\r\n\r\n### Completed\r\n- [x] done\r\n### In Progress\r\n- [ ] next\r\n';
  const f = fixture(t, content);
  assert.deepEqual(getSessionStats(f.sessionPath), getSessionStats(content));
  assert.equal(getSessionStats(f.sessionPath).lineCount, 7);
});

test('null, empty and unavailable content retains zero statistics', t => {
  const f = fixture(t);
  for (const value of [null, undefined, '', f.sessionPath, path.join(f.root, 'absent.tmp')]) {
    assert.deepEqual(getSessionStats(value), emptyStats);
  }
});

test('counting lines preserves all item, note and context statistics', () => {
  const content = '# Session\n\n### Completed\n- [x] first\n- [x] second\n### In Progress\n- [ ] third\n'
    + '### Notes for Next Session\nCheck the result.\n### Context to Load\n```\nsrc/index.js\n```\n';
  assert.deepEqual(getSessionStats(content), {
    totalItems: 3, completedItems: 2, inProgressItems: 1, lineCount: 14, hasNotes: true, hasContext: true
  });
});

test('statistics for a short-line history fit in a bounded child heap', t => {
  const f = fixture(t, 'log\n'.repeat(4_000_000));
  const script = `const { getSessionStats } = require(${JSON.stringify(path.join(repoRoot, 'scripts/lib/session-manager'))});
process.stdout.write(JSON.stringify(getSessionStats(process.argv[1])));`;
  assert.deepEqual(boundedChild(f, ['-e', script, f.sessionPath]), { ...emptyStats, lineCount: 4_000_001 });
});

for (const target of ['history ID', 'direct file']) {
  test(`public session inspection handles short-line history by ${target} in a bounded heap`, t => {
    const f = fixture(t, '# Large session\n' + 'log\n'.repeat(4_000_000));
    const argument = target === 'history ID' ? 'claude:lines' : f.sessionPath;
    const snapshot = boundedChild(f, [path.join(repoRoot, 'scripts/session-inspect.js'), argument]);
    assert.equal(snapshot.adapterId, 'claude-history');
    assert.equal(snapshot.workers.length, 1);
    assert.equal(snapshot.workers[0].id, 'lines');
    assert.equal(snapshot.workers[0].label, 'Large session');
    assert.deepEqual(snapshot.workers[0].outputs, { summary: [], validation: [], remainingRisks: [] });
    assert.equal(snapshot.workers[0].artifacts.sessionFile, f.sessionPath);
  });
}

test('the same content size without many line breaks is a bounded-heap control', t => {
  const f = fixture(t, '# Large session\n' + 'x'.repeat(16_000_000));
  const snapshot = boundedChild(f, [path.join(repoRoot, 'scripts/session-inspect.js'), 'claude:lines']);
  assert.equal(snapshot.workers[0].label, 'Large session');
});
