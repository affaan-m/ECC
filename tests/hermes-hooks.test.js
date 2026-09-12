/**
 * Tests for hooks/hermes/ — the Hermes-native config-protection and
 * console-log guard hooks.
 *
 * Run standalone: node tests/hermes-hooks.test.js
 * Picked up automatically by tests/run-all.js (glob: tests/ star star /.test.js).
 *
 * Each case feeds a REAL payload through the actual script via spawnSync —
 * same stdin/stdout contract Hermes uses — and asserts on the emitted JSON
 * or stderr. Fail-open paths additionally assert the diagnostic line, so a
 * regression cannot silently disable the policy.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const GUARD = path.join(repoRoot, 'hooks', 'hermes', 'config-protection.py');
const LOGGER = path.join(repoRoot, 'hooks', 'hermes', 'check-console-log.py');

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

/** Run a hook with a payload; return {rc, stdout, stderr} and assert clean spawn. */
function runHook(script, payload) {
  const res = spawnSync('python3', [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.strictEqual(res.error, undefined, `spawn failed: ${res.error}`);
  assert.strictEqual(res.status, 0, `hook must always exit 0 (got ${res.status})`);
  return { stdout: res.stdout, stderr: res.stderr };
}

function decision(stdout) {
  const text = (stdout || '').trim();
  if (!text) return null;
  const parsed = JSON.parse(text);
  assert.ok(
    parsed.decision === 'block' && typeof parsed.reason === 'string' && parsed.reason.length > 0,
    `block decision must carry a reason, got: ${text}`
  );
  return parsed;
}

// ─── config-protection: blocking ───────────────────────────────────────────

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hermes-hooks-'));
const protectedConfigs = [
  'eslint.config.mjs',
  '.eslintrc.json',
  'prettier.config.js',
  'biome.json',
  'ruff.toml',
  'lint-ratchet-baseline.json',
];

let passed = 0;
let failed = 0;
const results = [];

function run(name, fn) {
  const ok = test(name, fn);
  if (ok) passed += 1; else failed += 1;
}

run('blocks edits to every protected config name', () => {
  for (const name of protectedConfigs) {
    const target = path.join(tmp, name);
    fs.writeFileSync(target, '{}\n');
    const { stdout } = runHook(GUARD, {
      hook_event_name: 'pre_tool_call',
      tool_name: 'patch',
      tool_input: { path: target, old_string: 'a', new_string: 'b' },
    });
    const d = decision(stdout);
    assert.ok(d.reason.includes(name), `reason should name ${name}`);
  }
});

run('blocks case-variant names (case-insensitive filesystems)', () => {
  const target = path.join(tmp, 'ESLINT.CONFIG.MJS');
  fs.writeFileSync(path.join(tmp, 'eslint.config.mjs'), 'export default {}\n');
  // On a case-sensitive filesystem the variant is a distinct name; the hook
  // must still refuse it so a macOS/Windows rename cannot smuggle an edit.
  const { stdout } = runHook(GUARD, {
    hook_event_name: 'pre_tool_call',
    tool_name: 'patch',
    tool_input: { path: target, old_string: 'a', new_string: 'b' },
  });
  assert.ok(decision(stdout), 'case variant of a protected name must block');
});

run('blocks a dangling symlink to a protected name', () => {
  const dangling = path.join(tmp, 'eslint.config.cjs');
  try { fs.unlinkSync(dangling); } catch { /* not present yet */ }
  fs.symlinkSync(path.join(tmp, 'does-not-exist-at-all'), dangling);
  // Sanity: the link itself exists (lstat succeeds) but resolves nowhere —
  // os.path.exists() is False here, which is exactly the bypass being pinned.
  assert.ok(fs.lstatSync(dangling).isSymbolicLink(), 'symlink must exist for the case to be real');
  assert.ok(!fs.existsSync(dangling), 'link must dangle for the case to be real');
  const { stdout } = runHook(GUARD, {
    hook_event_name: 'pre_tool_call',
    tool_name: 'patch',
    tool_input: { path: dangling, old_string: 'a', new_string: 'b' },
  });
  assert.ok(decision(stdout), 'dangling symlink to protected name must block');
});

run('blocks paths under edits[] (multi-edit inputs)', () => {
  const target = path.join(tmp, '.eslintrc');
  fs.writeFileSync(target, '{}\n');
  const { stdout } = runHook(GUARD, {
    hook_event_name: 'pre_tool_call',
    tool_name: 'str_replace_editor',
    tool_input: { edits: [{ old_string: 'a', new_string: 'b', file_path: target }] },
  });
  assert.ok(decision(stdout), 'nested edits[] path must block');
});

run('blocks for every recognised editing tool', () => {
  const target = path.join(tmp, 'biome.json');
  fs.writeFileSync(target, '{}\n');
  for (const tool of ['patch', 'write_file', 'edit', 'write', 'apply_patch', 'str_replace_editor']) {
    const { stdout } = runHook(GUARD, {
      hook_event_name: 'pre_tool_call',
      tool_name: tool,
      tool_input: { path: target },
    });
    assert.ok(decision(stdout), `${tool} must be gated`);
  }
});

// ─── config-protection: allowing ───────────────────────────────────────────

run('allows edits to normal source files', () => {
  const target = path.join(tmp, 'src.tsx');
  fs.writeFileSync(target, 'export const x = 1;\n');
  const { stdout, stderr } = runHook(GUARD, {
    hook_event_name: 'pre_tool_call',
    tool_name: 'patch',
    tool_input: { path: target, old_string: '1', new_string: '2' },
  });
  assert.strictEqual(stdout.trim(), '', 'normal edits emit nothing');
  assert.strictEqual(stderr.trim(), '', 'and stay silent');
});

run('allows creating a protected config that does not exist yet', () => {
  const { stdout } = runHook(GUARD, {
    hook_event_name: 'pre_tool_call',
    tool_name: 'write_file',
    tool_input: { path: path.join(tmp, 'fresh-project', '.eslintrc.json'), content: '{}' },
  });
  assert.strictEqual(stdout.trim(), '', 'first-time config creation is allowed');
});

run('allows non-editing tools (read/search)', () => {
  const target = path.join(tmp, '.eslintrc');
  for (const tool of ['read_file', 'search_files', 'terminal']) {
    const { stdout } = runHook(GUARD, {
      hook_event_name: 'pre_tool_call',
      tool_name: tool,
      tool_input: { path: target, pattern: 'x' },
    });
    assert.strictEqual(stdout.trim(), '', `${tool} is never gated`);
  }
});

// ─── config-protection: fail-open + diagnostics ────────────────────────────

run('malformed payload: allows AND reports on stderr', () => {
  const res = spawnSync('python3', [GUARD], { input: 'not-json{{', encoding: 'utf8', timeout: 15000 });
  assert.strictEqual(res.status, 0, 'must exit 0 (fail-open)');
  assert.strictEqual(res.stdout.trim(), '', 'no decision emitted');
  assert.ok(res.stderr.includes('unparseable payload'), 'diagnostic required');
});

run('missing path in tool_input: allows AND reports', () => {
  const { stdout, stderr } = runHook(GUARD, {
    hook_event_name: 'pre_tool_call',
    tool_name: 'patch',
    tool_input: { old_string: 'a', new_string: 'b' },
  });
  assert.strictEqual(stdout.trim(), '');
  assert.ok(stderr.includes('no path found'), 'diagnostic required');
});

// ─── check-console-log ─────────────────────────────────────────────────────

run('warns when an edited file contains console.log()', () => {
  const target = path.join(tmp, 'noisy.ts');
  fs.writeFileSync(target, 'export function f(){ console.log("x"); }\n');
  const { stdout, stderr } = runHook(LOGGER, {
    hook_event_name: 'post_tool_call',
    tool_name: 'write_file',
    tool_input: { path: target, content: 'x' },
  });
  assert.strictEqual(stdout.trim(), '', 'observer emits no stdout JSON');
  assert.ok(stderr.includes('console.log() present'), 'warning required');
});

run('stays silent for clean files, tests, and non-edit tools', () => {
  const clean = path.join(tmp, 'clean.ts');
  fs.writeFileSync(clean, 'export function g(){ return 1; }\n');
  const spec = path.join(tmp, 'thing.spec.ts');
  fs.writeFileSync(spec, 'console.log("in a spec");\n');
  for (const [tool, p] of [['write_file', clean], ['write_file', spec], ['read_file', clean]]) {
    const { stdout, stderr } = runHook(LOGGER, {
      hook_event_name: 'post_tool_call',
      tool_name: tool,
      tool_input: { path: p },
    });
    assert.strictEqual(stdout.trim(), '', 'no stdout');
    assert.ok(!stderr.includes('console.log() present'), `${p} must not warn`);
  }
});

run('unreadable file: skips AND reports on stderr', () => {
  const { stderr } = runHook(LOGGER, {
    hook_event_name: 'post_tool_call',
    tool_name: 'write_file',
    tool_input: { path: path.join(tmp, 'not-on-disk.ts') },
  });
  assert.ok(/not a regular file|skipping/.test(stderr), 'diagnostic required');
});


// --- installer integration: the hermes-hooks module installs and the landed copy runs ---
run('hermes-hooks module installs via the real installer and the landed guard blocks', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mod-'));
  const inst = spawnSync('node', ['scripts/install-apply.js', '--target', 'hermes', '--modules', 'hermes-hooks', '--enable-hooks'], {
    cwd: repoRoot, encoding: 'utf8', env: { ...process.env, HOME: home }, timeout: 60000,
  });
  assert.strictEqual(inst.status, 0, 'installer must exit 0');
  const landed = path.join(home, '.hermes', 'hooks', 'hermes', 'config-protection.py');
  assert.ok(fs.existsSync(landed), 'guard must land under ~/.hermes/hooks/hermes/');
  assert.ok(fs.existsSync(path.join(home, '.hermes', 'docs', 'HERMES-HOOKS.md')), 'doc must land');
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-guard-'));
  const target = path.join(t, 'eslint.config.mjs');
  fs.writeFileSync(target, 'export default {}\n');
  const g = spawnSync('python3', [landed], {
    input: JSON.stringify({ hook_event_name: 'pre_tool_call', tool_name: 'patch', tool_input: { path: target, old_string: 'a', new_string: 'b' } }),
    encoding: 'utf8', timeout: 15000,
  });
  assert.ok((g.stdout || '').includes('"decision": "block"'), 'landed guard must block');
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(t, { recursive: true, force: true });
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
