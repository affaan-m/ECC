'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseEventEnvelope } = require('../../scripts/lib/copilot-event-envelope');
const sink = require('../../scripts/lib/copilot-observations');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observe-'));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const env = { COPILOT_HOME: path.join(root, 'config'), ECC_COPILOT_OBSERVE: '1' };
const payload = (id = 'call-1', cwd = root) => ({ cwd, sessionId: 'one', toolCallId: id,
  toolName: 'bash', toolArgs: { command: 'echo password=sentinel-secret' }, toolResult: { success: true } });
const event = id => parseEventEnvelope('postToolUse', payload(id));
try {
  test('disabled sink writes nothing', () => {
    assert.equal(sink.observe(event(), { COPILOT_HOME: env.COPILOT_HOME }).status, 'disabled');
    assert.equal(fs.existsSync(env.COPILOT_HOME), false);
  });
  test('canonical compatible records exclude all arguments output and raw identity', () => {
    assert.equal(sink.observe(event(), env).status, 'recorded');
    const rows = sink.readObservations(root, env);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, 'tool_complete');
    assert.equal(rows[0].outcome, 'succeeded');
    assert.equal(JSON.stringify(rows).includes('sentinel'), false);
    assert.equal(JSON.stringify(rows).includes(root), false);
  });
  test('same call is deduplicated but same command in distinct calls persists', () => {
    assert.equal(sink.observe(event(), env).status, 'duplicate');
    sink.observe(event('call-2'), env);
    assert.equal(sink.readObservations(root, env).length, 2);
  });
  test('missing call identity does not collapse equal separate actions', () => {
    const native = { ...payload(), toolCallId: undefined };
    sink.observe(parseEventEnvelope('postToolUse', native), env);
    sink.observe(parseEventEnvelope('postToolUse', native), env);
    assert.equal(sink.readObservations(root, env).length, 4);
  });
  test('unknown outcome stays unknown', () => {
    sink.observe(parseEventEnvelope('postToolUse', { ...payload('unknown'), toolResult: undefined }), env);
    assert.equal(sink.readObservations(root, env).at(-1).outcome, 'unknown');
  });
  test('workspace roots isolate records', () => {
    const other = path.join(root, 'other'); fs.mkdirSync(other);
    sink.observe(parseEventEnvelope('postToolUse', payload('call-1', other)), env);
    assert.equal(sink.readObservations(other, env).length, 1);
    assert.equal(sink.readObservations(root, env).length, 5);
  });
  test('contradictory duplicate outcomes stay unknown rather than retaining success', () => {
    const failed = parseEventEnvelope('postToolUse', { ...payload(), toolResult: { success: false } });
    assert.equal(sink.observe(failed, env).status, 'conflict');
    assert.equal(sink.readObservations(root, env)[0].outcome, 'unknown');
    sink.observe(event(), env);
    assert.equal(sink.readObservations(root, env)[0].outcome, 'unknown');
    assert.equal(sink.readObservations(root, env).length, 5);
  });
  test('future schema and broken records fail explicitly', () => {
    assert.throws(() => sink.observe({ ...event(), schemaVersion: 2 }, env));
    const file = sink.observationFile(root, env);
    fs.writeFileSync(file, '{broken');
    assert.throws(() => sink.readObservations(root, env));
  });
  test('foreign project identities, extra raw fields and malformed timestamps reject without rewrite', () => {
    const file = sink.observationFile(root, env);
    const crypto = require('crypto');
    const hash = value => crypto.createHash('sha256').update(value).digest('hex');
    const record = { schema: 'ecc.copilot.observation.v1', timestamp: new Date().toISOString(),
      event: 'tool_complete', tool: 'Edit', session: hash('one'), project_id: hash(fs.realpathSync(root)),
      tool_use_id: hash('review-case'), outcome: 'unknown' };
    for (const extra of [{ project_id: hash('foreign') }, { raw_command: 'password=sentinel' }, { timestamp: 123 }]) {
      const raw = JSON.stringify({ ...record, ...extra }) + '\n'; fs.writeFileSync(file, raw);
      assert.throws(() => sink.readObservations(root, env));
      assert.throws(() => sink.observe(event('another'), env));
      assert.equal(fs.readFileSync(file, 'utf8'), raw);
    }
  });
  test('linked observation files and contended locks fail without changing another file', () => {
    const file = sink.observationFile(root, env);
    fs.unlinkSync(file);
    const sentinel = path.join(root, 'sentinel'); fs.writeFileSync(sentinel, 'SENTINEL');
    fs.linkSync(sentinel, file);
    assert.throws(() => sink.readObservations(root, env), /Unsafe/);
    assert.throws(() => sink.observe(event('hardlink'), env), /Unsafe/);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'SENTINEL'); fs.unlinkSync(file);
    fs.symlinkSync(sentinel, file);
    assert.throws(() => sink.readObservations(root, env), /Unsafe/);
    fs.unlinkSync(file);
    const lock = `${file}.lock`; fs.mkdirSync(lock);
    assert.throws(() => sink.observe(event('contended'), env), /EEXIST/);
    assert.ok(!fs.existsSync(file)); fs.rmdirSync(lock);
    assert.equal(sink.observe(event('after-lock'), env).status, 'recorded');
  });
  console.log(`Passed: ${passed}, Failed: 0`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
