/**
 * Tests for scripts/hooks/block-no-verify.js.
 * Detection rules live in the block-no-verify package; these tests cover ECC's wiring.
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const hook = require('../../scripts/hooks/block-no-verify');

const script = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'block-no-verify.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

const json = command => JSON.stringify({ tool_input: { command } });

console.log('\nblock-no-verify hook tests');
console.log('─'.repeat(50));

const cases = [
  ['allows plain git commit', 'git commit -m "hello"', 0],
  ['allows non-git command', 'ls -la', 0],
  ['allows a message that mentions the flag', 'git commit -m "docs: explain --no-verify"', 0],
  ['blocks --no-verify on commit', 'git commit --no-verify -m "msg"', 2],
  ['blocks -n on commit', 'git commit -n -m "msg"', 2],
  ['blocks --no-verify on push', 'git push --no-verify', 2],
  ['blocks core.hooksPath override', 'git -c core.hooksPath=/dev/null commit -m "msg"', 2],
  ['blocks HUSKY=0', 'HUSKY=0 git commit -m "msg"', 2]
];

for (const [name, command, expected] of cases) {
  test(name, () => {
    for (const input of [command, json(command), JSON.stringify({ command })]) {
      const result = hook.run(input);
      assert.strictEqual(result.exitCode, expected, `${input}: ${result.stderr}`);
      if (expected === 2) assert.ok(result.stderr, 'blocked result needs a reason');
    }
  });
}

test('blocks when the package cannot parse the command', () => {
  const command = "git commit -m x; printf '%s' '$" + "{}'";
  const result = hook.run(json(command));
  assert.strictEqual(result.exitCode, 2, result.stderr);
  assert.match(result.stderr, /BLOCKED/);
});

test('stdin mode passes allowed input through', () => {
  const input = json('git status');
  const r = spawnSync(process.execPath, [script], { input, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, input);
});

test('stdin mode exits 2 with a reason on block', () => {
  const r = spawnSync(process.execPath, [script], { input: json('git commit --no-verify -m x'), encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.ok(r.stderr.trim());
});

test('vendored bundle matches the pinned block-no-verify package', () => {
  const build = path.join(__dirname, '..', '..', 'scripts', 'build-block-no-verify.js');
  const r = spawnSync(process.execPath, [build, '--check'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

console.log('─'.repeat(50));
console.log(`Passed: ${passed}  Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
