/**
 * Tests for scripts/hooks/continue-hook-adapter.js
 *
 * Run with: node tests/hooks/continue-hook-adapter.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const adapter = require('../../scripts/hooks/continue-hook-adapter');

const ADAPTER = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'continue-hook-adapter.js');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

function runAdapter(args, payload, env = {}, files = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-cn-hook-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(cwd, name), content);
  const result = spawnSync(process.execPath, [ADAPTER, ...args], {
    cwd,
    input: JSON.stringify({ session_id: 's1', transcript_path: '', cwd, ...payload }),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  fs.rmSync(cwd, { recursive: true, force: true });
  return result;
}

console.log('continue-hook-adapter');

test('normalizePayload maps cn tool names and filepath to Claude Code shape', () => {
  const out = adapter.normalizePayload({ tool_name: 'Search', tool_input: { pattern: 'x' } });
  assert.strictEqual(out.tool_name, 'Grep');
  assert.strictEqual(out.continue_tool_name, 'Search');
  const write = adapter.normalizePayload({ tool_name: 'Write', tool_input: { filepath: 'a.js', content: '' } });
  assert.strictEqual(write.tool_name, 'Write');
  assert.strictEqual(write.tool_input.file_path, 'a.js');
  const multi = adapter.normalizePayload({ tool_name: 'MultiEdit', tool_input: { file_path: 'b.js', edits: [{ old_string: 'a', new_string: 'b' }] } });
  assert.strictEqual(multi.tool_input.edits[0].file_path, 'b.js');
});

test('resolveCommand only runs scripts inside scripts/hooks', () => {
  assert.throws(() => adapter.resolveCommand(['direct', '../../etc/passwd']), /scripts\/hooks/);
  assert.throws(() => adapter.resolveCommand(['run', 'id', 'scripts/lib/utils.js', 'standard']), /scripts\/hooks/);
  assert.throws(() => adapter.resolveCommand(['bogus']), /unknown mode/);
  const args = adapter.resolveCommand(['run', 'pre:x', 'scripts/hooks/doc-file-warning.js', 'strict']);
  assert.ok(args[0].endsWith('run-with-flags.js'));
  assert.deepStrictEqual(args.slice(1), ['pre:x', 'scripts/hooks/doc-file-warning.js', 'strict']);
});

test('splitProfile and buildEnv set defaults without overriding the user', () => {
  assert.deepStrictEqual(adapter.splitProfile(['--profile', 'strict', 'direct', 'x']), { profile: 'strict', rest: ['direct', 'x'] });
  const env = adapter.buildEnv({}, 'strict');
  assert.strictEqual(env.ECC_HOOK_PROFILE, 'strict');
  assert.strictEqual(env.ECC_DISABLED_HOOKS, adapter.DEFAULT_DISABLED);
  assert.strictEqual(env.CLAUDE_PLUGIN_ROOT, adapter.ECC_ROOT);
  const mine = adapter.buildEnv({ ECC_HOOK_PROFILE: 'minimal', ECC_DISABLED_HOOKS: '' }, 'strict');
  assert.strictEqual(mine.ECC_HOOK_PROFILE, 'minimal');
  assert.strictEqual(mine.ECC_DISABLED_HOOKS, '');
});

test('blocks git commit --no-verify sent as a cn Bash payload', () => {
  const r = runAdapter(['direct', 'scripts/hooks/pre-bash-dispatcher.js'], {
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m x' },
  });
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(/no-verify/.test(r.stderr));
});

test('blocks overwriting an existing linter config sent with cn `filepath`', () => {
  const r = runAdapter(['run', 'pre:config-protection', 'scripts/hooks/config-protection.js', 'standard,strict'], {
    hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { filepath: '.eslintrc.js', content: 'x' },
  }, {}, { '.eslintrc.js': 'module.exports = {};\n' });
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(/eslintrc/.test(r.stderr));
});

test('allows an ordinary command', () => {
  const r = runAdapter(['direct', 'scripts/hooks/pre-bash-dispatcher.js'], {
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo hello' },
  });
  assert.strictEqual(r.status, 0, r.stderr);
});

test('misconfiguration never blocks the tool call', () => {
  const r = runAdapter(['direct', '../outside.js'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} });
  assert.strictEqual(r.status, 0);
  assert.ok(r.stderr.includes('[ContinueHookAdapter]'));
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
