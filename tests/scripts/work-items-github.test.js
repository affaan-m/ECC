'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStateStore } = require('../../scripts/lib/state-store');
const { syncGithubWorkItems, buildGithubPrWorkItem, buildGithubIssueWorkItem } = require('../../scripts/work-items');
const { claimWorkItem } = require('../../scripts/lib/control-pane/work-item-mutations');

let passed = 0;
let failed = 0;

// Follow the canonical identity builder; collision behavior has separate tests.
function importedId(type) {
  const builder = type === 'pr' ? buildGithubPrWorkItem : buildGithubIssueWorkItem;
  return builder('example/repo', { number: type === 'pr' ? 3 : 8 }).id;
}

async function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-github-sync-'));
  const previousShim = process.env.ECC_GH_SHIM;
  let store;
  try {
    const fixture = path.join(dir, 'source.json');
    const shim = path.join(dir, 'gh.js');
    fs.writeFileSync(shim, `const data = require(${JSON.stringify(fixture)}); process.stdout.write(JSON.stringify(data[process.argv[2]]));`);
    process.env.ECC_GH_SHIM = shim;
    store = await createStateStore({ dbPath: path.join(dir, 'state.db') });
    store.upsertSession({ id: 'session-1', adapterId: 'test', harness: 'test', state: 'active', startedAt: '2026-10-28T00:00:00Z' });
    const source = {
      pr: [{ number: 3, title: 'Original PR', author: { login: 'author' }, isDraft: false, mergeStateStatus: 'CLEAN' }],
      issue: [{ number: 8, title: 'Original issue', author: { login: 'author' }, labels: [] }]
    };
    const sync = (options = {}) => {
      fs.writeFileSync(fixture, JSON.stringify(source));
      return syncGithubWorkItems(store, { githubRepo: 'example/repo', limit: 10, repoRoot: dir, ...options });
    };
    await fn({ store, source, sync, dir });
    console.log(`  PASS ${name}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL ${name}: ${error.stack}`);
    failed++;
  } finally {
    if (store) store.close();
    if (previousShim === undefined) delete process.env.ECC_GH_SHIM;
    else process.env.ECC_GH_SHIM = previousShim;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function run() {
  await test('a newly imported issue can be admitted and claimed without losing ownership on resync', ({ store, sync }) => {
    sync();
    const id = importedId('issue');
    const imported = store.getWorkItemById(id);
    assert.strictEqual(imported.status, 'needs-review');
    assert.strictEqual(imported.owner, null);
    assert.strictEqual(imported.metadata.sourceAuthor, 'author');
    assert.strictEqual(store.getWorkItemById(importedId('pr')).owner, null);
    assert.strictEqual(store.getWorkItemById(importedId('pr')).metadata.sourceAuthor, 'author');

    store.upsertWorkItem({ ...imported, status: 'ready' });
    const claimed = claimWorkItem(store, { id, owner: 'worker', assigneeKind: 'agent', sessionId: 'session-1' });
    assert.strictEqual(claimed.claimed, true);
    for (let attempt = 0; attempt < 2; attempt++) {
      sync();
      const item = store.getWorkItemById(id);
      assert.strictEqual(item.status, 'running');
      assert.strictEqual(item.owner, 'worker');
      assert.strictEqual(item.sessionId, 'session-1');
      assert.strictEqual(item.metadata.assigneeKind, 'agent');
      assert.strictEqual(item.metadata.sourceAuthor, 'author');
    }
  });

  for (const type of ['pr', 'issue']) {
    await test(`${type}: a claimed import stays out of the pickup queue after reimport`, ({ store, source, sync }) => {
      source[type === 'pr' ? 'issue' : 'pr'] = [];
      const id = sync().items[0].id;
      const imported = store.getWorkItemById(id);
      assert.strictEqual(imported.owner, null);
      assert.strictEqual(imported.metadata.sourceAuthor, 'author');
      assert.strictEqual(imported.status, 'needs-review');
      store.upsertWorkItem({ ...imported, status: 'ready' });
      const claimed = claimWorkItem(store, { id, owner: 'worker', assigneeKind: 'agent', sessionId: 'session-1' });
      assert.strictEqual(claimed.claimed, true);
      for (let attempt = 0; attempt < 2; attempt++) {
        sync();
        const item = store.getWorkItemById(id);
        assert.strictEqual(item.status, 'running');
        assert.strictEqual(item.owner, 'worker');
        assert.strictEqual(item.sessionId, 'session-1');
        assert.strictEqual(item.metadata.assigneeKind, 'agent');
        assert.strictEqual(store.listWorkItems().totalCount, 1);
        assert.deepStrictEqual(claimWorkItem(store, { owner: 'second-worker' }), {
          claimed: false, reason: 'no-unassigned-open-items'
        });
      }
    });
  }

  for (const type of ['pr', 'issue']) {
    for (const status of ['running', 'claimed', 'blocked', 'hold', 'done', 'closed']) {
      await test(`${type}: refresh preserves locally managed ${status} work`, ({ store, source, sync, dir }) => {
        const id = importedId(type);
        sync();
        const initial = store.getWorkItemById(id);
        const owned = store.upsertWorkItem({
          ...initial, status, owner: 'worker', sessionId: 'session-1', priority: 'urgent',
          repoRoot: path.join(dir, 'worktree'), metadata: { ...initial.metadata, assigneeKind: 'agent', note: 'keep me' }
        });
        source[type][0] = { ...source[type][0], title: 'Updated title', author: { login: 'renamed-author' }, updatedAt: '2026-10-28T00:00:00Z', labels: [{ name: 'bug' }] };
        for (let attempt = 0; attempt < 2; attempt++) {
          sync();
          const item = store.getWorkItemById(id);
          for (const field of ['status', 'owner', 'sessionId', 'priority', 'repoRoot', 'createdAt']) {
            assert.strictEqual(item[field], owned[field], field);
          }
          assert.match(item.title, /Updated title/);
          assert.strictEqual(item.metadata.sourceAuthor, 'renamed-author');
          assert.strictEqual(item.metadata.sourceUpdatedAt, '2026-10-28T00:00:00Z');
          assert.strictEqual(item.metadata.assigneeKind, 'agent');
          assert.strictEqual(item.metadata.note, 'keep me');
          if (type === 'issue') assert.deepStrictEqual(item.metadata.labels, ['bug']);
          assert.strictEqual(store.listWorkItems().totalCount, 2);
        }
        source.pr = []; source.issue = [];
        const result = sync();
        assert.ok(!result.closedItems.some(item => item.id === id));
        assert.strictEqual(store.getWorkItemById(id).status, status);
      });
    }
  }

  await test('untouched imports follow PR readiness, close, and reopen', ({ store, source, sync }) => {
    const id = importedId('pr');
    sync();
    source.pr[0].isDraft = true;
    sync();
    assert.strictEqual(store.getWorkItemById(id).status, 'blocked');
    const pr = source.pr[0];
    source.pr = []; source.issue = [];
    assert.strictEqual(sync().closedCount, 2);
    source.pr = [{ ...pr, isDraft: false }];
    sync();
    const reopened = store.getWorkItemById(id);
    assert.strictEqual(reopened.status, 'needs-review');
    assert.strictEqual(reopened.metadata.sourceClosedAt, undefined);
  });

  await test('local hold alone survives refresh and disappearance', ({ store, source, sync }) => {
    sync();
    const id = importedId('issue');
    store.upsertWorkItem({ ...store.getWorkItemById(id), status: 'blocked' });
    sync();
    assert.strictEqual(store.getWorkItemById(id).status, 'blocked');
    source.issue = [];
    sync();
    assert.strictEqual(store.getWorkItemById(id).status, 'blocked');
  });

  await test('legacy imports without ownership provenance are preserved', ({ store, source, sync }) => {
    const id = importedId('issue');
    store.upsertWorkItem({ id, source: 'github-issue', sourceId: '8', title: 'Legacy', status: 'blocked', owner: 'worker', metadata: { repo: 'example/repo', syncedBy: 'ecc-work-items-sync-github' } });
    sync();
    source.issue = [];
    sync();
    assert.strictEqual(store.getWorkItemById(id).status, 'blocked');
    assert.strictEqual(store.getWorkItemById(id).owner, 'worker');
  });

  for (const type of ['pr', 'issue']) {
    await test(`${type}: legacy identity and local ownership survive combined reconciliation`, ({ store, source, sync }) => {
      source[type === 'pr' ? 'issue' : 'pr'] = [];
      const builder = type === 'pr' ? buildGithubPrWorkItem : buildGithubIssueWorkItem;
      const original = builder('example/repo', source[type][0]);
      const id = `github-example-repo-${type}-${original.sourceId}`;
      store.upsertWorkItem({ ...original, id, status: 'running', owner: 'worker', sessionId: 'session-1' });
      const result = sync();
      assert.strictEqual(result.items[0].id, id);
      assert.strictEqual(store.getWorkItemById(original.id), null);
      assert.strictEqual(store.getWorkItemById(id).owner, 'worker');
      assert.strictEqual(store.getWorkItemById(id).status, 'running');
      assert.strictEqual(store.getWorkItemById(id).sessionId, 'session-1');
      assert.strictEqual(result.closedCount, 0);
    });
  }

  for (const [field, value] of Object.entries({ owner: 'worker', sessionId: 'session-1', priority: 'high', repoRoot: null })) {
    await test(`a local ${field} change alone survives disappearance`, ({ store, source, sync }) => {
      sync();
      const id = importedId('issue');
      store.upsertWorkItem({ ...store.getWorkItemById(id), [field]: value });
      source.issue = [];
      sync();
      const item = store.getWorkItemById(id);
      assert.strictEqual(item.status, 'needs-review');
      assert.strictEqual(item[field], value);
    });
  }

  await test('local management persists when fields later match source defaults', ({ store, source, sync }) => {
    sync();
    const id = importedId('issue');
    const initial = store.getWorkItemById(id);
    store.upsertWorkItem({ ...initial, status: 'running' });
    sync();
    store.upsertWorkItem({ ...store.getWorkItemById(id), status: initial.status });
    source.issue = [];
    assert.ok(!sync().closedItems.some(item => item.id === id));
    assert.strictEqual(store.getWorkItemById(id).status, initial.status);
  });

  await test('a failed reconciliation rolls back earlier writes', ({ store, source, sync }) => {
    sync();
    const initial = store.getWorkItemById(importedId('pr'));
    source.pr[0].title = 'Should roll back';
    const upsert = store.upsertWorkItem;
    store.upsertWorkItem = item => {
      if (item.source === 'github-issue') throw new Error('write failed');
      return upsert(item);
    };
    assert.throws(sync, /write failed/);
    assert.deepStrictEqual(store.getWorkItemById(initial.id), initial);
  });

  for (const existing of [false, true]) {
    await test(`explicit session on ${existing ? 'existing' : 'new'} imports survives later sync`, ({ store, source, sync }) => {
      if (existing) sync();
      sync({ sessionId: 'session-1' });
      sync();
      const id = importedId('issue');
      assert.strictEqual(store.getWorkItemById(id).sessionId, 'session-1');
      source.issue = [];
      sync();
      assert.strictEqual(store.getWorkItemById(id).status, 'needs-review');
    });
  }

  await test('local management first observed on disappearance remains sticky', ({ store, source, sync }) => {
    sync();
    const id = importedId('issue');
    store.upsertWorkItem({ ...store.getWorkItemById(id), status: 'blocked' });
    source.issue = [];
    sync();
    store.upsertWorkItem({ ...store.getWorkItemById(id), status: 'needs-review' });
    sync();
    assert.strictEqual(store.getWorkItemById(id).status, 'needs-review');
  });

  console.log(`Results: Passed: ${passed}, Failed: ${failed}`);
  if (failed) process.exitCode = 1;
}

run();
