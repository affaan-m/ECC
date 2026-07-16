'use strict';

/**
 * Plan Canvas browser chrome: the editor shell that frames an artifact,
 * plus the rendered-markdown artifact template.
 *
 * Visual language mirrors the ECC web dashboard (scripts/dashboard-web.js):
 * same design tokens, dark-first with a light theme, accent→pink brand
 * gradient. Everything is served inline — no CDNs, no external assets.
 */

const path = require('path');

const { escapeHtml } = require('./markdown');

// Pinned Mermaid ESM build, loaded in the browser only when an artifact
// actually contains a diagram. Override with a local/vendored URL (e.g. an
// air-gapped mirror) via ECC_PLAN_CANVAS_MERMAID_URL. If the fetch fails, the
// diagram source stays visible as a styled code block — nothing breaks.
const DEFAULT_MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs';

function mermaidUrl(env = process.env) {
  const override = env.ECC_PLAN_CANVAS_MERMAID_URL;
  return override && String(override).trim() ? String(override).trim() : DEFAULT_MERMAID_URL;
}

// Browser module that renders `<pre class="mermaid">` blocks, themed to match
// the ECC canvas. Kept import-only so a CDN failure degrades gracefully.
function mermaidLoaderScript(url) {
  return `<script type="module">
  try {
    const mermaid = (await import(${JSON.stringify(url)})).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      themeVariables: {
        primaryColor: '#13161e', primaryBorderColor: '#6885e8', primaryTextColor: '#dfe2e9',
        lineColor: '#80859a', secondaryColor: '#191d2a', tertiaryColor: '#101218',
        background: '#080a0e', mainBkg: '#13161e', clusterBkg: '#0d0f14'
      }
    });
    await mermaid.run({ querySelector: '.mermaid' });
  } catch (err) {
    document.querySelectorAll('.mermaid').forEach(el => el.classList.add('mermaid-unrendered'));
    console.warn('Mermaid render skipped:', err && err.message);
  }
</script>`;
}

// Design tokens shared by the chrome and the markdown artifact template.
const TOKENS_CSS = `
  :root{
    --bg:#080a0e; --bg2:#0d0f14; --bg3:#13161e; --bg4:#191d2a;
    --surface:#101218; --surface-hover:#171a24; --border:#1d2130; --border-light:#272c3e;
    --text:#dfe2e9; --text2:#80859a; --text3:#4c5168;
    --accent:#6885e8; --accent-glow:rgba(104,133,232,0.15); --accent-dim:#3d5ab8;
    --green:#4acb8a; --green-glow:rgba(74,203,138,0.15);
    --orange:#eca85a; --orange-glow:rgba(236,168,90,0.15);
    --pink:#e26a9e; --pink-glow:rgba(226,106,158,0.15);
    --red:#e86060; --red-glow:rgba(232,96,96,0.15);
    --teal:#4acbbe; --teal-glow:rgba(74,203,190,0.15);
    --radius:8px; --radius-sm:5px;
    --font:-apple-system,BlinkMacSystemFont,'SF Pro Display','Inter','Segoe UI',Roboto,sans-serif;
    --mono:'SF Mono','Fira Code','JetBrains Mono','Cascadia Code',monospace;
    --shadow:0 1px 2px rgba(0,0,0,0.4);
    --shadow-lg:0 8px 32px rgba(0,0,0,0.6);
  }
  [data-theme="light"]{
    --bg:#f4f5f7; --bg2:#ffffff; --bg3:#eaecef; --bg4:#dfe2e6;
    --surface:#ffffff; --surface-hover:#f4f5f7; --border:#cdd1d9; --border-light:#dde1e8;
    --text:#181b23; --text2:#585e6e; --text3:#9197a8;
    --accent:#4560d0; --accent-glow:rgba(69,96,208,0.08); --accent-dim:#2f44a0;
    --green:#16a34a; --green-glow:rgba(22,163,74,0.08);
    --orange:#d97706; --orange-glow:rgba(217,119,6,0.08);
    --pink:#c73877; --pink-glow:rgba(199,56,119,0.08);
    --red:#dc2626; --red-glow:rgba(220,38,38,0.08);
    --teal:#0d9488; --teal-glow:rgba(13,148,136,0.08);
    --shadow:0 1px 2px rgba(0,0,0,0.04);
    --shadow-lg:0 8px 32px rgba(0,0,0,0.08);
  }
`;

