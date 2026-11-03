import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, userPrompt } from '../src/lib/director-prompt.js';

test('user prompt lists the planned beats with word budgets', () => {
  const p = userPrompt({ brief: 'Sérum facial Luma', targetSeconds: 45, clipSeconds: 8, persona: 'woman', hasReferenceImage: true });
  assert.match(p, /exactly 6 clips/);
  assert.match(p, /1\. role="hook" \(8s, max 20 spoken words\)/);
  assert.match(p, /presenter must be a woman/);
  assert.match(p, /reference image is attached/);
  assert.match(p, /Brazilian Portuguese \(pt-BR\)/);
});

test('system prompt demands JSON only and consistency', () => {
  const s = systemPrompt();
  assert.match(s, /ONE JSON object only/);
  assert.match(s, /CONSISTENCY/);
});

test('chat prompt bundles system and user instructions and asks for a fenced JSON block', async () => {
  const { chatScriptPrompt } = await import('../src/lib/director-prompt.js');
  const p = chatScriptPrompt({ brief: 'Bíblia King James 1611 capa dura', targetSeconds: 45, clipSeconds: 8 });
  assert.match(p, /CONSISTENCY/);
  assert.match(p, /exactly 6 clips/);
  assert.match(p, /```json code block/);
  assert.match(p, /Do not generate images or videos/);
});
