/**
 * Tests for scripts/lib/eval-harness/capsule.js
 * Run with: node tests/lib/eval-harness/capsule.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const capsule = require('../../../scripts/lib/eval-harness/capsule');
const envelope = require('../../../scripts/lib/eval-harness/envelope');
const { canonicalJson } = require('../../../scripts/lib/eval-harness/canonical');
const { test, tempDir, cleanup, finish, fixedClock } = require('./helpers');

const awsCanary = 'AKIA' + 'A'.repeat(16);

function seeded(dir) {
  const c = capsule.Capsule.create(dir, { run_id: 'run-1', capsule_id: 'cap-1', harness_version: 't/1', task_family: 'f', clock: fixedClock });
  c.append('plan', 'start', { task_id: 'a' });
  c.append('attempt', 'run', { status: 'pass', passed: 3, total: 3 }, { effect_class: 'SE2' });
  c.append('interaction', 'tool.call', { tool: 'read', status: 'replayed' });
  c.append('environment', 'sandbox', { digest: 'abc' });
  c.append('strategy', 'verdict', { verdict: 'PROMOTE' });
  return c;
}

test('append links every entry to its predecessor and verify passes', () => {
  const dir = tempDir('append');
  try {
    const c = seeded(dir);
    const entries = c.entries();
    assert.strictEqual(entries.length, 5);
    assert.strictEqual(entries[0].parent_hash, '0'.repeat(64));
    for (let i = 1; i < entries.length; i += 1) {
      assert.strictEqual(entries[i].parent_hash, entries[i - 1].entry_hash);
      assert.strictEqual(entries[i].seq, i);
    }
    const result = capsule.verify(dir);
    assert.ok(result.ok, result.reason);
    assert.strictEqual(result.entry_count, 5);
    assert.strictEqual(result.root_hash, entries[4].entry_hash);
  } finally {
    cleanup(dir);
  }
});

test('append refuses non-allowlisted keys and secret canaries without advancing the journal', () => {
  const dir = tempDir('refuse');
  try {
    const c = seeded(dir);
    assert.throws(() => c.append('plan', 'x', { reasoning: 'hidden' }), /capsule.payload_denied|not allowlisted/);
    assert.throws(() => c.append('plan', 'x', { message: awsCanary }), /canary/);
    assert.throws(() => c.append('feelings', 'x', {}), /lineage/);
    assert.strictEqual(capsule.verify(dir).entry_count, 5);
  } finally {
    cleanup(dir);
  }
});

test('tamper with one historical byte fails at the exact entry', () => {
  const dir = tempDir('tamper');
  try {
    seeded(dir);
    const journal = path.join(dir, capsule.JOURNAL_FILE);
    const lines = fs.readFileSync(journal, 'utf8').split('\n');
    lines[1] = lines[1].replace('"passed":3', '"passed":2');
    fs.writeFileSync(journal, lines.join('\n'));
    const result = capsule.verify(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failed_at, 1);
    assert.strictEqual(result.code, 'capsule.invalid_entry');
  } finally {
    cleanup(dir);
  }
});

test('truncation and a partial trailing write fail closed', () => {
  const dir = tempDir('truncate');
  try {
    seeded(dir);
    const journal = path.join(dir, capsule.JOURNAL_FILE);
    const original = fs.readFileSync(journal, 'utf8');
    const lines = original.split('\n');
    // Drop the middle entry: the link from entry 3 to entry 1 breaks.
    fs.writeFileSync(journal, [lines[0], lines[1], lines[3], lines[4], ''].join('\n'));
    let result = capsule.verify(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failed_at, 2);
    assert.strictEqual(result.code, 'capsule.reordered');
    // Crash mid-append: the last line has no newline.
    fs.writeFileSync(journal, original + '{"schema":"capsule-envelope/v1","seq":5');
    result = capsule.verify(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'capsule.truncated_tail');
    assert.strictEqual(result.failed_at, 5);
    // Recovery: the complete prefix is still readable through readJournal.
    fs.writeFileSync(journal, original);
    assert.ok(capsule.verify(dir).ok);
  } finally {
    cleanup(dir);
  }
});

test('reordering two entries fails closed', () => {
  const dir = tempDir('reorder');
  try {
    seeded(dir);
    const journal = path.join(dir, capsule.JOURNAL_FILE);
    const lines = fs.readFileSync(journal, 'utf8').split('\n');
    [lines[2], lines[3]] = [lines[3], lines[2]];
    fs.writeFileSync(journal, lines.join('\n'));
    const result = capsule.verify(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failed_at, 2);
  } finally {
    cleanup(dir);
  }
});

test('open resumes the chain and projection is byte-for-byte stable', () => {
  const dir = tempDir('project');
  try {
    seeded(dir);
    const reopened = capsule.Capsule.open(dir, { clock: fixedClock });
    reopened.append('attempt', 'run', { status: 'pass' });
    assert.ok(capsule.verify(dir).ok);
    const first = JSON.stringify(capsule.writeProjection(dir));
    const second = JSON.stringify(capsule.writeProjection(dir));
    assert.strictEqual(first, second);
    const projection = JSON.parse(first);
    assert.deepStrictEqual(projection.by_lineage, { plan: 1, attempt: 2, interaction: 1, environment: 1, strategy: 1 });
    assert.strictEqual(projection.max_effect_class, 'SE2');
    assert.strictEqual(projection.entry_count, 6);
  } finally {
    cleanup(dir);
  }
});

test('exportBundle copies only the capsule files, never workspace contents', () => {
  const dir = tempDir('export');
  const out = tempDir('export-out');
  try {
    seeded(dir);
    fs.writeFileSync(path.join(dir, 'workspace-secret.txt'), 'do not copy');
    const bundle = capsule.exportBundle(dir, out);
    assert.deepStrictEqual(fs.readdirSync(out).sort(), ['capsule.json', 'journal.ndjson', 'projection.json']);
    assert.deepStrictEqual(bundle.files.sort(), ['capsule.json', 'journal.ndjson', 'projection.json']);
    assert.ok(capsule.verify(out).ok);
  } finally {
    cleanup(dir);
    cleanup(out);
  }
});


test('invalid creation metadata is rejected before making a directory', () => {
  const root = tempDir('metadata-create');
  try {
    for (const options of [{ run_id: '../bad' }, { capsule_id: null }, { harness_version: '' }, { task_family: 42 }]) {
      const dir = path.join(root, 'not-created');
      assert.throws(() => capsule.Capsule.create(dir, options), error => error.code === 'capsule.metadata_invalid');
      assert.ok(!fs.existsSync(dir));
    }
  } finally { cleanup(root); }
});

test('all metadata identity fields must match every journal entry', () => {
  const dir = tempDir('metadata-match');
  try {
    seeded(dir);
    const file = path.join(dir, capsule.META_FILE);
    const original = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const field of ['run_id', 'capsule_id', 'harness_version', 'task_family']) {
      fs.writeFileSync(file, JSON.stringify({ ...original, [field]: 'forged' }));
      assert.strictEqual(capsule.verify(dir).code, 'capsule.metadata_mismatch');
      assert.throws(() => capsule.Capsule.open(dir), error => error.code === 'capsule.metadata_mismatch');
      assert.throws(() => capsule.project(dir), error => error.code === 'capsule.metadata_mismatch');
    }
    fs.writeFileSync(file, JSON.stringify(original));
    // A valid hash chain can still contain an entry from a different identity.
    const journal = path.join(dir, capsule.JOURNAL_FILE);
    const lines = fs.readFileSync(journal, 'utf8').trim().split('\n');
    const envelope = require('../../../scripts/lib/eval-harness/envelope');
    const entries = lines.map(JSON.parse);
    for (let index = 1; index < entries.length; index += 1) {
      entries[index].run_id = 'another-run';
      entries[index].parent_hash = entries[index - 1].entry_hash;
      entries[index].entry_hash = envelope.computeEntryHash(entries[index]);
    }
    const { canonicalJson } = require('../../../scripts/lib/eval-harness/canonical');
    fs.writeFileSync(journal, entries.map(canonicalJson).join('\n') + '\n');
    assert.strictEqual(capsule.verify(dir).code, 'capsule.metadata_mismatch');
    assert.strictEqual(capsule.verify(dir).failed_at, 1);
  } finally { cleanup(dir); }
});

test('missing, corrupt and invalid metadata fail with named errors, including empty journals', () => {
  const dir = tempDir('metadata-invalid');
  try {
    capsule.Capsule.create(dir);
    const file = path.join(dir, capsule.META_FILE);
    const original = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const value of [null, [], {}, { ...original, schema: 'bad' }, { ...original, created_at: '2026-02-30T00:00:00.000Z' }]) {
      fs.writeFileSync(file, JSON.stringify(value));
      assert.strictEqual(capsule.verify(dir).code, 'capsule.metadata_invalid');
      assert.throws(() => capsule.Capsule.open(dir), error => error.code === 'capsule.metadata_invalid');
    }
    fs.writeFileSync(file, '{broken');
    assert.strictEqual(capsule.verify(dir).code, 'capsule.metadata_invalid');
    fs.unlinkSync(file);
    assert.strictEqual(capsule.verify(dir).code, 'capsule.metadata_invalid');
    fs.writeFileSync(file, JSON.stringify(original));
    assert.ok(capsule.verify(dir).ok);
  } finally { cleanup(dir); }
});


const appendLock = dir => path.join(dir, '.append.lock');

test('preopened handles reload sequence and parent hash before every append', () => {
  const dir = tempDir('preopened');
  try {
    const first = capsule.Capsule.create(dir);
    const second = capsule.Capsule.open(dir);
    const a = first.append('plan', 'first', {});
    const b = second.append('attempt', 'second', {});
    const c = first.append('strategy', 'third', {});
    assert.deepStrictEqual([a.seq, b.seq, c.seq], [0, 1, 2]);
    assert.strictEqual(b.parent_hash, a.entry_hash);
    assert.strictEqual(c.parent_hash, b.entry_hash);
    assert.ok(capsule.verify(dir).ok);
    assert.ok(!fs.existsSync(appendLock(dir)));
  } finally { cleanup(dir); }
});

test('a child contending during a real append fails busy immediately without writing', () => {
  const dir = tempDir('child-contention');
  try {
    capsule.Capsule.create(dir);
    let child;
    const modulePath = path.resolve(__dirname, '../../../scripts/lib/eval-harness/capsule.js');
    const script = `const c=require(${JSON.stringify(modulePath)}).Capsule.open(${JSON.stringify(dir)});try{c.append('attempt','contender',{});console.log(JSON.stringify({ok:true}));}catch(e){console.log(JSON.stringify({code:e.code}));}`;
    const owner = capsule.Capsule.open(dir, { clock: () => {
      child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 2000 });
      return fixedClock();
    } });
    owner.append('plan', 'owner', {});
    assert.strictEqual(child.status, 0, child.error?.message || child.stderr);
    assert.deepStrictEqual(JSON.parse(child.stdout), { code: 'capsule.busy' });
    assert.strictEqual(capsule.verify(dir).entry_count, 1);
    assert.ok(capsule.verify(dir).ok);
    assert.ok(!fs.existsSync(appendLock(dir)));
    capsule.Capsule.open(dir).append('attempt', 'later', {});
    assert.strictEqual(capsule.verify(dir).entry_count, 2);
  } finally { cleanup(dir); }
});

test('an existing old lock is never guessed stale or removed by a contender', () => {
  const dir = tempDir('old-lock');
  try {
    const c = capsule.Capsule.create(dir);
    fs.writeFileSync(appendLock(dir), 'owned elsewhere');
    fs.utimesSync(appendLock(dir), new Date(0), new Date(0));
    assert.throws(() => c.append('plan', 'blocked', {}), error => error.code === 'capsule.busy');
    assert.strictEqual(fs.readFileSync(appendLock(dir), 'utf8'), 'owned elsewhere');
    assert.strictEqual(capsule.verify(dir).entry_count, 0);
  } finally { cleanup(dir); }
});

test('append revalidates disk metadata and broken tails, releasing its own lock on refusal', () => {
  const dir = tempDir('append-validation');
  try {
    const c = seeded(dir);
    const file = path.join(dir, capsule.META_FILE);
    const original = fs.readFileSync(file, 'utf8');
    const journal = path.join(dir, capsule.JOURNAL_FILE);
    const bytes = fs.readFileSync(journal);
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(original), run_id: 'forged' }));
    assert.throws(() => c.append('plan', 'invalid', {}), error => error.code === 'capsule.metadata_mismatch');
    assert.deepStrictEqual(fs.readFileSync(journal), bytes);
    assert.ok(!fs.existsSync(appendLock(dir)));
    fs.writeFileSync(file, original);
    fs.appendFileSync(journal, '{partial');
    assert.throws(() => c.append('plan', 'invalid', {}), error => error.code === 'capsule.truncated_tail');
    assert.ok(!fs.existsSync(appendLock(dir)));
  } finally { cleanup(dir); }
});

test('validation or clock exceptions release ownership so a later append can proceed', () => {
  const dir = tempDir('append-release');
  try {
    const c = capsule.Capsule.create(dir);
    assert.throws(() => c.append('plan', 'invalid', { unknown: 'field' }), error => error.code === 'capsule.payload_denied');
    assert.ok(!fs.existsSync(appendLock(dir)));
    const throwing = capsule.Capsule.open(dir, { clock: () => { throw new Error('clock fixture'); } });
    assert.throws(() => throwing.append('plan', 'invalid', {}), /clock fixture/);
    assert.ok(!fs.existsSync(appendLock(dir)));
    assert.strictEqual(c.append('plan', 'valid', {}).seq, 0);
    assert.ok(capsule.verify(dir).ok);
  } finally { cleanup(dir); }
});

test('short writes complete the entire UTF-8 journal entry before acknowledgement', () => {
  const dir = tempDir('short-write');
  const originalWrite = fs.writeSync;
  let chunks = 0;
  try {
    const c = capsule.Capsule.create(dir);
    fs.writeSync = (fd, data, offset, length, position) => {
      if (!Buffer.isBuffer(data)) return originalWrite(fd, data, offset, length);
      chunks += 1;
      return originalWrite(fd, data, offset, Math.min(length, 7), position);
    };
    c.append('plan', 'unicode', { message: 'snow \u2603' });
    assert.ok(chunks > 1);
    assert.ok(capsule.verify(dir).ok);
    assert.strictEqual(c.entries()[0].payload.message, 'snow \u2603');
    assert.ok(!fs.existsSync(appendLock(dir)));
  } finally { fs.writeSync = originalWrite; cleanup(dir); }
});

test('partial write failure leaves evidence and prevents later append from hiding the tail', () => {
  const dir = tempDir('partial-write');
  const originalWrite = fs.writeSync;
  let chunks = 0;
  try {
    const c = capsule.Capsule.create(dir);
    fs.writeSync = (fd, data, offset, length, position) => {
      if (!Buffer.isBuffer(data)) return originalWrite(fd, data, offset, length);
      if (chunks++ > 0) throw new Error('write fixture');
      return originalWrite(fd, data, offset, Math.min(length, 9), position);
    };
    assert.throws(() => c.append('plan', 'partial', {}), /write fixture/);
    fs.writeSync = originalWrite;
    const journal = path.join(dir, capsule.JOURNAL_FILE);
    const bytes = fs.readFileSync(journal);
    assert.ok(bytes.length > 0);
    assert.strictEqual(capsule.verify(dir).code, 'capsule.truncated_tail');
    assert.ok(!fs.existsSync(appendLock(dir)));
    assert.throws(() => c.append('plan', 'later', {}), error => error.code === 'capsule.truncated_tail');
    assert.deepStrictEqual(fs.readFileSync(journal), bytes);
  } finally { fs.writeSync = originalWrite; cleanup(dir); }
});


test('a zero-progress write fails and releases the lock without pretending success', () => {
  const dir = tempDir('zero-write');
  const originalWrite = fs.writeSync;
  try {
    const c = capsule.Capsule.create(dir);
    fs.writeSync = () => 0;
    assert.throws(() => c.append('plan', 'zero', {}), error => error.code === 'capsule.write_failed');
    fs.writeSync = originalWrite;
    assert.strictEqual(capsule.verify(dir).entry_count, 0);
    assert.ok(!fs.existsSync(appendLock(dir)));
    assert.strictEqual(c.append('plan', 'later', {}).seq, 0);
  } finally { fs.writeSync = originalWrite; cleanup(dir); }
});

test('fsync failure is an ambiguous acknowledgement and the next append reloads disk', () => {
  const dir = tempDir('fsync-failure');
  const originalSync = fs.fsyncSync;
  try {
    const c = capsule.Capsule.create(dir);
    fs.fsyncSync = () => { throw new Error('fsync fixture'); };
    assert.throws(() => c.append('plan', 'uncertain', {}), /fsync fixture/);
    fs.fsyncSync = originalSync;
    assert.ok(!fs.existsSync(appendLock(dir)));
    assert.strictEqual(capsule.verify(dir).entry_count, 1);
    assert.ok(capsule.verify(dir).ok);
    assert.strictEqual(c.append('attempt', 'next', {}).seq, 1);
    assert.strictEqual(capsule.verify(dir).entry_count, 2);
  } finally { fs.fsyncSync = originalSync; cleanup(dir); }
});

test('release preserves a detected replacement lock instead of deleting another owner', () => {
  const dir = tempDir('replaced-lock');
  try {
    capsule.Capsule.create(dir);
    const c = capsule.Capsule.open(dir, { clock: () => {
      fs.renameSync(appendLock(dir), path.join(dir, 'displaced-lock'));
      fs.writeFileSync(appendLock(dir), 'replacement owner');
      return fixedClock();
    } });
    assert.throws(() => c.append('plan', 'owner', {}), error => error.code === 'capsule.lock_lost');
    assert.strictEqual(fs.readFileSync(appendLock(dir), 'utf8'), 'replacement owner');
    // Release can fail after a complete write; never infer rollback from a throw.
    assert.strictEqual(capsule.verify(dir).entry_count, 1);
    assert.throws(() => capsule.Capsule.open(dir).append('plan', 'blocked', {}), error => error.code === 'capsule.busy');
  } finally { cleanup(dir); }
});

test('a lock removed externally is reported as lost after closing owned descriptors', () => {
  const dir = tempDir('missing-lock');
  try {
    capsule.Capsule.create(dir);
    const c = capsule.Capsule.open(dir, { clock: () => {
      fs.unlinkSync(appendLock(dir));
      return fixedClock();
    } });
    assert.throws(() => c.append('plan', 'owner', {}), error => error.code === 'capsule.lock_lost');
    assert.ok(!fs.existsSync(appendLock(dir)));
    assert.strictEqual(capsule.verify(dir).entry_count, 1);
  } finally { cleanup(dir); }
});

// Model the Windows pending-delete boundary without requiring a Windows host.
// The pathname can remain inaccessible until the owned descriptor closes.
for (const scenario of [
  { name: 'pending deletion is classified only after close confirms absence', outcome: 'missing' },
  { name: 'a present lock keeps the original permission error', outcome: 'present' },
  { name: 'persistent permission failure keeps the original error', outcome: 'denied' },
  { name: 'a replacement appearing on close is preserved', outcome: 'replacement' },
  { name: 'other permission errors do not trigger a second inspection', outcome: 'present', code: 'EACCES' },
  { name: 'a failed close is not retried or followed by pathname inspection', outcome: 'close-error' },
]) {
  test(`lock release: ${scenario.name}`, () => {
    const dir = tempDir('lock-close-boundary');
    const lock = appendLock(dir);
    const original = { open: fs.openSync, close: fs.closeSync, stat: fs.lstatSync, unlink: fs.unlinkSync };
    const permissionError = Object.assign(new Error('synthetic lock inspection denied'), { code: scenario.code || 'EPERM' });
    const closeError = Object.assign(new Error('synthetic ambiguous close failure'), { code: 'EIO' });
    let ownedFd;
    let closed = false;
    let closes = 0;
    let inspections = 0;
    let unlinks = 0;
    try {
      const c = capsule.Capsule.create(dir);
      fs.openSync = function(file, ...args) {
        const fd = original.open.call(this, file, ...args);
        if (file === lock && args[0] === 'wx') ownedFd = fd;
        return fd;
      };
      fs.lstatSync = function(file, ...args) {
        if (file === lock) {
          inspections += 1;
          if (!closed) throw permissionError;
          if (scenario.outcome === 'denied') throw Object.assign(new Error('still denied'), { code: 'EPERM' });
        }
        return original.stat.call(this, file, ...args);
      };
      fs.unlinkSync = function(file, ...args) {
        if (file === lock) unlinks += 1;
        return original.unlink.call(this, file, ...args);
      };
      fs.closeSync = function(fd) {
        const result = original.close.call(this, fd);
        if (fd === ownedFd && !closed) {
          closes += 1;
          closed = true;
          if (scenario.outcome === 'close-error') throw closeError;
          if (scenario.outcome === 'missing') original.unlink(lock);
          if (scenario.outcome === 'replacement') {
            fs.renameSync(lock, path.join(dir, 'displaced-lock'));
            fs.writeFileSync(lock, 'replacement owner');
          }
        }
        return result;
      };
      assert.throws(() => c.append('plan', 'owner', {}), error => {
        if (scenario.outcome === 'missing') return error.code === 'capsule.lock_lost';
        return error === (scenario.outcome === 'close-error' ? closeError : permissionError);
      });
      assert.strictEqual(closed, true, 'owned descriptor must close');
      assert.strictEqual(closes, 1, 'never retry an ambiguous close');
      assert.strictEqual(unlinks, 0, 'permission fallback must never unlink a pathname');
      if (scenario.code || scenario.outcome === 'close-error') assert.strictEqual(inspections, 1);
      fs.openSync = original.open;
      fs.closeSync = original.close;
      fs.lstatSync = original.stat;
      fs.unlinkSync = original.unlink;
      if (scenario.outcome === 'missing') assert.strictEqual(fs.existsSync(lock), false);
      else assert.strictEqual(fs.readFileSync(lock, 'utf8'), scenario.outcome === 'replacement' ? 'replacement owner' : '');
      // Release failure can follow a complete durable append; never infer rollback.
      assert.strictEqual(capsule.verify(dir).entry_count, 1);
      assert.strictEqual(capsule.verify(dir).ok, true);
    } finally {
      fs.openSync = original.open;
      fs.closeSync = original.close;
      fs.lstatSync = original.stat;
      fs.unlinkSync = original.unlink;
      cleanup(dir);
    }
  });
}

test('invalid payloads leave journal unchanged and release the append lock', () => {
  const dir = tempDir();
  try {
    const c = capsule.Capsule.create(dir);
    const cyclic = {}; cyclic.message = cyclic;
    const getter = Object.defineProperty({}, 'message', { enumerable: true, get() { throw new Error('must not execute'); } });
    const invalid = [null, [], 'invalid', 42, new Date(), { message: undefined }, { message: 42 },
      { score: Infinity }, { tokens_in: 0.5 }, { status: null }, { message: 1n },
      { message: Symbol('fixture') }, { message: () => 1 }, cyclic, getter];
    for (const payload of invalid) {
      const before = fs.readFileSync(path.join(dir, 'journal.ndjson'));
      assert.throws(() => c.append('plan', 'invalid', payload, { strict: false }), error => error instanceof capsule.CapsuleError && error.code === 'capsule.payload_invalid');
      assert.deepStrictEqual(fs.readFileSync(path.join(dir, 'journal.ndjson')), before);
      assert.strictEqual(fs.existsSync(appendLock(dir)), false);
    }
    assert.deepStrictEqual(c.append('plan', 'omitted').payload, {});
    assert.deepStrictEqual(c.append('attempt', 'valid', Object.assign(Object.create(null), { exit_code: null, score: -1.5 })).payload, { exit_code: null, score: -1.5 });
    assert.strictEqual(capsule.verify(dir).ok, true);
  } finally { cleanup(dir); }
});

test('strict false only drops unknown fields and custom allowlists cannot widen v1', () => {
  const dir = tempDir();
  try {
    const c = capsule.Capsule.create(dir);
    assert.deepStrictEqual(c.append('plan', 'drop', { status: 'ok', future: 'x' }, { strict: false }).payload, { status: 'ok' });
    assert.throws(() => c.append('plan', 'deny', { future: 'x' }, { allowlist: ['future'] }), error => error.code === 'capsule.payload_denied');
    assert.deepStrictEqual(c.append('plan', 'drop.custom', { future: 'x' }, { allowlist: ['future'], strict: false }).payload, {});
    assert.throws(() => c.append('plan', 'invalid', { status: 42 }, { allowlist: ['status'], strict: false }), error => error.code === 'capsule.payload_invalid');
    assert.strictEqual(capsule.verify(dir).ok, true);
  } finally { cleanup(dir); }
});

test('rehashed malformed journal entries fail at validation without healing', () => {
  for (const change of [entry => { entry.payload = { message: 42 }; }, entry => { entry.payload = { score: null }; }, entry => { entry.future_field = 'x'; }]) {
    const dir = tempDir();
    try {
      const c = capsule.Capsule.create(dir);
      const entry = c.append('plan', 'start', { status: 'ok' });
      change(entry);
      entry.entry_hash = envelope.computeEntryHash(entry);
      const bytes = canonicalJson(entry) + '\n';
      fs.writeFileSync(path.join(dir, 'journal.ndjson'), bytes);
      const result = capsule.verify(dir);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, 'capsule.invalid_entry');
      assert.strictEqual(result.failed_at, 0);
      assert.throws(() => c.append('plan', 'later'), error => error.code === 'capsule.invalid_entry');
      assert.strictEqual(fs.existsSync(appendLock(dir)), false);
      assert.strictEqual(fs.readFileSync(path.join(dir, 'journal.ndjson'), 'utf8'), bytes);
    } finally { cleanup(dir); }
  }
});

test('actual offline example persists refusal without absent optional hashes', () => {
  const tempRoot = tempDir('example-refusal');
  try {
    const repo = path.resolve(__dirname, '../../..');
    const result = spawnSync(process.execPath, ['scripts/eval-harness.js', 'example', '--keep'], {
      cwd: repo, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, TMPDIR: tempRoot, TMP: tempRoot, TEMP: tempRoot },
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes('SE4 tool is refused with tool.effect_forbidden'));
    const children = fs.readdirSync(tempRoot);
    assert.strictEqual(children.length, 1);
    const work = path.join(tempRoot, children[0]);
    const dir = path.join(work, 'capsule');
    const entries = capsule.Capsule.open(dir).entries();
    const refused = entries.filter(entry => entry.payload.status === 'refused');
    assert.strictEqual(refused.length, 1);
    assert.deepStrictEqual(refused[0].payload, { tool: 'place_order', status: 'refused' });
    const replayed = entries.find(entry => entry.payload.status === 'replayed');
    assert.ok(replayed);
    for (const key of ['fixture_key', 'args_hash', 'response_hash']) {
      assert.match(replayed.payload[key], /^[0-9a-f]{64}$/);
    }
    assert.strictEqual(capsule.verify(dir).ok, true);
    assert.strictEqual(fs.existsSync(path.join(work, 'gate-candidate')), false);
    const receipt = JSON.parse(fs.readFileSync(path.join(work, 'bundle', 'receipt.json'), 'utf8'));
    assert.strictEqual(receipt.gate_receipt_digest, null);
    assert.strictEqual(receipt.gate_verdict, null);
  } finally { cleanup(tempRoot); }
});

finish('capsule');