function canvasCss() {
  return `${TOKENS_CSS}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%}
  body{font-family:var(--font);background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;line-height:1.4;overflow:hidden}
  ::selection{background:var(--accent);color:#fff}
  ::-webkit-scrollbar{width:8px;height:8px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
  button{font-family:var(--font)}

  .bar{display:flex;align-items:center;gap:12px;height:52px;padding:0 16px;background:color-mix(in srgb,var(--bg2) 88%,transparent);border-bottom:1px solid var(--border);backdrop-filter:blur(16px)}
  .brand{display:flex;align-items:center;gap:9px;min-width:0}
  .brand .logo{width:26px;height:26px;flex:none;background:linear-gradient(135deg,var(--accent),var(--pink));border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff}
  .brand .name{font-size:13.5px;font-weight:600;white-space:nowrap}
  .brand .file{font-size:11.5px;color:var(--text2);font-family:var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:34vw}
  .bar .spacer{flex:1}

  .presence{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:500;color:var(--text2);background:var(--bg3);border:1px solid var(--border);border-radius:99px;padding:3px 10px 3px 8px;white-space:nowrap}
  .presence .dot{width:7px;height:7px;border-radius:99px;background:var(--text3)}
  .presence[data-state="listening"] .dot{background:var(--green);box-shadow:0 0 0 3px var(--green-glow);animation:pulse 2s infinite}
  .presence[data-state="working"] .dot{background:var(--orange);box-shadow:0 0 0 3px var(--orange-glow)}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}

  .toggle{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--text2);cursor:pointer;user-select:none}
  .toggle .track{width:30px;height:17px;border-radius:99px;background:var(--bg4);border:1px solid var(--border);position:relative;transition:background .15s}
  .toggle .knob{position:absolute;top:1px;left:1px;width:13px;height:13px;border-radius:99px;background:var(--text2);transition:transform .15s,background .15s}
  .toggle[aria-pressed="true"] .track{background:var(--accent);border-color:var(--accent-dim)}
  .toggle[aria-pressed="true"] .knob{transform:translateX(13px);background:#fff}

  .icon-btn{height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text2);cursor:pointer;font-size:11.5px;display:flex;align-items:center;gap:5px;transition:all .12s}
  .icon-btn:hover{border-color:var(--border-light);color:var(--text);background:var(--bg4)}
  .icon-btn.danger:hover{border-color:var(--red);color:var(--red);background:var(--red-glow)}

  .layout{display:flex;height:calc(100% - 52px)}
  .frame{flex:1;min-width:0;position:relative;background:var(--bg2)}
  .frame iframe{width:100%;height:100%;border:0;background:#fff}
  [data-theme] .frame iframe{background:var(--bg2)}

  .panel{width:340px;flex:none;display:flex;flex-direction:column;border-left:1px solid var(--border);background:var(--bg2)}
  .panel h2{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);padding:12px 14px 8px}

  .verdict{display:flex;gap:8px;padding:0 14px 12px;border-bottom:1px solid var(--border)}
  .verdict button{flex:1;height:30px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all .12s}
  .verdict .approve{border:1px solid var(--green);background:var(--green-glow);color:var(--green)}
  .verdict .approve:hover{background:var(--green);color:#fff}
  .verdict .changes{border:1px solid var(--orange);background:var(--orange-glow);color:var(--orange)}
  .verdict .changes:hover{background:var(--orange);color:#fff}

  .chat{flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px}
  .msg{max-width:92%;padding:7px 10px;border-radius:10px;font-size:12.5px;white-space:pre-wrap;word-break:break-word}
  .msg.user{align-self:flex-end;background:var(--accent-glow);border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);color:var(--text);border-bottom-right-radius:3px}
  .msg.agent{align-self:flex-start;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-bottom-left-radius:3px}
  .msg .meta{display:block;font-size:9.5px;color:var(--text3);margin-top:3px}
  .msg.kind-annotation{border-left:2px solid var(--teal)}
  .msg.kind-verdict{border-left:2px solid var(--green)}
  .chat .empty{color:var(--text3);font-size:12px;text-align:center;margin-top:24px;line-height:1.6}

  .queue{padding:8px 14px 0;display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto}
  .pill{display:flex;align-items:flex-start;gap:8px;background:var(--bg3);border:1px solid var(--border);border-left:2px solid var(--teal);border-radius:6px;padding:6px 8px;font-size:11.5px}
  .pill.kind-chat{border-left-color:var(--accent)}
  .pill.kind-verdict{border-left-color:var(--green)}
  .pill .where{color:var(--teal);font-family:var(--mono);font-size:10px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pill .body{flex:1;min-width:0;color:var(--text2)}
  .pill .txt{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
  .pill button{border:none;background:none;color:var(--text3);cursor:pointer;font-size:13px;line-height:1;padding:1px}
  .pill button:hover{color:var(--red)}

  .composer{padding:10px 14px 14px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px}
  .composer .hint{font-size:10px;color:var(--text3)}
  .composer textarea{width:100%;min-height:60px;max-height:160px;resize:vertical;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:12.5px;font-family:var(--font);outline:none;transition:all .15s}
  .composer textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow)}
  .composer .row{display:flex;gap:8px;align-items:center}
  .composer .send{flex:1;height:32px;border:none;border-radius:6px;background:var(--accent);color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;transition:all .12s}
  .composer .send:hover{background:var(--accent-dim)}
  .composer .send:disabled{opacity:.5;cursor:default}
  .composer .status{font-size:10.5px;color:var(--text3)}

  .overlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:color-mix(in srgb,var(--bg) 80%,transparent);backdrop-filter:blur(6px);z-index:50}
  .overlay.show{display:flex}
  .overlay .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:26px 32px;text-align:center;max-width:340px}
  .overlay .card h3{font-size:14px;margin-bottom:6px}
  .overlay .card p{font-size:12px;color:var(--text2);line-height:1.5}
  `;
}

