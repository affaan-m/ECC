'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const capsule = require('../../../scripts/lib/eval-harness/capsule');
const { canonicalJson } = require('../../../scripts/lib/eval-harness/canonical');
const { test, tempDir, cleanup, finish, fixedClock } = require('./helpers');

function fixture(run) {
  const root = tempDir('consistent-export');
  const source = path.join(root, 'source');
  const target = path.join(root, 'bundle');
  const handle = capsule.Capsule.create(source, {
    run_id: 'run-export', capsule_id: 'capsule-export',
    harness_version: 'test/1', task_family: 'export', clock: fixedClock,
  });
  try { run({ root, source, target, handle }); } finally { cleanup(root); }
}

function assertConsistent(target) {
  const state = capsule.readCapsule(target);
  assert.ok(state.ok, state.reason);
  assert.strictEqual(fs.readFileSync(path.join(target, capsule.PROJECTION_FILE), 'utf8'),
    canonicalJson(state.projection) + '\n');
  return state;
}

test('append and export contenders fail busy while a snapshot is copied, then can retry', () => {
  fixture(({ root, source, target, handle }) => {
    handle.append('plan', 'before', {});
    const copyFile = fs.copyFileSync;
    const contenders = [];
    fs.copyFileSync = function (from, ...args) {
      if (from === path.join(source, capsule.JOURNAL_FILE)) {
        for (const operation of [
          "c.Capsule.open(process.argv[2]).append('attempt', 'contender', {})",
          'c.exportBundle(process.argv[2], process.argv[3])',
        ]) {
          contenders.push(spawnSync(process.execPath, ['-e', `
            const c = require(process.argv[1]);
            try { ${operation}; console.log(JSON.stringify({ ok: true })); }
            catch (error) { console.log(JSON.stringify({ code: error.code })); }
          `, require.resolve('../../../scripts/lib/eval-harness/capsule'), source,
          path.join(root, 'contender')], { encoding: 'utf8', timeout: 5000 }));
        }
      }
      return copyFile.call(this, from, ...args);
    };
    try { capsule.exportBundle(source, target); } finally { fs.copyFileSync = copyFile; }
    assert.strictEqual(contenders.length, 2);
    for (const result of contenders) {
      assert.ifError(result.error);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.deepStrictEqual(JSON.parse(result.stdout), { code: 'capsule.busy' });
    }
    assert.strictEqual(assertConsistent(target).entries.length, 1);
    assert.strictEqual(capsule.verify(source).entry_count, 1);
    assert.ok(!fs.existsSync(path.join(source, '.append.lock')));
    handle.append('attempt', 'after', {});
    assert.strictEqual(capsule.verify(source).entry_count, 2);
    assert.strictEqual(assertConsistent(target).entries.length, 1);
    capsule.exportBundle(source, path.join(root, 'retry'));
    assert.strictEqual(assertConsistent(path.join(root, 'retry')).entries.length, 2);
  });
});

test('export refuses an existing append lock without changing source or output files', () => {
  fixture(({ source, target, handle }) => {
    handle.append('plan', 'before', {});
    const original = fs.readFileSync(path.join(source, capsule.JOURNAL_FILE));
    const lock = path.join(source, '.append.lock');
    fs.writeFileSync(lock, 'another owner');
    fs.utimesSync(lock, new Date(0), new Date(0));
    assert.throws(() => capsule.exportBundle(source, target), error => error.code === 'capsule.busy');
    assert.strictEqual(fs.readFileSync(lock, 'utf8'), 'another owner');
    assert.deepStrictEqual(fs.readFileSync(path.join(source, capsule.JOURNAL_FILE)), original);
    assert.ok(!fs.existsSync(target));
    assert.ok(!fs.existsSync(path.join(source, capsule.PROJECTION_FILE)));
  });
});

