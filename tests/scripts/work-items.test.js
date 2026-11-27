'use strict';
/**
 * Tests for scripts/work-items.js — focused on the `claim` JIT pickup command.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

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

    await test('claim of a specific id works and rejects a missing id', async () => {
      const owned = runClaim(dbPath, ['wi-owned', '--owner', 'carol']);
      assert.notStrictEqual(owned.status, 0, 'an explicit id must not replace another owner');
      assert.match(owned.stderr, /already owned/i);
      const store = await createStateStore({ dbPath });
      try { assert.strictEqual(store.getWorkItemById('wi-owned').owner, 'codex'); } finally { store.close(); }

      const missing = runClaim(dbPath, ['nope-404', '--owner', 'carol']);
      assert.notStrictEqual(missing.status, 0, 'missing id should fail');
      assert.ok(/not found/i.test(missing.stderr), 'reports not found');
    });

    await test('claim rejects unadmitted needs-review, blocked, hold, and unowned running items', async () => {
      const statuses = ['needs-review', 'blocked', 'hold', 'running', 'in-progress'];
      const setup = await createStateStore({ dbPath });
      try {
        for (const status of statuses) {
          setup.upsertWorkItem({ id: `wi-gate-${status}`, source: 'manual', title: `Gate ${status}`, status, owner: null, metadata: {} });
        }
      } finally { setup.close(); }
      for (const status of statuses) {
        const result = runClaim(dbPath, [`wi-gate-${status}`, '--owner', 'gate-worker', '--as', 'agent']);
        assert.notStrictEqual(result.status, 0, `${status} must not be claimable`);
        assert.match(result.stderr, /not READY/i);
        const store = await createStateStore({ dbPath });
        try { assert.strictEqual(store.getWorkItemById(`wi-gate-${status}`).status, status); } finally { store.close(); }
      }
    });

    await test('automatic claim skips higher-priority unready work and picks READY', async () => {
      const setup = await createStateStore({ dbPath });
      try {
        setup.upsertWorkItem({ id: 'wi-unassigned-high', source: 'manual', title: 'Needs review', status: 'needs-review', priority: 'critical', owner: null, metadata: {} });
        setup.upsertWorkItem({ id: 'wi-unassigned-low', source: 'manual', title: 'Blocked', status: 'blocked', priority: 'high', owner: null, metadata: {} });
        setup.upsertWorkItem({ id: 'wi-auto-blocked-high', source: 'manual', title: 'High priority blocked', status: 'blocked', priority: 'critical', owner: null, metadata: {} });
        setup.upsertWorkItem({ id: 'wi-auto-ready-low', source: 'manual', title: 'Low priority READY', status: 'ready', priority: 'low', owner: null, metadata: {} });
      } finally { setup.close(); }
      const result = runClaim(dbPath, ['--owner', 'auto-worker', '--as', 'agent']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.claimed, true);
      assert.strictEqual(payload.item.id, 'wi-auto-ready-low');
      assert.strictEqual(payload.item.status, 'running');
    });

    await test('automatic claim returns empty when all unowned items are unready', async () => {
      const setup = await createStateStore({ dbPath });
      try {
        setup.upsertWorkItem({ id: 'wi-unassigned-high', source: 'manual', title: 'Needs review', status: 'needs-review', priority: 'critical', owner: null, metadata: {} });
        setup.upsertWorkItem({ id: 'wi-unassigned-low', source: 'manual', title: 'Hold', status: 'hold', priority: 'high', owner: null, metadata: {} });
      } finally { setup.close(); }
      const result = runClaim(dbPath, ['--owner', 'auto-worker', '--as', 'agent']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.deepStrictEqual(payload, { claimed: false, reason: 'no-unassigned-open-items' });
    });

    await test('claim accepts an explicitly ready item', async () => {
      const setup = await createStateStore({ dbPath });
      try { setup.upsertWorkItem({ id: 'wi-explicit-ready', source: 'manual', title: 'Approved', status: 'ready', owner: null, metadata: {} }); }
      finally { setup.close(); }
      const result = runClaim(dbPath, ['wi-explicit-ready', '--owner', 'approved-worker', '--as', 'agent']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.claimed, true);
      assert.strictEqual(payload.item.status, 'running');
      assert.strictEqual(payload.item.owner, 'approved-worker');
    });

    await test('repeat claim by the same owner preserves legacy in-progress idempotence', async () => {
      const setup = await createStateStore({ dbPath });
      try {
        setup.upsertWorkItem({ id: 'wi-legacy-in-progress', source: 'manual', title: 'Legacy active work', status: 'in-progress', owner: 'legacy-worker', metadata: {} });
      } finally { setup.close(); }
      const before = await createStateStore({ dbPath });
      let original;
      try { original = before.getWorkItemById('wi-legacy-in-progress'); } finally { before.close(); }
      const result = runClaim(dbPath, ['wi-legacy-in-progress', '--owner', 'legacy-worker', '--as', 'agent']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.deepStrictEqual(JSON.parse(result.stdout).item, original);
    });

    await test('automatic claim finds older READY work beyond 100 newer unready items', async () => {
      const store = await createStateStore({ dbPath });
      try {
        for (let i = 0; i < 105; i++) {
          store.upsertWorkItem({
            id: `wi-new-unready-${i}`, source: 'manual', title: 'Unready',
            status: 'needs-review', priority: 'critical', owner: null,
            createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z'
          });
        }
        store.upsertWorkItem({
          id: 'wi-old-critical-ready', source: 'manual', title: 'Old critical READY',
          status: 'ready', priority: 'critical', owner: null,
          createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z'
        });
        store.upsertWorkItem({
          id: 'wi-old-low-ready', source: 'manual', title: 'Old low READY',
          status: 'ready', priority: 'low', owner: null,
          createdAt: '2025-02-01T00:00:00.000Z', updatedAt: '2025-02-01T00:00:00.000Z'
        });
        const newest = store.listWorkItems({ limit: 100 });
        assert.ok(newest.totalCount > 100);
        assert.ok(!newest.items.some(item => item.id === 'wi-old-critical-ready'));
      } finally { store.close(); }

      const first = runClaim(dbPath, ['--owner', 'critical-worker', '--as', 'agent']);
      assert.strictEqual(first.status, 0, first.stderr);
      assert.strictEqual(JSON.parse(first.stdout).item.id, 'wi-old-critical-ready');

      const second = runClaim(dbPath, ['--owner', 'low-worker', '--as', 'agent']);
      assert.strictEqual(second.status, 0, second.stderr);
      assert.strictEqual(JSON.parse(second.stdout).item.id, 'wi-old-low-ready');
    });

    await test('repeat claim by the same owner is idempotent', async () => {
      const before = await createStateStore({ dbPath });
      let original;
      try { original = before.getWorkItemById('wi-owned'); } finally { before.close(); }
      const repeated = runClaim(dbPath, ['wi-owned', '--owner', original.owner, '--as', 'human']);
      assert.strictEqual(repeated.status, 0, repeated.stderr);
      assert.deepStrictEqual(JSON.parse(repeated.stdout).item, original);
    });

    await test('concurrent explicit claims have one winner and preserve its owner', async () => {
      const setup = await createStateStore({ dbPath });
      try { setup.upsertWorkItem({ id: 'wi-race', source: 'manual', title: 'Race', status: 'open', owner: null }); } finally { setup.close(); }
      const results = await Promise.all(['left', 'right'].map(owner => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CLI, 'claim', 'wi-race', '--owner', owner, '--db', dbPath, '--json']);
        let stdout = ''; let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', status => resolve({ owner, status, stdout, stderr }));
      })));
      const winners = results.filter(result => result.status === 0);
      assert.strictEqual(winners.length, 1, JSON.stringify(results));
      assert.match(results.find(result => result.status !== 0).stderr, /already owned/i);
      const store = await createStateStore({ dbPath });
      try { assert.strictEqual(store.getWorkItemById('wi-race').owner, winners[0].owner); } finally { store.close(); }
    });

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
