'use strict';

/**
 * UI Canvas browser shell: the chrome around the mockup iframe.
 *
 * Top bar: viewport presets (desktop, mobile, exact dimensions), edit versus
 * interact mode, agent presence, undo/redo, Save and Finish. Right rail:
 * inspector for the selected element (breadcrumb, size, style chips),
 * the pending edit log, and the conversation with the agent. The mockup
 * renders at its true CSS pixel size inside a sandboxed iframe and is scaled
 * down only when the stage is too small, so media queries behave exactly as
 * they would in production.
 *
 * Same design tokens as Plan Canvas and the ECC dashboard. Everything is
 * served inline; no CDNs.
 */

const path = require('path');

const { escapeHtml } = require('../plan-canvas/markdown');
const { VIEWPORT_PRESETS } = require('./feedback');
const { inspectorClientJs } = require('./inspector');
const { uiCanvasCss } = require('./ui-css');

const ICONS = {
  desktop: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="16" height="10" rx="1.6"/><path d="M7 17h6M10 13.5V17"/></svg>',
  mobile: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="2" width="9" height="16" rx="2"/><path d="M8.5 4.5h3"/><circle cx="10" cy="15.2" r=".6" fill="currentColor"/></svg>',
  custom: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17V7M3 17h10"/><path d="M3 7l2 2M3 7l-2 2M13 17l-2 2M13 17l-2-2"/><rect x="7" y="3" width="10" height="10" rx="1.2" stroke-dasharray="2 2"/></svg>',
  rotate: '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a6 6 0 0 1 10.4-4.1M16 10a6 6 0 0 1-10.4 4.1"/><path d="M14.5 2.5v3.5H11M5.5 17.5V14H9"/></svg>',
  undo: '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 6H3v4"/><path d="M3.5 10A7 7 0 1 1 6 15.5"/></svg>',
  redo: '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6h4v4"/><path d="M16.5 10A7 7 0 1 0 14 15.5"/></svg>',
  pause: '<svg class="i-pause" viewBox="0 0 20 20" width="13" height="13" fill="currentColor"><rect x="5" y="4" width="3.5" height="12" rx="1"/><rect x="11.5" y="4" width="3.5" height="12" rx="1"/></svg>',
  play: '<svg class="i-play" viewBox="0 0 20 20" width="13" height="13" fill="currentColor"><path d="M6 4.2v11.6a.8.8 0 0 0 1.2.7l9.3-5.8a.8.8 0 0 0 0-1.4L7.2 3.5A.8.8 0 0 0 6 4.2z"/></svg>',
  reload: '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 10a6 6 0 1 1-1.8-4.3"/><path d="M16.5 3v3.5H13"/></svg>',
  sun: '<svg class="i-sun" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/></svg>',
  moon: '<svg class="i-moon" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 12.2A6.8 6.8 0 0 1 7.8 3.5a6.8 6.8 0 1 0 8.7 8.7z"/></svg>',
  check: '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5l4 4 8-9"/></svg>'
};

