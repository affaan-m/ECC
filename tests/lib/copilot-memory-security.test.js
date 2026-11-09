'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const memory = require('../../scripts/lib/copilot-memory');
const sessions = require('../../scripts/lib/copilot-sessions');
let passed = 0;
function test(name, action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-review-'));
  const cwd = path.join(root, 'project'); fs.mkdirSync(cwd);
  const env = { ...process.env, COPILOT_HOME: path.join(root, 'copilot'), ECC_COPILOT_MEMORY_RUNTIME: path.join(root, 'runtime') };
  try { action(cwd, env, root); passed++; console.log(`PASS ${name}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('review digest cannot substitute for a manual checkpoint or changed checkpoint body', (cwd, env) => {
  const fabricated = { schema: 'ecc.copilot.handoff-proposal.v1', workspace: fs.realpathSync(cwd), sessionId: 'one',
    checkpointUpdatedAt: new Date().toISOString(), sourceHarness: 'copilot', target: 'codex', scope: 'project', title: 'Continue', body: 'Made up provenance.' };
  assert.throws(() => memory.saveHandoff(cwd, fabricated, { reviewedSha256: memory.proposalDigest(fabricated) }, env), /checkpoint/i);
  sessions.checkpoint(cwd, 'one', 'Continue original work.', env);
  const proposal = memory.proposeHandoff(cwd, { sessionId: 'one', target: 'codex', title: 'Continue' }, env);
  sessions.checkpoint(cwd, 'one', 'New checkpoint body.', env);
  assert.throws(() => memory.saveHandoff(cwd, proposal, { reviewedSha256: memory.proposalDigest(proposal) }, env), /checkpoint/i);
});
test('malformed or unsupported write response keeps an unknown write outcome', (cwd, env) => {
  const runtime = env.ECC_COPILOT_MEMORY_RUNTIME;
  fs.mkdirSync(path.join(runtime, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ name: 'ecc-universal', version: 'fixture' }));
  for (const stdout of ['{malformed', JSON.stringify({ schemaVersion: 'future' }), JSON.stringify({ schemaVersion: 'ecc.memory.write.v1', memory: null })]) {
    fs.writeFileSync(path.join(runtime, 'scripts/memory.js'), `process.stdout.write(${JSON.stringify(stdout)});`);
    assert.throws(() => memory.invokeMemory(cwd, ['handoff', '--json'], env, 'body'), error => error.code === 'ECC_COPILOT_MEMORY_OUTCOME_UNKNOWN');
  }
});
test('a nonzero handoff can have written and therefore retains unknown outcome', (cwd, env, root) => {
  const runtime = env.ECC_COPILOT_MEMORY_RUNTIME;
  fs.mkdirSync(path.join(runtime, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ name: 'ecc-universal', version: 'fixture' }));
  const sentinel = path.join(root, 'write-occurred');
  fs.writeFileSync(path.join(runtime, 'scripts/memory.js'), `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'written'); process.exit(1);`);
  assert.throws(() => memory.invokeMemory(cwd, ['handoff', '--json'], env, 'body'), error => error.code === 'ECC_COPILOT_MEMORY_OUTCOME_UNKNOWN');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'written');
});
console.log(`${passed} passed, 0 failed`);
