/**
 * Integration tests for the Plan Canvas server (scripts/lib/plan-canvas/).
 *
 * Spins up the real HTTP server in-process and drives it exactly like the
 * browser chrome (finite fetch polling) and the agent CLI (long-poll) do.
 *
 * Run with: node tests/scripts/plan-canvas.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { createSessionStore } = require('../../scripts/lib/plan-canvas/sessions');
const {
  PLAN_CANVAS_RUNTIME_ID,
  createPlanCanvasServer
} = require('../../scripts/lib/plan-canvas/server');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.stack || err.message}`);
    return false;
  }
}

function request(port, method, requestPath, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: requestPath,
        agent: false,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers }
          : headers
      },
      res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function jsonBody(res) {
  return JSON.parse(res.body.trim());
}

async function browserState(port, key) {
  return jsonBody(await request(port, 'GET', `/api/session/${key}/state`));
}

function waitFor(predicate, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitFor timed out'));
      }
    }, intervalMs);
  });
}

async function main() {
  console.log('\n=== Testing plan-canvas server ===\n');

  let passed = 0;
  let failed = 0;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-server-'));
  const artifact = path.join(tmp, 'demo.plan.md');
  fs.writeFileSync(artifact, '# Plan: Demo\n\n## Files to Change\n\n| File | Action |\n|---|---|\n| `a.js` | UPDATE |\n');
  const htmlArtifact = path.join(tmp, 'report.html');
  fs.writeFileSync(
    htmlArtifact,
    '<!DOCTYPE html><html><body><h1>Report</h1><img src="https://example.invalid/tracker.png"><script>navigator.sendBeacon("https://example.invalid/beacon", "plan")</script></body></html>'
  );
  fs.writeFileSync(path.join(tmp, 'style.css'), 'body { color: red }');
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-outside-'));
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret');

  const store = createSessionStore({ stateDir: path.join(tmp, 'state') });
  const pdfRequests = [];
  let holdPdfExport = false;
  let releasePdfExport = null;
  let pdfFailure = null;
  const serverLogs = [];
  let idleFired = false;
  const canvas = createPlanCanvasServer({
    store,
    version: '9.9.9-test',
    heartbeatMs: 25,
    idleTimeoutMs: 0,
    pdfExporter: async options => {
      pdfRequests.push(options);
      if (pdfFailure) throw pdfFailure;
      if (holdPdfExport) await new Promise(resolve => { releasePdfExport = resolve; });
      return { buffer: Buffer.from('%PDF-1.4\n%%EOF\n'), filename: 'demo.pdf' };
    },
    log: line => serverLogs.push(line),
    onIdleShutdown: () => {
      idleFired = true;
    }
  });
  const { port } = await canvas.listen(0);

  let key = null;
  let htmlKey = null;

  if (await test('GET /health identifies the app and version', async () => {
    const res = await request(port, 'GET', '/health');
    assert.deepStrictEqual(jsonBody(res), {
      ok: true,
      app: 'ecc-plan-canvas',
      version: '9.9.9-test',
      protocolVersion: 4,
      runtimeId: PLAN_CANVAS_RUNTIME_ID
    });
  })) passed++; else failed++;

  if (await test('requests with a non-loopback Host header are rejected', async () => {
    const res = await request(port, 'GET', '/health', { headers: { host: 'evil.example.com' } });
    assert.strictEqual(res.statusCode, 403);
  })) passed++; else failed++;

  if (await test('requests with a cross-site Origin are rejected', async () => {
    const res = await request(port, 'POST', '/shutdown', { headers: { origin: 'https://evil.example.com' } });
    assert.strictEqual(res.statusCode, 403);
  })) passed++; else failed++;

  if (await test('POST /api/sessions opens a session for an existing artifact', async () => {
    const res = await request(port, 'POST', '/api/sessions', { body: { file: artifact } });
    assert.strictEqual(res.statusCode, 200);
    const body = jsonBody(res);
    assert.strictEqual(body.status, 'open');
    assert.match(body.key, /^[a-f0-9]{12}$/);
    key = body.key;
  })) passed++; else failed++;

  if (await test('POST /api/sessions 404s for a missing artifact', async () => {
    const res = await request(port, 'POST', '/api/sessions', { body: { file: path.join(tmp, 'nope.md') } });
    assert.strictEqual(res.statusCode, 404);
  })) passed++; else failed++;

  if (await test('GET /canvas/:key serves the ECC chrome with CSP', async () => {
    const res = await request(port, 'GET', `/canvas/${key}`);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.headers['content-security-policy'].includes("default-src 'self'"));
    assert.ok(res.body.includes('Plan Canvas'));
    assert.ok(res.body.includes('pc-session'));
    assert.ok(res.body.includes('Approve plan'));
    assert.ok(res.body.includes('Download PDF'));
    assert.ok(res.body.includes('sandbox="allow-scripts allow-forms allow-popups"'));
  })) passed++; else failed++;

  if (await test('markdown artifacts render in the ECC plan template with the SDK', async () => {
    const res = await request(port, 'GET', `/artifact/${key}/`);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.includes('<h1 id="plan-demo">'));
    assert.ok(res.body.includes('<table>'));
    assert.ok(res.body.includes('<script src="/sdk.js">'));
    assert.strictEqual(res.headers['content-security-policy'], undefined);
    // No diagram in this plan → no Mermaid loader shipped.
    assert.ok(!res.body.includes('mermaid.run'));
  })) passed++; else failed++;

  if (await test('a plan containing ```mermaid serves the themed Mermaid loader', async () => {
    const diagram = path.join(tmp, 'flow.plan.md');
    fs.writeFileSync(diagram, '# Flow\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
    const opened = jsonBody(await request(port, 'POST', '/api/sessions', { body: { file: diagram } }));
    const res = await request(port, 'GET', `/artifact/${opened.key}/`);
    assert.ok(res.body.includes('<pre class="mermaid">'), 'diagram container present');
    assert.ok(res.body.includes('mermaid.run'), 'loader injected');
    assert.ok(res.body.includes("securityLevel: 'strict'"), 'sanitizing config present');
    const loadListenerIndex = res.body.indexOf("window.addEventListener('load'");
    const remoteImportIndex = res.body.indexOf('await import(');
    assert.ok(
      loadListenerIndex >= 0 && loadListenerIndex < remoteImportIndex,
      'remote Mermaid enhancement must start after document load so a stalled CDN cannot hold the page open'
    );
    await request(port, 'POST', '/api/end', { body: { file: diagram } });
  })) passed++; else failed++;

  if (await test('HTML artifacts pass through with the SDK injected before </body>', async () => {
    const open = await request(port, 'POST', '/api/sessions', { body: { file: htmlArtifact } });
    htmlKey = jsonBody(open).key;
    const res = await request(port, 'GET', `/artifact/${htmlKey}/`);
    assert.ok(res.body.includes('<h1>Report</h1>'));
    assert.ok(res.body.includes('<script src="/sdk.js"></script>\n</body>'));
  })) passed++; else failed++;

  if (await test('PDF artifact responses block remote images and inline beacon egress', async () => {
    const res = await request(port, 'GET', `/artifact/${htmlKey}/?pdf=1`);
    const csp = res.headers['content-security-policy'];
    assert.strictEqual(res.statusCode, 200);
    assert.ok(csp.includes("default-src 'none'"));
    assert.ok(csp.includes("img-src 'self' data:"));
    assert.ok(csp.includes("connect-src 'none'"));
    assert.ok(csp.includes("form-action 'none'"));
    assert.ok(csp.includes("script-src 'none'"));
    assert.ok(res.body.includes('https://example.invalid/tracker.png'));
    assert.ok(res.body.includes('navigator.sendBeacon'));
  })) passed++; else failed++;

  if (await test('sibling assets are served, traversal is blocked', async () => {
    const ok = await request(port, 'GET', `/artifact/${key}/style.css`);
    assert.strictEqual(ok.statusCode, 200);
    assert.ok(ok.body.includes('color: red'));
    const escape = await request(port, 'GET', `/artifact/${key}/..%2F${path.basename(outsideDir)}%2Fsecret.txt`);
    assert.strictEqual(escape.statusCode, 403);
  })) passed++; else failed++;

  if (await test('static chrome assets are served', async () => {
    for (const asset of ['/canvas.css', '/client.js', '/sdk.js']) {
      const res = await request(port, 'GET', asset);
      assert.strictEqual(res.statusCode, 200, `${asset} should be 200`);
    }
    const sdk = await request(port, 'GET', '/sdk.js');
    assert.doesNotThrow(() => new Function(sdk.body));
    assert.ok(sdk.body.includes("msg.type === 'pc:export-snapshot'"));
    assert.ok(sdk.body.includes("querySelectorAll('script,iframe,object,embed,form,base,meta[http-equiv]"));
  })) passed++; else failed++;

  if (await test('Download PDF fetches a generated PDF and starts a browser download', async () => {
    const client = await request(port, 'GET', '/client.js');
    assert.ok(client.body.includes("'/api/session/' + key + '/pdf'"));
    assert.ok(client.body.includes("method: snapshot ? 'POST' : 'GET'"));
    assert.ok(client.body.includes("type: 'pc:export-snapshot'"));
    assert.ok(client.body.includes('URL.createObjectURL'));

    const res = await request(port, 'GET', `/api/session/${key}/pdf`);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-type'], 'application/pdf');
    assert.match(res.headers['content-disposition'], /^attachment;/);
    assert.strictEqual(res.headers['x-plan-canvas-filename'], 'demo.pdf');
    assert.ok(res.body.startsWith('%PDF-1.4'));
    assert.strictEqual(pdfRequests.length, 1);
    assert.strictEqual(pdfRequests[0].artifactFile, fs.realpathSync(artifact));
    assert.strictEqual(pdfRequests[0].url, `http://127.0.0.1:${port}/artifact/${key}/?pdf=1`);
  })) passed++; else failed++;

  if (await test('concurrent PDF exports return a bounded retryable overload response', async () => {
    holdPdfExport = true;
    const snapshot = '<!doctype html><html><body><h1>Already rendered diagram</h1><svg><text>Local SVG</text></svg><script>fetch("https://example.invalid")</script></body></html>';
    const first = request(port, 'POST', `/api/session/${key}/pdf`, { body: { html: snapshot } });
    try {
      await waitFor(() => typeof releasePdfExport === 'function');
      const printable = await request(port, 'GET', `/artifact/${key}/?pdf=1`);
      assert.ok(printable.body.includes('Already rendered diagram'));
      assert.ok(printable.body.includes('Local SVG'));
      assert.ok(printable.headers['content-security-policy'].includes("script-src 'none'"));
      const overloaded = await request(port, 'GET', `/api/session/${key}/pdf`);
      assert.strictEqual(overloaded.statusCode, 429);
      assert.strictEqual(overloaded.headers['retry-after'], '1');
      assert.deepStrictEqual(jsonBody(overloaded), {
        error: 'another PDF export is already in progress',
        code: 'PDF_EXPORT_BUSY'
      });
    } finally {
      const release = releasePdfExport;
      holdPdfExport = false;
      releasePdfExport = null;
      if (release) release();
    }
    assert.strictEqual((await first).statusCode, 200);
  })) passed++; else failed++;

  if (await test('an incomplete PDF snapshot body does not consume renderer admission', async () => {
    const stalled = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: `/api/session/${key}/pdf`,
      agent: false,
      headers: { 'content-type': 'application/json', 'content-length': 1024 }
    });
    stalled.on('error', () => {});
    stalled.write('{"html":"partial');
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      const competing = await request(port, 'GET', `/api/session/${key}/pdf`);
      assert.strictEqual(competing.statusCode, 200);
      assert.strictEqual(competing.headers['content-type'], 'application/pdf');
    } finally {
      stalled.destroy();
    }
  })) passed++; else failed++;

  if (await test('an active PDF export rejects incomplete snapshot uploads before reading them', async () => {
    holdPdfExport = true;
    const first = request(port, 'GET', `/api/session/${key}/pdf`);
    let stalled = null;
    try {
      await waitFor(() => typeof releasePdfExport === 'function');
      const competing = new Promise((resolve, reject) => {
        stalled = http.request({
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `/api/session/${key}/pdf`,
          agent: false,
          headers: { 'content-type': 'application/json', 'content-length': 1024 }
        }, res => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        });
        stalled.on('error', reject);
        stalled.write('{"html":"partial');
      });
      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('incomplete PDF upload was not rejected')), 500);
      });
      const overloaded = await Promise.race([competing, timeout]);
      assert.strictEqual(overloaded.statusCode, 429);
      assert.strictEqual(jsonBody(overloaded).code, 'PDF_EXPORT_BUSY');
    } finally {
      if (stalled) stalled.destroy();
      const release = releasePdfExport;
      holdPdfExport = false;
      releasePdfExport = null;
      if (release) release();
    }
    assert.strictEqual((await first).statusCode, 200);
  })) passed++; else failed++;

  if (await test('PDF failures log diagnostics without disclosing local paths', async () => {
    try {
      const rendererError = new Error('Chromium failed at /Users/private/browser-profile');
      rendererError.code = 'PDF_EXPORT_FAILED';
      pdfFailure = rendererError;
      const failed = await request(port, 'GET', `/api/session/${key}/pdf`);
      assert.strictEqual(failed.statusCode, 500);
      assert.deepStrictEqual(jsonBody(failed), {
        error: 'PDF export failed; check the Plan Canvas server log for details',
        code: 'PDF_EXPORT_FAILED'
      });
      assert.ok(!failed.body.includes('/Users/private'));
      assert.ok(serverLogs.some(line => line.includes('/Users/private/browser-profile')));

      const browserError = new Error('missing override /Users/private/Chrome');
      browserError.code = 'PDF_BROWSER_NOT_FOUND';
      pdfFailure = browserError;
      const missing = await request(port, 'GET', `/api/session/${key}/pdf`);
      assert.strictEqual(missing.statusCode, 503);
      assert.strictEqual(jsonBody(missing).code, 'PDF_BROWSER_NOT_FOUND');
      assert.ok(jsonBody(missing).error.includes('ECC_PLAN_CANVAS_CHROME_PATH'));
      assert.ok(!missing.body.includes('/Users/private'));
    } finally {
      pdfFailure = null;
    }
  })) passed++; else failed++;

  if (await test('browser client uses finite polling instead of one permanent connection per canvas', async () => {
    const res = await request(port, 'GET', '/client.js');
    assert.ok(res.body.includes("'/api/session/' + key + '/state'"));
    assert.ok(!res.body.includes('new EventSource('));
  })) passed++; else failed++;

  if (await test('legacy EventSource endpoint retires without reconnecting', async () => {
    const res = await request(port, 'GET', `/events/${key}`);
    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.body, '');
  })) passed++; else failed++;

  if (await test('finite browser polls keep an actively viewed canvas server alive', async () => {
    const idleArtifact = path.join(tmp, 'browser-active.plan.md');
    fs.writeFileSync(idleArtifact, '# Plan: Browser Active\n');
    const idleStore = createSessionStore({ stateDir: path.join(tmp, 'browser-active-state') });
    let shutdowns = 0;
    const idleCanvas = createPlanCanvasServer({
      store: idleStore,
      version: '9.9.9-test',
      idleTimeoutMs: 200,
      onIdleShutdown: () => { shutdowns += 1; }
    });
    const bound = await idleCanvas.listen(0);
    const opened = jsonBody(await request(bound.port, 'POST', '/api/sessions', { body: { file: idleArtifact } }));

    await new Promise(resolve => setTimeout(resolve, 100));
    await browserState(bound.port, opened.key);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(shutdowns, 0);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.strictEqual(shutdowns, 1);
    await idleCanvas.close();
  })) passed++; else failed++;

  if (await test('await with timeoutMs returns waiting when idle', async () => {
    const res = await request(port, 'GET', `/api/await?file=${encodeURIComponent(artifact)}&timeoutMs=50`);
    assert.strictEqual(jsonBody(res).status, 'waiting');
  })) passed++; else failed++;

  if (await test('await returns missing for files without a session', async () => {
    const res = await request(port, 'GET', `/api/await?file=${encodeURIComponent(path.join(tmp, 'other.md'))}`);
    assert.strictEqual(jsonBody(res).status, 'missing');
  })) passed++; else failed++;

  if (await test('browser feedback wakes a blocking await; presence transitions', async () => {
    const awaitPromise = request(port, 'GET', `/api/await?file=${encodeURIComponent(artifact)}`);
    await waitFor(() => canvas.presenceFor(key) === 'listening');
    assert.strictEqual((await browserState(port, key)).presence, 'listening');

    const post = await request(port, 'POST', `/api/session/${key}/feedback`, {
      body: {
        items: [
          { kind: 'annotation', text: 'tighten this', anchor: { selector: 'h2:nth-of-type(1)', tag: 'h2', snippet: 'Files to Change' } },
          { kind: 'verdict', verdict: 'request-changes' }
        ]
      }
    });
    assert.strictEqual(jsonBody(post).accepted, 2);

    const result = jsonBody(await awaitPromise);
    assert.strictEqual(result.status, 'feedback');
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.items[0].anchor.selector, 'h2:nth-of-type(1)');
    assert.strictEqual(result.items[1].verdict, 'request-changes');

    const state = await browserState(port, key);
    assert.strictEqual(state.presence, 'thinking');
    assert.strictEqual(state.chat.length, 2);
  })) passed++; else failed++;

  // Regression: feedback sent with nobody parked on `await` used to leave the
  // pill claiming "agent working" while the message sat undelivered forever.
  if (await test('feedback with no listener reports queued, not working', async () => {
    const queuedArtifact = path.join(tmp, 'queued.plan.md');
    fs.writeFileSync(queuedArtifact, '# Plan: Queued\n');
    const opened = jsonBody(await request(port, 'POST', '/api/sessions', { body: { file: queuedArtifact } }));
    assert.strictEqual((await browserState(port, opened.key)).presence, 'waiting');

    const post = await request(port, 'POST', `/api/session/${opened.key}/feedback`, {
      body: { items: [{ kind: 'chat', text: 'anyone there?' }] }
    });
    assert.strictEqual(jsonBody(post).presence, 'queued');
    assert.strictEqual(canvas.presenceFor(opened.key), 'queued');
    assert.strictEqual((await browserState(port, opened.key)).presence, 'queued');

    // Draining it hands the batch over and flips the indicator to thinking.
    const drained = jsonBody(await request(port, 'GET', `/api/await?key=${opened.key}&timeoutMs=0`));
    assert.strictEqual(drained.status, 'feedback');
    assert.strictEqual(canvas.presenceFor(opened.key), 'thinking');
    assert.strictEqual((await browserState(port, opened.key)).presence, 'thinking');
  })) passed++; else failed++;

  if (await test('typing endpoint drives the indicator and reply clears it', async () => {
    const typingArtifact = path.join(tmp, 'typing.plan.md');
    fs.writeFileSync(typingArtifact, '# Plan: Typing\n');
    const opened = jsonBody(await request(port, 'POST', '/api/sessions', { body: { file: typingArtifact } }));

    const typing = await request(port, 'POST', `/api/session/${opened.key}/typing`, { body: { state: 'typing' } });
    assert.strictEqual(jsonBody(typing).presence, 'typing');
    assert.strictEqual((await browserState(port, opened.key)).presence, 'typing');

    const thinking = await request(port, 'POST', `/api/session/${opened.key}/typing`, { body: { state: 'thinking' } });
    assert.strictEqual(jsonBody(thinking).presence, 'thinking');

    const bad = await request(port, 'POST', `/api/session/${opened.key}/typing`, { body: { state: 'dancing' } });
    assert.strictEqual(bad.statusCode, 400);

    // A landed reply must take the bubble down, not leave it spinning.
    await request(port, 'POST', `/api/session/${opened.key}/reply`, { body: { text: 'done' } });
    assert.strictEqual(canvas.presenceFor(opened.key), 'waiting');
    assert.strictEqual((await browserState(port, opened.key)).presence, 'waiting');
  })) passed++; else failed++;

  if (await test('thinking and typing states expire instead of sticking', async () => {
    const staleArtifact = path.join(tmp, 'stale.plan.md');
    fs.writeFileSync(staleArtifact, '# Plan: Stale\n');
    const staleStore = createSessionStore({ stateDir: path.join(tmp, 'stale-state') });
    const staleCanvas = createPlanCanvasServer({
      store: staleStore,
      version: '9.9.9-test',
      idleTimeoutMs: 0,
      thinkingStaleMs: 40,
      typingExpiryMs: 20
    });
    const bound = await staleCanvas.listen(0);
    const opened = jsonBody(await request(bound.port, 'POST', '/api/sessions', { body: { file: staleArtifact } }));

    await request(bound.port, 'POST', `/api/session/${opened.key}/typing`, { body: { state: 'typing' } });
    assert.strictEqual(staleCanvas.presenceFor(opened.key), 'typing');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.strictEqual(staleCanvas.presenceFor(opened.key), 'waiting');

    // An abandoned agent decays to queued so the human is never told a
    // stalled session is still being worked on.
    await request(bound.port, 'POST', `/api/session/${opened.key}/typing`, { body: { state: 'thinking' } });
    await request(bound.port, 'POST', `/api/session/${opened.key}/feedback`, {
      body: { items: [{ kind: 'chat', text: 'still there?' }] }
    });
    assert.strictEqual(staleCanvas.presenceFor(opened.key), 'thinking');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.strictEqual(staleCanvas.presenceFor(opened.key), 'queued');
    await staleCanvas.close();
  })) passed++; else failed++;

  if (await test('finite browser polling observes a decayed presence state', async () => {
    const sweepArtifact = path.join(tmp, 'sweep.plan.md');
    fs.writeFileSync(sweepArtifact, '# Plan: Sweep\n');
    const sweepStore = createSessionStore({ stateDir: path.join(tmp, 'sweep-state') });
    const sweepCanvas = createPlanCanvasServer({
      store: sweepStore,
      version: '9.9.9-test',
      idleTimeoutMs: 0,
      thinkingStaleMs: 50
    });
    const bound = await sweepCanvas.listen(0);
    const opened = jsonBody(await request(bound.port, 'POST', '/api/sessions', { body: { file: sweepArtifact } }));

    await request(bound.port, 'POST', `/api/session/${opened.key}/typing`, { body: { state: 'thinking' } });
    assert.strictEqual((await browserState(bound.port, opened.key)).presence, 'thinking');
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.strictEqual((await browserState(bound.port, opened.key)).presence, 'waiting');
    await sweepCanvas.close();
  })) passed++; else failed++;

  if (await test('long-poll heartbeat whitespace arrives before the payload', async () => {
    const chunks = [];
    const done = new Promise((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: `/api/await?file=${encodeURIComponent(artifact)}`, agent: false },
        res => {
          res.on('data', chunk => chunks.push(chunk.toString()));
          res.on('end', resolve);
        }
      );
      req.on('error', reject);
    });
    // Heartbeats tick every 25ms in this test server; wait for a few first.
    await waitFor(() => chunks.join('').length >= 3);
    assert.ok(/^\s+$/.test(chunks.join('')), 'expected only whitespace before payload');
    await request(port, 'POST', `/api/session/${key}/feedback`, { body: { items: [{ kind: 'chat', text: 'wake up' }] } });
    await done;
    const full = chunks.join('');
    assert.strictEqual(JSON.parse(full.trim()).status, 'feedback');
  })) passed++; else failed++;

  if (await test('agent reply lands in the finite browser state response', async () => {
    const res = await request(port, 'POST', `/api/session/${key}/reply`, { body: { text: 'reworked, please re-check' } });
    assert.strictEqual(jsonBody(res).status, 'sent');
    const state = await browserState(port, key);
    assert.ok(state.chat.some(m => m.role === 'agent' && m.text.includes('reworked')));
  })) passed++; else failed++;

  if (await test('live reload: editing the artifact changes the finite state revision', async () => {
    const before = (await browserState(port, key)).artifactVersion;
    fs.appendFileSync(artifact, '\n## Addendum\n');
    const after = (await browserState(port, key)).artifactVersion;
    assert.notStrictEqual(after, before);
  })) passed++; else failed++;

  if (await test('send-and-end delivers the final batch and ends the session', async () => {
    const awaitPromise = request(port, 'GET', `/api/await?file=${encodeURIComponent(artifact)}`);
    await waitFor(() => canvas.presenceFor(key) === 'listening');
    await request(port, 'POST', `/api/session/${key}/feedback`, {
      body: { items: [{ kind: 'chat', text: 'looks good, wrapping up' }], endSession: true }
    });
    const result = jsonBody(await awaitPromise);
    assert.strictEqual(result.status, 'feedback');
    assert.strictEqual(result.sessionEnded, true);
    assert.strictEqual(result.endedBy, 'user');
    const after = await request(port, 'GET', `/api/await?file=${encodeURIComponent(artifact)}&timeoutMs=0`);
    assert.strictEqual(jsonBody(after).status, 'ended');
  })) passed++; else failed++;

  if (await test('user-ended sessions return 409 on plain reopen, open with reopen:true', async () => {
    const refused = await request(port, 'POST', '/api/sessions', { body: { file: artifact } });
    assert.strictEqual(refused.statusCode, 409);
    assert.strictEqual(jsonBody(refused).status, 'user-ended');
    const forced = await request(port, 'POST', '/api/sessions', { body: { file: artifact, reopen: true } });
    assert.strictEqual(forced.statusCode, 200);
  })) passed++; else failed++;

  if (await test('agent end via POST /api/end allows plain reopen', async () => {
    const res = await request(port, 'POST', '/api/end', { body: { file: artifact } });
    assert.strictEqual(jsonBody(res).endedBy, 'agent');
    const reopened = await request(port, 'POST', '/api/sessions', { body: { file: artifact } });
    assert.strictEqual(reopened.statusCode, 200);
  })) passed++; else failed++;

  if (await test('feedback on an ended session is refused with 409', async () => {
    await request(port, 'POST', `/api/end`, { body: { file: htmlArtifact } });
    const res = await request(port, 'POST', `/api/session/${htmlKey}/feedback`, {
      body: { items: [{ kind: 'chat', text: 'too late' }] }
    });
    assert.strictEqual(res.statusCode, 409);
  })) passed++; else failed++;

  if (await test('GET / lists sessions in the ECC shell', async () => {
    const res = await request(port, 'GET', '/');
    assert.ok(res.body.includes('Plan Canvas sessions'));
    assert.ok(res.body.includes('demo.plan.md'));
  })) passed++; else failed++;

  if (await test('POST /shutdown triggers the shutdown callback', async () => {
    const res = await request(port, 'POST', '/shutdown');
    assert.strictEqual(jsonBody(res).status, 'stopping');
    await waitFor(() => idleFired);
  })) passed++; else failed++;

  if (await test('close() settles a held long-poll instead of hanging', async () => {
    await request(port, 'POST', '/api/sessions', { body: { file: artifact, reopen: true } });
    const held = request(port, 'GET', `/api/await?file=${encodeURIComponent(artifact)}`);
    await waitFor(() => canvas.presenceFor(store.findByFile(artifact).key) === 'listening');
    await canvas.close();
    const result = jsonBody(await held);
    assert.strictEqual(result.status, 'waiting');
    assert.ok(result.note.includes('shutting down'));
  })) passed++; else failed++;

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });

  console.log('\n' + '='.repeat(40));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('='.repeat(40));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  console.log('Passed: 0');
  console.log('Failed: 1');
  process.exit(1);
});
