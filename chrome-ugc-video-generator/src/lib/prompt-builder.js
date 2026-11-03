// Composes the final prompt sent to the video model for each clip. The bible
// block is injected verbatim; the scene adds action, dialogue and continuity.

import { renderBibleBlock, bibleAnchors } from './character-bible.js';
import { FORMATS } from './plan.js';

export const DEFAULT_NEGATIVE = 'no subtitles, no captions, no on-screen text, no watermark, no logo overlays, no extra people, no outfit change, no hairstyle change, no morphing, no distorted hands, no flicker';

const LANGUAGE_NAMES = Object.freeze({
  'pt-BR': 'Brazilian Portuguese',
  'en-US': 'American English',
  'es-419': 'Latin American Spanish',
});

export function languageName(code) {
  return LANGUAGE_NAMES[code] || code || 'Brazilian Portuguese';
}

function header(scene, total, { aspect = '9:16', seconds }) {
  const dur = Number(seconds || scene.seconds) || 8;
  return `[Clip ${scene.index}/${total} | ${dur}s | vertical ${aspect} 1080x1920 | TikTok]`;
}

function dialogueLine(scene, lang) {
  const text = scene.dialogue && String(scene.dialogue).trim();
  if (!text) return 'DIALOGUE: none. Natural ambient sound only.';
  return `DIALOGUE (spoken to camera in ${languageName(lang)}, lip-synced, natural pace, exactly these words): "${text}"`;
}

function continuityLine(scene, total) {
  if (scene.index === 1) {
    return 'CONTINUITY: this is the opening clip; establish the look that every later clip will match.';
  }
  const tail = scene.index === total ? ' This is the final clip; end on a clean, holdable last frame.' : '';
  return `CONTINUITY: continues directly from the previous clip. Same person, same outfit, same hair, same location, same time of day, same lens and grade.${tail}`;
}

export function renderScenePrompt({ bible, scene, total, language = 'pt-BR', format = FORMATS.UGC, aspect = '9:16', hasReference = false, negative }) {
  const parts = [
    header(scene, total, { aspect, seconds: scene.seconds }),
    renderBibleBlock(bible, { hasReference }),
    `SHOT PURPOSE (${scene.role}): ${scene.goal || ''}`.trim(),
    `ACTION: ${scene.action || ''}`.trim(),
    scene.camera ? `CAMERA: ${scene.camera}` : '',
    format === FORMATS.UGC ? dialogueLine(scene, language) : (scene.dialogue ? dialogueLine(scene, language) : 'DIALOGUE: none. Music-driven product film.'),
    scene.sound ? `SOUND DESIGN: ${scene.sound}` : '',
    continuityLine(scene, total),
    `NEGATIVE: ${negative || bible?.negative || DEFAULT_NEGATIVE}.`,
  ];
  return parts.filter(Boolean).join('\n');
}

export function renderAllPrompts(script, options = {}) {
  const scenes = script.scenes || [];
  const total = scenes.length;
  return scenes.map(scene => ({
    index: scene.index,
    role: scene.role,
    seconds: scene.seconds,
    prompt: renderScenePrompt({
      bible: script.bible,
      scene,
      total,
      language: script.language || options.language,
      format: script.format || options.format,
      aspect: options.aspect,
      hasReference: Boolean(options.hasReference),
      negative: options.negative,
    }),
  }));
}

// Every rendered prompt must contain every bible anchor. Returns problems.
export function validateConsistency(script, rendered) {
  const anchors = bibleAnchors(script.bible);
  const problems = [];
  for (const r of rendered) {
    for (const anchor of anchors) {
      if (!r.prompt.includes(anchor)) {
        problems.push({ index: r.index, missing: anchor });
      }
    }
  }
  return problems;
}
