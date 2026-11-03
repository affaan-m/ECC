import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAllPrompts, validateConsistency, renderScenePrompt, DEFAULT_NEGATIVE } from '../src/lib/prompt-builder.js';
import { normalizeScript } from '../src/lib/script-schema.js';
import { rawScript, PLAN } from './fixtures.js';

test('every rendered prompt contains every bible anchor', () => {
  const script = normalizeScript(rawScript(), PLAN);
  const rendered = renderAllPrompts(script, { hasReference: true });
  assert.equal(rendered.length, 6);
  assert.deepEqual(validateConsistency(script, rendered), []);
});

test('validator reports a prompt that lost an anchor', () => {
  const script = normalizeScript(rawScript(), PLAN);
  const rendered = renderAllPrompts(script);
  rendered[2].prompt = rendered[2].prompt.replace('coral cap', 'blue cap');
  const problems = validateConsistency(script, rendered);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].index, 3);
});

test('first and last clips get the right continuity notes', () => {
  const script = normalizeScript(rawScript(), PLAN);
  const rendered = renderAllPrompts(script);
  assert.match(rendered[0].prompt, /opening clip/);
  assert.match(rendered[5].prompt, /final clip/);
  assert.match(rendered[3].prompt, /continues directly from the previous clip/);
});

test('header carries clip index, duration and vertical format', () => {
  const script = normalizeScript(rawScript(), PLAN);
  const p = renderScenePrompt({ bible: script.bible, scene: script.scenes[1], total: 6 });
  assert.match(p, /^\[Clip 2\/6 \| 8s \| vertical 9:16 1080x1920 \| TikTok\]/);
  assert.match(p, /Brazilian Portuguese/);
  assert.match(p, /"Fala 2"/);
  assert.ok(p.includes(DEFAULT_NEGATIVE) === false, 'bible negative wins over default');
  assert.match(p, /NEGATIVE: no subtitles\./);
});
