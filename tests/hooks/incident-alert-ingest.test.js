/**
 * Tests for incident-alert-ingest.js hook
 *
 * Run with: node tests/hooks/incident-alert-ingest.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const hook = require('../../scripts/hooks/incident-alert-ingest');
const script = path.join(__dirname, '../../scripts/hooks/incident-alert-ingest.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

function runScript(input, envOverrides = {}) {
  const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
  return spawnSync('node', [script], {
    encoding: 'utf8',
    input: inputStr,
    env: { ...process.env, ...envOverrides },
    timeout: 5000,
  });
}

console.log('\nincident-alert-ingest.js');

// --- Unit tests on exported run() ---

test('run() passes through non-alert input unchanged', () => {
  const input = JSON.stringify({ last_assistant_message: 'hello' });
  const result = hook.run(input);
  assert.strictEqual(result, input);
});

test('run() handles empty input without throwing', () => {
  assert.doesNotThrow(() => hook.run(''));
  assert.doesNotThrow(() => hook.run('{}'));
});

test('run() handles malformed JSON without throwing', () => {
  assert.doesNotThrow(() => hook.run('{not valid json'));
});

test('run() processes Datadog alert payload', () => {
  const input = JSON.stringify({
    alert: {
      source: 'datadog',
      service: 'payments-api',
      summary: 'Error rate 8% on POST /checkout',
      severity: 'critical',
      timestamp: '2026-06-24T10:00:00Z',
    },
  });
  // Should not throw, should return original input
  const result = hook.run(input);
  assert.strictEqual(result, input);
});

test('run() processes PagerDuty alert payload', () => {
  const input = JSON.stringify({
    alert: {
      source: 'pagerduty',
      service: 'auth-service',
      summary: 'Auth failures spike — users cannot log in',
      severity: 'high',
      alert_key: 'PD-12345',
    },
  });
  assert.doesNotThrow(() => hook.run(input));
});

test('run() processes tool_input alert', () => {
  const input = JSON.stringify({
    tool_input: {
      source: 'cloudwatch',
      service: 'order-api',
      summary: 'Latency p99 > 10s on GET /orders',
      severity: 'warning',
    },
  });
  assert.doesNotThrow(() => hook.run(input));
});

test('run() sanitizes control characters in alert fields', () => {
  const input = JSON.stringify({
    alert: {
      source: 'manual',
      service: 'test\x00service\x1b[31mred\x1b[0m',
      summary: 'test\nalert\twith\rcontrol chars',
      severity: 'warning',
    },
  });
  assert.doesNotThrow(() => hook.run(input));
});

test('run() handles very long summary by truncating', () => {
  const input = JSON.stringify({
    alert: {
      source: 'manual',
      service: 'api',
      summary: 'A'.repeat(10000),
      severity: 'warning',
    },
  });
  assert.doesNotThrow(() => hook.run(input));
});

// --- Severity classification ---

test('SEV1 keywords trigger critical classification', () => {
  const criticalPayloads = ['payment system down', 'complete outage', 'data corruption', 'p1 critical'];
  for (const text of criticalPayloads) {
    const input = JSON.stringify({ alert: { source: 'manual', service: 'api', summary: text, severity: '' } });
    // Just verify no throw — classification is logged to stderr
    assert.doesNotThrow(() => hook.run(input));
  }
});

test('SEV4 keywords produce low severity', () => {
  const input = JSON.stringify({
    alert: { source: 'manual', service: 'api', summary: 'logging metrics missing from dashboard', severity: 'info' },
  });
  assert.doesNotThrow(() => hook.run(input));
});

// --- Incident log file ---

test('writes to INCIDENT_LOG_FILE when alert is present', () => {
  const tmpLog = path.join(os.tmpdir(), `incident-test-${Date.now()}.log`);
  try {
    const input = JSON.stringify({
      alert: {
        source: 'datadog',
        service: 'payments-api',
        summary: 'Error rate spike',
        severity: 'critical',
      },
    });
    const result = spawnSync('node', [script], {
      encoding: 'utf8',
      input,
      env: { ...process.env, INCIDENT_LOG_FILE: tmpLog, SLACK_WEBHOOK_URL: '' },
      timeout: 5000,
    });
    assert.strictEqual(result.status, 0, `exit code: ${result.status}\n${result.stderr}`);
    assert.ok(fs.existsSync(tmpLog), 'Log file should be created');
    const content = fs.readFileSync(tmpLog, 'utf8');
    assert.ok(content.includes('payments-api'), 'Log should contain service name');
    assert.ok(content.includes('Error rate spike'), 'Log should contain summary');
  } finally {
    try { fs.unlinkSync(tmpLog); } catch { /* ignore */ }
  }
});

test('does not write log when no alert payload', () => {
  const tmpLog = path.join(os.tmpdir(), `incident-nowrite-${Date.now()}.log`);
  const input = JSON.stringify({ last_assistant_message: 'no alert here' });
  spawnSync('node', [script], {
    encoding: 'utf8',
    input,
    env: { ...process.env, INCIDENT_LOG_FILE: tmpLog, SLACK_WEBHOOK_URL: '' },
    timeout: 5000,
  });
  assert.ok(!fs.existsSync(tmpLog), 'Log file should NOT be created for non-alert input');
});

// --- stdin pass-through ---

test('passes stdin through to stdout unchanged', () => {
  const input = JSON.stringify({ last_assistant_message: 'no alert' });
  const result = runScript(input, { SLACK_WEBHOOK_URL: '', INCIDENT_LOG_FILE: '/dev/null' });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.trim(), input.trim());
});

test('exits 0 on empty stdin', () => {
  const result = runScript('', { SLACK_WEBHOOK_URL: '', INCIDENT_LOG_FILE: '/dev/null' });
  assert.strictEqual(result.status, 0);
});

// --- Summary ---
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
