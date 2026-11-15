'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { createStateStore } = require('../../scripts/lib/state-store');

const CLI = path.join(__dirname, '..', '..', 'scripts', 'work-items.js');
const SYNC_MARKER = 'ecc-work-items-sync-github';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-work-item-identity-'));
  const dbPath = path.join(dir, 'state.db');
  const responsePath = path.join(dir, 'response.json');
  const shimPath = path.join(dir, 'gh-shim.cjs');
  fs.writeFileSync(shimPath, [
    "const fs = require('node:fs');",
    'const response = JSON.parse(fs.readFileSync(process.env.ECC_IDENTITY_RESPONSE, "utf8"));',
    'process.stdout.write(JSON.stringify(response[process.argv[2]]));'
  ].join('\n'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  function run(args) {
    return spawnSync(process.execPath, [CLI, ...args, '--db', dbPath], {
      encoding: 'utf8',
      env: { ...process.env, ECC_GH_SHIM: shimPath, ECC_IDENTITY_RESPONSE: responsePath }
    });
  }

  function sync(repo, response = { issue: [], pr: [] }, args = []) {
    fs.writeFileSync(responsePath, JSON.stringify(response));
    return run(['sync-github', '--repo', repo, '--json', ...args]);
  }

  function syncItems(repo, response, args) {
    const result = sync(repo, response, args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }

  async function withStore(fn) {
    const store = await createStateStore({ dbPath });
    try {
      return fn(store);
    } finally {
      store.close();
    }
  }

  return { run, sync, syncItems, withStore };
}

function responseFor(repo, types = ['issue', 'pr']) {
  const entry = type => ({
    number: 1,
    title: `${repo} ${type}`,
    url: `https://github.com/${repo}/${type === 'pr' ? 'pull' : 'issues'}/1`,
    author: { login: 'author' },
    labels: [],
    isDraft: false,
    mergeStateStatus: 'CLEAN'
  });
  return {
    issue: types.includes('issue') ? [entry('issue')] : [],
    pr: types.includes('pr') ? [entry('pr')] : []
  };
}

function legacyItem(repo, type, overrides = {}) {
  return {
    id: `github-${repo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${type}-1`,
    source: `github-${type}`,
    sourceId: '1',
    title: 'Previously imported item',
    status: 'needs-review',
    createdAt: '2020-01-02T03:04:05.000Z',
    metadata: { repo, type: type === 'pr' ? 'pull_request' : 'issue', syncedBy: SYNC_MARKER },
    ...overrides
  };
}

test('sync keeps punctuation and owner/repository boundaries distinct for issues and PRs', async t => {
  const f = fixture(t);
  const repos = ['acme/tool-kit', 'acme/tool_kit', 'acme/tool.kit', 'acme-tool/kit'];
  const ids = [];
  for (const repo of repos) {
    const first = f.syncItems(repo, responseFor(repo));
    const repeated = f.syncItems(repo, responseFor(repo));
    assert.deepEqual(repeated.items.map(item => item.id), first.items.map(item => item.id));
    ids.push(...first.items.map(item => item.id));
  }
  assert.equal(new Set(ids).size, repos.length * 2, 'every repository/type identity must have its own ID');
  const rows = await f.withStore(store => store.listWorkItems({ limit: 100 }).items);
  assert.equal(rows.length, repos.length * 2);
  for (const repo of repos) {
    for (const type of ['issue', 'pr']) {
      const row = rows.find(item => item.metadata.repo === repo && item.source === `github-${type}`);
      assert.ok(row, `${repo} ${type} remains stored`);
      assert.equal(row.status, 'needs-review');
      assert.equal(row.url, responseFor(repo)[type][0].url);
    }
  }
});

for (const type of ['issue', 'pr']) {
  test(`${type}: reuse a matching legacy ID and preserve creation time and explicit linkage`, async t => {
    const f = fixture(t);
    const repo = 'Acme/Tool_Kit';
    const legacy = legacyItem(repo, type, { sessionId: 'session-42', repoRoot: '/workspace/tool-kit' });
    await f.withStore(store => {
      store.upsertSession({ id: 'session-42', adapterId: 'manual', harness: 'codex', state: 'running' });
      store.upsertWorkItem(legacy);
    });
    const args = ['--session', 'session-42', '--repo-root', '/workspace/tool-kit'];
    const synced = f.syncItems(repo.toLowerCase(), responseFor(repo, [type]), args);
    assert.equal(synced.items[0].id, legacy.id);
    assert.equal(synced.items[0].createdAt, legacy.createdAt);
    assert.equal(synced.items[0].sessionId, legacy.sessionId);
    assert.equal(synced.items[0].repoRoot, legacy.repoRoot);
    assert.equal(synced.items[0].title, `${type === 'pr' ? 'PR' : 'Issue'} #1: ${repo} ${type}`);
    const repeated = f.syncItems(repo, responseFor(repo, [type]), args);
    assert.equal(repeated.items[0].id, legacy.id);
    assert.equal(repeated.closedCount, 0);
    assert.equal(await f.withStore(store => store.listWorkItems({ limit: 100 }).items.length), 1);
  });

  test(`${type}: a colliding legacy repository is not overwritten`, async t => {
    const f = fixture(t);
    const original = await f.withStore(store => store.upsertWorkItem(legacyItem('acme/tool-kit', type)));
    const incoming = f.syncItems('acme/tool_kit', responseFor('acme/tool_kit', [type])).items[0];
    assert.notEqual(incoming.id, original.id);
    assert.deepEqual(await f.withStore(store => store.getWorkItemById(original.id)), original);
    assert.equal(await f.withStore(store => store.listWorkItems({ limit: 100 }).items.length), 2);
  });
}

test('legacy reuse requires the matching source, number, sync marker, and repository', async t => {
  const variants = [
    { source: 'manual' },
    { sourceId: '2' },
    { metadata: { repo: 'acme/tool-kit', type: 'issue' } },
    ...[null, 42, { toString: 5 }].map(repo => ({
      metadata: { repo, type: 'issue', syncedBy: SYNC_MARKER }
    }))
  ];
  for (const overrides of variants) {
    await t.test(JSON.stringify(overrides), async subtest => {
      const f = fixture(subtest);
      const original = await f.withStore(store => store.upsertWorkItem(legacyItem('acme/tool-kit', 'issue', {
        ...overrides,
        status: 'done'
      })));
      const incoming = f.syncItems('acme/tool-kit', responseFor('acme/tool-kit', ['issue'])).items[0];
      assert.notEqual(incoming.id, original.id);
      assert.deepEqual(await f.withStore(store => store.getWorkItemById(original.id)), original);
    });
  }
});

test('canonical IDs stay stable across casing changes and when the legacy ID is vacant', async t => {
  const f = fixture(t);
  const repo = 'Acme/Tool_Kit';
  const canonical = legacyItem(repo, 'issue', {
    id: `github-${encodeURIComponent(repo.toLowerCase())}-issue-1`
  });
  await f.withStore(store => store.upsertWorkItem(canonical));
  for (const spelling of [repo.toLowerCase(), repo.toUpperCase()]) {
    const result = f.syncItems(spelling, responseFor(spelling, ['issue']));
    assert.equal(result.items[0].id, canonical.id);
    assert.equal(result.closedCount, 0);
    assert.equal(result.items[0].createdAt, canonical.createdAt);
  }
  assert.equal(await f.withStore(store => store.listWorkItems({ limit: 100 }).items.length), 1);
});

test('canonical IDs take precedence when a matching legacy record also exists', async t => {
  const f = fixture(t);
  const repo = 'acme/tool-kit';
  const legacy = await f.withStore(store => store.upsertWorkItem(legacyItem(repo, 'issue', { status: 'done' })));
  const canonical = legacyItem(repo, 'issue', {
    id: `github-${encodeURIComponent(repo)}-issue-1`,
    createdAt: '2021-02-03T04:05:06.000Z'
  });
  await f.withStore(store => store.upsertWorkItem(canonical));
  const result = f.syncItems(repo, responseFor(repo, ['issue']));
  assert.equal(result.items[0].id, canonical.id);
  assert.equal(result.items[0].createdAt, canonical.createdAt);
  assert.equal(result.items[0].status, 'needs-review');
  assert.deepEqual(await f.withStore(store => store.getWorkItemById(legacy.id)), legacy);
  assert.equal(await f.withStore(store => store.listWorkItems({ limit: 100 }).items.length), 2);
});

test('a canonical ID occupied by a different identity fails without overwriting it', async t => {
  const f = fixture(t);
  const repo = 'acme/tool-kit';
  const original = await f.withStore(store => store.upsertWorkItem({
    id: `github-${encodeURIComponent(repo)}-issue-1`,
    source: 'manual',
    title: 'Unrelated local work',
    status: 'open'
  }));
  const result = f.sync(repo, responseFor(repo, ['issue']));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /collision|already|different|conflict/i);
  assert.deepEqual(await f.withStore(store => store.getWorkItemById(original.id)), original);
  assert.equal(await f.withStore(store => store.listWorkItems({ limit: 100 }).items.length), 1);
});

test('closing stale items isolates punctuation variants and recognizes repository casing', async t => {
  const f = fixture(t);
  const legacy = legacyItem('Acme/Tool-Kit', 'issue');
  await f.withStore(store => store.upsertWorkItem(legacy));
  const own = f.syncItems('Acme/Tool-Kit', responseFor('Acme/Tool-Kit')).items;
  const neighbor = f.syncItems('acme/tool_kit', responseFor('acme/tool_kit')).items;
  const closed = f.syncItems('ACME/TOOL-KIT', { issue: [], pr: [] });
  // Legacy rows lack a source-state snapshot, so disappearing source data
  // cannot silently close locally managed work. Fresh untouched imports follow it.
  const sourceOwned = own.filter(item => item.id !== legacy.id);
  assert.deepEqual(closed.closedItems.map(item => item.id).sort(), sourceOwned.map(item => item.id).sort());
  assert.equal(closed.closedCount, 1);
  for (const item of sourceOwned) {
    assert.equal((await f.withStore(store => store.getWorkItemById(item.id))).status, 'closed');
  }
  const preserved = await f.withStore(store => store.getWorkItemById(legacy.id));
  assert.equal(preserved.status, 'needs-review');
  assert.equal(preserved.metadata.githubSync.managedLocally, true);
  for (const item of neighbor) {
    assert.equal((await f.withStore(store => store.getWorkItemById(item.id))).status, 'needs-review');
  }
  assert.equal(f.syncItems('acme/tool-kit', { issue: [], pr: [] }).closedCount, 0);
});

test('encoded IDs round-trip through display, claim, and close commands', async t => {
  const f = fixture(t);
  const repo = 'acme/tool_kit';
  const response = responseFor(repo, ['issue']);
  const imported = f.syncItems(repo, {
    ...response,
    issue: response.issue.map(issue => ({ ...issue, author: null }))
  }).items[0];
  assert.match(imported.id, /%2F/);
  await f.withStore(store => store.upsertWorkItem({ ...store.getWorkItemById(imported.id), status: 'ready' }));

  for (const args of [
    ['sync-github', '--repo', repo],
    ['show', imported.id],
    ['list'],
    ['claim', imported.id, '--owner', 'maintainer', '--as', 'human'],
    ['close', imported.id]
  ]) {
    const result = f.run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(imported.id), `${args[0]} displays the exact ID`);
  }

  const shown = f.run(['show', imported.id, '--json']);
  assert.equal(shown.status, 0, shown.stderr);
  const item = JSON.parse(shown.stdout);
  assert.equal(item.id, imported.id);
  assert.equal(item.status, 'done');
  assert.equal(item.owner, 'maintainer');
  assert.equal(item.metadata.assigneeKind, 'human');
  assert.equal(item.metadata.repo, repo);
  assert.equal(item.source, imported.source);
  assert.equal(item.sourceId, imported.sourceId);
  assert.equal(item.createdAt, imported.createdAt);
  assert.equal(item.url, imported.url);
  assert.deepEqual(await f.withStore(store => store.listWorkItems({ limit: 100 }).items), [item]);
});
