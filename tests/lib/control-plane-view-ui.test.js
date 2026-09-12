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
  const html = renderControlPlaneViewHtml();
  const start = html.indexOf('<script>');
  const end = html.indexOf('</script>', start);
  assert.ok(start >= 0 && end > start, 'fixed renderer template must contain its inline script');
  const code = html.slice(start + '<script>'.length, end);
  vm.runInNewContext(code, {
    document, window: { addEventListener() {}, devicePixelRatio: 1 }, setInterval() {},
    fetch: async () => ({ ok, json: async () => data })
  });
  await new Promise(resolve => setImmediate(resolve));
  return elements;
}

let passed = 0;
(async () => {
  const failed = await renderResponse(false, { ok: false, error: 'snapshot unavailable' });
  assert.strictEqual(failed.get('status').textContent, 'offline', 'HTTP errors must not display a healthy empty view');
  passed += 1;
  const malformed = await renderResponse(true, { schemaVersion: 'wrong' });
  assert.strictEqual(malformed.get('status').textContent, 'offline', 'invalid schemas must be rejected');
  passed += 1;
  const valid = await renderResponse(true, {
    schemaVersion: 'ecc.control-plane.view.v1', tasks: [], lanes: [], pairs: [], events: [],
    projection: { agents: [] }, thresholds: { ta: 0.35, ra: 0.7 }, counts: {}
  });
  assert.ok(valid.get('status').textContent.includes('0 tasks'));
  passed += 1;
  console.log(`Results: Passed: ${passed}, Failed: 0`);
})().catch(error => {
  console.error(error.message);
  console.log(`Results: Passed: ${passed}, Failed: 1`);
  process.exitCode = 1;
});
