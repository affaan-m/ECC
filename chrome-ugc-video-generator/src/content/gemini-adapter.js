// Content script for gemini.google.com. It is the only part of the extension
// that touches Google's DOM, so every selector lives in one table (overridable
// from the options page) and every step reports what it matched.
//
// Protocol: 'gemini:generateClip' is acknowledged at once; the result arrives
// later as 'clip:result' or 'clip:error' so the worker never waits minutes on
// a single message.
(() => {
  if (window.__ugcDirectorLoaded) return;
  window.__ugcDirectorLoaded = true;

  const DEFAULTS = {
    editor: ['div.ql-editor[contenteditable="true"]', 'rich-textarea div[contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]', 'textarea'],
    send: ['button[aria-label="Send message" i]', 'button[aria-label="Enviar mensagem" i]', 'button.send-button', 'button[data-test-id="send-button"]', 'button[aria-label*="Send" i]:not([aria-label*="file" i])', 'button[aria-label*="Enviar" i]:not([aria-label*="arquivo" i])'],
    newChat: ['a[aria-label*="New chat" i]', 'a[aria-label*="Nova conversa" i]', 'button[aria-label*="New chat" i]', 'button[aria-label*="Nova conversa" i]', 'a[href="/app"]'],
    toolsMenu: ['button[aria-label*="Tools" i]', 'button[aria-label*="Ferramentas" i]', 'button[aria-label*="Open upload" i]', 'button[aria-label*="Add files" i]', 'button[aria-label*="Adicionar" i]', 'button.upload-card-button'],
    videoTool: ['[role="menuitem"]', 'button', 'mat-chip', 'div[role="option"]'],
    videoToolText: 'create videos?|criar v[ií]deos?|gerar v[ií]deo|^v[ií]deo$|^video$',
    fileInput: ['input[type="file"]'],
    uploadMenu: ['button[aria-label*="Upload" i]', 'button[aria-label*="Enviar arquivo" i]', 'button[aria-label*="Add files" i]', 'button[aria-label*="Adicionar" i]', 'button[aria-label*="Open upload" i]'],
    uploadItemText: 'upload files?|fazer upload|enviar arquivo|carregar arquivo|from (your )?(device|computer)|do (seu )?(dispositivo|computador)',
    response: ['model-response', '.model-response', '[data-test-id="model-response"]', 'message-content'],
    video: ['video'],
    download: ['button[aria-label*="Download" i]', 'button[aria-label*="Baixar" i]', 'a[download]'],
    generating: ['[aria-label*="generating" i]', '.loading-indicator', 'mat-progress-bar', '[role="progressbar"]'],
  };
  const SEND_CONFIRM_MS = 12000;
  const TEXT_ONLY_GRACE_MS = 45000;
  const HEARTBEAT_MS = 15000;
  const MAX_BLOB_BYTES = 200 * 1024 * 1024;

  let selectors = { ...DEFAULTS };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => Boolean(el) && el.getClientRects().length > 0 && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const isActive = el => ['aria-pressed', 'aria-selected', 'aria-checked'].some(a => el.getAttribute(a) === 'true') || /\b(selected|active)\b/.test(el.className || '');

  function applyOverrides(overrides) {
    selectors = { ...DEFAULTS, ...(overrides || {}) };
  }

  function first(key, { mustBeVisible = true } = {}) {
    for (const sel of selectors[key] || []) {
      for (const el of document.querySelectorAll(sel)) {
        if (!mustBeVisible || visible(el)) return el;
      }
    }
    return null;
  }

  async function waitFor(key, timeoutMs = 8000, opts) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const el = first(key, opts);
      if (el) return el;
      await sleep(200);
    }
    return null;
  }

  function byText(key, patternKey) {
    const re = new RegExp(selectors[patternKey], 'i');
    for (const sel of selectors[key] || []) {
      for (const el of document.querySelectorAll(sel)) {
        const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
        if (visible(el) && re.test(text)) return el;
      }
    }
    return null;
  }

  const send = message => chrome.runtime.sendMessage(message).catch(() => {});
  const heartbeat = (stage, index) => send({ type: 'clip:heartbeat', stage, index });

  async function startNewChat() {
    const link = first('newChat');
    if (!link) return false;
    link.click();
    await sleep(1200);
    return true;
  }

  async function selectVideoTool() {
    let item = byText('videoTool', 'videoToolText');
    if (item && isActive(item)) return true;
    if (!item) {
      const menu = first('toolsMenu');
      if (!menu) return false;
      menu.click();
      await sleep(600);
      item = byText('videoTool', 'videoToolText');
    }
    if (!item) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
    if (!isActive(item)) item.click();
    await sleep(500);
    return true;
  }

  function imageToFile(image, name) {
    const bytes = atob(image.base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) arr[i] = bytes.charCodeAt(i);
    return new File([arr], name, { type: image.mimeType });
  }

  async function attachImages(images) {
    if (!images?.length) return 0;
    let input = first('fileInput', { mustBeVisible: false });
    if (!input) {
      const menu = first('uploadMenu') || first('toolsMenu');
      if (menu) {
        menu.click();
        await sleep(600);
        const item = byText('videoTool', 'uploadItemText');
        if (item) {
          item.click();
          await sleep(400);
        }
      }
      input = await waitFor('fileInput', 4000, { mustBeVisible: false });
    }
    if (!input) throw new Error('Could not find the file upload input on the Gemini page.');
    const dt = new DataTransfer();
    images.forEach((img, i) => dt.items.add(imageToFile(img, `reference-${i + 1}.${img.mimeType.includes('png') ? 'png' : 'jpg'}`)));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(2500);
    return images.length;
  }

  const editorText = editor => (editor.tagName === 'TEXTAREA' ? editor.value : editor.innerText || '').trim();

  async function typePrompt(text) {
    const editor = await waitFor('editor', 8000);
    if (!editor) throw new Error('Could not find the prompt editor on the Gemini page.');
    editor.focus();
    if (editor.tagName === 'TEXTAREA') {
      editor.value = text;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return editor;
    }
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    await sleep(300);
    if (editorText(editor).length < Math.min(40, text.length)) {
      throw new Error('Could not type into the Gemini prompt editor (insertText rejected).');
    }
    return editor;
  }

  async function sendPrompt(editor) {
    const btn = await waitFor('send', 5000);
    if (btn) btn.click();
    else editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    const started = Date.now();
    while (Date.now() - started < SEND_CONFIRM_MS) {
      if (!editorText(editor)) return true;
      await sleep(300);
    }
    throw new Error('The prompt was not sent (send button not found or disabled).');
  }

  const responses = () => {
    for (const sel of selectors.response) {
      const list = Array.from(document.querySelectorAll(sel));
      if (list.length) return list;
    }
    return [];
  };
  const videosIn = scope => Array.from(scope.querySelectorAll(selectors.video.join(','))).filter(v => v.currentSrc || v.src || v.querySelector('source'));
  const isGenerating = () => Boolean(first('generating'));

  // Accepts only a video that lives inside a response created after the send.
  async function waitForNewVideo({ responseCountBefore, videosBefore, timeoutMs, index }) {
    const started = Date.now();
    let lastBeat = 0;
    let textSeenAt = 0;
    while (Date.now() - started < timeoutMs) {
      const list = responses();
      const fresh = list.length > responseCountBefore ? list.slice(responseCountBefore) : [];
      const scope = fresh.length ? fresh : [document];
      const candidates = scope.flatMap(videosIn).filter(v => !videosBefore.has(v) && (v.currentSrc || v.src) && v.readyState >= 1);
      if (candidates.length && !isGenerating()) return candidates[candidates.length - 1];
      if (fresh.length && !candidates.length && !isGenerating() && fresh[fresh.length - 1].innerText.trim().length > 80) {
        textSeenAt = textSeenAt || Date.now();
        if (Date.now() - textSeenAt > TEXT_ONLY_GRACE_MS) {
          throw new Error(`Gemini answered with text instead of a video: "${fresh[fresh.length - 1].innerText.trim().slice(0, 160)}"`);
        }
      } else {
        textSeenAt = 0;
      }
      if (Date.now() - lastBeat > HEARTBEAT_MS) {
        heartbeat('waiting', index);
        lastBeat = Date.now();
      }
      await sleep(1000);
    }
    throw new Error(`Timed out after ${Math.round(timeoutMs / 60000)} min waiting for the video.`);
  }

  async function fetchVideoBlob(src) {
    try {
      const res = await fetch(src, { credentials: 'include' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return blob.size > 0 && blob.size <= MAX_BLOB_BYTES ? blob : null;
    } catch {
      return null;
    }
  }

  // A frame drawn from a same-origin blob is not tainted, unlike the page's
  // own cross-origin <video>. Seeks past the first (often black) frame.
  async function frameFromBlob(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const v = document.createElement('video');
      v.muted = true;
      v.src = url;
      await new Promise((resolve, reject) => {
        v.onloadedmetadata = resolve;
        v.onerror = () => reject(new Error('frame'));
        setTimeout(resolve, 4000);
      });
      v.currentTime = Math.min(1.5, (v.duration || 2) / 2);
      await new Promise(resolve => {
        v.onseeked = resolve;
        setTimeout(resolve, 3000);
      });
      if (!v.videoWidth) return null;
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 720 / v.videoWidth);
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
      return { mimeType: 'image/jpeg', base64: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] };
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function saveBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function responseContainer(video) {
    for (const sel of selectors.response) {
      const c = video.closest(sel);
      if (c) return c;
    }
    return video.parentElement;
  }

  async function clickDownload(video) {
    const scope = responseContainer(video) || document;
    for (const sel of selectors.download) {
      const btn = Array.from(scope.querySelectorAll(sel)).find(visible);
      if (btn) {
        btn.click();
        await sleep(800);
        return true;
      }
    }
    return false;
  }

  async function generateClip(msg) {
    applyOverrides(msg.selectors);
    const index = msg.index;
    if (msg.newChat) await startNewChat();
    heartbeat('preparing', index);
    const videosBefore = new Set(videosIn(document));
    const responseCountBefore = responses().length;
    const toolSelected = await selectVideoTool();
    const attached = await attachImages(msg.images);
    const editor = await typePrompt(msg.prompt);
    await sendPrompt(editor);
    heartbeat('sent', index);
    const video = await waitForNewVideo({ responseCountBefore, videosBefore, timeoutMs: msg.timeoutMs || 600000, index });
    video.scrollIntoView({ block: 'center' });
    const src = video.currentSrc || video.src;
    const blob = await fetchVideoBlob(src);
    let downloadedByPage = false;
    if (blob) {
      saveBlob(blob, msg.fileName || `clip-${index}.mp4`);
      downloadedByPage = true;
    } else {
      downloadedByPage = await clickDownload(video);
    }
    const anchorFrame = msg.wantAnchor && blob ? await frameFromBlob(blob) : null;
    return { videoUrl: /^https:/.test(src) ? src : '', downloadedByPage, anchorFrame, toolSelected, attached };
  }

  function probe() {
    const report = {};
    for (const key of Object.keys(DEFAULTS)) {
      if (key.endsWith('Text')) continue;
      const el = first(key, { mustBeVisible: key !== 'fileInput' });
      report[key] = el ? `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}` : null;
    }
    report.videoTool = byText('videoTool', 'videoToolText') ? 'found' : null;
    report.videosOnPage = videosIn(document).length;
    report.responses = responses().length;
    report.url = location.href;
    return report;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'gemini:probe') {
      sendResponse(probe());
      return false;
    }
    if (msg?.type === 'gemini:ping') {
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'gemini:generateClip') {
      sendResponse({ accepted: true });
      generateClip(msg)
        .then(result => send({ type: 'clip:result', index: msg.index, result }))
        .catch(err => send({ type: 'clip:error', index: msg.index, error: err.message || String(err) }));
      return false;
    }
    return false;
  });
})();
