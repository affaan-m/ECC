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
const sessionStartBootstrap = path.join(repoRoot, 'scripts', 'hooks', 'session-start-bootstrap.js');
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
writeFixture('buffer.js', "module.exports.run = () => Buffer.from('buffer output');\n");
writeFixture('stdout.js', "module.exports.run = () => ({ stdout: 'object stdout' });\n");
writeFixture('context.js', "module.exports.run = () => ({ additionalContext: 'context output' });\n");
writeFixture('stderr.js', "module.exports.run = () => ({ stderr: 'diagnostic only', exitCode: 0 });\n");
writeFixture('nonzero.js', "module.exports.run = () => ({ stderr: 'blocked', exitCode: 7 });\n");
writeFixture('nonzero-output.js', "module.exports.run = () => ({ stdout: 'blocking output', stderr: 'blocked', exitCode: 7 });\n");
writeFixture('direct-echo.js', 'module.exports.run = raw => raw;\n');
writeFixture(
  'inspect-input.js',
  "module.exports.run = (raw, context) => JSON.stringify({ raw, bytes: Buffer.byteLength(raw, 'utf8'), truncated: context.truncated, maxStdin: context.maxStdin });\n"
);
writeFixture('legacy-empty.js', "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));\n");
writeFixture('legacy-echo.js', 'process.stdin.pipe(process.stdout);\n');
writeFixture(
  'legacy-inspect.js',
  "let raw=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { raw += chunk; }); process.stdin.on('end', () => process.stdout.write(JSON.stringify({ bytes: Buffer.byteLength(raw, 'utf8'), truncated: process.env.ECC_HOOK_INPUT_TRUNCATED, maxStdin: process.env.ECC_HOOK_INPUT_MAX_BYTES })));\n"
);

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

function runConfiguredHook(entry, env = {}, input = payload) {
  return spawnSync(entry.hooks[0].command, {
    input,
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

function runSessionStartBootstrapWithMissingRoot(input = payload) {
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-start-missing-root-'));
  fs.rmSync(missingRoot, { recursive: true, force: true });
  return spawnSync(process.execPath, [sessionStartBootstrap], {
    input,
    encoding: 'utf8',
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: missingRoot,
      ECC_PLUGIN_ROOT: missingRoot
    },
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024
  });
}

function runConfiguredHookWithMissingRoot(entry, input = payload) {
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hook-missing-root-'));
  fs.rmSync(missingRoot, { recursive: true, force: true });
  return runConfiguredHook(
    entry,
    { CLAUDE_PLUGIN_ROOT: missingRoot, ECC_PLUGIN_ROOT: missingRoot },
    input
  );
}

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    return true;
  } catch (error) {
    console.log(`  [FAIL] ${name}`);
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

const silentCases = [
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

for (const [name, args, env] of silentCases) {
  if (test(`${name} emits empty stdout`, () => assertSilent(run(args, env)))) passed++;
  else failed++;
}

const explicitCases = [
  ['string output', 'hooks/explicit.js', 'explicit output'],
  ['Buffer output', 'hooks/buffer.js', 'buffer output'],
  ['stdout property', 'hooks/stdout.js', 'object stdout']
];

for (const [name, fixture, expected] of explicitCases) {
  if (
    test(`preserves explicit ${name}`, () => {
      const result = run(['post:test', fixture, 'standard']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, expected);
    })
  )
    passed++;
  else failed++;
}

if (
  test('preserves additionalContext output', () => {
    const result = run(['post:test', 'hooks/context.js', 'standard']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: 'context output'
      }
    });
  })
)
  passed++;
else failed++;

if (
  test('preserves stderr while keeping diagnostic-only success silent', () => {
    const result = run(['post:test', 'hooks/stderr.js', 'standard']);
    assertSilent(result);
    assert.match(result.stderr, /diagnostic only/);
  })
)
  passed++;
else failed++;

if (
  test('preserves a nonzero exit code and stderr without synthesizing stdout', () => {
    const result = run(['post:test', 'hooks/nonzero.js', 'standard']);
    assert.strictEqual(result.status, 7);
    assert.strictEqual(result.stdout, '');
    assert.match(result.stderr, /blocked/);
  })
)
  passed++;
else failed++;

if (
  test('preserves explicit stdout together with a nonzero exit code', () => {
    const result = run(['post:test', 'hooks/nonzero-output.js', 'standard']);
    assert.strictEqual(result.status, 7);
    assert.strictEqual(result.stdout, 'blocking output');
    assert.match(result.stderr, /blocked/);
  })
)
  passed++;
else failed++;

if (
  test('preserves direct hook output that explicitly equals stdin', () => {
    const result = run(['post:test', 'hooks/direct-echo.js', 'standard']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, payload);
  })
)
  passed++;
else failed++;

if (
  test('preserves legacy hook output that explicitly equals stdin', () => {
    const result = run(['post:test', 'hooks/legacy-echo.js', 'standard']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, payload);
  })
)
  passed++;
else failed++;

if (
  test('ECC_HOOK_INPUT_MAX_BYTES controls the runner cap and in-process context', () => {
    const result = run(
      ['post:test', 'hooks/inspect-input.js', 'standard'],
      { ECC_HOOK_INPUT_MAX_BYTES: '128' },
      'x'.repeat(256)
    );
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      raw: 'x'.repeat(128),
      bytes: 128,
      truncated: true,
      maxStdin: 128
    });
    assert.match(result.stderr, /stdin exceeded 128 bytes/);
  })
)
  passed++;
