import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapForGeminiApp, mergeSelectors, DEFAULT_SELECTORS } from '../src/lib/gemini-app.js';

test('wrapper tells Argon to generate with Veo and keep the look across clips', () => {
  const first = wrapForGeminiApp('PROMPT', { index: 1, total: 6 });
  assert.match(first, /^Generate ONE video clip with Veo now\. Vertical 9:16, 8 seconds/);
  assert.match(first, /This is clip 1 of 6/);
  assert.ok(first.endsWith('\n\nPROMPT'));
  const later = wrapForGeminiApp('P', { index: 4, total: 6 });
  assert.match(later, /clip 4 of 6 of the same video/);
  const fresh = wrapForGeminiApp('P', { index: 4, total: 6, sameConversation: false });
  assert.doesNotMatch(fresh, /same video/);
});

test('selector overrides replace only known keys', () => {
  const merged = mergeSelectors({ editor: 'textarea#x', bogus: 'y', videoToolText: 'make a clip', send: ['b1', 'b2'] });
  assert.deepEqual(merged.editor, ['textarea#x']);
  assert.deepEqual(merged.send, ['b1', 'b2']);
  assert.ok(merged.videoToolText instanceof RegExp);
  assert.ok(merged.videoToolText.test('Make a Clip'));
  assert.equal('bogus' in merged, false);
  assert.equal(merged.video, DEFAULT_SELECTORS.video);
});

test('cleanChatAnswer strips the code block chrome the Gemini UI adds', async () => {
  const { cleanChatAnswer } = await import('../src/lib/gemini-app.js');
  const { extractJson } = await import('../src/lib/script-schema.js');
  const raw = 'JSON\nCopiar código\n```json\n{"a": 1}\n```\n';
  const cleaned = cleanChatAnswer(raw);
  assert.doesNotMatch(cleaned, /Copiar/);
  assert.deepEqual(extractJson(cleaned), { a: 1 });
});
