/**
 * Hook-contract tests for scripts/config-health.py
 *
 * Verifies the contract haelyra asked for: present & missing scripts,
 * malformed & absent settings, absent rule dirs, and warning behavior —
 * every diagnostic must stay non-blocking (exit 0), exit cleanly, and never
 * echo raw hook input or secrets.
 *
 * Run with: node tests/hooks/config-health.test.js
 * (also picked up by `node tests/run-all.js`)
 */

'use strict';

const assert = require('assert');
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

function run(mode, { home, proj }, stdin = '') {
  return spawnSync(PYTHON, [SCRIPT, mode], {
    env: { ...process.env, CONFIG_HEALTH_USER_HOME: home, CLAUDE_PROJECT_DIR: proj },
    input: stdin,
    encoding: 'utf8',
  });
}

function writeSettings(home, content) {
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), content, 'utf8');
}

const HOOKS_JSON = (scriptPath) => JSON.stringify({
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: `python3 ${scriptPath} --start`, timeout: 5000 }] }],
    PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: `python3 ${scriptPath} --pretool`, timeout: 3000 }] }],
  },
});

// ---- suite -----------------------------------------------------------------

function runTests() {
  console.log('\n=== Testing config-health.py hook contract ===\n');
  let passed = 0;
  let total = 0;

  const t = (name, fn) => { total += 1; if (test(name, fn)) passed += 1; };

  // Absent settings → clean, non-blocking.
  t('startup with absent settings exits 0 and is silent', () => {
    const fx = makeFixture();
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.strictEqual(r.stdout.trim(), '', 'expected no findings with no settings');
  });

  // Missing referenced script → WARN, still exit 0 (never blocks).
  t('startup warns on a missing referenced script but exits 0', () => {
    const fx = makeFixture();
    writeSettings(fx.home, HOOKS_JSON('~/.claude/scripts/nope-guard.py'));
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('missing script'), 'expected a missing-script warning');
    assert.ok(r.stdout.includes('nope-guard.py'), 'warning should name the missing file');
  });

  // Script present → no warning.
  t('startup is silent when referenced scripts exist', () => {
    const fx = makeFixture();
    fs.mkdirSync(path.join(fx.home, '.claude', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fx.home, '.claude', 'scripts', 'ok-guard.py'), '', 'utf8');
    writeSettings(fx.home, HOOKS_JSON('~/.claude/scripts/ok-guard.py'));
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!r.stdout.includes('missing script'), 'expected no missing-script warning');
  });

  // Malformed settings → clean, non-blocking, no crash.
  t('startup tolerates malformed settings (exit 0, no crash)', () => {
    const fx = makeFixture();
    writeSettings(fx.home, '{ not valid json');
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!/Traceback|Error/.test(r.stdout + r.stderr), 'should not crash');
  });

  // Absent rule dir / absent CLAUDE.md → clean.
  t('startup with absent rules dir and CLAUDE.md is clean', () => {
    const fx = makeFixture(); // proj has .claude but no CLAUDE.md, no rules/
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.strictEqual(r.stdout.trim(), '', 'expected no findings');
  });

  // Dead rule reference → WARN, exit 0.
  t('startup warns on CLAUDE.md referencing a missing rule file', () => {
    const fx = makeFixture();
    fs.writeFileSync(path.join(fx.proj, 'CLAUDE.md'), 'see rules/ghost.md\n', 'utf8');
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('missing rule file'), 'expected a dead-rule warning');
  });

  // --pretool must NEVER echo stdin (raw hook input / secrets).
  t('pretool never echoes raw hook input or secrets to stdout', () => {
    const fx = makeFixture();
    const secret = 'ghp_FakeSecretToken_12345';
    const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'x.md' }, api_key: secret });
    const r = run('--pretool', fx, input);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.strictEqual(r.stdout, '', 'stdout must be empty — stdin must not be echoed');
    assert.ok(!(r.stdout + r.stderr).includes(secret), 'secret must not appear anywhere');
  });

  // --pretool with malformed stdin → clean exit.
  t('pretool tolerates malformed stdin (exit 0)', () => {
    const fx = makeFixture();
    const r = run('--pretool', fx, 'garbage{{{{');
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!/Traceback/.test(r.stdout + r.stderr), 'should not crash');
  });

  // Warning behavior: pretool warnings go to stderr, stdout stays clean.
  t('pretool warns on stderr, keeps stdout clean, stays non-blocking', () => {
    const fx = makeFixture();
    writeSettings(fx.home, HOOKS_JSON('~/.claude/scripts/missing-again.py'));
    const r = run('--pretool', fx, '{"tool_name":"Edit"}');
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.strictEqual(r.stdout, '', 'stdout must stay empty in pretool mode');
    assert.ok(r.stderr.includes('missing script'), 'warning should surface on stderr');
  });

  console.log(`\n  ${passed}/${total} passed`);
  if (passed !== total) process.exit(1);
}

runTests();
