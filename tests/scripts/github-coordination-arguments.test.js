'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs } = require('../../scripts/github-coordination');
const { normalizeIssueNumber } = require('../../scripts/lib/github-coordination/gh-api');
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
const parse = (...args) => parseArgs(['node', 'github-coordination.js', ...args]);
test('flags before a claim still select the requested command and issue', () => {
  const result = parse('--issue', '5', 'claim', '--repo', 'o/r');
  assert.strictEqual(result.command, 'claim');
  assert.strictEqual(result.issueNumber, 5);
});
test('every explicit command accepts leading and interspersed flags', () => {
  for (const command of ['claim', 'sync', 'validate', 'publish', 'review', 'unblock', 'decompose']) {
    const result = parse('--json', '--repo', 'o/r', command, '--dry-run', '12');
    assert.strictEqual(result.command, command);
    assert.strictEqual(result.issueNumber, 12);
    assert.strictEqual(result.dryRun, true);
  }
});
test('conflicting explicit and positional issue identities are rejected', () => {
  assert.throws(() => parse('claim', '6', '--issue', '5'), /conflicting issue/i);
  assert.throws(() => parse('claim', '--issue', '5', '--issue', '6'), /conflicting issue/i);
});
test('extra positional arguments are rejected rather than ignored', () => {
  assert.throws(() => parse('claim', '5', '6'), /unexpected positional/i);
});
test('unknown commands are rejected during argument parsing', () => {
  assert.throws(() => parse('--repo', 'o/r', 'cliam', '--issue', '5'), /unknown command/i);
  assert.throws(() => parse(''), /unknown command/i);
  assert.throws(() => parse('', 'sync'), /unknown command/i);
});
test('issue identities must be whole positive safe integers', () => {
  for (const value of ['5abc', '5.5', '5e2', '+5', '0', '9007199254740992']) {
    assert.throws(() => normalizeIssueNumber(value), /invalid issue number/i);
  }
  assert.strictEqual(normalizeIssueNumber('005'), 5);
});
test('scan limits use their own strict validation and diagnostics', () => {
  for (const value of ['5abc', '1.5', '0', '9007199254740992']) {
    assert.throws(() => parse('sync', '--limit', value), /invalid limit/i);
  }
  assert.strictEqual(parse('sync', '--limit', '25').limit, 25);
});
test('default sync and help remain available without a command', () => {
  assert.strictEqual(parse('--repo', 'o/r').command, 'sync');
  assert.strictEqual(parse('--help').help, true);
  assert.strictEqual(parse('cliam', '--help').help, true);
  assert.strictEqual(parse('claim', '--issue', 'invalid', '-h').help, true);
});
test('short help remains a flag after an incomplete value option', () => {
  assert.strictEqual(parse('--actor', '-h').help, true);
  assert.strictEqual(parse('claim', '--issue', '-h').help, true);
  assert.throws(() => parse('--actor', '-x'), /requires a value/i);
  assert.strictEqual(parse('--actor', 'existing', '-h').help, true);
  assert.strictEqual(parse('cliam', '--limit', 'bad', '--help').help, true);
});
test('invalid CLI identities and commands fail before local or GitHub writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-coordination-arguments-'));
  try {
    const db = path.join(root, 'state.db');
    const log = path.join(root, 'gh-call');
    const shim = path.join(root, 'gh-shim.js');
    fs.writeFileSync(shim, `require('fs').writeFileSync(process.env.ECC_ARGUMENT_LOG, 'called'); process.exit(3);`);
    for (const args of [['claim', '5abc'], ['cliam'], [''], ['sync', '--actor', '-x'], ['claim', '5', '--issue', '6'], ['sync', '--limit', '1.5']]) {
      const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/github-coordination.js'),
        ...args, '--repo', 'o/r', '--db', db], {
        cwd: root, env: { ...process.env, ECC_GH_SHIM: shim, ECC_ARGUMENT_LOG: log },
        encoding: 'utf8', timeout: 10000,
      });
      assert.strictEqual(result.status, 1, result.stderr);
      assert.ok(!fs.existsSync(db), 'invalid input must not create or migrate the database');
      assert.ok(!fs.existsSync(log), 'invalid input must not call GitHub');
    }
    for (const args of [['cliam', '--help'], ['claim', '--issue', 'invalid', '-h'], ['claim', '--issue', '-h']]) {
      const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/github-coordination.js'),
        ...args, '--repo', 'o/r', '--db', db], {
        cwd: root, env: { ...process.env, ECC_GH_SHIM: shim, ECC_ARGUMENT_LOG: log },
        encoding: 'utf8', timeout: 10000,
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('Usage:'));
      assert.ok(!fs.existsSync(db));
      assert.ok(!fs.existsSync(log));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
