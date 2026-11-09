'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const memory = require('../../scripts/lib/copilot-memory');
const mcp = require('../../scripts/lib/copilot-mcp');
const sessions = require('../../scripts/lib/copilot-sessions');
const REPO = path.resolve(__dirname, '../..');
let passed = 0;
async function test(name, action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-integration-'));
  const workspace = path.join(root, 'project'); fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });
  const env = { ...process.env, COPILOT_HOME: path.join(root, 'copilot'), ECC_MEMORY_USER_ROOT: path.join(root, 'user'),
    ECC_MEMORY_ALLOW_USER_SCOPE: '0', ECC_COPILOT_MEMORY_RUNTIME: REPO };
  try { await action({ root, workspace, env }); passed++; console.log(`PASS ${name}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
async function withClient(script, args, workspace, env, action) {
  const child = spawn(process.execPath, [script, ...args], { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = ''; let bytes = 0; let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', chunk => {
    bytes += chunk.length; assert.ok(bytes < 1024 * 1024, 'bounded MCP fixture output'); buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      const response = JSON.parse(line); const waiter = pending.get(response.id);
      if (waiter) { pending.delete(response.id); clearTimeout(waiter.timer); waiter.resolve(response); }
    }
  });
  child.stderr.on('data', () => {});
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP fixture timeout')); }, 5000);
    pending.set(id, { resolve, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    const initialized = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } });
    assert.equal(initialized.result.protocolVersion, '2024-11-05');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await action(call);
  } finally {
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    child.stdin.end();
    await new Promise(resolve => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000); child.once('close', () => { clearTimeout(timer); resolve(); }); });
  }
}
function body(response) {
  assert.ok(response.result, 'MCP result envelope');
  return JSON.parse(response.result.content[0].text);
}
(async () => {
  await test('explicit Memory MCP preview apply and selected rollback preserve other servers', async ({ root, workspace, env }) => {
    const configPath = path.join(root, '.mcp.json');
    mcp.apply(mcp.preview({ configPath, catalog: { mcpServers: { other: { command: 'node', args: ['other.js'] } } }, selected: [{ name: 'other' }] }));
    const before = fs.readFileSync(configPath, 'utf8');
    const plan = memory.previewMemoryMcp(workspace, { configPath, tools: ['memory_read', 'memory_search'] }, env);
    assert.equal(fs.readFileSync(configPath, 'utf8'), before);
    assert.deepEqual(plan.additions['ecc-memory'].env, {});
    assert.ok(plan.additions['ecc-memory'].args.includes('--runtime'));
    mcp.apply(plan);
    const removed = memory.rollbackMemoryMcp({ configPath });
    assert.deepEqual(removed.removed, ['ecc-memory']);
    assert.ok(JSON.parse(fs.readFileSync(configPath)).mcpServers.other);
    assert.ok(JSON.parse(fs.readFileSync(`${configPath}.ecc-managed.json`)).managed.other);
    assert.throws(() => memory.previewMemoryMcp(workspace, { configPath, tools: ['unknown_tool'] }, env));
  });
  await test('source-free installed Memory MCP wrapper uses canonical save search read and doctor with Copilot identity', async ({ root, workspace, env }) => {
    const installed = path.join(root, 'installed/scripts'); fs.mkdirSync(path.join(installed, 'lib'), { recursive: true });
    for (const relative of ['copilot-memory-mcp.js', 'lib/copilot-memory.js', 'lib/copilot-sessions.js', 'lib/memory-vault-format.js']) {
      fs.copyFileSync(path.join(REPO, 'scripts', relative), path.join(installed, relative));
    }
    await withClient(path.join(installed, 'copilot-memory-mcp.js'), ['--runtime', REPO], workspace,
      { ...env, ECC_MEMORY_HARNESS: 'claude' }, async call => {
        const saved = body(await call('tools/call', { name: 'memory_save', arguments: {
          title: 'Cross harness fixture', body: 'Recover integration evidence.', targetHarnesses: ['copilot'] } }));
        assert.equal(saved.memory.sourceHarness, 'copilot'); assert.equal(saved.memory.trust, 'unreviewed');
        const read = body(await call('tools/call', { name: 'memory_read', arguments: { id: saved.memory.id } }));
        assert.equal(read.memory.body, 'Recover integration evidence.');
        const found = body(await call('tools/call', { name: 'memory_search', arguments: { query: 'integration' } }));
        assert.equal(found.results.length, 1);
        const foreign = body(await call('tools/call', { name: 'memory_save', arguments: {
          title: 'Foreign recipient', body: 'Recipient-isolated fixture.', targetHarnesses: ['codex'] } }));
        const forbidden = await call('tools/call', { name: 'memory_read', arguments: { id: foreign.memory.id } });
        assert.equal(forbidden.result.isError, true);
        assert.ok(!JSON.stringify(forbidden).includes('Recipient-isolated fixture'));
        const denied = await call('tools/call', { name: 'memory_search', arguments: { query: '', scopes: ['user'] } });
        assert.ok(denied.error || denied.result?.isError);
        const doctor = body(await call('tools/call', { name: 'memory_doctor', arguments: {} }));
        assert.equal(doctor.ok, true);
      });
    assert.equal(fs.readFileSync(path.join(workspace, '.ecc/memory/project/.gitignore'), 'utf8'), '*\n!.gitignore\n');
  });
  await test('read errors distinguish incomplete and absent; stale memories remain visible only as stale records', ({ workspace, env }) => {
    assert.throws(() => memory.invokeMemory(workspace, ['read', 'mem_absent_fixture', '--scope', 'project', '--json'], env),
      error => error.code === 'ECC_COPILOT_MEMORY_NOT_FOUND');
    sessions.checkpoint(workspace, 'one', 'Continue fixture integration.', env);
    const proposal = memory.proposeHandoff(workspace, { sessionId: 'one', title: 'Continue', target: 'copilot' }, env);
    const saved = memory.saveHandoff(workspace, proposal, { reviewedSha256: memory.proposalDigest(proposal) }, env);
    const file = path.join(workspace, '.ecc/memory/project/handoffs', `${saved.memory.id}.md`);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^status:.*$/m, 'status: "superseded"'));
    assert.equal(memory.readForCopilot(workspace, saved.memory.id, env).memory.status, 'superseded');
    assert.equal(memory.searchForCopilot(workspace, 'integration', env).status, 'empty');
    fs.writeFileSync(path.join(workspace, '.ecc/memory/project/handoffs/broken.md'), 'malformed');
    assert.equal(memory.searchForCopilot(workspace, 'unmatched', env).status, 'incomplete');
    assert.throws(() => memory.readForCopilot(workspace, saved.memory.id, env), error => error.code === 'ECC_COPILOT_MEMORY_INCOMPLETE');
    assert.throws(() => memory.invokeMemory(workspace, ['search', '', '--scope', 'user', '--json'], env), /user scope/i);
  });
  await test('CLI exposes reviewed MCP setup and rollback without silent installation', ({ root, workspace, env }) => {
    const script = path.join(REPO, 'scripts/copilot-memory.js');
    const config = path.join(root, 'cli-mcp.json');
    const execute = args => spawnSync(process.execPath, [script, ...args], { cwd: workspace, env, encoding: 'utf8', timeout: 10000 });
    const preview = execute(['mcp-preview', '--config', config]);
    assert.equal(preview.status, 0, preview.stderr); assert.ok(!fs.existsSync(config));
    assert.deepEqual(JSON.parse(preview.stdout).additions['ecc-memory'].tools, []);
    const applied = execute(['mcp-apply', '--config', config, '--tools', 'memory_read,memory_doctor']);
    assert.equal(applied.status, 0, applied.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(config)).mcpServers['ecc-memory'].tools, ['memory_read', 'memory_doctor']);
    assert.equal(execute(['mcp-rollback', '--config', config]).status, 0);
    assert.equal(execute(['mcp-rollback', '--config', config, '--tools', 'memory_read']).status, 1);
    assert.ok(!fs.existsSync(path.join(workspace, 'node_modules')));
  });
  await test('worktree defaults stay isolated and an explicit canonical root permits coherent handoff recall', ({ root, workspace, env }) => {
    const git = args => {
      const result = spawnSync('git', ['-C', workspace, ...args], { encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, 'fixture git command');
    };
    git(['init', '-q']); git(['config', 'user.name', 'Memory Fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
    fs.writeFileSync(path.join(workspace, 'tracked'), 'fixture'); git(['add', 'tracked']);
    const hooks = path.join(root, 'disabled-hooks'); fs.mkdirSync(hooks);
    git(['-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
    const worktree = path.join(root, 'worktree with spaces'); git(['worktree', 'add', '-qb', 'memory-fixture', worktree]);
    sessions.checkpoint(workspace, 'one', 'Continue worktree evidence.', env);
    const proposal = memory.proposeHandoff(workspace, { sessionId: 'one', title: 'Continue', target: 'copilot' }, env);
    const saved = memory.saveHandoff(workspace, proposal, { reviewedSha256: memory.proposalDigest(proposal) }, env);
    assert.throws(() => memory.readForCopilot(worktree, saved.memory.id, env), error => error.code === 'ECC_COPILOT_MEMORY_NOT_FOUND');
    const configured = { ...env, ECC_MEMORY_PROJECT_ROOT: path.join(workspace, '.ecc/memory') };
    assert.equal(memory.readForCopilot(worktree, saved.memory.id, configured).memory.body, 'Continue worktree evidence.');
  });
  await test('bootstrap rejects missing relative or unsupported canonical runtimes before protocol startup', ({ root, workspace, env }) => {
    const script = path.join(REPO, 'scripts/copilot-memory-mcp.js');
    for (const args of [[], ['--runtime', 'relative'], ['--runtime', path.join(root, 'missing')], ['--runtime', REPO, '--unexpected']]) {
      const result = spawnSync(process.execPath, [script, ...args], { cwd: workspace, env, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 1); assert.equal(result.stdout, '');
      assert.ok(!result.stderr.includes(root));
    }
  });
  console.log(`Passed: ${passed}, Failed: 0`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
