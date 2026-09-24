/**
 * Tests for consolidated Bash hook dispatchers.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const preDispatcher = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-bash-dispatcher.js');
const postDispatcher = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'post-bash-dispatcher.js');

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

function runScript(scriptPath, input, env = {}) {
  return spawnSync('node', [scriptPath], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
    timeout: 10000,
  });
}

function parseHookOutput(stdout) {
  return JSON.parse(stdout);
}

function runTests() {
  console.log('\n=== Testing Bash hook dispatchers ===\n');

  let passed = 0;
  let failed = 0;

  if (test('pre dispatcher blocks --no-verify before other Bash checks', () => {
    const input = { tool_input: { command: 'git commit --no-verify -m "x"' } };
    const result = runScript(preDispatcher, input, { ECC_HOOK_PROFILE: 'strict' });
    assert.strictEqual(result.status, 2, 'Expected dispatcher to block git hook bypass');
    assert.ok(result.stderr.includes('--no-verify'), 'Expected block-no-verify reason in stderr');
    assert.strictEqual(result.stdout, '', 'Blocking hook should not pass through stdout');
  })) passed++; else failed++;

  if (test('pre dispatcher still honors per-hook disable flags', () => {
    const input = { tool_input: { command: 'git push origin main' } };

    const enabled = runScript(preDispatcher, input, { ECC_HOOK_PROFILE: 'strict' });
    assert.strictEqual(enabled.status, 0);
    assert.strictEqual(enabled.stderr, '', `Expected visible reminder via stdout JSON, got stderr: ${enabled.stderr}`);
    assert.ok(
      parseHookOutput(enabled.stdout).hookSpecificOutput.additionalContext.includes('Review changes before push'),
      'Expected git push reminder when enabled'
    );

    const disabled = runScript(preDispatcher, input, {
      ECC_HOOK_PROFILE: 'strict',
      ECC_DISABLED_HOOKS: 'pre:bash:git-push-reminder',
    });
    assert.strictEqual(disabled.status, 0);
    assert.strictEqual(disabled.stdout, JSON.stringify(input), 'Disabled hook should pass through original input');
    assert.ok(!disabled.stderr.includes('Review changes before push'), 'Disabled hook should not emit reminder');
  })) passed++; else failed++;

  if (test('pre dispatcher respects hook profiles inside the consolidated path', () => {
    const input = { tool_input: { command: 'git push origin main' } };
    const result = runScript(preDispatcher, input, { ECC_HOOK_PROFILE: 'minimal' });
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, '', 'Strict-only reminders should stay disabled in minimal profile');
    assert.strictEqual(result.stdout, JSON.stringify(input));
  })) passed++; else failed++;

  if (test('post dispatcher writes both bash audit and cost logs in one pass', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-bash-dispatcher-'));
    const payload = { tool_input: { command: 'npm publish --token=$PUBLISH_TOKEN' } };

    try {
      const result = runScript(postDispatcher, payload, {
        HOME: homeDir,
        USERPROFILE: homeDir,
      });
      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stdout, JSON.stringify(payload));

      const auditLog = fs.readFileSync(path.join(homeDir, '.claude', 'bash-commands.log'), 'utf8');
      const costLog = fs.readFileSync(path.join(homeDir, '.claude', 'cost-tracker.log'), 'utf8');

      assert.ok(auditLog.includes('--token=<REDACTED>'));
      assert.ok(costLog.includes('tool=Bash command=npm publish --token=<REDACTED>'));
      assert.ok(!auditLog.includes('$PUBLISH_TOKEN'));
      assert.ok(!costLog.includes('$PUBLISH_TOKEN'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('post dispatcher preserves PR-created hints after consolidated execution', () => {
    const payload = {
      tool_input: { command: 'gh pr create --title "Fix bug" --body "desc"' },
      tool_output: { output: 'https://github.com/owner/repo/pull/42\n' },
    };
    const result = runScript(postDispatcher, payload);
    assert.strictEqual(result.status, 0);
    assert.ok(result.stderr.includes('PR created: https://github.com/owner/repo/pull/42'));
    assert.ok(result.stderr.includes('gh pr review 42 --repo owner/repo'));
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
