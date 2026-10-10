'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { proposeTaskContext } = require('../../scripts/lib/context-profile-proposal');
const candidates = [{ id: 'skill:python-patterns', description: 'Python idioms and style.' }];

test('Codex proposal is read-only, bounded, and returns only a listed ID', () => {
  const result = proposeTaskContext({ target: 'codex', query: 'Explain a Python bug', candidates, execute(command, args, options) {
    assert.equal(command, 'codex');
    assert.ok(args.includes('read-only'));
    assert.ok(args.includes('--ephemeral'));
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 30000);
    assert.equal(options.killSignal, 'SIGKILL');
    assert.match(options.input, /Python idioms/);
    return { status: 0, stdout: '{"selectedIds":["skill:python-patterns"]}' };
  } });
  assert.deepEqual(result, ['skill:python-patterns']);
});

test('Claude proposal disables tools and accepts its structured output envelope', () => {
  assert.deepEqual(proposeTaskContext({ target: 'claude', query: 'No workflow', candidates, execute(_command, args) {
    assert.equal(args[args.indexOf('--tools') + 1], '');
    return { status: 0, stdout: '{"structured_output":{"selectedIds":[]}}' };
  } }), []);
});

for (const output of ['not json', '{"selectedIds":["skill:other"]}', '{"selectedIds":["skill:python-patterns","skill:python-patterns"]}',
  '{"selectedIds":[],"permission":"all"}', 'null']) {
  test(`invalid proposal is refused: ${output}`, () => {
    assert.throws(() => proposeTaskContext({ target: 'codex', query: 'Task', candidates,
      execute: () => ({ status: 0, stdout: output }) }), /proposal/i);
  });
}

test('provider failure is refused without reattempt or task execution', () => {
  let calls = 0;
  assert.throws(() => proposeTaskContext({ target: 'codex', query: 'Task', candidates, execute() {
    calls++;
    return { status: 1, stdout: 'private provider details' };
  } }), /proposal/i);
  assert.equal(calls, 1);
});
