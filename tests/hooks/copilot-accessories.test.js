'use strict';
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { notify, notifyLifecycle } = require('../../scripts/lib/copilot-accessories');
let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
const enabled = { ECC_COPILOT_NOTIFICATIONS: '1', ECC_HOOK_PROFILE: 'standard' };
test('notifications are opt-in and only respond to the completion event', () => {
  const runner = () => { throw new Error('must not execute'); };
  assert.equal(notify('agentStop', {}, { runner }).status, 'disabled');
  assert.equal(notify('postToolUse', enabled, { runner }).status, 'not-applicable');
  assert.equal(notify('agentStop', { ...enabled, ECC_HOOKS_ENABLED: 'false' }, { runner }).status, 'disabled');
  assert.equal(notify('agentStop', { ...enabled, ECC_DISABLED_HOOKS: 'stop:desktop-notify' }, { runner }).status, 'disabled');
  assert.equal(notify('agentStop', { ...enabled, ECC_HOOK_PROFILE: 'minimal' }, { runner }).status, 'disabled');
});
test('OS providers use fixed argv, generic text, no shell and bounded execution', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    let captured;
    const env = { ...enabled, DISPLAY: ':0', SystemRoot: 'C:\\Windows', SECRET_TOKEN: 'private' };
    const result = notify('agentStop', env, { platform, runner: (...args) => { captured = args; return { status: 0 }; } });
    assert.equal(result.status, 'sent');
    const [command, args, options] = captured;
    assert(command.includes(platform === 'darwin' ? 'osascript' : platform === 'win32' ? 'powershell.exe' : 'notify-send'));
    assert.equal(options.shell, false); assert(options.timeout <= 1000);
    assert.equal(options.stdio, 'ignore'); assert(!Object.hasOwn(options.env, 'SECRET_TOKEN'));
    assert(args.join(' ').includes('Response completed'));
    assert(!JSON.stringify(captured).includes('private'));
    assert(!JSON.stringify(result).includes('Response completed'));
  }
});
test('GUI absence, process errors, exit failure and timeout are advisory only', () => {
  assert.equal(notify('agentStop', enabled, { platform: 'linux' }).status, 'unavailable');
  assert.equal(notify('agentStop', enabled, { platform: 'freebsd' }).status, 'unavailable');
  for (const result of [{ status: 1 }, { error: { code: 'ENOENT' } }, { error: { code: 'ETIMEDOUT' } }]) {
    const output = notify('agentStop', enabled, { platform: 'darwin', runner: () => result });
    assert.equal(output.exitCode, 0); assert(['failed', 'unavailable', 'timeout'].includes(output.status));
  }
  assert.equal(notify('agentStop', enabled, { platform: 'darwin', runner: () => { throw new Error('private secret'); } }).status, 'failed');
});
test('payload text and provider overrides are never accepted by the hook', () => {
  const hook = path.resolve(__dirname, '../../scripts/hooks/copilot-accessories.js');
  const result = spawnSync(process.execPath, [hook, 'postToolUse'], {
    input: JSON.stringify({ event: 'agentStop', last_assistant_message: 'TOKEN=private', command: 'evil-program' }),
    env: { ...process.env, ECC_COPILOT_NOTIFICATIONS: '1' }, encoding: 'utf8', timeout: 3000,
  });
  assert.equal(result.status, 0); assert.deepStrictEqual(JSON.parse(result.stdout), {});
  assert(!result.stdout.includes('private')); assert(!result.stderr.includes('private'));
});

