/**
 * Integration tests for the Plan Canvas server (scripts/lib/plan-canvas/).
 *
 * Spins up the real HTTP server in-process and drives it exactly like the
 * browser chrome (fetch + SSE) and the agent CLI (long-poll) do.
 *
 * Run with: node tests/scripts/plan-canvas.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { createSessionStore } = require('../../scripts/lib/plan-canvas/sessions');
const { createPlanCanvasServer } = require('../../scripts/lib/plan-canvas/server');

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

// Open an SSE stream and collect parsed events into `received`.
function openSse(port, key) {
  const received = [];
  let close = () => {};
  const ready = new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: `/events/${key}`, agent: false },
      res => {
        let buffer = '';
        res.on('data', chunk => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const eventMatch = frame.match(/^event: (.+)$/m);
            const dataMatch = frame.match(/^data: (.+)$/m);
            if (eventMatch && dataMatch) {
              received.push({ event: eventMatch[1], data: JSON.parse(dataMatch[1]) });
            }
          }
        });
        resolve();
      }
    );
    req.on('error', reject);
    close = () => req.destroy();
  });
  return { received, ready, close: () => close() };
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
  fs.writeFileSync(htmlArtifact, '<!DOCTYPE html><html><body><h1>Report</h1></body></html>');
  fs.writeFileSync(path.join(tmp, 'style.css'), 'body { color: red }');
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-outside-'));
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret');

  const store = createSessionStore({ stateDir: path.join(tmp, 'state') });
  let idleFired = false;
  const canvas = createPlanCanvasServer({
    store,
    version: '9.9.9-test',
    heartbeatMs: 25,
    idleTimeoutMs: 0,
    onIdleShutdown: () => {
      idleFired = true;
    }
  });
  const { port } = await canvas.listen(0);

  let key = null;
  let htmlKey = null;

  if (await test('GET /health identifies the app and version', async () => {
    const res = await request(port, 'GET', '/health');
    assert.deepStrictEqual(jsonBody(res), { ok: true, app: 'ecc-plan-canvas', version: '9.9.9-test' });
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
    await request(port, 'POST', '/api/end', { body: { file: diagram } });
  })) passed++; else failed++;

  if (await test('HTML artifacts pass through with the SDK injected before </body>', async () => {
    const open = await request(port, 'POST', '/api/sessions', { body: { file: htmlArtifact } });
    htmlKey = jsonBody(open).key;
    const res = await request(port, 'GET', `/artifact/${htmlKey}/`);
    assert.ok(res.body.includes('<h1>Report</h1>'));
    assert.ok(res.body.includes('<script src="/sdk.js"></script>\n</body>'));
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
    const sse = openSse(port, key);
    await sse.ready;
    const awaitPromise = request(port, 'GET', `/api/await?file=${encodeURIComponent(artifact)}`);
    await waitFor(() => sse.received.some(e => e.event === 'presence' && e.data.state === 'listening'));

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

    await waitFor(() => sse.received.some(e => e.event === 'presence' && e.data.state === 'working'));
    await waitFor(() => sse.received.some(e => e.event === 'chat-sync' && e.data.chat.length === 2));
    sse.close();
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

  if (await test('agent reply lands in the chat via SSE chat-sync', async () => {
    const sse = openSse(port, key);
    await sse.ready;
    const res = await request(port, 'POST', `/api/session/${key}/reply`, { body: { text: 'reworked, please re-check' } });
    assert.strictEqual(jsonBody(res).status, 'sent');
    await waitFor(() =>
      sse.received.some(
        e => e.event === 'chat-sync' && e.data.chat.some(m => m.role === 'agent' && m.text.includes('reworked'))
      )
    );
    sse.close();
  })) passed++; else failed++;

  if (await test('live reload: editing the artifact emits an SSE reload event', async () => {
    const sse = openSse(port, key);
    await sse.ready;
    fs.appendFileSync(artifact, '\n## Addendum\n');
    await waitFor(() => sse.received.some(e => e.event === 'reload'), { timeoutMs: 4000 });
    sse.close();
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
