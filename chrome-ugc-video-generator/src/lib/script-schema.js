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

// Cheap repairs for the defects LLM answers (and chat renderers) commonly
// introduce. Each step is tried in order until JSON.parse succeeds.
const REPAIRS = [
  ['smart quotes', t => t.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")],
  ['control characters', t => Array.from(t).filter(ch => {
    const code = ch.charCodeAt(0);
    return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
  }).join('')],
  ['trailing commas', t => t.replace(/,(\s*[}\]])/g, '$1')],
  ['missing commas between lines', t => t.replace(/("|\d|true|false|null|\]|\})[ \t]*\n(\s*)(?=["{[])/g, '$1,\n$2')],
  ['missing commas before keys', t => t.replace(/("|\d|true|false|null|\]|\})[ \t]+(?=")/g, '$1, ')],
];

function snippetAt(text, message) {
  const m = message.match(/position (\d+)/);
  if (!m) return '';
  const pos = Number(m[1]);
  return text.slice(Math.max(0, pos - 90), pos + 40).replace(/\s+/g, ' ');
}

export function repairJson(candidate) {
  let text = candidate;
  let firstError = null;
  for (const [, repair] of [['none', t => t], ...REPAIRS]) {
    text = repair(text);
    try {
      return { value: JSON.parse(text), repaired: text !== candidate };
    } catch (err) {
      firstError = firstError || err;
    }
  }
  throw new ScriptParseError(`Invalid JSON from LLM: ${firstError.message}. Near: …${snippetAt(candidate, firstError.message)}…`, candidate);
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
  return repairJson(candidate.slice(start, end + 1)).value;
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
