/**
 * Tests for install_hook_graph in thaint-setup/setup_claude.sh
 *
 * The function is extracted from the script at run time and executed against a
 * scratch CLAUDE_HOME, so these always test what is on disk. It merges a hook
 * graph into a user's real settings.json, which makes classification and
 * idempotency the things worth pinning.
 *
 * Run with: node tests/scripts/install-hook-graph.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', '..', 'thaint-setup', 'setup_claude.sh');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    return false;
  }
}

const GRAPH = {
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node scripts/hooks/pre-bash-dispatcher.js' }] }],
    Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'node scripts/hooks/cost-tracker.js' }] }],
  },
};

const ECC_HOOKS = ['pre-bash-dispatcher', 'cost-tracker', 'block-no-verify', 'quality-gate', 'insaits-security-wrapper'];

// npx entry: superseded by the dispatcher, and named without a path, which is
// why classification matches bare hook names rather than file paths.
// my-notify: names no ECC hook, so it is the user's and must survive.
const EXISTING = {
  PreToolUse: [
    { matcher: 'Bash', hooks: [{ type: 'command', command: 'npx block-no-verify@1.1.2' }] },
    { matcher: 'Write', hooks: [{ type: 'command', command: 'node /home/me/my-hooks/my-notify.js' }] },
    { matcher: '*', hooks: [{ type: 'command', command: 'node scripts/hooks/insaits-security-wrapper.js' }] },
  ],
  Notification: [{ matcher: '', hooks: [{ type: 'command', command: 'node /x/telegram-notify.js' }] }],
};

/**
 * Build a scratch source tree + CLAUDE_HOME and run install_hook_graph in it.
 * @param {object} opts - hookFiles, existingHooks, claudeStub (bash body), runs
 * @returns {object} { status, stdout, stderr, settings, dir }
 */
