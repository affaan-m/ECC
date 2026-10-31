#!/usr/bin/env node
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { evaluate, moderate, githubAPI, listPages, strongestWindow, capExcess } = require('../../scripts/ci/pr-burst-guard');

const policy = { windowMinutes: 20, closeAbove: 5, blockAbove: 10, maxOpen: 10, deniedUserIDs: [999], notify: ['maintainer'] };
const start = Date.parse('2026-10-14T19:00:00Z');
const pull = (number, extra = {}) => ({ number, user: { id: 42, login: 'contributor' },
  created_at: new Date(start + number * 1000).toISOString(), state: 'open', ...extra });
const pulls = n => Array.from({ length: n }, (_, i) => pull(i + 1));

function fixture(n, options = {}) {
  const rows = options.rows || pulls(n);
  const calls = [];
  let issue;
  const api = async (method, route, body) => {
    calls.push({ method, route, body });
    if (route === '/repos/owner/repo') return { owner: { login: 'owner', type: 'User' } };
    if (route.endsWith(`/pulls/${n}`)) return rows.find(p => p.number === n);
    if (route.includes('/collaborators/')) return { permission: options.permission || 'read' };
    if (route.includes('/pulls?')) return rows.filter(p => !route.includes('state=open') || p.state === 'open').slice().reverse();
    if (route.includes('/issues?')) return issue ? [issue] : [];
    if (/\/issues\/\d+\/comments\?/.test(route) && method === 'GET') return options.comments || [];
    if (route.endsWith('/issues') && method === 'POST') {
      issue = { number: 101, user: { login: 'github-actions[bot]' }, ...body };
      return issue;
    }
    if (route.endsWith('/issues/101') && method === 'PATCH') { issue = { ...issue, ...body }; return issue; }
    if (route.endsWith('/comments') && method === 'POST') return {};
    if (method === 'PATCH') return {};
    if (method === 'PUT') return {};
    throw new Error(`Unexpected ${method} ${route}`);
  };
  const args = { api, repository: 'owner/repo', number: n, action: 'opened', policy, ...options };
  return { args, calls, api };
}

test('five allowed, sixth closed, ten not blocked, eleventh escalates', () => {
  for (const n of [5, 6, 10, 11]) {
    const result = evaluate(pulls(n), pull(n), policy, start + n * 1000);
    assert.equal(result.count, n);
    assert.equal(result.block, n > 10);
    assert.deepEqual(result.excess.map(p => p.number), Array.from({ length: Math.max(0, n - 5) }, (_, i) => i + 6));
  }
});

test('counts closed and draft PRs by stable user ID, excludes other authors and out-of-window rows', () => {
  const rows = [...pulls(5), pull(6, { state: 'closed', draft: true }), pull(7, { user: { id: 99 } }),
    pull(8, { created_at: new Date(start - 21 * 60000).toISOString() })];
  assert.equal(evaluate(rows, pull(6), policy, start + 6000).count, 6);
});

test('delayed events retain their creation window and deterministic number tie-break', () => {
  const rows = pulls(11).map(p => ({ ...p, created_at: new Date(start).toISOString() }));
  assert.equal(evaluate(rows.reverse(), rows[0], policy, start).block, true);
  assert.deepEqual(evaluate(rows, rows[0], policy, start).excess.map(p => p.number), [6, 7, 8, 9, 10, 11]);
});

test('moderation closes and locks excess, then deduplicates maintainer alert', async () => {
  const f = fixture(6);
  await moderate(f.args);
  await moderate(f.args);
  assert.equal(f.calls.filter(c => c.method === 'POST' && c.route.endsWith('/issues')).length, 1);
  assert(f.calls.some(c => c.method === 'PATCH' && c.route.endsWith('/pulls/6') && c.body.state === 'closed'));
  assert(f.calls.some(c => c.method === 'PUT' && c.route.endsWith('/issues/6/lock')));
});

test('no owner credential reports blocking unavailable and still notifies', async () => {
  const f = fixture(11);
  const result = await moderate(f.args);
  assert.match(result.blockStatus, /not configured/);
  assert(f.calls.some(c => c.method === 'POST' && c.body.body.includes('not configured')));
});