// Client logic for the shell page (runs in the top window).
function uiClientJs() {
  return String.raw`'use strict';
(() => {
  const boot = JSON.parse(document.getElementById('uc-session').textContent);
  const key = boot.key;
  const PRESETS = boot.presets;
  const $ = id => document.getElementById(id);
  const frame = $('artifact');
  const device = $('device');
  const sizer = $('sizer');
  const stage = $('stage');
  const viewportEl = $('viewportArea');
  const chatLog = $('chatLog');
  const input = $('chatInput');
  const sendBtn = $('send');
  const statusEl = $('sendStatus');
  const presence = $('presence');
  const hintEl = $('hint');
  const readoutEl = $('readout');
  const STORE = 'ecc-ui-canvas:' + key;

  let ended = boot.status === 'ended';
  let sending = false;
  let mode = 'edit';
  let frameReady = false;
  let selection = null;
  let anchorEnabled = true;
  let lastScroll = { x: 0, y: 0 };
  let paused = false;
  let agent = boot.agent || null;
  let canUndo = false;
  let canRedo = false;
  let exportSeq = 0;
  const exportWaiters = new Map();
  const confirmTimers = new Map();

  // --- persisted shell state ------------------------------------------------
  function readStore() {
    try { return JSON.parse(sessionStorage.getItem(STORE) || 'null') || {}; } catch (_e) { return {}; }
  }
  function writeStore(patch) {
    try {
      const next = Object.assign(readStore(), patch);
      sessionStorage.setItem(STORE, JSON.stringify(next));
    } catch (_e) { /* storage blocked: the canvas still works for this page load */ }
  }
  const stored = readStore();
  let edits = Array.isArray(stored.edits) ? stored.edits : [];
  // Applied edits the agent has not written into the file yet. They replay
  // silently on any reload until the file itself changes.
  let submitted = Array.isArray(stored.submitted) ? stored.submitted : [];

  // --- theme --------------------------------------------------------------------
  const themeKey = 'ecc-plan-canvas:theme';
  function applyTheme(t) {
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    const label = t === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    $('themeBtn').title = label;
    $('themeBtn').setAttribute('aria-label', label);
  }
  let theme = (() => { try { return localStorage.getItem(themeKey); } catch (_e) { return null; } })() || 'dark';
  applyTheme(theme);
  $('themeBtn').addEventListener('click', () => {
    theme = theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(themeKey, theme); } catch (_e) { /* blocked */ }
    applyTheme(theme);
  });

  // --- viewport ------------------------------------------------------------------
  const clampDim = n => Math.max(100, Math.min(20000, Math.round(Number(n)) || 100));
  function parseViewport(spec) {
    const custom = typeof spec === 'string' ? spec.match(/^(\d{2,5})x(\d{2,5})$/) : null;
    if (custom) return { preset: 'custom', width: clampDim(custom[1]), height: clampDim(custom[2]) };
    if (spec === 'mobile' || spec === 'custom') return { preset: spec, width: PRESETS[spec].width, height: PRESETS[spec].height };
    return { preset: 'desktop', width: PRESETS.desktop.width, height: PRESETS.desktop.height };
  }
  // sessionStorage is editable by hand; only trust a well-formed viewport.
  function storedViewport(v) {
    if (!v || ['desktop', 'mobile', 'custom'].indexOf(v.preset) < 0) return null;
    return { preset: v.preset, width: clampDim(v.width), height: clampDim(v.height), rotated: Boolean(v.rotated) };
  }
  let vp = storedViewport(stored.viewport) || parseViewport(boot.ui && boot.ui.viewport);
  let actual = { width: vp.width, height: vp.height, scale: 1 };

  function layoutStage() {
    const rect = viewportEl.getBoundingClientRect();
    const pad = 24;
    const availW = Math.max(120, rect.width - pad * 2);
    const availH = Math.max(120, rect.height - pad * 2);
    let width = vp.width;
    let height = vp.height;
    if (vp.preset === 'desktop') {
      width = Math.max(320, Math.floor(availW));
      height = Math.max(240, Math.floor(availH));
    }
    const bezel = vp.preset === 'mobile' ? 12 : 0;
    const outerW = width + bezel * 2;
    const outerH = height + bezel * 2;
    const scale = vp.preset === 'desktop' ? 1 : Math.min(1, availW / outerW, availH / outerH);
    device.className = 'device ' + vp.preset;
    device.style.width = outerW + 'px';
    device.style.height = outerH + 'px';
    device.style.transform = 'scale(' + scale + ')';
    sizer.style.width = Math.round(outerW * scale) + 'px';
    sizer.style.height = Math.round(outerH * scale) + 'px';
    actual = { width, height, scale };
    $('vpW').value = width;
    $('vpH').value = height;
    $('vpScale').textContent = scale < 0.995 ? Math.round(scale * 100) + '%' : '';
    readoutEl.textContent = width + ' × ' + height + (scale < 0.995 ? ' · shown at ' + Math.round(scale * 100) + '%' : '');
    document.querySelectorAll('.seg.viewports button').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-vp') === vp.preset)));
    $('rotateBtn').disabled = vp.preset === 'desktop';
    writeStore({ viewport: vp });
  }
  document.querySelectorAll('.seg.viewports button').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-vp');
      if (preset === vp.preset) return;
      if (preset === 'custom') vp = { preset: 'custom', width: vp.preset === 'desktop' ? actual.width : vp.width, height: vp.preset === 'desktop' ? actual.height : vp.height };
      else vp = parseViewport(preset);
      layoutStage();
    });
  });
  function applyDims() {
    const width = Math.max(100, Math.min(20000, parseInt($('vpW').value, 10) || actual.width));
    const height = Math.max(100, Math.min(20000, parseInt($('vpH').value, 10) || actual.height));
    vp = { preset: 'custom', width, height };
    layoutStage();
  }
  [$('vpW'), $('vpH')].forEach(box => {
    box.addEventListener('input', () => {
      const clean = box.value.replace(/[^0-9]/g, '').slice(0, 5);
      if (clean !== box.value) box.value = clean;
    });
    box.addEventListener('change', applyDims);
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); applyDims(); box.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); layoutStage(); box.blur(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        box.value = String((parseInt(box.value, 10) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
        applyDims();
      }
    });
  });
  $('rotateBtn').addEventListener('click', () => {
    if (vp.preset === 'desktop') return;
    vp = { preset: vp.preset, width: vp.height, height: vp.width, rotated: !vp.rotated };
    layoutStage();
  });
  if (window.ResizeObserver) new ResizeObserver(() => layoutStage()).observe(viewportEl);
  window.addEventListener('resize', layoutStage);
  layoutStage();

  // --- mode -----------------------------------------------------------------------
  const HINTS = {
    edit: 'Click to select · double-click edits text · drag handles to resize · drag to reorder · Alt-drag or arrows nudge · Delete removes',
    interact: 'Interact mode: clicks, hovers and taps reach the component. Switch back to Edit to change things.'
  };
  function setMode(next) {
    mode = next === 'interact' ? 'interact' : 'edit';
    document.querySelectorAll('.seg.modes button').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode)));
    stage.setAttribute('data-mode', mode);
    setHint('');
    postToFrame({ type: 'uc:set-mode', mode });
  }
  document.querySelectorAll('.seg.modes button').forEach(btn => btn.addEventListener('click', () => setMode(btn.getAttribute('data-mode'))));
  function setHint(text) {
    hintEl.classList.toggle('live', Boolean(text));
    hintEl.textContent = text || HINTS[mode];
  }
  setHint('');

  // --- frame bridge ----------------------------------------------------------------
  function postToFrame(msg) {
    if (frame.contentWindow) frame.contentWindow.postMessage(msg, '*');
  }
  function requestExport() {
    return new Promise((resolve, reject) => {
      const requestId = 'x' + (++exportSeq);
      exportWaiters.set(requestId, resolve);
      postToFrame({ type: 'uc:export', requestId });
      setTimeout(() => {
        if (exportWaiters.delete(requestId)) reject(new Error('the preview did not answer; reload and try again'));
      }, 5000);
    });
  }
  window.addEventListener('message', e => {
    if (e.source !== frame.contentWindow) return;
    const msg = e.data || {};
    if (typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'uc:ready':
        frameReady = true;
        postToFrame({ type: 'uc:set-mode', mode });
        postToFrame({ type: 'uc:restore', baked: submitted, edits, scroll: lastScroll, selection: selection ? selection.selector : null });
        if (paused) postToFrame({ type: 'uc:pause-animations', paused: true });
        break;
      case 'uc:selection':
        selection = msg.selection || null;
        if (selection) anchorEnabled = true;
        renderInspector();
        renderAnchor();
        break;
      case 'uc:edits':
        edits = Array.isArray(msg.edits) ? msg.edits : [];
        canUndo = Boolean(msg.canUndo);
        canRedo = Boolean(msg.canRedo);
        writeStore({ edits });
        renderEdits();
        break;
      case 'uc:status': setHint(msg.text || ''); break;
      case 'uc:toggle-mode': setMode(mode === 'edit' ? 'interact' : 'edit'); break;
      case 'uc:scroll': lastScroll = { x: msg.x || 0, y: msg.y || 0 }; break;
      case 'uc:export': {
        const resolve = exportWaiters.get(msg.requestId);
        if (resolve) { exportWaiters.delete(msg.requestId); resolve(msg); }
        break;
      }
      default: break;
    }
  });
  viewportEl.addEventListener('mousedown', e => {
    if (e.target === viewportEl && mode === 'edit') postToFrame({ type: 'uc:deselect' });
  });

${inspectorClientJs()}
  // --- edit log -----------------------------------------------------------------------
  function summarize(edit) {
    const target = edit.selector + (edit.snippet ? ' “' + edit.snippet.slice(0, 40) + (edit.snippet.length > 40 ? '…' : '') + '”' : '');
    switch (edit.kind) {
      case 'text': return target + ': “' + (edit.before || '').slice(0, 40) + '” → “' + (edit.after || '').slice(0, 60) + '”';
      case 'resize': return target + ' → ' + (edit.width !== undefined ? edit.width + 'w' : '') + (edit.width !== undefined && edit.height !== undefined ? ' × ' : '') + (edit.height !== undefined ? edit.height + 'h' : '') + (edit.before ? ' (was ' + edit.before.width + ' × ' + edit.before.height + ')' : '');
      case 'move': return target + ' → ' + (edit.to && edit.to.parent ? edit.to.parent : 'parent') + ' at ' + (edit.to ? edit.to.index : '?');
      case 'nudge': return target + ' by ' + edit.dx + ', ' + edit.dy + 'px';
      case 'remove': return target;
      case 'style': return target + ' ' + edit.property + (edit.after === null ? ' removed' : ' → ' + edit.after) + (edit.before ? ' (was ' + shortValue(edit.before) + ')' : '');
      default: return target;
    }
  }
  function renderEdits() {
    const list = $('editList');
    list.innerHTML = '';
    $('editCount').textContent = String(edits.length);
    $('undoBtn').disabled = ended || !canUndo;
    $('redoBtn').disabled = ended || !canRedo;
    $('applyBtn').disabled = ended || !edits.some(e => !e.stale);
    $('resetBtn').disabled = ended || !edits.length;
    if (!edits.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Your changes to the preview collect here. Apply sends them to the agent to bake into the file; Save and Finish hands over the final design.';
      list.appendChild(empty);
      return;
    }
    for (const edit of edits) {
      const row = document.createElement('div');
      row.className = 'edit kind-' + edit.kind + (edit.stale ? ' stale' : '');
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = edit.kind;
      const s = document.createElement('span');
      s.className = 's';
      s.textContent = summarize(edit);
      row.title = (edit.stale ? 'Could not be re-applied after the last reload.\n' : '') + summarize(edit);
      row.append(k, s);
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;
  }
  $('undoBtn').addEventListener('click', () => postToFrame({ type: 'uc:undo' }));
  $('redoBtn').addEventListener('click', () => postToFrame({ type: 'uc:redo' }));
  function twoStep(btn, label, action) {
    if (confirmTimers.has(btn)) {
      clearTimeout(confirmTimers.get(btn));
      confirmTimers.delete(btn);
      btn.classList.remove('confirm');
      btn.textContent = btn.getAttribute('data-label');
      action();
      return;
    }
    btn.setAttribute('data-label', btn.textContent);
    btn.textContent = label;
    btn.classList.add('confirm');
    confirmTimers.set(btn, setTimeout(() => {
      confirmTimers.delete(btn);
      btn.classList.remove('confirm');
      btn.textContent = btn.getAttribute('data-label');
    }, 3000));
  }
  $('resetBtn').addEventListener('click', () => twoStep($('resetBtn'), 'Revert all?', () => postToFrame({ type: 'uc:reset' })));
  $('pauseBtn').addEventListener('click', () => {
    paused = !paused;
    $('pauseBtn').setAttribute('aria-pressed', String(paused));
    postToFrame({ type: 'uc:pause-animations', paused });
  });

  // --- conversation ---------------------------------------------------------------------
  const typingEl = document.createElement('div');
  typingEl.className = 'typing';
  typingEl.setAttribute('role', 'status');
  const dots = document.createElement('span');
  dots.className = 'dots';
  dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  const typingLabel = document.createElement('span');
  typingLabel.className = 'label';
  typingEl.append(dots, typingLabel);
  const stalledEl = document.createElement('div');
  stalledEl.className = 'stalled';
  stalledEl.setAttribute('role', 'status');

  function agentName() { return (agent && agent.name) || 'agent'; }
  function renderActivity(state) {
    const typingText = state === 'thinking' ? agentName() + ' is working on it…' : state === 'typing' ? agentName() + ' is typing…' : '';
    typingEl.classList.toggle('show', Boolean(typingText));
    if (typingText) typingLabel.textContent = typingText;
    const stalled = state === 'queued';
    stalledEl.classList.toggle('show', stalled);
    if (stalled) stalledEl.textContent = 'Queued. ' + agentName() + ' is not listening right now and picks this up the moment it checks in.';
    if (typingText || stalled) scrollToEnd();
  }
  function atBottom() { return chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40; }
  function scrollToEnd() { chatLog.scrollTop = chatLog.scrollHeight; }
  function renderChat(entries) {
    const pinned = atBottom();
    chatLog.innerHTML = '';
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Select something and describe the change, or just type. Your agent answers here and the preview updates when it edits the file.';
      chatLog.appendChild(empty);
    } else {
      for (const entry of entries) {
        const div = document.createElement('div');
        div.className = 'msg ' + (entry.role === 'agent' ? 'agent' : 'user') + ' kind-' + (entry.kind || 'chat');
        div.textContent = entry.text;
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = (entry.role === 'agent' ? agentName() : 'you') + ' · ' + new Date(entry.at).toLocaleTimeString();
        div.appendChild(meta);
        chatLog.appendChild(div);
      }
    }
    chatLog.appendChild(typingEl);
    chatLog.appendChild(stalledEl);
    if (pinned) scrollToEnd();
  }
  renderChat(boot.chat || []);

  function renderAnchor() {
    const show = Boolean(selection) && anchorEnabled;
    $('anchorChip').hidden = !show;
    if (show) $('anchorText').textContent = selection.selector;
    input.placeholder = show ? 'Describe the change to ' + selection.tag + (selection.snippet ? ' “' + selection.snippet.slice(0, 30) + '”' : '') + '…' : 'Ask your agent for a change… Enter to send, Shift+Enter for a new line';
  }
  $('anchorClear').addEventListener('click', () => { anchorEnabled = false; renderAnchor(); });

  async function postFeedback(items, endSession) {
    const res = await fetch('/api/session/' + key + '/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items, endSession: Boolean(endSession) })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || ('HTTP ' + res.status));
    }
    return res.json().catch(() => ({}));
  }
  function pendingSummaries() {
    return edits.filter(e => !e.stale).slice(-30).map(summarize);
  }
  function describeDelivery(body) {
    return body.presence === 'thinking' || body.presence === 'typing' || body.presence === 'listening'
      ? 'Delivered. ' + agentName() + ' has it.'
      : 'Queued. ' + agentName() + ' picks this up the moment it checks in.';
  }
  async function sendChat() {
    if (ended || sending) return;
    const text = input.value.trim();
    if (!text) { statusEl.textContent = 'Type a message first.'; return; }
    const item = { kind: 'chat', text };
    if (selection && anchorEnabled) item.anchor = { selector: selection.selector, tag: selection.tag, snippet: selection.snippet, size: selection.size };
    const summaries = pendingSummaries();
    if (summaries.length) item.pendingEdits = summaries;
    sending = true;
    sendBtn.disabled = true;
    statusEl.textContent = 'Sending…';
    try {
      const body = await postFeedback([item], false);
      input.value = '';
      statusEl.textContent = describeDelivery(body);
      if (body.presence) applyPresence(body.presence, agent);
    } catch (err) {
      statusEl.textContent = 'Send failed (' + err.message + ').';
    } finally {
      sending = false;
      sendBtn.disabled = ended;
    }
  }
  sendBtn.addEventListener('click', sendChat);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  async function sendEdits(kind) {
    if (ended || sending) return;
    sending = true;
    sendBtn.disabled = true;
    $('applyBtn').disabled = true;
    $('finishBtn').disabled = true;
    statusEl.textContent = kind === 'finish' ? 'Saving the final design…' : 'Capturing the preview…';
    try {
      const snapshot = await requestExport();
      const item = { kind, edits: snapshot.edits || edits, html: snapshot.html, viewport: { preset: vp.preset, width: actual.width, height: actual.height } };
      const note = input.value.trim();
      if (note) item.text = note;
      const body = await postFeedback([item], kind === 'finish');
      input.value = '';
      if (kind === 'finish') {
        markEnded('finished');
      } else {
        postToFrame({ type: 'uc:forget' });
        submitted = submitted.concat((snapshot.edits || edits).filter(e => !e.stale));
        edits = [];
        writeStore({ edits: [], submitted });
        renderEdits();
        statusEl.textContent = describeDelivery(body) + ' The preview updates when it writes the file.';
        if (body.presence) applyPresence(body.presence, agent);
      }
    } catch (err) {
      statusEl.textContent = (kind === 'finish' ? 'Save failed (' : 'Apply failed (') + err.message + ').';
    } finally {
      sending = false;
      sendBtn.disabled = ended;
      $('finishBtn').disabled = ended;
      renderEdits();
    }
  }
  $('applyBtn').addEventListener('click', () => sendEdits('edits'));
  $('finishBtn').addEventListener('click', () => sendEdits('finish'));

  // --- session controls --------------------------------------------------------------------
  $('endBtn').addEventListener('click', () => twoStep($('endBtn'), 'End without saving?', async () => {
    try { await fetch('/api/session/' + key + '/end', { method: 'POST' }); } catch (_e) { /* server gone */ }
  }));
  function reloadArtifact() {
    frameReady = false;
    const base = frame.getAttribute('data-artifact-src');
    frame.src = base + '?t=' + Date.now();
  }
  $('reloadBtn').addEventListener('click', reloadArtifact);
  function markEnded(endedBy) {
    ended = true;
    sendBtn.disabled = true;
    input.disabled = true;
    $('finishBtn').disabled = true;
    $('applyBtn').disabled = true;
    renderActivity('ended');
    presence.setAttribute('data-state', 'ended');
    presence.querySelector('.label').textContent = 'session ended';
    const overlay = $('endedOverlay');
    overlay.classList.add('show');
    const finished = endedBy === 'finished';
    $('endedTitle').textContent = finished ? 'Saved and handed to ' + agentName() : 'Session ended';
    $('endedWho').textContent = finished
      ? 'Your edits and the final markup are on their way. The agent wires them into the real component next. You can close this tab.'
      : endedBy === 'agent' ? 'Your agent closed this preview.' : 'You ended this preview. Head back to your agent session.';
    $('endedIcon').hidden = !finished;
    postToFrame({ type: 'uc:set-mode', mode: 'interact' });
    if (finished) setTimeout(() => { try { window.close(); } catch (_e) { /* not script-opened */ } }, 900);
  }
  if (ended) markEnded(boot.endedBy);

  // --- server events ----------------------------------------------------------------------
  function presenceLabel(state) {
    const name = agentName();
    return {
      waiting: name === 'agent' ? 'agent not connected' : name + ' not connected',
      listening: name + ' listening',
      thinking: name + ' is working…',
      typing: name + ' is typing…',
      queued: 'queued for ' + name,
      ended: 'session ended'
    }[state] || state;
  }
  function applyPresence(state, who) {
    if (ended) return;
    if (who && who.name) agent = who;
    presence.setAttribute('data-state', state);
    presence.querySelector('.label').textContent = presenceLabel(state);
    presence.title = agent && agent.project ? agentName() + ' in ' + agent.project : '';
    renderActivity(state);
  }
  function connectEvents() {
    const es = new EventSource('/events/' + key);
    es.addEventListener('chat-sync', e => renderChat(JSON.parse(e.data).chat || []));
    es.addEventListener('presence', e => { const data = JSON.parse(e.data); applyPresence(data.state, data.agent); });
    // The file changed on disk: the agent has written the applied edits in,
    // so they must not replay on top of the new markup.
    es.addEventListener('reload', () => {
      submitted = [];
      writeStore({ submitted: [] });
      reloadArtifact();
    });
    es.addEventListener('ended', e => { markEnded(JSON.parse(e.data).endedBy); es.close(); });
    es.onerror = () => {
      if (ended) return;
      renderActivity('offline');
      presence.setAttribute('data-state', 'waiting');
      presence.querySelector('.label').textContent = 'canvas server offline';
    };
  }
  connectEvents();

  // --- shell keyboard -------------------------------------------------------------------------
  document.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'i') { e.preventDefault(); setMode(mode === 'edit' ? 'interact' : 'edit'); return; }
    if (typing) return;
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); postToFrame({ type: e.shiftKey ? 'uc:redo' : 'uc:undo' }); return; }
  });

  renderInspector();
  renderEdits();
  renderAnchor();
})();`;
}

