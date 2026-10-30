'use strict';
// Hidden grader for idempotent-webhooks: exactly-once under sequential,
// concurrent, and mixed-concurrent duplicates, plus the documented API,
// regression coverage, and hygiene. Prints ECC_EVAL_SCORE and always exits 0.
const fs = require('node:fs');
const path = require('node:path');

const checks = [];
const record = (name, ok) => checks.push({ name, ok: Boolean(ok) });
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  for (let i = checks.length; i < 12; i++) record(`unreached-${i + 1}`, false);
  const ok = checks.filter(c => c.ok).length;
  for (const c of checks) process.stdout.write(`${c.ok ? 'ok' : 'not ok'} - ${c.name}\n`);
  process.stdout.write(`ECC_EVAL_SCORE ${JSON.stringify({ score: ok / 12, passed: ok, total: 12 })}\n`);
  process.exit(0);
}
// A crashing agent server must not kill the grader: score what completed.
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);
const root = process.cwd();
const hasEnvelope = body => body && body.error && typeof body.error.code === 'string'
  && /^[A-Z][A-Z0-9_]+$/.test(body.error.code) && typeof body.error.message === 'string';

(async () => {
  let createApp;
  let store;
  try {
    ({ createApp } = require(path.join(root, 'src', 'app.js')));
    ({ store } = require(path.join(root, 'src', 'store.js')));
  } catch { /* scored below */ }
  if (typeof createApp === 'function' && store && Array.isArray(store.paymentLog)) {
    try {
      const app = createApp();
      await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
      const port = app.address().port;
      const send = (eventId, orderId, amountCents) => fetch(`http://127.0.0.1:${port}/webhooks/payments`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId, orderId, amountCents, type: 'payment.succeeded' }) });
      const logsFor = orderId => store.paymentLog.filter(p => p.orderId === orderId).length;

      // 1: single delivery applies once.
      const single = await send('ev-1', 'o1', 5000);
      const singleBody = await single.json().catch(() => null);
      record('single-delivery-processed', single.status === 200 && singleBody
        && singleBody.status === 'processed' && singleBody.orderId === 'o1' && logsFor('o1') === 1);

      // 2: sequential retry replays without re-applying.
      const retry = await send('ev-1', 'o1', 5000);
      const retryBody = await retry.json().catch(() => null);
      record('sequential-duplicate-inert', retry.status === 200 && retryBody
        && retryBody.status === 'duplicate' && logsFor('o1') === 1);

      // 3: fifty concurrent identical deliveries apply exactly once.
      const storm = await Promise.all(Array.from({ length: 50 }, () => send('ev-2', 'o2', 12500)));
      const stormBodies = [];
      for (const r of storm) stormBodies.push(await r.json().catch(() => null));
      const processedCount = stormBodies.filter(b => b && b.status === 'processed').length;
      const duplicateCount = stormBodies.filter(b => b && b.status === 'duplicate').length;
      record('concurrent-storm-exactly-once', storm.every(r => r.status === 200)
        && processedCount === 1 && duplicateCount === 49 && logsFor('o2') === 1
        && store.orders.get('o2').paymentsApplied === 1);

      // 4: a different event for an already-paid order is already_paid and inert.
      const second = await send('ev-3', 'o2', 12500);
      const secondBody = await second.json().catch(() => null);
      record('already-paid-order-inert', second.status === 200 && secondBody
        && secondBody.status === 'already_paid' && logsFor('o2') === 1);

      // 5-7: contract errors with envelopes.
      const unknown = await send('ev-4', 'nope', 100);
      record('unknown-order-404-envelope', unknown.status === 404 && hasEnvelope(await unknown.json().catch(() => null)));
      const malformed = await fetch(`http://127.0.0.1:${port}/webhooks/payments`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' });
      record('malformed-body-400-envelope', malformed.status === 400 && hasEnvelope(await malformed.json().catch(() => null)));
      const mismatch = await send('ev-5', 'o3', 999999);
      record('amount-mismatch-422-envelope', mismatch.status === 422
        && hasEnvelope(await mismatch.json().catch(() => null)) && logsFor('o3') === 0);

      // 8: mixed storm — three orders, three eventIds, ten duplicates each, all concurrent.
      const mixed = await Promise.all(['o4', 'o5', 'o6'].flatMap(orderId =>
        Array.from({ length: 10 }, () => send(`ev-${orderId}`, orderId, store.orders.get(orderId).amountCents))));
      for (const r of mixed) await r.json().catch(() => null);
      record('mixed-storm-each-order-once', ['o4', 'o5', 'o6'].every(orderId =>
        logsFor(orderId) === 1 && store.orders.get(orderId).paymentsApplied === 1));

      // 9: order inspection endpoint reflects reality.
      const orderView = await fetch(`http://127.0.0.1:${port}/orders/o2`);
      const orderBody = await orderView.json().catch(() => null);
      record('order-endpoint-accurate', orderView.status === 200 && orderBody
        && orderBody.status === 'paid' && orderBody.paymentsApplied === 1 && Boolean(orderBody.paidAt));

      app.close();
    } catch { /* remaining checks unscored */ }
  } else {
    for (const name of ['single-delivery-processed', 'sequential-duplicate-inert', 'concurrent-storm-exactly-once',
      'already-paid-order-inert', 'unknown-order-404-envelope', 'malformed-body-400-envelope',
      'amount-mismatch-422-envelope', 'mixed-storm-each-order-once', 'order-endpoint-accurate']) record(name, false);
  }

  // Conventions.
  let tests = '';
  try {
    for (const f of fs.readdirSync(path.join(root, 'test'))) tests += fs.readFileSync(path.join(root, 'test', f), 'utf8');
  } catch { /* missing */ }
  record('concurrency-regression-tests', (tests.match(/\btest\(/g) || []).length >= 4
    && /Promise\.all|concurrent|duplicate|retry/i.test(tests));
  let changelog = '';
  try { changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'); } catch { /* missing */ }
  record('changelog-entry', /idem|duplicat|retry|inc-104|race/i.test(changelog));
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    record('no-external-dependencies', !pkg.dependencies && !pkg.devDependencies);
  } catch { record('no-external-dependencies', false); }

  finish();
})();
