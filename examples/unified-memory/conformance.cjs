'use strict';

// Runs existing ECC code against disposable synthetic vaults. No service or SDK installs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { encodeEvidence, verifyEvidence } = require('./evidence.cjs');

const repo = path.resolve(__dirname, '../..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const cleanEnv = { PATH: process.env.PATH || '/usr/bin:/bin' };
// Use the already installed Ajv; no package manager or network operation occurs.
let dependencyRoot;
try {
  dependencyRoot = path.dirname(path.dirname(require.resolve('ajv/package.json')));
} catch {
  process.stderr.write('ECC memory example requires the existing Ajv runtime dependency.\n');
  process.exit(1);
}
const sourcePaths = [
  'scripts/memory.js', 'scripts/memory-mcp.mjs', 'scripts/lib/memory-vault.js',
  'scripts/lib/memory-vault-format.js', 'scripts/lib/path-safety.js',
  'scripts/lib/missing-dependency.js', 'schemas/memory.schema.json', 'package.json',
  'examples/unified-memory/evidence.cjs',
];
function snapshot() {
  return Object.fromEntries(sourcePaths.map(file => [file, sha256(fs.readFileSync(path.join(repo, file)))]));
}
function sourceHead() {
  const result = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
    encoding: 'utf8', env: cleanEnv, timeout: 5000, maxBuffer: 1024,
  });
  return result.status === 0 && /^[a-f0-9]{40}\s*$/.test(result.stdout) ? result.stdout.trim() : null;
}
const before = snapshot();
const headBefore = sourceHead();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-conformance-'));
const checks = [];
const startedAt = new Date().toISOString();
function envFor(partition = 'alpha', harness = 'codex', allowUser = false) {
  const cwd = path.join(root, partition);
  fs.mkdirSync(cwd, { recursive: true });
  return { cwd, env: { ...cleanEnv,
    NODE_PATH: dependencyRoot,
    ECC_MEMORY_PROJECT_ROOT: path.join(cwd, 'vault'),
    ECC_MEMORY_USER_ROOT: path.join(root, 'synthetic-user'),
    ...(harness ? { ECC_MEMORY_HARNESS: harness } : {}),
    ECC_MEMORY_ALLOW_USER_SCOPE: allowUser ? '1' : '0',
  } };
}
function run(script, args, input, options) {
  return spawnSync(process.execPath, [path.join(repo, script), ...args], {
    ...options, input, encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024,
  });
}
function cli(args, input = '', partition = 'alpha') {
  const result = run('scripts/memory.js', [...args, '--json'], input, envFor(partition));
  assert.equal(result.status, 0, 'Synthetic CLI operation failed; raw output withheld');
  return JSON.parse(result.stdout);
}
function mcp(harness, calls, partition = 'alpha', allowUser = false) {
  const frames = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'ecc-lane-conformance', version: '1.0.0' },
    } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    ...calls.map(([name, args], index) => ({ jsonrpc: '2.0', id: index + 2,
      method: 'tools/call', params: { name, arguments: args } })),
  ];
  const result = run('scripts/memory-mcp.mjs', [],
    frames.map(frame => JSON.stringify(frame)).join('\n') + '\n', envFor(partition, harness, allowUser));
  assert.equal(result.status, 0, 'Synthetic MCP process failed; raw output withheld');
  const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(responses.length, calls.length + 1, 'Missing or extra MCP response');
  assert.equal(responses[0].result.protocolVersion, '2025-11-25');
  return calls.map((_, index) => {
    const response = responses.find(item => item.id === index + 2);
    assert.ok(response, 'Missing correlated MCP response');
    return response;
  });
}
function payload(response) {
  assert.equal(response.error, undefined, 'Unexpected JSON-RPC error');
  assert.notEqual(response.result.isError, true, 'Unexpected tool rejection');
  return JSON.parse(response.result.content.find(item => item.type === 'text').text);
}
function check(name, fn) { fn(); checks.push({ name, passed: true }); }
function save(title, scope = 'project', target = 'all', partition = 'alpha', body = 'Synthetic orbit evidence.') {
  return cli(['save', '--title', title, '--scope', scope, '--source-harness', 'codex',
    '--target', target, '--stdin'], body, partition).memory;
}

