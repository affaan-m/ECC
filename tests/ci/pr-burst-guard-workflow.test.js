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

function recordMutation(mutations, req, route, body) {
  if (req.method !== 'GET') mutations.push({ method: req.method, route, body, token: req.headers.authorization });
}

test('actual CLI closes six excess PRs, locks them, blocks with owner identity, and deduplicates alerts over HTTP', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-pr-guard-'));
  const mutations = [];
  let issue;
  let permission = 'read';
  const rows = Array.from({ length: 11 }, (_, i) => ({ number: i + 1,
    user: { id: 42, login: 'contributor' }, state: 'open', draft: i === 4,
    created_at: new Date(Date.UTC(2026, 9, 14, 19, 0, i)).toISOString(),
    body: '::error::untrusted PR body', title: '$(untrusted title)' }));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : undefined;
    const send = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    recordMutation(mutations, req, url.pathname, body);
    if (url.pathname === '/repos/owner/repo') return send({ owner: { login: 'owner', type: 'User' } });
    if (url.pathname === '/user') {
      assert.equal(req.headers.authorization, 'Bearer owner-token');
      return send({ login: 'owner' });
    }
    if (req.method === 'GET' && url.pathname.endsWith('/pulls/11')) return send(rows[10]);
    if (url.pathname.includes('/collaborators/')) return send({ permission });
    if (req.method === 'GET' && url.pathname.endsWith('/pulls')) return send(rows.slice().reverse());
    if (url.pathname.endsWith('/issues')) {
      if (req.method === 'GET') return send(issue ? [issue] : []);
      issue = { number: 88, user: { login: 'github-actions[bot]' }, ...body };
      return send(issue);
    }
    if (url.pathname.endsWith('/issues/88') && req.method === 'PATCH') { issue = { ...issue, ...body }; return send(issue); }
    if (/\/issues\/\d+\/comments$/.test(url.pathname)) return send(req.method === 'GET' ? [] : {});
    if (req.method === 'PATCH' && /\/pulls\/\d+$/.test(url.pathname)) {
      const pr = rows.find(row => row.number === Number(url.pathname.split('/').pop()));
      pr.state = body.state; return send(pr);
    }
    if (req.method === 'PUT') { res.statusCode = 204; return res.end(); }
    res.statusCode = 404; send({ message: 'fixture route missing' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    // Test-only transport redirection. Production offers no API host override.
    const preload = path.join(tmp, 'transport.cjs');
    fs.writeFileSync(preload, `const original = global.fetch; global.fetch = (url, options) => original('http://127.0.0.1:${port}' + new URL(url).pathname + new URL(url).search, options);`);
    const event = path.join(tmp, 'event.json');
    fs.writeFileSync(event, JSON.stringify({ action: 'opened', sender: { login: 'owner' }, pull_request: { number: 11 } }));
    const summary = path.join(tmp, 'summary.md');
    const env = { ...process.env, NODE_OPTIONS: `--require=${preload}`, GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_TOKEN: 'moderation-token', PR_MODERATION_BLOCK_TOKEN: 'owner-token',
      GITHUB_EVENT_PATH: event, GITHUB_STEP_SUMMARY: summary };
    const run = () => exec(process.execPath, ['scripts/ci/pr-burst-guard.js'], { cwd: root, env });
    const first = JSON.parse((await run()).stdout);
    assert.equal(first.count, 11);
    assert.match(first.blockStatus, /^Blocked/);
    await run();
    assert.equal(mutations.filter(m => m.route.endsWith('/issues') && m.method === 'POST').length, 1);
    assert.equal(mutations.filter(m => /\/pulls\/\d+$/.test(m.route)).length, 6);
    assert.equal(mutations.filter(m => m.route.endsWith('/lock')).length, 6);
    assert.equal(new Set(mutations.filter(m => m.route.endsWith('/lock')).map(m => m.route)).size, 6);
    assert(mutations.some(m => m.route === '/user/blocks/contributor' && m.token === 'Bearer owner-token'));
    assert(mutations.filter(m => m.route.startsWith('/repos/')).every(m => m.token === 'Bearer moderation-token'));
    assert.doesNotMatch(fs.readFileSync(summary, 'utf8'), /untrusted|owner-token|moderation-token/);
    assert(issue.body.includes('@affaan-m @haelyra'));

    delete env.PR_MODERATION_BLOCK_TOKEN;
    await assert.rejects(run(), error => {
      assert.equal(error.code, 1);
      assert.match(JSON.parse(error.stdout).blockStatus, /not configured/);
      return true;
    });
    permission = 'write';
    const beforeCollaboratorRun = mutations.length;
    assert.equal(JSON.parse((await run()).stdout).burstExempt, true);
    assert.equal(mutations.length, beforeCollaboratorRun);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

for (const permission of ['read', 'write']) test(`actual CLI caps ${permission} author without closing twenty earlier PRs`, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-pr-cap-'));
  const closedTrigger = permission === 'write';
  const extraNewer = closedTrigger ? 5 : 0;
  let rows = Array.from({ length: 21 + extraNewer }, (_, i) => ({ number: i < 20 ? i + 1 : 3649 + i - 20,
    user: { id: 42, login: 'contributor' }, state: closedTrigger && i === 20 ? 'closed' : 'open',
    created_at: new Date(Date.UTC(2026, 9, 1, i, 0, 0)).toISOString() }));
  const mutations = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : undefined;
    const send = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (req.method !== 'GET') mutations.push({ method: req.method, route: url.pathname, body });
    if (url.pathname === '/repos/owner/repo') return send({ owner: { login: 'owner', type: 'User' } });
    if (url.pathname.includes('/collaborators/')) return send({ permission });
    if (url.pathname.endsWith('/pulls/3649') && req.method === 'GET') return send(rows[20]);
    if (url.pathname.endsWith('/pulls')) return send(rows.filter(pr => url.searchParams.get('state') !== 'open' || pr.state === 'open').reverse());
    if (/\/issues\/\d+\/comments$/.test(url.pathname)) return send(req.method === 'GET' ? [] : {});
    if (/\/pulls\/\d+$/.test(url.pathname) && req.method === 'PATCH') {
      const number = Number(url.pathname.split('/').pop());
      rows = rows.map(row => row.number === number ? { ...row, state: body.state } : row);
      return send(rows.find(row => row.number === number));
    }
    res.statusCode = 404; send({ message: 'fixture route missing' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const preload = path.join(tmp, 'transport.cjs');
    fs.writeFileSync(preload, `const original = global.fetch; global.fetch = (url, options) => original('http://127.0.0.1:${port}' + new URL(url).pathname + new URL(url).search, options);`);
    const event = path.join(tmp, 'event.json');
    fs.writeFileSync(event, JSON.stringify({ action: 'opened', pull_request: { number: 3649 } }));
    const env = { ...process.env, NODE_OPTIONS: `--require=${preload}`, GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_TOKEN: 'moderation-token', GITHUB_EVENT_PATH: event, PR_MODERATION_BLOCK_TOKEN: '' };
    const report = JSON.parse((await exec(process.execPath, ['scripts/ci/pr-burst-guard.js'], { cwd: root, env })).stdout);
    assert.equal(report.openCount, 21 + extraNewer - Number(closedTrigger));
    assert.equal(report.burstExempt, permission === 'write');
    const expectedExcess = Array.from({ length: 1 + extraNewer - Number(closedTrigger) },
      (_, i) => 3649 + i + Number(closedTrigger));
    assert.deepEqual(report.capExcess.map(pr => pr.number), expectedExcess);
    assert.equal(rows.filter(pr => pr.state === 'open').length, 20);
    assert.deepEqual(mutations.filter(m => m.method === 'PATCH').map(m => m.route),
      expectedExcess.map(number => `/repos/owner/repo/pulls/${number}`));
    const comment = mutations.find(m => m.route.endsWith(`/issues/${expectedExcess[0]}/comments`)).body.body;
    assert(comment.includes(`${21 + extraNewer - Number(closedTrigger)} open pull requests`));
    assert(comment.includes('limit of 10'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('workflow requests the bounded author queue for pending cap checks', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/pr-burst-guard.yml'), 'utf8');
  assert.match(workflow, /group: pr-burst-.*github\.event\.pull_request\.user\.id/);
  assert.match(workflow, /concurrency:[\s\S]*?queue: max/);
  assert.match(workflow, /run: node scripts\/ci\/pr-burst-guard\.js/);
});
