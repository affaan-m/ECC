'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const eccCli = path.join(repoRoot, 'scripts', 'ecc.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-install-dry-run-'));
  try {
    const projectRoot = path.join(root, 'project');
    const homeDir = path.join(root, 'home');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });
    fn({ projectRoot, homeDir });
    passed++;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}: ${error.stack}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function makeEnv(homeDir) {
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    CODEX_HOME: path.join(homeDir, '.codex'),
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
  };
  delete env.ECC_DRY_RUN;
  delete env.CLAUDE_CONFIG_DIR;
  delete env.ECC_AGENT_DATA_HOME;
  delete env.OPENCODE_CONFIG_DIR;
  return env;
}

function runEcc(args, context) {
  return spawnSync(process.execPath, [eccCli, ...args], {
    cwd: context.projectRoot,
    encoding: 'utf8',
    timeout: 120000,
    env: makeEnv(context.homeDir),
  });
}

function walkFiles(dirPath) {
  const found = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) found.push(full);
    }
  };
  if (fs.existsSync(dirPath)) visit(dirPath);
  return found.sort();
}

function findStateFiles(homeDir) {
  return walkFiles(homeDir).filter(file => file.endsWith('ecc-install-state.json'));
}

function testInstallForms() {
  for (const args of [
    ['--dry-run', 'install', '--target', 'cursor', '--modules', 'rules-core'],
    ['install', '--target', 'cursor', '--modules', 'rules-core', '--dry-run'],
  ]) {
    test(`dry-run install writes nothing (${args.slice(0, 2).join(' ')})`, context => {
      const result = runEcc(args, context);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.deepStrictEqual(walkFiles(context.homeDir), []);
      assert.deepStrictEqual(walkFiles(context.projectRoot), []);
      assert.deepStrictEqual(findStateFiles(context.homeDir), []);
    });
  }
}

function testRepairForms() {
  for (const args of [
    ['--dry-run', 'repair', '--target', 'cursor'],
    ['repair', '--target', 'cursor', '--dry-run'],
  ]) {
    test(`dry-run repair preserves drift and state (${args.slice(0, 2).join(' ')})`, context => {
      const installed = runEcc(['install', '--target', 'cursor', '--modules', 'rules-core'], context);
      assert.strictEqual(installed.status, 0, installed.stderr);
      const roots = [context.homeDir, context.projectRoot];
      const stateFiles = roots.flatMap(findStateFiles);
      assert.ok(stateFiles.length > 0, 'expected a real install to write state first');
      const managedFile = roots.flatMap(walkFiles).find(
        file => !file.endsWith('ecc-install-state.json') && !file.endsWith('.db')
      );
      assert.ok(managedFile, 'expected a real install to write managed files first');
      fs.appendFileSync(managedFile, '\n# local drift marker\n');
      const drifted = fs.readFileSync(managedFile, 'utf8');
      const stateBefore = stateFiles.map(file => fs.readFileSync(file));

      const result = runEcc(args, context);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(fs.readFileSync(managedFile, 'utf8'), drifted);
      assert.deepStrictEqual(
        stateFiles.map(file => fs.readFileSync(file)),
        stateBefore
      );
    });
  }
}

function testDryRunEnvironment() {
  for (const value of ['1', 'true', '']) {
    test(`direct install honors or rejects ECC_DRY_RUN=${JSON.stringify(value)}`, context => {
      const result = spawnSync(process.execPath, [eccCli, 'install', '--target', 'cursor', '--modules', 'rules-core'], {
        cwd: context.projectRoot,
        encoding: 'utf8',
        timeout: 120000,
        env: { ...makeEnv(context.homeDir), ECC_DRY_RUN: value },
      });
      assert.strictEqual(result.status, value === '1' ? 0 : 1, result.stderr);
      if (value !== '1') assert.ok(result.stderr.includes('ECC_DRY_RUN'));
      assert.deepStrictEqual(walkFiles(context.homeDir), []);
      assert.deepStrictEqual(walkFiles(context.projectRoot), []);
    });
  }
  test('explicit dry-run remains active with ECC_DRY_RUN=0', context => {
    const result = spawnSync(process.execPath, [eccCli, 'install', '--target', 'cursor', '--modules', 'rules-core', '--dry-run'], {
      cwd: context.projectRoot,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...makeEnv(context.homeDir), ECC_DRY_RUN: '0' },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(walkFiles(context.homeDir), []);
    assert.deepStrictEqual(walkFiles(context.projectRoot), []);
  });
}

console.log('\nInstall dry-run CLI regression tests:\n');
testInstallForms();
testDryRunEnvironment();
testRepairForms();

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
