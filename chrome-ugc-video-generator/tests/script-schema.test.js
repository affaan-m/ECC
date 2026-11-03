import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, parseScript, normalizeScript, ScriptParseError } from '../src/lib/script-schema.js';
import { rawScript, PLAN } from './fixtures.js';

test('extractJson tolerates fences and surrounding prose', () => {
  const text = 'Here you go:\n```json\n{"a":1}\n```\nthanks';
  assert.deepEqual(extractJson(text), { a: 1 });
  assert.deepEqual(extractJson('noise {"b":[1,2]} tail'), { b: [1, 2] });
});

test('extractJson throws a typed error on garbage', () => {
  assert.throws(() => extractJson('nothing here'), ScriptParseError);
  assert.throws(() => extractJson('{bad json}'), /Invalid JSON/);
});

test('normalizeScript forces planned clip count and durations', () => {
  const raw = rawScript();
  raw.scenes = raw.scenes.concat([{ action: 'extra' }, { action: 'extra2' }]);
  const script = normalizeScript(raw, PLAN);
  assert.equal(script.scenes.length, 6);
  assert.ok(script.scenes.every(s => s.seconds === 8));
  assert.deepEqual(script.scenes.map(s => s.index), [1, 2, 3, 4, 5, 6]);
  assert.equal(script.scenes[0].role, 'x', 'LLM role kept when provided');
});

test('user plan wins over the LLM for language and format', () => {
  const script = normalizeScript(rawScript({ language: 'pt', format: 'product' }), PLAN);
  assert.equal(script.language, 'pt-BR');
  assert.equal(script.format, 'ugc');
});

test('normalizeScript fails when a clip has no action', () => {
  const raw = rawScript();
  raw.scenes[3].action = '';
  assert.throws(() => normalizeScript(raw, PLAN), /clip\(s\) 4/);
});

test('hashtags are normalized from arrays or strings', () => {
  const a = parseScript(JSON.stringify(rawScript()), PLAN);
  assert.deepEqual(a.tiktok.hashtags, ['skincare', 'glow']);
  const b = parseScript(JSON.stringify(rawScript({ tiktok: { hashtags: '#a, b #c' } })), PLAN);
  assert.deepEqual(b.tiktok.hashtags, ['a', 'b', 'c']);
});
