/**
 * Tests for pre-bash-dev-server-block.js hook
 *
 * Run with: node tests/hooks/pre-bash-dev-server-block.test.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-bash-dev-server-block.js');

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

function runScript(command) {
  const input = { tool_input: { command } };
  const result = spawnSync('node', [script], {
    encoding: 'utf8',
    input: JSON.stringify(input),
    timeout: 10000,
  });
  return { code: result.status || 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function runTests() {
  console.log('\n=== Testing pre-bash-dev-server-block.js ===\n');

  let passed = 0;
  let failed = 0;

  const isWindows = process.platform === 'win32';

  // --- Blocking tests (non-Windows only) ---

  if (!isWindows) {
    (test('blocks npm run dev (exit code 2, stderr contains BLOCKED)', () => {
      const result = runScript('npm run dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
      assert.ok(result.stderr.includes('BLOCKED'), `Expected stderr to contain BLOCKED, got: ${result.stderr}`);
    }) ? passed++ : failed++);

    (test('blocks pnpm dev (exit code 2)', () => {
      const result = runScript('pnpm dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks yarn dev (exit code 2)', () => {
      const result = runScript('yarn dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks bun run dev (exit code 2)', () => {
      const result = runScript('bun run dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('still blocks npm run dev:ssr — colon variant is a dev server (exit 2)', () => {
      const result = runScript('npm run dev:ssr');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);
  } else {
    console.log('  (skipping blocking tests on Windows)\n');
  }

  // --- Allow tests ---

  (test('allows tmux-wrapped npm run dev (exit code 0)', () => {
    const result = runScript('tmux new-session -d -s dev "npm run dev"');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows npm install (exit code 0)', () => {
    const result = runScript('npm install');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows npm test (exit code 0)', () => {
    const result = runScript('npm test');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows npm run build (exit code 0)', () => {
    const result = runScript('npm run build');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  // --- dev-<suffix> scripts are distinct from the dev server, must not be blocked ---

  (test('allows npm run dev-setup — distinct script, not the dev server (exit 0)', () => {
    const result = runScript('npm run dev-setup');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows pnpm run dev-docs — distinct script (exit 0)', () => {
    const result = runScript('pnpm run dev-docs');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows yarn dev-build — distinct script (exit 0)', () => {
    const result = runScript('yarn dev-build');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  // --- Subshell bypass regression (issue: dev server slipped past via $(), ``, ()) ---

  if (!isWindows) {
    (test('blocks $(npm run dev) — command substitution', () => {
      const result = runScript('$(npm run dev)');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
      assert.ok(result.stderr.includes('BLOCKED'), 'expected BLOCKED in stderr');
    }) ? passed++ : failed++);

    (test('blocks `npm run dev` — backtick substitution', () => {
      const result = runScript('`npm run dev`');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks echo $(npm run dev) — substitution nested in argument', () => {
      const result = runScript('echo $(npm run dev)');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks (npm run dev) — plain subshell group', () => {
      const result = runScript('(npm run dev)');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks $(echo a; npm run dev) — substitution with sequenced segments', () => {
      const result = runScript('$(echo a; npm run dev)');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks (pnpm dev) — plain subshell group with pnpm', () => {
      const result = runScript('(pnpm dev)');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('allows tmux launcher inside subshell wrapping (exit code 0)', () => {
      const result = runScript('(tmux new-session -d -s dev "npm run dev")');
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('allows single-quoted "(npm run dev)" — literal string, not a subshell', () => {
      const result = runScript("git commit -m '(npm run dev)'");
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('allows double-quoted "(npm run dev)" — literal in double quotes (bash does not subshell)', () => {
      const result = runScript('echo "(npm run dev)"');
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);

    (test("allows single-quoted '$(npm run dev)' — literal string, no substitution", () => {
      const result = runScript("git commit -m '$(npm run dev) fix'");
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);
  }

  // --- Round 1 review fixes (Greptile + CodeRabbit on PR #1889) ---

  if (!isWindows) {
    (test('blocks $(echo ")"; (npm run dev)) — quoted ) does not terminate $() early', () => {
      const result = runScript('$(echo ")"; (npm run dev))');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks (echo ")"; npm run dev) — quoted ) does not terminate (...) early', () => {
      const result = runScript('(echo ")"; npm run dev)');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('allows $(echo "(npm run dev)") — () inside double-quoted substitution body is literal', () => {
      const result = runScript('$(echo "(npm run dev)")');
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks { npm run dev; } — brace group runs in current shell', () => {
      const result = runScript('{ npm run dev; }');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks echo hi && { npm run dev; } — brace group after &&', () => {
      const result = runScript('echo hi && { npm run dev; }');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('allows {npm run dev} — bash requires space after { to form a group', () => {
      const result = runScript('{npm run dev}');
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks yarn run dev — yarn 1.x convention', () => {
      const result = runScript('yarn run dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks bun dev — bun bare form', () => {
      const result = runScript('bun dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks "$(npm run dev)" — double-quoted substitution still substitutes', () => {
      const result = runScript('echo "$(npm run dev)"');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);
  }

  // --- Edge cases ---

  (test('empty/invalid input passes through (exit code 0)', () => {
    const result = spawnSync('node', [script], {
      encoding: 'utf8',
      input: '',
      timeout: 10000,
    });
    assert.strictEqual(result.status || 0, 0, `Expected exit code 0, got ${result.status}`);
  }) ? passed++ : failed++);

  (test('stdout contains original input on pass-through', () => {
    const input = { tool_input: { command: 'npm install' } };
    const inputStr = JSON.stringify(input);
    const result = spawnSync('node', [script], {
      encoding: 'utf8',
      input: inputStr,
      timeout: 10000,
    });
    assert.strictEqual(result.status || 0, 0);
    assert.strictEqual(result.stdout.trim(), inputStr, `Expected stdout to contain original input`);
  }) ? passed++ : failed++);

  // --- Summary ---

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
