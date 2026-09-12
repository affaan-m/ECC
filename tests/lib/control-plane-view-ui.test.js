'use strict';

const assert = require('assert');
const vm = require('vm');
const { renderControlPlaneViewHtml } = require('../../scripts/lib/control-pane/control-plane-view-ui');

async function renderResponse(ok, data) {
  const elements = new Map();
  const context = new Proxy({}, { get: () => () => {} });
  function element() {
    return { textContent: '', style: {}, appendChild() {}, getContext: () => context,
      clientWidth: 640, clientHeight: 480,
      parentElement: { getBoundingClientRect: () => ({ width: 640, height: 480 }) } };
  }
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element
  };
  const code = renderControlPlaneViewHtml().match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(code, {
    document, window: { addEventListener() {}, devicePixelRatio: 1 }, setInterval() {},
    fetch: async () => ({ ok, json: async () => data })
  });
  await new Promise(resolve => setImmediate(resolve));
  return elements;
}

(async () => {
  const failed = await renderResponse(false, { ok: false, error: 'snapshot unavailable' });
  assert.strictEqual(failed.get('status').textContent, 'offline', 'HTTP errors must not display a healthy empty view');
  const malformed = await renderResponse(true, { schemaVersion: 'wrong' });
  assert.strictEqual(malformed.get('status').textContent, 'offline', 'invalid schemas must be rejected');
  const valid = await renderResponse(true, {
    schemaVersion: 'ecc.control-plane.view.v1', tasks: [], lanes: [], pairs: [], events: [],
    projection: { agents: [] }, thresholds: { ta: 0.35, ra: 0.7 }, counts: {}
  });
  assert.ok(valid.get('status').textContent.includes('0 tasks'));
  console.log('PASS control-plane UI error and schema handling');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