// The shell page: header bar, staged mockup iframe, inspector + edits + chat rail.
function renderUiCanvasHtml(session, { clientPath = '/ui-client.js', cssPath = '/ui-canvas.css' } = {}) {
  const name = path.basename(session.file);
  const title = session.ui && session.ui.title ? session.ui.title : name;
  const bootstrap = JSON.stringify({
    key: session.key,
    file: session.file,
    status: session.status,
    endedBy: session.endedBy || null,
    chat: session.chat,
    agent: session.agent || null,
    ui: session.ui || { viewport: 'desktop', title: '' },
    presets: VIEWPORT_PRESETS
  }).replace(/</g, '\\u003c');
  const artifactSrc = `/artifact/${session.key}/`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · UI Canvas</title>
<link rel="stylesheet" href="${cssPath}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%2313161e'/><text x='50' y='68' font-size='52' font-weight='700' font-family='monospace' fill='%234acb8a' text-anchor='middle'>E</text></svg>">
</head>
<body>
<script id="uc-session" type="application/json">${bootstrap}</script>
<header class="bar">
  <div class="brand">
    <div class="logo">E</div>
    <span class="name">UI Canvas</span>
    <span class="file" title="${escapeHtml(session.file)}">${escapeHtml(name)}</span>
  </div>
  <div class="divider"></div>
  <div class="seg viewports" role="group" aria-label="Viewport">
    <button type="button" data-vp="desktop" aria-pressed="true" title="Desktop: fills the stage">${ICONS.desktop}</button>
    <button type="button" data-vp="mobile" aria-pressed="false" title="Mobile: ${VIEWPORT_PRESETS.mobile.width} × ${VIEWPORT_PRESETS.mobile.height} CSS px">${ICONS.mobile}</button>
    <button type="button" data-vp="custom" aria-pressed="false" title="Custom: exact width and height">${ICONS.custom}</button>
  </div>
  <div class="dims">
    <input id="vpW" type="text" inputmode="numeric" maxlength="5" autocomplete="off" spellcheck="false" title="Viewport width in CSS px (100 to 20000; arrow keys step)" aria-label="Viewport width"><span class="x">×</span><input id="vpH" type="text" inputmode="numeric" maxlength="5" autocomplete="off" spellcheck="false" title="Viewport height in CSS px (100 to 20000; arrow keys step)" aria-label="Viewport height">
    <button id="rotateBtn" class="icon-btn" type="button" title="Rotate (swap width and height)" aria-label="Rotate viewport">${ICONS.rotate}</button>
    <span id="vpScale" class="scale"></span>
  </div>
  <div class="divider"></div>
  <div class="seg modes" role="group" aria-label="Mode">
    <button type="button" data-mode="edit" aria-pressed="true" title="Edit: select, move, resize, edit text (Cmd/Ctrl+I toggles)">Edit</button>
    <button type="button" data-mode="interact" aria-pressed="false" title="Interact: clicks reach the component (Cmd/Ctrl+I toggles)">Interact</button>
  </div>
  <div class="spacer"></div>
  <div id="presence" class="presence" data-state="waiting"><span class="dot"></span><span class="label">agent not connected</span></div>
  <button id="undoBtn" class="icon-btn square" type="button" title="Undo (Cmd/Ctrl+Z)" aria-label="Undo" disabled>${ICONS.undo}</button>
  <button id="redoBtn" class="icon-btn square" type="button" title="Redo (Cmd/Ctrl+Shift+Z)" aria-label="Redo" disabled>${ICONS.redo}</button>
  <button id="pauseBtn" class="icon-btn square" type="button" aria-pressed="false" title="Pause animations and transitions in the preview" aria-label="Pause animations">${ICONS.pause}${ICONS.play}</button>
  <button id="reloadBtn" class="icon-btn square" type="button" title="Reload the preview (your edits are re-applied)" aria-label="Reload preview">${ICONS.reload}</button>
  <button id="themeBtn" class="icon-btn square" type="button" title="Switch to light theme" aria-label="Switch to light theme">${ICONS.sun}${ICONS.moon}</button>
  <div class="divider"></div>
  <button id="finishBtn" class="primary" type="button" title="Export the edited design to your agent and close the session">${ICONS.check} Save and Finish</button>
  <button id="endBtn" class="icon-btn danger" type="button" title="End the session without saving">End</button>
</header>
<div class="layout">
  <main class="stage" id="stage" data-mode="edit">
    <div class="viewport" id="viewportArea">
      <div class="sizer" id="sizer">
        <div class="device desktop" id="device">
          <iframe id="artifact" title="Component preview" src="${artifactSrc}" data-artifact-src="${artifactSrc}" sandbox="allow-scripts allow-forms allow-popups"></iframe>
        </div>
      </div>
    </div>
    <div class="statusbar">
      <span id="hint" class="hint"></span>
      <span class="readout" id="readout"></span>
      <span><kbd>⌘Z</kbd> undo</span><span><kbd>⌘I</kbd> mode</span><span><kbd>⌫</kbd> remove</span>
    </div>
    <div id="endedOverlay" class="overlay"><div class="card"><div id="endedIcon" class="ok" hidden>${ICONS.check}</div><h3 id="endedTitle">Session ended</h3><p id="endedWho"></p></div></div>
  </main>
  <aside class="panel">
    <section class="inspector">
      <h2>Selection<span class="grow"></span><button id="deselectBtn" class="mini" type="button" title="Clear the selection (Esc)" hidden>Deselect</button></h2>
      <div id="noSel" class="muted">Click anything in the preview to select it. Double-click edits its text, the corner handles resize it, dragging reorders it, and Delete removes it. Tap the background to select the whole component.</div>
      <div id="selBody" hidden>
        <div id="crumbs" class="crumbs"></div>
        <div class="selhead"><span id="selTag" class="tag"></span><span id="selSnippet" class="snippet"></span><button id="editTextBtn" class="mini" type="button" title="Edit this element's text in place (or double-click it)">Edit text</button><button id="removeBtn" class="mini danger" type="button" title="Remove this element (Delete)">Remove</button></div>
        <div id="groups" class="groups" aria-label="Style properties"></div>
        <div id="fieldHint" class="hint" role="status"></div>
      </div>
    </section>
    <section class="edits">
      <h2>Edits <span id="editCount" class="count">0</span><span class="grow"></span><button id="applyBtn" class="mini go" type="button" title="Send the edits so the agent writes them into the preview file now" disabled>Apply to file</button><button id="resetBtn" class="mini danger" type="button" title="Revert every edit in the preview" disabled>Reset</button></h2>
      <div id="editList" class="editlist"></div>
    </section>
    <section class="convo">
      <h2>Conversation</h2>
      <div id="chatLog" class="chat"></div>
      <div class="composer">
        <div id="anchorChip" class="anchor" hidden><span>About</span><code id="anchorText"></code><button id="anchorClear" type="button" title="Send without an anchor">×</button></div>
        <textarea id="chatInput" placeholder="Ask your agent for a change… Enter to send, Shift+Enter for a new line"></textarea>
        <div class="row"><button id="send" class="send" type="button">Send to agent</button></div>
        <div id="sendStatus" class="status"></div>
      </div>
    </section>
  </aside>
</div>
<script src="${clientPath}"></script>
</body>
</html>`;
}

module.exports = { ICONS, renderUiCanvasHtml, uiCanvasCss, uiClientJs };
