'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const evidence = require('../../scripts/lib/copilot-evidence');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-evidence-'));
const workspace = path.join(root, 'project'); fs.mkdirSync(workspace);
const file = path.join(workspace, 'module.js'); fs.writeFileSync(file, 'const x = 1;\n');
const env = { COPILOT_HOME: path.join(root, 'home'), ECC_COPILOT_FACTFORCE: '1' };
let passed = 0;
const native = (time, extra = {}) => ({ cwd: workspace, sessionId: 's1', timestamp: time, ...extra });
const edit = (extra = {}) => ({ cwd: workspace, session_id: 's1', tool_name: 'Edit', tool_input: { file_path: file }, ...extra });
const event = (name, time, extra = {}) => evidence.handleEvent(name, native(time, extra), env, { now: time + 1 });
const read = (start = 200, extra = {}) => {
  event('preToolUse', start, { toolName: 'view', toolArgs: { path: file }, toolCallId: `read-${start}`, ...extra });
  event('postToolUse', start + 1, { toolName: 'view', toolArgs: { path: file }, toolCallId: `read-${start}`,
    toolResult: { resultType: 'success', textResultForLlm: fs.readFileSync(file, 'utf8') }, ...extra });
};
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
try {
  test('disabled mode touches no state', () => {
    assert.equal(evidence.handleEvent('sessionStart', native(100), { COPILOT_HOME: env.COPILOT_HOME }).status, 'disabled');
    assert.equal(fs.existsSync(env.COPILOT_HOME), false);
  });
  test('read proof requires a known lifecycle boundary and matching pre/post read', () => {
    read(); assert.equal(evidence.checkEvidence(edit(), env, { now: 210 }).allowed, false);
    event('sessionStart', 300);
    event('postToolUse', 301, { toolName: 'view', toolArgs: { path: file }, toolResult: { resultType: 'success' } });
    assert.equal(evidence.checkEvidence(edit(), env, { now: 302 }).allowed, false);
    read(400); assert.equal(evidence.checkEvidence(edit(), env, { now: 405 }).allowed, true);
  });
  test('proof is content-bound and read race cannot authorize changed content', () => {
    fs.writeFileSync(file, 'const x = 2;');
    assert.equal(evidence.checkEvidence(edit(), env, { now: 410 }).allowed, false);
    event('preToolUse', 420, { toolName: 'view', toolArgs: { path: file } });
    fs.writeFileSync(file, 'const x = 3;');
    event('postToolUse', 421, { toolName: 'view', toolArgs: { path: file }, toolResult: { resultType: 'success' } });
    assert.equal(evidence.checkEvidence(edit(), env, { now: 422 }).allowed, false);
  });
  test('duplicate completed reads preserve proof while failure invalidates pending proof', () => {
    read(450);
    event('postToolUse', 451, { toolName: 'view', toolArgs: { path: file }, toolCallId: 'read-450', toolResult: { resultType: 'success' } });
    assert.equal(evidence.checkEvidence(edit(), env, { now: 455 }).allowed, true);
    event('preToolUse', 460, { toolName: 'view', toolArgs: { path: file }, toolCallId: 'fail-read' });
    event('postToolUseFailure', 461, { toolName: 'view', toolArgs: { path: file }, toolCallId: 'fail-read', error: 'fixture' });
    event('postToolUse', 462, { toolName: 'view', toolArgs: { path: file }, toolCallId: 'fail-read', toolResult: { resultType: 'success' } });
    assert.equal(evidence.checkEvidence(edit(), env, { now: 465 }).allowed, false);
  });
  test('failed unknown and partial read produce no proof', () => {
    for (const [time, extra] of [[500, { toolResult: { resultType: 'failure' } }], [510, { toolResult: undefined }],
      [520, { toolArgs: { path: file, view_range: [1, 1] } }]]) {
      read(time, extra); assert.equal(evidence.checkEvidence(edit(), env, { now: time + 5 }).allowed, false);
    }
  });
  test('boundaries expiry and replay prevent reuse across turns and sessions', () => {
    read(600);
    assert.equal(evidence.checkEvidence(edit({ session_id: 'other' }), env, { now: 610 }).allowed, false);
    assert.equal(evidence.checkEvidence(edit(), env, { now: 601 + evidence.TTL_MS + 1 }).allowed, false);
    event('agentStop', 700); read(650);
    assert.equal(evidence.checkEvidence(edit(), env, { now: 710 }).allowed, false);
    event('userPromptSubmitted', 800); read(810);
    assert.equal(evidence.checkEvidence(edit(), env, { now: 820 }).allowed, true);
    event('preCompact', 830);
    assert.equal(evidence.checkEvidence(edit(), env, { now: 840 }).allowed, false);
    event('userPromptSubmitted', 850); read(860); event('sessionEnd', 900);
    assert.equal(evidence.checkEvidence(edit(), env, { now: 910 }).allowed, false);
  });
  test('other workspace and batch targets cannot borrow proof', () => {
    event('sessionStart', 1000); read(1010);
    const other = path.join(root, 'other'); fs.mkdirSync(other);
    assert.equal(evidence.checkEvidence(edit({ cwd: other, tool_input: { file_path: path.join(other, 'code.js') } }), env, { now: 1020 }).allowed, true);
    const second = path.join(workspace, 'second.js'); fs.writeFileSync(second, 'x');
    assert.equal(evidence.checkEvidence(edit({ tool_input: { edits: [{ file_path: file }, { file_path: second }] } }), env, { now: 1020 }).allowed, false);
    assert.throws(() => evidence.checkEvidence(edit({ tool_input: { file_path: path.join(root, 'outside.js') } }), env, { now: 1020 }));
  });
  test('linked files and future schemas fail without rewriting private state', () => {
    const link = path.join(workspace, 'linked.js'); fs.linkSync(file, link);
    assert.throws(() => evidence.checkEvidence(edit(), env, { now: 1030 })); fs.unlinkSync(link);
    const state = evidence.stateFile(workspace, 's1', env);
    const previous = fs.readFileSync(state, 'utf8');
    fs.writeFileSync(state, JSON.stringify({ ...JSON.parse(previous), schema: 'future' }));
    assert.throws(() => evidence.checkEvidence(edit(), env, { now: 1040 }));
    assert.equal(JSON.parse(fs.readFileSync(state)).schema, 'future'); fs.writeFileSync(state, previous);
  });
  test('live lock conflict and missing or contradictory identities cannot create proof', () => {
    const state = evidence.stateFile(workspace, 's1', env); fs.mkdirSync(state + '.lock');
    const before = fs.readFileSync(state, 'utf8');
    assert.throws(() => event('userPromptSubmitted', 1100));
    assert.equal(fs.readFileSync(state, 'utf8'), before); fs.rmdirSync(state + '.lock');
    assert.throws(() => evidence.handleEvent('sessionStart', { cwd: workspace, sessionId: 's1' }, env));
    assert.throws(() => evidence.checkEvidence(edit({ sessionId: 'other' }), env));
    assert.equal(evidence.checkEvidence(edit({ tool_name: 'Bash' }), env).allowed, true);
  });
  test('available native turn identity is required to match both read and edit', () => {
    event('userPromptSubmitted', 1150);
    read(1160, { turnId: 'native-turn' });
    assert.equal(evidence.checkEvidence(edit({ turnId: 'native-turn' }), env, { now: 1170 }).allowed, true);
    assert.equal(evidence.checkEvidence(edit({ turnId: 'native-turn' }), { ...env, ECC_DISABLED_HOOKS: 'copilot:read-evidence' }, { now: 1170 }).allowed, false);
    assert.equal(evidence.checkEvidence(edit({ turnId: 'next-turn' }), env, { now: 1170 }).allowed, false);
    assert.equal(evidence.checkEvidence(edit(), env, { now: 1170 }).allowed, false);
  });
  test('hook bookkeeping obeys profiles and does not echo malformed payloads', () => {
    const hook = require('../../scripts/hooks/copilot-evidence');
    assert.deepEqual(hook.run('sessionStart', '{malformed', { ...env, ECC_HOOK_PROFILE: 'minimal' }), {});
    assert.throws(() => hook.run('sessionStart', '{malformed', { ...env, ECC_HOOK_PROFILE: 'standard' }));
    const { spawnSync } = require('child_process');
    const target = path.resolve(__dirname, '../../scripts/hooks/copilot-evidence.js');
    for (const raw of ['{PRIVATE malformed', JSON.stringify(native(1200))]) {
      const result = spawnSync(process.execPath, [target, 'userPromptSubmitted'], {
        env: { ...process.env, ...env, ECC_HOOK_PROFILE: 'standard' }, input: raw, encoding: 'utf8', timeout: 5000,
      });
      assert.equal(result.status, 0); assert.deepEqual(JSON.parse(result.stdout), {});
      assert.equal(result.stderr.includes('PRIVATE'), false);
    }
  });
  test('successful but truncated, missing or contradictory output cannot prove the complete source', () => {
    event('userPromptSubmitted', 1300);
    for (const [time, result] of [[1310, { resultType: 'success' }],
      [1320, { resultType: 'success', textResultForLlm: 'TRUNCATED' }],
      [1330, { resultType: 'success', textResultForLlm: fs.readFileSync(file, 'utf8'), text_result_for_llm: 'DIFFERENT' }]]) {
      read(time, { toolResult: result });
      assert.equal(evidence.checkEvidence(edit(), env, { now: time + 5 }).allowed, false);
    }
    read(1340, { toolResult: { resultType: 'success', text_result_for_llm: fs.readFileSync(file, 'utf8') } });
    assert.equal(evidence.checkEvidence(edit(), env, { now: 1345 }).allowed, true);
  });
  test('equal-time read and lifecycle ordering is ambiguous and cannot create proof', () => {
    event('userPromptSubmitted', 1400);
    event('preToolUse', 1400, { toolName: 'view', toolArgs: { path: file } });
    event('postToolUse', 1401, { toolName: 'view', toolArgs: { path: file }, toolResult: { resultType: 'success', textResultForLlm: fs.readFileSync(file, 'utf8') } });
    assert.equal(evidence.checkEvidence(edit(), env, { now: 1405 }).allowed, false);
    event('preToolUse', 1410, { toolName: 'view', toolArgs: { path: file } });
    event('postToolUse', 1410, { toolName: 'view', toolArgs: { path: file }, toolResult: { resultType: 'success', textResultForLlm: fs.readFileSync(file, 'utf8') } });
    assert.equal(evidence.checkEvidence(edit(), env, { now: 1415 }).allowed, false);
  });
  test('compaction invalidates stale proof but fresh complete read can continue without another user prompt', () => {
    event('userPromptSubmitted', 1500); read(1510);
    event('preCompact', 1520);
    assert.equal(evidence.checkEvidence(edit(), env, { now: 1525 }).allowed, false);
    read(1530); assert.equal(evidence.checkEvidence(edit(), env, { now: 1535 }).allowed, true);
    event('preCompact', 1520);
    assert.equal(evidence.checkEvidence(edit(), env, { now: 1540 }).allowed, true);
  });
  test('even complete read evidence cannot authorize sensitive paths or destructive shell operations', () => {
    const sensitive = path.join(workspace, '.github/workflows/build.yml');
    fs.mkdirSync(path.dirname(sensitive), { recursive: true }); fs.writeFileSync(sensitive, 'name: fixture\n');
    event('userPromptSubmitted', 1600);
    read(1610, { toolArgs: { path: sensitive }, toolResult: { resultType: 'success', textResultForLlm: fs.readFileSync(sensitive, 'utf8') } });
    const guard = require('../../scripts/hooks/copilot-guard');
    assert.equal(guard.run(edit({ tool_input: { file_path: sensitive } }), env).exitCode, 2);
    assert.equal(guard.run(edit({ tool_name: 'PowerShell', tool_input: { command: 'Remove-Item -Recurse -Force .git' } }), env).exitCode, 2);
  });
  console.log(`Passed: ${passed}, Failed: 0`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
