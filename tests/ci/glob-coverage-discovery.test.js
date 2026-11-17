'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const c8Require = createRequire(require.resolve('c8'));
const testExcludeRequire = createRequire(c8Require.resolve('test-exclude'));
const glob = testExcludeRequire('glob');
const rawGlob = testExcludeRequire('glob/raw');

function writeFixture(root) {
  fs.mkdirSync(path.join(root, 'scripts', 'nested'), { recursive: true });
  const files = {
    'scripts/alpha.js': 'module.exports = value => value + 1;\n',
    'scripts/nested/beta.mjs': 'export const answer = 42;\n',
    'scripts/never.js': 'module.exports = value => value - 1;\n',
    'scripts/skip.test.js': 'throw new Error("excluded fixture");\n',
    'run.mjs': 'import increment from "./scripts/alpha.js";\n'
      + 'import { answer } from "./scripts/nested/beta.mjs";\n'
      + 'if (increment(answer) !== 43) throw new Error("fixture result");\n',
  };
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), content);
  }
}

function coverageEnvironment() {
  // Nested coverage owns its artifacts. Never inherit an outer c8/nyc report
  // configuration or V8 instrumentation/preload into the fixture process.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => {
    const key = name.toUpperCase();
    return key !== 'NODE_V8_COVERAGE' && key !== 'NODE_OPTIONS'
      && !key.startsWith('C8_') && !key.startsWith('NYC_');
  }));
  // Node propagates outer V8 coverage when the key is omitted. An explicit
  // empty value keeps the c8 CLI itself out of the outer raw artifact.
  return { ...env, NODE_V8_COVERAGE: '', NODE_OPTIONS: '' };
}

function checkDiscovery(root) {
  for (const engine of [glob, rawGlob]) {
    const discover = pattern => engine.globSync(pattern, { cwd: root })
      .map(name => name.split(path.sep).join('/')).sort();
    assert.deepEqual(discover('scripts/alpha.js'), ['scripts/alpha.js']);
    assert.deepEqual(discover('scripts/**/*.js'), [
      'scripts/alpha.js', 'scripts/never.js', 'scripts/skip.test.js',
    ]);
    assert.deepEqual(discover('scripts/**/*.mjs'), ['scripts/nested/beta.mjs']);
  }
}

function checkCoverage(root) {
  const reports = path.join(root, 'reports');
  const result = spawnSync(process.execPath, [
    require.resolve('c8/bin/c8.js'), '--all',
    '--include=scripts/**/*.js', '--include=scripts/**/*.mjs',
    '--exclude=scripts/**/*.test.js', '--reporter=json-summary',
    '--reports-dir=' + reports, '--temp-directory=' + path.join(root, 'v8'),
    process.execPath, 'run.mjs',
  ], { cwd: root, env: coverageEnvironment(), encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(reports, 'coverage-summary.json'), 'utf8'));
  const files = Object.fromEntries(Object.entries(summary)
    .filter(([name]) => name !== 'total')
    .map(([name, counts]) => [path.relative(root, name).split(path.sep).join('/'), counts]));
  assert.deepEqual(Object.keys(files).sort(), [
    'scripts/alpha.js', 'scripts/nested/beta.mjs', 'scripts/never.js',
  ]);
  assert.equal(files['scripts/alpha.js'].lines.covered, 1);
  assert.equal(files['scripts/nested/beta.mjs'].lines.covered, 1);
  assert.equal(files['scripts/never.js'].lines.covered, 0);
  assert.equal(summary.total.lines.total, 3);
  assert.equal(summary.total.lines.covered, 2);
}

let passed = 0;
let failed = 0;
function test(name, run) {
  try {
    run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}\n    ${error.message}`);
  }
}

const root = (fs.realpathSync.native || fs.realpathSync)(
  fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-glob-coverage-'))
);
try {
  writeFixture(root);
  test('default and raw glob discover literal and wildcard fixture files', () => checkDiscovery(root));
  test('c8 --all retains executed and unexecuted source while excluding test files', () => checkCoverage(root));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`\nPassed: ${passed}\nFailed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
