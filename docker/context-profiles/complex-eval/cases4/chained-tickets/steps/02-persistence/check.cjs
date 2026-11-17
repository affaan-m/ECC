'use strict';
// Step 2 grader: persistence across a simulated restart (fresh module state,
// same DATA_FILE), expiry state survives, fresh/corrupt-start tolerance, conventions.
const fs = require('node:fs');
const path = require('node:path');

const checks = [];
const record = (name, ok) => checks.push({ name, ok: Boolean(ok) });
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  for (let i = checks.length; i < 7; i++) record(`unreached-${i + 1}`, false);
  const ok = checks.filter(c => c.ok).length;
  for (const c of checks) process.stdout.write(`${c.ok ? 'ok' : 'not ok'} - ${c.name}\n`);
  process.stdout.write(`ECC_EVAL_SCORE ${JSON.stringify({ score: ok / 7, passed: ok, total: 7 })}\n`);
  process.exit(0);
}
// A crashing agent server must not kill the grader: score what completed.
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = process.cwd();
const DATA_FILE = path.join(root, '.ecc-data', 'links.json');
const hasEnvelope = body => body && body.error && typeof body.error.code === 'string'
  && /^[A-Z][A-Z0-9_]+$/.test(body.error.code) && typeof body.error.message === 'string';

function purgeApp() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(root, 'src') + path.sep)) delete require.cache[key];
  }
}

async function start() {
  purgeApp();
  const { createApp } = require(path.join(root, 'src', 'app.js'));
  const app = createApp();
  await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); });
  return app;
}

(async () => {
  process.env.DATA_FILE = DATA_FILE;
  try {
    // First boot: create a durable link and a 1s-expiring link.
    let app = await start();
    let port = app.address().port;
    const post = body => fetch(`http://127.0.0.1:${port}/links`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const durable = await (await post({ url: 'https://example.com/durable' })).json().catch(() => null);
    const short = await (await post({ url: 'https://example.com/short', ttlSeconds: 1 })).json().catch(() => null);
    await new Promise(resolve => app.close(resolve));

    // Restart: fresh modules, same DATA_FILE.
    app = await start();
    port = app.address().port;
    const get = p => fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual' });

    const after = durable && durable.code ? await get(`/${durable.code}`) : null;
    record('link-survives-restart', after && after.status === 302
      && after.headers.get('location') === 'https://example.com/durable');

    await sleep(1300);
    const expiredAfter = short && short.code ? await get(`/${short.code}`) : null;
    record('expiry-survives-restart', expiredAfter && expiredAfter.status === 410);
    await new Promise(resolve => app.close(resolve));

    // Data file is real JSON on disk.
    let dataOk = false;
    try { JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); dataOk = true; } catch { /* missing/invalid */ }
    record('data-file-is-json', dataOk);

    // Fresh start with no data file present.
    fs.rmSync(DATA_FILE, { force: true });
    app = await start();
    port = app.address().port;
    const fresh = await fetch(`http://127.0.0.1:${port}/links`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/fresh' }) });
    record('fresh-start-without-data-file', fresh.status === 201);
    await new Promise(resolve => app.close(resolve));

    // Corrupt data file must not kill the service.
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, 'garbage{{{');
    app = await start();
    port = app.address().port;
    const afterCorrupt = await get('/anything1');
    record('corrupt-data-file-tolerated', afterCorrupt.status === 404
      && hasEnvelope(await afterCorrupt.json().catch(() => null)));
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(DATA_FILE, { force: true });
  } catch { /* remaining checks unscored */ }

  let changelog = '';
  try { changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'); } catch { /* missing */ }
  let tests = '';
  try {
    for (const f of fs.readdirSync(path.join(root, 'test'))) tests += fs.readFileSync(path.join(root, 'test', f), 'utf8');
  } catch { /* missing */ }
  const changelogEntries = (changelog.match(/^[-*#]/gm) || []).length;
  record('changelog-grown', changelogEntries >= 2 && /persist|restart|data/i.test(changelog));
  record('tests-grown', (tests.match(/\btest\(/g) || []).length >= 6);

  finish();
})();
