// Optional "API mode": render clips directly with Gemini Omni Flash through the
// Interactions API instead of driving the Gemini web app. Costs API credits.

import { GEMINI_BASE, buildGeminiHeaders } from './gemini.js';

export const OMNI_MODEL = 'gemini-omni-1.1-flash';

export function buildOmniBody({ prompt, images = [], aspect = '9:16', resolution = '1080p', previousInteractionId }) {
  const input = [
    ...images.map(img => ({ type: 'image', data: img.base64, mime_type: img.mimeType })),
    { type: 'text', text: prompt },
  ];
  const body = {
    model: OMNI_MODEL,
    input,
    aspect_ratio: aspect,
    resolution,
    response_format: { type: 'video', delivery: 'uri' },
  };
  if (previousInteractionId) body.previous_interaction_id = previousInteractionId;
  return body;
}

export function findVideoUri(interaction) {
  const steps = interaction?.steps || interaction?.outputs || [];
  for (const step of steps) {
    if (step?.type === 'video' && step.uri) return step.uri;
    for (const c of step?.content || []) {
      if (c?.type === 'video' && c.uri) return c.uri;
    }
  }
  return null;
}

export function fileIdFromUri(uri) {
  const m = String(uri || '').match(/files\/([^/?:]+)/);
  return m ? m[1] : null;
}

export async function omniGenerateClip({ auth, prompt, images, aspect, resolution, previousInteractionId, fetchImpl = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), maxWaitMs = 10 * 60 * 1000 }) {
  const headers = buildGeminiHeaders(auth);
  const res = await fetchImpl(`${GEMINI_BASE}/interactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildOmniBody({ prompt, images, aspect, resolution, previousInteractionId })),
  });
  if (!res.ok) throw new Error(`Omni HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}`);
  const interaction = await res.json();
  const uri = findVideoUri(interaction);
  const fileId = fileIdFromUri(uri);
  if (!fileId) throw new Error('Omni: no video file in interaction response');
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const f = await fetchImpl(`${GEMINI_BASE}/files/${fileId}`, { headers });
    if (!f.ok) throw new Error(`Omni file poll HTTP ${f.status}`);
    const meta = await f.json();
    if (meta.state === 'ACTIVE') {
      const keyParam = auth.apiKey && !auth.accessToken ? `&key=${encodeURIComponent(auth.apiKey)}` : '';
      return { interactionId: interaction.id, fileId, downloadUrl: `${GEMINI_BASE}/files/${fileId}:download?alt=media${keyParam}` };
    }
    if (meta.state === 'FAILED') throw new Error('Omni: video generation failed');
    await sleep(5000);
  }
  throw new Error('Omni: timed out waiting for the video');
}