test('owner token identity checked before personal block, escalation notifies exactly once', async () => {
  const ownerCalls = [];
  const blockAPI = async (method, route) => {
    ownerCalls.push({ method, route });
    if (route === '/user') return { login: 'owner' };
    return {};
  };
  const f = fixture(6, { blockAPI });
  await moderate(f.args);
  f.args.number = 11;
  // Use a second snapshot while retaining the alert ledger.
  const original = f.args.api;
  f.args.api = (method, route, body) => route.endsWith('/pulls/11') ? pull(11)
    : route.includes('/pulls?') ? pulls(11).reverse() : original(method, route, body);
  await moderate(f.args);
  await moderate(f.args);
  assert(ownerCalls.some(c => c.method === 'PUT' && c.route === '/user/blocks/contributor'));
  assert.equal(f.calls.filter(c => c.route.endsWith('/comments')).length, 1);
});

test('wrong personal identity never blocks and records the failure', async () => {
  const f = fixture(11, { blockAPI: async (method, route) => {
    assert.equal(route, '/user'); return { login: 'someone-else' };
  } });
  assert.match((await moderate(f.args)).blockStatus, /owner identity/);
});

test('write/admin collaborators bypass; actor identity cannot exempt an outsider', async () => {
  for (const permission of ['write', 'maintain', 'admin']) {
    const f = fixture(11, { permission });
    assert.equal((await moderate(f.args)).exempt, true);
    assert.equal(f.calls.filter(c => ['POST', 'PATCH', 'PUT'].includes(c.method)).length, 0);
  }
  const f = fixture(6, { actor: 'owner' });
  assert.equal((await moderate(f.args)).count, 6);
});

test('denylisted user is closed on reopen even outside the creation window', async () => {
  const f = fixture(1, { action: 'reopened', rows: [pull(1, { user: { id: 999, login: 'denied' } })] });
  assert.equal((await moderate(f.args)).denied, true);
  assert(f.calls.some(c => c.method === 'PATCH' && c.route.endsWith('/pulls/1')));
});

test('dry run performs no mutations or owner-token calls', async () => {
  const f = fixture(11, { dryRun: true, blockAPI: async () => { throw new Error('secret used'); } });
  assert.equal((await moderate(f.args)).block, true);
  assert(f.calls.every(c => c.method === 'GET'));
});

test('REST transport rejects off-host paths and never retries mutations', async () => {
  const api = githubAPI('test-token', async () => { throw new Error('must not fetch'); });
  await assert.rejects(api('GET', '//attacker.test'), /path/);
  let attempts = 0;
  const limited = githubAPI('token', async () => {
    attempts++; return { ok: false, status: 403 };
  });
  await assert.rejects(limited('PUT', '/user/blocks/example'), /403/);
  assert.equal(attempts, 1);
});

test('out-of-order older event sees newer burst and retains historical peak', async () => {
  const rows = [...pulls(11), pull(12, { created_at: new Date(start + 30 * 60000).toISOString() })];
  assert.equal(strongestWindow(rows, pull(6), policy, start + 6000).count, 11);
  const f = fixture(6, { rows });
  assert.equal((await moderate(f.args)).block, true);
});

test('separate bursts close excess from each window even if pending events disappear', () => {
  const rows = [...pulls(6), ...pulls(6).map(p => ({ ...p, number: p.number + 6,
    created_at: new Date(start + 60 * 60000 + p.number * 1000).toISOString() }))];
  const result = strongestWindow(rows, pull(6), policy, start + 6000);
  assert.equal(result.count, 6);
  assert.deepEqual(result.excess.map(p => p.number), [6, 12]);
});

test('pagination includes page two and refuses silent truncation', async () => {
  let calls = 0;
  const rows = await listPages(async () => { calls++; return calls === 1 ? pulls(100) : pulls(1); }, '/repos/o/r/pulls?state=all');
  assert.equal(rows.length, 101);
  assert.equal(calls, 2);
  await assert.rejects(listPages(async () => pulls(100), '/repos/o/r/pulls?state=all'), /Pagination limit/);
});

test('permission errors fail safely; outsider404 permits moderation', async () => {
  for (const status of [403, 404]) {
    const f = fixture(6);
    const original = f.args.api;
    f.args.api = (method, route, body) => {
      if (route.includes('/collaborators/')) throw Object.assign(new Error('permission lookup failed'), { status });
      return original(method, route, body);
    };
    if (status === 403) await assert.rejects(moderate(f.args), /permission lookup/);
    else assert.equal((await moderate(f.args)).count, 6);
  }
});

test('closure failure still creates an alert with enforcement errors', async () => {
  const f = fixture(6);
  const original = f.args.api;
  f.args.api = (method, route, body) => {
    if (method === 'PATCH' && route.endsWith('/pulls/6')) throw new Error('close denied');
    return original(method, route, body);
  };
  assert.match((await moderate(f.args)).errors[0], /close denied/);
  assert(f.calls.some(c => c.method === 'POST' && c.body.body.includes('close denied')));
});

