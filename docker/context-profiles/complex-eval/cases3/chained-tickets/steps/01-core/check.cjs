'use strict';
// Step 1 grader: core API contract + conventions (envelope, layering, changelog, tests).
const fs = require('node:fs');
const path = require('node:path');

const checks = [];
const record = (name, ok) => checks.push({ name, ok: Boolean(ok) });
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  for (let i = checks.length; i < 10; i++) record(`unreached-${i + 1}`, false);
  const ok = checks.filter(c => c.ok).length;
  for (const c of checks) process.stdout.write(`${c.ok ? 'ok' : 'not ok'} - ${c.name}\n`);
  process.stdout.write(`ECC_EVAL_SCORE ${JSON.stringify({ score: ok / 10, passed: ok, total: 10 })}\n`);
  process.exit(0);
}
// A crashing agent server must not kill the grader: score what completed.
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = process.cwd();
const hasEnvelope = body => body && body.error && typeof body.error.code === 'string'
  && /^[A-Z][A-Z0-9_]+$/.test(body.error.code) && typeof body.error.message === 'string';

(async () => {
  let createApp;
  try { ({ createApp } = require(path.join(root, 'src', 'app.js'))); } catch { /* scored below */ }
  if (typeof createApp === 'function') {
    try {
      const app = createApp();
      await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
      const port = app.address().port;
      const post = (body) => fetch(`http://127.0.0.1:${port}/links`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const get = (p) => fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual' });

      const created = await post({ url: 'https://example.com/landing' });
      const createdBody = await created.json().catch(() => null);
      record('create-happy-201', created.status === 201 && createdBody
        && /^[A-Za-z0-9]{6,10}$/.test(createdBody.code || '') && typeof createdBody.shortUrl === 'string'
        && typeof createdBody.expiresAt === 'string' && !Number.isNaN(Date.parse(createdBody.expiresAt)));

      let code = createdBody && createdBody.code;
      if (code) {
        const redirect = await get(`/${code}`);
        record('redirect-302-location', redirect.status === 302
          && redirect.headers.get('location') === 'https://example.com/landing');
      } else record('redirect-302-location', false);

      const unknown = await get('/nope00');
      record('unknown-code-404-envelope', unknown.status === 404 && hasEnvelope(await unknown.json().catch(() => null)));

      const badUrl = await post({ url: 'notaurl' });
      record('invalid-url-400-envelope', badUrl.status === 400 && hasEnvelope(await badUrl.json().catch(() => null)));
      const noBody = await post({});
      record('missing-url-400-envelope', noBody.status === 400 && hasEnvelope(await noBody.json().catch(() => null)));
      const badTtl = await post({ url: 'https://example.com', ttlSeconds: 99999999 });
      record('ttl-bounds-400-envelope', badTtl.status === 400 && hasEnvelope(await badTtl.json().catch(() => null)));

      const expiring = await post({ url: 'https://example.com/gone', ttlSeconds: 1 });
      const expiringBody = await expiring.json().catch(() => null);
      if (expiringBody && expiringBody.code) {
        await sleep(1300);
        const gone = await get(`/${expiringBody.code}`);
        record('expired-link-410-envelope', gone.status === 410 && hasEnvelope(await gone.json().catch(() => null)));
      } else record('expired-link-410-envelope', false);

      if (code) {
        const del = await fetch(`http://127.0.0.1:${port}/links/${code}`, { method: 'DELETE' });
        const after = await get(`/${code}`);
        record('delete-flow-204-then-404', del.status === 204 && after.status === 404);
      } else record('delete-flow-204-then-404', false);
      app.close();
    } catch { /* remaining checks unscored */ }
  } else {
    for (const name of ['create-happy-201', 'redirect-302-location', 'unknown-code-404-envelope',
      'invalid-url-400-envelope', 'missing-url-400-envelope', 'ttl-bounds-400-envelope',
      'expired-link-410-envelope', 'delete-flow-204-then-404']) record(name, false);
  }

  // Conventions.
  let changelog = '';
  try { changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'); } catch { /* missing */ }
  let tests = '';
  try {
    for (const f of fs.readdirSync(path.join(root, 'test'))) tests += fs.readFileSync(path.join(root, 'test', f), 'utf8');
  } catch { /* missing */ }
  const testCount = (tests.match(/\btest\(/g) || []).length;
  record('changelog-and-tests', changelog.length > 20 && testCount >= 3);
  record('layering-files', ['routes.js', 'service.js', 'store.js']
    .every(f => fs.existsSync(path.join(root, 'src', f))));

  finish();
})();
