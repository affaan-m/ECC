/**
 * Tests for scripts/hooks/auto-tmux-dev.js
 *
 * Tests dev server command transformation for tmux wrapping.
 *
 * Run with: node tests/hooks/auto-tmux-dev.test.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'auto-tmux-dev.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function runScript(input) {
  const result = spawnSync('node', [script], {
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input),
    timeout: 10000,
  });
  return {
    code: result.status || 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runTests() {
  console.log('\n=== Testing auto-tmux-dev.js ===\n');

  let passed = 0;
  let failed = 0;

  // Check if tmux is available for conditional tests
  const tmuxAvailable = spawnSync('which', ['tmux'], { encoding: 'utf8' }).status === 0;

  console.log('Dev server detection:');

  if (test('transforms npm run dev command', () => {
    const result = runScript({ tool_input: { command: 'npm run dev' } });
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    if (process.platform !== 'win32' && tmuxAvailable) {
      assert.ok(output.tool_input.command.includes('tmux'), 'Should contain tmux');
      assert.ok(output.tool_input.command.includes('npm run dev'), 'Should contain original command');
    }
  })) passed++; else failed++;

  if (test('transforms pnpm dev command', () => {
    const result = runScript({ tool_input: { command: 'pnpm dev' } });
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    if (process.platform !== 'win32' && tmuxAvailable) {
      assert.ok(output.tool_input.command.includes('tmux'));
    }
  })) passed++; else failed++;

  if (test('transforms yarn dev command', () => {
    const result = runScript({ tool_input: { command: 'yarn dev' } });
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    if (process.platform !== 'win32' && tmuxAvailable) {
      assert.ok(output.tool_input.command.includes('tmux'));
    }
  })) passed++; else failed++;

  if (test('transforms bun run dev command', () => {
    const result = runScript({ tool_input: { command: 'bun run dev' } });
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    if (process.platform !== 'win32' && tmuxAvailable) {
      assert.ok(output.tool_input.command.includes('tmux'));
    }
  })) passed++; else failed++;

  console.log('\nNon-dev commands (pass-through):');

  if (test('does not transform npm install', () => {
    const input = { tool_input: { command: 'npm install' } };
    const result = runScript(input);
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.tool_input.command, 'npm install');
  })) passed++; else failed++;

  if (test('does not transform npm test', () => {
    const input = { tool_input: { command: 'npm test' } };
    const result = runScript(input);
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.tool_input.command, 'npm test');
  })) passed++; else failed++;

  if (test('does not transform npm run build', () => {
    const input = { tool_input: { command: 'npm run build' } };
    const result = runScript(input);
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.tool_input.command, 'npm run build');
  })) passed++; else failed++;

  if (test('does not transform npm run develop (partial match)', () => {
    const input = { tool_input: { command: 'npm run develop' } };
    const result = runScript(input);
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.tool_input.command, 'npm run develop');
  })) passed++; else failed++;

  if (test('does not transform npm run dev-build (hyphenated script)', () => {
    const input = { tool_input: { command: 'npm run dev-build' } };
    const result = runScript(input);
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.tool_input.command, 'npm run dev-build');
  })) passed++; else failed++;

  console.log('\nEdge cases:');

  if (test('handles empty input gracefully', () => {
    const result = runScript('{}');
    assert.strictEqual(result.code, 0);
  })) passed++; else failed++;

  if (test('handles invalid JSON gracefully', () => {
    const result = runScript('not json');
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, 'not json');
  })) passed++; else failed++;

  if (test('passes through missing command field', () => {
    const input = { tool_input: {} };
    const result = runScript(input);
    assert.strictEqual(result.code, 0);
  })) passed++; else failed++;

  // The two dev hooks must agree: pre-bash-dev-server-block.js refuses a dev
  // server outside tmux, and this hook is what puts it in tmux. Both now read
  // scripts/lib/dev-command.js, so a spelling one recognises cannot be one the
  // other misses. Before that, this hook used its own raw-text regex and left
  // every quoted or option-separated form undetached.
  // Same gate the detection tests above use: on a non-Windows host without
  // tmux the hook deliberately passes the command through, so asserting a
  // rewrite there would fail for the right reason and the wrong cause.
  if (process.platform === 'win32' || tmuxAvailable) {
    for (const command of [
      'npm run "dev"',
      "npm run 'dev'",
      'npm --silent run dev',
      'yarn --cwd app dev',
      // npm takes any config key as `--key value`, so an unknown option must
      // not swallow the script name.
      'npm --userconfig /tmp/npmrc run dev'
    ]) {
      (test(`detects a quoted or option-separated dev script: ${command}`, () => {
        const result = runScript({ tool_input: { command } });
        assert.strictEqual(result.code, 0, `Hook exited ${result.code}: ${result.stderr}`);
        const out = JSON.parse(result.stdout);
        assert.notStrictEqual(
          out.tool_input.command,
          command,
          `Expected ${command} to be rewritten for a dev session`
        );
      }) ? passed++ : failed++);
    }
  }

  (test('leaves a non-dev command alone', () => {
    for (const command of ['npm run build', 'npm run dev-setup', 'npm test -- --grep dev']) {
      const result = runScript({ tool_input: { command } });
      assert.strictEqual(result.code, 0, `Hook exited ${result.code}: ${result.stderr}`);
      const out = JSON.parse(result.stdout);
      assert.strictEqual(out.tool_input.command, command, `Expected ${command} unchanged`);
    }
  }) ? passed++ : failed++);


  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
