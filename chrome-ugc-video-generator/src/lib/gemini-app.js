// How a clip prompt is handed to the Gemini web app. Gemini 4 Argon routes
// video requests to Veo when asked explicitly, so every message starts with a
// short, unambiguous instruction and the rendered clip prompt follows.

export function wrapForGeminiApp(prompt, { index, total, seconds = 8, aspect = '9:16', sameConversation = true } = {}) {
  const lead = [`Create one ${seconds}-second vertical ${aspect} video with Veo from the prompt below, with native audio and the dialogue spoken exactly as written. Generate the video directly, without rewriting the prompt or asking questions.`];
  if (sameConversation && index > 1) {
    lead.push(`This is clip ${index} of ${total} of the same video: keep the same person, outfit, product, location and grade as the previous clip(s) in this conversation.`);
  }
  if (sameConversation && index === 1 && total > 1) {
    lead.push(`This is clip 1 of ${total}; the next clips come in this same conversation.`);
  }
  return `${lead.join(' ')}\n\n${prompt}`;
}

// The Gemini app answers "I can't generate that video" when Veo's policy
// filter rejects a prompt, without saying why. Each level strips the parts
// that most often trip the filter so the clip can be retried automatically.
//   1: drop quoted text to render, the negative list and continuity notes.
//   2: also drop the dialogue (lip-synced speech) and the reference image.
export const MAX_SOFTEN_LEVEL = 2;

export function softenPrompt(prompt, level = 1) {
  if (!level) return String(prompt || '');
  const kept = String(prompt || '')
    .split('\n')
    .filter(line => !/^(NEGATIVE|CONTINUITY|SHOT PURPOSE):/i.test(line))
    .map(line => line.replace(/\s*(reading|that says|with the text|labell?ed)\s+'[^']{2,}'/gi, ' with legible brand lettering').replace(/'[^']{2,}'/g, 'brand lettering'))
    .map(line => (level >= 2 && /^DIALOGUE/i.test(line) ? 'DIALOGUE: none. Natural ambient sound only.' : line))
    .map(line => (level >= 2 ? line.replace(/^REFERENCE:.*$/i, '') : line))
    .filter(line => line.trim());
  return kept.join('\n');
}

// Messages the Gemini app shows when a video request is rejected.
export const REFUSAL_PATTERN = /can(?:'|’|no)t (?:generate|create|make) (?:that|this) video|unable to (?:generate|create) (?:that|this) video|n[aã]o (?:consigo|posso|pude) (?:gerar|criar) (?:esse|este|o) v[ií]deo|video policy|pol[ií]tica de v[ií]deo/i;

export function isRefusal(text) {
  return REFUSAL_PATTERN.test(String(text || ''));
}

export const DEFAULT_SELECTORS = Object.freeze({
  editor: ['div.ql-editor[contenteditable="true"]', 'rich-textarea div[contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]', 'textarea'],
  send: ['button[aria-label="Send message" i]', 'button[aria-label="Enviar mensagem" i]', 'button.send-button', 'button[data-test-id="send-button"]', 'button[aria-label*="Send" i]:not([aria-label*="file" i])', 'button[aria-label*="Enviar" i]:not([aria-label*="arquivo" i])'],
  newChat: ['a[aria-label*="New chat" i]', 'a[aria-label*="Nova conversa" i]', 'button[aria-label*="New chat" i]', 'button[aria-label*="Nova conversa" i]', 'a[href="/app"]'],
  toolsMenu: ['button[aria-label*="Tools" i]', 'button[aria-label*="Ferramentas" i]', 'button[aria-label*="Open upload" i]', 'button[aria-label*="Add files" i]', 'button[aria-label*="Adicionar" i]', 'button.upload-card-button'],
  videoTool: ['[role="menuitem"]', 'button', 'mat-chip', 'div[role="option"]'],
  videoToolText: /create videos?|criar v[ií]deos?|gerar v[ií]deo|^v[ií]deo$|^video$/i,
  fileInput: ['input[type="file"]'],
  uploadMenu: ['button[aria-label*="Upload" i]', 'button[aria-label*="Enviar arquivo" i]', 'button[aria-label*="Add files" i]', 'button[aria-label*="Adicionar" i]', 'button[aria-label*="Open upload" i]'],
  uploadItemText: /upload files?|fazer upload|enviar arquivo|carregar arquivo|from (your )?(device|computer)|do (seu )?(dispositivo|computador)/i,
  response: ['model-response', '.model-response', '[data-test-id="model-response"]', 'message-content', '.response-container'],
  video: ['video'],
  download: ['button[aria-label*="Download" i]', 'button[aria-label*="Baixar" i]', 'a[download]'],
  generating: ['button[aria-label*="Stop" i]', 'button[aria-label*="Parar" i]', 'button[aria-label*="Interromper" i]', '.stop-icon', '[aria-label*="generating" i]', '.loading-indicator', 'mat-progress-bar', '[role="progressbar"]'],
});

export function mergeSelectors(overrides = {}) {
  const out = { ...DEFAULT_SELECTORS };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (!(key in out)) continue;
    if (Array.isArray(value) && value.length) out[key] = value.map(String);
    else if (typeof value === 'string' && value.trim()) {
      out[key] = key.endsWith('Text') ? new RegExp(value, 'i') : [value.trim()];
    }
  }
  return out;
}

// Selectors for the model picker in the chat header ("Flash", "Argon"...).
// Only used when the user set a preferred model name in the options page.
export const MODEL_PICKER_SELECTORS = Object.freeze({
  modelPicker: ['button[aria-label*="model" i]', 'button[aria-label*="modelo" i]', 'button[data-test-id="bard-mode-menu-button"]', 'bard-mode-switcher button'],
  modelOption: ['[role="menuitem"]', '[role="option"]', 'button'],
});

// The Gemini UI wraps code blocks with a language label and a copy button;
// strip those so the JSON parser sees only the block.
export function cleanChatAnswer(text) {
  return String(text || '')
    .replace(/^\s*(json|JSON)\s*$/gm, '')
    .replace(/^\s*(copiar c[oó]digo|copy code|content_copy)\s*$/gim, '')
    .trim();
}

// True when a streamed answer that should carry a JSON object looks finished:
// the fenced block is closed, or (without fences) braces balance and the text
// ends on the closing brace. Used to avoid reading a half-streamed answer.
export function jsonLooksComplete(text) {
  const t = String(text || '').trim();
  if (!t.includes('{')) return false;
  const fences = (t.match(/```/g) || []).length;
  if (fences === 1) return false;
  const body = fences >= 2 ? (t.match(/```(?:json)?\s*([\s\S]*?)```/i) || [])[1] || '' : t;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
  }
  return depth === 0 && body.trim().endsWith('}');
}
