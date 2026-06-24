'use strict';

/**
 * Tests for billing service (unit — no Stripe or DB calls)
 * Run: node tests/saas/billing.test.js
 */

const assert = require('assert');

// Stub env before requiring billing
process.env.STRIPE_SECRET_KEY    = 'sk_test_stub';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_stub';
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';

const billing = require('../../src/saas/services/billing');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}: ${err.message}`); failed++; }
}

console.log('\nbilling service (unit)');

// ─── Plan limits ──────────────────────────────────────────────────────────────

test('starter: 1 alert source, 100 incidents/month, no AI', () => {
  const l = billing.getPlanLimits('starter');
  assert.strictEqual(l.alert_sources, 1);
  assert.strictEqual(l.incidents_per_month, 100);
  assert.strictEqual(l.ai_diagnosis, false);
});

test('team: 10 sources, unlimited incidents, AI enabled', () => {
  const l = billing.getPlanLimits('team');
  assert.strictEqual(l.alert_sources, 10);
  assert.strictEqual(l.incidents_per_month, null);
  assert.strictEqual(l.ai_diagnosis, true);
});

test('enterprise: unlimited everything', () => {
  const l = billing.getPlanLimits('enterprise');
  assert.strictEqual(l.alert_sources, null);
  assert.strictEqual(l.incidents_per_month, null);
  assert.strictEqual(l.ai_diagnosis, true);
});

test('unknown plan defaults to starter limits', () => {
  const l = billing.getPlanLimits('unknown_plan');
  assert.strictEqual(l.alert_sources, 1);
});

// ─── Feature access ───────────────────────────────────────────────────────────

test('starter: ai_diagnosis blocked', () => {
  const r = billing.checkFeatureAccess('starter', 'ai_diagnosis');
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reason);
  assert.strictEqual(r.upgrade_to, 'team');
});

test('team: ai_diagnosis allowed', () => {
  const r = billing.checkFeatureAccess('team', 'ai_diagnosis');
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.reason, null);
});

test('enterprise: ai_diagnosis allowed', () => {
  const r = billing.checkFeatureAccess('enterprise', 'ai_diagnosis');
  assert.strictEqual(r.allowed, true);
});

test('starter: postmortems blocked', () => {
  const r = billing.checkFeatureAccess('starter', 'postmortems');
  assert.strictEqual(r.allowed, false);
});

test('team: postmortems allowed', () => {
  const r = billing.checkFeatureAccess('team', 'postmortems');
  assert.strictEqual(r.allowed, true);
});

// ─── Webhook signature verification ──────────────────────────────────────────

const crypto = require('crypto');
const WEBHOOK_SECRET = 'whsec_test_stub';

function makeStripeSignature(rawBody) {
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${ts}.${rawBody}`;
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  return { header: `t=${ts},v1=${sig}`, ts };
}

test('verifyWebhookSignature: valid signature accepted', () => {
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
  const { header } = makeStripeSignature(body);
  const event = billing.verifyWebhookSignature(body, header);
  assert.strictEqual(event.type, 'checkout.session.completed');
});

test('verifyWebhookSignature: tampered body rejected', () => {
  const body = JSON.stringify({ type: 'legit_event', data: { object: {} } });
  const { header } = makeStripeSignature(body);
  const tamperedBody = JSON.stringify({ type: 'malicious_event', data: { object: {} } });
  assert.throws(() => billing.verifyWebhookSignature(tamperedBody, header), /mismatch/);
});

test('verifyWebhookSignature: missing signature rejected', () => {
  assert.throws(() => billing.verifyWebhookSignature('{}', ''), /format/);
});

test('verifyWebhookSignature: stale timestamp rejected', () => {
  const body = '{}';
  const ts = Math.floor(Date.now() / 1000) - 400; // 400s old, limit is 300s
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex');
  assert.throws(
    () => billing.verifyWebhookSignature(body, `t=${ts},v1=${sig}`),
    /too old/
  );
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
