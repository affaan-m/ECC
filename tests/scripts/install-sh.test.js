/**
 * Tests for install.sh wrapper delegation
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'install.sh');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function run(args = [], options = {}) {
  const env = {
    ...process.env,
    HOME: options.homeDir || process.env.HOME,
    ...(options.env || {}),
  };

  try {
    const stdout = execFileSync('bash', [options.scriptPath || SCRIPT, ...args], {
      cwd: options.cwd,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });

    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing install.sh ===\n');

  let passed = 0;
  let failed = 0;

  if (process.platform === 'win32') {
    console.log('  - skipped on Windows; install.ps1 covers the native wrapper path');
    console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
    process.exit(0);
  }

  if (test('delegates to the Node installer and preserves dry-run output', () => {
    const homeDir = createTempDir('install-sh-home-');
    const projectDir = createTempDir('install-sh-project-');

    try {
      const result = run(['--target', 'cursor', '--dry-run', 'typescript'], {
        cwd: projectDir,
        homeDir,
      });

      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Dry-run install plan'));
      assert.ok(!fs.existsSync(path.join(projectDir, '.cursor', 'hooks.json')));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('absolute wrapper bootstraps a fresh source while preserving the target project cwd', () => {
    const sourceDir = createTempDir('install-sh-source-');
    const projectDir = createTempDir('install-sh-target-');
    const binDir = path.join(sourceDir, 'test-bin');
    const scriptsDir = path.join(sourceDir, 'scripts');
    const npmCwdPath = path.join(sourceDir, 'npm-cwd.txt');
    const fixtureScript = path.join(sourceDir, 'install.sh');

    try {
      fs.mkdirSync(binDir, { recursive: true });
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.copyFileSync(SCRIPT, fixtureScript);
      fs.writeFileSync(
        path.join(binDir, 'npm'),
        `#!/usr/bin/env bash\nset -euo pipefail\nmkdir -p "$PWD/node_modules"\nprintf '%s\\n' "$PWD" > "$ECC_TEST_NPM_CWD"\n`,
        { mode: 0o755 }
      );
      fs.writeFileSync(
        path.join(scriptsDir, 'install-apply.js'),
        'console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));\n'
      );

      const result = run(['--target', 'antigravity', '--dry-run', 'typescript'], {
        cwd: projectDir,
        scriptPath: fixtureScript,
        env: {
          ECC_TEST_NPM_CWD: npmCwdPath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        },
      });

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = JSON.parse(result.stdout.trim().split('\n').at(-1));
      assert.strictEqual(payload.cwd, fs.realpathSync(projectDir));
      assert.deepStrictEqual(payload.args, ['--target', 'antigravity', '--dry-run', 'typescript']);
      assert.strictEqual(fs.readFileSync(npmCwdPath, 'utf8').trim(), sourceDir);
      assert.ok(fs.existsSync(path.join(sourceDir, 'node_modules')));
    } finally {
      cleanup(sourceDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('exposes the corrected Claude target help text', () => {
    const result = run(['--help']);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(
      result.stdout.includes('claude       (default) - Install ECC into ~/.claude/'),
      'help text should describe the Claude target as a full ~/.claude install surface'
    );
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
