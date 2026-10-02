'use strict';
// Hidden grader for production-ready: probes every dimension of the documented
// production bar. Prints ECC_EVAL_SCORE and always exits 0.
const fs = require('node:fs');
const path = require('node:path');

const checks = [];
const record = (name, ok) => checks.push({ name, ok: Boolean(ok) });
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  for (let i = checks.length; i < 16; i++) record(`unreached-${i + 1}`, false);
  const ok = checks.filter(c => c.ok).length;
  for (const c of checks) process.stdout.write(`${c.ok ? 'ok' : 'not ok'} - ${c.name}\n`);
  process.stdout.write(`ECC_EVAL_SCORE ${JSON.stringify({ score: ok / 16, passed: ok, total: 16 })}\n`);
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
  try { ({ createApp } = require(path.join(root, 'src', 'app.js'))); } catch { /* scored below */ }
  if (typeof createApp === 'function') {
    // Capture console output during the probe run to inspect request logging.
    const logged = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => { logged.push(args.join(' ')); };
    console.error = (...args) => { logged.push(args.join(' ')); };
    try {
      const app = createApp();
      await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
      const port = app.address().port;
      const api = (p, options) => fetch(`http://127.0.0.1:${port}${p}`, options);
      const post = body => api('/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body });

      // Documented API still works.
      const created = await post(JSON.stringify({ title: 'deploy', body: 'checklist' }));
      const createdBody = await created.json().catch(() => null);
      record('api-roundtrip-preserved', created.status === 201 && createdBody && createdBody.id
        && (await (await api(`/notes/${createdBody.id}`)).json().catch(() => ({}))).title === 'deploy'
        && Array.isArray((await (await api('/notes')).json().catch(() => ({}))).notes));

      // Validation and envelope discipline.
      const badJson = await post('{not json');
      record('malformed-json-400-envelope', badJson.status === 400 && hasEnvelope(await badJson.json().catch(() => null)));
      const missing = await post(JSON.stringify({ body: 'no title' }));
      record('missing-field-400-envelope', missing.status === 400 && hasEnvelope(await missing.json().catch(() => null)));
      const wrongType = await post(JSON.stringify({ title: 42, body: 'x' }));
      record('wrong-type-400-envelope', wrongType.status === 400 && hasEnvelope(await wrongType.json().catch(() => null)));
      const unknown = await api('/notes/n_999999');
      const unknownBody = await unknown.text();
      let unknownParsed = null;
      try { unknownParsed = JSON.parse(unknownBody); } catch { /* html or text */ }
      record('unknown-404-json-envelope', unknown.status === 404 && hasEnvelope(unknownParsed));

      // Body limit.
      const big = await post(JSON.stringify({ title: 'big', body: 'x'.repeat(100 * 1024) }));
      record('oversize-body-413-envelope', big.status === 413 && hasEnvelope(await big.json().catch(() => null)));

      // Health endpoint.
      const health = await api('/health');
      const healthBody = await health.json().catch(() => null);
      record('health-endpoint', health.status === 200 && healthBody && healthBody.status === 'ok');

      // Security header on a normal response.
      const headers = await api('/notes');
      record('nosniff-header', headers.headers.get('x-content-type-options') === 'nosniff');

      // Error responses carry JSON content type.
      record('errors-are-json', /application\/json/.test(unknown.headers.get('content-type') || ''));

      app.close();
    } catch { /* remaining checks unscored */ } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    // Structured request logging: at least one JSON line with method/path/status-ish fields.
    const structured = logged.some(line => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === 'object'
          && /method/i.test(Object.keys(parsed).join(' '))
          && /path|url/i.test(Object.keys(parsed).join(' '))
          && /status/i.test(Object.keys(parsed).join(' '));
      } catch { return false; }
    });
    record('structured-request-logs', structured);
  } else {
    for (const name of ['api-roundtrip-preserved', 'malformed-json-400-envelope', 'missing-field-400-envelope',
      'wrong-type-400-envelope', 'unknown-404-json-envelope', 'oversize-body-413-envelope', 'health-endpoint',
      'nosniff-header', 'errors-are-json', 'structured-request-logs']) record(name, false);
  }

  // Static dimensions.
  let sources = '';
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const item = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(item);
      else if (entry.name.endsWith('.js')) sources += fs.readFileSync(item, 'utf8');
    }
  };
  try { walk(path.join(root, 'src')); } catch { /* none */ }
  record('sigterm-graceful-shutdown', /SIGTERM/.test(sources));
  record('env-config-port', /process\.env\.[A-Z_]*PORT/.test(sources));

  let tests = '';
  try {
    for (const f of fs.readdirSync(path.join(root, 'test'))) tests += fs.readFileSync(path.join(root, 'test', f), 'utf8');
  } catch { /* missing */ }
  const testCount = (tests.match(/\btest\(/g) || []).length;
  record('tests-cover-error-paths', testCount >= 4 && /400|404|413|invalid|error/i.test(tests));

  let changelog = '';
  try { changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'); } catch { /* missing */ }
  record('changelog-entry', changelog.length > 20 && /product|harden|valid|health|log/i.test(changelog));

  record('no-leftover-todos', !/TODO|FIXME/.test(sources));
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    record('no-external-dependencies', !pkg.dependencies && !pkg.devDependencies);
  } catch { record('no-external-dependencies', false); }

  finish();
})();
