// How a clip prompt is handed to the Gemini web app. Gemini 4 Argon routes
// video requests to Veo when asked explicitly, so every message starts with a
// short, unambiguous instruction and the rendered clip prompt follows.

export function wrapForGeminiApp(prompt, { index, total, seconds = 8, aspect = '9:16', sameConversation = true } = {}) {
  const lead = [
    `Generate ONE video clip with Veo now. Vertical ${aspect}, ${seconds} seconds, 1080p, with native audio and lip-synced dialogue.`,
    'Do not describe or rewrite the prompt, do not ask questions, do not add text overlays: just generate the video from the prompt below exactly as written.',
  ];
  if (sameConversation && index > 1) {
    lead.push(`This is clip ${index} of ${total} of the same video. Keep the exact same person, outfit, hair, product, location and grade as the clip(s) you already generated in this conversation.`);
  }
  if (sameConversation && index === 1 && total > 1) {
    lead.push(`This is clip 1 of ${total}. I will ask for the next clips in this same conversation; keep this look locked.`);
  }
  return `${lead.join(' ')}\n\n${prompt}`;
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
