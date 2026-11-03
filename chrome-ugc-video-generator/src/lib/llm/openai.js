// OpenAI client. OpenAI does not offer a public OAuth flow for third-party
// apps to use a ChatGPT subscription, so this client uses an API key.

export const OPENAI_BASE = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-5';

function imageContent(image) {
  return { type: 'input_image', image_url: `data:${image.mimeType};base64,${image.base64}` };
}

// No temperature: GPT-5 family reasoning models reject non-default values.
export function buildResponsesBody({ model, system, user, images = [] }) {
  return {
    model,
    instructions: system,
    input: [{ role: 'user', content: [...images.map(imageContent), { type: 'input_text', text: user }] }],
    text: { format: { type: 'json_object' } },
  };
}

export function extractOpenAIText(json) {
  if (typeof json?.output_text === 'string' && json.output_text) return json.output_text;
  const chunks = [];
  for (const item of json?.output || []) {
    for (const c of item.content || []) {
      if (c.type === 'output_text' && c.text) chunks.push(c.text);
    }
  }
  if (!chunks.length) throw new Error('OpenAI returned no text');
  return chunks.join('');
}

export async function openaiGenerate({ apiKey, model = DEFAULT_OPENAI_MODEL, system, user, images, fetchImpl = globalThis.fetch }) {
  if (!apiKey) throw new Error('OpenAI: no API key configured');
  const res = await fetchImpl(`${OPENAI_BASE}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(buildResponsesBody({ model, system, user, images })),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${detail.slice(0, 400)}`);
  }
  return extractOpenAIText(await res.json());
}
