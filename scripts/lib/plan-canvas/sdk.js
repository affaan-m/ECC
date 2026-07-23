'use strict';

/**
 * Plan Canvas artifact SDK — the script injected into the reviewed artifact.
 *
 * The artifact runs in a sandboxed iframe without allow-same-origin, so this
 * script can only talk to the chrome via postMessage. It renders all of its
 * own UI inside a shadow root so it never annotates itself and never leaks
 * styles into the artifact.
 */

function artifactSdkJs() {
  return `'use strict';
(() => {
  if (window.parent === window) return; // only meaningful inside the canvas
  if (window.__eccPlanCanvasSdk) return;
  window.__eccPlanCanvasSdk = true;

  let annotate = true;
  let card = null;

  const post = msg => window.parent.postMessage(msg, '*');

  // --- shadow-root UI host --------------------------------------------
  const host = document.createElement('div');
  host.setAttribute('data-ecc-plan-canvas', 'ui');
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = \`
  <style>
    :host{all:initial}
    .hl{position:fixed;pointer-events:none;border:1.5px solid #6885e8;background:rgba(104,133,232,0.12);border-radius:4px;display:none;z-index:2147483646;transition:all .06s ease-out}
    .selhint{position:absolute;display:none;z-index:2147483647;background:#101218;color:#dfe2e9;border:1px solid #272c3e;border-radius:6px;padding:4px 10px;font:600 11.5px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer;box-shadow:0 8px 32px rgba(0,0,0,0.6)}
    .selhint:hover{border-color:#6885e8}
    .card{position:absolute;display:none;z-index:2147483647;width:300px;background:#101218;border:1px solid #272c3e;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.6);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#dfe2e9}
    .card h4{margin:0;padding:10px 12px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#80859a}
    .card .snippet{padding:4px 12px 0;font:10.5px 'SF Mono','Fira Code',monospace;color:#4acbbe;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .card textarea{display:block;width:calc(100% - 24px);margin:8px 12px;min-height:56px;resize:vertical;background:#13161e;border:1px solid #1d2130;border-radius:6px;color:#dfe2e9;font:12.5px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:7px 9px;outline:none;box-sizing:border-box}
    .card textarea:focus{border-color:#6885e8}
    .card .row{display:flex;justify-content:flex-end;gap:8px;padding:0 12px 12px}
    .card button{border-radius:6px;font:600 11.5px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:5px 12px;cursor:pointer}
    .card .cancel{background:none;border:1px solid #1d2130;color:#80859a}
    .card .cancel:hover{color:#dfe2e9;border-color:#272c3e}
    .card .queue{background:#6885e8;border:1px solid #6885e8;color:#fff}
    .card .queue:hover{background:#3d5ab8}
    .card .keys{padding:0 12px 10px;font-size:9.5px;color:#4c5168}
  </style>
  <div class="hl"></div>
  <button class="selhint" type="button">Annotate selection</button>
  <div class="card">
    <h4></h4>
    <div class="snippet"></div>
    <textarea placeholder="What should change here?"></textarea>
    <div class="row">
      <button class="cancel" type="button">Cancel</button>
      <button class="queue" type="button">Queue</button>
    </div>
    <div class="keys">Enter to queue &middot; Cmd/Ctrl+Enter to queue &amp; send</div>
  </div>\`;
  const attach = () => document.body ? document.body.appendChild(host) : null;
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach);

  const hl = root.querySelector('.hl');
  const selhint = root.querySelector('.selhint');
  const cardEl = root.querySelector('.card');
  const cardTitle = cardEl.querySelector('h4');
  const cardSnippet = cardEl.querySelector('.snippet');
  const cardText = cardEl.querySelector('textarea');

  // --- selectors & context ---------------------------------------------
  const esc = v => (window.CSS && CSS.escape) ? CSS.escape(v) : v.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  function selectorFor(el) {
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth++) {
      if (node.id) { parts.unshift('#' + esc(node.id)); return parts.join(' > '); }
      const tag = node.tagName.toLowerCase();
      if (tag === 'body' || tag === 'html') { parts.unshift(tag); break; }
      let nth = 1;
      let sib = node;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === node.tagName) nth++;
      parts.unshift(tag + ':nth-of-type(' + nth + ')');
      node = node.parentElement;
    }
    return parts.join(' > ');
  }
  function snippetFor(el) {
    return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
  }
  const INTERACTIVE = new Set(['button', 'input', 'select', 'textarea', 'option', 'label', 'summary', 'a']);
  function isInteractive(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      if (INTERACTIVE.has(node.tagName.toLowerCase()) || node.isContentEditable) return true;
      node = node.parentElement;
    }
    return false;
  }
  const isOurs = el => el === host || host.contains(el);

  // --- annotation card ---------------------------------------------------
  function openCard(target) {
    card = target;
    cardTitle.textContent = target.kindLabel;
    cardSnippet.textContent = target.anchor.snippet || target.anchor.selector;
    cardText.value = '';
    cardEl.style.display = 'block';
    const x = Math.min(target.x, window.innerWidth - 320) + window.scrollX;
    const y = target.y + 12 + window.scrollY;
    cardEl.style.left = Math.max(8, x) + 'px';
    cardEl.style.top = y + 'px';
    cardText.focus();
  }
  function closeCard() {
    card = null;
    cardEl.style.display = 'none';
  }
  function queueCard(sendNow) {
    if (!card) return;
    const text = cardText.value.trim();
    if (!text) { cardText.focus(); return; }
    post({
      type: sendNow ? 'pc:queue-and-send' : 'pc:queue',
      item: { kind: 'annotation', text, anchor: card.anchor }
    });
    closeCard();
  }
  cardEl.querySelector('.cancel').addEventListener('click', closeCard);
  cardEl.querySelector('.queue').addEventListener('click', () => queueCard(false));
  cardText.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); queueCard(true); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); queueCard(false); }
    else if (e.key === 'Escape') closeCard();
  });

  // --- element hover / click ---------------------------------------------
  document.addEventListener('mousemove', e => {
    if (!annotate || card) { hl.style.display = 'none'; return; }
    const el = e.target;
    if (!el || isOurs(el) || el === document.body || el === document.documentElement || isInteractive(el)) {
      hl.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    hl.style.display = 'block';
    hl.style.left = rect.left - 2 + 'px';
    hl.style.top = rect.top - 2 + 'px';
    hl.style.width = rect.width + 'px';
    hl.style.height = rect.height + 'px';
  }, true);

  document.addEventListener('click', e => {
    if (!annotate) return;
    const el = e.target;
    if (isOurs(el)) return;
    if (card) { if (!cardEl.contains(e.composedPath()[0])) closeCard(); return; }
    if (isInteractive(el)) return; // let controls behave natively
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return; // handled by selection flow
    if (el === document.body || el === document.documentElement) return;
    e.preventDefault();
    e.stopPropagation();
    hl.style.display = 'none';
    openCard({
      kindLabel: 'Annotate <' + el.tagName.toLowerCase() + '>',
      anchor: { selector: selectorFor(el), tag: el.tagName.toLowerCase(), snippet: snippetFor(el) },
      x: e.clientX,
      y: e.clientY
    });
  }, true);

  // --- text selection -------------------------------------------------------
  document.addEventListener('mouseup', e => {
    if (!annotate || card || isOurs(e.target)) return;
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection ? String(selection).replace(/\\s+/g, ' ').trim() : '';
      if (!text || !selection.rangeCount) { selhint.style.display = 'none'; return; }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      selhint.style.display = 'block';
      selhint.style.left = rect.left + window.scrollX + 'px';
      selhint.style.top = rect.bottom + 6 + window.scrollY + 'px';
      selhint.onclick = () => {
        selhint.style.display = 'none';
        const anchorNode = selection.anchorNode;
        const el = anchorNode && anchorNode.nodeType === 1 ? anchorNode : anchorNode && anchorNode.parentElement;
        openCard({
          kindLabel: 'Annotate selection',
          anchor: {
            selector: el ? selectorFor(el) : 'body',
            tag: 'text',
            snippet: text.slice(0, 200),
            textRange: { text: text.slice(0, 1000) }
          },
          x: rect.left,
          y: rect.bottom
        });
      };
    }, 0);
  }, true);
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) selhint.style.display = 'none';
  });

  // --- chrome bridge ---------------------------------------------------------
  window.addEventListener('message', e => {
    const msg = e.data || {};
    if (msg.type === 'pc:set-mode') {
      annotate = Boolean(msg.annotate);
      if (!annotate) { hl.style.display = 'none'; selhint.style.display = 'none'; closeCard(); }
    } else if (msg.type === 'pc:restore-scroll') {
      window.scrollTo(msg.x || 0, msg.y || 0);
    }
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      post({ type: 'pc:toggle-mode' });
    } else if (e.key === 'Escape' && card) closeCard();
  }, true);

  let scrollTimer = null;
  window.addEventListener('scroll', () => {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      post({ type: 'pc:scroll', x: window.scrollX, y: window.scrollY });
    }, 150);
  }, { passive: true });

  post({ type: 'pc:ready' });
})();`;
}

module.exports = { artifactSdkJs };
