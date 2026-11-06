/**
 * Hook-contract tests for scripts/config-health.py: resolution, wording, and
 * non-blocking behavior.
 *
 * Run with: node tests/hooks/config-health.test.js
 * (also picked up by `node tests/run-all.js`)
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  SCRIPT,
  PYTHON,
  test,
  makeFixture,
  run,
  writeSettings,
  HOOKS_JSON,
  ONE_HOOK,
  PLUGIN_HOOKS_JSON,
} = require('./config-health-helpers');

function runTests() {
  console.log('\n=== Testing config-health.py hook contract: resolution and wording ===\n');
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

  // ECC installs rules under nested namespaces; a flat-only pattern missed
  // every one of those, so a missing nested reference reported healthy.
  t('startup warns on a missing nested rule reference', () => {
    const fx = makeFixture();
    fs.writeFileSync(path.join(fx.proj, 'CLAUDE.md'),
      'see rules/ecc/common/security.md and .claude/rules/ecc/common/style.md\n', 'utf8');
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('rules/ecc/common/security.md'),
      `expected the nested reference to be audited, got: ${r.stdout.trim()}`);
    assert.ok(r.stdout.includes('rules/ecc/common/style.md'),
      `expected the .claude-prefixed nested reference to be audited, got: ${r.stdout.trim()}`);
  });

  t('a nested rule reference that exists is not reported', () => {
    const fx = makeFixture();
    fs.mkdirSync(path.join(fx.proj, 'rules', 'ecc', 'common'), { recursive: true });
    fs.writeFileSync(path.join(fx.proj, 'rules', 'ecc', 'common', 'security.md'), '# x\n', 'utf8');
    fs.writeFileSync(path.join(fx.proj, 'CLAUDE.md'),
      'see rules/ecc/common/security.md\n', 'utf8');
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!r.stdout.includes('missing rule file'),
      `an existing nested rule must stay silent, got: ${r.stdout.trim()}`);
  });

  // settings.local.json wins over both settings files, so a hook declared only
  // there is live. Not reading it turns a broken hook into a clean report.
  t('a missing hook declared only in settings.local.json is reported', () => {
    const fx = makeFixture();
    fs.writeFileSync(path.join(fx.proj, '.claude', 'settings.local.json'),
      ONE_HOOK('python3 .claude/scripts/ghost-local.py'), 'utf8');
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('ghost-local.py'),
      `expected the local settings hook to be audited, got: ${r.stdout.trim()}`);
  });

  // A plugin's own hooks/hooks.json runs without any settings file naming it.
  t('a missing hook declared only in plugin hooks/hooks.json is reported', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'),
      PLUGIN_HOOKS_JSON('scripts/hooks/ghost-plugin.py'), 'utf8');
    const r = run('--startup', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('ghost-plugin.py'),
      `expected the plugin hook source to be audited, got: ${r.stdout.trim()}`);
  });

  // A positive count in a short session is still a firing. The complexity
  // filter decides whether a rule *should* fire, not whether it did.
  t('a rule that fired in a short recent session is not called dead', () => {
    const fx = makeFixture();
    const dataDir = path.join(fx.home, '.claude', 'session-data');
    fs.mkdirSync(dataDir, { recursive: true });
    const records = [
      ...Array.from({ length: 4 }, (_, index) => JSON.stringify({
        ts: `2026-10-2${index}T00:00:00Z`, tool_calls: 10, live_rule: 0,
      })),
      JSON.stringify({ ts: '2026-10-30T00:00:00Z', tool_calls: 1, live_rule: 3 }),
    ];
    fs.writeFileSync(path.join(dataDir, 'rule-health.jsonl'),
      records.join('\n') + '\n', 'utf8');
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!r.stdout.includes('live_rule'),
      `a rule that fired inside the window must not be called dead: ${r.stdout.trim()}`);
  });

  t('a rule with zero counts across five complex sessions is reported stale', () => {
    const fx = makeFixture();
    const dataDir = path.join(fx.home, '.claude', 'session-data');
    fs.mkdirSync(dataDir, { recursive: true });
    const records = Array.from({ length: 5 }, (_, index) => JSON.stringify({
      ts: `2026-10-2${index}T00:00:00Z`, tool_calls: 10, dead_rule: 0,
    }));
    fs.writeFileSync(path.join(dataDir, 'rule-health.jsonl'),
      records.join('\n') + '\n', 'utf8');
    const r = run('--startup', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('dead_rule') && r.stdout.includes('has not fired'),
      `expected the stale rule to be named, got: ${r.stdout.trim()}`);
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
  console.log(`\n  ${passed}/${total} passed`);
  if (passed !== total) process.exit(1);
}


runTests();
