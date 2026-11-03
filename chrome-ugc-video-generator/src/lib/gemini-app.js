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
  response: ['model-response', '.model-response', '[data-test-id="model-response"]', 'message-content'],
  video: ['video'],
  download: ['button[aria-label*="Download" i]', 'button[aria-label*="Baixar" i]', 'a[download]'],
  generating: ['[aria-label*="generating" i]', '.loading-indicator', 'mat-progress-bar', '[role="progressbar"]'],
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