// Client logic for the chrome page (runs in the top window).
function canvasClientJs() {
  return `'use strict';
(() => {
  const boot = JSON.parse(document.getElementById('pc-session').textContent);
  const key = boot.key;
  const $ = id => document.getElementById(id);
  const frame = $('artifact');
  const chatLog = $('chatLog');
  const queueEl = $('queue');
  const input = $('chatInput');
  const sendBtn = $('send');
  const statusEl = $('sendStatus');
  const presence = $('presence');
  const QKEY = 'ecc-plan-canvas:queue:' + key;
  let queue = [];
  let lastScroll = { x: 0, y: 0 };
  let ended = boot.status === 'ended';
  let sending = false;

  try { queue = JSON.parse(sessionStorage.getItem(QKEY) || '[]'); } catch { queue = []; }

  // --- theme ---------------------------------------------------------
  const themeKey = 'ecc-plan-canvas:theme';
  function applyTheme(t) {
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    $('themeBtn').textContent = t === 'light' ? '\\u263E dark' : '\\u2600 light';
  }
  let theme = localStorage.getItem(themeKey) || 'dark';
  applyTheme(theme);
  $('themeBtn').addEventListener('click', () => {
    theme = theme === 'light' ? 'dark' : 'light';
    localStorage.setItem(themeKey, theme);
    applyTheme(theme);
  });

  // --- annotate mode -------------------------------------------------
  let annotate = true;
  function setAnnotate(on) {
    annotate = on;
    $('annotate').setAttribute('aria-pressed', String(on));
    postToFrame({ type: 'pc:set-mode', annotate: on });
  }
  $('annotate').addEventListener('click', () => setAnnotate(!annotate));
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      setAnnotate(!annotate);
    }
  }, true);

  // --- iframe bridge --------------------------------------------------
  function postToFrame(msg) {
    if (frame.contentWindow) frame.contentWindow.postMessage(msg, '*');
  }
  window.addEventListener('message', e => {
    if (e.source !== frame.contentWindow) return;
    const msg = e.data || {};
    if (msg.type === 'pc:queue' && msg.item) addToQueue(msg.item);
    else if (msg.type === 'pc:queue-and-send' && msg.item) { addToQueue(msg.item); send(); }
    else if (msg.type === 'pc:scroll') lastScroll = { x: msg.x || 0, y: msg.y || 0 };
    else if (msg.type === 'pc:toggle-mode') setAnnotate(!annotate);
    else if (msg.type === 'pc:ready') {
      postToFrame({ type: 'pc:set-mode', annotate });
      postToFrame({ type: 'pc:restore-scroll', x: lastScroll.x, y: lastScroll.y });
    }
  });

  // --- queue ----------------------------------------------------------
  function persistQueue() { try { sessionStorage.setItem(QKEY, JSON.stringify(queue)); } catch { /* full */ } }
  function addToQueue(item) { queue.push(item); persistQueue(); renderQueue(); }
  function renderQueue() {
    queueEl.innerHTML = '';
    queue.forEach((item, i) => {
      const pill = document.createElement('div');
      pill.className = 'pill kind-' + item.kind;
      const body = document.createElement('span');
      body.className = 'body';
      if (item.anchor) {
        const where = document.createElement('span');
        where.className = 'where';
        where.textContent = item.anchor.snippet || item.anchor.selector;
        body.appendChild(where);
      }
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = item.kind === 'verdict' ? (item.verdict === 'approve' ? 'Approve plan' : 'Request changes') + (item.text ? ': ' + item.text : '') : item.text;
      body.appendChild(txt);
      const rm = document.createElement('button');
      rm.textContent = '\\u00D7';
      rm.title = 'Remove';
      rm.addEventListener('click', () => { queue.splice(i, 1); persistQueue(); renderQueue(); });
      pill.append(body, rm);
      queueEl.appendChild(pill);
    });
  }
  renderQueue();

  // --- chat -----------------------------------------------------------
  function renderChat(entries) {
    chatLog.innerHTML = '';
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Click anything in the plan to annotate it, or type below. Feedback goes straight to your agent.';
      chatLog.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const div = document.createElement('div');
      div.className = 'msg ' + (entry.role === 'agent' ? 'agent' : 'user') + ' kind-' + (entry.kind || 'chat');
      div.textContent = entry.text;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = (entry.role === 'agent' ? 'agent' : 'you') + ' \\u00B7 ' + new Date(entry.at).toLocaleTimeString();
      div.appendChild(meta);
      chatLog.appendChild(div);
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  renderChat(boot.chat || []);

  // --- send -----------------------------------------------------------
  async function send(extraItems) {
    if (ended || sending) return;
    const items = queue.slice();
    if (extraItems) items.push(...extraItems);
    const text = input.value.trim();
    if (text) items.push({ kind: 'chat', text });
    if (!items.length) {
      statusEl.textContent = 'Nothing to send yet - annotate the plan or type a message.';
      return;
    }
    sending = true;
    sendBtn.disabled = true;
    statusEl.textContent = 'Sending\\u2026';
    try {
      const res = await fetch('/api/session/' + key + '/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      queue = [];
      persistQueue();
      renderQueue();
      input.value = '';
      statusEl.textContent = 'Sent. Your agent picks this up on its next check-in.';
    } catch (err) {
      statusEl.textContent = 'Send failed (' + err.message + ') - is the canvas server still running?';
    } finally {
      sending = false;
      sendBtn.disabled = ended;
    }
  }
  sendBtn.addEventListener('click', () => send());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('approve').addEventListener('click', () => send([{ kind: 'verdict', verdict: 'approve' }]));
  $('changes').addEventListener('click', () => send([{ kind: 'verdict', verdict: 'request-changes' }]));

  // --- session controls ------------------------------------------------
  $('reloadBtn').addEventListener('click', reloadArtifact);
  $('endBtn').addEventListener('click', async () => {
    if (!window.confirm('End this review session?')) return;
    try { await fetch('/api/session/' + key + '/end', { method: 'POST' }); } catch { /* server gone */ }
  });
  function reloadArtifact() {
    const base = frame.getAttribute('data-artifact-src');
    frame.src = base + '?t=' + Date.now();
  }
  function markEnded(endedBy) {
    ended = true;
    sendBtn.disabled = true;
    input.disabled = true;
    presence.setAttribute('data-state', 'ended');
    presence.querySelector('.label').textContent = 'session ended';
    $('endedOverlay').classList.add('show');
    $('endedWho').textContent = endedBy === 'agent'
      ? 'Your agent closed this review.'
      : 'You ended this review. Head back to your agent session.';
  }
  if (ended) markEnded(boot.endedBy);

  // --- server events ----------------------------------------------------
  const PRESENCE_LABELS = { waiting: 'agent not connected', listening: 'agent listening', working: 'agent working\\u2026' };
  function connectEvents() {
    const es = new EventSource('/events/' + key);
    es.addEventListener('chat-sync', e => renderChat(JSON.parse(e.data).chat || []));
    es.addEventListener('presence', e => {
      const state = JSON.parse(e.data).state;
      if (ended) return;
      presence.setAttribute('data-state', state);
      presence.querySelector('.label').textContent = PRESENCE_LABELS[state] || state;
    });
    es.addEventListener('reload', reloadArtifact);
    es.addEventListener('ended', e => { markEnded(JSON.parse(e.data).endedBy); es.close(); });
    es.onerror = () => {
      if (ended) return;
      presence.setAttribute('data-state', 'waiting');
      presence.querySelector('.label').textContent = 'canvas server offline';
    };
  }
  connectEvents();
})();`;
}

