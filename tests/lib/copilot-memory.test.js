'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const sessions = require('../../scripts/lib/copilot-sessions');
const { memoryDoctor, proposeHandoff, saveHandoff, proposalDigest, invokeMemory } = require('../../scripts/lib/copilot-memory');
let passed = 0;
let failed = 0;
function test(name, action) {
  try { action(); passed++; console.log(`  PASS ${name}`); }
  catch (error) { failed++; console.error(`  FAIL ${name}: ${error.stack}`); }
}
function fixture(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-memory-'));
  const workspace = path.join(root, 'project'); fs.mkdirSync(workspace);
  const env = { ...process.env, COPILOT_HOME: path.join(root, 'copilot'), ECC_MEMORY_USER_ROOT: path.join(root, 'user'), ECC_COPILOT_MEMORY_RUNTIME: path.resolve(__dirname, '../..') };
  try { action(workspace, env, root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('doctor diagnoses missing runtime without installing or creating a vault', () => fixture((workspace, env, root) => {
  const result = memoryDoctor(workspace, { ...env, ECC_COPILOT_MEMORY_RUNTIME: path.join(root, 'missing') });
  assert.strictEqual(result.runtime.available, false);
  assert.strictEqual(result.status, 'unavailable');
  assert.ok(!fs.existsSync(path.join(workspace, '.ecc')));
}));
test('proposal requires explicit manual checkpoint and never imports native transcript', () => fixture((workspace, env) => {
  assert.throws(() => proposeHandoff(workspace, { sessionId: 'a', title: 'Continue', target: 'codex' }, env), /checkpoint/);
  sessions.checkpoint(workspace, 'a', 'Tests passed; release pending.', env);
  const proposal = proposeHandoff(workspace, { sessionId: 'a', title: 'Continue', target: 'codex' }, env);
  assert.strictEqual(proposal.body, 'Tests passed; release pending.');
  assert.strictEqual(proposal.sourceHarness, 'copilot');
  assert.strictEqual(proposal.scope, 'project');
  assert.ok(!fs.existsSync(path.join(workspace, '.ecc')));
  const dir = sessions.projectDirectory(workspace, env);
  const stateFile = path.join(dir, fs.readdirSync(dir).find(name => name.endsWith('.json')));
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  fs.writeFileSync(stateFile, JSON.stringify({ ...state, summarySource: 'native-events' }));
  assert.throws(() => proposeHandoff(workspace, { sessionId: 'a', title: 'Continue', target: 'codex' }, env), /manual checkpoint/);
}));
test('save requires reviewed digest and rejects changed proposal or workspace', () => fixture((workspace, env) => {
  sessions.checkpoint(workspace, 'a', 'Continue with integration tests.', env);
  const proposal = proposeHandoff(workspace, { sessionId: 'a', title: 'Continue', target: 'codex' }, env);
  assert.throws(() => saveHandoff(workspace, proposal, {}, env), /review/);
  assert.throws(() => saveHandoff(workspace, { ...proposal, body: 'Changed' }, { reviewedSha256: proposalDigest(proposal) }, env), /review/);
  assert.throws(() => saveHandoff(workspace, { ...proposal, workspace: path.dirname(workspace) }, { reviewedSha256: proposalDigest(proposal) }, env));
}));
test('canonical runtime saves unreviewed handoff and target search filters it', () => fixture((workspace, env) => {
  sessions.checkpoint(workspace, 'a', 'Continue with integration tests.', env);
  const proposal = proposeHandoff(workspace, { sessionId: 'a', title: 'Continue', target: 'codex' }, env);
  const saved = saveHandoff(workspace, proposal, { reviewedSha256: proposalDigest(proposal) }, env);
  assert.strictEqual(saved.memory.kind, 'handoff');
  assert.strictEqual(saved.memory.trust, 'unreviewed');
  assert.strictEqual(saved.memory.sourceHarness, 'copilot');
  assert.deepStrictEqual(saved.memory.targetHarnesses, ['codex']);
  assert.strictEqual(fs.readFileSync(path.join(workspace, '.ecc/memory/project/.gitignore'), 'utf8'), '*\n!.gitignore\n');
  const found = invokeMemory(workspace, ['search', 'integration', '--scope', 'project', '--target-harness', 'codex', '--json'], env);
  assert.strictEqual(found.results.length, 1);
  const other = invokeMemory(workspace, ['search', 'integration', '--scope', 'project', '--target-harness', 'claude', '--json'], env);
  assert.strictEqual(other.results.length, 0);
}));
test('user scope is opt-in and secrets are rejected before any write', () => fixture((workspace, env) => {
  sessions.checkpoint(workspace, 'a', 'Continue tests.', env);
  assert.throws(() => proposeHandoff(workspace, { sessionId: 'a', title: 'Continue', target: 'codex', scope: 'user' }, env), /user scope/);
  const proposal = proposeHandoff(workspace, { sessionId: 'a', title: 'Continue', target: 'codex' }, env);
  const secret = { ...proposal, body: 'password=synthetic-super-secret' };
  assert.throws(() => saveHandoff(workspace, secret, { reviewedSha256: proposalDigest(secret) }, env), /secret/);
  assert.ok(!fs.existsSync(path.join(workspace, '.ecc')));
}));
test('doctor preserves incomplete diagnostics separately from empty memory', () => fixture((workspace, env) => {
  const first = memoryDoctor(workspace, env);
  assert.strictEqual(first.runtime.available, true);
  assert.strictEqual(first.report.ok, true);
  const directory = path.join(workspace, '.ecc/memory/team/notes');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'bad.md'), 'not a memory');
  const second = memoryDoctor(workspace, env);
  assert.strictEqual(second.report.ok, false);
  assert.notStrictEqual(second.status, 'empty');
}));
test('CLI proposal output can be reviewed and saved without importing unrelated state', () => fixture((workspace, env, root) => {
  sessions.checkpoint(workspace, 'a', 'Finish the fixture workflow.', env);
  const script = path.resolve(__dirname, '../../scripts/copilot-memory.js');
  const execute = args => spawnSync(process.execPath, [script, ...args], { cwd: workspace, env, encoding: 'utf8', timeout: 20000 });
  const preview = execute(['propose', '--session', 'a', '--title', 'Continue', '--target', 'codex']);
  assert.strictEqual(preview.status, 0, preview.stderr);
  const document = JSON.parse(preview.stdout);
  assert.strictEqual(document.saved, false);
  const file = path.join(root, 'proposal.json'); fs.writeFileSync(file, preview.stdout);
  const save = execute(['save', '--proposal', file, '--reviewed-sha256', document.reviewSha256]);
  assert.strictEqual(save.status, 0, save.stderr);
  const saved = JSON.parse(save.stdout);
  const read = execute(['read', saved.memory.id]);
  assert.notStrictEqual(read.status, 0, 'Copilot cannot recall a codex-only handoff');
  assert.ok(!read.stdout.includes('Finish the fixture workflow'));
}));
console.log(`\nPassed: ${passed}\nFailed: ${failed}`);
process.exitCode = failed ? 1 : 0;
