/**
 * Regression tests for #2964: the installer must not overwrite project-authored
 * files at managed destinations, and must not record overwritten paths as
 * `ownership: "managed"`.
 *
 * The ownership guard is adapter opt-in (`preserveUserOwnedFiles`); the
 * antigravity adapter is the first adopter, so these tests drive
 * scripts/install-apply.js with `--target antigravity` and a narrow module set
 * that produces `.agents/agents/architect.md`.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const installScript = path.join(repoRoot, 'scripts', 'install-apply.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function runInstall(projectRoot, extraArgs = []) {
  return execFileSync('node', [installScript, '--target', 'antigravity', '--modules', 'agents-core', ...extraArgs], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000,
  });
}

function readState(projectRoot) {
  return JSON.parse(fs.readFileSync(
    path.join(projectRoot, '.agents', 'ecc-install-state.json'),
    'utf8'
  ));
}

function stateRecordsDestination(state, destinationPath) {
  const resolved = path.resolve(destinationPath).toLowerCase();
  return (state.operations || []).some(operation => (
    operation.destinationPath
    && path.resolve(operation.destinationPath).toLowerCase() === resolved
  ));
}

function test1() {
  const projectRoot = createTempDir('ownership-guard-user-file-');
  try {
    const userFilePath = path.join(projectRoot, '.agents', 'agents', 'architect.md');
    fs.mkdirSync(path.dirname(userFilePath), { recursive: true });
    fs.writeFileSync(userFilePath, 'MY OWN USER FILE - DO NOT OVERWRITE\n');

    const stdout = runInstall(projectRoot);

    assert.strictEqual(
      fs.readFileSync(userFilePath, 'utf8'),
      'MY OWN USER FILE - DO NOT OVERWRITE\n',
      'user-authored file must survive the install untouched'
    );
    assert.ok(
      stdout.includes('Skipped user-owned file'),
      'install output must explain the skipped user-owned file'
    );
    assert.strictEqual(
      stateRecordsDestination(readState(projectRoot), userFilePath),
      false,
      'install-state must not claim ownership of the user-authored file'
    );
  } finally {
    cleanup(projectRoot);
  }
}

function test2() {
  const projectRoot = createTempDir('ownership-guard-fresh-');
  try {
    runInstall(projectRoot);

    const installedPath = path.join(projectRoot, '.agents', 'agents', 'architect.md');
    assert.ok(fs.existsSync(installedPath), 'fresh install must still install the agent file');

    const state = readState(projectRoot);
    assert.ok(
      stateRecordsDestination(state, installedPath),
      'freshly installed file must be recorded in install-state'
    );
    assert.strictEqual(
      (state.operations || []).find(operation => (
        operation.destinationPath
        && path.resolve(operation.destinationPath) === path.resolve(installedPath)
      )).ownership,
      'managed',
      'freshly installed file must be owned by ECC'
    );
  } finally {
    cleanup(projectRoot);
  }
}

function test3() {
  const projectRoot = createTempDir('ownership-guard-reinstall-');
  try {
    runInstall(projectRoot);
    const installedPath = path.join(projectRoot, '.agents', 'agents', 'architect.md');
    fs.unlinkSync(installedPath);

    // Second install over an ECC-managed path (recorded in install-state) is
    // an upgrade, not an ownership conflict: it must reinstall the file.
    runInstall(projectRoot);

    assert.ok(fs.existsSync(installedPath), 'managed reinstall must restore the removed file');
    assert.ok(
      stateRecordsDestination(readState(projectRoot), installedPath),
      'managed reinstall keeps ownership recorded'
    );
  } finally {
    cleanup(projectRoot);
  }
}

console.log('\n=== Testing install ownership guard (#2964) ===\n');

test('skips user-authored destinations without recording ownership (#2964)', test1);
test('installs normally when the destination does not exist (#2964)', test2);
test('still reinstalls over an ECC-managed destination (#2964)', test3);

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