test('the bundle projection comes from its journal even if the source cache is overwritten', () => {
  fixture(({ source, target, handle }) => {
    capsule.writeProjection(source);
    const stale = fs.readFileSync(path.join(source, capsule.PROJECTION_FILE));
    handle.append('plan', 'after-old-snapshot', {});
    const copyFile = fs.copyFileSync;
    fs.copyFileSync = function (from, ...args) {
      const result = copyFile.call(this, from, ...args);
      if (from === path.join(source, capsule.JOURNAL_FILE)) {
        // A projection writer may have read the old journal before export began.
        fs.writeFileSync(path.join(source, capsule.PROJECTION_FILE), stale);
      }
      return result;
    };
    try { capsule.exportBundle(source, target); } finally { fs.copyFileSync = copyFile; }
    assert.strictEqual(assertConsistent(target).entries.length, 1);
  });
});

test('quiescent empty and populated bundles preserve bytes, source projection and minimal files', () => {
  for (const count of [0, 5]) {
    fixture(({ source, target, handle }) => {
      for (let i = 0; i < count; i += 1) handle.append('attempt', 'run', { passed: i, total: 5 });
      fs.writeFileSync(path.join(source, 'workspace-secret.txt'), 'not a capsule artifact');
      const expected = canonicalJson(capsule.project(source)) + '\n';
      for (let i = 0; i < 2; i += 1) {
        const result = capsule.exportBundle(source, target);
        assert.deepStrictEqual(result, {
          dir: target, files: [capsule.META_FILE, capsule.JOURNAL_FILE, capsule.PROJECTION_FILE],
        });
        assert.deepStrictEqual(fs.readdirSync(target).sort(), result.files.slice().sort());
        for (const name of result.files) {
          assert.deepStrictEqual(fs.readFileSync(path.join(target, name)), fs.readFileSync(path.join(source, name)));
        }
        assert.strictEqual(fs.readFileSync(path.join(source, capsule.PROJECTION_FILE), 'utf8'), expected);
        assert.strictEqual(assertConsistent(target).entries.length, count);
      }
    });
  }
});

test('copy errors release the source lock and preserve the journal for subsequent appends', () => {
  fixture(({ source, target, handle }) => {
    handle.append('plan', 'before', {});
    const original = fs.readFileSync(path.join(source, capsule.JOURNAL_FILE));
    const copyFile = fs.copyFileSync;
    const failure = Object.assign(new Error('copy failed'), { code: 'EIO' });
    fs.copyFileSync = function (from, ...args) {
      if (from === path.join(source, capsule.JOURNAL_FILE)) throw failure;
      return copyFile.call(this, from, ...args);
    };
    try { assert.throws(() => capsule.exportBundle(source, target), error => error === failure); }
    finally { fs.copyFileSync = copyFile; }
    assert.ok(!fs.existsSync(path.join(source, '.append.lock')));
    assert.deepStrictEqual(fs.readFileSync(path.join(source, capsule.JOURNAL_FILE)), original);
    handle.append('attempt', 'after-copy-failure', {});
    assert.strictEqual(capsule.verify(source).entry_count, 2);
  });
});

test('invalid source journals remain invalid and release the export lock without repair', () => {
  fixture(({ source, target, handle }) => {
    handle.append('plan', 'before', {});
    const journal = path.join(source, capsule.JOURNAL_FILE);
    const valid = fs.readFileSync(journal);
    const broken = Buffer.concat([valid, Buffer.from('{')]);
    fs.writeFileSync(journal, broken);
    assert.throws(() => capsule.exportBundle(source, target), error => error.code === 'capsule.truncated_tail');
    assert.ok(!fs.existsSync(path.join(source, '.append.lock')));
    assert.deepStrictEqual(fs.readFileSync(journal), broken);
    assert.ok(!fs.existsSync(path.join(target, capsule.JOURNAL_FILE)));
    fs.writeFileSync(journal, valid);
    handle.append('attempt', 'after-recovery', {});
    assert.strictEqual(capsule.verify(source).entry_count, 2);
  });
});

finish('Capsule export');
