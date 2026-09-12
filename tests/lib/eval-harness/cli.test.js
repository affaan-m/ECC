'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const vm = require('vm');
const { test, tempDir, cleanup, finish } = require('./helpers');
const harness = require('../../../scripts/lib/eval-harness');
const cli = path.resolve(__dirname, '../../../scripts/eval-harness.js');
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 3000 });

// Exercise spawn failures without starting an example, mutating the real
// process object, or depending on a host-specific missing executable.
function exampleResult(result) {
  const exit = Symbol('exit');
  let status;
  let stderr = '';
  const calls = [];
  const module = { exports: {} };
  const context = {
    module, __dirname: path.dirname(cli), __filename: cli,
    require(name) {
      if (name === 'child_process') return { spawnSync(...args) { calls.push(args); return result; } };
      if (name === './lib/eval-harness') return harness;
      return require(name);
    },
    process: {
      execPath: '/synthetic/node',
      stderr: { write(value) { stderr += value; } },
      exit(value) { status = value; throw exit; },
    },
  };
  vm.runInNewContext(fs.readFileSync(cli, 'utf8'), context, { timeout: 1000 });
  assert.throws(() => module.exports.main(['example', '/synthetic/output']), error => error === exit);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], '/synthetic/node');
  assert.deepStrictEqual(Array.from(calls[0][1]), [path.resolve(path.dirname(cli), '../examples/eval-harness/run-example.js'), '/synthetic/output']);
  assert.strictEqual(calls[0][2].stdio, 'inherit');
  return { status, stderr };
}

test('example startup failure reports a stable diagnostic without child error details', () => {
  const error = Object.assign(new Error('private argv and path marker'), {
    code: 'ENOENT', path: '/synthetic/private', spawnargs: ['private argument'],
  });
  assert.deepStrictEqual(exampleResult({ error, status: null }), {
    status: 1, stderr: 'eval-harness: example.spawn_failed: unable to start example process\n',
  });
});

test('example startup diagnostic never interpolates an untrusted error code', () => {
  assert.deepStrictEqual(exampleResult({ error: { code: 'private\nmarker' }, status: null }), {
    status: 1, stderr: 'eval-harness: example.spawn_failed: unable to start example process\n',
  });
});

test('example preserves child exit status and maps signal termination to failure', () => {
  for (const status of [0, 7, null]) {
    assert.deepStrictEqual(exampleResult({ status }), { status: status === null ? 1 : status, stderr: '' });
  }
});

test('candidate slug normalization preserves composed and combining Unicode behavior', () => {
  const { solve } = require('../../../examples/eval-harness/variants/candidate/run');
  for (const [input, expected] of [
    ['Cr\u00e8me Br\u00fbl\u00e9e', 'creme-brulee'],
    ['Cre\u0300me_Bru\u0302le\u0301e', 'creme-brulee'],
    ['\u0300A\u036f', 'a'], ['\ufb03 \uff21', 'ffi-a'],
    ['---A__ B---', 'a-b'], ['\u4e2d\u6587', ''], [42, '42'],
  ]) assert.strictEqual(solve(input), expected);
});

test('dangling receipt value flags are usage errors before reading missing inputs', () => {
  for (const command of [['receipt', 'verify', '/absent-receipt', '/absent-capsule'], ['receipt', 'build', '/absent-capsule']]) {
    for (const flag of ['--artifact', '--gate', '--out']) {
      for (const tail of [[flag], [flag, '--artifact']]) {
        const result = run([...command, ...tail]);
        assert.strictEqual(result.status, 2, `${tail}: ${result.stderr}`);
        assert.match(result.stderr, /needs a value/);
      }
    }
  }
});

test('invalid output flag does not cause producer projection writes', () => {
  const dir = tempDir('cli-build');
  try {
    harness.capsule.Capsule.create(dir);
    const result = run(['receipt', 'build', dir, '--out']);
    assert.strictEqual(result.status, 2);
    assert.ok(!fs.existsSync(path.join(dir, harness.capsule.PROJECTION_FILE)));
  } finally { cleanup(dir); }
});

