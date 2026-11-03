import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiHeaders, buildGenerateBody, extractGeminiText, geminiGenerate } from '../src/lib/llm/gemini.js';
import { buildResponsesBody, extractOpenAIText, openaiGenerate } from '../src/lib/llm/openai.js';
import { buildOmniBody, findVideoUri, fileIdFromUri, omniGenerateClip } from '../src/lib/llm/omni-video.js';
import { generateScriptText } from '../src/lib/llm/index.js';

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    return { ok: next.ok !== false, status: next.status || 200, json: async () => next.json, text: async () => JSON.stringify(next.json) };
  };
  impl.calls = calls;
  return impl;
}

test('gemini headers prefer OAuth and add the user project', () => {
  const h = buildGeminiHeaders({ accessToken: 't', apiKey: 'k', projectId: 'p' });
  assert.equal(h.Authorization, 'Bearer t');
  assert.equal(h['x-goog-user-project'], 'p');
  assert.equal('x-goog-api-key' in h, false);
  assert.equal(buildGeminiHeaders({ apiKey: 'k' })['x-goog-api-key'], 'k');
  assert.throws(() => buildGeminiHeaders({}), /no OAuth token/);
});

test('gemini body puts images before text and asks for JSON', () => {
  const body = buildGenerateBody({ system: 's', user: 'u', images: [{ mimeType: 'image/png', base64: 'AAA' }] });
  assert.equal(body.contents[0].parts[0].inline_data.mime_type, 'image/png');
  assert.equal(body.contents[0].parts[1].text, 'u');
  assert.equal(body.generationConfig.response_mime_type, 'application/json');
});

test('geminiGenerate posts to the model endpoint and returns text', async () => {
  const f = fakeFetch([{ json: { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] } }]);
  const text = await geminiGenerate({ auth: { apiKey: 'k' }, model: 'gemini-4-argon', system: 's', user: 'u', fetchImpl: f });
  assert.equal(text, '{"ok":true}');
  assert.match(f.calls[0].url, /models\/gemini-4-argon:generateContent$/);
});

test('gemini errors surface status and block reason', async () => {
  const f = fakeFetch([{ ok: false, status: 403, json: { error: 'denied' } }]);
  await assert.rejects(geminiGenerate({ auth: { apiKey: 'k' }, system: 's', user: 'u', fetchImpl: f }), /HTTP 403/);
  assert.throws(() => extractGeminiText({ promptFeedback: { blockReason: 'SAFETY' } }), /SAFETY/);
});

test('openai responses body and text extraction', async () => {
  const body = buildResponsesBody({ model: 'gpt-5', system: 's', user: 'u', images: [{ mimeType: 'image/jpeg', base64: 'B' }] });
  assert.equal(body.input[0].content[0].type, 'input_image');
  assert.equal(body.text.format.type, 'json_object');
  assert.equal('temperature' in body, false);
  assert.equal(extractOpenAIText({ output: [{ content: [{ type: 'output_text', text: 'x' }] }] }), 'x');
  const f = fakeFetch([{ json: { output_text: '{"a":1}' } }]);
  assert.equal(await openaiGenerate({ apiKey: 'k', system: 's', user: 'u', fetchImpl: f }), '{"a":1}');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer k');
  await assert.rejects(openaiGenerate({ system: 's', user: 'u' }), /no API key/);
});

test('provider router picks openai or gemini from settings', async () => {
  const f = fakeFetch([{ json: { output_text: 'o' } }, { json: { candidates: [{ content: { parts: [{ text: 'g' }] } }] } }]);
  assert.equal(await generateScriptText({ settings: { provider: 'openai', openaiApiKey: 'k' }, system: 's', user: 'u', fetchImpl: f }), 'o');
  assert.equal(await generateScriptText({ settings: { provider: 'gemini' }, auth: { accessToken: 't' }, system: 's', user: 'u', fetchImpl: f }), 'g');
});

test('omni body and polling loop', async () => {
  const body = buildOmniBody({ prompt: 'p', aspect: '9:16', previousInteractionId: 'prev' });
  assert.equal(body.aspect_ratio, '9:16');
  assert.equal(body.previous_interaction_id, 'prev');
  assert.equal(findVideoUri({ steps: [{ type: 'video', uri: 'https://x/v1beta/files/abc' }] }), 'https://x/v1beta/files/abc');
  assert.equal(fileIdFromUri('https://generativelanguage.googleapis.com/v1beta/files/abc:download'), 'abc');
  const f = fakeFetch([
    { json: { id: 'int1', steps: [{ type: 'video', uri: 'https://g/v1beta/files/f9' }] } },
    { json: { state: 'PROCESSING' } },
    { json: { state: 'ACTIVE' } },
  ]);
  const out = await omniGenerateClip({ auth: { apiKey: 'k' }, prompt: 'p', fetchImpl: f, sleep: async () => {} });
  assert.equal(out.fileId, 'f9');
  assert.match(out.downloadUrl, /files\/f9:download\?alt=media&key=k$/);
  const bad = fakeFetch([
    { json: { id: 'i', steps: [{ type: 'video', uri: 'https://g/v1beta/files/f1' }] } },
    { ok: false, status: 403, json: {} },
  ]);
  await assert.rejects(omniGenerateClip({ auth: { apiKey: 'k' }, prompt: 'p', fetchImpl: bad, sleep: async () => {} }), /poll HTTP 403/);
  assert.equal(out.interactionId, 'int1');
  assert.equal(f.calls.length, 3);
});
