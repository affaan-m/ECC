'use strict';
/**
 * Tests for scripts/work-items.js — focused on the `claim` JIT pickup command.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { createStateStore } = require('../../scripts/lib/state-store');

const CLI = path.join(__dirname, '..', '..', 'scripts', 'work-items.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function runClaim(dbPath, args) {
  const result = spawnSync('node', [CLI, 'claim', '--db', dbPath, '--json', ...args], {
    encoding: 'utf8'
  });
  return result;
}

async function seed(dbPath) {
  const store = await createStateStore({ dbPath });
  try {
    // High-priority, unassigned, open — the JIT pickup target.
    store.upsertWorkItem({
      id: 'wi-unassigned-high',
      source: 'github-issue',
      title: 'Fix the gate bypass',
      status: 'open',
      priority: 'high',
      owner: null,
      metadata: {}
    });
    // Low-priority, unassigned, open — should be picked only after the high one.
    store.upsertWorkItem({
      id: 'wi-unassigned-low',
      source: 'manual',
      title: 'Tidy docs',
      status: 'open',
      priority: 'low',
      owner: null,
      metadata: {}
    });
    // Already owned — must never be auto-claimed.
    store.upsertWorkItem({
      id: 'wi-owned',
      source: 'manual',
      title: 'In progress',
      status: 'running',
      priority: 'high',
      owner: 'codex',
      metadata: {}
    });
    // Done — must never be claimed.
    store.upsertWorkItem({
      id: 'wi-done',
      source: 'manual',
      title: 'Shipped',
      status: 'done',
      priority: 'high',
      owner: null,
      metadata: {}
    });
  } finally {
    store.close();
  }
}

async function run() {
  console.log('\n=== Testing work-items.js claim ===\n');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-items-claim-'));
  const dbPath = path.join(dir, 'state.db');

  try {
    await seed(dbPath);

    await test('claim picks the highest-priority unassigned open item and sets owner + kind', async () => {
      const result = runClaim(dbPath, ['--owner', 'alice', '--as', 'human']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.claimed, true);
      assert.strictEqual(payload.item.id, 'wi-unassigned-high', 'high-priority item claimed first');
      assert.strictEqual(payload.item.owner, 'alice');
      assert.strictEqual(payload.item.status, 'running', 'claim moves the card to running');
      assert.strictEqual(payload.item.metadata.assigneeKind, 'human');
    });

    await test('a second claim takes the next unassigned item, not an owned or done one', async () => {
      const result = runClaim(dbPath, ['--owner', 'bot-7', '--as', 'agent']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.claimed, true);
      assert.strictEqual(payload.item.id, 'wi-unassigned-low');
      assert.strictEqual(payload.item.metadata.assigneeKind, 'agent');
    });

    await test('claim reports nothing to do once the queue is drained', async () => {
      const result = runClaim(dbPath, ['--owner', 'alice']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.claimed, false);
      assert.strictEqual(payload.reason, 'no-unassigned-open-items');
    });

    await test('claim by id preserves another owner and lets the current owner reclaim', async () => {
      const denied = runClaim(dbPath, ['wi-owned', '--owner', 'carol']);
      assert.notStrictEqual(denied.status, 0, 'a different owner must be refused');
      assert.match(denied.stderr, /already owned by codex/);

      const current = await createStateStore({ dbPath });
      try {
        assert.strictEqual(current.getWorkItemById('wi-owned').owner, 'codex');
      } finally {
        current.close();
      }
      const owned = runClaim(dbPath, ['wi-owned', '--owner', 'codex']);
      assert.strictEqual(owned.status, 0, owned.stderr);
      assert.strictEqual(JSON.parse(owned.stdout).item.owner, 'codex');

      const missing = runClaim(dbPath, ['nope-404', '--owner', 'carol']);
      assert.notStrictEqual(missing.status, 0, 'missing id should fail');
      assert.ok(/not found/i.test(missing.stderr), 'reports not found');
    });

    await test('GitHub sync separates authors from assignments and retains local claims', async () => {
      const childProcess = require('child_process');
      const modulePath = require.resolve('../../scripts/work-items');
      const cachedModule = require.cache[modulePath];
      const originalSpawn = childProcess.spawnSync;
      const issues = [
        { number: 101, title: 'Available issue', author: { login: 'reporter' }, assignees: [] },
        { number: 102, title: 'Assigned issue', author: { login: 'reporter' }, assignees: [{ login: 'assignee' }] },
        { number: 104, title: 'Legacy local owner', author: { login: 'reporter' }, assignees: [] }
      ];
      const prs = [{ number: 103, title: 'Review work', author: { login: 'contributor' }, assignees: [] }];
      childProcess.spawnSync = (command, args, options) => command === 'gh'
        ? { status: 0, stdout: JSON.stringify(args[0] === 'pr' ? prs : issues), stderr: '' }
        : originalSpawn(command, args, options);
      delete require.cache[modulePath];
      const { syncGithubWorkItems, buildGithubIssueWorkItem } = require(modulePath);
      const store = await createStateStore({ dbPath: path.join(dir, 'imports.db') });
      const { claimWorkItem } = require('../../scripts/lib/control-pane/work-item-mutations');
      try {
        store.upsertWorkItem({ id: buildGithubIssueWorkItem('example/repo', issues[2]).id,
          title: 'Legacy local owner', source: 'github-issue', sourceId: '104',
          owner: 'legacy-operator', status: 'needs-review',
          metadata: { repo: 'example/repo', syncedBy: 'ecc-work-items-sync-github' } });
        const synced = syncGithubWorkItems(store, { githubRepo: 'example/repo', limit: 20 });
        const available = synced.items.find(item => item.sourceId === '101');
        const assigned = synced.items.find(item => item.sourceId === '102');
        const pr = synced.items.find(item => item.sourceId === '103');
        assert.strictEqual(available.owner, null);
        assert.strictEqual(available.metadata.authorLogin, 'reporter');
        assert.strictEqual(pr.owner, null);
        assert.strictEqual(pr.metadata.authorLogin, 'contributor');
        assert.strictEqual(assigned.owner, 'assignee');
        const legacyOwner = synced.items.find(item => item.sourceId === '104');
        assert.strictEqual(legacyOwner.owner, 'legacy-operator');
        assert.strictEqual(legacyOwner.metadata.claimOwnerSource, undefined);
        assert.strictEqual(legacyOwner.metadata.ownershipAmbiguous, true);
        assert.throws(() => claimWorkItem(store, { id: legacyOwner.id, owner: 'operator' }), /already owned/);
        assert.throws(() => claimWorkItem(store, { id: assigned.id, owner: 'operator' }), /already owned/);
        claimWorkItem(store, { id: pr.id, owner: 'reviewer' });
        const claimed = claimWorkItem(store, { owner: 'operator', assigneeKind: 'agent', sessionId: 'local-session' });
        assert.strictEqual(claimed.item.id, available.id);
        assert.strictEqual(claimed.item.owner, 'operator');
        syncGithubWorkItems(store, { githubRepo: 'example/repo', limit: 20 });
        assert.strictEqual(store.getWorkItemById(available.id).owner, 'operator');
        assert.strictEqual(store.getWorkItemById(available.id).status, 'running');
        assert.strictEqual(store.getWorkItemById(available.id).metadata.authorLogin, 'reporter');
        assert.strictEqual(store.getWorkItemById(available.id).metadata.assigneeKind, 'agent');
        assert.strictEqual(store.getWorkItemById(available.id).sessionId, 'local-session');
      } finally {
        store.close();
        childProcess.spawnSync = originalSpawn;
        if (cachedModule) require.cache[modulePath] = cachedModule;
        else delete require.cache[modulePath];
      }
    });

    await test('ambiguous legacy owners need synchronization while genuine legacy owners stay protected', async () => {
      const store = await createStateStore({ dbPath: path.join(dir, 'legacy.db') });
      const { claimWorkItem } = require('../../scripts/lib/control-pane/work-item-mutations');
      const legacy = { source: 'github-issue', status: 'needs-review', owner: 'reporter',
        metadata: { repo: 'legacy/repo', syncedBy: 'ecc-work-items-sync-github' } };
      try {
        store.upsertWorkItem({ ...legacy, id: 'legacy-author', title: 'Legacy author only' });
        store.upsertWorkItem({ ...legacy, id: 'legacy-running', title: 'Legacy claim', status: 'running' });
        store.upsertWorkItem({ ...legacy, id: 'legacy-explicit', title: 'Explicit assignee',
          metadata: { ...legacy.metadata, assigneeKind: 'human' } });
        assert.throws(() => claimWorkItem(store, { id: 'legacy-author', owner: 'worker' }), /already owned/);
        assert.strictEqual(claimWorkItem(store, { owner: 'worker' }).claimed, false);
        assert.throws(() => claimWorkItem(store, { id: 'legacy-running', owner: 'worker' }), /already owned/);
        assert.throws(() => claimWorkItem(store, { id: 'legacy-explicit', owner: 'worker' }), /already owned/);
      } finally { store.close(); }
    });

    for (const scenario of ['old-author-claim', 'lane-move-assignee', 'remote-close']) {
      await test(`GitHub ownership reconciliation: ${scenario}`, async () => {
        const cp = require('child_process');
        const modulePath = require.resolve('../../scripts/work-items');
        const cached = require.cache[modulePath];
        const original = cp.spawnSync;
        let issues = [{ number: 201, title: 'Tracked work', author: { login: 'reporter' },
          assignees: scenario === 'lane-move-assignee' ? [{ login: 'assignee' }] : [] }];
        cp.spawnSync = (command, args, options) => command === 'gh'
          ? { status: 0, stdout: JSON.stringify(args[0] === 'pr' ? [] : issues), stderr: '' }
          : original(command, args, options);
        delete require.cache[modulePath];
        const { syncGithubWorkItems, buildGithubIssueWorkItem, buildUpsertPayload } = require(modulePath);
        const { claimWorkItem, moveWorkItem } = require('../../scripts/lib/control-pane/work-item-mutations');
        const store = await createStateStore({ dbPath: path.join(dir, `${scenario}.db`) });
        const id = buildGithubIssueWorkItem('reconcile/repo', issues[0]).id;
        const sync = () => syncGithubWorkItems(store, { githubRepo: 'reconcile/repo', limit: 20 });
        try {
          if (scenario !== 'remote-close') {
            store.upsertWorkItem({ id, title: 'Legacy work', source: 'github-issue', sourceId: '201',
              owner: 'reporter', status: 'needs-review',
              metadata: { repo: 'reconcile/repo', syncedBy: 'ecc-work-items-sync-github' } });
          }
          if (scenario === 'lane-move-assignee') {
            moveWorkItem(store, { id, lane: 'running' });
            sync(); sync();
            assert.strictEqual(store.getWorkItemById(id).owner, 'assignee');
            assert.strictEqual(store.getWorkItemById(id).metadata.claimOwnerSource, undefined);
            assert.strictEqual(claimWorkItem(store, { id, owner: 'assignee' }).claimed, true);
          } else if (scenario === 'old-author-claim') {
            sync(); sync();
            const prior = store.getWorkItemById(id);
            assert.strictEqual(prior.owner, 'reporter', 'an indistinguishable old claim must remain protected');
            assert.strictEqual(prior.metadata.claimOwnerSource, undefined);
            assert.strictEqual(prior.metadata.ownershipAmbiguous, true);
            assert.throws(() => claimWorkItem(store, { id, owner: 'operator' }), /already owned/);
            store.upsertWorkItem(buildUpsertPayload({ id, owner: 'intended-owner' }, prior));
            sync();
            assert.strictEqual(store.getWorkItemById(id).owner, 'intended-owner');
            assert.strictEqual(store.getWorkItemById(id).metadata.claimOwnerSource, 'local');
            assert.strictEqual(store.getWorkItemById(id).metadata.ownershipAmbiguous, false);
          } else {
            sync();
            claimWorkItem(store, { id, owner: 'operator', assigneeKind: 'agent', sessionId: 'claim-session' });
            sync();
            assert.strictEqual(store.getWorkItemById(id).status, 'running');
            issues = [];
            sync();
            const closed = store.getWorkItemById(id);
            assert.strictEqual(closed.status, 'closed');
            assert.strictEqual(closed.owner, 'operator');
            assert.strictEqual(closed.sessionId, 'claim-session');
          }
        } finally {
          store.close(); cp.spawnSync = original;
          if (cached) require.cache[modulePath] = cached;
          else delete require.cache[modulePath];
        }
      });
    }

    await test('claim requires --owner and validates --as', async () => {
      const noOwner = runClaim(dbPath, ['wi-done']);
      assert.notStrictEqual(noOwner.status, 0);
      assert.ok(/requires --owner/i.test(noOwner.stderr));

      const badKind = runClaim(dbPath, ['wi-owned', '--owner', 'x', '--as', 'robot']);
      assert.notStrictEqual(badKind.status, 0);
      assert.ok(/agent.*human/i.test(badKind.stderr));
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
