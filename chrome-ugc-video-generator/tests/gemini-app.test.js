import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapForGeminiApp, mergeSelectors, DEFAULT_SELECTORS, softenPrompt, isRefusal, MAX_SOFTEN_LEVEL } from '../src/lib/gemini-app.js';

test('wrapper tells Argon to generate with Veo and keep the look across clips', () => {
  const first = wrapForGeminiApp('PROMPT', { index: 1, total: 6 });
  assert.match(first, /^Create one 8-second vertical 9:16 video with Veo/);
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

test('jsonLooksComplete rejects half-streamed answers and accepts closed ones', async () => {
  const { jsonLooksComplete } = await import('../src/lib/gemini-app.js');
  assert.equal(jsonLooksComplete('```json\n{"a": {"b": "x'), false);
  assert.equal(jsonLooksComplete('```json\n{"a": {"b": "x"}}'), false, 'fence not closed');
  assert.equal(jsonLooksComplete('{"a": {"b": "x"}'), false, 'braces unbalanced');
  assert.equal(jsonLooksComplete('```json\n{"a": {"b": "x }"}}\n```'), true, 'brace inside string ignored');
  assert.equal(jsonLooksComplete('{"a": 1}'), true);
  assert.equal(jsonLooksComplete('no json here'), false);
});

test('softenPrompt strips the parts that trip the video policy filter, level by level', () => {
  const prompt = [
    '[Clip 1/6]',
    'REFERENCE: the attached image is the visual reference.',
    "PRODUCT (identical in every shot): hardcover with gold foil reading 'BKJ KING JAMES 1611', badge reading 'EXCELÊNCIA'",
    'DIALOGUE (spoken to camera): "Oi gente"',
    'CONTINUITY: opening clip.',
    'NEGATIVE: no subtitles.',
  ].join('\n');
  assert.equal(softenPrompt(prompt, 0), prompt);
  const l1 = softenPrompt(prompt, 1);
  assert.doesNotMatch(l1, /KING JAMES|EXCELÊNCIA|CONTINUITY|NEGATIVE/);
  assert.match(l1, /legible brand lettering/);
  assert.match(l1, /"Oi gente"/);
  assert.match(l1, /^REFERENCE:/m);
  const l2 = softenPrompt(prompt, MAX_SOFTEN_LEVEL);
  assert.match(l2, /^DIALOGUE: none\./m);
  assert.doesNotMatch(l2, /Oi gente|REFERENCE:/);
});

test('isRefusal recognises the Gemini app refusal in English and Portuguese', () => {
  assert.ok(isRefusal("I can't generate that video. Try describing another idea."));
  assert.ok(isRefusal('Não consigo gerar esse vídeo. Tente descrever outra ideia.'));
  assert.ok(!isRefusal('Here is your video.'));
});
