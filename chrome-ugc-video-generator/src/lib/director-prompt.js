// Builds the instruction given to the LLM (Gemini 4 Argon or GPT) that writes
// the script. The model returns JSON; prompt-builder.js turns it into clips.

import { planScenes, FORMATS } from './plan.js';
import { languageName } from './prompt-builder.js';

const JSON_SHAPE = `{
  "format": "ugc" | "product",
  "language": "<BCP-47 code>",
  "title": "<internal working title>",
  "concept": "<one paragraph: the creative idea and why it will stop the scroll>",
  "bible": {
    "character": {
      "gender": "woman" | "man",
      "age": "<e.g. 'early 30s'>",
      "ethnicity": "<specific, respectful, visual>",
      "face": "<distinctive, specific facial features>",
      "hair": "<color, length, style, exactly>",
      "build": "<body type>",
      "outfit": "<exact garments with colors and fabrics; this never changes>",
      "accessories": "<jewelry, glasses, nails; or 'none'>",
      "voice": "<tone and energy of delivery>"
    },
    "product": {
      "name": "<brand + product as spoken>",
      "look": "<shape, colors, materials>",
      "packaging": "<box/bottle/label details>",
      "key_detail": "<one unmistakable visual detail>"
    },
    "setting": "<one exact location with 3 concrete props>",
    "lighting": "<precise light setup, time of day>",
    "camera_style": "<e.g. 'handheld front-camera selfie, 24mm equivalent, slight shake'>",
    "color_grade": "<grade/LUT description>",
    "audio_style": "<room tone, music bed or none>",
    "negative": "<things that must never appear>"
  },
  "scenes": [
    {
      "role": "<beat role given below>",
      "goal": "<what this clip must achieve>",
      "action": "<2-3 sentences: exactly what happens on screen, blocking, product handling>",
      "dialogue": "<the exact words spoken to camera in the target language, 12-22 words, or empty>",
      "camera": "<framing, movement, lens>",
      "sound": "<diegetic sound, foley, music cue>",
      "on_screen_text": "<text to add in editing later, not rendered by the video model>"
    }
  ],
  "tiktok": {
    "hook_text": "<3-6 word overlay for the first second>",
    "caption": "<TikTok caption, 1-2 lines, native tone>",
    "hashtags": ["<5-8 hashtags without #>"],
    "cover_text": "<cover title>"
  }
}`;

export function systemPrompt() {
  return [
    'You are a senior creative director for TikTok direct-response video. You write scripts that will be rendered as a sequence of short AI-generated clips by Google Veo, then stitched together.',
    'Your single most important job is CONSISTENCY: every clip is generated independently, so the "bible" you write must describe the person, outfit, product and setting so precisely that a video model will reproduce them identically ten times in a row. Be concrete: colors, fabrics, hair length, jewelry, props, light direction.',
    'Rules for the dialogue: natural spoken language, short sentences, first person, no corporate tone, no emojis, no hashtags inside dialogue. Each clip has a fixed duration; a person speaks about 2.5 words per second, so keep each clip\'s dialogue within the word budget you are given.',
    'Rules for UGC format: the creator is a real-looking person filming themselves on a phone; imperfect, honest, energetic. Product must be visible in hand in at least three clips. One idea per clip.',
    'Rules for product format: cinematic product film, no presenter unless the brief asks for one; macro textures, motion, premium lighting.',
    'Never invent claims the brief does not support (no medical, financial or guaranteed-result promises). Keep the brand name exactly as written in the brief.',
    'Answer with ONE JSON object only. No markdown, no commentary before or after.',
  ].join('\n\n');
}

function beatList(scenes) {
  return scenes
    .map(s => `  ${s.index}. role="${s.role}" (${s.seconds}s, max ${Math.round(s.seconds * 2.5)} spoken words): ${s.goal}`)
    .join('\n');
}

export function userPrompt({ brief, format = FORMATS.UGC, language = 'pt-BR', targetSeconds, clipSeconds, persona, hasReferenceImage = false, hasReferenceVideo = false, referenceNotes = '' }) {
  const scenes = planScenes({ format, targetSeconds, clipSeconds });
  const refLines = [];
  if (hasReferenceImage) {
    refLines.push('A reference image is attached. If it shows a person, describe THAT person in the bible (gender, age, hair, face, outfit) exactly as they appear; the video model will receive the same image. If it shows a product, describe THAT product exactly.');
  }
  if (hasReferenceVideo) {
    refLines.push('A frame from a reference video is attached. Match its creator, framing, energy and setting.');
  }
  if (referenceNotes) refLines.push(`Notes about the reference: ${referenceNotes}`);
  const personaLine = persona && persona !== 'auto'
    ? `The presenter must be a ${persona}.`
    : 'Choose the presenter (woman or man) that best fits the product and audience.';
  return [
    `BRIEF:\n${brief.trim()}`,
    `FORMAT: ${format}. TARGET LANGUAGE for dialogue, caption and hashtags: ${languageName(language)} (${language}).`,
    `STRUCTURE: exactly ${scenes.length} clips, in this order:\n${beatList(scenes)}`,
    format === FORMATS.UGC ? personaLine : 'Presenter: only if the brief explicitly asks for one.',
    refLines.join('\n'),
    `Return JSON with exactly this shape:\n${JSON_SHAPE}`,
  ].filter(Boolean).join('\n\n');
}

// One message for the Gemini web app (no system prompt there): the same
// instructions, asking for the JSON inside a fenced block so the chat UI
// renders it verbatim and the parser can lift it out.
export function chatScriptPrompt(options) {
  return [
    systemPrompt(),
    userPrompt(options),
    'Reply with the JSON object inside a single ```json code block and nothing else: no greeting, no explanation, no questions. Do not generate images or videos for this message.',
  ].join('\n\n');
}
