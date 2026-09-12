'use strict';

// Offline regression against the checkout; only disposable synthetic vaults.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const repo = path.resolve(__dirname, '../..');
const core = require(path.join(repo, 'scripts/lib/memory-vault.js'));
let passed = 0;
let failed = 0;
async function main() {
  const { executeMemoryTool } = await import(pathToFileURL(path.join(repo, 'scripts/memory-mcp.mjs')));
  function check(name, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-read-completeness-'));
    const old = { project: process.env.ECC_MEMORY_PROJECT_ROOT, user: process.env.ECC_MEMORY_USER_ROOT };
    try {
      process.env.ECC_MEMORY_PROJECT_ROOT = path.join(dir, 'vault');
      process.env.ECC_MEMORY_USER_ROOT = path.join(dir, 'user');
      const roots = core.resolveVaultRoots({ cwd: dir, homeDir: dir, env: {
        ECC_MEMORY_PROJECT_ROOT: path.join(dir, 'vault'), ECC_MEMORY_USER_ROOT: path.join(dir, 'user'),
      } });
      core.initializeVault({ roots, scopes: ['project', 'team'] });
      const id = 'mem_synthetic_current';
      core.saveMemory({ title: 'Synthetic handoff', body: 'Synthetic state; no authority.',
        sourceHarness: 'claude', targetHarnesses: ['codex'], scope: 'project' },
      { roots, idFactory: () => id, now: () => '2026-09-12T00:00:00.000Z' });
      const read = (target = id) => core.readMemoryById(target, { roots, targetHarness: 'codex' });
      const mcp = (target = id) => executeMemoryTool('memory_read', { id: target }, { harness: 'codex', allowUserScope: false });
      const truncate = () => fs.mkdirSync(path.join(roots.project, ...Array(10).fill('nested')), { recursive: true });
      const corrupt = () => fs.writeFileSync(path.join(roots.project, 'notes', 'invalid.md'), 'synthetic invalid document');
      fn({ roots, id, read, mcp, truncate, corrupt });
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}: ${error.code || 'assertion'}`);
    } finally {
      if (old.project === undefined) delete process.env.ECC_MEMORY_PROJECT_ROOT;
      else process.env.ECC_MEMORY_PROJECT_ROOT = old.project;
      if (old.user === undefined) delete process.env.ECC_MEMORY_USER_ROOT;
      else process.env.ECC_MEMORY_USER_ROOT = old.user;
      fs.rmSync(dir, { recursive: true, force: true });
      assert.equal(fs.existsSync(dir), false);
    }
  }
  const incomplete = fn => assert.throws(fn, { code: 'ECC_MEMORY_INCOMPLETE' });
  check('complete direct lookup preserves body and unreviewed status', ({ read }) => {
    const result = read(); assert.equal(result.memory.trust, 'unreviewed');
    assert.equal(result.memory.body, 'Synthetic state; no authority.');
  });
  check('complete missing lookup remains not found', ({ read }) => {
    assert.throws(() => read('mem_synthetic_missing'), /not found/);
  });
  check('truncated scan cannot claim a unique match', ({ read, truncate }) => { truncate(); incomplete(read); });
  check('truncated scan cannot claim absence', ({ read, truncate }) => { truncate(); incomplete(() => read('mem_synthetic_missing')); });
  check('malformed document cannot claim complete lookup', ({ read, corrupt }) => { corrupt(); incomplete(read); });
  check('malformed document cannot claim absence', ({ read, corrupt }) => { corrupt(); incomplete(() => read('mem_synthetic_missing')); });
  check('file read failure remains incomplete without exposing storage detail', ({ roots, id, read }) => {
    const open = fs.openSync;
    const target = path.join(roots.project, 'notes', `${id}.md`);
    try {
      fs.openSync = (file, ...args) => {
        if (file === target) {
          const error = new Error('Synthetic private storage detail.');
          error.code = 'EACCES';
          throw error;
        }
        return open(file, ...args);
      };
      assert.throws(read, error => error.code === 'ECC_MEMORY_INCOMPLETE'
        && !error.message.includes('Synthetic private storage detail.'));
    } finally {
      fs.openSync = open;
    }
  });
  check('MCP incomplete lookup has a distinct bounded error', ({ mcp, truncate }) => {
    truncate(); const result = mcp(); assert.equal(result.isError, true);
    const error = JSON.parse(result.content[0].text).error;
    assert.equal(error.code, 'MEMORY_READ_INCOMPLETE');
    assert.equal(error.message.includes('not found'), false);
    assert.equal(error.message.includes(path.sep + 'vault'), false);
  });
  check('MCP complete missing lookup retains non-disclosing failure', ({ mcp }) => {
    const result = mcp('mem_synthetic_missing'); assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error.code, 'MEMORY_READ_FAILED');
  });
  check('MCP denied user scope stays denied before storage', ({ id }) => {
    assert.throws(() => executeMemoryTool('memory_read', { id, scope: 'user' }, { harness: 'codex', allowUserScope: false }), /disabled/);
  });
  console.log(JSON.stringify({ passed, failed, fixturesRemoved: true, serverStarted: false, providersCalled: false }));
  process.exitCode = failed ? 1 : 0;
}
main().catch(() => { console.error('Regression harness setup failed.'); process.exitCode = 1; });
