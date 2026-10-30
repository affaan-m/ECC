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

function capture(phase, input, expectedEvent) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observe-redaction-'));
  try {
    const data = path.join(root, 'data');
    const result = spawnSync(process.execPath, [runner, `${phase}:observe`,
      'scripts/hooks/observe-runner.js', 'standard,strict'], {
      input: typeof input === 'string' ? input
        : JSON.stringify({ cwd: root, session_id: 'redaction-fixture', ...input }),
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
    assert.equal(JSON.parse(records).event,
      expectedEvent || (phase === 'pre' ? 'tool_start' : 'tool_complete'));
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
  const canary = 'CANARY_TOKEN_abcdefghijk';
  const pemCanary = 'MIIEcanaryPEMbodyAAAA';
  for (const [label, content, secret = canary] of [
    ['double-quoted source', 'const apiKey = "CANARY_TOKEN_abcdefghijk";'],
    ['single-quoted source', "const password = 'CANARY_TOKEN_abcdefghijk';"],
    ['JSON credential', '{"token":"CANARY_TOKEN_abcdefghijk"}'],
    ['nested escaped source', 'const auth = \\"CANARY_TOKEN_abcdefghijk\\";'],
    ['compound env var name', 'AWS_SECRET_ACCESS_KEY=CANARY/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'CANARY/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    ['lowercase compound name', 'aws_secret_access_key = CANARY/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'CANARY/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    ['DSN password', 'DATABASE_URL=postgres://app:CANARYdsnPassw0rd@db.internal:5432/app',
      'CANARYdsnPassw0rd'],
    ['PEM private key block', `-----BEGIN RSA ${'PRIVATE'} KEY-----\n${pemCanary}\n-----END RSA PRIVATE KEY-----`,
      pemCanary],
    ['truncated PEM private key block', `-----BEGIN OPENSSH ${'PRIVATE'} KEY-----\n${pemCanary}`, pemCanary],
    ['GitHub classic token', `GH_PAT=${'ghp_'}CANARY${'0'.repeat(30)}`, `CANARY${'0'.repeat(30)}`],
    ['GitHub fine-grained token', `use ${'github_pat_'}CANARY_${'1'.repeat(40)}`, `CANARY_${'1'.repeat(40)}`],
    ['AWS access key id', `key id ${'AKIA'}CANARY0EXAMPLE00`, 'CANARY0EXAMPLE00']
  ]) {
    test(`redacts ${label} before persisting tool input`, () => {
      const records = capture('pre', { tool_name: 'Write',
        tool_input: { file_path: '/tmp/example.js', content } });
      assert.ok(!records.includes(secret), 'seeded credential persisted');
      assert.ok(records.includes('[REDACTED]'));
    });
    test(`redacts ${label} before persisting structured tool output`, () => {
      const records = capture('post', { tool_name: 'Read',
        tool_input: { file_path: '/tmp/example.js' }, tool_response: { content } });
      assert.ok(!records.includes(secret), 'seeded credential persisted');
      assert.ok(records.includes('[REDACTED]'));
    });
  }

  // Structured output is JSON-encoded before scrubbing, so a newline before a
  // bare token reaches the matcher as a literal backslash-n (greptile, #3568).
  for (const [label, content, secret] of [
    ['GitHub classic token after newline', `log line\n${'ghp_'}CANARY${'0'.repeat(30)}`,
      `CANARY${'0'.repeat(30)}`],
    ['GitHub fine-grained token after tab', `col\t${'github_pat_'}CANARY_${'1'.repeat(40)}`,
      `CANARY_${'1'.repeat(40)}`],
    ['AWS access key id after CRLF', `id:\r\n${'AKIA'}CANARY0EXAMPLE00`, 'CANARY0EXAMPLE00'],
    ['AWS session key id after newline', `id:\n${'ASIA'}CANARY0EXAMPLE00`, 'CANARY0EXAMPLE00']
  ]) {
    test(`redacts ${label} in structured tool output`, () => {
      const records = capture('post', { tool_name: 'Read',
        tool_input: { file_path: '/tmp/example.js' }, tool_response: { content } });
      assert.ok(!records.includes(secret), 'seeded credential persisted');
      assert.ok(records.includes('[REDACTED]'));
    });
  }

  // Capture truncation (5000 chars, 2000 in the parse-error fallback) can cut a
  // DSN right before its '@'; the password must still be redacted (#3568).
  const cutSecret = 'CANARYcutPassw0rd';
  const dsnCutAt = (offset) => `${'a'.repeat(offset)} postgres://app:${cutSecret}@db.internal/app`;
  const dsnPad = (atIndex) => atIndex - ' postgres://app:'.length - cutSecret.length;
  for (const [label, phase, input, expectedEvent] of [
    ['string tool output', 'post', { tool_name: 'Bash', tool_input: { command: 'env' },
      tool_response: dsnCutAt(dsnPad(5000)) }],
    // json.dumps prefixes '{"content": "' (13 chars) before the value.
    ['structured tool output', 'post', { tool_name: 'Read', tool_input: { file_path: '/tmp/x' },
      tool_response: { content: dsnCutAt(dsnPad(5000 - 13)) } }],
    ['structured tool input', 'pre', { tool_name: 'Write',
      tool_input: { content: dsnCutAt(dsnPad(5000 - 13)) } }],
    // A top-level array is valid JSON but not a hook payload: parse-error
    // fallback, which persists the first 2000 raw chars ('["' prefix).
    ['parse-error fallback', 'post', JSON.stringify([dsnCutAt(dsnPad(2000 - 2))]), 'parse_error']
  ]) {
    test(`redacts DSN password truncated before '@' in ${label}`, () => {
      const records = capture(phase, input, expectedEvent);
      assert.ok(!records.includes(cutSecret), 'truncated DSN password persisted');
      assert.ok(records.includes('postgres://app:[REDACTED]'));
    });
  }

  // Numeric password cut right before '@' (or at end of text) must not be mistaken for host:port.
  const numPad = (end) => 'a'.repeat(end - ' postgres://app:1234'.length) + ' postgres://app:1234';
  for (const [label, phase, input, expectedEvent] of [
    ['string tool output', 'post', { tool_name: 'Bash', tool_input: { command: 'env' },
      tool_response: numPad(5000) }],
    ['parse-error fallback', 'post', JSON.stringify([numPad(2000 - 2)]), 'parse_error']
  ]) {
    test(`redacts numeric DSN password cut at the truncation boundary in ${label}`, () => {
      const records = capture(phase, input, expectedEvent);
      assert.ok(!records.includes('app:1234'), 'numeric DSN password persisted');
      assert.ok(records.includes('postgres://app:[REDACTED]'));
    });
  }

  // Ordinary code, URLs without credentials and SSH remotes stay readable.
  const benign = [
    'const tokenizer = new Tokenizer(config);',
    'max_tokens_per_request = 4096',
    'token_count = countTokens(text)',
    'password_hash = hashlib.sha256(pw)',
    'fetch(http://localhost:8080/api/v1)',
    'git clone git@github.com:org/repo.git',
    'https://user@example.com/path'
  ];
  test('keeps ordinary code and credential-free URLs unredacted', () => {
    const records = capture('post', { tool_name: 'Read',
      tool_input: { file_path: '/tmp/example.js' }, tool_response: { content: benign.join('\n') } });
    for (const line of benign) assert.ok(records.includes(line), `benign text altered: ${line}`);
    assert.ok(!records.includes('[REDACTED]'));
  });
  test('keeps a trailing host:port in string output unredacted', () => {
    const records = capture('post', { tool_name: 'Bash', tool_input: { command: 'npm run dev' },
      tool_response: 'listening on http://localhost:3000' });
    assert.ok(records.includes('http://localhost:3000'));
    assert.ok(!records.includes('[REDACTED]'));
  });
}
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