try {
  const sourceText = 'Synthetic fixture only: orbit project uses scoped memory.';
  // Kept separately from recalled content; memory cannot supply its own source catalog.
  const sources = new Map([['fixture:orbit', Object.freeze({ workspace: 'alpha', scope: 'project', text: sourceText,
    observedAt: startedAt, sessionId: 'fixture-session', checkpointId: 'fixture-checkpoint' })]]);
  const evidenceContext = { workspace: 'alpha', scope: 'project' };
  const body = encodeEvidence('fixture:orbit', sources, evidenceContext);
  const shared = save('orbit shared evidence', 'project', 'all', 'alpha', body);
  const team = save('orbit team context', 'team');
  const targeted = save('orbit codex context', 'project', 'codex');
  const user = save('orbit user context', 'user');
  const other = save('orbit other project', 'project', 'all', 'beta');

  for (const harness of ['codex', 'claude', 'hermes']) {
    const result = mcp(harness, [
      ['memory_search', { query: 'orbit' }],
      ['memory_read', { id: shared.id }],
      ['memory_read', { id: targeted.id }],
      ['memory_search', { query: 'orbit', scopes: ['user'] }],
      ['memory_save', { title: 'spoof', body: 'Synthetic', sourceHarness: 'other' }],
      ['memory_search', { query: 'orbit', targetHarness: 'codex' }],
      ['memory_save', { title: 'trusted', body: 'Synthetic', trust: 'verified' }],
      ['memory_read', { id: user.id, scope: 'user' }],
      ['memory_save', { title: 'user write', body: 'Synthetic', scope: 'user' }],
    ]);
    check(`${harness}: CLI/MCP ordered search parity`, () => {
      const expected = cli(['search', 'orbit', '--target-harness', harness]);
      assert.deepEqual(payload(result[0]).results, expected.results.map(({ memory, score, excerpt }) => ({ memory, score, excerpt })));
      const ids = payload(result[0]).results.map(item => item.memory.id);
      assert.ok(ids.includes(shared.id) && ids.includes(team.id));
      assert.equal(ids.includes(targeted.id), harness === 'codex');
      assert.ok(!ids.includes(user.id) && !ids.includes(other.id));
    });
    check(`${harness}: read preserves provenance and unreviewed trust`, () => {
      const read = payload(result[1]).memory;
      assert.equal(read.body, body);
      for (const field of ['id', 'scope', 'sourceHarness', 'targetHarnesses', 'createdAt', 'updatedAt', 'trust']) {
        assert.deepEqual(read[field], shared[field]);
      }
      assert.equal(read.trust, 'unreviewed');
      const cliRead = cli(['read', shared.id]).memory;
      assert.deepEqual(verifyEvidence(read.body, sources, { workspace: 'alpha', scope: read.scope }),
        verifyEvidence(cliRead.body, sources, { workspace: 'alpha', scope: cliRead.scope }));
    });
    check(`${harness}: direct target visibility enforced by MCP`, () => {
      if (harness === 'codex') assert.equal(payload(result[2]).memory.id, targeted.id);
      else assert.equal(result[2].result.isError, true);
    });
    check(`${harness}: scope elevation, identity spoofing and trust promotion rejected`, () => {
      for (const response of result.slice(3)) assert.equal(response.error?.code, -32602);
    });
    check(`${harness}: query reproducible across process restart`, () => {
      assert.deepEqual(payload(mcp(harness, [['memory_search', { query: 'orbit' }]])[0]), payload(result[0]));
    });
  }
  check('MCP write identity and evidence survive CLI handoff read', () => {
    sources.set('fixture:handoff', Object.freeze({ workspace: 'alpha', scope: 'project', text: 'Synthetic handoff.',
      observedAt: startedAt, sessionId: 'fixture-hermes-session', checkpointId: 'fixture-handoff' }));
    const handoffBody = encodeEvidence('fixture:handoff', sources, evidenceContext);
    const saved = payload(mcp('hermes', [['memory_save', { title: 'handoff fixture', body: handoffBody,
      kind: 'handoff', targetHarnesses: ['codex'], links: [shared.id] }]])[0]).memory;
    assert.equal(saved.sourceHarness, 'hermes');
    assert.equal(saved.trust, 'unreviewed');
    const read = payload(mcp('codex', [['memory_read', { id: saved.id }]])[0]).memory;
    assert.deepEqual(read.links, [shared.id]);
    const cliRead = cli(['read', saved.id]).memory;
    assert.equal(cliRead.body, handoffBody);
    assert.equal(cliRead.sourceHarness, 'hermes');
    assert.equal(cliRead.trust, 'unreviewed');
    assert.deepEqual(verifyEvidence(cliRead.body, sources, { workspace: 'alpha', scope: cliRead.scope }),
      verifyEvidence(read.body, sources, { workspace: 'alpha', scope: read.scope }));
  });
  check('operator opt-in enables only explicit user recall', () => {
    const result = mcp('hermes', [['memory_search', { query: 'orbit', scopes: ['user'] }],
      ['memory_search', { query: 'orbit' }]], 'alpha', true);
    assert.deepEqual(payload(result[0]).results.map(item => item.memory.id), [user.id]);
    assert.ok(!payload(result[1]).results.some(item => item.memory.id === user.id));
  });
  check('separate project root excludes alpha records', () => {
    const read = mcp('hermes', [['memory_search', { query: 'orbit' }], ['memory_read', { id: shared.id }]], 'beta');
    assert.deepEqual(payload(read[0]).results.map(item => item.memory.id), [other.id]);
    assert.equal(read[1].result.isError, true);
  });
  check('CLI direct read is operator access, not target authorization', () => {
    assert.equal(cli(['read', targeted.id]).memory.id, targeted.id);
  });
  check('missing configured identity prevents MCP startup', () => {
    const result = run('scripts/memory-mcp.mjs', [], '', envFor('alpha', null));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ECC_MEMORY_HARNESS/);
  });
  check('recalled evidence rejects tamper, unavailable source and foreign context', () => {
    const read = payload(mcp('codex', [['memory_read', { id: shared.id }]])[0]).memory;
    const altered = JSON.stringify({ ...JSON.parse(read.body), text: 'Synthetic altered evidence.' });
    assert.throws(() => verifyEvidence(altered, sources, evidenceContext), { code: 'SOURCE_MISMATCH' });
    assert.throws(() => verifyEvidence(read.body, new Map(), evidenceContext), { code: 'SOURCE_UNAVAILABLE' });
    assert.throws(() => verifyEvidence(read.body, sources, { ...evidenceContext, workspace: 'beta' }),
      { code: 'CONTEXT_MISMATCH' });
    assert.throws(() => verifyEvidence(read.body, sources, { ...evidenceContext, scope: 'user' }),
      { code: 'CONTEXT_MISMATCH' });
  });
  check('stored altered content and digest fail evidence verification after MCP recall', () => {
    for (const change of [{ text: 'Synthetic altered content.' }, { sha256: '0'.repeat(64) }]) {
      const altered = JSON.stringify({ ...JSON.parse(body), ...change });
      const saved = save('evidence rejection fixture', 'project', 'all', 'alpha', altered);
      const read = payload(mcp('hermes', [['memory_read', { id: saved.id }]])[0]).memory;
      assert.equal(read.id, saved.id);
      assert.equal(read.body, altered);
      assert.equal(read.trust, 'unreviewed');
      assert.throws(() => verifyEvidence(read.body, sources, { workspace: 'alpha', scope: read.scope }),
        { code: 'SOURCE_MISMATCH' });
    }
  });
  check('synthetic private-key marker rejected without changing recalled dataset', () => {
    // Deliberately incomplete synthetic marker; never a real key or private input.
    const marker = '-----BEGIN PRIVATE KEY-----\nSynthetic non-key fixture.';
    const beforePrivacy = cli(['search', 'orbit', '--target-harness', 'codex']).results;
    const cliDenied = run('scripts/memory.js', ['save', '--title', 'orbit rejected fixture', '--stdin', '--json'],
      marker, envFor());
    assert.equal(cliDenied.status, 1, 'Synthetic sensitive write must be rejected');
    assert.equal(cliDenied.error, undefined, 'CLI rejection must not be a subprocess failure');
    assert.match(cliDenied.stderr, /suspected secret/i);
    const mcpDenied = mcp('codex', [['memory_save', { title: 'orbit rejected fixture', body: marker }]])[0];
    assert.equal(mcpDenied.result.isError, true, 'Synthetic sensitive write must be a tool rejection');
    const rejection = JSON.parse(mcpDenied.result.content.find(item => item.type === 'text').text);
    assert.equal(rejection.error.code, 'MEMORY_WRITE_REJECTED');
    assert.equal(rejection.error.message, 'Memory operation rejected a suspected secret.');
    assert.deepEqual(cli(['search', 'orbit', '--target-harness', 'codex']).results, beforePrivacy);
    assert.deepEqual(payload(mcp('codex', [['memory_search', { query: 'orbit' }]])[0]).results, beforePrivacy);
  });
  check('source files and HEAD unchanged after execution', () => {
    assert.deepEqual(snapshot(), before);
    assert.equal(sourceHead(), headBefore);
  });
  process.stdout.write(JSON.stringify({ schemaVersion: 'ecc.memory.conformance.receipt.v1',
    status: 'passed', startedAt, completedAt: new Date().toISOString(), nodeVersion: process.version,
    source: { head: headBefore, files: before,
      executionMode: 'local source files with existing dependencies; no fetch performed',
      identityBoundary: 'File digests identify executed source; HEAD alone does not establish a clean tree.' },
    exampleSha256: sha256(fs.readFileSync(__filename)), checks,
    evidenceBoundary: 'Synthetic real CLI/stdio execution. No live harness, Graphiti, OAuth, replication or deployment verification.',
  }, null, 2) + '\n');
} catch (error) {
  // Never print raw process output or assertion values into the receipt.
  process.stderr.write(JSON.stringify({ status: 'failed', passedChecks: checks.map(item => item.name),
    errorType: error.name, message: 'Conformance failed after the listed checks; inspect the next synthetic operation.' }) + '\n');
  process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