else failed++;

if (
  test('stdin cap counts UTF-8 bytes at an exact multibyte boundary', () => {
    const input = String.fromCodePoint(0xe9).repeat(2);
    const result = run(
      ['post:test', 'hooks/inspect-input.js', 'standard'],
      { ECC_HOOK_INPUT_MAX_BYTES: '4' },
      input
    );
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      raw: input,
      bytes: 4,
      truncated: false,
      maxStdin: 4
    });
  })
)
  passed++;
else failed++;

if (
  test('stdin cap discards an incomplete UTF-8 sequence at truncation', () => {
    const character = String.fromCodePoint(0xe9);
    const result = run(
      ['post:test', 'hooks/inspect-input.js', 'standard'],
      { ECC_HOOK_INPUT_MAX_BYTES: '3' },
      character.repeat(2)
    );
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      raw: character,
      bytes: 2,
      truncated: true,
      maxStdin: 3
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
        ['post:test', 'hooks/inspect-input.js', 'standard'],
        { ECC_HOOK_INPUT_MAX_BYTES: configuredLimit }
      );
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(JSON.parse(result.stdout).maxStdin, 1024 * 1024);
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
  test('legacy hooks receive the resolved stdin cap and truncation flag', () => {
    const result = run(
      ['post:test', 'hooks/legacy-inspect.js', 'standard'],
      { ECC_HOOK_INPUT_MAX_BYTES: '128' },
      'x'.repeat(256)
    );
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      bytes: 128,
      truncated: '1',
      maxStdin: '128'
    });
  })
)
  passed++;
else failed++;

for (const [eventName, entries] of Object.entries(hooksConfig.hooks)) {
  if (eventName === 'Stop') continue;
  for (const entry of entries) {
    if (
      test(`${eventName}/${entry.id} registered disabled path stays silent`, () => {
        const result = runConfiguredHook(entry, { ECC_DISABLED_HOOKS: entry.id });
        assertSilent(result);
      })
    )
      passed++;
    else failed++;
  }
}

const sessionEndEntry = hooksConfig.hooks.SessionEnd.find(entry => entry.id === 'session:end:marker');
if (
  test('SessionEnd unresolved-root fallback stays silent', () => {
    const result = runConfiguredHookWithMissingRoot(sessionEndEntry);
    assertSilent(result);
    assert.match(result.stderr, /lifecycle bootstrap unavailable/);
  })
)
  passed++;
else failed++;

for (const hookId of [
  'pre:bash:dispatcher',
  'pre:config-protection',
  'pre:edit-write:gateguard-fact-force',
  'pre:mcp-health-check'
]) {
  if (
    test(`${hookId} blocks registered PreToolUse input that was truncated`, () => {
      const entry = hooksConfig.hooks.PreToolUse.find(candidate => candidate.id === hookId);
      const input = JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: hookId === 'pre:bash:dispatcher' ? 'Bash' : 'Write',
        tool_input: {
          command: 'rm -rf /important/data',
          file_path: '/src/important.js',
          content: 'x'.repeat(256)
        }
      });
      const result = runConfiguredHook(entry, {
        ECC_DISABLED_HOOKS: '',
        ECC_DRY_RUN: '',
        ECC_HOOK_INPUT_MAX_BYTES: '64'
      }, input);
      assert.strictEqual(result.status, 2, result.stderr);
      assert.strictEqual(result.stdout, '');
      assert.match(result.stderr, /complete request|truncated payload/);
      assert.match(result.stderr, /bootstrap: stdin exceeded 64 bytes/);
    })
  )
    passed++;
  else failed++;
}

for (const env of [
  { ECC_GATEGUARD: 'off' },
  { GATEGUARD_DISABLED: '1' }
]) {
  if (
    test('GateGuard recovery controls allow truncated input without stdout', () => {
      const entry = hooksConfig.hooks.PreToolUse.find(
        candidate => candidate.id === 'pre:edit-write:gateguard-fact-force'
      );
      const input = JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '/src/recovery.js', content: 'x'.repeat(256) }
      });
      const result = runConfiguredHook(entry, {
        ECC_DISABLED_HOOKS: '',
        ECC_DRY_RUN: '',
        ECC_HOOK_INPUT_MAX_BYTES: '64',
        ...env
      }, input);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, '');
    })
  )
    passed++;
  else failed++;
}

if (
  test('MCP health recovery control allows truncated input without stdout', () => {
    const entry = hooksConfig.hooks.PreToolUse.find(
      candidate => candidate.id === 'pre:mcp-health-check'
    );
    const input = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__unhealthy__search',
      tool_input: { query: 'x'.repeat(256) }
    });
    const result = runConfiguredHook(entry, {
      ECC_DISABLED_HOOKS: '',
      ECC_DRY_RUN: '',
      ECC_HOOK_INPUT_MAX_BYTES: '64',
      ECC_MCP_HEALTH_FAIL_OPEN: 'yes'
    }, input);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
  })
)
  passed++;
else failed++;

if (
  test('SessionStart bootstrap unresolved-root fallback stays silent', () => {
    const result = runSessionStartBootstrapWithMissingRoot();
    assertSilent(result);
    assert.match(result.stderr, /could not resolve ECC plugin root/);
  })
)
  passed++;
else failed++;

fs.rmSync(pluginRoot, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
