'use strict';

const assert = require('assert');
const path = require('path');

const script = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'sandbox-escalation-suggest.js');
const hook = require(script);

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    return false;
  }
}

function enabledEnv(overrides = {}) {
  return { ...process.env, ECC_HOOK_PROFILE: 'standard', ...overrides };
}

const results = [];

console.log('\n=== Sandbox escalation suggestion hook ===\n');

results.push(test('recognizes strong sandbox denial families', () => {
  for (const message of [
    'sandbox denied file-write-data /usr/local/bin/tool',
    'bwrap: setting up uid map: Operation not permitted',
    'EROFS: read-only file system, open /etc/tool.conf',
    'npm ERR! code EPERM',
    'network access denied by policy',
  ]) {
    assert.strictEqual(hook.isSandboxDenial(message), true, message);
  }
}));

results.push(test('requires isolation context for generic permission failures', () => {
  assert.strictEqual(hook.isSandboxDenial('permission denied while opening /usr/local/bin/tool'), true);
  assert.strictEqual(hook.isSandboxDenial('remote API permission denied for account'), false);
}));

results.push(test('extracts only failure output, not the attempted command', () => {
  const text = hook.extractFailureText({
    tool_input: { command: "printf 'operation not permitted'" },
    tool_output: { stderr: 'ordinary exit 1' },
  });
  assert.ok(!text.includes('operation not permitted'));
  assert.strictEqual(hook.isSandboxDenial(text), false);
}));

results.push(test('emits non-blocking PostToolUseFailure context for Bash denial', () => {
  const result = hook.run(JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'npm install -g example' },
    tool_output: { stderr: 'npm ERR! code EPERM' },
  }), { env: enabledEnv(), cliAvailable: true, cliPath: '/trusted/ecc/scripts/sandbox/ecc-sandbox' });
  assert.strictEqual(result.exitCode, 0);
  const output = JSON.parse(result.stdout);
  assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  assert.match(output.hookSpecificOutput.additionalContext, /sandbox\.yaml/);
  assert.match(output.hookSpecificOutput.additionalContext, /trusted ECC CLI/);
  assert.match(output.hookSpecificOutput.additionalContext, /scripts\/sandbox\/ecc-sandbox'/);
  assert.match(output.hookSpecificOutput.additionalContext, /repository-local ecc-sandbox lookalike/);
  assert.match(output.hookSpecificOutput.additionalContext, /at most one recorded escalation/);
}));

results.push(test('points an ecc-sandbox failure back to its JSON report', () => {
  const result = hook.run(JSON.stringify({
    tool_input: { command: 'scripts/sandbox/ecc-sandbox run sandbox.yaml' },
    error: 'sandbox denied operation',
  }), { env: enabledEnv() });
  const output = JSON.parse(result.stdout);
  assert.match(output.hookSpecificOutput.additionalContext, /emitted JSON report/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /then run it/);
}));

results.push(test('recognizes quoted ecc-sandbox invocations as existing runs', () => {
  for (const command of [
    '"scripts/sandbox/ecc-sandbox" run sandbox.yaml',
    "'scripts/sandbox/ecc-sandbox' run sandbox.yaml",
  ]) {
    const result = hook.run(JSON.stringify({
      tool_input: { command },
      error: 'sandbox denied operation',
    }), { env: enabledEnv() });
    const output = JSON.parse(result.stdout);
    assert.match(output.hookSpecificOutput.additionalContext, /emitted JSON report/);
  }
}));

results.push(test('shell-quotes a trusted CLI path containing apostrophes', () => {
  const message = hook.suggestion({}, {
    cliAvailable: true,
    cliPath: "/opt/ECC user's/scripts/sandbox/ecc-sandbox",
  });
  assert.match(message, /'"'"'/);
  assert.match(message, /trusted ECC CLI/);
}));

results.push(test('gives one runtime setup command when a managed install lacks the CLI', () => {
  const message = hook.suggestion({}, { cliAvailable: false });
  assert.match(message, /npm install --global ecc-universal/);
  assert.match(message, /then preview with ecc-sandbox/);
  assert.doesNotMatch(message, /'[^']*scripts\/sandbox\/ecc-sandbox'/);
}));

results.push(test('stays silent for unrelated failure, malformed input, truncation, and disabled profile', () => {
  assert.strictEqual(hook.run('{', { env: enabledEnv() }).stdout, '');
  assert.strictEqual(hook.run(JSON.stringify({ error: 'assertion failed' }), { env: enabledEnv() }).stdout, '');
  assert.strictEqual(hook.run(JSON.stringify({ error: 'EPERM' }), { env: enabledEnv(), truncated: true }).stdout, '');
  assert.strictEqual(hook.run(JSON.stringify({ error: 'EPERM' }), {
    env: enabledEnv({ ECC_DISABLED_HOOKS: 'post:bash-failure:sandbox-escalation-suggest' }),
  }).stdout, '');
}));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} tests passed`);
if (passed !== results.length) process.exitCode = 1;