function runGraph(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-graph-'));
  const source = path.join(dir, 'src');
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(source, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(source, 'scripts', 'hooks'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  fs.writeFileSync(path.join(source, 'hooks', 'hooks.json'), JSON.stringify(GRAPH));
  for (const name of opts.hookFiles === undefined ? ECC_HOOKS : opts.hookFiles) {
    fs.writeFileSync(path.join(source, 'scripts', 'hooks', `${name}.js`), '// fixture\n');
  }
  const settings = { statusLine: { type: 'command', command: 'node ecc-statusline.js' } };
  if (opts.existingHooks !== null) settings.hooks = opts.existingHooks || EXISTING;
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify(settings, null, 2));

  let pathPrefix = '';
  if (opts.claudeStub) {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env bash\n${opts.claudeStub}\n`, { mode: 0o755 });
    pathPrefix = `export PATH="${bin}:$PATH"\n`;
  }

  const body = fs.readFileSync(SCRIPT, 'utf8');
  const fn = body.match(/^install_hook_graph\(\) \{[\s\S]*?^\}/m);
  assert.ok(fn, 'could not extract install_hook_graph from the script');

  const harness = path.join(dir, 'run.sh');
  fs.writeFileSync(
    harness,
    `set -euo pipefail
${pathPrefix}TAG=test
DRY_RUN=${opts.dryRun ? 1 : 0}
VERBOSE=0
PRUNE=0
CLAUDE_HOME="${home}"
SOURCE="${source}"
GRAPH_EXEMPT='["insaits-security","telegram-notify"]'
log()  { printf '[log] %s\\n' "$*"; }
warn() { printf '[warn] %s\\n' "$*" >&2; }
die()  { printf '[die] %s\\n' "$*" >&2; exit 1; }
run()  { "$@"; }
${fn[0]}
for _ in $(seq 1 ${opts.runs || 1}); do install_hook_graph; done
`
  );

  const r = spawnSync('bash', [harness], { encoding: 'utf8', timeout: 60000 });
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
  } catch {
    /* left unparsed for the caller to assert on */
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', settings: parsed, dir };
}

const commands = hooks => JSON.stringify(hooks || {});

function runTests() {
  console.log('\n=== Testing install_hook_graph ===\n');
  let passed = 0;
  let failed = 0;

  const base = runGraph();

  if (
    test('wires the graph entries', () => {
      assert.strictEqual(base.status, 0, `exit ${base.status}: ${base.stderr}`);
      const all = commands(base.settings.hooks);
      assert.ok(all.includes('pre-bash-dispatcher.js'), 'graph PreToolUse entry missing');
      assert.ok(all.includes('cost-tracker.js'), 'graph Stop entry missing');
    })
  )
    passed++;
  else failed++;

  if (
    test('replaces an entry the graph supersedes, including the npx spelling', () => {
      assert.ok(!commands(base.settings.hooks).includes('npx block-no-verify'), 'npx entry survived');
      assert.ok(base.stderr.includes('dropping hook entry'), 'the drop was not reported');
    })
  )
    passed++;
  else failed++;

  if (
    test('keeps an entry that names no ECC hook', () => {
      assert.ok(commands(base.settings.hooks).includes('my-notify.js'), 'the user hook was deleted');
    })
  )
    passed++;
  else failed++;

  if (
    test('keeps the exempt insaits and telegram entries', () => {
      const all = commands(base.settings.hooks);
      assert.ok(all.includes('insaits-security-wrapper.js'), 'insaits entry was dropped');
      assert.ok(all.includes('telegram-notify.js'), 'telegram entry was dropped');
    })
  )
    passed++;
  else failed++;

  if (
    test('leaves statusLine alone', () => {
      assert.strictEqual(base.settings.statusLine.command, 'node ecc-statusline.js');
    })
  )
    passed++;
  else failed++;

  if (
    test('is idempotent — three runs produce the same .hooks as one', () => {
      const thrice = runGraph({ runs: 3 });
      assert.strictEqual(thrice.status, 0, `exit ${thrice.status}: ${thrice.stderr}`);
      assert.strictEqual(commands(thrice.settings.hooks), commands(base.settings.hooks));
    })
  )
    passed++;
  else failed++;

  // Regression for the GNU-only `find -printf` this used to enumerate hook
  // names with. An empty name list classifies nothing as ECC-owned, so the
  // graph would be appended again on every run instead of replacing.
  if (
    test('refuses to run when no hook scripts can be enumerated', () => {
      const empty = runGraph({ hookFiles: [] });
      assert.notStrictEqual(empty.status, 0, 'expected a non-zero exit');
      assert.ok(empty.stderr.includes('no hook scripts found'), `expected a diagnostic, got: ${empty.stderr}`);
      assert.ok(commands(empty.settings.hooks).includes('npx block-no-verify'), 'settings were rewritten despite the abort');
    })
  )
    passed++;
  else failed++;

  if (
    test('starts from nothing when settings.json has no .hooks', () => {
      const fresh = runGraph({ existingHooks: null });
      assert.strictEqual(fresh.status, 0, `exit ${fresh.status}: ${fresh.stderr}`);
      assert.ok(commands(fresh.settings.hooks).includes('pre-bash-dispatcher.js'));
    })
  )
    passed++;
  else failed++;

  if (
    test('skips itself when ECC is installed as a plugin', () => {
      const plugin = runGraph({ claudeStub: 'echo everything-claude-code@marketplace' });
      assert.strictEqual(plugin.status, 0, `exit ${plugin.status}: ${plugin.stderr}`);
      assert.ok(!commands(plugin.settings.hooks).includes('pre-bash-dispatcher.js'), 'wired despite the plugin');
      assert.ok(plugin.stderr.includes('installed as a plugin'), 'no explanation was given');
    })
  )
    passed++;
  else failed++;

  // A failing CLI produces no stdout, which reads exactly like "no plugin".
  // Wiring anyway is the right call, but it has to say so.
  if (
    test('warns, rather than staying silent, when the plugin list cannot be read', () => {
      const broken = runGraph({ claudeStub: 'echo "auth expired" >&2; exit 1' });
      assert.strictEqual(broken.status, 0, `exit ${broken.status}: ${broken.stderr}`);
      assert.ok(broken.stderr.includes('could not read the plugin list'), `expected a warning, got: ${broken.stderr}`);
      assert.ok(commands(broken.settings.hooks).includes('pre-bash-dispatcher.js'), 'should still wire');
    })
  )
    passed++;
  else failed++;

  if (
    test('--dry-run writes nothing', () => {
      const dry = runGraph({ dryRun: true });
      assert.strictEqual(dry.status, 0, `exit ${dry.status}: ${dry.stderr}`);
      assert.strictEqual(commands(dry.settings.hooks), commands(EXISTING));
    })
  )
    passed++;
  else failed++;

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

const { failed } = runTests();
process.exit(failed > 0 ? 1 : 0);
