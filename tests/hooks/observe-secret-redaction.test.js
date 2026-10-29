'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const runner = path.join(repoRoot, 'scripts/hooks/run-with-flags.js');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  PASS ${name}`); passed += 1; }
  catch (error) { console.log(`  FAIL ${name}: ${error.message}`); failed += 1; }
}

function capture(phase, input) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observe-redaction-'));
  try {
    const data = path.join(root, 'data');
    const result = spawnSync(process.execPath, [runner, `${phase}:observe`,
      'scripts/hooks/observe-runner.js', 'standard,strict'], {
      input: JSON.stringify({ cwd: root, session_id: 'redaction-fixture', ...input }),
      cwd: root, encoding: 'utf8', timeout: 12000,
      env: { ...process.env, HOME: root, USERPROFILE: root,
        CLV2_HOMUNCULUS_DIR: data, CLAUDE_CODE_ENTRYPOINT: 'cli',
        ECC_HOOK_PROFILE: 'standard', ECC_SKIP_OBSERVE: '0',
        ECC_DISABLED_HOOKS: '', ECC_OBSERVER_ENABLED: 'false' }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /runner failed|timed out/i);
    const records = fs.readFileSync(path.join(data, 'observations.jsonl'), 'utf8');
    assert.equal(records.trim().split('\n').length, 1);
    assert.equal(JSON.parse(records).event, phase === 'pre' ? 'tool_start' : 'tool_complete');
    return records;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('=== Actual registered observation secret redaction ===');
if (process.platform === 'win32') {
  console.log('Skipping shell fixtures: native Windows runner requires platform CI.');
} else if (spawnSync('python3', ['--version']).status !== 0) {
  console.log('  FAIL python3 is required for observation redaction tests');
  failed += 1;
} else {
  // Synthetic canary data proves that captured credential-shaped text is masked.
  for (const [label, content] of [
    ['double-quoted source', 'const apiKey = "CANARY_TOKEN_abcdefghijk";'],
    ['single-quoted source', "const password = 'CANARY_TOKEN_abcdefghijk';"],
    ['JSON credential', '{"token":"CANARY_TOKEN_abcdefghijk"}'],
    ['nested escaped source', 'const auth = \\"CANARY_TOKEN_abcdefghijk\\";']
  ]) {
    test(`redacts ${label} before persisting tool input`, () => {
      const records = capture('pre', { tool_name: 'Write',
        tool_input: { file_path: '/tmp/example.js', content } });
      assert.ok(!records.includes('CANARY_TOKEN_abcdefghijk'), 'seeded credential persisted');
      assert.ok(records.includes('[REDACTED]'));
    });
    test(`redacts ${label} before persisting structured tool output`, () => {
      const records = capture('post', { tool_name: 'Read',
        tool_input: { file_path: '/tmp/example.js' }, tool_response: { content } });
      assert.ok(!records.includes('CANARY_TOKEN_abcdefghijk'), 'seeded credential persisted');
      assert.ok(records.includes('[REDACTED]'));
    });
  }
}
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
