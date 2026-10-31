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

  // --- plugin-root install shape ------------------------------------------
  // The bug: $CLAUDE_PLUGIN_ROOT was resolved as a project-relative path, so
  // every hook in a normal plugin install reported a missing script. A false
  // warning flood is what trains users to ignore the WARN line.

  t('plugin-root hook that exists is NOT reported missing', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(path.join(pluginRoot, 'scripts', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, 'scripts', 'hooks', 'guard.py'), '', 'utf8');
    writeSettings(fx.home, PLUGIN_HOOKS_JSON('scripts/hooks/guard.py'));
    const r = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!r.stdout.includes('missing script'),
      `expected no false warning, got: ${r.stdout.trim()}`);
  });

  t('plugin-root hook that is genuinely missing IS reported', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(pluginRoot, { recursive: true });
    writeSettings(fx.home, PLUGIN_HOOKS_JSON('scripts/hooks/gone.py'));
    const r = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('missing script'),
      'a real missing plugin hook must still be caught');
    assert.ok(r.stdout.includes('gone.py'), 'warning should name the file');
  });

  t('plugin-root hook is silent in pretool mode too', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(path.join(pluginRoot, 'scripts', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, 'scripts', 'hooks', 'guard.py'), '', 'utf8');
    writeSettings(fx.home, PLUGIN_HOOKS_JSON('scripts/hooks/guard.py'));
    const r = run('--pretool', fx, '{"tool_name":"Edit"}', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.strictEqual(r.stdout, '', 'stdout must stay empty in pretool mode');
    assert.ok(!r.stderr.includes('missing script'),
      `expected no false warning on stderr, got: ${r.stderr.trim()}`);
  });

  // An unresolved provider placeholder is not a missing script. Claiming it is
  // would be guessing at a path we never built.
  t('unresolved provider placeholder is skipped, not reported missing', () => {
    const fx = makeFixture();
    writeSettings(fx.home, JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'python3 "${CLAUDE_ENV_FILE}/hooks/x.py"' }] }],
      },
    }));
    const r = run('--startup', fx, '', { CLAUDE_ENV_FILE: '' });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!r.stdout.includes('missing script'),
      `an unresolvable placeholder must be skipped, got: ${r.stdout.trim()}`);
  });

  t('plugin-root escape outside the audited roots is skipped', () => {
    const fx = makeFixture();
    const outside = path.join(fx.root, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(pluginRoot, { recursive: true });
    writeSettings(fx.home, PLUGIN_HOOKS_JSON(`../outside/guard.py`));
    const r = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!r.stdout.includes('missing script'),
      `a path escaping the audited roots must be skipped, got: ${r.stdout.trim()}`);
  });

  // --- project-relative install shape -------------------------------------

  t('project-relative hook that exists is silent', () => {
    const fx = makeFixture();
    fs.mkdirSync(path.join(fx.proj, '.claude', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fx.proj, '.claude', 'scripts', 'ok.py'), '', 'utf8');
    writeSettings(fx.home, HOOKS_JSON('.claude/scripts/ok.py'));
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!r.stdout.includes('missing script'), 'expected no warning');
  });

  t('project-relative hook that is missing is still reported', () => {
    const fx = makeFixture();
    writeSettings(fx.home, HOOKS_JSON('.claude/scripts/ghost.py'));
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('missing script'), 'expected a warning');
  });

  // A project-relative token must not be excused just because a plugin root
  // happens to be set — the two shapes have to be judged independently.
  t('project-relative still reported while CLAUDE_PLUGIN_ROOT is set', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(pluginRoot, { recursive: true });
    writeSettings(fx.home, HOOKS_JSON('.claude/scripts/ghost.py'));
    const r = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('missing script'),
      'project-relative shapes must keep working with a plugin root set');
  });

  // --- pretool proportionality -------------------------------------------
  // The wiring audit is a property of the settings files, not of the call
  // about to run, so it runs on every PreToolUse. An earlier revision gated
  // it on a hardcoded tool-class list; that gate was dead code under the
  // wiring this file's own fixture uses (matcher "Edit|Write", both of which
  // were in the list) and it traded provable coverage for 0.4ms of a ~50ms
  // process spawn. These tests pin the unconditional behaviour instead.

  t('pretool audits on every tool class, including read-only ones', () => {
    const fx = makeFixture();
    writeSettings(fx.home, HOOKS_JSON('~/.claude/scripts/missing-again.py'));
    for (const tool of ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'mcp__x__y', 'KilledTool']) {
      const r = run('--pretool', fx, JSON.stringify({ tool_name: tool }));
      assert.strictEqual(r.status, 0, `expected exit 0 for ${tool}`);
      assert.ok(r.stderr.includes('missing script'),
        `every PreToolUse must re-verify the wiring, but ${tool} was skipped`);
    }
  });

  t('pretool verdict does not depend on the payload at all', () => {
    const fx = makeFixture();
    writeSettings(fx.home, HOOKS_JSON('~/.claude/scripts/missing-again.py'));
    const payloads = [
      '', 'garbage{{{{', JSON.stringify({ tool_input: {} }),
      JSON.stringify({ tool_name: '' }), 'null', '[1,2,3]',
    ];
    for (const stdin of payloads) {
      const r = run('--pretool', fx, stdin);
      assert.strictEqual(r.status, 0, `expected exit 0 for ${JSON.stringify(stdin)}`);
      assert.ok(r.stderr.includes('missing script'),
        `must audit for ${JSON.stringify(stdin)}`);
    }
  });

  // An earlier revision bounded the stdin read and parsed it, so a payload
  // over the cap failed to parse and silently re-enabled the audit only by
  // accident. Nothing reads the payload now, so size cannot matter.
  t('pretool still audits on a payload far larger than any cap', () => {
    const fx = makeFixture();
    writeSettings(fx.home, HOOKS_JSON('~/.claude/scripts/missing-again.py'));
    const big = JSON.stringify({ tool_name: 'Read', tool_input: { blob: 'x'.repeat(300 * 1024) } });
    assert.ok(big.length > 64 * 1024, 'fixture must exceed the old cap');
    const r = run('--pretool', fx, big);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stderr.includes('missing script'), 'size must not disable the audit');
  });

  // "non-blocking — always exits 0" has to hold for environmental faults, not
  // just malformed JSON.
  t('every mode exits 0 on an unresolvable environment', () => {
    const fx = makeFixture();
    writeSettings(fx.home, HOOKS_JSON('~/.claude/scripts/missing-again.py'));
    for (const mode of ['--startup', '--pretool', '--check']) {
      const r = run(mode, fx, '', { CLAUDE_PROJECT_DIR: path.join(fx.root, 'gone', 'nope') });
      assert.strictEqual(r.status, 0, `${mode} must exit 0, got ${r.status}`);
      assert.ok(!/Traceback/.test(r.stdout + r.stderr), `${mode} must not raise`);
    }
  });

  // The monitor is read-only by contract. A grep in a test beats a promise
  // in a docstring, because it fails the moment someone adds a cache — and
  // the denylist has to name the write paths, not just the open() call:
  // Path(...).write_text() writes a file and passes an open()-only check.
  t('the script never opens a file for writing', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const offenders = src
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => /open\s*\(/.test(line))
      .filter(([, line]) => !/'r'/.test(line) || !/encoding/.test(line))
      .map(([n, line]) => `${n}: ${line.trim()}`);
    assert.deepStrictEqual(offenders, [],
      `config-health must stay read-only; found: ${offenders.join(' | ')}`);
    for (const pattern of [
      'tempfile', 'mkstemp', 'NamedTemporary', 'shutil', 'json\\.dump',
      'os\\.remove', 'os\\.unlink', 'os\\.rmdir', 'os\\.rename', 'os\\.replace',
      'os\\.makedirs', 'os\\.mkdir', 'write_text', 'write_bytes',
      'atexit', 'sqlite3', 'pickle', '\\bpathlib\\b', '\\bPath\\(',
      'os\\.putenv', 'os\\.environ\\s*\\[',
    ]) {
      assert.ok(!new RegExp(pattern).test(src),
        `read-only contract broken: ${pattern} appears in the script`);
    }
  });

  // --- the false-alarm fix must not cost coverage -------------------------
  // An earlier revision applied "is this inside the audited roots?" to every
  // token instead of only to the ones a placeholder produced. That silenced
  // nine classes of genuinely missing hook — including the concrete paths an
  // ECC install writes into settings.json — while the suite stayed green,
  // because the one test covering an out-of-root token asserted the silence.

  t('a missing absolute hook outside every audited root is still reported', () => {
    const fx = makeFixture();
    const outside = path.join(fx.root, 'elsewhere', 'x.py');
    writeSettings(fx.home, ONE_HOOK(`python3 "${outside}" --start`));
    const r = run('--startup', fx);
    assert.ok(r.stdout.includes('missing script'),
      `an out-of-root missing hook is a real finding, got: ${r.stdout.trim()}`);
    assert.ok(r.stdout.includes('x.py'), 'the finding must name the file');
  });

  t('a missing hook reached by escaping a root is still reported', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(pluginRoot, { recursive: true });
    for (const rel of ['../elsewhere/x.py', '../../elsewhere/x.py']) {
      writeSettings(fx.home, ONE_HOOK(`python3 "${rel}" --start`));
      const r = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
      assert.ok(r.stdout.includes('missing script'),
        `${rel} escapes the roots and is still a real finding, got: ${r.stdout.trim()}`);
    }
  });

  t('a POSIX absolute missing hook is reported', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('python3 /opt/hooks/claude-guard.py --start'));
    const r = run('--startup', fx);
    assert.ok(r.stdout.includes('missing script'),
      `a system-wide hook path is a real finding, got: ${r.stdout.trim()}`);
  });

  // --- inline one-liners are not shell paths ------------------------------
  // ECC's canonical plugin shape is `node -e "<bootstrap>" node <script>`. The
  // script names inside the -e payload are JavaScript string literals handed
  // to path.join(); reporting them missing is a false alarm, and it was the
  // single largest source of them.

  t('a path inside an inline node -e payload is not a script reference', () => {
    const fx = makeFixture();
    const cmd = 'node -e "const p=require(\'path\');const s=p.join(r,'
      + '\'scripts/hooks/ghost-never-created.js\');require(s)"'
      + ' node scripts/hooks/run-with-flags.js pre:x scripts/hooks/doc-file-warning.js standard,strict';
    writeSettings(fx.home, ONE_HOOK(cmd));
    const r = run('--startup', fx);
    assert.ok(!r.stdout.includes('ghost-never-created.js'),
      `a path inside a -e payload is JavaScript source, got: ${r.stdout.trim()}`);
  });

  t('a real argument after an inline payload is still audited', () => {
    const fx = makeFixture();
    const cmd = 'node -e "require(\'x\')" node scripts/hooks/actually-missing.js';
    writeSettings(fx.home, ONE_HOOK(cmd));
    const r = run('--startup', fx);
    assert.ok(r.stdout.includes('actually-missing.js'),
      'skipping the payload must not skip what follows it');
  });

  // The repo's own wiring, as data. This is the shape the maintainer meant by
  // "normal plugin-style ECC hooks", so it is the one that has to stay quiet.
  t('the repo\'s own 23 plugin hook commands produce no false warning', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const real = fs.readFileSync(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8');
    const fx = makeFixture();
    writeSettings(fx.home, real);
    const r = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: repoRoot });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!r.stdout.includes('missing script'),
      `the repo's own hook wiring must audit clean, got:\n${r.stdout.trim()}`);
  });

  // --- quoting ------------------------------------------------------------
  // A hook command is a shell command line. Splitting it on whitespace turns
  // "C:\Program Files\ecc\hooks\guard.py" into a path that does not exist.

  t('a quoted hook path containing a space stays one token', () => {
    const fx = makeFixture();
    const dir = path.join(fx.home, 'Program Files', 'ecc', 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'guard.py'), '', 'utf8');
    writeSettings(fx.home, ONE_HOOK(`python3 "${path.join(dir, 'guard.py')}" --start`));
    const present = run('--startup', fx);
    assert.ok(!present.stdout.includes('missing script'),
      `a path with a space must not be split, got: ${present.stdout.trim()}`);

    const gone = path.join(dir, 'gone.py');
    writeSettings(fx.home, ONE_HOOK(`python3 "${gone}" --start`));
    const missing = run('--startup', fx);
    assert.ok(missing.stdout.includes('Program Files'),
      `the whole path must be reported, got: ${missing.stdout.trim()}`);
  });

  // --- a relative hook is not confined to one directory -------------------
  // A bare relative path does not say which directory the hook runs from.

  t('a relative hook that exists under the plugin root is not reported', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(path.join(pluginRoot, 'scripts', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, 'scripts', 'hooks', 'dispatcher.js'), '', 'utf8');
    writeSettings(fx.home, ONE_HOOK('node scripts/hooks/dispatcher.js'));
    const r = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.ok(!r.stdout.includes('missing script'),
      `the script exists under a root the hook may run from, got: ${r.stdout.trim()}`);
  });

  t('a relative hook missing under every root is reported', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(pluginRoot, { recursive: true });
    writeSettings(fx.home, ONE_HOOK('node scripts/hooks/nowhere.js'));
    const r = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.ok(r.stdout.includes('nowhere.js'), 'missing everywhere is still a finding');
  });

  // --- $HOME is in the allowlist -----------------------------------------

  t('$HOME, ${HOME} and ~ are judged alike', () => {
    const fx = makeFixture();
    const rel = '.claude/scripts/home-guard.py';
    for (const form of ['$HOME', '${HOME}', '$USERPROFILE', '~']) {
      writeSettings(fx.home, ONE_HOOK(`python3 "${form}/${rel}" --start`));
      const missing = run('--startup', fx);
      assert.ok(missing.stdout.includes('home-guard.py'),
        `${form} must resolve to the audited home, got: ${missing.stdout.trim()}`);
    }
    fs.mkdirSync(path.join(fx.home, '.claude', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fx.home, '.claude', 'scripts', 'home-guard.py'), '', 'utf8');
    for (const form of ['$HOME', '${HOME}', '$USERPROFILE', '~']) {
      writeSettings(fx.home, ONE_HOOK(`python3 "${form}/${rel}" --start`));
      const present = run('--startup', fx);
      assert.ok(!present.stdout.includes('missing script'),
        `${form} must not warn about a file that exists, got: ${present.stdout.trim()}`);
    }
  });

  // --- the plugin root has to be the directory we think it is -------------

  t('a ~-prefixed plugin root is expanded before the containment check', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
    // The discriminating case is the *missing* file: if the root had failed to
    // expand, the path would be unbuildable and the finding would vanish.
    writeSettings(fx.home, PLUGIN_HOOKS_JSON('hooks/gone.py'));
    const r = run('--startup', fx, '', {
      CLAUDE_PLUGIN_ROOT: '~/plugin', USERPROFILE: fx.root, HOME: fx.root,
    });
    assert.ok(r.stdout.includes('gone.py'),
      `a ~-prefixed root must still be auditable, got: ${r.stdout.trim()}`);
  });

  t('CONFIG_HEALTH_PLUGIN_ROOT pins the root the provider cannot express', () => {
    const fx = makeFixture();
    const pluginA = path.join(fx.root, 'plugin-a');
    const pluginB = path.join(fx.root, 'plugin-b');
    fs.mkdirSync(path.join(pluginA, 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(pluginB, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(pluginB, 'hooks', 'guard.py'), '', 'utf8');
    writeSettings(fx.home, PLUGIN_HOOKS_JSON('hooks/guard.py'));

    // CLAUDE_PLUGIN_ROOT is the *running* plugin's root, so a settings line
    // wired for a second plugin is judged against the wrong directory. That
    // limitation is real; the override is the honest escape hatch.
    const wrongRoot = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginA });
    assert.ok(wrongRoot.stdout.includes('missing script'),
      'a settings line wired for another plugin is judged against the running one');
    const pinned = run('--startup', fx, '', {
      CLAUDE_PLUGIN_ROOT: pluginA, CONFIG_HEALTH_PLUGIN_ROOT: pluginB,
    });
    assert.ok(!pinned.stdout.includes('missing script'),
      `the override must win, got: ${pinned.stdout.trim()}`);
  });

  // --- what the findings depend on ----------------------------------------

  t('findings are a function of the settings and the CONFIG_HEALTH_* env', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
    writeSettings(fx.home, PLUGIN_HOOKS_JSON('hooks/guard.py'));

    const withRoot = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.ok(withRoot.stdout.includes('missing script'), 'a root set makes the path judgeable');
    assert.strictEqual(withRoot.stdout,
      run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot }).stdout,
      'same settings and same env must give byte-identical output');

    // This is also the Standalone install documented in the skill: a user-level
    // script run with no plugin root in its environment. There is no path to
    // build, so there is no finding — and no finding is not the same thing as
    // the file being verified.
    const standalone = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: '' });
    assert.ok(!standalone.stdout.includes('missing script'),
      `an unresolvable placeholder must be skipped, got: ${standalone.stdout.trim()}`);
  });

  t('two spellings of one placeholder are one finding', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(pluginRoot, { recursive: true });
    writeSettings(fx.home, JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [
        { type: 'command', command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/g.py"' },
        { type: 'command', command: 'python3 "$CLAUDE_PLUGIN_ROOT/hooks/g.py"' },
      ] }] },
    }));
    const r = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    const hits = (r.stdout.match(/g\.py/g) || []).length;
    assert.strictEqual(hits, 1, `expected one finding for one file, got ${hits}`);
  });

  t('a single-quoted placeholder is skipped, not expanded', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
    // Both directions are needed. With an existing file, deleting the
    // single-quote rule still looks silent, because the placeholder would
    // expand to a file that is there — the test would pass on broken code.
    fs.writeFileSync(path.join(pluginRoot, 'hooks', 'guard.py'), '', 'utf8');
    writeSettings(fx.home, ONE_HOOK("python3 '${CLAUDE_PLUGIN_ROOT}/hooks/guard.py'"));
    const present = run('--check', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.ok(!present.stdout.includes('missing script'),
      `a single-quoted placeholder has no buildable path, got: ${present.stdout.trim()}`);
    assert.ok(present.stdout.includes('not audited'),
      `and the skip must be counted, got: ${present.stdout.trim()}`);

    writeSettings(fx.home, ONE_HOOK("python3 '${CLAUDE_PLUGIN_ROOT}/hooks/never-exists.py'"));
    const absent = run('--check', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.ok(!absent.stdout.includes('missing script'),
      `expanding a single-quoted placeholder would invent a path, got: ${absent.stdout.trim()}`);
    assert.ok(absent.stdout.includes('not audited'),
      `and that skip must be counted too, got: ${absent.stdout.trim()}`);
  });

  // A substituted path that escapes by a separator boundary: `plugin-backup`
  // is a different directory from `plugin`, and a prefix match would take it
  // for a child of it.
  t('a sibling directory sharing a root name prefix is not inside it', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    const sibling = path.join(fx.root, 'plugin-backup');
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.mkdirSync(path.join(sibling, 'hooks'), { recursive: true });
    writeSettings(fx.home, PLUGIN_HOOKS_JSON('../plugin-backup/hooks/gone.py'));
    const r = run('--check', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.ok(/not audited/.test(r.stdout),
      `escaping by prefix must not be judged, got: ${r.stdout.trim()}`);
  });

  t('every script extension the monitor documents is recognised', () => {
    const fx = makeFixture();
    for (const ext of ['py', 'js', 'mjs', 'cjs', 'sh']) {
      writeSettings(fx.home, HOOKS_JSON(`.claude/scripts/ghost.${ext}`));
      const r = run('--startup', fx);
      assert.ok(r.stdout.includes(`ghost.${ext}`),
        `.${ext} is in the documented set and must be audited, got: ${r.stdout.trim()}`);
    }
  });

  // Dedupe is on the normalized path, so spellings differing only in
  // separators are one file, not two.
  t('dedupe survives spellings that differ only in path separators', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(pluginRoot, { recursive: true });
    writeSettings(fx.home, JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [
        { type: 'command', command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/g.py"' },
        { type: 'command', command: 'python3 "${CLAUDE_PLUGIN_ROOT}/./hooks/g.py"' },
        { type: 'command', command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/./g.py"' },
      ] }] },
    }));
    const r = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    const hits = (r.stdout.match(/g\.py/g) || []).length;
    assert.strictEqual(hits, 1, `expected one finding for one file, got ${hits}`);
  });

  t('case-differing spellings are one file on Windows', () => {
    if (process.platform !== 'win32') return; // normcase is identity on POSIX
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
    writeSettings(fx.home, JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [
        { type: 'command', command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/Ghost.py"' },
        { type: 'command', command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/ghost.py"' },
        { type: 'command', command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/GHOST.py"' },
      ] }] },
    }));
    const r = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    const hits = (r.stdout.match(/host\.py/gi) || []).length;
    assert.strictEqual(hits, 1,
      `Windows paths are case-insensitive, so these are one file, got ${hits}`);
  });

  // "non-blocking — always exits 0" is the contract. A crash in a hook
  // degrades the session it is meant to be watching, and a handler that exits
  // non-zero is indistinguishable from a monitor that found something.
  t('an unexpected exception still exits 0 with no traceback', () => {
    const fx = makeFixture();
    writeSettings(fx.home, HOOKS_JSON('~/.claude/scripts/missing-again.py'));
    // Control: without the injected fault the finding is on stdout, so the
    // silence below is the handler and not a script that never ran.
    const control = run('--check', fx);
    assert.ok(control.stdout.includes('missing-again.py'),
      'the control run must actually reach the audit');

    const harness = [
      'import os, runpy, sys',
      'def boom(*a, **k):',
      "    raise RuntimeError('injected fault')",
      'os.path.exists = boom',
      'sys.argv = ["config-health.py", MODE]',
      'runpy.run_path(SCRIPT, run_name="__main__")',
    ].join('\n');
    for (const mode of ['--check', '--startup', '--pretool']) {
      const r = spawnSync(PYTHON, ['-c', harness
        .replace('MODE', JSON.stringify(mode))
        .replace('SCRIPT', JSON.stringify(SCRIPT))], {
        env: {
          ...process.env,
          CONFIG_HEALTH_USER_HOME: fx.home,
          CLAUDE_PROJECT_DIR: fx.proj,
        },
        input: '{}',
        encoding: 'utf8',
      });
      assert.strictEqual(r.status, 0, `${mode} must exit 0 on an internal fault, got ${r.status}`);
      assert.ok(!/Traceback|Error/.test(r.stdout + r.stderr),
        `${mode} must not raise: ${(r.stdout + r.stderr).slice(0, 200)}`);
      assert.strictEqual(r.stdout, '', `${mode} must not print a half-finished report`);
    }
  });

  // --- a blind spot nobody can see is not a health check -------------------

  t('--check reports how many hook paths it did not audit', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('python3 "${CLAUDE_ENV_FILE}/hooks/x.py"'));
    const r = run('--check', fx, '', { CLAUDE_ENV_FILE: '' });
    assert.ok(r.stdout.includes('not audited'),
      `the blind spot must be visible, got: ${r.stdout.trim()}`);
  });

  t('--check names the plugin root it judged against', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(pluginRoot, { recursive: true });
    const r = run('--check', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.ok(r.stdout.includes(pluginRoot),
      `a wrong-root false positive must be diagnosable, got: ${r.stdout.trim()}`);
  });

  // --- program bodies, quoting, and the backslash -------------------------
  // A second adversarial pass found that the first fix of these introduced a
  // Windows regression: treating every backslash as a shell escape turned
  // C:\Users\me\guard.py into C:Usersmeguard.py, a false alarm on the
  // platform this script is developed on. These pin the corrected rules.

  t('an unquoted Windows path keeps its backslashes', () => {
    const fx = makeFixture();
    const dir = path.join(fx.home, 'back', 'slash');
    fs.mkdirSync(dir, { recursive: true });
    const present = path.join(dir, 'win.py');
    fs.writeFileSync(present, '', 'utf8');
    writeSettings(fx.home, ONE_HOOK(`python3 ${present}`));
    const ok = run('--startup', fx);
    assert.ok(!ok.stdout.includes('missing script'),
      `a Windows path must not be unescaped into nonsense, got: ${ok.stdout.trim()}`);

    writeSettings(fx.home, ONE_HOOK(`python3 ${path.join(dir, 'gone.py')}`));
    const missing = run('--startup', fx);
    assert.ok(missing.stdout.includes('gone.py'),
      `and the missing case must still be reported, got: ${missing.stdout.trim()}`);
  });

  t('a shell -c body is scanned as a command line again', () => {
    const fx = makeFixture();
    const cmd = `sh -c "python3 ${path.join(fx.root, 'nowhere', 'ghost.py')}"`;
    writeSettings(fx.home, ONE_HOOK(cmd));
    const r = run('--startup', fx);
    assert.ok(r.stdout.includes('ghost.py'),
      `the shell will open that file, so it must be reported, got: ${r.stdout.trim()}`);
  });

  t('bundled and long-form program flags are recognised', () => {
    const fx = makeFixture();
    for (const flag of ['-c', '-lc', '--command']) {
      writeSettings(fx.home, ONE_HOOK(`bash ${flag} "python3 .claude/scripts/ghost.py"`));
      const r = run('--startup', fx);
      assert.ok(r.stdout.includes('ghost.py'),
        `${flag} takes a command body and must not hide the reference, got: ${r.stdout.trim()}`);
    }
  });

  t('a node -e body is skipped, and the argument after it is not', () => {
    const fx = makeFixture();
    for (const cmd of [
      'node -e "const s=p.join(r,\'scripts/hooks/never-created.js\')" node scripts/hooks/ghost.js',
      'node --eval "const s=1" node scripts/hooks/ghost.js',
      'node -e const s = p.join(r, "scripts/hooks/never-created.js") ; node scripts/hooks/ghost.js',
    ]) {
      writeSettings(fx.home, ONE_HOOK(cmd));
      const r = run('--startup', fx);
      assert.ok(r.stdout.includes('ghost.js'),
        `the real argument must survive the body, got: ${r.stdout.trim()}`);
      assert.ok(!r.stdout.includes('never-created.js'),
        `a string inside the body is not a file, got: ${r.stdout.trim()}`);
    }
  });

  t('an unclosed quote is skipped, counted, and reported by --check', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('python3 ".claude/scripts/ghost.py --start'));
    const r = run('--check', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!r.stdout.includes('missing script'),
      `an unparseable command must not produce a guess, got: ${r.stdout.trim()}`);
    assert.ok(/unclosed quote/.test(r.stdout),
      `but it must not be invisible either, got: ${r.stdout.trim()}`);
  });

  t('a relative hook satisfied only outside the project is disclosed', () => {
    const fx = makeFixture();
    fs.mkdirSync(path.join(fx.home, '.claude', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fx.home, '.claude', 'scripts', 'home-only.py'), '', 'utf8');
    writeSettings(fx.home, HOOKS_JSON('.claude/scripts/home-only.py'));
    const r = run('--check', fx);
    assert.ok(r.stdout.includes('satisfied by the user home or plugin root'),
      `the cross-root trade must be visible, got: ${r.stdout.trim()}`);
  });

  t('an option between the interpreter and -c does not orphan the body', () => {
    const fx = makeFixture();
    // The payload is chosen per interpreter: a shell body is a command line
    // and is rescanned, a python body is source and is not a file reference.
    const cases = [
      ['bash -x -c "python3 .claude/scripts/ghost.py"', 'ghost.py'],
      ['bash -o pipefail -c "python3 .claude/scripts/ghost.py"', 'ghost.py'],
      ['sh -lc "python3 .claude/scripts/ghost.py"', 'ghost.py'],
      ['bash -x -lc "python3 .claude/scripts/ghost.py"', 'ghost.py'],
      ['python3 -u -c "print(1)" .claude/scripts/ghost.py', 'ghost.py'],
    ];
    for (const [cmd, expected] of cases) {
      writeSettings(fx.home, ONE_HOOK(cmd));
      const r = run('--startup', fx);
      assert.ok(r.stdout.includes(expected),
        `${cmd} must still reach the reference, got: ${r.stdout.trim()}`);
      assert.ok(!r.stdout.includes('python3 .claude/scripts/ghost.py'),
        `a whole payload must never be printed as a path, got: ${r.stdout.trim()}`);
    }
  });

  t('a separator inside quotes is part of the name, not a separator', () => {
    const fx = makeFixture();
    for (const name of ['weird;name.py', 'a|b.py', 'a&b.py']) {
      writeSettings(fx.home, ONE_HOOK(`python3 ".claude/scripts/${name}"`));
      const r = run('--startup', fx);
      assert.ok(r.stdout.includes(name),
        `${name} is a legal filename, got: ${r.stdout.trim()}`);
    }
  });

  t('an unclosed quote inside a payload is counted, not dropped', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('sh -c "python3 .claude/scripts/ghost.py && echo \\"oops"'));
    const r = run('--check', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!r.stdout.includes('missing script'),
      `an unparseable payload must not produce a guess, got: ${r.stdout.trim()}`);
    assert.ok(/unclosed quote/.test(r.stdout),
      `and the outer command must be reported as unparsed, got: ${r.stdout.trim()}`);
  });

  t('Windows paths a POSIX escaper would mangle survive intact', () => {
    const fx = makeFixture();
    // A UNC prefix is two backslashes, not an escaped one. Collapsing it to
    // \server\share invents a rooted path that was never written.
    writeSettings(fx.home, ONE_HOOK(String.raw`python3 \\server\share\ghost.py`));
    const unc = run('--startup', fx);
    assert.ok(unc.stdout.includes(String.raw`\\server\share\ghost.py`),
      `a UNC path must be reported whole, got: ${unc.stdout.trim()}`);

    // C:\$Recycle.Bin: the $ reads as a shell placeholder, so the token is
    // skipped — but skipped and counted, not escaped into C:Recycle.Bin.
    writeSettings(fx.home, ONE_HOOK(String.raw`python3 C:\$Recycle.Bin\ghost.py`));
    const dollar = run('--check', fx);
    assert.ok(!dollar.stdout.includes('C:Recycle.Bin'),
      `a backslash must not escape the dollar, got: ${dollar.stdout.trim()}`);
    assert.ok(/not audited/.test(dollar.stdout),
      `and the skip must be counted, got: ${dollar.stdout.trim()}`);
  });

  t('a skipped program body is counted, not dropped silently', () => {
    const fx = makeFixture();
    // A file named inside a node -e body is a string in another language and
    // cannot be checked. Silence is right; silence with no count is not.
    writeSettings(fx.home, ONE_HOOK(
      'node -e "const s=p.join(r,\'.claude/scripts/ghost.js\')" node .claude/scripts/real.py'));
    const r = run('--check', fx);
    assert.ok(!r.stdout.includes('ghost.js'),
      `a string inside a JS body is not a file, got: ${r.stdout.trim()}`);
    assert.ok(/program body/.test(r.stdout),
      `but the unjudged body must be visible, got: ${r.stdout.trim()}`);
  });

  t('the repo\'s own hook wiring is fully accounted for', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const real = fs.readFileSync(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8');
    const fx = makeFixture();
    writeSettings(fx.home, real);
    const r = run('--check', fx, '', { CLAUDE_PLUGIN_ROOT: repoRoot });
    assert.ok(r.stdout.includes('[ok] normal'),
      `a healthy install must be healthy, got: ${r.stdout.trim()}`);
    // Every one of the 23 commands hides a program body, and every relative
    // reference resolves through the plugin root. If those two counts ever go
    // to zero, the numbers below are no longer describing anything.
    const bodies = Number((r.stdout.match(/(\d+) interpreter program body/) || [])[1]);
    const other = Number((r.stdout.match(/(\d+) relative hook path/) || [])[1]);
    assert.ok(bodies >= 20, `expected ~23 skipped bodies, got ${bodies}`);
    assert.ok(other >= 10, `expected plugin-root-satisfied paths, got ${other}`);
  });

  t('a longer name whose prefix is a script name is not truncated to it', () => {
    const fx = makeFixture();
    const dir = path.join(fx.proj, 'scripts', 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    // The shell opens these files. A regex without an end guard matches the
    // prefix and warns about a file that does not exist.
    for (const name of ['archive.js.bak', 'buf.py.map', 'guard.pyc', 'ok.py~']) {
      fs.writeFileSync(path.join(dir, name), '', 'utf8');
      writeSettings(fx.home, ONE_HOOK(`python3 scripts/hooks/${name}`));
      const r = run('--startup', fx);
      assert.ok(!r.stdout.includes('missing script'),
        `${name} exists; a prefix match would warn about a different file, got: ${r.stdout.trim()}`);
    }
    fs.writeFileSync(path.join(dir, 'gone.js.bak'), '', 'utf8');
    writeSettings(fx.home, ONE_HOOK('python3 scripts/hooks/absent.js.bak'));
    const missing = run('--startup', fx);
    assert.ok(!missing.stdout.includes('missing script'),
      `and an absent one is not a script reference either, got: ${missing.stdout.trim()}`);
  });

  t('sh -e is errexit, not a program body', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('sh -e .claude/scripts/ghost.py'));
    const r = run('--startup', fx);
    assert.ok(r.stdout.includes('ghost.py'),
      `sh -e runs the next word as a script, got: ${r.stdout.trim()}`);
  });

  t('a one-word quoted command is not reported as one long path', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('"python3 .claude/scripts/ghost.js"'));
    const r = run('--startup', fx);
    assert.ok(r.stdout.includes('missing script: .claude/scripts/ghost.js'),
      `the interpreter must be stripped, got: ${r.stdout.trim()}`);
    assert.ok(!r.stdout.includes('missing script: python3'),
      `a finding must never quote a whole command, got: ${r.stdout.trim()}`);
  });

  t('a very long token is clipped rather than printed in full', () => {
    const fx = makeFixture();
    const long = 'a'.repeat(5000) + '.py';
    writeSettings(fx.home, ONE_HOOK(`python3 ${long}`));
    const r = run('--startup', fx);
    const line = (r.stdout.split('\n').find((l) => l.includes('missing script')) || '');
    assert.ok(line.length > 0, 'expected a finding');
    assert.ok(line.length < 300, `a finding must stay readable, got ${line.length} chars`);
    assert.ok(/chars total/.test(line), 'clipping must say it clipped');
  });

  t('a settings file that cannot be read is not reported as healthy', () => {
    const fx = makeFixture();
    for (const junk of ['{ not valid json', '[1,2,3]', '{"hooks": 42}', '']) {
      writeSettings(fx.home, junk);
      const r = run('--check', fx);
      assert.strictEqual(r.status, 0, `expected exit 0 for ${JSON.stringify(junk)}`);
      assert.ok(!r.stdout.includes('[ok] normal'),
        `an unreadable settings file must not read as healthy, got: ${r.stdout.trim()}`);
      assert.ok(/could not be read/.test(r.stdout),
        `and it must say which file, got: ${r.stdout.trim()}`);
    }
  });

  t('a settings file that is simply absent is not a finding', () => {
    const fx = makeFixture();
    const r = run('--check', fx);
    assert.ok(r.stdout.includes('[ok] normal'),
      `no settings file means nothing to audit, got: ${r.stdout.trim()}`);
  });

  t('deep sh -c nesting is counted without losing the outer findings', () => {
    const fx = makeFixture();
    // MAX_PAYLOAD_DEPTH is 3, so four levels is the first that runs out. The
    // flag has to survive the recursion, not just the level that trips it.
    const payload = 'sh -c '.repeat(6) + 'true';
    writeSettings(fx.home, ONE_HOOK(`python3 .claude/scripts/early.py && ${payload}`));
    const r = run('--check', fx);
    assert.ok(r.stdout.includes('early.py'),
      `a missing script before the deep part is still missing, got: ${r.stdout.trim()}`);
    assert.ok(/nested sh -c deeper/.test(r.stdout),
      `and the depth limit must be disclosed, got: ${r.stdout.trim()}`);
    assert.ok(!/unclosed quote/.test(r.stdout),
      `balanced quotes are not a typo, got: ${r.stdout.trim()}`);
  });

  t('nesting inside the limit is not reported as too deep', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('python3 .claude/scripts/early.py && sh -c sh -c true'));
    const r = run('--check', fx);
    assert.ok(!/nested sh -c deeper/.test(r.stdout),
      `two levels is ordinary, got: ${r.stdout.trim()}`);
  });

  // --- unchanged vs changed settings --------------------------------------

  t('an unchanged settings file yields the same finding on repeat runs', () => {
    const fx = makeFixture();
    writeSettings(fx.home, HOOKS_JSON('~/.claude/scripts/missing-again.py'));
    const first = run('--startup', fx);
    const second = run('--startup', fx);
    assert.strictEqual(first.stdout, second.stdout,
      'deterministic: same config must give byte-identical output');
  });

  t('changing settings changes the finding', () => {
    const fx = makeFixture();
    writeSettings(fx.home, HOOKS_JSON('~/.claude/scripts/missing-again.py'));
    const before = run('--startup', fx);
    assert.ok(before.stdout.includes('missing-again.py'), 'expected the first finding');
    fs.mkdirSync(path.join(fx.home, '.claude', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fx.home, '.claude', 'scripts', 'missing-again.py'), '', 'utf8');
    const after = run('--startup', fx);
    assert.ok(!after.stdout.includes('missing script'),
      `repairing the file must clear the finding, got: ${after.stdout.trim()}`);
  });

  t('a duplicate reference is reported once per event', () => {
    const fx = makeFixture();
    writeSettings(fx.home, JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [
          { type: 'command', command: 'python3 ~/.claude/scripts/dup.py --a' },
          { type: 'command', command: 'python3 ~/.claude/scripts/dup.py --b' },
        ] }],
      },
    }));
    const r = run('--startup', fx);
    const hits = (r.stdout.match(/dup\.py/g) || []).length;
    assert.strictEqual(hits, 1, `expected one finding for a repeated token, got ${hits}`);
  });

  t('CLAUDE_CONFIG_DIR moves the audited user settings file', () => {
    const fx = makeFixture();
    const configDir = path.join(fx.root, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      ONE_HOOK('python3 ~/.claude/scripts/from-config.py'),
      'utf8'
    );
    writeSettings(fx.home, ONE_HOOK('python3 ~/.claude/scripts/from-home.py'));

    const r = run('--startup', fx, '', { CLAUDE_CONFIG_DIR: configDir });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('from-config.py'),
      `expected the settings in $CLAUDE_CONFIG_DIR to be audited, got: ${r.stdout.trim()}`);
    assert.ok(!r.stdout.includes('from-home.py'),
      'settings under ~/.claude must not be audited when CLAUDE_CONFIG_DIR is set');

    const check = run('--check', fx, '', { CLAUDE_CONFIG_DIR: configDir });
    assert.ok(check.stdout.includes('$CLAUDE_CONFIG_DIR resolved to'),
      '--check must name the non-default data root it resolved');
  });

  t('CLAUDE_CONFIG_DIR moves the rule-health log', () => {
    const fx = makeFixture();
    const configDir = path.join(fx.root, 'config');
    const dataDir = path.join(configDir, 'session-data');
    fs.mkdirSync(dataDir, { recursive: true });
    const records = Array.from({ length: 5 }, (_, index) => JSON.stringify({
      ts: `2026-10-2${index}T00:00:00Z`,
      tool_calls: 6,
      configured_rule: 0,
    }));
    fs.writeFileSync(path.join(dataDir, 'rule-health.jsonl'), records.join('\n') + '\n', 'utf8');

    const homeData = path.join(fx.home, '.claude', 'session-data');
    fs.mkdirSync(homeData, { recursive: true });
    fs.writeFileSync(
      path.join(homeData, 'rule-health.jsonl'),
      records.map(line => line.replace('configured_rule', 'home_rule')).join('\n') + '\n',
      'utf8'
    );

    const r = run('--startup', fx, '', { CLAUDE_CONFIG_DIR: configDir });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('configured_rule'),
      `expected staleness to be read from $CLAUDE_CONFIG_DIR, got: ${r.stdout.trim()}`);
    assert.ok(!r.stdout.includes('home_rule'),
      'the rule-health log under ~/.claude must not be read when CLAUDE_CONFIG_DIR is set');
  });

  t('installed module survives install, startup, repair, and uninstall in a disposable home', () => {
    const fx = makeInstallFixture();
    const env = installEnv(fx);
    const installedScript = path.join(fx.config, 'scripts', 'config-health.py');
    const installedSkill = path.join(fx.config, 'skills', 'config-health', 'SKILL.md');
    const settingsPath = path.join(fx.config, 'settings.json');

    const install = runNode('scripts/install-apply.js',
      ['--target', 'claude', '--modules', 'config-health', '--json'], env);
    assert.strictEqual(install.status, 0,
      `install failed: ${(install.stderr || install.stdout).trim()}`);
    assert.ok(fs.existsSync(installedScript),
      `installed script missing at ${installedScript}`);
    assert.ok(fs.existsSync(installedSkill),
      `installed skill missing at ${installedSkill}`);

    const installedSettings = fs.existsSync(settingsPath)
      ? fs.readFileSync(settingsPath, 'utf8')
      : '';
    assert.ok(!installedSettings.includes('config-health.py --pretool'),
      'the default install must not add a per-tool hook');

    // The opt-in pre-tool path must work from the disposable project install,
    // not only from the in-repo fixture.
    fs.writeFileSync(settingsPath,
      ONE_HOOK(`python3 "${installedScript}" --pretool`), 'utf8');
    const pretoolProject = runInstalledWithInput('--pretool', fx, '{"tool_name":"Edit"}');
    assert.strictEqual(pretoolProject.status, 0,
      `installed project pre-tool must exit 0, got ${pretoolProject.status}`);
    assert.strictEqual(pretoolProject.stdout, '',
      `installed project pre-tool stdout must stay clean: ${pretoolProject.stdout.trim()}`);
    assert.ok(!pretoolProject.stderr.includes('references missing script'),
      `installed project pre-tool must not warn: ${pretoolProject.stderr.trim()}`);

    // The same pre-tool path with a plugin-root command, from the same
    // disposable install.
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(path.join(pluginRoot, 'scripts', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, 'scripts', 'hooks', 'guard.py'), '', 'utf8');
    fs.writeFileSync(settingsPath, PLUGIN_HOOKS_JSON('scripts/hooks/guard.py'), 'utf8');
    const pretoolPlugin = runInstalledWithInput('--pretool', fx, '{"tool_name":"Edit"}',
      { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.strictEqual(pretoolPlugin.status, 0,
      `installed plugin pre-tool must exit 0, got ${pretoolPlugin.status}`);
    assert.strictEqual(pretoolPlugin.stdout, '',
      `installed plugin pre-tool stdout must stay clean: ${pretoolPlugin.stdout.trim()}`);
    assert.ok(!pretoolPlugin.stderr.includes('references missing script'),
      `installed plugin pre-tool must not warn: ${pretoolPlugin.stderr.trim()}`);

    fs.writeFileSync(settingsPath, PLUGIN_HOOKS_JSON('scripts/ghost.py'), 'utf8');
    const startup = runInstalled('--startup', fx, { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.strictEqual(startup.status, 0,
      `startup must stay non-blocking, got ${startup.status}`);
    assert.ok(startup.stdout.includes('references missing script'),
      `a real missing plugin script must warn, got: ${startup.stdout.trim()}`);
    assert.ok(startup.stdout.includes('ghost.py'),
      'the warning must name the missing plugin script');

    fs.writeFileSync(settingsPath,
      ONE_HOOK('python3 "${CONFIG_HEALTH_TEST_UNSET_ROOT}/scripts/x.py"'), 'utf8');
    const check = runInstalled('--check', fx);
    assert.strictEqual(check.status, 0, `--check exits 0, got ${check.status}`);
    assert.ok(check.stdout.includes('hook path(s) not audited'),
      `an unresolved provider root must be reported as unjudged, got: ${check.stdout.trim()}`);
    assert.ok(!check.stdout.includes('references missing script'),
      'an unresolved provider root must not be reported as a missing script');

    fs.unlinkSync(installedScript);
    const repair = runNode('scripts/repair.js', ['--target', 'claude', '--json'], env);
    assert.strictEqual(repair.status, 0,
      `repair failed: ${(repair.stderr || repair.stdout).trim()}`);
    assert.ok(fs.existsSync(installedScript), 'repair must restore the installed script');

    const uninstall = runNode('scripts/uninstall.js', ['--target', 'claude', '--json'], env);
    assert.strictEqual(uninstall.status, 0,
      `uninstall failed: ${(uninstall.stderr || uninstall.stdout).trim()}`);
    assert.ok(!fs.existsSync(installedScript), 'uninstall must remove the installed script');
    assert.ok(!fs.existsSync(installedSkill), 'uninstall must remove the installed skill');
  });

  t('project install runs the pre-tool workflow from a disposable project', () => {
    const fx = makeInstallFixture();
    const env = installEnv(fx);
    const installScript = path.join(__dirname, '..', '..', 'scripts', 'install-apply.js');

    const install = spawnSync(process.execPath,
      [installScript, '--target', 'claude-project', '--modules', 'config-health', '--json'],
      { cwd: fx.proj, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120000 });
    assert.strictEqual(install.status, 0,
      `project install failed: ${(install.stderr || install.stdout).trim()}`);

    const installedScript = path.join(fx.proj, '.claude', 'scripts', 'config-health.py');
    const settingsPath = path.join(fx.proj, '.claude', 'settings.json');
    assert.ok(fs.existsSync(installedScript),
      `project install must place the script at ${installedScript}`);

    fs.writeFileSync(settingsPath,
      ONE_HOOK('python3 .claude/scripts/config-health.py --pretool'), 'utf8');
    const pretool = spawnSync(PYTHON, [installedScript, '--pretool'], {
      cwd: fx.proj,
      env: { ...process.env, ...env, CLAUDE_PROJECT_DIR: fx.proj },
      input: '{"tool_name":"Edit"}',
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.strictEqual(pretool.status, 0,
      `project pre-tool must exit 0, got ${pretool.status}`);
    assert.strictEqual(pretool.stdout, '',
      `project pre-tool stdout must stay clean: ${pretool.stdout.trim()}`);
    assert.ok(!pretool.stderr.includes('references missing script'),
      `project pre-tool must not warn: ${pretool.stderr.trim()}`);
  });

  console.log(`\n  ${passed}/${total} passed`);
  if (passed !== total) process.exit(1);
}


runTests();
