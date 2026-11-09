'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc comply ')));
const cwd = fs.mkdirSync(path.join(root, 'project'), { recursive: true });
const home = path.join(root, 'home');
const journal = path.join(home, 'session-state', 'fixture', 'events.jsonl');
const env = { ...process.env, COPILOT_HOME: home };
const skill = path.join(cwd, '.github', 'skills', 'skill-comply', 'SKILL.md');
const start = (toolCallId, toolName, args = {}) => ({ type: 'tool.execution_start',
  data: { toolCallId, toolName, arguments: args } });
const complete = (toolCallId, extra = {}) => ({ type: 'tool.execution_complete',
  data: { toolCallId, success: true, ...extra } });
const invocation = { type: 'skill.invoked', data: { name: 'skill-comply', path: skill } };
const edit = [start('edit', 'edit', { path: 'PRIVATE_PATH' }), complete('edit', { fileEdits: [{ kind: 'edit', path: path.join(cwd, 'PRIVATE_PATH') }] })];
const test = [start('test', 'powershell', { command: 'npm test' }), complete('test', { shellExecution: { exitCode: 0 }, result: { content: 'PRIVATE_OUTPUT' } })];
const session = { type: 'session.start', data: { sessionId: 'fixture', context: { cwd } } };

try {
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  const plan = createManifestInstallPlan({ target: 'copilot', includeComponentIds: ['skill:skill-comply'], projectRoot: cwd, homeDir: home, env });
  applyInstallPlan(withHookConsent(plan, 'declined'));
  const read = (events, first = session) => {
    const raw = [first, { type: 'assistant.turn_start', data: { turnId: 'turn' } }, ...events, { type: 'assistant.turn_end', data: { turnId: 'turn' } }].map(event => JSON.stringify(event)).join('\n') + '\n';
    fs.writeFileSync(journal, raw);
    const result = spawnSync(process.execPath, ['.github/ecc/scripts/copilot-skill-comply.js', '--session', 'fixture', '--skill', 'skill-comply'],
      { cwd, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /PRIVATE_PATH|PRIVATE_OUTPUT|npm test/);
    assert.equal(fs.readFileSync(journal, 'utf8'), raw);
    return JSON.parse(result.stdout);
  };
  assert.equal(read([invocation, ...edit, ...test]).status, 'passed');
  assert.equal(read([invocation, ...edit, test[0], complete('test')]).status, 'unknown-test-outcome');
  assert.equal(read([invocation, ...edit, test[0], complete('test', { shellExecution: { exitCode: 1 } })]).status, 'failed');
  assert.equal(read([invocation, ...edit, { ...test[0], data: { ...test[0].data, arguments: { command: 'npm test; echo ok' } } }, test[1]]).status, 'test-not-observed');
  assert.equal(read([invocation, ...test, ...edit]).status, 'test-not-observed');
  assert.equal(read([invocation, edit[0], test[0], edit[1], test[1]]).status, 'test-not-observed');
  assert.equal(read([invocation, ...edit, ...test, start('pending', 'apply_patch')]).status, 'unknown-edit-outcome');
  assert.equal(read([...edit, ...test]).status, 'skill-not-observed');
  assert.equal(read([{ ...invocation, data: { ...invocation.data, trigger: 'context-load' } }, ...edit, ...test]).status, 'skill-not-observed');
  assert.equal(read([invocation, ...edit, ...test, { ...test[1], data: { ...test[1].data, success: false } }]).status, 'unknown-test-outcome');
  assert.equal(read([invocation, ...edit, ...test], { ...session, data: { ...session.data, context: { cwd: root } } }).status, 'journal-unavailable');
  assert.equal(read([invocation, ...edit, test[0], complete('test', { result: {
    contents: [{ type: 'shell_exit', cwd, exitCode: 0 }],
  } })]).status, 'passed');
  assert.equal(read([invocation, ...edit, test[0], complete('test', {
    shellExecution: { exitCode: 0 }, result: { contents: [{ type: 'shell_exit', exitCode: 1 }] },
  })]).status, 'unknown-test-outcome');
  assert.equal(read([invocation, { ...invocation, data: { ...invocation.data, name: 'other' } }, ...edit, ...test]).status, 'ambiguous-skill');
  assert.equal(read([invocation, ...edit, ...test, { type: 'session.snapshot_rewind' }]).status, 'journal-rewound');
  assert.equal(read([invocation, ...edit, { type: 'assistant.turn_end', data: { turnId: 'turn' } },
    { type: 'assistant.turn_start', data: { turnId: 'next' } }, ...test]).status, 'test-not-observed');
  assert.equal(read([invocation, ...edit, ...test, { type: 'abort' }]).status, 'turn-unavailable');
  assert.equal(fs.existsSync(path.join(cwd, '.github', 'hooks', 'ecc.json')), false);
  console.log('Passed: 18, Failed: 0');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
