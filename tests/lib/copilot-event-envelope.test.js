'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseEventEnvelope, normalizeInput, translateHookOutput, aggregateHookOutputs } = require('../../scripts/lib/copilot-event-envelope');
let passed = 0;
let failed = 0;
function test(name, action) {
  try { action(); passed++; console.log(`  PASS ${name}`); }
  catch (error) { failed++; console.error(`  FAIL ${name}: ${error.message}`); }
}
const payload = { cwd: process.cwd(), sessionId: 's1', toolName: 'edit', toolArgs: { path: 'demo.ts' } };
test('legacy normalization preserves the established adapter shape and input', () => {
  const snapshot = JSON.stringify(payload);
  const result = normalizeInput('postToolUse', payload);
  assert.strictEqual(result.tool_name, 'Edit');
  assert.strictEqual(result.tool_input.file_path, path.join(process.cwd(), 'demo.ts'));
  assert.strictEqual(result.hook_event_name, 'PostToolUse');
  assert.strictEqual(JSON.stringify(payload), snapshot);
});
test('versioned envelope keeps absent identities and outcomes unknown', () => {
  const result = parseEventEnvelope('postToolUse', payload);
  assert.strictEqual(result.schemaVersion, 1);
  assert.strictEqual(result.callId, null);
  assert.strictEqual(result.turnId, null);
  assert.strictEqual(result.outcome.status, 'unknown');
  assert.strictEqual(result.workspace.canonical, fs.realpathSync(process.cwd()));
  assert.strictEqual(result.tool.nativeName, 'edit');
});
test('pre-tool arguments cannot assert a completed action', () => {
  assert.strictEqual(parseEventEnvelope('preToolUse', { ...payload, toolResult: { success: true } }).outcome.status, 'not-run');
});
test('explicit post result distinguishes success and failure without inferring from output text', () => {
  for (const [toolResult, expected] of [[{ success: true }, 'succeeded'], [{ success: false }, 'failed'], [{ exitCode: 0 }, 'succeeded'], [{ exitCode: 1 }, 'failed'], [{ content: 'success' }, 'unknown']]) {
    assert.strictEqual(parseEventEnvelope('postToolUse', { ...payload, toolResult }).outcome.status, expected);
  }
});
test('conflicting outcome fields are unknown and contradictory aliases reject', () => {
  assert.strictEqual(parseEventEnvelope('postToolUse', { ...payload, toolResult: { success: true, exitCode: 2 } }).outcome.status, 'unknown');
  for (const extra of [{ session_id: 'foreign' }, { tool_name: 'bash' }, { tool_input: { path: 'other' } }, { toolCallId: 'a', tool_call_id: 'b' }]) {
    assert.throws(() => parseEventEnvelope('postToolUse', { ...payload, ...extra }), /Conflicting/);
  }
});
test('malformed success markers and reported errors never establish success', () => {
  for (const toolResult of [{ success: 'false', exitCode: 0 }, { success: true, exitCode: null },
    { success: true, error: 'failed' }, { exitCode: 0, isError: true }, { success: true, signal: 'SIGTERM' }]) {
    assert.strictEqual(parseEventEnvelope('postToolUse', { ...payload, toolResult }).outcome.status, 'unknown');
  }
  assert.throws(() => normalizeInput('preToolUse', { ...payload, schemaVersion: 2 }), /version/);
});
test('JSON argument aliases compare decoded objects', () => {
  const result = parseEventEnvelope('postToolUse', { ...payload, tool_input: JSON.stringify(payload.toolArgs) });
  assert.strictEqual(result.tool.name, 'Edit');
});
test('lifecycle semantics remain distinct and tool fields are not executed', () => {
  for (const event of ['agentStop', 'preCompact', 'sessionStart', 'sessionEnd', 'userPromptSubmitted']) {
    const result = parseEventEnvelope(event, { cwd: process.cwd(), toolName: 'bash', toolArgs: { command: 'never run' } });
    assert.strictEqual(result.event, event);
    assert.strictEqual(result.tool, null);
    assert.strictEqual(result.outcome.status, 'not-applicable');
  }
});
test('unknown tools keep their name and unknown events fail explicitly', () => {
  assert.strictEqual(parseEventEnvelope('postToolUse', { ...payload, toolName: 'vendor/custom' }).tool.name, 'vendor/custom');
  assert.throws(() => parseEventEnvelope('made-up', payload));
});
test('identity does not deduplicate identical calls or invent call IDs', () => {
  const first = parseEventEnvelope('postToolUse', { ...payload, toolCallId: 'call1' });
  const second = parseEventEnvelope('postToolUse', { ...payload, toolCallId: 'call2' });
  assert.notStrictEqual(first.callId, second.callId);
  assert.strictEqual(parseEventEnvelope('postToolUse', payload).callId, null);
});
test('malformed, oversized and future envelope versions reject', () => {
  for (const value of [null, [], 'bad', { ...payload, schemaVersion: 2 }, { ...payload, toolArgs: '{' }, { ...payload, sessionId: {} }, { ...payload, extra: 'a'.repeat(1024 * 1024) }]) {
    assert.throws(() => parseEventEnvelope('postToolUse', value));
  }
});
test('hook output rejects malformed permission objects and unknown status', () => {
  for (const result of [{ status: null }, { status: null, exitCode: 0 }, { status: 1 }, { signal: 'SIGTERM', status: 0 }, { error: new Error('timeout'), status: 0 }, { status: 0, stdout: '{' }, { status: 0, stdout: '{"hookSpecificOutput":[]}' }, { status: 0, stdout: '{"hookSpecificOutput":{"permissionDecision":"garbled"}}' }]) {
    assert.strictEqual(translateHookOutput('preToolUse', result).permissionDecision, 'deny');
  }
  assert.deepStrictEqual(translateHookOutput('postToolUse', { status: 1, stdout: '{' }), {});
  const malformedReason = translateHookOutput('preToolUse', { status: 0,
    stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: { bad: 'shape' } } }) });
  assert.equal(malformedReason.permissionDecision, 'deny');
  assert.equal(typeof malformedReason.permissionDecisionReason, 'string');
});
test('deny has priority across multiple policies and post events never grant permissions', () => {
  const outputs = [{ permissionDecision: 'allow' }, { permissionDecision: 'deny', permissionDecisionReason: 'blocked' }, { additionalContext: 'check' }];
  assert.strictEqual(aggregateHookOutputs('preToolUse', outputs).permissionDecision, 'deny');
  assert.deepStrictEqual(aggregateHookOutputs('postToolUse', outputs), { additionalContext: 'check' });
});
test('envelope runtime executes from a copied directory without the source checkout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-envelope-'));
  try {
    fs.copyFileSync(path.resolve(__dirname, '../../scripts/lib/copilot-event-envelope.js'), path.join(root, 'envelope.js'));
    const result = spawnSync(process.execPath, ['-e', "const e=require('./envelope'); console.log(e.parseEventEnvelope('agentStop',{cwd:process.cwd()}).event)"], { cwd: root, encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout.trim(), 'agentStop');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('documented native resultType and failure events retain actual outcomes', () => {
  const base = { cwd: process.cwd(), sessionId: 'native', toolName: 'edit', toolArgs: { path: 'file.ts' } };
  assert.equal(parseEventEnvelope('postToolUse', { ...base, toolResult: { resultType: 'success', textResultForLlm: 'private' } }).outcome.status, 'succeeded');
  assert.equal(parseEventEnvelope('postToolUse', { ...base, toolResult: { result_type: 'success' } }).outcome.status, 'succeeded');
  assert.equal(parseEventEnvelope('postToolUse', { ...base, toolResult: { resultType: 'success', success: false } }).outcome.status, 'unknown');
  assert.equal(parseEventEnvelope('postToolUse', { ...base, toolResult: { resultType: 'future' } }).outcome.status, 'unknown');
  assert.throws(() => parseEventEnvelope('postToolUse', { ...base, toolResult: { resultType: 'success', result_type: 'failure' } }));
  const failed = parseEventEnvelope('postToolUseFailure', { ...base, error: 'private error' });
  assert.equal(failed.tool.name, 'Edit');
  assert.equal(failed.outcome.status, 'failed');
});
console.log(`\nPassed: ${passed}\nFailed: ${failed}`);
process.exitCode = failed ? 1 : 0;
