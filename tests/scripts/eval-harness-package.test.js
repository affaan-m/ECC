'use strict';

// Dependency-free package contract only: never run prepack, build, or install.
// Run serially: node tests/scripts/eval-harness-package.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getNpmPackEntry } = require('../lib/npm-pack-output');
const { test, tempDir, cleanup, finish, runNpm } = require('../lib/eval-harness/helpers');

const repo = path.resolve(__dirname, '../..');
const work = tempDir('package smoke');
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
const childEnv = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' };
const command = (binary, args, options = {}) => spawnSync(binary, args, {
  encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
  env: childEnv, ...options,
});

function sourceFiles(relative) {
  const dir = path.join(repo, relative);
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = `${relative}/${entry.name}`;
    assert.ok(!entry.isSymbolicLink(), `fixture must be a regular source tree: ${file}`);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  }).sort();
}

// Match the actual aggregation contract in tests/run-all.js.
function counts(stdout) {
  const passed = stdout.match(/Passed:\s*(\d+)/);
  const failed = stdout.match(/Failed:\s*(\d+)/);
  assert.ok(passed && failed, 'result tokens must be parseable by tests/run-all.js');
  return { passed: Number(passed[1]), failed: Number(failed[1]) };
}

let archive;
try {
  test('ignore-scripts tarball ships every example fixture and eval library file', () => {
    const result = runNpm(['pack', '--ignore-scripts', '--offline', '--json',
      '--pack-destination', work, '--cache', path.join(work, 'npm-cache')], {
      cwd: repo, env: childEnv,
    });
    assert.strictEqual(result.status, 0, result.error?.message || result.stderr);
    const entry = getNpmPackEntry(JSON.parse(result.stdout), pkg.name);
    assert.ok(entry && typeof entry.filename === 'string');
    assert.strictEqual(path.basename(entry.filename), entry.filename);
    assert.ok(!entry.filename.startsWith('-'));
    archive = path.join(work, entry.filename);
    assert.ok(fs.statSync(archive).isFile());
    const packed = new Set(entry.files.map(file => file.path));
    const examples = sourceFiles('examples/eval-harness');
    const required = ['scripts/eval-harness.js', ...sourceFiles('scripts/lib/eval-harness'), ...examples];
    for (const file of required) assert.ok(packed.has(file), `package is missing ${file}`);
    assert.ok(!packed.has('examples/CLAUDE.md'), 'do not publish unrelated examples');
    console.log(`    package closure: ${examples.length} example files; prepack/build/install skipped`);
  });

  test('actual extracted CLI example runs from the package without installing dependencies', () => {
    assert.ok(archive, 'packing must succeed before extracting');
    const extract = path.join(work, 'extracted');
    fs.mkdirSync(extract);
    const unpack = command('tar', ['-xzf', archive, '-C', extract]);
    assert.strictEqual(unpack.status, 0, unpack.error?.message || unpack.stderr);
    const installed = path.join(extract, 'package');
    assert.ok(!fs.existsSync(path.join(installed, 'node_modules')));
    const runtimeTemp = path.join(work, 'example-runtime');
    fs.mkdirSync(runtimeTemp);
    const result = command(process.execPath, [path.join(installed, 'scripts/eval-harness.js'), 'example', '--keep'], {
      cwd: installed,
      env: { ...childEnv, TMPDIR: runtimeTemp, TMP: runtimeTemp, TEMP: runtimeTemp },
    });
    assert.strictEqual(result.status, 0, result.error?.message || result.stderr || result.stdout);
    assert.match(result.stdout, /all steps passed/);
    const runs = fs.readdirSync(runtimeTemp).filter(name => name.startsWith('ecc-eval-harness-example-'));
    assert.strictEqual(runs.length, 1);
    const run = path.join(runtimeTemp, runs[0]);
    const journal = fs.readFileSync(path.join(run, 'capsule/journal.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(journal.some(entry => entry.kind === 'gate.unavailable' && entry.payload.status === 'blocked'));
    assert.strictEqual(new Set(journal.map(entry => entry.lineage)).size, 5);
    const receipt = JSON.parse(fs.readFileSync(path.join(run, 'bundle/receipt.json'), 'utf8'));
    assert.strictEqual(receipt.gate_receipt_digest, null);
    assert.strictEqual(receipt.gate_verdict, null);
    assert.ok(!fs.existsSync(path.join(run, 'gate-candidate')));
    assert.ok(journal.every(entry => entry.payload.verdict !== 'PROMOTE'));
    for (const file of sourceFiles('examples/eval-harness')) {
      assert.deepStrictEqual(fs.readFileSync(path.join(installed, file)), fs.readFileSync(path.join(repo, file)));
    }
    console.log('    extracted example: five lineages, no candidate execution or gate verdict');
  });

  test('aggregator regexes count every real framework check accurately', () => {
    const suites = fs.readdirSync(path.join(repo, 'tests/lib/eval-harness')).filter(file => file.endsWith('.test.js')).sort();
    let total = 0;
    for (const suite of suites) {
      const result = command(process.execPath, [path.join(repo, 'tests/lib/eval-harness', suite)], { cwd: work });
      assert.strictEqual(result.status, 0, `${suite}: ${result.error?.message || result.stderr || result.stdout}`);
      const parsed = counts(result.stdout);
      const actualPassed = (result.stdout.match(/^\s*✓ /gm) || []).length;
      const actualFailed = (result.stdout.match(/^\s*✗ /gm) || []).length;
      assert.deepStrictEqual(parsed, { passed: actualPassed, failed: actualFailed }, suite);
      assert.ok(actualPassed > 0, `${suite} must run actual checks`);
      assert.strictEqual(parsed.failed, 0);
      total += parsed.passed;
    }
    assert.ok(suites.length > 0);
    console.log(`    framework aggregation: ${suites.length} suites, ${total} actual checks`);
  });

  test('failed checks remain visible to aggregation and return a failing exit', () => {
    const helper = path.join(repo, 'tests/lib/eval-harness/helpers.js');
    const script = `const h=require(${JSON.stringify(helper)});h.test('pass fixture',()=>{});h.test('failure fixture',()=>{throw new Error('synthetic failure');});h.finish('count fixture');`;
    const result = command(process.execPath, ['-e', script], { cwd: work });
    assert.strictEqual(result.status, 1);
    assert.deepStrictEqual(counts(result.stdout), { passed: 1, failed: 1 });
  });
} finally {
  cleanup(work);
}

finish('eval-harness package');
