'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createStateStore } = require('../../scripts/lib/state-store');
const { buildGithubIssueWorkItem, buildGithubPrWorkItem } = require('../../scripts/work-items');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-sync-closure-'));
  const dbPath = path.join(dir, 'state.db');
  const shim = path.join(dir, 'gh.js');
  const repo = 'fixture/project';
  let passed = 0;
  let failed = 0;
  let store;
  try {
    fs.writeFileSync(shim, `
      const [kind, command, id] = process.argv.slice(2);
      if (command === 'list') {
        console.log(JSON.stringify([{ number: 1, title: 'Visible', isDraft: false }]));
      } else if (command === 'view') {
        if (id === '6') { console.error('source unavailable'); process.exit(1); }
        const states = { '2': 'OPEN', '3': 'CLOSED', '4': 'MERGED', '5': 'UNKNOWN' };
        console.log(JSON.stringify({ state: states[id] }));
      } else { console.error('unexpected command'); process.exit(1); }
    `);
    store = await createStateStore({ dbPath });
    for (const number of [2, 3, 5, 6]) {
      store.upsertWorkItem(buildGithubIssueWorkItem(repo, { number, title: `Issue ${number}` }, { repoRoot: dir }));
    }
    store.upsertWorkItem(buildGithubPrWorkItem(repo, { number: 4, title: 'Merged' }, { repoRoot: dir }));
    store.close();
    store = null;
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/work-items.js'),
      'sync-github', '--repo', repo, '--limit', '1', '--db', dbPath, '--json'
    ], { env: { ...process.env, ECC_GH_SHIM: shim }, cwd: dir, encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    store = await createStateStore({ dbPath });
    function item(kind, number) { return store.getWorkItemById(`github-fixture-project-${kind}-${number}`); }
    function test(name, fn) {
      try { fn(); passed++; console.log(`  ✓ ${name}`); }
      catch (error) { failed++; console.error(`  ✗ ${name}: ${error.message}`); }
    }
    test('an open issue outside the bounded list stays open', () => {
      assert.strictEqual(item('issue', 2).status, 'needs-review');
      assert.strictEqual(item('issue', 2).metadata.sourceClosedAt, undefined);
    });
    test('individual CLOSED and MERGED source states close stale local items', () => {
      assert.strictEqual(item('issue', 3).status, 'closed');
      assert.strictEqual(item('pr', 4).status, 'closed');
      assert.strictEqual(payload.closedCount, 2);
    });
    test('an unknown source state stays unresolved and is reported', () => {
      assert.strictEqual(item('issue', 5).status, 'needs-review');
      assert.ok(payload.retainedItems.some(x => x.id.endsWith('issue-5') && /state/i.test(x.reason)));
    });
    test('a failed source lookup preserves the item and reports the failure', () => {
      assert.strictEqual(item('issue', 6).status, 'needs-review');
      assert.ok(payload.retainedItems.some(x => x.id.endsWith('issue-6') && /source unavailable/.test(x.reason)));
    });
  } finally {
    if (store) store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\nPassed: ${passed}\nFailed: ${failed}`);
  process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
