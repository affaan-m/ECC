// Scene planning: turns a target duration into a fixed sequence of clips with
// narrative roles. Pure functions, no browser APIs.

export const DEFAULT_TARGET_SECONDS = 45;
export const DEFAULT_CLIP_SECONDS = 8;
export const MIN_CLIPS = 3;
export const MAX_CLIPS = 10;

export const FORMATS = Object.freeze({
  UGC: 'ugc',
  PRODUCT: 'product',
});

// Narrative beats for a TikTok-native sales video. Order matters: the hook must
// land inside the first clip, the call to action in the last one.
const UGC_BEATS = Object.freeze([
  { role: 'hook', goal: 'Stop the scroll in the first 2 seconds with a bold claim, question or surprising moment.' },
  { role: 'problem', goal: 'Name the pain or desire the viewer has, in the first person.' },
  { role: 'reveal', goal: 'Introduce the product as the thing that changed it; show it clearly in hand.' },
  { role: 'demo', goal: 'Show the product being used in a real way; one concrete detail.' },
  { role: 'proof', goal: 'Result, before/after feeling, social proof or an objection handled.' },
  { role: 'cta', goal: 'Tell the viewer exactly what to do next (link, comment, follow).' },
]);

const PRODUCT_BEATS = Object.freeze([
  { role: 'hook', goal: 'Striking hero shot of the product with motion that grabs attention.' },
  { role: 'problem', goal: 'Visual tension: the situation the product solves.' },
  { role: 'reveal', goal: 'Product reveal with premium lighting; name/logo clearly readable.' },
  { role: 'demo', goal: 'Feature in action: macro details, texture, mechanism.' },
  { role: 'proof', goal: 'Benefit made visible; lifestyle context where it is used.' },
  { role: 'cta', goal: 'Final hero frame with offer and call to action.' },
]);

export function clipCountFor(targetSeconds, clipSeconds) {
  const safeTarget = Number(targetSeconds) > 0 ? Number(targetSeconds) : DEFAULT_TARGET_SECONDS;
  const safeClip = Number(clipSeconds) > 0 ? Number(clipSeconds) : DEFAULT_CLIP_SECONDS;
  const raw = Math.round(safeTarget / safeClip);
  return Math.min(MAX_CLIPS, Math.max(MIN_CLIPS, raw));
}

// Priority when there are fewer clips than beats: a sales video without a
// product reveal is useless, so reveal and demo survive before problem/proof.
const MIDDLE_PRIORITY = ['reveal', 'demo', 'proof', 'problem'];
const FILLER_ROLES = ['demo', 'proof'];

function spreadBeats(beats, count) {
  if (count === beats.length) return beats.map(b => ({ ...b }));
  const first = beats[0];
  const last = beats[beats.length - 1];
  const middle = beats.slice(1, -1);
  if (count < beats.length) {
    const keepRoles = MIDDLE_PRIORITY.filter(r => middle.some(b => b.role === r)).slice(0, count - 2);
    const kept = middle.filter(b => keepRoles.includes(b.role));
    return [first, ...kept, last].map(b => ({ ...b }));
  }
  const extra = count - beats.length;
  const out = beats.slice(0, -1).map(b => ({ ...b }));
  for (let i = 0; i < extra; i += 1) {
    const base = beats.find(b => b.role === FILLER_ROLES[i % FILLER_ROLES.length]);
    out.push({ role: `${base.role}_${Math.floor(i / FILLER_ROLES.length) + 2}`, goal: base.goal });
  }
  out.push({ ...last });
  return out;
}

export function planScenes({ format = FORMATS.UGC, targetSeconds, clipSeconds } = {}) {
  const seconds = Number(clipSeconds) > 0 ? Number(clipSeconds) : DEFAULT_CLIP_SECONDS;
  const count = clipCountFor(targetSeconds, seconds);
  const beats = format === FORMATS.PRODUCT ? PRODUCT_BEATS : UGC_BEATS;
  return spreadBeats(beats, count).map((beat, i) => ({
    index: i + 1,
    role: beat.role,
    goal: beat.goal,
    seconds,
  }));
}

export function totalSeconds(scenes) {
  return scenes.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0);
}
