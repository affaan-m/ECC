'use strict';

/**
 * Tests for ai-diagnosis service (unit — no Claude API calls)
 * Run: node tests/saas/ai-diagnosis.test.js
 */

const assert = require('assert');

process.env.ANTHROPIC_API_KEY = 'sk-ant-test-stub';
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';

const { buildIncidentContext } = require('../../src/saas/services/ai-diagnosis');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}: ${err.message}`); failed++; }
}

console.log('\nai-diagnosis service (unit)');

const BASE_INCIDENT = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Payments API — Error rate 8% on POST /checkout',
  service: 'payments-api',
  severity: 1,
  status: 'open',
  source_type: 'datadog',
  created_at: '2026-06-24T10:00:00Z',
  summary: 'Error rate spiking on checkout endpoint since deploy at 09:55',
  root_cause: null,
  mitigation: null,
  duration_secs: 600,
};

// ─── buildIncidentContext ─────────────────────────────────────────────────────

test('includes title in context', () => {
  const ctx = buildIncidentContext(BASE_INCIDENT);
  assert.ok(ctx.includes('Payments API'), `Expected title, got: ${ctx.slice(0, 100)}`);
});

test('includes service in context', () => {
  const ctx = buildIncidentContext(BASE_INCIDENT);
  assert.ok(ctx.includes('payments-api'));
});

test('includes severity in context', () => {
  const ctx = buildIncidentContext(BASE_INCIDENT);
  assert.ok(ctx.includes('SEV1'));
});

test('includes source type in context', () => {
  const ctx = buildIncidentContext(BASE_INCIDENT);
  assert.ok(ctx.includes('datadog'));
});

test('includes summary when present', () => {
  const ctx = buildIncidentContext(BASE_INCIDENT);
  assert.ok(ctx.includes('Error rate spiking'));
});

test('does NOT include root_cause when null', () => {
  const ctx = buildIncidentContext({ ...BASE_INCIDENT, root_cause: null });
  assert.ok(!ctx.includes('Known root cause'));
});

test('includes root_cause when set', () => {
  const ctx = buildIncidentContext({ ...BASE_INCIDENT, root_cause: 'Bad deploy at v1.2.3' });
  assert.ok(ctx.includes('Bad deploy at v1.2.3'));
});

test('includes recent timeline events', () => {
  const events = [
    { created_at: '2026-06-24T10:01:00Z', actor: 'ai', event_type: 'alert_received', message: 'Alert received from datadog' },
    { created_at: '2026-06-24T10:02:00Z', actor: 'on-call@corp.com', event_type: 'comment', message: 'Investigating now' },
  ];
  const ctx = buildIncidentContext(BASE_INCIDENT, events);
  assert.ok(ctx.includes('Timeline'));
  assert.ok(ctx.includes('Investigating now'));
});

test('limits timeline to last 20 events', () => {
  const events = Array.from({ length: 30 }, (_, i) => ({
    created_at: `2026-06-24T10:${String(i).padStart(2,'0')}:00Z`,
    actor: 'ai',
    event_type: 'comment',
    message: `Event number ${i}`,
  }));
  const ctx = buildIncidentContext(BASE_INCIDENT, events);
  // Should include event 29 (last) but not event 0 (first, excluded by slice(-20))
  assert.ok(ctx.includes('Event number 29'));
  assert.ok(!ctx.includes('Event number 0'));
});

test('sanitizes control characters in incident fields', () => {
  const inc = { ...BASE_INCIDENT, title: 'test\x00\x1b[31mred\x1b[0m title', service: 'api\x00' };
  const ctx = buildIncidentContext(inc);
  assert.ok(!ctx.includes('\x00'));
  assert.ok(!ctx.includes('\x1b'));
});

test('handles empty events array', () => {
  assert.doesNotThrow(() => buildIncidentContext(BASE_INCIDENT, []));
});

test('handles missing optional fields gracefully', () => {
  const minimal = { title: 'Test', service: 'api', severity: 3, status: 'open', source_type: null, created_at: null };
  assert.doesNotThrow(() => buildIncidentContext(minimal, []));
});

test('context is a non-empty string', () => {
  const ctx = buildIncidentContext(BASE_INCIDENT);
  assert.ok(typeof ctx === 'string' && ctx.length > 0);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
