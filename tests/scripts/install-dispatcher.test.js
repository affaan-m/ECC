#!/usr/bin/env node
/**
 * Tests for scripts/install.sh --target dispatch.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const installSh = path.join(repoRoot, 'scripts', 'install.sh');

function run(args, envOverrides = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-dispatch-'));
  const env = {
    ...process.env,
    HOME: home,
    PATH: '/usr/bin:/bin',
    ...envOverrides
  };
  delete env.CODEX_HOME;
  Object.assign(env, envOverrides);
  const res = spawnSync('bash', [installSh, ...args], { env, encoding: 'utf8' });
  return { ...res, home };
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`);
    failed += 1;
  }
}

test('--target claude dry-run installs CLAUDE.md, no AGENTS.md', () => {
  const res = run(['-n', '--target', 'claude', 'common']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('CLAUDE.md'), 'expected CLAUDE.md in output');
  assert.ok(!res.stdout.includes('AGENTS.md'), 'AGENTS.md must not appear for claude target');
});

test('unknown --target fails with error', () => {
  const res = run(['-n', '--target', 'bogus', 'common']);
  assert.notStrictEqual(res.status, 0);
  assert.ok((res.stdout + res.stderr).includes('Unknown target'), 'expected Unknown target error');
});

test('default target all without codex skips codex with INFO', () => {
  const res = run(['-n', 'common']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('CLAUDE.md'));
  assert.ok(res.stdout.includes('Codex not detected'), 'expected skip message');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
