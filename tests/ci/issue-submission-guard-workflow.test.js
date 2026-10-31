#!/usr/bin/env node
const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');

test('actual Issue workflow CLI caps a new Issue, handles bursts, and keeps credentials separate', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-issue-guard-'));
  const mutations = [];
  const start = Date.parse('2026-10-25T00:00:00Z');
  const rows = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, state: 'open',
    user: { id: 42, login: 'contributor' }, created_at: new Date(start + i * 3600000).toISOString(),
    title: '::error::untrusted title', body: '$(untrusted body)' }));
  let alert;
  let permission = 'read';
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    const send = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (req.method !== 'GET') mutations.push({ method: req.method, route: url.pathname,
      body, token: req.headers.authorization });
    if (url.pathname === '/repos/owner/repo') return send({ owner: { login: 'owner', type: 'User' } });
    if (url.pathname === '/user') {
      assert.equal(req.headers.authorization, 'Bearer owner-token');
      return send({ login: 'owner' });
    }
    if (url.pathname.includes('/collaborators/')) return send({ permission });
    if (req.method === 'GET' && /^\/repos\/owner\/repo\/issues\/\d+$/.test(url.pathname)) {
      return send(rows.find(row => row.number === Number(url.pathname.split('/').pop())));
    }
    if (req.method === 'GET' && url.pathname.endsWith('/issues')) {
      return send([...rows.filter(row => url.searchParams.get('state') !== 'open' || row.state === 'open'),
        ...(alert && url.searchParams.get('state') !== 'open' ? [alert] : [])].reverse());
    }
    if (req.method === 'POST' && url.pathname.endsWith('/issues')) {
      alert = { number: 999, created_at: new Date(start).toISOString(),
        user: { login: 'github-actions[bot]' }, ...body }; return send(alert);
    }
    if (req.method === 'GET' && url.pathname.endsWith('/comments')) return send([]);
    if (req.method === 'PATCH' && url.pathname.endsWith('/issues/999')) {
      alert = { ...alert, ...body }; return send(alert);
    }
    if (req.method === 'PATCH' && /^\/repos\/owner\/repo\/issues\/\d+$/.test(url.pathname)) {
      const issue = rows.find(row => row.number === Number(url.pathname.split('/').pop()));
      issue.state = body.state; return send(issue);
    }
    if (req.method === 'POST' && url.pathname.endsWith('/comments')) return send({});
    if (req.method === 'PUT' && url.pathname.endsWith('/lock')) { res.statusCode = 204; return res.end(); }
    if (req.method === 'PUT' && url.pathname.startsWith('/user/blocks/')) { res.statusCode = 204; return res.end(); }
    res.statusCode = 404; send({ message: 'missing fixture route' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const preload = path.join(tmp, 'transport.cjs');
    fs.writeFileSync(preload, `const original = global.fetch; global.fetch = (url, options) => original('http://127.0.0.1:${port}' + new URL(url).pathname + new URL(url).search, options);`);
    const event = path.join(tmp, 'event.json');
    const summary = path.join(tmp, 'summary.md');
    const env = { ...process.env, NODE_OPTIONS: `--require=${preload}`, GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_TOKEN: 'issue-token', PR_MODERATION_BLOCK_TOKEN: 'owner-token',
      GITHUB_EVENT_PATH: event, GITHUB_STEP_SUMMARY: summary };
    const run = args => exec(process.execPath, ['scripts/ci/issue-submission-guard.js', ...args], { cwd: root, env });
    rows.push({ number: 21, state: 'open', user: { id: 42, login: 'contributor' },
      created_at: new Date(start + 20 * 3600000).toISOString() });
    fs.writeFileSync(event, JSON.stringify({ action: 'opened', issue: { number: 21 } }));
    const cap = JSON.parse((await run([])).stdout);
    assert.deepEqual(cap.capExcess.map(issue => issue.number), [21]);
    assert.equal(mutations.filter(m => m.method === 'PATCH' && m.route === '/repos/owner/repo/issues/21').length, 1);
    assert.equal(mutations.filter(m => m.route.endsWith('/lock')).length, 0);
    assert.equal(mutations.filter(m => m.method === 'POST' && m.route.endsWith('/comments')).length, 1);
    permission = 'write';
    rows.push({ number: 22, state: 'open', user: { id: 42, login: 'contributor' },
      created_at: new Date(start + 21 * 3600000).toISOString() });
    fs.writeFileSync(event, JSON.stringify({ action: 'opened', issue: { number: 22 } }));
    assert.equal(JSON.parse((await run([])).stdout).burstExempt, true);
    assert.equal(mutations.filter(m => m.method === 'PATCH' && m.route === '/repos/owner/repo/issues/22').length, 1);
    permission = 'read';
    rows.splice(0, rows.length, ...Array.from({ length: 11 }, (_, i) => ({ number: i + 1,
      state: 'open', user: { id: 42, login: 'contributor' },
      created_at: new Date(start + i * 1000).toISOString() })));
    fs.writeFileSync(event, JSON.stringify({ action: 'opened', issue: { number: 11 } }));
    const burst = JSON.parse((await run([])).stdout);
    assert.equal(burst.count, 11);
    assert.match(burst.blockStatus, /^Blocked/);
    assert.equal(mutations.filter(m => m.route.endsWith('/lock')).length, 6);
    assert(mutations.some(m => m.route === '/user/blocks/contributor' && m.token === 'Bearer owner-token'));
    assert(mutations.filter(m => m.route.startsWith('/repos/')).every(m => m.token === 'Bearer issue-token'));
    assert.doesNotMatch(fs.readFileSync(summary, 'utf8'), /untrusted|owner-token|issue-token/);
    const before = mutations.length;
    const dry = JSON.parse((await run(['--dry-run'])).stdout);
    assert.equal(dry.block, true);
    assert.equal(mutations.length, before);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
