/**
 * Regression tests for #2600: silent hook paths must not echo stdin.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const runner = path.join(repoRoot, 'scripts', 'hooks', 'run-with-flags.js');
const hooksConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hook-no-output-'));
const hooksDir = path.join(pluginRoot, 'hooks');
fs.mkdirSync(hooksDir, { recursive: true });

const payload = JSON.stringify({
  hook_event_name: 'PostToolUse',
  tool_name: 'Read',
  tool_input: { file_path: 'README.md' },
  tool_response: { content: 'payload that must not be duplicated' }
});

function writeFixture(name, source) {
  fs.writeFileSync(path.join(hooksDir, name), source);
}

writeFixture('undefined.js', "module.exports.run = () => undefined;\n");
writeFixture('object.js', "module.exports.run = () => ({ exitCode: 0 });\n");
writeFixture('throws.js', "module.exports.run = () => { throw new Error('fixture failure'); };\n");
writeFixture('explicit.js', "module.exports.run = () => 'explicit output';\n");
writeFixture('direct-echo.js', 'module.exports.run = raw => raw;\n');
writeFixture(
  'inspect-input.js',
  "module.exports.run = (raw, context) => JSON.stringify({ raw, bytes: Buffer.byteLength(raw, 'utf8'), truncated: context.truncated });\n"
);
writeFixture('legacy-empty.js', "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));\n");
writeFixture('legacy-echo.js', 'process.stdin.pipe(process.stdout);\n');

function run(args, env = {}, input = payload) {
  return spawnSync(process.execPath, [runner, ...args], {
    input,
    encoding: 'utf8',
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      ECC_HOOK_PROFILE: 'standard',
      ...env
    },
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024
  });
}

function runRegisteredHook(entry, env = {}) {
  return spawnSync(entry.hooks[0].command, {
    input: payload,
    encoding: 'utf8',
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: repoRoot,
      ECC_PLUGIN_ROOT: repoRoot,
      ECC_HOOK_PROFILE: 'standard',
      ...env
    },
    shell: true,
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024
  });
}

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

function assertSilent(result) {
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '');
}

console.log('\nrun-with-flags no-output contract tests (#2600):');

let passed = 0;
let failed = 0;

const cases = [
  ['missing arguments', [], {}],
  ['disabled hook', ['post:test', 'hooks/undefined.js', 'standard'], { ECC_DISABLED_HOOKS: 'post:test' }],
  ['dry run', ['post:test', 'hooks/undefined.js', 'standard'], { ECC_DRY_RUN: '1' }],
  ['missing script', ['post:test', 'hooks/missing.js', 'standard'], {}],
  ['path traversal rejection', ['post:test', '../outside.js', 'standard'], {}],
  ['undefined run result', ['post:test', 'hooks/undefined.js', 'standard'], {}],
  ['object result without output', ['post:test', 'hooks/object.js', 'standard'], {}],
  ['run exception', ['post:test', 'hooks/throws.js', 'standard'], {}],
  ['legacy process with empty stdout', ['post:test', 'hooks/legacy-empty.js', 'standard'], {}]
];

for (const [name, args, env] of cases) {
  if (test(`${name} emits empty stdout`, () => assertSilent(run(args, env)))) passed++;
  else failed++;
}

if (
  test('explicit hook output is preserved', () => {
    const result = run(['post:test', 'hooks/explicit.js', 'standard']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, 'explicit output');
  })
)
  passed++;
else failed++;

if (
  test('direct hook output equal to stdin is preserved under the cap', () => {
    const result = run(['post:test', 'hooks/direct-echo.js', 'standard']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, payload);
  })
)
  passed++;
else failed++;

if (
  test('legacy hook output equal to stdin is preserved under the cap', () => {
    const result = run(['post:test', 'hooks/legacy-echo.js', 'standard']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, payload);
  })
)
  passed++;
else failed++;

if (
  test('ECC_HOOK_INPUT_MAX_BYTES controls the runner cap', () => {
    const result = run(
      ['post:test', 'hooks/undefined.js', 'standard'],
      { ECC_HOOK_INPUT_MAX_BYTES: '128' },
      payload.repeat(4)
    );
    assertSilent(result);
    assert.match(result.stderr, /stdin exceeded 128 bytes/);
  })
)
  passed++;
else failed++;

if (
  test('stdin cap counts UTF-8 bytes at an exact multibyte boundary', () => {
    const input = 'éé';
    const result = run(
      ['post:test', 'hooks/inspect-input.js', 'standard'],
      { ECC_HOOK_INPUT_MAX_BYTES: '4' },
      input
    );
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      raw: input,
      bytes: 4,
      truncated: false
    });
  })
)
  passed++;
else failed++;

if (
  test('stdin cap discards an incomplete UTF-8 sequence at truncation', () => {
    const result = run(
      ['post:test', 'hooks/inspect-input.js', 'standard'],
      { ECC_HOOK_INPUT_MAX_BYTES: '3' },
      'éé'
    );
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      raw: 'é',
      bytes: 2,
      truncated: true
    });
    assert.match(result.stderr, /stdin exceeded 3 bytes/);
  })
)
  passed++;
else failed++;

if (
  test('invalid stdin caps warn and fall back without disabling hooks', () => {
    for (const configuredLimit of ['0', '-1', '1.5', 'not-a-number']) {
      const result = run(
        ['post:test', 'hooks/direct-echo.js', 'standard'],
        { ECC_HOOK_INPUT_MAX_BYTES: configuredLimit }
      );
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, payload);
      assert.match(result.stderr, /must be a positive safe integer/);
    }
  })
)
  passed++;
else failed++;

if (
  test('stdin cap override cannot exceed the 1 MiB safety maximum', () => {
    const result = run(
      ['post:test', 'hooks/undefined.js', 'standard'],
      { ECC_HOOK_INPUT_MAX_BYTES: String(2 * 1024 * 1024) },
      'x'.repeat(1024 * 1024 + 1)
    );
    assertSilent(result);
    assert.match(result.stderr, /exceeds the 1 MiB safety maximum/);
    assert.match(result.stderr, /stdin exceeded 1048576 bytes/);
  })
)
  passed++;
else failed++;

if (
  test('registered PreToolUse bootstrap keeps a disabled hook silent', () => {
    const entry = hooksConfig.hooks.PreToolUse[0];
    assertSilent(runRegisteredHook(entry, { ECC_DISABLED_HOOKS: entry.id }));
  })
)
  passed++;
else failed++;

if (
  test('registered SessionStart bootstrap keeps a disabled hook silent', () => {
    const entry = hooksConfig.hooks.SessionStart[0];
    assertSilent(runRegisteredHook(entry, { ECC_DISABLED_HOOKS: entry.id }));
  })
)
  passed++;
else failed++;

fs.rmSync(pluginRoot, { recursive: true, force: true });

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