// Spread PRs one hour apart so the burst window never fires; only the open-PR cap applies.
const spread = (n, extra = {}) => Array.from({ length: n }, (_, i) => pull(i + 1,
  { created_at: new Date(start + i * 3600000).toISOString(), ...extra }));

test('open-PR cap keeps the oldest ten open and closes the rest, newest first', () => {
  const result = capExcess(spread(12), spread(12)[11], policy);
  assert.equal(result.openCount, 12);
  assert.deepEqual(result.capExcess.map(p => p.number), [11, 12]);
  const closed = spread(12).map((p, i) => i < 3 ? { ...p, state: 'closed' } : p);
  assert.equal(capExcess(closed, closed[11], policy).openCount, 9);
  assert.equal(capExcess(spread(12), spread(12)[11], policy, new Set([11, 12])).capExcess.length, 0);
  assert.equal(capExcess(spread(12, { user: { id: 7, login: 'other' } }), pull(1), policy).openCount, 1);
});

test('cap closes with an explanatory comment, no lock, no maintainer alert, and never comments twice', async () => {
  const rows = spread(11);
  const f = fixture(11, { rows });
  const result = await moderate(f.args);
  assert.equal(result.count, 1);
  assert.deepEqual(result.capExcess.map(p => p.number), [11]);
  assert(f.calls.some(c => c.method === 'PATCH' && c.route.endsWith('/pulls/11') && c.body.state === 'closed'));
  const comment = f.calls.find(c => c.method === 'POST' && c.route.endsWith('/issues/11/comments'));
  assert.match(comment.body.body, /11 open pull requests.*limit of 10/);
  assert.equal(f.calls.filter(c => c.route.endsWith('/lock')).length, 0);
  assert.equal(f.calls.filter(c => c.method === 'POST' && c.route.endsWith('/issues')).length, 0);
  const again = fixture(11, { rows, comments: [{ user: { login: 'github-actions[bot]' }, body: comment.body.body }] });
  await moderate(again.args);
  assert.equal(again.calls.filter(c => c.method === 'POST').length, 0);
  // A contributor-authored lookalike comment cannot suppress the explanation.
  const spoofed = fixture(11, { rows, comments: [{ user: { login: 'contributor' }, body: comment.body.body }] });
  await moderate(spoofed.args);
  assert.equal(spoofed.calls.filter(c => c.method === 'POST').length, 1);
});

test('cap counts open PRs after burst closures, so one run never closes a PR twice', async () => {
  const rows = [...spread(9), ...pulls(6).map(p => ({ ...p, number: p.number + 9,
    created_at: new Date(start + 24 * 3600000 + p.number * 1000).toISOString() }))];
  const f = fixture(15, { rows });
  const result = await moderate(f.args);
  assert.equal(result.count, 6);
  assert.deepEqual(result.excess.map(p => p.number), [15]);
  assert.equal(result.openCount, 14);
  assert.deepEqual(result.capExcess.map(p => p.number), [11, 12, 13, 14]);
  assert.equal(f.calls.filter(c => c.method === 'PATCH' && c.route.endsWith('/pulls/15')).length, 1);
});

test('cap dry run reports the excess without mutating; collaborators are exempt from the cap', async () => {
  const f = fixture(12, { rows: spread(12), dryRun: true });
  assert.deepEqual((await moderate(f.args)).capExcess.map(p => p.number), [11, 12]);
  assert(f.calls.every(c => c.method === 'GET'));
  const w = fixture(12, { rows: spread(12), permission: 'write' });
  assert.equal((await moderate(w.args)).exempt, true);
  assert.equal(w.calls.filter(c => c.method !== 'GET').length, 0);
});

test('policy requires a positive integer maxOpen', () => {
  assert.throws(() => capExcess([], pull(1), { ...policy, maxOpen: 0 }), /maxOpen/);
  assert.throws(() => capExcess([], pull(1), { ...policy, maxOpen: undefined }), /maxOpen/);
});

test('reports only moderation metadata, never PR bodies or titles', async () => {
  const f = fixture(6, { rows: pulls(6).map(p => ({ ...p, title: 'untrusted title', body: 'untrusted body' })) });
  assert.doesNotMatch(JSON.stringify(await moderate(f.args)), /untrusted/);
});
