'use strict';

/**
 * UI Canvas pieces of the shared Plan Canvas server: the browser assets it
 * serves and the export step that turns an edit batch's DOM snapshot into
 * files beside the artifact. Kept here so the shared server only branches on
 * session mode.
 */

const crypto = require('crypto');

const { uiEditorJs } = require('./editor');
const { renderUiCanvasHtml, uiCanvasCss, uiClientJs } = require('./ui');
const { MAX_EDITS, MAX_HTML_BYTES, normalizeEdit, normalizeEdits, writeExport } = require('./feedback');

const UI_ASSETS = {
  '/ui-canvas.css': { type: 'text/css; charset=utf-8', body: uiCanvasCss },
  '/ui-client.js': { type: 'text/javascript; charset=utf-8', body: uiClientJs },
  '/ui-editor.js': { type: 'text/javascript; charset=utf-8', body: uiEditorJs }
};

// Serve a UI Canvas asset when pathname names one; returns true when handled.
function serveUiAsset(pathname, res) {
  const asset = Object.prototype.hasOwnProperty.call(UI_ASSETS, pathname) ? UI_ASSETS[pathname] : null;
  if (!asset) return false;
  res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' });
  res.end(asset.body());
  return true;
}

function requireLosslessReplay(raw) {
  const reject = field => {
    throw Object.assign(new Error(`replay cannot preserve the edit's ${field}; use a supported value`), { code: 'EUI_REPLAY_LOSSY' });
  };
  if (raw && raw.kind === 'nudge') {
    for (const value of [raw.dx, raw.dy]) {
      const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
      if (!Number.isFinite(parsed)) reject('numeric value');
    }
  }
  const edit = normalizeEdit(raw, 0);
  if (!edit) return; // Preserve omission of unrelated malformed/unknown kinds.
  if (raw.selector !== edit.selector) reject('selector');
  if (typeof raw.id === 'string' && raw.id !== edit.id) reject('identity');
  if (edit.kind === 'text') {
    if (raw.htmlAfter !== undefined) {
      if (typeof raw.htmlAfter !== 'string' || raw.htmlAfter !== edit.htmlAfter) reject('markup');
    } else if (raw.after !== undefined && raw.after !== null && raw.after !== edit.after) reject('text');
  }
  if (edit.kind === 'style') {
    const after = raw.after === null || raw.after === undefined ? null : String(raw.after);
    if (after !== edit.after) reject('style value');
  }
  const number = (value, normalized) => {
    if (value === undefined || value === null) return;
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed !== normalized) reject('numeric value');
  };
  if (edit.kind === 'resize') { number(raw.width, edit.width); number(raw.height, edit.height); }
  if (edit.kind === 'nudge') { number(raw.dx, edit.dx); number(raw.dy, edit.dy); }
  if (edit.kind === 'move') {
    if (raw.to.parent !== edit.to.parent) reject('destination selector');
    number(raw.to.index, edit.to.index);
  }
}

function includedBatchIds(session, bakedIds) {
  return (session.uiBatches || [])
    .filter(batch => batch.edits.length > 0 && batch.edits.every(edit => bakedIds.has(edit.id)))
    .map(batch => batch.id);
}

// UI Canvas edit batches arrive with the full DOM snapshot. Write it (and the
// edit log) next to the artifact before the item is queued, and hand the agent
// paths instead of megabytes of markup. Chat items pass through untouched.
function materializeUiExports(session, items) {
  for (const item of items) {
    if (!item || typeof item !== 'object' || (item.kind !== 'edits' && item.kind !== 'finish')) continue;
    if (Array.isArray(item.edits) && item.edits.length > MAX_EDITS) throw Object.assign(new Error('too many edits in one Apply'), { code: 'EUI_EDITS_TOO_LARGE' });
    if (item.bakedEditIds !== undefined && (!Array.isArray(item.bakedEditIds) || item.bakedEditIds.length > 5000
        || item.bakedEditIds.some(id => typeof id !== 'string' || id.length > 40))) {
      throw Object.assign(new Error('invalid or oversized applied-edit proof'), { code: 'EUI_PROOF_INVALID' });
    }
    for (const raw of Array.isArray(item.edits) ? item.edits : []) requireLosslessReplay(raw);
    if (includedBatchIds(session, new Set(item.bakedEditIds || [])).length > 49) {
      throw Object.assign(new Error('too many unincorporated Apply batches; ask the agent to incorporate them before applying more'), { code: 'EUI_PROOF_INVALID' });
    }
    if (typeof item.html !== 'string' || !item.html.trim()) throw Object.assign(new Error('html snapshot is required'), { code: 'EUI_HTML_MISSING' });
    if (Buffer.byteLength(item.html, 'utf8') > MAX_HTML_BYTES) throw Object.assign(new Error('html snapshot too large'), { code: 'EUI_HTML_TOO_LARGE' });
  }
  return items.map(item => {
    if (!item || typeof item !== 'object' || (item.kind !== 'edits' && item.kind !== 'finish')) return item;
    // The on-disk log holds the same normalized edits the agent receives.
    const edits = normalizeEdits(item.edits);
    const bakedIds = new Set(item.bakedEditIds || []);
    const includedBatches = includedBatchIds(session, bakedIds);
    const written = writeExport(session.file, {
      html: item.html,
      edits,
      viewport: item.viewport || null,
      kind: item.kind
    });
    const { html: _html, ...rest } = item;
    return { ...rest, edits, includedBatches, snapshotHash: crypto.createHash('sha256').update(item.html).digest('hex'), exportPath: written.exportPath, editsPath: written.editsPath };
  });
}

// Map an export failure to the HTTP status and message the browser shows.
function exportErrorResponse(error) {
  if (error.code === 'EUI_REPLAY_LOSSY') return { status: 422, error: error.message };
  if (error.code === 'EUI_PROOF_INVALID' || error.code === 'EUI_EDITS_TOO_LARGE') return { status: 413, error: error.message };
  if (error.code === 'EUI_HTML_TOO_LARGE') return { status: 413, error: 'html snapshot too large' };
  if (error.code === 'EUI_HTML_MISSING') return { status: 400, error: 'edits and finish items need an html snapshot' };
  return { status: 500, error: `could not write the export next to the artifact: ${error.message}` };
}

module.exports = { UI_ASSETS, exportErrorResponse, materializeUiExports, renderUiCanvasHtml, serveUiAsset };