// The chrome page: header bar, artifact iframe, conversation rail.
function renderCanvasHtml(session, { clientPath = '/client.js', cssPath = '/canvas.css' } = {}) {
  const name = path.basename(session.file);
  const bootstrap = JSON.stringify({
    key: session.key,
    file: session.file,
    status: session.status,
    endedBy: session.endedBy || null,
    chat: session.chat
  }).replace(/</g, '\\u003c');
  const artifactSrc = `/artifact/${session.key}/`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} · Plan Canvas</title>
<link rel="stylesheet" href="${cssPath}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%236885e8'/><stop offset='1' stop-color='%23e26a9e'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><text x='50' y='68' font-size='52' font-weight='700' font-family='sans-serif' fill='white' text-anchor='middle'>E</text></svg>">
</head>
<body>
<script id="pc-session" type="application/json">${bootstrap}</script>
<header class="bar">
  <div class="brand">
    <div class="logo">E</div>
    <span class="name">Plan Canvas</span>
    <span class="file" title="${escapeHtml(session.file)}">${escapeHtml(name)}</span>
  </div>
  <div class="spacer"></div>
  <div id="presence" class="presence" data-state="waiting"><span class="dot"></span><span class="label">agent not connected</span></div>
  <div id="annotate" class="toggle" role="switch" aria-pressed="true" title="Toggle annotate mode (Cmd/Ctrl+I)">
    <span>Annotate</span><span class="track"><span class="knob"></span></span>
  </div>
  <button id="themeBtn" class="icon-btn" type="button">light</button>
  <button id="reloadBtn" class="icon-btn" type="button" title="Reload artifact">Reload</button>
  <button id="endBtn" class="icon-btn danger" type="button">End session</button>
