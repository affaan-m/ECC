'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sink = require('../../scripts/lib/copilot-observations');
const { parseEventEnvelope } = require('../../scripts/lib/copilot-event-envelope');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
let passed = 0;
function test(name, action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observation-fault-'));
  const env = { COPILOT_HOME: path.join(root, 'home'), ECC_COPILOT_OBSERVE: '1' };
  const event = id => parseEventEnvelope('postToolUse', { cwd: root, sessionId: 'fault-test', toolCallId: id,
    toolName: 'bash', toolArgs: { command: 'password=DO_NOT_CAPTURE' },
    toolResult: { resultType: 'success', textResultForLlm: 'PRIVATE_OUTPUT' } });
  try { sink.observe(event('initial'), env); action({ root, env, event, file: sink.observationFile(root, env) });
    passed++; console.log(`PASS ${name}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
for (const operation of ['writeFileSync', 'renameSync']) {
  test(`${operation} failure preserves prior records and releases lock without plaintext`, ({ env, event, file }) => {
    const previous = fs.readFileSync(file, 'utf8');
    const original = fs[operation];
    fs[operation] = function (...args) {
      if (operation === 'writeFileSync' ? typeof args[0] === 'number' : args[1] === file) {
        const error = new Error('synthetic storage fault'); error.code = operation === 'writeFileSync' ? 'ENOSPC' : 'EIO'; throw error;
      }
      return original.apply(this, args);
    };
    try { assert.throws(() => sink.observe(event('interrupted'), env), /synthetic storage fault/); }
    finally { fs[operation] = original; }
    assert.equal(fs.readFileSync(file, 'utf8'), previous);
    assert.ok(!fs.existsSync(`${file}.lock`));
    assert.ok(!fs.readdirSync(path.dirname(file)).some(name => name.endsWith('.tmp')));
    assert.equal(sink.observe(event('recovered'), env).status, 'recorded');
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /DO_NOT_CAPTURE|PRIVATE_OUTPUT/);
  });
}
test('retention and count quotas prune oldest metadata within a successful atomic write', ({ root, env, event, file }) => {
  const row = sink.readObservations(root, env)[0];
  const rows = Array.from({ length: sink.MAX_RECORDS }, (_, index) => ({ ...row, tool_use_id: hash(String(index)) }));
  fs.writeFileSync(file, rows.map(value => JSON.stringify(value)).join('\n') + '\n');
  sink.observe(event('quota-append'), env);
  const retained = sink.readObservations(root, env);
  assert.equal(retained.length, sink.MAX_RECORDS);
  assert.notEqual(retained[0].tool_use_id, rows[0].tool_use_id);
  fs.writeFileSync(file, JSON.stringify({ ...row, timestamp: '2000-01-01T00:00:00.000Z' }) + '\n');
  sink.observe(event('after-expiry'), env);
  assert.equal(sink.readObservations(root, env).length, 1);
});
test('out-of-order pre/post delivery does not assert completion from a pre event', ({ root, env, event }) => {
  const post = event('out-of-order'); sink.observe(post, env);
  sink.observe({ ...post, event: 'preToolUse', outcome: { status: 'not-run', source: null } }, env);
  const rows = sink.readObservations(root, env).filter(row => row.tool_use_id === hash('out-of-order'));
  assert.deepEqual(rows.map(row => [row.event, row.outcome]), [['tool_complete', 'succeeded'], ['tool_start', 'not-run']]);
});
console.log(`Passed: ${passed}, Failed: 0`);
