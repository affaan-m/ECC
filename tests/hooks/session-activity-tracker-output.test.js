/**
 * Tests for what session-activity-tracker.js keeps of a tool's output.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'hooks',
  'session-activity-tracker.js'
);
const { buildActivityRow, summarizeOutput } = require(script);

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

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-activity-tracker-test-'));
}

function withTempHome(homeDir) {
  return {
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
}

// session-activity-tracker.js appends to ~/.claude/metrics/tool-usage.jsonl, so
// runs get an empty home instead of the developer's real one unless a test
// passes withTempHome().
const ISOLATED_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'session-activity-home-'));
const ISOLATED_HOME_ENV = { HOME: ISOLATED_HOME, USERPROFILE: ISOLATED_HOME };
process.on('exit', () => fs.rmSync(ISOLATED_HOME, { recursive: true, force: true }));

function runScript(input, envOverrides = {}, options = {}) {
  const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [script], {
    encoding: 'utf8',
    input: inputStr,
    timeout: 10000,
    env: {
      ...process.env, ...ISOLATED_HOME_ENV,
      ECC_SESSION_ID: '', CLAUDE_SESSION_ID: '',
      ...envOverrides,
    },
    cwd: options.cwd,
  });
  return { code: result.status || 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function readMetricRows(homeDir) {
  const metricsFile = path.join(homeDir, '.claude', 'metrics', 'tool-usage.jsonl');
  return fs.readFileSync(metricsFile, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function runTests() {
  console.log('\n=== Testing session-activity-tracker.js output summaries ===\n');

  let passed = 0;
  let failed = 0;

  (test('summarizes tool output with credentials redacted', () => {
    assert.strictEqual(summarizeOutput({ stdout: 'out', stderr: '' }), '');
    assert.strictEqual(summarizeOutput(`token ghp_${'A'.repeat(20)}`), 'token <REDACTED>');
    // Claude Code sends the result as tool_response, for Bash { stdout, stderr, ... }:
    // only its sizes and flags are kept.
    const bashRow = buildActivityRow(
      {
        hook_event_name: 'PostToolUse',
        session_id: 'sess-1',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        tool_response: { stdout: '12 passing\n', stderr: 'warn: slow\n', interrupted: false, isImage: false },
      },
      {}
    );
    assert.strictEqual(bashRow.output_summary, 'stdout: 11 chars, stderr: 11 chars');
    // Output such as `cat .env` lands here too, so the secrets governance-capture
    // detects are redacted as well.
    assert.strictEqual(summarizeOutput('api_key = "example-secret-value"\n'), 'api_key = <REDACTED>');
    assert.strictEqual(summarizeOutput('OPENAI_API_KEY=sk-abc123def456\nDEBUG=1'), 'OPENAI_API_KEY=<REDACTED> DEBUG=1');
    assert.strictEqual(summarizeOutput('AWS_SECRET_ACCESS_KEY=example-secret-value'), 'AWS_SECRET_ACCESS_KEY=<REDACTED>');
    assert.strictEqual(summarizeOutput('DOCKER_AUTH_CONFIG={"auths":{"registry":{}}}'), 'DOCKER_AUTH_CONFIG=<REDACTED>');
    assert.strictEqual(summarizeOutput('DOCKER_AUTH_CONFIG={"auths": {"registry": {"auth": "dXNlcjpwYXNz"}}}'), 'DOCKER_AUTH_CONFIG=<REDACTED>');
    assert.strictEqual(summarizeOutput('{"auths":{"registry":{"auth":"dXNlcjpwYXNz"}}}'), '{"auths":{"registry":{"auth":<REDACTED>}}}');
    assert.strictEqual(summarizeOutput('auth_method=oidc author=Jane'), 'auth_method=oidc author=Jane');
    assert.strictEqual(summarizeOutput('{"token": "abc.def", "user": "bob"}'), '{"token": <REDACTED>, "user": "bob"}');
    const jwt = ['eyJ' + 'a'.repeat(12), 'eyJ' + 'b'.repeat(12), 'c'.repeat(12)].join('.');
    assert.strictEqual(summarizeOutput(`Bearer ${jwt} done`), 'Bearer <REDACTED> done');
    assert.strictEqual(summarizeOutput('-----BEGIN RSA PRIVATE KEY-----\nMIIE...'), '<REDACTED>');
    assert.strictEqual(summarizeOutput(`ghu_${'C'.repeat(36)}`), '<REDACTED>');
    assert.strictEqual(summarizeOutput('Unexpected tokens: 0, max_tokens=4096, tokenizer=bpe, author=Jane'), 'Unexpected tokens: 0, max_tokens=4096, tokenizer=bpe, author=Jane');
    // A bare value after a quoted JSON key ends at the next field, and a quoted one
    // may hold escaped quotes.
    assert.strictEqual(summarizeOutput('{"token":null,"status":"failed","exit_code":1}'), '{"token":<REDACTED>,"status":"failed","exit_code":1}');
    assert.strictEqual(summarizeOutput('{"api_key":"part1\\" part2"}'), '{"api_key":<REDACTED>}');
    // Any other bare value runs to the next space: a comma can be part of it.
    assert.strictEqual(summarizeOutput('CLIENT_SECRET=alpha,beta DEBUG=1'), 'CLIENT_SECRET=<REDACTED> DEBUG=1');
    assert.strictEqual(summarizeOutput('client_secret: alpha,beta'), 'client_secret: <REDACTED>');
    // The whole name is checked, however long.
    const longName = `API_KEY_${'A'.repeat(65)}`;
    assert.strictEqual(summarizeOutput(`${longName}=example-secret-value`), `${longName}=<REDACTED>`);
    assert.strictEqual(summarizeOutput(`${'A'.repeat(100)}_SECRET=example-secret-value`), `${'A'.repeat(100)}_SECRET=<REDACTED>`);
    // Separator-heavy output stays linear: unbounded name parts took seconds here.
    for (const output of ['a.'.repeat(64000), 'secret'.repeat(21000), 'x.secret:'.repeat(14000), '"a":'.repeat(32000)]) {
      const started = Date.now();
      summarizeOutput(output);
      assert.ok(Date.now() - started < 2000, `Redacting ${output.length} characters should stay within its time budget`);
    }
  }) ? passed++ : failed++);

  (test('saves no part of a structured tool result in activity history', () => {
    const tmpHome = makeTempDir();
    const marker = 'S3CR3T-MARK';
    const env = { ...withTempHome(tmpHome), CLAUDE_HOOK_EVENT_NAME: 'PostToolUse', ECC_SESSION_ID: 'sess-privacy' };
    const bashOutput = [
      `{"token": "${marker}-direct"}`,
      JSON.stringify(JSON.stringify({ token: `${marker}-escaped` })),
      `Authorization: Bearer ${marker}-header`,
      `"Authorization": "Bearer ${marker}-quoted"`,
      `API_TOKEN=${marker}\\ escaped-space`,
    ].join('\n');
    const payloads = [
      { tool_name: 'Bash', tool_input: { command: 'cat .env' }, tool_response: { stdout: bashOutput, stderr: '', interrupted: false, isImage: false } },
      {
        tool_name: 'mcp__example__fetch',
        tool_input: {},
        tool_response: {
          content: [{ type: 'text', text: JSON.stringify({ api_key: `${marker}-nested` }) }],
          headers: { Authorization: `Bearer ${marker}-field` },
          raw: JSON.stringify(JSON.stringify(`password=${marker}-double`)),
        },
      },
      { tool_name: 'Read', tool_input: { file_path: 'README.md' }, tool_output: { output: 'adapted result text' } },
    ];
    for (const payload of payloads) {
      assert.strictEqual(runScript(payload, env).code, 0);
    }

    const saved = fs.readFileSync(path.join(tmpHome, '.claude', 'metrics', 'tool-usage.jsonl'), 'utf8');
    assert.ok(!saved.includes(marker), `activity history kept a credential fragment: ${saved}`);
    const rows = readMetricRows(tmpHome);
    assert.deepStrictEqual(rows.map(row => row.output_summary), [
      `stdout: ${bashOutput.length} chars, stderr: 0 chars`,
      '',
      'adapted result text',
    ]);

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
