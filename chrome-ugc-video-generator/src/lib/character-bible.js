// The "bible" is the block of text repeated verbatim at the top of every clip
// prompt. Repeating the exact same wording is what keeps Veo rendering the
// same person, outfit, setting and grade across independently generated clips.

const CHARACTER_FIELDS = ['gender', 'age', 'ethnicity', 'face', 'hair', 'build', 'outfit', 'accessories', 'voice'];
const PRODUCT_FIELDS = ['name', 'look', 'packaging', 'key_detail'];
const WORLD_FIELDS = ['setting', 'lighting', 'camera_style', 'color_grade', 'audio_style'];

// Values the script writer uses to say "nothing here". Dropping them keeps
// the prompt free of noise like "Accessories: none" or "Face: not visible".
const PLACEHOLDER = /^(none|n\/a|na|nil|null|not (visible|applicable|shown|specified|on camera)|nenhum[ao]?|n[aã]o (vis[ií]vel|se aplica|aparece))[.!]?$/i;

function clean(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\s+/g, ' ').replace(/[\s.;,]+$/g, '').trim();
  return PLACEHOLDER.test(text) ? '' : text;
}

function pick(obj, fields) {
  const out = {};
  for (const f of fields) {
    const v = clean(obj && obj[f]);
    if (v) out[f] = v;
  }
  return out;
}

export function normalizeBible(raw = {}) {
  const character = pick(raw.character || {}, CHARACTER_FIELDS);
  const product = pick(raw.product || {}, PRODUCT_FIELDS);
  const world = pick(raw, WORLD_FIELDS);
  const negative = clean(raw.negative);
  return { character, product, ...world, negative };
}

function sentence(parts) {
  return parts.filter(Boolean).join(', ');
}

export function characterSentence(character = {}) {
  const c = character;
  if (!Object.keys(c).length) return '';
  return sentence([
    c.gender && c.age ? `${c.age} ${c.gender}` : c.gender || c.age,
    c.ethnicity,
    c.face,
    c.hair,
    c.build,
  ]);
}

export function outfitSentence(character = {}) {
  return sentence([character.outfit, character.accessories]);
}

export function productSentence(product = {}) {
  return sentence([product.name, product.look, product.packaging, product.key_detail]);
}

// Renders the locked block. Deterministic: same bible -> same text, always.
export function renderBibleBlock(bible, { hasReference = false } = {}) {
  const b = normalizeBible(bible);
  const lines = [];
  if (hasReference) lines.push('REFERENCE: the attached image is the visual reference; match what it shows (the person and/or the product) exactly.');
  const who = characterSentence(b.character);
  if (who) lines.push(`CHARACTER (identical in every shot): ${who}.`);
  const outfit = outfitSentence(b.character);
  if (outfit) lines.push(`WEARING EXACTLY (never changes): ${outfit}.`);
  const prod = productSentence(b.product);
  if (prod) lines.push(`PRODUCT (identical in every shot): ${prod}.`);
  if (b.setting) lines.push(`SETTING: ${b.setting}.`);
  if (b.lighting) lines.push(`LIGHTING: ${b.lighting}.`);
  if (b.camera_style) lines.push(`CAMERA STYLE: ${b.camera_style}.`);
  if (b.color_grade) lines.push(`COLOR GRADE: ${b.color_grade}.`);
  if (b.audio_style) lines.push(`AUDIO: ${b.audio_style}.`);
  return lines.join('\n');
}

// Returns the list of bible phrases that must appear in a prompt for it to be
// considered consistent. Used by the validator and by tests.
export function bibleAnchors(bible) {
  const b = normalizeBible(bible);
  return [
    characterSentence(b.character),
    outfitSentence(b.character),
    productSentence(b.product),
    b.setting,
    b.lighting,
  ].filter(Boolean);
}