function journalFixture(run) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-accessories-'));
  try {
    const cwd = fs.realpathSync(home);
    const directory = path.join(cwd, 'session-state', 'fixture');
    fs.mkdirSync(directory, { recursive: true });
    const transcriptPath = path.join(directory, 'events.jsonl');
    const timestamp = Date.parse('2026-01-01T12:00:00.000Z');
    const hook = { sessionId: 'fixture', cwd, timestamp, transcriptPath };
    const env = { ...enabled, ECC_COPILOT_COMPACT_SUGGESTIONS: '1', COPILOT_HOME: cwd };
    function write(events) {
      fs.writeFileSync(transcriptPath, [{ type: 'session.start', data: { sessionId: 'fixture', context: { cwd } } }, ...events]
        .map(event => JSON.stringify(event)).join('\n') + '\n');
    }
    function notice(payload = hook, overrides = {}) {
      const calls = [];
      const result = notifyLifecycle('agentStop', payload, { ...env, ...overrides }, { platform: 'darwin',
        runner: (...args) => { calls.push(args); return { status: 0 }; } });
      assert.equal(result.status, 'sent'); assert.equal(calls.length, 1);
      const message = calls[0][1].join(' ');
      assert(!message.includes('private'));
      return message.includes('consider /compact');
    }
    run({ write, hook, notice });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

const turn = (turnId, timestamp = '2026-01-01T11:59:00.000Z') => ({ type: 'assistant.turn_start', timestamp, data: { turnId } });
const call = (toolCallId, extra = {}) => ({ type: 'tool.execution_complete', timestamp: '2026-01-01T11:59:10.000Z',
  data: { toolCallId, success: true, result: { content: 'private text' } }, ...extra });
const calls = (length, start = 0) => Array.from({ length }, (_, index) => call(`call-${start + index}`));

test('compact suggestions require a new turn crossing a call-count threshold', () => journalFixture(({ write, notice }) => {
  write([turn('1'), ...calls(49), turn('2', '2026-01-01T11:59:11.000Z'), call('call-49', { timestamp: '2026-01-01T11:59:12.000Z' })]);
  assert(notice());
  assert(!notice(undefined, { ECC_COPILOT_COMPACT_SUGGESTIONS: '0' }));
  assert(!notice(undefined, { ECC_DISABLED_HOOKS: 'pre:edit-write:suggest-compact' }));
  write([turn('1'), ...calls(50), turn('2', '2026-01-01T11:59:11.000Z'), call('call-50', { timestamp: '2026-01-01T11:59:12.000Z' })]);
  assert(!notice());
  write([turn('1'), ...calls(74), turn('2'), call('call-74')]);
  assert(notice());
}));

test('compact suggestion ignores duplicates, subagents, future events and completed compaction', () => journalFixture(({ write, notice }) => {
  write([turn('1'), ...calls(49), call('call-0'), call('sub-agent', { agentId: 'sub' }),
    call('future', { timestamp: '2026-01-01T12:00:01.000Z' }), call('unknown', { data: { toolCallId: 'unknown' } })]);
  assert(!notice());
  write([turn('1'), ...calls(49), { type: 'session.compaction_start', timestamp: '2026-01-01T11:59:11.000Z', data: {} },
    { type: 'session.compaction_complete', timestamp: '2026-01-01T11:59:12.000Z', data: { success: true } },
    call('after-compact', { timestamp: '2026-01-01T11:59:13.000Z' })]);
  assert(!notice());
}));

test('compact suggestion requires matching session provenance and stops during compaction or forced continuation', () => journalFixture(({ write, hook, notice }) => {
  write([turn('1'), ...calls(50)]);
  assert(!notice({ ...hook, transcriptPath: path.join(hook.cwd, 'foreign.jsonl') }));
  assert(!notice({ ...hook, sessionId: 'other-session' }));
  assert(!notice({ ...hook, stop_hook_active: true }));
  write([turn('1'), ...calls(50), { type: 'session.compaction_start', timestamp: '2026-01-01T11:59:20.000Z', data: {} }]);
  assert(!notice());
}));

test('compaction failure preserves the count and replayed completions do not refill a new epoch', () => journalFixture(({ write, notice }) => {
  const compact = [{ type: 'session.compaction_start', timestamp: '2026-01-01T11:59:11.000Z', data: {} },
    { type: 'session.compaction_complete', timestamp: '2026-01-01T11:59:12.000Z', data: { success: false } }];
  const after = { timestamp: '2026-01-01T11:59:13.000Z' };
  write([turn('1'), ...calls(49), ...compact, call('after-compact', after)]);
  assert(notice());
  write([turn('1'), ...calls(49), compact[0], { ...compact[1], data: { success: true } },
    ...calls(49, 49).map(event => ({ ...event, ...after })), call('call-0', after)]);
  assert(!notice());
}));
console.log(`Passed: ${passed}\nFailed: ${failed}`); process.exitCode = failed ? 1 : 0;
