'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveCheckout } = require('../../scripts/lib/copilot-runtime-root');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc pinned runtime-'));
let passed = 0;
let failed = 0;
function git(args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function test(name, action) {
  try { action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
try {
  git(['init', '-q']); git(['config', 'user.email', 'test@example.invalid']); git(['config', 'user.name', 'ECC Test']);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"ecc-universal"}\n');
  git(['add', 'package.json']); git(['commit', '-qm', 'fixture']);
  const sha = git(['rev-parse', 'HEAD']);
  const env = { ...process.env, ECC_COPILOT_CHECKOUT_ROOT: root, ECC_COPILOT_CHECKOUT_COMMIT: sha };
  test('real clean pinned checkout resolves without executing project helpers', () => assert.strictEqual(resolveCheckout(env), fs.realpathSync(root)));
  test('missing, relative and wrong pin reject', () => {
    for (const overrides of [{ ECC_COPILOT_CHECKOUT_ROOT: '' }, { ECC_COPILOT_CHECKOUT_ROOT: '.' },
      { ECC_COPILOT_CHECKOUT_COMMIT: 'main' }, { ECC_COPILOT_CHECKOUT_COMMIT: 'a'.repeat(40) }]) assert.throws(() => resolveCheckout({ ...env, ...overrides }));
  });
  test('dirty tracked runtime and nested repository paths reject', () => {
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"different"}\n');
    assert.throws(() => resolveCheckout(env));
    git(['checkout', '--', 'package.json']);
    fs.mkdirSync(path.join(root, 'nested'));
    assert.throws(() => resolveCheckout({ ...env, ECC_COPILOT_CHECKOUT_ROOT: path.join(root, 'nested') }));
  });
  test('symlink checkout marker rejected', () => {
    fs.renameSync(path.join(root, 'package.json'), path.join(root, 'original.json'));
    fs.symlinkSync(path.join(root, 'original.json'), path.join(root, 'package.json'));
    assert.throws(() => resolveCheckout(env));
  });
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
