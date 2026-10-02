'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, tempDir, cleanup, finish } = require('./helpers');
const gate = require('../../../scripts/lib/eval-harness/gate');
const library = path.resolve(__dirname, '../../../scripts/lib/eval-harness');
const refused = error => error.code === 'gate.isolation_required';
const invalidVariant = error => error.code === 'gate.variant_invalid';

function setup(fn) {
  const root = tempDir('security');
  try {
    const variant = path.join(root, 'variant');
    fs.mkdirSync(variant);
    fs.writeFileSync(path.join(variant, 'variant.json'), JSON.stringify({ name: 'candidate', effect_class: 'SE0' }));
    fs.writeFileSync(path.join(variant, 'run.js'), 'module.exports={solve:()=>1};');
    const taskset = path.join(root, 'answers.json');
    fs.writeFileSync(taskset, JSON.stringify({ version: '1', family: 'canary', tasks: [{ id: 't', input: 0, expected: 1 }] }));
    fn({ root, variant, taskset, work: path.join(root, 'work') });
  } finally {
    cleanup(root);
  }
}

test('gate refuses all execution modes before creating work, including prior trusted flags', () => setup(c => {
  for (const extra of [{}, { trusted_local: true }, { isolation: { verified: true } }, { executor: 'anything' }]) {
    assert.throws(() => gate.runGate({ taskset: c.taskset, baseline: c.variant, candidate: c.variant, work_dir: c.work, ...extra }), refused);
    assert.ok(!fs.existsSync(c.work));
  }
}));

test('refusal happens before reading configuration properties', () => {
  const config = new Proxy({}, { get() { throw new Error('configuration was inspected'); } });
  assert.throws(() => gate.runGate(config), refused);
  assert.throws(() => gate.runVariant(config), refused);
});

test('direct runner refuses caller-supplied trust and isolation claims', () => setup(c => {
  const variant = gate.loadVariant(c.variant);
  for (const options of [{}, { trusted_local: true }, { isolation: { verified: true } }]) {
    assert.throws(() => gate.runVariant(variant, [], c.work, options), refused);
  }
  assert.ok(!fs.existsSync(c.work));
}));

test('CLI refuses before reading a config or creating a capsule even with trusted-local', () => setup(c => {
  const cli = path.resolve(library, '../../eval-harness.js');
  const config = path.join(c.root, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ taskset: c.taskset, baseline: c.variant, candidate: c.variant }));
  const capsule = path.join(c.root, 'capsule');
  for (const input of [config, path.join(c.root, 'missing.json')]) {
    const result = spawnSync(process.execPath, [cli, 'gate', 'run', input, '--capsule', capsule, '--trusted-local'], { encoding: 'utf8', timeout: 2000 });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /gate.isolation_required/);
    assert.ok(!fs.existsSync(capsule));
  }
}));

test('child and retired preload reject before loading an escaping canary payload', () => setup(c => {
  const marker = path.join(c.root, 'executed');
  const external = path.join(c.root, 'external.js');
  fs.writeFileSync(external, `require('fs').writeFileSync(${JSON.stringify(marker)},'bad');module.exports={solve:()=>1};`);
  for (const args of [[path.join(library, 'gate-child.js')], ['--require', path.join(library, 'effect-fence.js'), external]]) {
    const result = spawnSync(process.execPath, args, {
      cwd: c.variant, input: JSON.stringify({ entry: external, tasks: [] }), encoding: 'utf8', timeout: 2000,
      env: { ECC_EFFECT_FENCE_ROOT: c.variant, ECC_EFFECT_FENCE_LOG: path.join(c.root, 'log') },
    });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /gate.isolation_required/);
    assert.ok(!fs.existsSync(marker));
  }
}));

test('read, alternate builtin, descriptor and promise escape payloads never load', () => setup(c => {
  const marker = path.join(c.root, 'executed');
  const payloads = [
    `require('fs').readFileSync(${JSON.stringify(c.taskset)});`,
    "process.getBuiltinModule('ht'+'tp');", // Acquiring the API only; no request.
    `const fs=require('fs');const fd=fs.openSync(${JSON.stringify(marker)},'w');fs.writeSync(fd,'escape');fs.closeSync(fd);`,
    `require('fs/promises').writeFile(${JSON.stringify(marker)},'escape');`,
  ];
  for (const source of payloads) {
    const entry = path.join(c.variant, 'run.js');
    fs.writeFileSync(entry, `require('fs').writeFileSync(${JSON.stringify(marker)},'loaded');${source}`);
    const result = spawnSync(process.execPath, ['--require', path.join(library, 'effect-fence.js'), entry], { encoding: 'utf8', timeout: 2000 });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /gate.isolation_required/);
    assert.ok(!fs.existsSync(marker), 'payload must not begin executing');
  }
}));

test('unsafe names and escaping or undigested entry paths are rejected', () => setup(c => {
  const file = path.join(c.variant, 'variant.json');
  const cases = [
    { name: 'n/../../escaped' }, { name: '/abs' }, { name: 44 },
    { entry: path.join(c.root, 'external.js') }, { entry: '../run.js' },
    { entry: 'C:\\evil.js' }, { entry: 'node_modules/hidden.js' }, { entry: 42 },
  ];
  for (const extra of cases) {
    fs.writeFileSync(file, JSON.stringify({ name: 'candidate', effect_class: 'SE0', ...extra }));
    assert.throws(() => gate.loadVariant(c.variant), invalidVariant);
  }
}));