</header>
<div class="layout">
  <main class="frame">
    <iframe id="artifact" title="Artifact under review" src="${artifactSrc}" data-artifact-src="${artifactSrc}" sandbox="allow-scripts allow-forms allow-popups"></iframe>
    <div id="endedOverlay" class="overlay"><div class="card"><h3>Session ended</h3><p id="endedWho"></p></div></div>
  </main>
  <aside class="panel">
    <h2>Plan verdict</h2>
    <div class="verdict">
      <button id="approve" class="approve" type="button">Approve plan</button>
      <button id="changes" class="changes" type="button">Request changes</button>
    </div>
    <h2>Conversation</h2>
    <div id="chatLog" class="chat"></div>
    <div id="queue" class="queue"></div>
    <div class="composer">
      <textarea id="chatInput" placeholder="Message your agent&#10;Enter to send &middot; Shift+Enter for a new line"></textarea>
      <div class="row">
        <button id="send" class="send" type="button">Send to agent</button>
      </div>
      <div id="sendStatus" class="status"></div>
      <div class="hint">Annotations queue up here until you send them together.</div>
    </div>
  </aside>
</div>
<script src="${clientPath}"></script>
</body>
</html>`;
}

// ECC-styled document template for rendered markdown plan artifacts.
function renderMarkdownArtifactHtml(bodyHtml, { title, sdkSrc }) {
  const hasMermaid = bodyHtml.includes('class="mermaid"');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${TOKENS_CSS}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:var(--font);background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;line-height:1.65;font-size:14.5px}
  .doc{max-width:860px;margin:0 auto;padding:44px 36px 90px}
  h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.6em 0 .55em;letter-spacing:-.01em}
  h1{font-size:26px;margin-top:.3em;padding-bottom:.45em;border-bottom:1px solid var(--border)}
  h1:after{content:'';display:block;width:56px;height:3px;margin-top:14px;border-radius:2px;background:linear-gradient(90deg,var(--accent),var(--pink))}
  h2{font-size:19px;padding-bottom:.3em;border-bottom:1px solid var(--border)}
  h3{font-size:15.5px}
  h4,h5,h6{font-size:13.5px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em}
  p,ul,ol,blockquote,table,pre{margin-bottom:.9em}
  ul,ol{padding-left:1.5em}
  li{margin:.25em 0}
  li.task{list-style:none;margin-left:-1.3em}
  li.task input{margin-right:.5em;accent-color:var(--accent)}
  a{color:var(--accent);text-decoration:none;border-bottom:1px solid var(--accent-glow)}
  a:hover{border-bottom-color:var(--accent)}
  code{font-family:var(--mono);font-size:.88em;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:.12em .38em}
  pre{background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;overflow-x:auto}
  pre code{background:none;border:none;padding:0;font-size:12.5px;line-height:1.55}
  blockquote{border-left:3px solid var(--accent);background:var(--accent-glow);border-radius:0 var(--radius-sm) var(--radius-sm) 0;padding:8px 14px;color:var(--text2)}
  table{width:100%;border-collapse:collapse;font-size:13px;display:block;overflow-x:auto}
  th,td{text-align:left;padding:7px 12px;border:1px solid var(--border)}
  th{background:var(--bg3);font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--text2);white-space:nowrap}
  tbody tr:hover{background:var(--surface-hover)}
  hr{border:none;border-top:1px solid var(--border);margin:1.6em 0}
  img{max-width:100%;border-radius:var(--radius-sm)}
  pre.mermaid{font-family:var(--mono);font-size:12.5px;line-height:1.55;white-space:pre-wrap}
  pre.mermaid[data-processed]{background:transparent;border:none;padding:4px 0;text-align:center;overflow-x:auto}
  pre.mermaid[data-processed] svg{max-width:100%;height:auto}
  pre.mermaid.mermaid-unrendered:before{content:'diagram source (renderer unavailable)';display:block;font-family:var(--font);font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:6px}
</style>
</head>
<body>
<article class="doc">
${bodyHtml}
</article>
${hasMermaid ? mermaidLoaderScript(mermaidUrl()) : ''}
<script src="${sdkSrc}"></script>
</body>
</html>`;
}

