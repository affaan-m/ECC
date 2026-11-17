'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { buildActivityRow, extractFileEvents, extractFilePaths } = require('../../scripts/hooks/session-activity-tracker');

const script = path.resolve(__dirname, '../../scripts/hooks/session-activity-tracker.js');
const marker = 'synthetic-input-private-value';

function activityInput(toolInput) {
  return {
    hook_event_name: 'PostToolUse',
    session_id: 'structured-input-test',
    tool_name: 'mcp__example__connect',
    tool_input: toolInput,
    tool_response: { content: [] },
  };
}

function params(toolInput) {
  return JSON.parse(buildActivityRow(activityInput(toolInput), {}).input_params_json);
}

test('structured credential keys redact values without relying on a token-shaped string', () => {
  for (const key of [
    'password', 'passwd', 'CLIENT_SECRET', 'accessToken', 'API_KEY',
    'api-key', 'private_key', 'credential', 'auth', 'DOCKER_AUTH_CONFIG',
  ]) {
    assert.deepStrictEqual(params({ [key]: marker, label: 'retained' }), {
      [key]: '<REDACTED>', label: 'retained',
    }, key);
  }
});

test('nested credentials redact entire values of every JSON type and leave inputs intact', () => {
  for (const value of [marker, 123456, false, null, [marker], { value: marker }]) {
    const input = { connections: [{ label: 'primary', password: value }], enabled: true };
    const original = JSON.stringify(input);
    assert.deepStrictEqual(params(input), {
      connections: [{ label: 'primary', password: '<REDACTED>' }], enabled: true,
    });
    assert.strictEqual(JSON.stringify(input), original);
  }
  assert.deepStrictEqual(params({ credentials: { user: 'example', value: marker } }), {
    credentials: '<REDACTED>',
  });
});

test('authorization fields are redacted in both structured parameters and shallow summaries', () => {
  for (const key of ['Authorization', 'authorization', 'Proxy-Authorization']) {
    const row = buildActivityRow(activityInput({ [key]: `Bearer ${marker}`, label: 'retained' }), {});
    assert.deepStrictEqual(JSON.parse(row.input_params_json), {
      [key]: '<REDACTED>', label: 'retained',
    });
    assert.ok(!row.input_summary.includes(marker));
    assert.ok(row.input_summary.includes('retained'));
  }
  assert.deepStrictEqual(params({ headers: { Authorization: `Basic ${marker}`, Accept: 'application/json' } }), {
    headers: { Authorization: '<REDACTED>', Accept: 'application/json' },
  });
});

test('safe fields retain their values and existing array, object, depth, and string limits', () => {
  const safe = {
    max_tokens: 4096,
    tokenizer: 'bpe',
    author: 'example',
    auth_method: 'oidc',
    enabled: false,
    missing: null,
    label: '  two   words  ',
    detail: 'x'.repeat(200),
    entries: Array.from({ length: 10 }, (_, index) => index),
    nested: { second: { third: { fourth: 'omitted' } } },
  };
  assert.deepStrictEqual(params(safe), {
    ...safe,
    label: 'two words',
    detail: `${'x'.repeat(157)}...`,
    entries: safe.entries.slice(0, 8),
    nested: { second: { third: { fourth: '[Truncated]' } } },
  });
  const manyKeys = Object.fromEntries(Array.from({ length: 22 }, (_, index) => [`field_${index}`, index]));
  assert.deepStrictEqual(params(manyKeys), Object.fromEntries(Object.entries(manyKeys).slice(0, 20)));
});

test('credential containers cannot leak through derived file metadata or summaries', () => {
  const input = {
    credentials: { file_path: `${marker}-direct` },
    connections: [{ password: { file_paths: [`${marker}-array`] } }],
    headers: { Authorization: { source_path: `${marker}-header` } },
    files: [{ file_path: 'src/safe.js' }],
  };
  assert.deepStrictEqual(extractFilePaths(input), ['src/safe.js']);
  assert.deepStrictEqual(extractFileEvents('mcp__example__connect', input), [{ path: 'src/safe.js', action: 'touch' }]);
  const row = buildActivityRow(activityInput(input), {});
  assert.ok(!JSON.stringify(row).includes(marker));
  assert.deepStrictEqual(row.file_paths, ['src/safe.js']);
  assert.strictEqual(row.file_events.length, 1);
  assert.strictEqual(row.file_events[0].path, 'src/safe.js');
  assert.ok(row.input_summary.includes('src/safe.js'));
});

test('the real hook keeps credentials out of persisted activity while passing stdin through', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-input-redaction-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const raw = `${JSON.stringify(activityInput({
    password: `${marker}-direct`,
    Authorization: `Bearer ${marker}-header`,
    connections: [{ api_key: `${marker}-nested`, label: 'primary' }],
    credentials: { value: `${marker}-object`, file_path: `${marker}-path` },
    max_tokens: 4096,
    tokenizer: 'bpe',
  }), null, 2)}\n`;
  const result = spawnSync(process.execPath, [script], {
    input: raw,
    encoding: 'utf8',
    timeout: 10000,
    cwd: directory,
    env: { ...process.env, ECC_AGENT_DATA_HOME: directory },
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, raw);
  const saved = fs.readFileSync(path.join(directory, 'metrics/tool-usage.jsonl'), 'utf8');
  assert.ok(!saved.includes(marker), 'activity history must not retain any credential fragment');
  const rows = saved.trim().split('\n').map(line => JSON.parse(line));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].session_id, 'structured-input-test');
  assert.deepStrictEqual(JSON.parse(rows[0].input_params_json), {
    password: '<REDACTED>',
    Authorization: '<REDACTED>',
    connections: [{ api_key: '<REDACTED>', label: 'primary' }],
    credentials: '<REDACTED>',
    max_tokens: 4096,
    tokenizer: 'bpe',
  });
});
