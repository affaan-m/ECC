'use strict';
// Step 3 grader: abuse handling — URL validation, size limits, rate limiting —
// plus conventions. Hammer probe runs last so earlier probes stay unthrottled.
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
const DATA_FILE = path.join(root, '.ecc-data', 'links-step3.json');
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
    const post = body => fetch(`http://127.0.0.1:${port}/links`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const okCreate = await post({ url: 'https://example.com/normal' });
    record('normal-create-still-201', okCreate.status === 201);

    const js = await post({ url: 'javascript:alert(1)' });
    record('javascript-scheme-400-envelope', js.status === 400 && hasEnvelope(await js.json().catch(() => null)));
    const ftp = await post({ url: 'ftp://files.example.com/x' });
    record('non-http-scheme-400-envelope', ftp.status === 400 && hasEnvelope(await ftp.json().catch(() => null)));
    const huge = await post({ url: `https://example.com/${'a'.repeat(10000)}` });
    const hugeBody = await huge.json().catch(() => null);
    record('oversize-url-4xx-envelope', huge.status >= 400 && huge.status < 500 && hasEnvelope(hugeBody));

    // Hammer: 60 rapid creates must trip a 429 with the envelope.
    const responses = await Promise.all(Array.from({ length: 60 }, (_, i) =>
      post({ url: `https://example.com/flood-${i}` })));
    const limited = [];
    for (const r of responses) if (r.status === 429) limited.push(await r.json().catch(() => null));
    record('rate-limit-429-envelope', limited.length > 0 && limited.every(hasEnvelope));
    app.close();
  } catch { /* remaining checks unscored */ }

  let sources = '';
  try {
    for (const f of fs.readdirSync(path.join(root, 'src'))) {
      if (f.endsWith('.js')) sources += fs.readFileSync(path.join(root, 'src', f), 'utf8');
    }
  } catch { /* missing */ }
  record('rate-limiting-implemented', /429|rate.?limit/i.test(sources));

  let changelog = '';
  try { changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'); } catch { /* missing */ }
  let tests = '';
  try {
    for (const f of fs.readdirSync(path.join(root, 'test'))) tests += fs.readFileSync(path.join(root, 'test', f), 'utf8');
  } catch { /* missing */ }
  const changelogEntries = (changelog.match(/^[-*#]/gm) || []).length;
  record('changelog-grown', changelogEntries >= 3 && /abuse|rate|valid|secur/i.test(changelog));
  record('tests-grown', (tests.match(/\btest\(/g) || []).length >= 9);

  finish();
})();
