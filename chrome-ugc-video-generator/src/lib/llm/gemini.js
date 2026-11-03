// Gemini API client (generativelanguage.googleapis.com). Accepts either an
// OAuth bearer token (chrome.identity) or an API key. fetch is injectable so
// the module is testable in Node without network.

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GEMINI_MODEL = 'gemini-4-argon';
export const FALLBACK_GEMINI_MODEL = 'gemini-3.6-flash';

export function buildGeminiHeaders({ accessToken, apiKey, projectId }) {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
    if (projectId) headers['x-goog-user-project'] = projectId;
  } else if (apiKey) {
    headers['x-goog-api-key'] = apiKey;
  } else {
    throw new Error('Gemini: no OAuth token and no API key configured');
  }
  return headers;
}

function imagePart(image) {
  return { inline_data: { mime_type: image.mimeType, data: image.base64 } };
}

export function buildGenerateBody({ system, user, images = [], temperature = 0.8 }) {
  const parts = [...images.map(imagePart), { text: user }];
  return {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      response_mime_type: 'application/json',
    },
  };
}

export function extractGeminiText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('');
  if (!text) {
    const reason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason;
    throw new Error(`Gemini returned no text${reason ? ` (${reason})` : ''}`);
  }
  return text;
}

export async function geminiGenerate({ auth, model = DEFAULT_GEMINI_MODEL, system, user, images, temperature, fetchImpl = globalThis.fetch }) {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: buildGeminiHeaders(auth),
    body: JSON.stringify(buildGenerateBody({ system, user, images, temperature })),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${detail.slice(0, 400)}`);
  }
  return extractGeminiText(await res.json());
}
