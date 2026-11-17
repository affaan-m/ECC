/**
 * Shared harness for the config-health hook-contract tests.
 *
 * The suites were split out of one 1389-line file. Everything that spawns the
 * monitor, builds a disposable home, or writes settings lives here so both
 * suites exercise the same process contract.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'config-health.py');

// Resolve a working python. On Windows, missing interpreters surface as
// status 9009 (not a spawn error), so probe both name and exit status.
function resolvePython() {
  const probe = (name) => {
    const r = spawnSync(name, ['--version'], { stdio: 'ignore' });
    return !r.error && r.status === 0;
  };
  if (process.env.CONFIG_HEALTH_PYTHON) return process.env.CONFIG_HEALTH_PYTHON;
  if (probe('python3')) return 'python3';
  if (probe('python')) return 'python';
  throw new Error('No python interpreter found (tried CONFIG_HEALTH_PYTHON, python3, python)');
}

const PYTHON = resolvePython();

// ---- helpers ---------------------------------------------------------------

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function makeFixture() {
  // Returns { home, proj, root } — a throwaway sandbox under os.tmpdir().
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-health-'));
  const home = path.join(root, 'home');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  return { root, home, proj };
}

function run(mode, { home, proj }, stdin = '', extraEnv = {}) {
  return spawnSync(PYTHON, [SCRIPT, mode], {
    env: {
      ...process.env,
      CONFIG_HEALTH_USER_HOME: home,
      CLAUDE_PROJECT_DIR: proj,
      CLAUDE_CONFIG_DIR: '',
      ...extraEnv,
    },
    input: stdin,
    encoding: 'utf8',
  });
}

function writeSettings(home, content) {
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), content, 'utf8');
}

// Install-lifecycle fixture: a disposable HOME and Claude data root, so the
// real installer/repair/uninstaller run without touching the user's config.
function makeInstallFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-health-install-'));
  const home = path.join(root, 'home');
  const config = path.join(root, 'claude');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(proj, { recursive: true });
  return { root, home, config, proj };
}

function installEnv(fx, extraEnv = {}) {
  return {
    HOME: fx.home,
    USERPROFILE: fx.home,
    CLAUDE_CONFIG_DIR: fx.config,
    CONFIG_HEALTH_USER_HOME: fx.home,
    CLAUDE_PROJECT_DIR: fx.proj,
    ...extraEnv,
  };
}

function runNode(scriptRel, args, env) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', '..', scriptRel), ...args], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 120000,
  });
}

function runInstalled(mode, fx, extraEnv = {}) {
  return spawnSync(PYTHON, [path.join(fx.config, 'scripts', 'config-health.py'), mode], {
    env: { ...process.env, ...installEnv(fx, extraEnv) },
    encoding: 'utf8',
    timeout: 120000,
  });
}

function runInstalledWithInput(mode, fx, input, extraEnv = {}) {
  return spawnSync(PYTHON, [path.join(fx.config, 'scripts', 'config-health.py'), mode], {
    env: { ...process.env, ...installEnv(fx, extraEnv) },
    input,
    encoding: 'utf8',
    timeout: 120000,
  });
}

const HOOKS_JSON = (scriptPath) => JSON.stringify({
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: `python3 ${scriptPath} --start`, timeout: 5000 }] }],
    PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: `python3 ${scriptPath} --pretool`, timeout: 3000 }] }],
  },
});

// A single command hook, for pinning one parser or resolution rule at a time
// instead of the two-shape fixture above.
const ONE_HOOK = (command, event = 'PreToolUse') => JSON.stringify({
  hooks: { [event]: [{ hooks: [{ type: 'command', command, timeout: 5 }] }] },
});

// A plugin install wires its hooks against $CLAUDE_PLUGIN_ROOT, which is a
// directory the monitor must expand rather than treat as project-relative.
const PLUGIN_HOOKS_JSON = (relPath) => JSON.stringify({
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: `python3 "\${CLAUDE_PLUGIN_ROOT}/${relPath}" --start`, timeout: 5000 }] }],
    PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: `python3 "\${CLAUDE_PLUGIN_ROOT}/${relPath}" --pretool`, timeout: 3000 }] }],
  },
});


module.exports = {
  SCRIPT,
  PYTHON,
  test,
  makeFixture,
  run,
  writeSettings,
  makeInstallFixture,
  installEnv,
  runNode,
  runInstalled,
  runInstalledWithInput,
  HOOKS_JSON,
  ONE_HOOK,
  PLUGIN_HOOKS_JSON,
};
