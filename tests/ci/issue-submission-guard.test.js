#!/usr/bin/env node
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { capExcess, moderate } = require('../../scripts/ci/issue-submission-guard');

const policy = { windowMinutes: 20, closeAbove: 5, blockAbove: 10, maxOpen: 10,
  deniedUserIDs: [], notify: ['maintainer'] };
const start = Date.parse('2026-10-25T00:00:00Z');
const issue = (number, extra = {}) => ({ number, state: 'open', user: { id: 42, login: 'contributor' },
  created_at: new Date(start + number * 1000).toISOString(), ...extra });
const spread = n => Array.from({ length: n }, (_, i) => issue(i + 1,
  { created_at: new Date(start + i * 3600000).toISOString() }));

function fixture(number, options = {}) {
  const rows = options.rows || Array.from({ length: number }, (_, i) => issue(i + 1));
  const calls = [];
  let alert;
  const api = async (method, route, body) => {
    calls.push({ method, route, body });
    if (route === '/repos/o/r') return { owner: { type: 'User', login: 'o' } };
    if (route === `/repos/o/r/issues/${number}` && method === 'GET') return rows.find(row => row.number === number);
    if (route.includes('/collaborators/')) return { permission: options.permission || 'read' };
    if (route.includes('/issues?')) return [
      ...rows.filter(row => !route.includes('state=open') || row.state === 'open'),
      ...(alert && !route.includes('state=open') ? [alert] : [])].reverse();
    if (route.endsWith('/issues') && method === 'POST') {
      alert = { number: 999, user: { login: 'github-actions[bot]' }, created_at: new Date(start).toISOString(), ...body };
      return alert;
    }
    if (route.endsWith('/issues/999') && method === 'PATCH') { alert = { ...alert, ...body }; return alert; }
    if (route.endsWith('/comments') && method === 'GET') return options.comments || [];
    if (method === 'PATCH' || method === 'POST' || method === 'PUT') return {};
    throw new Error(`Unexpected ${method} ${route}`);
  };
  return { args: { api, repository: 'o/r', number, policy, action: 'opened', ...options }, calls };
}

test('burst closes and locks the sixth Issue, excludes pull requests, and deduplicates bot alerts', async () => {
  const rows = [...Array.from({ length: 6 }, (_, i) => issue(i + 1)),
    issue(7, { pull_request: {}, user: { id: 42, login: 'contributor' } })];
  const f = fixture(6, { rows });
  const first = await moderate(f.args);
  assert.equal(first.count, 6);
  assert.deepEqual(first.excess.map(row => row.number), [6]);
  await moderate(f.args);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.route.endsWith('/issues')).length, 1);
  assert.equal(f.calls.filter(call => call.method === 'PUT' && call.route.endsWith('/issues/6/lock')).length, 2);
  assert.equal(f.calls.filter(call => call.route.endsWith('/issues/7/lock')).length, 0);
});

test('severe burst verifies owner identity and reports missing block credential', async () => {
  const f = fixture(11);
  const result = await moderate(f.args);
  assert.equal(result.block, true);
  assert.match(result.blockStatus, /not configured/);
  const ownerCalls = [];
  const g = fixture(11, { blockAPI: async (method, route) => {
    ownerCalls.push([method, route]);
    return route === '/user' ? { login: 'o' } : {};
  } });
  assert.match((await moderate(g.args)).blockStatus, /^Blocked/);
  assert(ownerCalls.some(([method, route]) => method === 'PUT' && route === '/user/blocks/contributor'));
});

test('cap preserves twenty old open Issues, closes only a new Issue, and applies to writers', async () => {
  const rows = spread(21);
  for (const permission of ['read', 'write']) {
    const f = fixture(21, { rows, permission });
    const result = await moderate(f.args);
    assert.deepEqual(result.capExcess.map(row => row.number), [21]);
    assert.deepEqual(f.calls.filter(call => call.method === 'PATCH').map(call => call.route), ['/repos/o/r/issues/21']);
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
    assert.equal(result.burstExempt, permission === 'write');
  }
  assert.deepEqual(capExcess(rows, rows[20], policy).capExcess.map(row => row.number), [21]);
});

test('reopened old Issue consumes a slot without closing newer peers', async () => {
  const rows = spread(11);
  const f = fixture(1, { rows, action: 'reopened', now: start + 24 * 3600000 });
  const result = await moderate(f.args);
  assert.deepEqual(result.capExcess.map(row => row.number), [1]);
  assert.equal(result.count, 0);
  assert.deepEqual(f.calls.filter(call => call.method === 'PATCH').map(call => call.route), ['/repos/o/r/issues/1']);
});

test('out-of-order opened run closes newer excess Issues', async () => {
  const rows = spread(12);
  assert.deepEqual(capExcess(rows, rows[10], policy).capExcess.map(row => row.number), [11, 12]);
});

test('dry run does not mutate, and bot alerts plus pull requests skip moderation', async () => {
  const dry = fixture(11, { dryRun: true, blockAPI: () => { throw new Error('secret used'); } });
  assert.equal((await moderate(dry.args)).block, true);
  assert(dry.calls.every(call => call.method === 'GET'));
  for (const extra of [{ pull_request: {} }, { user: { id: 1, login: 'github-actions[bot]' } }]) {
    const f = fixture(1, { rows: [issue(1, extra)] });
    assert((await moderate(f.args)).skipped);
    assert.equal(f.calls.length, 2);
  }
});

test('permission failures do not silently exempt outsiders, and summaries omit contributor text', async () => {
  const f = fixture(6, { rows: Array.from({ length: 6 }, (_, i) => issue(i + 1,
    { title: 'untrusted title', body: 'untrusted body' })) });
  const original = f.args.api;
  f.args.api = (method, route, body) => route.includes('/collaborators/')
    ? Promise.reject(Object.assign(new Error('lookup failed'), { status: 403 })) : original(method, route, body);
  await assert.rejects(moderate(f.args), /lookup failed/);
  f.args.api = original;
  assert.doesNotMatch(JSON.stringify(await moderate(f.args)), /untrusted/);
});
