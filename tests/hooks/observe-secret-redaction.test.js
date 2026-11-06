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

// The persisted input/output is the scrubbed JSON of the tool payload, so one
// field can be compared exactly instead of only checking a canary is gone.
function capturedField(records, field) {
  const record = JSON.parse(records);
  return JSON.parse(record.event === 'tool_start' ? record.input : record.output)[field];
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
  // Prefixes are split so secret scanners do not flag the synthetic fixtures.
  const anthropicCanary = 'CANARYanthropic_Key-0123456789abcdefghijklmnop';
  const anthropicKey = `${'sk-'}ant-api03-${anthropicCanary}`;
  const openaiCanary = 'CANARYopenaiProject0123456789abcdefghij';
  const openaiProjectKey = `${'sk-'}proj-${openaiCanary}`;
  const legacyCanary = 'CANARYlegacy0123456789abcdefghijklmnopqrstu';
  const legacyKey = `${'sk-'}${legacyCanary}`;
  const jwtCanary = 'Q0FOQVJZc2lnbmF0dXJl';
  const jwt = `${'eyJ'}hbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnkifQ.${jwtCanary}`;
  // e30 is base64url for {}, a valid but very short claims segment.
  const emptyClaimsJwt = `${'eyJ'}hbGciOiJIUzI1NiJ9.e30.${jwtCanary}`;
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
    ['AWS access key id', `key id ${'AKIA'}CANARY0EXAMPLE00`, 'CANARY0EXAMPLE00'],
    // Bare sk- keys and JWTs carry no keyword, so only their shape gives them away (#3846).
    ['bare Anthropic key', `echo ${anthropicKey} > key.txt`, anthropicCanary],
    ['bare OpenAI project key', `client = OpenAI(${openaiProjectKey})`, openaiCanary],
    ['bare legacy sk- key', `KEYS = [${legacyKey}]`, legacyCanary],
    ['bare JWT', `curl -H "X-Session: ${jwt}" https://api.example.com`, jwtCanary],
    ['bare JWT with empty claims', `curl -H "X-Session: ${emptyClaimsJwt}" https://api.example.com`, jwtCanary],
    // Redacted to the end of the token, not skipped because a hyphen follows.
    ['bare legacy sk- key with a suffix', `KEYS = [${legacyKey}-CANARYsuffix]`, 'CANARYsuffix']
  ]) {
    test(`redacts ${label} before persisting tool input`, () => {
      const records = capture('pre', { tool_name: 'Write',
        tool_input: { file_path: '/tmp/example.js', content } });
      assert.ok(!records.includes(secret), 'seeded credential persisted');
      assert.ok(records.includes('[REDACTED]'));
      if (label === 'bare JWT') {
        assert.equal(capturedField(records, 'content'), content.replace(jwt, '[REDACTED]'));
      }
      if (label === 'bare JWT with empty claims') {
        assert.equal(capturedField(records, 'content'), content.replace(emptyClaimsJwt, '[REDACTED]'));
      }
      if (label === 'bare legacy sk- key with a suffix') {
        assert.equal(capturedField(records, 'content'), 'KEYS = [[REDACTED]]');
      }
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
    ['AWS session key id after newline', `id:\n${'ASIA'}CANARY0EXAMPLE00`, 'CANARY0EXAMPLE00'],
    ['Anthropic key after newline', `key:\n${anthropicKey}`, anthropicCanary],
    ['JWT after tab', `jwt\t${jwt}`, jwtCanary]
  ]) {
    test(`redacts ${label} in structured tool output`, () => {
      const records = capture('post', { tool_name: 'Read',
        tool_input: { file_path: '/tmp/example.js' }, tool_response: { content } });
      assert.ok(!records.includes(secret), 'seeded credential persisted');
      assert.ok(records.includes('[REDACTED]'));
    });
  }

  // The three commands from #3846. Only the first two have a keyword in front of the key.
  for (const command of [
    `ANTHROPIC_API_KEY=${anthropicKey} claude -p hi`,
    `curl -H "x-api-key: ${anthropicKey}" https://api.example.com`,
    `echo ${anthropicKey} > key.txt`
  ]) {
    test(`redacts the Anthropic key in Bash input and output: ${command.split(' ')[0]}`, () => {
      for (const records of [
        capture('pre', { tool_name: 'Bash', tool_input: { command } }),
        capture('post', { tool_name: 'Bash', tool_input: { command: 'cat key.txt' },
          tool_response: { stdout: command, stderr: '' } })
      ]) {
        assert.ok(!records.includes(anthropicCanary), 'Anthropic key persisted');
        const field = JSON.parse(records).event === 'tool_start' ? 'command' : 'stdout';
        assert.equal(capturedField(records, field), command.replace(anthropicKey, '[REDACTED]'));
      }
    });
  }
  test('redacts a bare Anthropic key in the parse-error fallback', () => {
    const records = capture('post', JSON.stringify([`echo ${anthropicKey}`]), 'parse_error');
    assert.ok(!records.includes(anthropicCanary), 'Anthropic key persisted');
    assert.ok(records.includes('[REDACTED]'));
  });

  // Truncation can also cut a bare JWT inside its payload or a key inside its
  // body. What is left at the end of the capture must still be redacted.
  const jwtKept = jwt.slice(0, jwt.indexOf('.') + 10);
  const jwtPayloadStart = jwtKept.slice(jwt.indexOf('.') + 1);
  const keyKept = anthropicKey.slice(0, 'sk-ant-api03-'.length + 12);
  const cutAt = (end, value, kept) => `${'a'.repeat(end - kept.length - 1)} ${value}`;
  for (const [label, value, kept, leak] of [
    ['JWT', jwt, jwtKept, jwtPayloadStart],
    ['Anthropic key', anthropicKey, keyKept, keyKept.slice('sk-ant-api03-'.length)]
  ]) {
    for (const [where, phase, input, expectedEvent] of [
      ['string tool output', 'post', { tool_name: 'Bash', tool_input: { command: 'env' },
        tool_response: cutAt(5000, value, kept) }],
      // json.dumps prefixes '{"content": "' (13 chars) before the value.
      ['structured tool output', 'post', { tool_name: 'Read', tool_input: { file_path: '/tmp/x' },
        tool_response: { content: cutAt(5000 - 13, value, kept) } }],
      ['parse-error fallback', 'post', JSON.stringify([cutAt(2000 - 2, value, kept)]), 'parse_error']
    ]) {
      test(`redacts the ${label} cut at the truncation boundary in ${where}`, () => {
        const records = capture(phase, input, expectedEvent);
        assert.ok(!records.includes(leak), `cut ${label} persisted`);
        assert.ok(records.includes('[REDACTED]'));
      });
    }
  }

  // A long key or JWT is redacted whole, never only up to some length cap.
  const longTail = 'CANARYlongTail';
  for (const [label, value] of [
    ['an over-long Anthropic key', `${anthropicKey}${'A'.repeat(600)}${longTail}`],
    ['a JWT with a long signature', `${jwt}${'s'.repeat(1500)}${longTail}`]
  ]) {
    test(`redacts ${label} completely`, () => {
      const records = capture('post', { tool_name: 'Read', tool_input: { file_path: '/tmp/x' },
        tool_response: { content: `value ${value} end` } });
      assert.equal(capturedField(records, 'content'), 'value [REDACTED] end');
    });
  }
  // A keyword-labeled value is redacted whole, however long it is and whatever
  // shaped token sits at its start.
  for (const [label, text, expected] of [
    ['long sk-proj key', `OPENAI_API_KEY=${openaiProjectKey}${'B'.repeat(300)}${longTail}`, 'OPENAI_API_KEY=[REDACTED]'],
    ['sk- password with a suffix', `password=${'sk-'}${'A'.repeat(30)}.${longTail}`, 'password=[REDACTED]'],
    ['GitHub token with a suffix', `token=${'ghp_'}${'0'.repeat(30)}/${longTail}`, 'token=[REDACTED]'],
    ['PEM private key block',
      `secret=-----BEGIN RSA ${'PRIVATE'} KEY-----\n${longTail}\n-----END RSA PRIVATE KEY-----`, 'secret=[REDACTED]']
  ]) {
    for (const [phase, input, expectedEvent] of [
      ['post', { tool_name: 'Read', tool_input: { file_path: '/tmp/x' }, tool_response: { content: text } }],
      ['post', JSON.stringify([text]), 'parse_error']
    ]) {
      test(`redacts a keyword-labeled ${label} completely (${expectedEvent || 'tool_complete'})`, () => {
        const records = capture(phase, input, expectedEvent);
        assert.ok(!records.includes(longTail), 'value tail persisted');
        assert.ok(records.includes(expected));
      });
    }
  }
  // A labeled JWT cut inside a payload longer than 256 chars at the capture limit.
  test('redacts a keyword-labeled JWT cut inside a long payload', () => {
    const labeled = `Authorization: Bearer ${'eyJ'}hbGciOiJIUzI1NiJ9.eyJ${'p'.repeat(600)}${longTail}`;
    const records = capture('post', { tool_name: 'Bash', tool_input: { command: 'env' },
      tool_response: `${'a'.repeat(5000 - labeled.length + 5)} ${labeled}` });
    assert.ok(!records.includes('pppp'), 'JWT payload persisted');
    assert.ok(records.includes('Authorization: Bearer [REDACTED]'));
  });

  // The end-of-capture match only applies to text that was actually cut.
  for (const output of ['git checkout sk-learn', 'payload eyJhIjoxLCJiIjoyfQ']) {
    test(`keeps short string output ending in "${output.split(' ').pop().slice(0, 8)}" unredacted`, () => {
      const records = capture('post', { tool_name: 'Bash', tool_input: { command: 'echo' },
        tool_response: output });
      assert.ok(records.includes(output), 'short output altered');
      assert.ok(!records.includes('[REDACTED]'));
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
    'https://user@example.com/path',
    // Hashes, ids and base64 that look random but are not keys (#3846).
    'git show 3f9a1c2b7e4d5f6a8b9c0d1e2f3a4b5c6d7e8f90',
    'sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'id 550e8400-e29b-41d4-a716-446655440000',
    'background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==);',
    'payload: data:application/json;base64,eyJhIjoxLCJiIjoyLCJjIjozfQ==',
    'git checkout -b sk-learn-upgrade-for-pipelines',
    'risk-assessment-for-the-quarterly-report-v2',
    'ssh deploy@eyeglasses.example.com',
    'Keys start with the sk- prefix.'
  ];
  test('keeps ordinary code and credential-free URLs unredacted', () => {
    const records = capture('post', { tool_name: 'Read',
      tool_input: { file_path: '/tmp/example.js' }, tool_response: { content: benign.join('\n') } });
    for (const line of benign) assert.ok(records.includes(line), `benign text altered: ${line}`);
    assert.ok(!records.includes('[REDACTED]'));
  });
  // Both writers carry the same patterns. Run them on 300 KB of adversarial
  // input so a pattern that backtracks quadratically (#2278) fails here.
  test('scrub patterns stay identical in both writers and linear on 300 KB input', () => {
    const hook = fs.readFileSync(
      path.join(repoRoot, 'skills/continuous-learning-v2/hooks/observe.sh'), 'utf8');
    const copies = hook.split('_SECRET_RE = re.compile(').slice(1).map((rest) =>
      `_SECRET_RE = re.compile(${rest.split(/\n(?:import signal|def scrub)/)[0]}`
        .replace(/'"'"'/g, "'"));
    assert.equal(copies.length, 2);
    assert.equal(copies[0], copies[1], 'the parse-error copy of the patterns drifted');
    const driver = String.raw`
import re, sys, time
ns = {"re": re}
exec(sys.stdin.read(), ns)
patterns = [ns[n] for n in ("_PEM_RE", "_SECRET_RE", "_SECRET_VALUE_RE", "_CUT_TAIL_RE")]
n = 300000
cases = {
    "hyphen run": "a-" * (n // 2),
    "sk- then hyphen run": "sk-" + "a-" * (n // 2),
    "repeated sk-": "sk-" * (n // 3),
    "sk- keys followed by a hyphen": (" sk-" + "a" * 40 + "-") * (n // 45),
    "eyJ segments": ("eyJ" + "a-" * 10 + ".") * (n // 24),
    "repeated eyJ dots": "eyJ." * (n // 4),
    "label then hyphens": "token=" + "-" * n,
    "repeated labels": "token:" * (n // 6),
    "escaped newline before sk-": "\\nsk-" * (n // 5),
    "unfinished DSNs": "a://b:" * (n // 6),
    "unterminated PEM": "-----BEGIN RSA PRIV" + "ATE KEY-----" + "A" * n,
}
for name, text in cases.items():
    start = time.perf_counter()
    for pattern in patterns:
        pattern.sub("X", text)
    print("%s\t%.3f" % (name, time.perf_counter() - start))
`;
    const result = spawnSync('python3', ['-c', driver],
      { input: copies[0], encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stderr || 'timed out');
    const timings = result.stdout.trim().split('\n');
    assert.equal(timings.length, 11);
    for (const line of timings) {
      const [name, seconds] = line.split('\t');
      assert.ok(Number(seconds) < 2, `${name} took ${seconds}s`);
    }
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
