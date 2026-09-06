/**
 * Regression test for https://github.com/affaan-m/ECC/issues/2822
 *
 * When ECC is installed through the Claude Code plugin marketplace, the
 * marketplace directory is a plain git clone: `npm install` never runs, so
 * node_modules never exists. This copies just the runtime files (scripts/,
 * schemas/, manifests/) into a temp directory with no node_modules anywhere
 * in its ancestor chain, which reproduces that install exactly, and asserts
 * that the user-facing entry points named in the issue still work.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function copyRuntimeFiles(destDir) {
  for (const entry of ['scripts', 'schemas', 'manifests']) {
    fs.cpSync(path.join(REPO_ROOT, entry), path.join(destDir, entry), { recursive: true });
  }
}

function run(scriptRelativePath, args, cwd) {
  try {
    const stdout = execFileSync('node', [path.join(cwd, scriptRelativePath), ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

function runTests() {
  console.log('\n=== Testing plugin install without node_modules (issue #2822) ===\n');

  let passed = 0;
  let failed = 0;

  // No node_modules exists anywhere above os.tmpdir(), so this faithfully
  // reproduces a plugin-marketplace git clone with no dependencies installed.
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-plugin-install-'));

  try {
    copyRuntimeFiles(pluginDir);

    if (test('install-plan.js --list-profiles runs without ajv installed', () => {
      const result = run('scripts/install-plan.js', ['--list-profiles'], pluginDir);
      assert.strictEqual(result.code, 0, `stderr: ${result.stderr}`);
      assert.ok(!result.stderr.includes('Cannot find module'), `stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Install profiles'));
    })) passed++; else failed++;

    if (test('install-plan.js --list-modules runs without ajv installed', () => {
      const result = run('scripts/install-plan.js', ['--list-modules'], pluginDir);
      assert.strictEqual(result.code, 0, `stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Install modules'));
    })) passed++; else failed++;

    if (test('control-pane.js --help runs without sql.js installed', () => {
      const result = run('scripts/control-pane.js', ['--help'], pluginDir);
      assert.strictEqual(result.code, 0, `stderr: ${result.stderr}`);
      assert.ok(!result.stderr.includes('Cannot find module'), `stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Usage:'));
    })) passed++; else failed++;

    if (test('install-plan.js --config gives an actionable error when ajv is genuinely missing', () => {
      const configPath = path.join(pluginDir, 'ecc-install.json');
      fs.writeFileSync(configPath, JSON.stringify({ version: 1, profile: 'minimal' }));

      const result = run('scripts/install-plan.js', ['--config', configPath], pluginDir);
      assert.strictEqual(result.code, 1);
      assert.ok(result.stderr.includes("Missing dependency 'ajv'"), `stderr: ${result.stderr}`);
      assert.ok(result.stderr.includes('npm install'), `stderr: ${result.stderr}`);
      assert.ok(!result.stderr.includes('Require stack'), `stderr should not leak a raw stack trace: ${result.stderr}`);
    })) passed++; else failed++;
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