// Landing page listing sessions (GET /).
function renderSessionListHtml(sessions) {
  const rows = sessions.map(s => {
    const status = s.status === 'ended' ? `ended by ${escapeHtml(s.endedBy || 'agent')}` : s.status;
    const link = s.status === 'ended'
      ? escapeHtml(path.basename(s.file))
      : `<a href="/canvas/${escapeHtml(s.key)}">${escapeHtml(path.basename(s.file))}</a>`;
    return `<tr><td>${link}</td><td class="mono">${escapeHtml(s.file)}</td><td><span class="badge ${escapeHtml(s.status)}">${status}</span></td></tr>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Plan Canvas · sessions</title>
<style>
${TOKENS_CSS}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:var(--font);background:var(--bg);color:var(--text);padding:40px;line-height:1.5}
  .logo{width:30px;height:30px;background:linear-gradient(135deg,var(--accent),var(--pink));border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;color:#fff;margin-right:10px;vertical-align:middle}
  h1{font-size:18px;display:inline-block;vertical-align:middle}
  table{margin-top:24px;border-collapse:collapse;width:100%;max-width:900px;font-size:13px}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--border)}
  th{color:var(--text3);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  a{color:var(--accent);text-decoration:none}
  .mono{font-family:var(--mono);font-size:11.5px;color:var(--text2)}
  .badge{font-size:11px;padding:2px 8px;border-radius:99px;background:var(--bg3);border:1px solid var(--border);color:var(--text2)}
  .badge.open,.badge.feedback{color:var(--green);border-color:var(--green);background:var(--green-glow)}
  .empty{margin-top:24px;color:var(--text3);font-size:13px}
</style>
</head>
<body>
<span class="logo">E</span><h1>Plan Canvas sessions</h1>
${sessions.length ? `<table><thead><tr><th>Artifact</th><th>Path</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">No sessions yet. Ask your agent to open a plan with the plan-canvas skill.</p>'}
</body>
</html>`;
}

module.exports = {
  canvasCss,
  canvasClientJs,
  renderCanvasHtml,
  renderMarkdownArtifactHtml,
  renderSessionListHtml
};
