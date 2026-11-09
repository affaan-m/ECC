'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { importNativeSkillFacts } = require('../../scripts/lib/copilot-native-skill-telemetry');
const { readTelemetry, skillHealthRecords } = require('../../scripts/lib/copilot-telemetry');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-native-skills-'));
const workspace = path.join(root, 'project'); fs.mkdirSync(workspace);
const env = { COPILOT_HOME: path.join(root, 'home'), ECC_COPILOT_TELEMETRY: '1' };
const native = path.join(env.COPILOT_HOME, 'session-state', 'one'); fs.mkdirSync(native, { recursive: true });
const start = { type: 'session.start', data: { sessionId: 'one', context: { cwd: workspace } } };
const skillPath = path.join(workspace, '.github/skills/review/SKILL.md');
fs.mkdirSync(path.dirname(skillPath), { recursive: true }); fs.writeFileSync(skillPath, '---\nname: review\n---\n');
const event = (extra = {}) => ({ type: 'skill.invoked', id: crypto.randomUUID(), timestamp: new Date().toISOString(),
  data: { name: 'review', path: skillPath, source: 'project', trigger: 'agent-invoked', content: 'PASSWORD_SENTINEL', arguments: 'token=SECRET_SENTINEL' }, ...extra });
function journal(events) { fs.writeFileSync(path.join(native, 'events.jsonl'), [start, ...events].map(e => JSON.stringify(e)).join('\n') + '\n'); }
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
try {
  test('disabled import never reads or writes state', () => {
    assert.equal(importNativeSkillFacts({ cwd: workspace, sessionId: 'one' }, { COPILOT_HOME: '/unavailable' }).status, 'disabled');
  });
  test('missing native signals remain unavailable rather than zero usage', () => {
    journal([{ type: 'assistant.message', data: { content: 'Use review skill' } }]);
    assert.equal(importNativeSkillFacts({ cwd: workspace, sessionId: 'one' }, env).status, 'unavailable');
    assert.deepEqual(readTelemetry(workspace, env), []);
  });
  const invocation = event();
  test('only explicit persisted invocation metadata is recorded, never content or terminal success', () => {
    journal([invocation]);
    assert.equal(importNativeSkillFacts({ cwd: workspace, sessionId: 'one' }, env).recorded, 1);
    const rows = readTelemetry(workspace, env);
    assert.equal(rows[0].kind, 'invoked'); assert.match(rows[0].skillId, /^project\/review@/);
    assert.ok(!JSON.stringify(rows).includes('SENTINEL')); assert.ok(!JSON.stringify(rows).includes(workspace));
    assert.deepEqual(skillHealthRecords(rows), []);
  });
  test('replayed native event is deduplicated and context-load is selection only', () => {
    const loaded = event({ data: { ...invocation.data, trigger: 'context-load' } }); journal([invocation, loaded]);
    const report = importNativeSkillFacts({ cwd: workspace, sessionId: 'one' }, env);
    assert.equal(report.duplicates, 1); assert.equal(report.recorded, 1);
    assert.equal(readTelemetry(workspace, env).at(-1).kind, 'selected');
  });
  test('same names from distinct valid origins retain separate identities', () => {
    journal([event({ data: { ...invocation.data, source: 'plugin', path: path.join(root, 'plugin/skills/review/SKILL.md') } })]);
    importNativeSkillFacts({ cwd: workspace, sessionId: 'one' }, env);
    const rows = readTelemetry(workspace, env); assert.equal(new Set(rows.map(r => r.skillId)).size, 2);
  });
  test('unknown sources, missing identities, checkpoint replay and invalid paths do not assert facts', () => {
    journal([event({ data: { ...invocation.data, source: 'future' } }), event({ id: undefined }),
      event({ checkpoint: true }), event({ data: { ...invocation.data, path: '' } }),
      event({ data: { ...invocation.data, path: path.join(root, 'outside/SKILL.md') } }),
      event({ data: { ...invocation.data, trigger: 'future' } })]);
    const report = importNativeSkillFacts({ cwd: workspace, sessionId: 'one' }, env);
    assert.equal(report.status, 'unavailable'); assert.equal(report.ignored, 6);
  });
  test('ISO timestamp precision and offsets from native writers are accepted', () => {
    journal([event({ timestamp: '2026-11-04T12:00:00Z' }), event({ timestamp: '2026-11-04T12:00:00.123456789+00:00' })]);
    assert.equal(importNativeSkillFacts({ cwd: workspace, sessionId: 'one' }, env).recorded, 2);
  });
  test('foreign workspace and conflicting session aliases fail before telemetry writes', () => {
    const other = path.join(root, 'other'); fs.mkdirSync(other);
    assert.throws(() => importNativeSkillFacts({ cwd: other, sessionId: 'one' }, env));
    assert.throws(() => importNativeSkillFacts({ cwd: workspace, sessionId: 'one', session_id: 'two' }, env));
    assert.deepEqual(readTelemetry(other, env), []);
  });
  test('absent native journal returns unavailable with generic diagnostic', () => {
    const report = importNativeSkillFacts({ cwd: workspace, sessionId: 'absent' }, env);
    assert.equal(report.status, 'unavailable'); assert.ok(!JSON.stringify(report).includes(workspace));
  });
  console.log(`Passed: ${passed}, Failed: 0`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