test('symlink manifests and symlink trees cannot hide from digest', () => setup(c => {
  const file = path.join(c.variant, 'variant.json');
  const outside = path.join(c.root, 'manifest.json');
  fs.renameSync(file, outside);
  fs.symlinkSync(outside, file);
  assert.throws(() => gate.loadVariant(c.variant), invalidVariant);
  fs.unlinkSync(file);
  fs.renameSync(outside, file);
  fs.symlinkSync(c.root, path.join(c.variant, 'link'));
  assert.throws(() => gate.loadVariant(c.variant), invalidVariant);
}));

test('valid nested entry is in digest; missing and excluded entries fail closed', () => setup(c => {
  fs.mkdirSync(path.join(c.variant, 'nested'));
  fs.writeFileSync(path.join(c.variant, 'nested', 'entry.js'), 'module.exports={solve:()=>2};');
  const file = path.join(c.variant, 'variant.json');
  fs.writeFileSync(file, JSON.stringify({ name: 'candidate', entry: 'nested/entry.js', effect_class: 'SE0' }));
  const variant = gate.loadVariant(c.variant);
  assert.strictEqual(variant.entry, path.join('nested', 'entry.js'));
  assert.match(variant.digest, /^[0-9a-f]{64}$/);
  for (const entry of ['missing.js', '.git/hidden.js']) {
    fs.writeFileSync(file, JSON.stringify({ name: 'candidate', entry, effect_class: 'SE0' }));
    assert.throws(() => gate.loadVariant(c.variant), invalidVariant);
  }
}));

test('result parser rejects empty, missing, duplicate, unexpected and ambiguous output', () => {
  const tasks = [{ id: 't' }];
  const cases = [
    {}, null, [], { results: {} }, { results: [] },
    { results: [{ id: 'wrong', output: 1 }] }, { results: [{ id: 't' }] },
    { results: [{ id: 't', output: 1, error: 'bad' }] },
    { results: [{ id: 't', output: 1 }, { id: 't', output: 1 }] }, { fatal: '' },
  ];
  for (const value of cases) {
    const result = gate.parseChildResult({ status: 0, stdout: JSON.stringify(value) }, tasks);
    assert.ok(result.fatal);
    assert.strictEqual(result.outputs.size, 0);
  }
  const valid = gate.parseChildResult({ status: 0, stdout: JSON.stringify({ results: [{ id: 't', output: 1 }] }) }, tasks);
  assert.strictEqual(valid.fatal, null);
  assert.strictEqual(valid.outputs.get('t').output, 1);
  assert.ok(gate.parseChildResult({ status: 0, stdout: 'x'.repeat(1024 * 1024 + 1) }, tasks).fatal);
  assert.ok(gate.parseChildResult(null, tasks).fatal);
});

test('fatal baseline classification rejects timeout, nonzero, signal and protocol failures', () => {
  const tasks = [{ id: 't' }];
  const cases = [
    { error: { code: 'ETIMEDOUT' } }, { error: { code: 'ENOENT' } },
    { status: 1, stdout: '{}' }, { status: null, signal: 'SIGTERM' },
    { status: 0, stdout: '{broken' }, { status: 0, stdout: JSON.stringify({ fatal: 'cannot load variant' }) },
  ];
  for (const child of cases) {
    const run = { ...gate.parseChildResult(child, tasks), exit_code: child.status, marker_intact: true, fence_events: [] };
    assert.ok(gate.baselineFailure(run, tasks));
  }
});

test('baseline validation requires complete unique error-free results and integrity', () => {
  const tasks = [{ id: 't' }];
  const run = { outputs: new Map([['t', { id: 't', output: 1 }]]), fatal: null, exit_code: 0, marker_intact: true, fence_events: [] };
  assert.strictEqual(gate.baselineFailure(run, tasks), null);
  const cases = [
    { outputs: new Map() }, { outputs: new Map([['t', { id: 'wrong', output: 1 }]]) },
    { outputs: new Map([['t', { id: 't', error: 'failure' }]]) }, { fatal: 'bad' },
    { exit_code: 1 }, { marker_intact: false }, { fence_events: [{ kind: 'effect' }] },
  ];
  for (const delta of cases) assert.ok(gate.baselineFailure({ ...run, ...delta }, tasks));
  for (const input of [undefined, [], [null], [{ id: 't' }, { id: 't' }]]) {
    assert.ok(gate.baselineFailure(run, input));
  }
});

test('duplicate task ids cannot erase per-task regression evidence', () => setup(c => {
  for (const tasks of [[{ id: 'same', input: 0, expected: 1 }, { id: 'same', input: 1, expected: 2 }], [null]]) {
    fs.writeFileSync(c.taskset, JSON.stringify({ version: '1', family: 'canary', tasks }));
    assert.throws(() => gate.loadTaskset(c.taskset), error => error.code === 'gate.taskset_invalid');
  }
}));

finish('security');