test('valid CLI build and verify persist then check a projection without healing it', () => {
  const dir = tempDir('cli-receipt');
  try {
    harness.capsule.Capsule.create(dir).append('plan', 'start', {});
    const out = path.join(dir, 'receipt.json');
    assert.strictEqual(run(['receipt', 'build', dir, '--out', out]).status, 0);
    assert.strictEqual(run(['receipt', 'verify', out, dir]).status, 0);
    const projection = path.join(dir, harness.capsule.PROJECTION_FILE);
    assert.ok(fs.existsSync(projection));
    fs.unlinkSync(projection);
    const result = run(['receipt', 'verify', out, dir]);
    assert.strictEqual(result.status, 1);
    assert.strictEqual(JSON.parse(result.stdout).check, 'projection');
    assert.ok(!fs.existsSync(projection));
  } finally { cleanup(dir); }
});

test('disabled gate still refuses before config or capsule I/O', () => {
  const result = run(['gate', 'run', '/absent-config', '--capsule', '--trusted-local']);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /gate.isolation_required/);
});


test('a repeated value flag cannot conceal a missing value or override silently', () => {
  for (const tail of [['--artifact', 'one', '--artifact'], ['--gate', 'one', '--gate', 'two']]) {
    const result = run(['receipt', 'verify', '/absent-receipt', '/absent-capsule', ...tail]);
    assert.strictEqual(result.status, 2);
  }
});


test('capsule CLI projects and exports valid metadata, and rejects forged metadata', () => {
  const root = tempDir('cli-capsule');
  try {
    const dir = path.join(root, 'source');
    harness.capsule.Capsule.create(dir).append('plan', 'start', {});
    const file = path.join(dir, harness.capsule.META_FILE);
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(original), run_id: 'forged' }));
    const invalid = run(['capsule', 'verify', dir]);
    assert.strictEqual(invalid.status, 1);
    assert.strictEqual(JSON.parse(invalid.stdout).code, 'capsule.metadata_mismatch');
    assert.strictEqual(run(['capsule', 'project', dir]).status, 1);
    assert.ok(!fs.existsSync(path.join(dir, harness.capsule.PROJECTION_FILE)));
    fs.writeFileSync(file, original);
    assert.strictEqual(run(['capsule', 'project', dir]).status, 0);
    const out = path.join(root, 'bundle');
    assert.strictEqual(run(['capsule', 'export', dir, out]).status, 0);
    const valid = run(['capsule', 'verify', out]);
    assert.strictEqual(valid.status, 0);
    assert.strictEqual(JSON.parse(valid.stdout).ok, true);
  } finally { cleanup(root); }
});

test('capsule group CLI emits only a read-only report for explicit snapshots', () => {
  const dir = tempDir('cli-group');
  try {
    harness.capsule.Capsule.create(dir, { task_family: 'fixture-family' })
      .append('plan', 'start', { note: 'private journal marker' });
    const before = fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]);
    const result = run(['capsule', 'group', dir, dir]);
    assert.strictEqual(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.report_only, true);
    assert.strictEqual(report.capsule_count, 1);
    assert.strictEqual(report.duplicate_count, 1);
    assert.ok(!result.stdout.includes('private journal marker'));
    assert.ok(!result.stdout.includes(dir));
    assert.deepStrictEqual(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]), before);
  } finally { cleanup(dir); }
});

test('capsule group rejects bad usage and content without a partial report', () => {
  for (const args of [[], [' '], ['--out', 'missing'], Array(101).fill('missing')]) {
    const result = run(['capsule', 'group', ...args]);
    assert.strictEqual(result.status, 2, result.stderr);
    assert.strictEqual(result.stdout, '');
  }
  const result = run(['capsule', 'group', '/missing/private-directory-marker']);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /retrospective.invalid_capsule/);
  assert.ok(!result.stderr.includes('private-directory-marker'));
  assert.strictEqual(result.stdout, '');
});

finish('cli');
