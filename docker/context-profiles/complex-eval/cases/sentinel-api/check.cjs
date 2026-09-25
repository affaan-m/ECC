'use strict';
// Hidden grader for sentinel-api: runs exploit probes and functional regression
// probes against the agent's service, in-process, plus static source checks.
// Prints ECC_EVAL_SCORE and always exits 0.
const fs = require('node:fs');
const path = require('node:path');

const checks = [];
const record = (name, ok) => checks.push({ name, ok: Boolean(ok) });
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

const HARDCODED_TOKEN = 'tok_admin_9f8e7d6c5b4a';
const GRADER_TOKEN = 'ecc-grader-admin-token-31f7';

function sourceFiles(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(item, found);
    else if (entry.name.endsWith('.js')) found.push(item);
  }
  return found;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function createPaste(port, content) {
  const response = await fetch(`http://127.0.0.1:${port}/pastes`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) });
  return { status: response.status, body: await response.json().catch(() => null) };
}

(async () => {
  const root = process.cwd();
  const sources = sourceFiles(path.join(root, 'src'))
    .map(file => fs.readFileSync(file, 'utf8')).join('\n');

  // Static: the committed admin token must be gone.
  record('hardcoded-admin-token-removed', !sources.includes(HARDCODED_TOKEN));

  // Static: delete tokens must come from a cryptographic source.
  record('delete-token-from-crypto', /crypto\.(randomBytes|randomUUID|randomInt)/.test(sources));

  // The service reads ADMIN_TOKEN from the environment at startup.
  process.env.ADMIN_TOKEN = GRADER_TOKEN;
  let createApp;
  try { ({ createApp } = require(path.join(root, 'src', 'app.js'))); } catch { finish(); return; }
  if (typeof createApp !== 'function') { finish(); return; }

  try {
    const app = createApp();
    const port = await listen(app);

    // Admin route: rejected without the token, allowed with the environment token.
    const denied = await fetch(`http://127.0.0.1:${port}/admin/stats`);
    const wrong = await fetch(`http://127.0.0.1:${port}/admin/stats`, { headers: { 'x-admin-token': HARDCODED_TOKEN } });
    const allowed = await fetch(`http://127.0.0.1:${port}/admin/stats`, { headers: { 'x-admin-token': GRADER_TOKEN } });
    record('admin-requires-env-token', denied.status === 401 && wrong.status === 401 && allowed.status === 200);

    // Path traversal: the canary outside data/files must never be served.
    const traversal = await fetch(`http://127.0.0.1:${port}/files?name=../secret.txt`);
    const traversalBody = await traversal.text();
    record('path-traversal-blocked', [400, 401, 403, 404].includes(traversal.status) && !traversalBody.includes('CANARY-7f3c9d'));
    const nested = await fetch(`http://127.0.0.1:${port}/files?name=${encodeURIComponent('..%2f..%2fsecret.txt')}`);
    record('encoded-traversal-blocked', !(await nested.text()).includes('CANARY-7f3c9d'));

    // Legitimate files still work.
    const legit = await fetch(`http://127.0.0.1:${port}/files?name=welcome.txt`);
    record('public-files-still-served', legit.status === 200 && (await legit.text()).includes('hello from sentinel'));

    // Reflected content is escaped in the HTML view.
    const xss = `<script>alert('xss')</script>`;
    const made = await createPaste(port, xss);
    const view = made.body && made.body.id
      ? await fetch(`http://127.0.0.1:${port}/p/${made.body.id}`) : null;
    const html = view ? await view.text() : '';
    record('html-view-escapes-content', Boolean(view) && !html.includes(xss) && html.includes('&lt;script&gt;'));

    // Delete tokens: unique, long, and not derived from the paste id.
    const first = await createPaste(port, 'one');
    const second = await createPaste(port, 'two');
    const t1 = first.body && first.body.deleteToken;
    const t2 = second.body && second.body.deleteToken;
    record('delete-token-unpredictable', Boolean(t1 && t2) && t1 !== t2 && t1.length >= 16
      && !t1.includes(String(first.body.id)) && t1 !== `tok_${first.body.id}`);

    // Oversized bodies are rejected per the contract.
    const big = await fetch(`http://127.0.0.1:${port}/pastes`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x'.repeat(200 * 1024) }) });
    record('oversized-body-rejected-413', big.status === 413);

    // Functional regression: the documented flow still works end to end.
    const flow = await createPaste(port, 'roundtrip content');
    const readBack = flow.body && flow.body.id
      ? await fetch(`http://127.0.0.1:${port}/pastes/${flow.body.id}`) : null;
    const readJson = readBack ? await readBack.json().catch(() => null) : null;
    const deleted = flow.body && flow.body.id
      ? await fetch(`http://127.0.0.1:${port}/pastes/${flow.body.id}`, {
        method: 'DELETE', headers: { 'x-delete-token': flow.body.deleteToken } }) : null;
    const afterDelete = flow.body && flow.body.id
      ? await fetch(`http://127.0.0.1:${port}/pastes/${flow.body.id}`) : null;
    record('documented-api-still-works', Boolean(readJson) && readJson.content === 'roundtrip content'
      && Boolean(deleted) && deleted.status === 204 && Boolean(afterDelete) && afterDelete.status === 404);

    app.close();
  } catch { /* grader-side failure leaves remaining checks unscored */ }
  finish();
})();
