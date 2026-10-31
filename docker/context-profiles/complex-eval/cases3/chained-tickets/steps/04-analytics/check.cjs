'use strict';
// Step 4 grader: hit analytics consistent with the existing API, conventions,
// docs and tests. (Runs in a later process than step 3, so rate windows cleared.)
const fs = require('node:fs');
const path = require('node:path');

const checks = [];
const record = (name, ok) => checks.push({ name, ok: Boolean(ok) });
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  for (let i = checks.length; i < 8; i++) record(`unreached-${i + 1}`, false);
  const ok = checks.filter(c => c.ok).length;
  for (const c of checks) process.stdout.write(`${c.ok ? 'ok' : 'not ok'} - ${c.name}\n`);
  process.stdout.write(`ECC_EVAL_SCORE ${JSON.stringify({ score: ok / 8, passed: ok, total: 8 })}\n`);
  process.exit(0);
}
// A crashing agent server must not kill the grader: score what completed.
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);
const root = process.cwd();
const DATA_FILE = path.join(root, '.ecc-data', 'links-step4.json');
const hasEnvelope = body => body && body.error && typeof body.error.code === 'string'
  && /^[A-Z][A-Z0-9_]+$/.test(body.error.code) && typeof body.error.message === 'string';

function purgeApp() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(root, 'src') + path.sep)) delete require.cache[key];
  }
}

(async () => {
  process.env.DATA_FILE = DATA_FILE;
  try {
    purgeApp();
    const { createApp } = require(path.join(root, 'src', 'app.js'));
    const app = createApp();
    await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
    const port = app.address().port;

    const created = await fetch(`http://127.0.0.1:${port}/links`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/tracked' }) });
    const body = await created.json().catch(() => null);
    const code = body && body.code;
    record('create-still-works', created.status === 201 && Boolean(code));

    if (code) {
      const before = await fetch(`http://127.0.0.1:${port}/links/${code}/stats`);
      const beforeBody = await before.json().catch(() => null);
      record('stats-zero-before-redirects', before.status === 200 && beforeBody && beforeBody.hits === 0);

      for (let i = 0; i < 3; i++) {
        await fetch(`http://127.0.0.1:${port}/${code}`, { redirect: 'manual' });
      }
      const stats = await fetch(`http://127.0.0.1:${port}/links/${code}/stats`);
      const statsBody = await stats.json().catch(() => null);
      record('stats-count-three-hits', stats.status === 200 && statsBody && statsBody.hits === 3);

      const redirect = await fetch(`http://127.0.0.1:${port}/${code}`, { redirect: 'manual' });
      record('redirect-still-302', redirect.status === 302);

      const missing = await fetch(`http://127.0.0.1:${port}/links/zzzzzz/stats`);
      record('stats-unknown-404-envelope', missing.status === 404
        && hasEnvelope(await missing.json().catch(() => null)));
    } else {
      for (const name of ['stats-zero-before-redirects', 'stats-count-three-hits',
        'redirect-still-302', 'stats-unknown-404-envelope']) record(name, false);
    }
    app.close();
  } catch { /* remaining checks unscored */ }

  let readme = '';
  try { readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8'); } catch { /* missing */ }
  record('readme-documents-stats', /\/stats|hits|analytics/i.test(readme));
  let changelog = '';
  try { changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'); } catch { /* missing */ }
  let tests = '';
  try {
    for (const f of fs.readdirSync(path.join(root, 'test'))) tests += fs.readFileSync(path.join(root, 'test', f), 'utf8');
  } catch { /* missing */ }
  const changelogEntries = (changelog.match(/^[-*#]/gm) || []).length;
  record('changelog-grown', changelogEntries >= 4 && /stat|analytic|hit/i.test(changelog));
  record('tests-grown', (tests.match(/\btest\(/g) || []).length >= 12);

  finish();
})();
