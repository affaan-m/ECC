'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const harness = require('../../../scripts/lib/eval-harness');
const { test, tempDir, cleanup, finish, fixedClock } = require('./helpers');

const root = tempDir('retrospective');
let next = 0;
function record(options = {}, events = [['plan', 'start', {}, 'SE0']]) {
  const id = `record-${next++}`;
  const dir = path.join(root, id);
  const capsule = harness.capsule.Capsule.create(dir, {
    run_id: id, capsule_id: id, task_family: 'fixture-family', harness_version: 'v1',
    clock: fixedClock, ...options,
  });
  for (const [lineage, kind, payload, effect_class] of events) capsule.append(lineage, kind, payload, { effect_class });
  return dir;
}
function group(dirs) { return harness.retrospective.groupCapsules(dirs); }
function rejects(dirs, code) { assert.throws(() => group(dirs), error => error.code === code); }

try {
  test('groups one task family by declared harness version without scoring payloads', () => {
    const a = record({}, [['plan', 'start', {}, 'SE0'], ['attempt', 'done', { score: 1, verdict: 'PROMOTE' }, 'SE2']]);
    const b = record();
    const c = record({ harness_version: 'v2' }, [['interaction', 'tool', { note: 'private payload marker' }, 'SE4']]);
    const result = group([c, a, b]);
    assert.strictEqual(result.schema, 'capsule-retrospective/v1');
    assert.strictEqual(result.report_only, true);
    assert.strictEqual(result.task_family, 'fixture-family');
    assert.strictEqual(result.capsule_count, 3);
    assert.strictEqual(result.input_count, 3);
    assert.strictEqual(result.duplicate_count, 0);
    assert.deepStrictEqual(result.groups.map(g => [g.harness_version, g.capsule_count, g.entry_count]), [['v1', 2, 3], ['v2', 1, 1]]);
    assert.deepStrictEqual(result.groups[0].by_lineage, { plan: 2, attempt: 1, interaction: 0, environment: 0, strategy: 0 });
    assert.deepStrictEqual(result.groups[0].by_effect_class, { SE0: 2, SE1: 0, SE2: 1, SE3: 0, SE4: 0 });
    assert.strictEqual(result.groups[1].by_effect_class.SE4, 1);
    const serialized = JSON.stringify(result);
    for (const marker of ['private payload marker', 'PROMOTE', root, 'score', 'verdict', 'payload']) assert.ok(!serialized.includes(marker), marker);
  });

  test('binds every counted snapshot to the existing verified projection digests', () => {
    const dir = record();
    const projection = harness.capsule.project(dir);
    const source = group([dir]).groups[0].sources[0];
    assert.deepStrictEqual(source, {
      identity_hash: harness.canonical.hashValue([projection.run_id, projection.capsule_id]),
      ...Object.fromEntries(['entry_count', 'root_hash', 'journal_sha256', 'projection_hash'].map(key => [key, projection[key]])),
    });
  });

  test('raw run and capsule labels are omitted from the report', () => {
    const dir = record({ run_id: 'private-run-label', capsule_id: 'private-capsule-label' });
    const serialized = JSON.stringify(group([dir]));
    assert.ok(!serialized.includes('private-run-label'));
    assert.ok(!serialized.includes('private-capsule-label'));
  });

  test('deduplicates repeated paths and copied snapshots by identity and projection', () => {
    const dir = record();
    const copy = path.join(root, 'duplicate');
    fs.cpSync(dir, copy, { recursive: true });
    const result = group([dir, copy, dir]);
    assert.strictEqual(result.input_count, 3);
    assert.strictEqual(result.capsule_count, 1);
    assert.strictEqual(result.duplicate_count, 2);
    assert.strictEqual(result.groups[0].entry_count, 1);
  });

  test('identity uses both run and capsule IDs for distinct evidence', () => {
    const result = group([
      record({ run_id: 'run-a', capsule_id: 'capsule-a' }),
      record({ run_id: 'run-a', capsule_id: 'capsule-b' }),
      record({ run_id: 'run-b', capsule_id: 'capsule-a' }),
    ]);
    assert.strictEqual(result.capsule_count, 3);
    assert.strictEqual(result.groups[0].sources.length, 3);
    assert.strictEqual(result.duplicate_count, 0);
  });

  test('output bytes and report hash are independent of input ordering', () => {
    const dirs = [record({ harness_version: 'z' }), record({ harness_version: 'a' }), record({ harness_version: 'a' })];
    const result = group([...dirs, dirs[0]]);
    assert.strictEqual(harness.canonical.canonicalJson(result), harness.canonical.canonicalJson(group([dirs[0], ...dirs.reverse()])));
    const { report_hash, ...body } = result;
    assert.strictEqual(report_hash, harness.canonical.hashValue(body));
  });

  test('empty journals count as snapshots with zero entries and no inferred outcome', () => {
    const result = group([record({}, [])]);
    assert.strictEqual(result.capsule_count, 1);
    assert.strictEqual(result.groups[0].entry_count, 0);
    assert.ok(Object.values(result.groups[0].by_lineage).every(n => n === 0));
    assert.strictEqual(result.groups[0].sources[0].root_hash, harness.envelope.GENESIS_HASH);
  });

  test('prototype-like version and family labels are ordinary data', () => {
    const result = group([record({ harness_version: '__proto__', task_family: 'constructor' }), record({ harness_version: 'constructor', task_family: 'constructor' })]);
    assert.strictEqual(result.task_family, 'constructor');
    assert.deepStrictEqual(result.groups.map(g => g.harness_version), ['__proto__', 'constructor']);
    assert.strictEqual(Object.getPrototypeOf(result), Object.prototype);
  });

  test('mixed task families fail instead of comparing incompatible records', () => {
    rejects([record(), record({ task_family: 'other-family' })], 'retrospective.mixed_task_families');
  });

  test('conflicting snapshots of the same capsule identity fail instead of selecting a winner', () => {
    const dir = record();
    const copy = path.join(root, 'conflict');
    fs.cpSync(dir, copy, { recursive: true });
    harness.capsule.Capsule.open(copy).append('attempt', 'later', {});
    rejects([dir, copy], 'retrospective.conflicting_identity');
    rejects([copy, dir], 'retrospective.conflicting_identity');
  });

  test('metadata-only conflicts in empty snapshots also fail', () => {
    const a = record({ run_id: 'same-run', capsule_id: 'same-capsule' }, []);
    const b = record({ run_id: 'same-run', capsule_id: 'same-capsule', harness_version: 'v2' }, []);
    rejects([a, b], 'retrospective.conflicting_identity');
  });

  test('tampered and truncated journals fail without a partial success report', () => {
    for (const corrupt of [bytes => bytes.replace('"start"', '"forged"'), bytes => bytes.slice(0, -1)]) {
      const dir = record();
      const journal = path.join(dir, 'journal.ndjson');
      fs.writeFileSync(journal, corrupt(fs.readFileSync(journal, 'utf8')));
      rejects([record(), dir], 'retrospective.invalid_capsule');
    }
  });

  test('metadata mismatch and missing sources fail with only input index diagnostics', () => {
    const dir = record();
    const file = path.join(dir, 'capsule.json');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file)), run_id: 'forged' }));
    for (const invalid of [dir, path.join(root, 'private missing marker')]) {
      assert.throws(() => group([invalid]), error => {
        assert.strictEqual(error.code, 'retrospective.invalid_capsule');
        assert.strictEqual(error.input_index, 0);
        assert.ok(!error.message.includes(root));
        assert.ok(!error.message.includes('private missing marker'));
        return true;
      });
    }
  });

  test('rejects invalid or excessive input lists before opening any capsule', () => {
    for (const value of [null, {}, 'dir', [], [null], [''], ['   '], ['x\0y'], Array(2), Array(101).fill('missing')]) {
      rejects(value, 'retrospective.invalid_inputs');
    }
  });

  test('accepts the bounded maximum of 100 inputs and deduplicates them', () => {
    const result = group(Array(100).fill(record()));
    assert.strictEqual(result.capsule_count, 1);
    assert.strictEqual(result.duplicate_count, 99);
  });

  test('does not mutate input lists or capsule files, and ignores stale projections', () => {
    const dir = record();
    fs.writeFileSync(path.join(dir, 'projection.json'), 'private stale projection marker');
    const before = fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]);
    const inputs = Object.freeze([dir]);
    const result = group(inputs);
    assert.strictEqual(result.capsule_count, 1);
    assert.deepStrictEqual(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]), before);
  });
} finally { cleanup(root); }

finish('retrospective');
