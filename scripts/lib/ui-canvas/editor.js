'use strict';

/**
 * UI Canvas in-page editor: the script injected into the mockup iframe.
 *
 * Runs inside the sandboxed artifact frame (opaque origin, postMessage only)
 * and turns the rendered component into something the reviewer can edit
 * directly: hover and click to select, drag the eight handles to resize,
 * drag the body to reorder, Alt-drag or arrow keys to nudge, double-click to
 * edit text, Delete to remove. Every change is recorded as a structured edit
 * that can be re-applied after the agent live-reloads the file, undone, and
 * exported together with a clean DOM snapshot.
 *
 * All editor UI lives in a shadow root so it never styles, selects, or
 * exports itself. Served as a string so coverage and lint treat it as data;
 * it is syntax-checked by tests/lib/ui-canvas-editor.test.js.
 *
 * Conventions borrowed, with thanks: Enter/Shift+Enter to walk the tree and
 * Delete to remove from VisBug (GoogleChromeLabs/ProjectVisBug), the
 * design/preview mode split from Onlook (onlook-dev/onlook).
 */

const { editorGesturesJs } = require('./editor-gestures');

function uiEditorJs() {
  return String.raw`'use strict';
(() => {
  if (window.parent === window) return;
  if (window.__eccUiCanvasEditor) return;
  window.__eccUiCanvasEditor = true;

  var sourceRevision = document.currentScript && document.currentScript.getAttribute('data-source-sha256');
  var post = function (msg) { window.parent.postMessage(msg, '*'); };

  // ---- state -------------------------------------------------------------
  var mode = 'edit';
  var selected = null;
  var hovered = null;
  var editing = null;
  var edits = [];
  var deliveryRequest = null;
  var bakedEditIds = [];
  var redoStack = [];
  var editSeq = 0;
  var gesture = null;
  var animationsPaused = false;
  var ACCENT = '#22c55e';

  var RESET_VALUES = {
    'background-color': 'transparent', 'background-image': 'none', 'color': 'inherit',
    'border': 'none', 'border-radius': '0', 'box-shadow': 'none', 'padding': '0',
    'margin': '0', 'gap': '0', 'font-size': 'inherit', 'font-weight': 'normal',
    'line-height': 'normal', 'opacity': '1', 'text-align': 'start', 'outline': 'none'
  };
  var NON_TEXT_TAGS = { IMG: 1, VIDEO: 1, AUDIO: 1, SVG: 1, CANVAS: 1, IFRAME: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, HR: 1, BR: 1, PICTURE: 1, SOURCE: 1, OBJECT: 1, EMBED: 1 };

  // ---- overlay host --------------------------------------------------------
  var host = document.createElement('div');
  host.setAttribute('data-ecc-ui-canvas', 'overlay');
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '' +
    '<style>' +
    ':host{all:initial}' +
    '.hover{position:fixed;pointer-events:none;display:none;border:1px dashed ' + ACCENT + ';border-radius:3px;box-sizing:border-box}' +
    '.sel{position:fixed;pointer-events:none;display:none;outline:2px solid ' + ACCENT + ';outline-offset:-1px;border-radius:3px;box-sizing:border-box}' +
    '.sel.editing{outline-style:dashed}' +
    '.sel.dragging{opacity:.35}' +
    '.handle{position:absolute;width:10px;height:10px;margin:-5px;background:#fff;border:1.5px solid ' + ACCENT + ';border-radius:2.5px;box-sizing:border-box;pointer-events:auto;box-shadow:0 1px 3px rgba(0,0,0,.35)}' +
    '.sel.editing .handle,.sel.dragging .handle{display:none}' +
    '.handle[data-dir="n"]{top:0;left:50%;cursor:ns-resize}.handle[data-dir="s"]{top:100%;left:50%;cursor:ns-resize}' +
    '.handle[data-dir="e"]{top:50%;left:100%;cursor:ew-resize}.handle[data-dir="w"]{top:50%;left:0;cursor:ew-resize}' +
    '.handle[data-dir="ne"]{top:0;left:100%;cursor:nesw-resize}.handle[data-dir="sw"]{top:100%;left:0;cursor:nesw-resize}' +
    '.handle[data-dir="nw"]{top:0;left:0;cursor:nwse-resize}.handle[data-dir="se"]{top:100%;left:100%;cursor:nwse-resize}' +
    '.label{position:absolute;left:-1px;top:-26px;background:#101218;color:#dfe2e9;border:1px solid #272c3e;border-radius:6px;padding:3px 8px;font:600 10.5px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.45)}' +
    '.label.inside{top:4px;left:4px}' +
    '.label b{color:#4acb8a;font-weight:600}.label span{color:#80859a;margin-left:6px;font-weight:500}' +
    '.drop{position:fixed;pointer-events:none;display:none;background:' + ACCENT + ';border-radius:2px;box-shadow:0 0 0 2px rgba(34,197,94,.25)}' +
    '.ghost{position:fixed;pointer-events:none;display:none;border:1px solid ' + ACCENT + ';background:rgba(34,197,94,.12);border-radius:3px;box-sizing:border-box}' +
    '.toast{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:none;background:#101218;color:#dfe2e9;border:1px solid #272c3e;border-radius:99px;padding:6px 14px;font:500 11.5px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.5);white-space:nowrap}' +
    '</style>' +
    '<div class="hover"></div>' +
    '<div class="sel">' +
      '<div class="label"><b></b><span></span></div>' +
      '<div class="handle" data-dir="n"></div><div class="handle" data-dir="s"></div>' +
      '<div class="handle" data-dir="e"></div><div class="handle" data-dir="w"></div>' +
      '<div class="handle" data-dir="ne"></div><div class="handle" data-dir="nw"></div>' +
      '<div class="handle" data-dir="se"></div><div class="handle" data-dir="sw"></div>' +
    '</div>' +
    '<div class="drop"></div><div class="ghost"></div><div class="toast"></div>';
  var hoverBox = root.querySelector('.hover');
  var selBox = root.querySelector('.sel');
  var labelEl = selBox.querySelector('.label');
  var dropEl = root.querySelector('.drop');
  var ghostEl = root.querySelector('.ghost');
  var toastEl = root.querySelector('.toast');
  var pauseStyle = document.createElement('style');
  pauseStyle.setAttribute('data-ecc-ui-canvas', 'pause');
  pauseStyle.textContent = '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}';

  function attachHost() { if (document.body && !host.isConnected) document.body.appendChild(host); }
  attachHost();

  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.display = 'none'; }, 1800);
  }

  // ---- element helpers ---------------------------------------------------------
  function isOurs(node) {
    return node === host || (node && node.getRootNode && node.getRootNode() === root) || (node && node.hasAttribute && node.hasAttribute('data-ecc-ui-canvas'));
  }
  function isElement(node) { return node && node.nodeType === 1; }
  function selectable(node) {
    return isElement(node) && !isOurs(node) && node !== document.documentElement;
  }
  function esc(value) {
    return (window.CSS && CSS.escape) ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, function (c) { return '\\' + c; });
  }
  function elementChildren(parent) {
    var out = [];
    for (var i = 0; i < parent.children.length; i++) if (!isOurs(parent.children[i])) out.push(parent.children[i]);
    return out;
  }
  function indexIn(parent, el) { return elementChildren(parent).indexOf(el); }
  function nthOfType(el) {
    var n = 1;
    var sib = el;
    while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) n++;
    return n;
  }
  function stepFor(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') return tag;
    var classes = Array.prototype.filter.call(el.classList, function (c) { return /^[A-Za-z_][\w-]*$/.test(c); }).slice(0, 2);
    var step = tag + classes.map(function (c) { return '.' + esc(c); }).join('');
    return step + ':nth-of-type(' + nthOfType(el) + ')';
  }
  // Prefer a unique id, else a type path scoped to the nearest id. Verified
  // unique within this source revision; positional paths cannot prove identity after a rewrite.
  function selectorFor(el) {
    if (!isElement(el)) return 'body';
    if (el.id && /^[A-Za-z_][\w-]*$/.test(el.id) && document.querySelectorAll('#' + esc(el.id)).length === 1) return '#' + esc(el.id);
    var parts = [];
    var node = el;
    while (node && isElement(node) && node !== document.documentElement) {
      if (node !== el && node.id && /^[A-Za-z_][\w-]*$/.test(node.id) && document.querySelectorAll('#' + esc(node.id)).length === 1) {
        parts.unshift('#' + esc(node.id));
        break;
      }
      parts.unshift(stepFor(node));
      if (node.tagName === 'BODY') break;
      node = node.parentElement;
    }
    var selector = parts.join(' > ');
    try { if (document.querySelectorAll(selector).length === 1) return selector; } catch (_e) { /* fall through */ }
    return selector;
  }
  function resolve(selector) {
    try { var matches = document.querySelectorAll(selector); return matches.length === 1 && !isOurs(matches[0]) ? matches[0] : null; } catch (_e) { return null; }
  }
  function resolveForEdit(selector, revision) {
    if (!/^(#[A-Za-z_][\w-]*|body|html)$/.test(selector) && (!revision || revision !== sourceRevision)) return null;
    return resolve(selector);
  }
  function snippetFor(el) {
    if (!isElement(el)) return '';
    if (el.tagName === 'IMG') return el.getAttribute('alt') || (el.getAttribute('src') || '').split('/').pop().slice(0, 80);
    if (el.tagName === 'INPUT') return el.getAttribute('placeholder') || el.value || el.type;
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  function labelFor(el) {
    var tag = el.tagName.toLowerCase();
    var ident = el.id ? '#' + el.id : (el.classList.length ? '.' + Array.prototype.slice.call(el.classList, 0, 2).join('.') : '');
    return tag + ident;
  }
  function isTextEditable(el) {
    if (!isElement(el) || NON_TEXT_TAGS[el.tagName]) return false;
    if (el === document.body) return false;
    for (var i = 0; i < el.childNodes.length; i++) {
      var child = el.childNodes[i];
      if (child.nodeType === 3 && child.textContent.trim()) return true;
    }
    return el.children.length > 0 && !hasBlockChildren(el) && (el.innerText || '').trim().length > 0;
  }
  function hasBlockChildren(el) {
    for (var i = 0; i < el.children.length; i++) {
      var display = getComputedStyle(el.children[i]).display;
      if (display !== 'inline' && display !== 'inline-block') return true;
    }
    return false;
  }
  function px(value) { var n = parseFloat(value); return isFinite(n) ? n : 0; }
  function sides(cs, prefix, suffix) {
    var t = cs.getPropertyValue(prefix + '-top' + suffix), r = cs.getPropertyValue(prefix + '-right' + suffix);
    var b = cs.getPropertyValue(prefix + '-bottom' + suffix), l = cs.getPropertyValue(prefix + '-left' + suffix);
    if (t === r && r === b && b === l) return t;
    if (t === b && r === l) return t + ' ' + r;
    return t + ' ' + r + ' ' + b + ' ' + l;
  }
  function borderSummary(cs) {
    var width = cs.borderTopWidth;
    if (px(width) === 0 && px(cs.borderRightWidth) === 0 && px(cs.borderBottomWidth) === 0 && px(cs.borderLeftWidth) === 0) return 'none';
    return width + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor;
  }
  // Corners in shorthand order (top-left, top-right, bottom-right, bottom-left),
  // collapsed like the border-radius shorthand when they match.
  function radiusSummary(cs) {
    var tl = cs.borderTopLeftRadius, tr = cs.borderTopRightRadius, br = cs.borderBottomRightRadius, bl = cs.borderBottomLeftRadius;
    if (tl === tr && tr === br && br === bl) return tl;
    if (tl === br && tr === bl) return tl + ' ' + tr;
    return tl + ' ' + tr + ' ' + br + ' ' + bl;
  }
  function styleReport(el) {
    var cs = getComputedStyle(el);
    var isFlexOrGrid = cs.display.indexOf('flex') >= 0 || cs.display.indexOf('grid') >= 0;
    var rows = [
      ['background-color', cs.backgroundColor],
      ['background-image', cs.backgroundImage === 'none' ? null : cs.backgroundImage],
      ['color', cs.color],
      ['border', borderSummary(cs)],
      ['border-radius', radiusSummary(cs)],
      ['box-shadow', cs.boxShadow],
      ['padding', sides(cs, 'padding', '')],
      ['margin', sides(cs, 'margin', '')],
      ['gap', isFlexOrGrid ? (cs.rowGap === cs.columnGap ? cs.rowGap : cs.rowGap + ' ' + cs.columnGap) : null],
      ['font-size', cs.fontSize],
      ['font-weight', cs.fontWeight],
      ['line-height', cs.lineHeight],
      ['text-align', cs.textAlign],
      ['opacity', cs.opacity],
      ['display', cs.display]
    ];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][1] === null || rows[i][1] === undefined || rows[i][1] === '') continue;
      out.push({ property: rows[i][0], value: rows[i][1], inline: el.style.getPropertyValue(rows[i][0]) || '', resettable: Object.prototype.hasOwnProperty.call(RESET_VALUES, rows[i][0]) });
    }
    return out;
  }
  function describe(el) {
    var rect = el.getBoundingClientRect();
    return {
      selector: selectorFor(el), sourceRevision: sourceRevision,
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: Array.prototype.slice.call(el.classList, 0, 6),
      snippet: snippetFor(el),
      size: { width: Math.round(rect.width), height: Math.round(rect.height) },
      editable: isTextEditable(el),
      isImage: el.tagName === 'IMG'
    };
  }
  function breadcrumbFor(el) {
    var trail = [];
    var node = el;
    while (node && isElement(node) && node !== document.documentElement) {
      trail.unshift({ selector: selectorFor(node), label: labelFor(node) });
      if (node.tagName === 'BODY') break;
      node = node.parentElement;
    }
    return trail.slice(-6);
  }

  // ---- overlay positioning -------------------------------------------------
  function place(box, rect) {
    box.style.display = 'block';
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = Math.max(0, rect.width) + 'px';
    box.style.height = Math.max(0, rect.height) + 'px';
  }
  function updateBoxes() {
    if (mode !== 'edit') { hoverBox.style.display = 'none'; selBox.style.display = 'none'; return; }
    if (hovered && hovered.isConnected && hovered !== selected) place(hoverBox, hovered.getBoundingClientRect());
    else hoverBox.style.display = 'none';
    if (selected && selected.isConnected) {
      var rect = selected.getBoundingClientRect();
      place(selBox, rect);
      labelEl.querySelector('b').textContent = labelFor(selected);
      labelEl.querySelector('span').textContent = Math.round(rect.width) + ' × ' + Math.round(rect.height);
      labelEl.classList.toggle('inside', rect.top < 30);
    } else {
      selBox.style.display = 'none';
      if (selected && !selected.isConnected) { selected = null; postSelection(); }
    }
  }
  var rafPending = false;
  function scheduleBoxes() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; updateBoxes(); });
  }

  // ---- selection -----------------------------------------------------------------
  function postSelection() {
    if (!selected || !selected.isConnected) { post({ type: 'uc:selection', selection: null }); return; }
    var info = describe(selected);
    info.styles = styleReport(selected);
    info.breadcrumb = breadcrumbFor(selected);
    post({ type: 'uc:selection', selection: info });
  }
  function select(el) {
    if (editing && editing.el !== el) commitTextEdit();
    selected = selectable(el) ? el : null;
    updateBoxes();
    postSelection();
  }
  function deselect() { select(null); }

  // ---- edit log -----------------------------------------------------------------
  function newEdit(kind, el, detail) {
    editSeq += 1;
    var edit = { id: 'e' + editSeq + '-' + Date.now().toString(36), kind: kind, selector: selectorFor(el), sourceRevision: sourceRevision, tag: el.tagName.toLowerCase(), snippet: snippetFor(el), at: new Date().toISOString() };
    for (var key in detail) if (Object.prototype.hasOwnProperty.call(detail, key)) edit[key] = detail[key];
    return edit;
  }
  function publicEdit(edit) {
    var out = {};
    for (var key in edit) if (Object.prototype.hasOwnProperty.call(edit, key) && key.charAt(0) !== '_') out[key] = edit[key];
    return out;
  }
  function postEdits() {
    post({ type: 'uc:edits', edits: edits.map(publicEdit), canUndo: edits.some(function (e) { return !e.stale; }), canRedo: redoStack.length > 0 });
  }
  function record(edit) {
    edits.push(edit);
    redoStack = [];
    postEdits();
    postSelection();
    scheduleBoxes();
  }
  function insertAt(parent, el, index) {
    var kids = elementChildren(parent).filter(function (k) { return k !== el; });
    var ref = index < kids.length ? kids[index] : null;
    parent.insertBefore(el, ref);
  }
  function applyInline(el, values) {
    for (var prop in values) if (Object.prototype.hasOwnProperty.call(values, prop)) {
      if (values[prop] === '' || values[prop] === null || values[prop] === undefined) el.style.removeProperty(prop);
      else el.style.setProperty(prop, values[prop]);
    }
  }
  function captureInline(el, props) {
    var out = {};
    for (var i = 0; i < props.length; i++) out[props[i]] = el.style.getPropertyValue(props[i]);
    return out;
  }
  function contentBoxDelta(el, cs) {
    if (cs.boxSizing === 'border-box') return { w: 0, h: 0 };
    return {
      w: px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth),
      h: px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth)
    };
  }
  function sizeStyles(el, width, height) {
    var cs = getComputedStyle(el);
    var delta = contentBoxDelta(el, cs);
    var out = {};
    if (width !== undefined && width !== null) out.width = Math.max(1, Math.round(width - delta.w)) + 'px';
    if (height !== undefined && height !== null) out.height = Math.max(1, Math.round(height - delta.h)) + 'px';
    var parent = el.parentElement;
    if (parent && getComputedStyle(parent).display.indexOf('flex') >= 0 && cs.flexGrow !== '0') out.flex = '0 0 auto';
    if (el.tagName === 'IMG' && (width !== undefined || height !== undefined)) {
      if (width !== undefined && height === undefined) out.height = 'auto';
      out['max-width'] = 'none';
    }
    return out;
  }

  // Apply a recorded edit to the live document. The el argument is the element the
  // edit targets (resolved by selector during re-application). Returns false
  // when the document no longer matches, so the edit can be flagged stale.
  function applyEdit(edit, el) {
    el = el || resolveForEdit(edit.selector, edit.sourceRevision);
    if (edit.kind === 'remove') {
      if (!el) return false;
      var parent = el.parentElement;
      edit._el = el;
      edit._parent = parent;
      edit._index = indexIn(parent, el);
      el.remove();
      return true;
    }
    if (!el) return false;
    if (edit.kind === 'text') {
      if (edit._htmlBefore === undefined) edit._htmlBefore = el.innerHTML;
      el.innerHTML = edit.htmlAfter !== undefined ? edit.htmlAfter : '';
      if (edit.htmlAfter === undefined) el.textContent = edit.after;
      edit._el = el;
      return true;
    }
    if (edit.kind === 'resize') {
      var styles = sizeStyles(el, edit.width, edit.height);
      if (!edit._inlineBefore) edit._inlineBefore = captureInline(el, Object.keys(styles));
      applyInline(el, styles);
      edit._el = el;
      return true;
    }
    if (edit.kind === 'nudge') {
      var cs = getComputedStyle(el);
      if (!edit._inlineBefore) edit._inlineBefore = captureInline(el, ['position', 'left', 'top']);
      var baseLeft = px(el.style.left), baseTop = px(el.style.top);
      var next = { left: (baseLeft + edit.dx) + 'px', top: (baseTop + edit.dy) + 'px' };
      if (cs.position === 'static') next.position = 'relative';
      applyInline(el, next);
      edit._el = el;
      return true;
    }
    if (edit.kind === 'move') {
      var target = resolveForEdit(edit.to.parent, edit.sourceRevision);
      if (!target || target === el || el.contains(target)) return false;
      edit._fromParent = el.parentElement;
      edit._fromIndex = indexIn(el.parentElement, el);
      insertAt(target, el, edit.to.index);
      edit._el = el;
      return true;
    }
    if (edit.kind === 'style') {
      if (!edit._inlineBefore) edit._inlineBefore = captureInline(el, [edit.property]);
      var value = edit.after === null ? RESET_VALUES[edit.property] : edit.after;
      if (value === undefined) return false;
      el.style.setProperty(edit.property, value);
      edit._el = el;
      return true;
    }
    return false;
  }
  function revertEdit(edit) {
    if (edit.stale) return false;
    var el = edit._el && edit._el.isConnected ? edit._el : (edit.kind === 'remove' ? edit._el : resolveForEdit(edit.selector, edit.sourceRevision));
    if (edit.kind === 'remove') {
      if (!el || !edit._parent) return false;
      insertAt(edit._parent, el, edit._index);
      return true;
    }
    if (!el) return false;
    if (edit.kind === 'text') { el.innerHTML = edit._htmlBefore !== undefined ? edit._htmlBefore : edit.before; return true; }
    if (edit.kind === 'resize' || edit.kind === 'nudge' || edit.kind === 'style') { applyInline(el, edit._inlineBefore || {}); return true; }
    if (edit.kind === 'move') {
      if (!edit._fromParent) return false;
      insertAt(edit._fromParent, el, edit._fromIndex);
      return true;
    }
    return false;
  }
  function undo() {
    if (deliveryRequest) return;
    for (var i = edits.length - 1; i >= 0; i--) {
      if (edits[i].stale) continue;
      var edit = edits.splice(i, 1)[0];
      revertEdit(edit);
      redoStack.push(edit);
      if (edit.kind === 'remove' && edit._el) select(edit._el);
      toast('Undid ' + edit.kind);
      break;
    }
    postEdits();
    postSelection();
    scheduleBoxes();
  }
  function redo() {
    if (deliveryRequest) return;
    var edit = redoStack.pop();
    if (!edit) return;
    if (applyEdit(edit, edit._el && edit._el.isConnected ? edit._el : null)) { edits.push(edit); toast('Redid ' + edit.kind); }
    postEdits();
    postSelection();
    scheduleBoxes();
  }
  function resetAll() {
    if (deliveryRequest) return;
    for (var i = edits.length - 1; i >= 0; i--) revertEdit(edits[i]);
    edits = edits.filter(function (edit) { return edit.submitted; });
    redoStack = [];
    postEdits();
    postSelection();
    scheduleBoxes();
    toast(edits.length ? 'Pending edits reverted; applied changes still need agent resolution' : 'All edits reverted');
  }
  // After the agent rewrites the file the frame reloads from scratch; the
  // shell hands back the edit log and we replay it in order. Edits whose
  // selector no longer resolves stay in the log, flagged stale, so the human
  // and the agent both see what did not survive.
  function copyEdit(source) {
    var edit = {};
    for (var key in source) if (Object.prototype.hasOwnProperty.call(source, key)) edit[key] = source[key];
    return edit;
  }
  function restore(payload) {
    var incoming = Array.isArray(payload.edits) ? payload.edits : [];
    var baked = Array.isArray(payload.baked) ? payload.baked : [];
    edits = [];
    bakedEditIds = [];
    deliveryRequest = payload.deliveryRequest || null;
    redoStack = [];
    // Replay submitted batches atomically. A missing target must not leave
    // the represented part of a batch applied twice on a partially edited file.
    var batches = Array.isArray(payload.batches) ? payload.batches : [{ edits: baked }];
    var represented = Object.create(null);
    var pendingBaked = deliveryRequest && sourceRevision && payload.pendingSnapshotHash === sourceRevision && Array.isArray(payload.pendingBakedEditIds) ? payload.pendingBakedEditIds : [];
    batches.forEach(function (batch) {
      if (sourceRevision && batch.snapshotHash === sourceRevision) { represented[batch.id] = true; (batch.includedBatches || []).forEach(function (id) { represented[id] = true; }); }
      if (batch.edits && batch.edits.length && batch.edits.every(function (edit) { return pendingBaked.indexOf(edit.id) >= 0; })) represented[batch.id] = true;
    });
    for (var b = 0; b < batches.length; b++) {
      var applied = [], failed = false;
      var batchEdits = batches[b].edits || [];
      for (var n = 0; !represented[batches[b].id] && n < batchEdits.length; n++) {
        var candidate = copyEdit(batchEdits[n]);
        try { if (!applyEdit(candidate, null)) { failed = true; break; } }
        catch (_error) { try { revertEdit(candidate); } catch (_rollbackError) { /* keep batch unresolved */ } failed = true; break; }
        applied.push(candidate);
      }
      if (failed) {
        for (var r = applied.length - 1; r >= 0; r--) { try { revertEdit(applied[r]); } catch (_rollbackError) { /* keep batch unresolved */ } }
        batchEdits.forEach(function (edit) { edits.push(Object.assign(copyEdit(edit), { stale: true, submitted: true })); });
      } else {
        batchEdits.forEach(function (edit) { bakedEditIds.push(edit.id); });
      }
      batchEdits.forEach(function (edit) {
        var seq = parseInt(String(edit.id).slice(1), 10);
        if (seq > editSeq) editSeq = seq;
      });
    }
    for (var i = 0; i < incoming.length; i++) {
      if (incoming[i].submitted) continue;
      var edit = copyEdit(incoming[i]);
      delete edit.stale;
      var pending = deliveryRequest && (payload.pendingEditIds || []).indexOf(edit.id) >= 0;
      var inSource = pending && sourceRevision && payload.pendingSnapshotHash === sourceRevision;
      if (edit.unverified || (!inSource && ((pending && payload.pendingSourceRevision !== sourceRevision) || !applyEdit(edit, null)))) edit.stale = true;
      if (deliveryRequest) edit._exported = true;
      edits.push(edit);
      var seq = parseInt(String(edit.id).slice(1), 10);
      if (seq > editSeq) editSeq = seq;
    }
    if (payload.scroll) window.scrollTo(payload.scroll.x || 0, payload.scroll.y || 0);
    if (payload.selection) { var el = resolveForEdit(payload.selection, payload.selectionRevision); if (el) selected = el; }
    updateBoxes();
    postEdits();
    postSelection();
  }

  // ---- text editing ----------------------------------------------------------
  function startTextEdit(el) {
    if (!isTextEditable(el)) { toast('This element has no editable text'); return; }
    if (editing) commitTextEdit();
    editing = { el: el, before: el.innerText, htmlBefore: el.innerHTML };
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-ecc-ui-canvas-editing', '');
    el.focus();
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_e) { /* selection APIs unavailable */ }
    selBox.classList.add('editing');
    post({ type: 'uc:status', text: 'Editing text · Enter saves · Shift+Enter for a new line · Esc cancels' });
  }
  function finishTextEdit(cancel) {
    if (!editing) return;
    var el = editing.el;
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-ecc-ui-canvas-editing');
    selBox.classList.remove('editing');
    var state = editing;
    editing = null;
    if (cancel) { el.innerHTML = state.htmlBefore; post({ type: 'uc:status', text: '' }); scheduleBoxes(); return; }
    if (el.innerHTML !== state.htmlBefore) {
      var edit = newEdit('text', el, { before: state.before, after: el.innerText, htmlAfter: el.innerHTML });
      edit._htmlBefore = state.htmlBefore;
      edit._el = el;
      record(edit);
      toast('Text updated');
    }
    post({ type: 'uc:status', text: '' });
    scheduleBoxes();
  }
  function commitTextEdit() { finishTextEdit(false); }

${editorGesturesJs()}
  // ---- export -------------------------------------------------------------------
  function exportHtml() {
    if (editing) commitTextEdit();
    var clone = document.documentElement.cloneNode(true);
    var junk = clone.querySelectorAll('[data-ecc-ui-canvas],[data-ecc-plan-canvas]');
    for (var i = 0; i < junk.length; i++) junk[i].remove();
    var scripts = clone.querySelectorAll('script[src*="/ui-editor.js"],script[src*="/sdk.js"]');
    for (var j = 0; j < scripts.length; j++) scripts[j].remove();
    var marked = clone.querySelectorAll('[contenteditable],[data-ecc-ui-canvas-editing]');
    for (var k = 0; k < marked.length; k++) { marked[k].removeAttribute('contenteditable'); marked[k].removeAttribute('data-ecc-ui-canvas-editing'); }
    clone.removeAttribute('data-ecc-ui-canvas-noselect');
    var doctype = document.doctype ? '<!DOCTYPE ' + document.doctype.name + '>\n' : '<!DOCTYPE html>\n';
    return doctype + clone.outerHTML + '\n';
  }

  // ---- DOM events ----------------------------------------------------------------
  var noSelectStyle = document.createElement('style');
  noSelectStyle.setAttribute('data-ecc-ui-canvas', 'noselect');
  noSelectStyle.textContent = '[data-ecc-ui-canvas-noselect] *{user-select:none!important;cursor:inherit}';
  document.head && document.head.appendChild(noSelectStyle);

  document.addEventListener('mousemove', function (e) {
    if (gesture) {
      if (gesture.kind === 'resize') { doResize(e); return; }
      if (gesture.kind === 'press') {
        // Track the move that starts the drag too, so a fast flick still drops.
        if (Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) > 4) { beginDrag(e); doDrag(e); }
        return;
      }
      doDrag(e);
      return;
    }
    if (mode !== 'edit' || editing) return;
    var target = e.target;
    hovered = selectable(target) && !(editing && editing.el === target) ? target : null;
    scheduleBoxes();
  }, true);

  document.addEventListener('mousedown', function (e) {
    if (mode !== 'edit' || e.button !== 0) return;
    var path = e.composedPath ? e.composedPath() : [e.target];
    var first = path[0];
    if (first && first.classList && first.classList.contains('handle') && first.getRootNode() === root) {
      e.preventDefault();
      e.stopPropagation();
      startResize(first.getAttribute('data-dir'), e);
      return;
    }
    var target = e.target;
    if (editing && editing.el.contains(target)) return;
    if (editing) commitTextEdit();
    if (!selectable(target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (target !== selected) select(target);
    if (target !== document.body) startPress(target, e);
  }, true);

  document.addEventListener('mouseup', function (e) {
    if (!gesture) return;
    var g = gesture;
    gesture = null;
    if (g.kind === 'resize') { endResize(g); e.preventDefault(); e.stopPropagation(); return; }
    if (g.kind === 'press') return;
    endDrag(g);
    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.addEventListener('click', function (e) {
    if (mode !== 'edit') return;
    if (editing && editing.el.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.addEventListener('dblclick', function (e) {
    if (mode !== 'edit') return;
    if (editing && editing.el.contains(e.target)) return;
    if (!selectable(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    select(e.target);
    startTextEdit(e.target);
  }, true);

  document.addEventListener('keydown', function (e) {
    var meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'i' && !editing) { e.preventDefault(); post({ type: 'uc:toggle-mode' }); return; }
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); finishTextEdit(true); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextEdit(); }
      return;
    }
    if (mode !== 'edit') return;
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') { if (selected) { e.preventDefault(); deselect(); } return; }
    if (!selected) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) { if (selected.parentElement && selectable(selected.parentElement)) select(selected.parentElement); }
      else { var kids = elementChildren(selected); if (kids.length) select(kids[0]); else startTextEdit(selected); }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      var next = e.shiftKey ? selected.previousElementSibling : selected.nextElementSibling;
      while (next && isOurs(next)) next = e.shiftKey ? next.previousElementSibling : next.nextElementSibling;
      if (next) select(next);
      return;
    }
    var step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeBy(-step, 0); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nudgeBy(step, 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); nudgeBy(0, -step); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); nudgeBy(0, step); }
  }, true);

  document.addEventListener('focusout', function (e) {
    if (editing && e.target === editing.el) setTimeout(function () { if (editing && editing.el === e.target) commitTextEdit(); }, 0);
  }, true);

  var scrollTimer = null;
  window.addEventListener('scroll', function () {
    scheduleBoxes();
    if (scrollTimer) return;
    scrollTimer = setTimeout(function () { scrollTimer = null; post({ type: 'uc:scroll', x: window.scrollX, y: window.scrollY }); }, 120);
  }, { passive: true, capture: true });
  window.addEventListener('resize', function () { scheduleBoxes(); post({ type: 'uc:viewport', width: window.innerWidth, height: window.innerHeight }); });

  if (window.ResizeObserver) {
    var observer = new ResizeObserver(function () { scheduleBoxes(); });
    observer.observe(document.documentElement);
  }
  if (window.MutationObserver) {
    var mutations = new MutationObserver(function () { scheduleBoxes(); });
    mutations.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  }

  // ---- shell bridge ---------------------------------------------------------------
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var msg = e.data || {};
    if (typeof msg.type !== 'string' || msg.type.indexOf('uc:') !== 0) return;
    switch (msg.type) {
      case 'uc:set-mode':
        if (editing) commitTextEdit();
        mode = msg.mode === 'interact' ? 'interact' : 'edit';
        if (mode === 'interact') { hovered = null; }
        updateBoxes();
        break;
      case 'uc:restore': restore(msg); break;
      case 'uc:select': { var el = resolve(msg.selector); if (el) { select(el); try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_e) { /* older engines */ } } break; }
      case 'uc:deselect': deselect(); break;
      case 'uc:style': setStyle(msg.property, msg.value === undefined ? null : msg.value); break;
      case 'uc:size': setSize(msg.width, msg.height); break;
      case 'uc:remove': removeSelected(); break;
      case 'uc:edit-text': if (selected) startTextEdit(selected); break;
      case 'uc:undo': undo(); break;
      case 'uc:redo': redo(); break;
      case 'uc:reset': resetAll(); break;
      case 'uc:forget':
        if (deliveryRequest) break;
        // Compatibility with an older shell: a scoped acknowledgment should
        // always supply IDs so edits created after capture stay undoable.
        edits = edits.filter(function (edit) { return edit.submitted || (Array.isArray(msg.editIds) && msg.editIds.indexOf(edit.id) < 0); });
        postEdits();
        postSelection();
        break;
      case 'uc:delivery-end':
        if (deliveryRequest !== msg.requestId) break;
        if (msg.accepted) {
          var captured = edits.filter(function (edit) { return msg.editIds.indexOf(edit.id) >= 0; });
          var proven = msg.editIds.every(function (id) { return bakedEditIds.indexOf(id) >= 0 || captured.some(function (edit) { return edit.id === id && !edit.stale; }); });
          if (proven) { bakedEditIds = bakedEditIds.concat(msg.editIds); edits = edits.filter(function (edit) { return msg.editIds.indexOf(edit.id) < 0; }); }
          else captured.forEach(function (edit) { edit.stale = true; edit.submitted = true; });
        }
        if (!msg.retryPending) { deliveryRequest = null; edits.forEach(function (edit) { delete edit._exported; }); }
        postEdits();
        postSelection();
        break;
      case 'uc:pause-animations':
        animationsPaused = Boolean(msg.paused);
        if (animationsPaused) document.head.appendChild(pauseStyle); else pauseStyle.remove();
        break;
      case 'uc:export':
        if (msg.lock) {
          deliveryRequest = msg.requestId;
          edits.forEach(function (edit) { edit._exported = true; });
        }
        post({ type: 'uc:export', requestId: msg.requestId, html: exportHtml(), sourceRevision: sourceRevision, edits: edits.map(publicEdit), bakedEditIds: bakedEditIds.slice() });
        break;
      case 'uc:scroll-to': window.scrollTo(msg.x || 0, msg.y || 0); break;
      default: break;
    }
  });

  function announceReady() {
    attachHost();
    post({ type: 'uc:ready', title: document.title || '', viewport: { width: window.innerWidth, height: window.innerHeight }, scroll: { x: window.scrollX, y: window.scrollY } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announceReady);
  else announceReady();
})();`;
}

module.exports = { uiEditorJs };
