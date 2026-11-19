'use strict';

/**
 * UI Canvas feedback schema.
 *
 * The browser editor records every change the human makes to a mockup as a
 * structured edit and ships the edit log, plus a serialized DOM snapshot, to
 * the agent through the same session queue Plan Canvas uses. This module owns
 * the shape of that payload: validation of what the browser submits, the
 * on-disk export of the snapshot, the one-line summaries agents and hooks
 * print, and the viewport presets the shell offers.
 *
 * Nothing here trusts the browser. Every field is clamped, every kind is
 * allow-listed, and the HTML snapshot never enters sessions.json: it is
 * written next to the artifact and only its path travels with the item.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UI_FEEDBACK_KINDS = new Set(['chat', 'edits', 'finish']);
const EDIT_KINDS = new Set(['text', 'resize', 'move', 'nudge', 'remove', 'style']);
const VIEWPORT_IDS = new Set(['mobile', 'desktop', 'custom']);

const MAX_EDITS = 500;
const MAX_EDIT_SUMMARIES = 60;
const MAX_HTML_BYTES = 6 * 1024 * 1024;
const MAX_SNIPPET = 200;
const MAX_SELECTOR = 500;
const MAX_TEXT = 4000;
const MAX_MARKUP = 20000;
const MAX_STYLE_VALUE = 500;
const MAX_DIMENSION = 20000;

// CSS pixel presets. Mobile tracks the current iPhone class; desktop fills the
// stage and only falls back to these numbers when the stage is smaller.
const VIEWPORT_PRESETS = Object.freeze({
  mobile: Object.freeze({ id: 'mobile', label: 'Mobile', width: 393, height: 852 }),
  desktop: Object.freeze({ id: 'desktop', label: 'Desktop', width: 1440, height: 900 }),
  custom: Object.freeze({ id: 'custom', label: 'Custom', width: 1280, height: 800 })
});

function clampText(value, max) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

function clampInt(value, { min = 0, max = MAX_DIMENSION } = {}) {
  const number = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, Math.round(number)));
}

// A dimension of zero or less is "not provided", never a 1px viewport.
function positiveInt(value) {
  const number = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(number) || number < 1) return null;
  return Math.min(MAX_DIMENSION, Math.round(number));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeAnchor(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.selector !== 'string' || !raw.selector.trim()) return null;
  const anchor = {
    selector: clampText(raw.selector, MAX_SELECTOR),
    tag: clampText(raw.tag, 60),
    snippet: clampText(raw.snippet, MAX_SNIPPET)
  };
  if (raw.size && typeof raw.size === 'object') {
    const width = clampInt(raw.size.width);
    const height = clampInt(raw.size.height);
    if (width !== null && height !== null) anchor.size = { width, height };
  }
  return anchor;
}

function normalizeViewport(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const preset = VIEWPORT_IDS.has(raw.preset) ? raw.preset : 'custom';
  const fallback = VIEWPORT_PRESETS[preset];
  const width = positiveInt(raw.width) ?? fallback.width;
  const height = positiveInt(raw.height) ?? fallback.height;
  return { preset, width, height };
}

function normalizePosition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const index = clampInt(raw.index, { min: 0, max: 100000 });
  if (index === null) return null;
  return { parent: clampText(raw.parent, MAX_SELECTOR), index };
}

// One browser-recorded edit. Returns null for anything unusable so a single
// malformed record never blocks the batch it arrived in.
function normalizeEdit(raw, position) {
  if (!raw || typeof raw !== 'object') return null;
  if (!EDIT_KINDS.has(raw.kind)) return null;
  if (typeof raw.selector !== 'string' || !raw.selector.trim()) return null;
  const edit = {
    id: clampText(typeof raw.id === 'string' ? raw.id : `edit-${position + 1}`, 40),
    kind: raw.kind,
    selector: clampText(raw.selector, MAX_SELECTOR),
    tag: clampText(raw.tag, 60),
    snippet: clampText(raw.snippet, MAX_SNIPPET),
    at: typeof raw.at === 'string' && raw.at ? clampText(raw.at, 40) : nowIso()
  };
  if (raw.stale === true) edit.stale = true;

  switch (raw.kind) {
    case 'text': {
      edit.before = clampText(raw.before, MAX_TEXT);
      edit.after = clampText(raw.after, MAX_TEXT);
      if (typeof raw.htmlAfter === 'string') edit.htmlAfter = clampText(raw.htmlAfter, MAX_MARKUP);
      return edit;
    }
    case 'resize': {
      const width = clampInt(raw.width, { min: 1 });
      const height = clampInt(raw.height, { min: 1 });
      if (width === null && height === null) return null;
      if (width !== null) edit.width = width;
      if (height !== null) edit.height = height;
      if (raw.before && typeof raw.before === 'object') {
        edit.before = {};
        const beforeWidth = clampInt(raw.before.width, { min: 0 });
        const beforeHeight = clampInt(raw.before.height, { min: 0 });
        if (beforeWidth !== null) edit.before.width = beforeWidth;
        if (beforeHeight !== null) edit.before.height = beforeHeight;
      }
      return edit;
    }
    case 'move': {
      const from = normalizePosition(raw.from);
      const to = normalizePosition(raw.to);
      if (!from || !to) return null;
      edit.from = from;
      edit.to = to;
      return edit;
    }
    case 'nudge': {
      const dx = clampInt(raw.dx, { min: -MAX_DIMENSION });
      const dy = clampInt(raw.dy, { min: -MAX_DIMENSION });
      if (dx === null || dy === null) return null;
      edit.dx = dx;
      edit.dy = dy;
      return edit;
    }
    case 'remove': {
      edit.outerHTML = clampText(raw.outerHTML, MAX_MARKUP);
      const position = normalizePosition(raw.from);
      if (position) edit.from = position;
      return edit;
    }
    case 'style': {
      if (typeof raw.property !== 'string' || !/^[a-z][a-z0-9-]{0,59}$/.test(raw.property)) return null;
      edit.property = raw.property;
      edit.before = clampText(raw.before, MAX_STYLE_VALUE);
      edit.after = raw.after === null || raw.after === undefined ? null : clampText(String(raw.after), MAX_STYLE_VALUE);
      return edit;
    }
    default:
      return null;
  }
}

function normalizeEdits(rawEdits) {
  const edits = [];
  for (const raw of Array.isArray(rawEdits) ? rawEdits.slice(0, MAX_EDITS) : []) {
    const edit = normalizeEdit(raw, edits.length);
    if (edit) edits.push(edit);
  }
  return edits;
}

function where(edit) {
  const label = edit.snippet ? `"${edit.snippet.slice(0, 48)}${edit.snippet.length > 48 ? '…' : ''}"` : '';
  const target = edit.tag ? `<${edit.tag}>` : '';
  return [edit.selector, target, label].filter(Boolean).join(' ');
}

// Human-readable one-liner for an edit, used by chat transcripts, the Stop
// hook, and the agent-facing summary. Never includes markup.
function summarizeEdit(edit) {
  if (!edit || typeof edit !== 'object') return '';
  const target = where(edit);
  const stale = edit.stale ? ' (could not be re-applied after the last reload)' : '';
  switch (edit.kind) {
    case 'text':
      return `text of ${target}: "${edit.before}" → "${edit.after}"${stale}`;
    case 'resize': {
      const size = [edit.width !== undefined ? `${edit.width}px wide` : null, edit.height !== undefined ? `${edit.height}px tall` : null]
        .filter(Boolean)
        .join(', ');
      const before = edit.before && (edit.before.width !== undefined || edit.before.height !== undefined)
        ? ` (was ${edit.before.width ?? '?'}×${edit.before.height ?? '?'})`
        : '';
      return `resized ${target} to ${size}${before}${stale}`;
    }
    case 'move':
      return `moved ${target} from ${edit.from.parent || 'its parent'}[${edit.from.index}] to ${edit.to.parent || 'its parent'}[${edit.to.index}]${stale}`;
    case 'nudge':
      return `nudged ${target} by ${edit.dx}px, ${edit.dy}px${stale}`;
    case 'remove':
      return `removed ${target}${stale}`;
    case 'style':
      return edit.after === null
        ? `removed ${edit.property} from ${target} (was ${edit.before || 'unset'})${stale}`
        : `set ${edit.property} on ${target} to ${edit.after} (was ${edit.before || 'unset'})${stale}`;
    default:
      return '';
  }
}

// Normalize one browser-submitted UI Canvas feedback item into the shape the
// agent receives. Mirrors plan-canvas's normalizeFeedbackItem contract: null
// for unusable input, never a throw.
function normalizeUiFeedbackItem(raw, counter) {
  if (!raw || typeof raw !== 'object') return null;
  if (!UI_FEEDBACK_KINDS.has(raw.kind)) return null;
  const item = {
    id: `fb-${counter}`,
    kind: raw.kind,
    text: clampText(raw.text, MAX_TEXT).trim(),
    at: nowIso()
  };
  if (raw.kind === 'chat') {
    if (!item.text) return null;
    const anchor = normalizeAnchor(raw.anchor);
    if (anchor) item.anchor = anchor;
    if (Array.isArray(raw.pendingEdits) && raw.pendingEdits.length) {
      item.pendingEdits = raw.pendingEdits
        .slice(0, MAX_EDIT_SUMMARIES)
        .map(entry => (typeof entry === 'string' ? clampText(entry, 240) : summarizeEdit(normalizeEdit(entry, 0))))
        .filter(Boolean);
    }
    return item;
  }
  item.edits = normalizeEdits(raw.edits);
  item.editCount = item.edits.length;
  const viewport = normalizeViewport(raw.viewport);
  if (viewport) item.viewport = viewport;
  if (typeof raw.exportPath === 'string' && raw.exportPath) item.exportPath = raw.exportPath;
  if (typeof raw.editsPath === 'string' && raw.editsPath) item.editsPath = raw.editsPath;
  return item;
}

// Finish writes the canonical <name>.edited.html and <name>.edits.json. Each
// Apply batch gets its own <name>.apply-<batch>.* pair so a later batch never
// rewrites the snapshot an earlier queued item points at.
function exportPathsFor(artifactFile, batch = '') {
  const dir = path.dirname(artifactFile);
  const ext = path.extname(artifactFile);
  const base = path.basename(artifactFile, ext) + (batch ? `.apply-${batch}` : '');
  return {
    exportPath: path.join(dir, `${base}.edited${ext || '.html'}`),
    editsPath: path.join(dir, `${base}.edits.json`)
  };
}

function newBatchId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(12).toString('hex')}`;
  // Open exclusively before entering cleanup: a collision belongs to somebody
  // else and must never be followed, overwritten, or removed by this writer.
  const handle = fs.openSync(tmp, 'wx', 0o600);
  let pending = true;
  try {
    try {
      fs.writeFileSync(handle, data);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(tmp, file);
    pending = false;
  } finally {
    if (pending) fs.rmSync(tmp, { force: true });
  }
}

// Persist the reviewer's snapshot next to the artifact so the agent (or a
// Stop hook running with no server) can read the exact DOM the human saw.
function writeExport(artifactFile, { html, edits = [], viewport = null, kind = 'edits' } = {}) {
  if (typeof html !== 'string' || !html.trim()) {
    throw Object.assign(new Error('html snapshot is required'), { code: 'EUI_HTML_MISSING' });
  }
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > MAX_HTML_BYTES) {
    throw Object.assign(new Error(`html snapshot exceeds ${MAX_HTML_BYTES} bytes`), { code: 'EUI_HTML_TOO_LARGE' });
  }
  const { exportPath, editsPath } = exportPathsFor(artifactFile, kind === 'finish' ? '' : newBatchId());
  writeAtomic(exportPath, html);
  writeAtomic(
    editsPath,
    `${JSON.stringify({ artifact: artifactFile, kind, at: nowIso(), viewport, edits }, null, 2)}\n`
  );
  return { exportPath, editsPath, bytes };
}

function uiChatLineFor(item) {
  if (item.kind === 'finish') {
    const count = item.editCount || 0;
    const base = `Saved and finished with ${count} edit${count === 1 ? '' : 's'}`;
    return item.text ? `${base}: ${item.text}` : base;
  }
  if (item.kind === 'edits') {
    const count = item.editCount || 0;
    const base = `Applied ${count} edit${count === 1 ? '' : 's'} to the preview`;
    return item.text ? `${base}: ${item.text}` : base;
  }
  if (item.anchor) {
    const label = item.anchor.snippet || item.anchor.selector;
    return `[${label}] ${item.text}`;
  }
  return item.text;
}

module.exports = {
  EDIT_KINDS,
  MAX_EDITS,
  MAX_HTML_BYTES,
  UI_FEEDBACK_KINDS,
  VIEWPORT_PRESETS,
  exportPathsFor,
  normalizeAnchor,
  normalizeEdit,
  normalizeEdits,
  normalizeUiFeedbackItem,
  normalizeViewport,
  summarizeEdit,
  uiChatLineFor,
  writeExport
};
