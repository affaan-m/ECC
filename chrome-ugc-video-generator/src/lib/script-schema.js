// Parses and normalizes the JSON script returned by the LLM. The LLM is told
// to answer with JSON only, but we defensively strip fences and prose.

import { normalizeBible } from './character-bible.js';
import { planScenes, FORMATS } from './plan.js';

export class ScriptParseError extends Error {
  constructor(message, raw) {
    super(message);
    this.name = 'ScriptParseError';
    this.raw = raw;
  }
}

export function extractJson(text) {
  if (typeof text !== 'string') throw new ScriptParseError('LLM returned no text', text);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new ScriptParseError('No JSON object found in LLM answer', text);
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (err) {
    throw new ScriptParseError(`Invalid JSON from LLM: ${err.message}`, text);
  }
}

function str(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function normalizeScene(raw, planned) {
  return {
    index: planned.index,
    role: str(raw.role) || planned.role,
    goal: str(raw.goal) || planned.goal,
    seconds: planned.seconds,
    action: str(raw.action),
    dialogue: str(raw.dialogue),
    camera: str(raw.camera),
    sound: str(raw.sound),
    on_screen_text: str(raw.on_screen_text),
  };
}

function normalizeTiktok(raw = {}) {
  const hashtags = Array.isArray(raw.hashtags)
    ? raw.hashtags.map(h => str(h).replace(/^#/, '')).filter(Boolean)
    : str(raw.hashtags).split(/[\s,]+/).map(h => h.replace(/^#/, '')).filter(Boolean);
  return {
    caption: str(raw.caption),
    hook_text: str(raw.hook_text),
    hashtags,
    cover_text: str(raw.cover_text),
  };
}

// Aligns the LLM scenes with the planned beats so clip count and durations are
// always what the planner decided, regardless of what the model produced.
export function normalizeScript(raw, plan) {
  if (!raw || typeof raw !== 'object') throw new ScriptParseError('Script is not an object', raw);
  const format = plan.format === FORMATS.PRODUCT ? FORMATS.PRODUCT : FORMATS.UGC;
  const planned = planScenes({ format, targetSeconds: plan.targetSeconds, clipSeconds: plan.clipSeconds });
  const rawScenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  const scenes = planned.map((p, i) => normalizeScene(rawScenes[i] || {}, p));
  const missing = scenes.filter(s => !s.action).map(s => s.index);
  if (missing.length) {
    throw new ScriptParseError(`LLM script is missing the action for clip(s) ${missing.join(', ')}`, raw);
  }
  return {
    format,
    language: plan.language || 'pt-BR',
    title: str(raw.title),
    concept: str(raw.concept),
    bible: normalizeBible(raw.bible || {}),
    scenes,
    tiktok: normalizeTiktok(raw.tiktok || {}),
  };
}

export function parseScript(text, plan) {
  return normalizeScript(extractJson(text), plan);
}
