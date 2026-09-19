'use strict';

const assert = require('assert');
const test = require('node:test');
const { decide } = require('../../scripts/lib/control-pane/tcas');

const now = Date.parse('2026-09-11T20:01:03.000Z');
const base = { kind: 'proximity.advisory', at: '2026-09-11T20:01:02.000Z', risk: 1, subject: { a: 'session-a', b: 'session-b' }, message: 'advisory' };

test('traffic advisory transmits without blocking', () => {
  const result = decide([{ ...base, level: 'traffic', action: { type: 'transmit', steer: null, hold: null } }], { session_id: 'session-a', tool_name: 'Edit', tool_input: { file_path: 'src/a.js' } }, { now });
  assert.equal(result.maneuver, 'transmit');
  assert.equal(result.blocked, false);
});

test('resolution holder continues', () => {
  const result = decide([{ ...base, level: 'resolution', action: { type: 'steer', steer: 'session-a', hold: 'session-b' } }], { session_id: 'session-b', tool_name: 'Write', tool_input: { file_path: 'src/a.js' } }, { now });
  assert.equal(result.maneuver, 'hold');
  assert.equal(result.blocked, false);
});

test('resolution steerer pauses overlapping file', () => {
  const result = decide([{ ...base, level: 'resolution', action: { type: 'steer', steer: 'session-a', hold: 'session-b' }, workingSets: { 'session-b': ['src/a.js'] } }], { session_id: 'session-a', tool_name: 'Edit', tool_input: { file_path: 'src/a.js' } }, { now });
  assert.equal(result.maneuver, 'pause');
  assert.equal(result.blocked, true);
});

test('resolution steerer waits on disjoint file', () => {
  const result = decide([{ ...base, level: 'resolution', action: { type: 'steer', steer: 'session-a', hold: 'session-b' }, workingSets: { 'session-b': ['src/a.js'] } }], { session_id: 'session-a', tool_name: 'Edit', tool_input: { file_path: 'src/b.js' } }, { now });
  assert.equal(result.maneuver, 'wait');
  assert.equal(result.blocked, false);
});

test('stale advisory does not block', () => {
  const result = decide([{ ...base, at: '2026-09-11T19:59:00.000Z', level: 'resolution', action: { type: 'steer', steer: 'session-a', hold: 'session-b' }, workingSets: { 'session-b': ['src/a.js'] } }], { session_id: 'session-a', tool_name: 'Edit', tool_input: { file_path: 'src/a.js' } }, { now });
  assert.equal(result.maneuver, 'allow');
});
