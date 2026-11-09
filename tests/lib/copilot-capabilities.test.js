'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildInventory, renderReport } = require('../../scripts/ci/copilot-capabilities');
const root = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.error(`  ✗ ${name}: ${error.stack}`); }
}
const inventory = buildInventory(root);
test('inventory is deterministic and contains unique stable IDs', () => {
  assert.deepStrictEqual(inventory, buildInventory(root));
  assert.strictEqual(new Set(inventory.capabilities.map(item => item.id)).size, inventory.capabilities.length);
});
test('metadata and nested dispatcher policies have individual rows', () => {
  const hooks = inventory.capabilities.filter(item => item.kind === 'hook');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'hooks/hooks.metadata.json'), 'utf8'));
  for (const entry of Object.values(metadata.entries).flat()) assert(hooks.some(item => item.id === `hook:${entry.id}`), entry.id);
  for (const id of ['pre:bash:commit-quality', 'post:bash:build-complete', 'post:edit:accumulator', 'post:ecc-context-monitor']) {
    assert(hooks.some(item => item.id === `hook:${id}`), id);
  }
});
test('every canonical content and runtime file is represented, without symlink traversal', () => {
  for (const dir of ['skills', 'agents', 'commands', 'rules', 'scripts', 'mcp-configs']) {
    function visit(relative) {
      for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const child = `${relative}/${entry.name}`;
        if (entry.isDirectory() && !['__pycache__', '.pytest_cache', 'node_modules'].includes(entry.name)) visit(child);
        else if (entry.isFile()) assert(inventory.capabilities.some(item => item.source === child), child);
      }
    }
    visit(dir);
  }
});
test('every declared MCP server has a separate diagnostic row', () => {
  const servers = JSON.parse(fs.readFileSync(path.join(root, 'mcp-configs/mcp-servers.json'), 'utf8')).mcpServers;
  for (const name of Object.keys(servers)) assert(inventory.capabilities.some(item => item.id === `mcp-server:${name}`));
  assert.match(inventory.capabilities.find(item => item.id === 'mcp-server:github').differences, /duplicate/);
});
test('accessory rows distinguish fixture projections from held build and PR signals', () => {
  const row = id => inventory.capabilities.find(item => item.id === `hook:${id}`);
  for (const id of ['stop:plan-canvas-pending', 'stop:desktop-notify', 'pre:edit-write:suggest-compact']) {
    assert.equal(row(id).status, 'fixture-projected');
    assert(row(id).automatic_tests.every(file => fs.existsSync(path.join(root, file))));
  }
  for (const id of ['post:bash:build-complete', 'post:bash:pr-created']) {
    assert.equal(row(id).status, 'held-for-native-evidence');
    assert.deepEqual(row(id).automatic_tests, []);
  }
});
test('inventory never turns generated discovery into native certification', () => {
  for (const item of inventory.capabilities) {
    assert.strictEqual(item.native.status, 'native-unverified');
    assert.deepStrictEqual(item.native.evidence, []);
    assert(item.phase && item.prerequisites.length && item.differences && item.review);
    assert(/^[a-f0-9]{64}$/.test(item.source_sha256));
  }
});
test('human report states fixture and semantic-review limits', () => {
  const report = renderReport(inventory);
  assert.match(report, /native-unverified/);
  assert.match(report, /semantic review/i);
  assert.match(report, /P00/);
  assert.match(report, /P14/);
});
console.log(`\nPassed: ${passed}\nFailed: ${failed}`);
process.exitCode = failed ? 1 : 0;
