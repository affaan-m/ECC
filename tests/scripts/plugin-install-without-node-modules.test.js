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
const { execFileSync, spawnSync } = require('child_process');

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
  for (const entry of ['scripts', 'schemas', 'manifests', 'package.json']) {
    fs.cpSync(path.join(REPO_ROOT, entry), path.join(destDir, entry), { recursive: true });
  }
}

// Node's module resolution walks up the directory tree looking for
// node_modules, so if any ancestor of pluginDir happened to have one, a
// require('ajv') from inside pluginDir could resolve there instead of
// hitting the MODULE_NOT_FOUND path this test exists to exercise. Confirm
// the fixture is actually isolated before trusting any of the results below.
function assertNoNodeModulesInAncestry(dir) {
  let current = dir;
  while (true) {
    if (fs.existsSync(path.join(current, 'node_modules'))) {
      throw new Error(
        `Fixture is not isolated: ${path.join(current, 'node_modules')} exists, so this test ` +
        'would resolve dependencies from there instead of exercising the missing-dependency path.'
      );
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
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
    if (test('fixture has no node_modules anywhere in its ancestor chain', () => {
      assertNoNodeModulesInAncestry(pluginDir);
    })) passed++; else failed++;

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

    if (test('session-start.js runs without js-yaml installed', () => {
      // The SessionStart hook loads scripts/lib/project-detect.js, so a
      // top-level require of an npm package there fails every session start.
      const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-start-'));
      try {
        const project = path.join(sandbox, 'project');
        const home = path.join(sandbox, 'home');
        const data = path.join(home, '.claude');
        fs.mkdirSync(project, { recursive: true });
        fs.mkdirSync(data, { recursive: true });
        fs.writeFileSync(path.join(project, 'pubspec.yaml'), 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n');

        // A NODE_PATH that exposes js-yaml would hide the missing dependency.
        const { NODE_PATH: _nodePath, ...inheritedEnv } = process.env;
        const env = { ...inheritedEnv, HOME: home, USERPROFILE: home, ECC_AGENT_DATA_HOME: data,
          CLAUDE_CONFIG_DIR: data, CLAUDE_PROJECT_DIR: project, XDG_DATA_HOME: path.join(home, '.local', 'share'),
          ECC_HOMUNCULUS_DIR: path.join(data, 'homunculus'), ECC_SESSION_START_CONTEXT: 'true',
          ECC_SESSION_START_MAX_CHARS: '8000' };

        const result = spawnSync(process.execPath, [path.join(pluginDir, 'scripts', 'hooks', 'session-start.js')], {
          cwd: project,
          env,
          input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'no-deps', cwd: project }),
          encoding: 'utf8',
          timeout: 15000,
        });
        assert.ifError(result.error);
        assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
        assert.ok(!result.stderr.includes('Cannot find module'), `stderr: ${result.stderr}`);
        const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
        assert.ok(context.includes('"languages":["dart"]'), `additionalContext: ${context}`);
      } finally {
        fs.rmSync(sandbox, { recursive: true, force: true });
      }
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
