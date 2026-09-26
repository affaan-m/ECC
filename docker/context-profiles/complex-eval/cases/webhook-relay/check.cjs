'use strict';
// Hidden grader for webhook-relay: drives the agent's relay in-process against
// local target servers and prints ECC_EVAL_SCORE. Always exits 0; the score line
// carries the result. Runs under Node's read-only permission model, so it only
// reads the workspace and talks to 127.0.0.1.
const http = require('node:http');
const path = require('node:path');

const checks = [];
const record = (name, ok) => checks.push({ name, ok: Boolean(ok) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  const ok = checks.filter(c => c.ok).length;
  for (const c of checks) console.log(`${c.ok ? 'ok' : 'not ok'} - ${c.name}`);
  console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: checks.length ? ok / checks.length : 0, passed: ok, total: checks.length })}`);
  process.exit(0);
}
setTimeout(finish, 45000).unref();

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function postJson(port, urlPath, body) {
  return fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async response => ({ status: response.status, body: await response.json().catch(() => null) }));
}

async function waitForStatus(port, id, wanted, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/deliveries/${id}`);
      if (response.status === 200) {
        last = await response.json();
        if (last.status === wanted || last.status === 'dead') return { record: last, elapsedMs: Date.now() - started };
      }
    } catch { /* relay not ready yet */ }
    await sleep(25);
  }
  return { record: last, elapsedMs: Date.now() - started };
}

(async () => {
  let createRelay;
  try { ({ createRelay } = require(path.join(process.cwd(), 'src', 'app.js'))); } catch { finish(); return; }
  if (typeof createRelay !== 'function') { finish(); return; }

  // Probe group 1: a target that fails 3 times then succeeds.
  let calls = 0;
  const flaky = http.createServer((req, res) => {
    calls++;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { res.writeHead(calls <= 3 ? 500 : 200); res.end('{}'); });
  });
  const relay = createRelay();
  try {
    const flakyPort = await listen(flaky);
    const relayPort = await listen(relay);
    const started = Date.now();
    const created = await postJson(relayPort, '/deliveries', { url: `http://127.0.0.1:${flakyPort}/hook`, payload: { hello: 'world' } });
    record('accepts-delivery-202', created.status === 202 && created.body && typeof created.body.id === 'string');
    if (created.body && created.body.id) {
      const { record: rec, elapsedMs } = await waitForStatus(relayPort, created.body.id, 'delivered', 8000);
      record('delivered-after-retries', rec && rec.status === 'delivered' && calls >= 4);
      record('attempts-counted', rec && rec.attempts === 4);
      record('backoff-window-respected', rec && rec.status === 'delivered' && elapsedMs >= 250 && elapsedMs <= 5000 && Date.now() - started >= 250);
    } else {
      record('delivered-after-retries', false);
      record('attempts-counted', false);
      record('backoff-window-respected', false);
    }

    // Probe group 2: a target that always fails -> dead after exactly 5 attempts.
    let deadCalls = 0;
    const deadEnd = http.createServer((req, res) => {
      deadCalls++;
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { res.writeHead(500); res.end('{}'); });
    });
    const deadPort = await listen(deadEnd);
    const doomed = await postJson(relayPort, '/deliveries', { url: `http://127.0.0.1:${deadPort}/hook`, payload: { x: 1 } });
    if (doomed.body && doomed.body.id) {
      const { record: rec } = await waitForStatus(relayPort, doomed.body.id, 'dead', 15000);
      record('dead-after-retries-exhausted', rec && rec.status === 'dead');
      record('exactly-five-attempts', rec && rec.status === 'dead' && rec.attempts === 5 && deadCalls === 5);
      record('last-error-recorded', rec && rec.status === 'dead' && typeof rec.lastError === 'string' && rec.lastError.length > 0);
    } else {
      record('dead-after-retries-exhausted', false);
      record('exactly-five-attempts', false);
      record('last-error-recorded', false);
    }
    deadEnd.close();

    // Probe 3: pre-existing API behavior is preserved.
    const missing = await fetch(`http://127.0.0.1:${relayPort}/deliveries/00000000-0000-0000-0000-000000000000`);
    record('unknown-id-still-404', missing.status === 404);

    // Probe 4: concurrent deliveries all complete.
    let goodCalls = 0;
    const good = http.createServer((req, res) => {
      goodCalls++;
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { res.writeHead(200); res.end('{}'); });
    });
    const goodPort = await listen(good);
    const batch = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      postJson(relayPort, '/deliveries', { url: `http://127.0.0.1:${goodPort}/hook`, payload: { i } })));
    const settled = await Promise.all(batch.map(item => item.body && item.body.id
      ? waitForStatus(relayPort, item.body.id, 'delivered', 10000).then(r => r.record && r.record.status === 'delivered')
      : false));
    record('concurrent-deliveries-complete', settled.every(Boolean) && goodCalls === 10);
    good.close();
  } catch { /* any grader-side failure leaves the missing checks unscored */ }
  finish();
})();
