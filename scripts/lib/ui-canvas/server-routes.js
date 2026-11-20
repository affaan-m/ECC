'use strict';

/**
 * UI Canvas pieces of the shared Plan Canvas server: the browser assets it
 * serves and the export step that turns an edit batch's DOM snapshot into
 * files beside the artifact. Kept here so the shared server only branches on
 * session mode.
 */

const { uiEditorJs } = require('./editor');
const { renderUiCanvasHtml, uiCanvasCss, uiClientJs } = require('./ui');
const { normalizeEdits, writeExport } = require('./feedback');

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

// UI Canvas edit batches arrive with the full DOM snapshot. Write it (and the
// edit log) next to the artifact before the item is queued, and hand the agent
// paths instead of megabytes of markup. Chat items pass through untouched.
function materializeUiExports(session, items) {
  return items.map(item => {
    if (!item || typeof item !== 'object' || (item.kind !== 'edits' && item.kind !== 'finish')) return item;
    // The on-disk log holds the same normalized edits the agent receives.
    const edits = normalizeEdits(item.edits);
    const written = writeExport(session.file, {
      html: item.html,
      edits,
      viewport: item.viewport || null,
      kind: item.kind
    });
    const { html: _html, ...rest } = item;
    return { ...rest, edits, exportPath: written.exportPath, editsPath: written.editsPath };
  });
}

// Map an export failure to the HTTP status and message the browser shows.
function exportErrorResponse(error) {
  if (error.code === 'EUI_HTML_TOO_LARGE') return { status: 413, error: 'html snapshot too large' };
  if (error.code === 'EUI_HTML_MISSING') return { status: 400, error: 'edits and finish items need an html snapshot' };
  return { status: 500, error: `could not write the export next to the artifact: ${error.message}` };
}

module.exports = { UI_ASSETS, exportErrorResponse, materializeUiExports, renderUiCanvasHtml, serveUiAsset };
