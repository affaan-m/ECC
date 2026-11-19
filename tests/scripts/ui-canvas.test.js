/**
 * Integration tests for UI Canvas sessions on the shared canvas server
 * (scripts/lib/plan-canvas/server.js in `ui` mode, scripts/lib/ui-canvas/).
 *
 * Spins up the real HTTP server in-process and drives it the way the shell
 * (fetch + SSE) and the agent CLI (long poll) do.
 *
 * Run with: node tests/scripts/ui-canvas.test.js
 */

const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const os = require('os');
const path = require('path');

const { createSessionStore, sanitizeUiOptions } = require('../../scripts/lib/plan-canvas/sessions');
const { createPlanCanvasServer } = require('../../scripts/lib/plan-canvas/server');
const pendingHook = require('../../scripts/hooks/plan-canvas-pending');
const sessionsHook = require('../../scripts/hooks/plan-canvas-sessions');

const results = [];
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
    results.push(true);
  } catch (error) {
    console.log(`  FAIL ${name}\n    ${error.stack || error.message}`);
    results.push(false);
  }
}

function request(port, method, requestPath, body = null, { raw = false, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: requestPath,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers }
          : headers
      },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let parsed = data;
          if (!raw) {
            try { parsed = JSON.parse(data.trim() || '{}'); } catch { parsed = data; }
          }
          resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Open an SSE stream and resolve with the first `presence` frame.
function firstPresence(port, key) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: `/events/${key}` }, res => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk;
        const match = buffer.match(/event: presence\ndata: (.*)\n/);
        if (match) {
          req.destroy();
          resolve(JSON.parse(match[1]));
        }
      });
    });
    req.on('error', error => (error.code === 'ECONNRESET' ? null : reject(error)));
    setTimeout(() => { req.destroy(); reject(new Error('no presence frame')); }, 3000).unref();
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log('ui-canvas server');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-canvas-test-'));
  const artifact = path.join(tmp, 'card.html');
  fs.writeFileSync(artifact, '<!DOCTYPE html><html><head><title>Card</title></head><body><article id="card"><h1>Hi</h1><button class="x">Go</button></article></body></html>');
  const store = createSessionStore({ stateDir: path.join(tmp, 'state') });
  const canvas = createPlanCanvasServer({ store, version: '9.9.9-test' });
  const { port } = await canvas.listen(0);
  let key = null;

  try {
    await test('POST /api/sessions opens a ui session with viewport options', async () => {
      const res = await request(port, 'POST', '/api/sessions', { file: artifact, mode: 'ui', ui: { viewport: '1024x768', title: 'Card' } });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.mode, 'ui');
      key = res.body.key;
      const session = store.get(key);
      assert.deepStrictEqual(session.ui, { viewport: '1024x768', title: 'Card' });
    });

    await test('ui sessions refuse non-HTML artifacts', async () => {
      const plan = path.join(tmp, 'plan.md');
      fs.writeFileSync(plan, '# plan');
      const res = await request(port, 'POST', '/api/sessions', { file: plan, mode: 'ui' });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.error, /\.html/);
    });

    await test('GET /canvas/:key renders the UI Canvas shell for ui sessions', async () => {
      const res = await request(port, 'GET', `/canvas/${key}`, null, { raw: true });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.includes('UI Canvas'));
      assert.ok(res.body.includes('/ui-client.js'));
      assert.ok(!res.body.includes('Approve plan'));
    });

    await test('GET /artifact/:key/ injects the editor instead of the annotation sdk and keeps the sandbox CSP', async () => {
      const res = await request(port, 'GET', `/artifact/${key}/`, null, { raw: true });
      assert.strictEqual(res.statusCode, 200);
      const revision = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
      assert.ok(res.body.includes(`<script src="/ui-editor.js" data-ecc-ui-canvas="editor" data-source-sha256="${revision}"></script>`));
      assert.ok(!res.body.includes('/sdk.js'));
      assert.strictEqual(res.headers['content-security-policy'], 'sandbox allow-scripts allow-forms allow-popups');
    });

    await test('shell assets are served inline with no-store caching', async () => {
      for (const [assetPath, type, marker] of [
        ['/ui-editor.js', 'text/javascript', '__eccUiCanvasEditor'],
        ['/ui-client.js', 'text/javascript', 'uc:restore'],
        ['/ui-canvas.css', 'text/css', '.device.mobile']
      ]) {
        const res = await request(port, 'GET', assetPath, null, { raw: true });
        assert.strictEqual(res.statusCode, 200, assetPath);
        assert.ok(res.headers['content-type'].startsWith(type), assetPath);
        assert.strictEqual(res.headers['cache-control'], 'no-store');
        assert.ok(res.body.includes(marker), `${assetPath} lacks ${marker}`);
      }
    });

    await test('await records the agent descriptor and presence names it', async () => {
      const agent = encodeURIComponent(JSON.stringify({ name: 'Claude Code', project: 'shop', junk: true }));
      const parked = request(port, 'GET', `/api/await?key=${key}&agent=${agent}`);
      await sleep(50);
      const presence = await firstPresence(port, key);
      assert.strictEqual(presence.state, 'listening');
      assert.deepStrictEqual({ name: presence.agent.name, project: presence.agent.project }, { name: 'Claude Code', project: 'shop' });
      assert.ok(presence.agent.seenAt);
      const listed = await request(port, 'GET', '/api/sessions');
      assert.strictEqual(listed.body.sessions[0].mode, 'ui');
      assert.strictEqual(listed.body.sessions[0].agent.name, 'Claude Code');

      // A chat item with an anchor and pending-edit summaries reaches the parked await.
      const fb = await request(port, 'POST', `/api/session/${key}/feedback`, {
        items: [{ kind: 'chat', text: 'make it gray', anchor: { selector: '#card', tag: 'article', snippet: 'Hi Go' }, pendingEdits: ['resized h1'] }]
      });
      assert.strictEqual(fb.statusCode, 200);
      const delivered = await parked;
      assert.strictEqual(delivered.body.status, 'feedback');
      assert.strictEqual(delivered.body.items[0].anchor.selector, '#card');
      assert.deepStrictEqual(delivered.body.items[0].pendingEdits, ['resized h1']);
      assert.strictEqual(store.get(key).chat.at(-1).text, '[Hi Go] make it gray');
    });

    await test('a plain agent name in the await query still names the agent', async () => {
      const parked = request(port, 'GET', `/api/await?key=${key}&agent=Codex&timeoutMs=50`);
      await parked;
      assert.strictEqual(store.get(key).agent.name, 'Codex');
    });

    await test('edits batches write the export beside the artifact and strip html from the queue', async () => {
      const parked = request(port, 'GET', `/api/await?key=${key}`);
      await sleep(30);
      const html = '<!DOCTYPE html>\n<html><body><article id="card" style="border:none"><h1 style="width:300px">Hi</h1></article></body></html>\n';
      const fb = await request(port, 'POST', `/api/session/${key}/feedback`, {
        items: [{
          kind: 'edits',
          html,
          viewport: { preset: 'mobile', width: 393, height: 852 },
          edits: [
            { kind: 'resize', selector: 'h1', tag: 'h1', width: 300, before: { width: 200, height: 40 } },
            { kind: 'remove', selector: 'button.x', tag: 'button', outerHTML: '<button class="x">Go</button>', from: { parent: '#card', index: 1 } },
            { kind: 'nonsense', selector: 'z' }
          ]
        }]
      });
      assert.strictEqual(fb.statusCode, 200);
      const delivered = await parked;
      const item = delivered.body.items[0];
      assert.strictEqual(item.kind, 'edits');
      assert.strictEqual(item.editCount, 2);
      assert.ok(!('html' in item), 'html must not travel with the item');
      // The session file is canonicalized (realpath), so the export sits beside the real path.
      // Each Apply batch gets its own snapshot pair; only Finish owns card.edited.html.
      const real = fs.realpathSync(tmp);
      assert.match(path.basename(item.exportPath), /^card\.apply-[a-z0-9]+-[0-9a-f]{4}\.edited\.html$/);
      assert.strictEqual(path.dirname(item.exportPath), real);
      assert.strictEqual(item.editsPath, item.exportPath.replace(/\.edited\.html$/, '.edits.json'));
      assert.strictEqual(fs.readFileSync(item.exportPath, 'utf8'), html);
      const log = JSON.parse(fs.readFileSync(item.editsPath, 'utf8'));
      assert.strictEqual(log.kind, 'edits');
      assert.strictEqual(log.edits.length, 2);
      assert.deepStrictEqual(log.viewport, { preset: 'mobile', width: 393, height: 852 });
      assert.ok(!JSON.stringify(JSON.parse(fs.readFileSync(store.stateFile, 'utf8'))).includes('<article'), 'sessions.json never stores markup');
      assert.strictEqual(store.get(key).chat.at(-1).text, 'Applied 2 edits to the preview');
    });

    await test('a second queued Apply never rewrites the first batch snapshot', async () => {
      const first = await request(port, 'POST', `/api/session/${key}/feedback`, { items: [{ kind: 'edits', html: '<html><body>A</body></html>', edits: [] }] });
      const second = await request(port, 'POST', `/api/session/${key}/feedback`, { items: [{ kind: 'edits', html: '<html><body>B</body></html>', edits: [] }] });
      assert.strictEqual(first.statusCode, 200);
      assert.strictEqual(second.statusCode, 200);
      const drained = await request(port, 'GET', `/api/await?key=${key}&timeoutMs=10`);
      const [a, b] = drained.body.items;
      assert.notStrictEqual(a.exportPath, b.exportPath);
      assert.strictEqual(fs.readFileSync(a.exportPath, 'utf8'), '<html><body>A</body></html>');
      assert.strictEqual(fs.readFileSync(b.exportPath, 'utf8'), '<html><body>B</body></html>');
    });

    await test('edits batches without a snapshot or with an oversized one are refused', async () => {
      const missing = await request(port, 'POST', `/api/session/${key}/feedback`, { items: [{ kind: 'edits', edits: [] }] });
      assert.strictEqual(missing.statusCode, 400);
      const huge = await request(port, 'POST', `/api/session/${key}/feedback`, { items: [{ kind: 'edits', edits: [], html: 'x'.repeat(6 * 1024 * 1024 + 10) }] });
      assert.strictEqual(huge.statusCode, 413);
      assert.strictEqual(store.get(key).pendingFeedback.length, 0, 'nothing queued on refusal');
    });

    await test('finish ends the session for the user and is delivered with export paths', async () => {
      const parked = request(port, 'GET', `/api/await?key=${key}`);
      await sleep(30);
      const fb = await request(port, 'POST', `/api/session/${key}/feedback`, {
        items: [{ kind: 'finish', text: 'ship it', html: '<!DOCTYPE html>\n<html><body>done</body></html>\n', edits: [{ kind: 'nudge', selector: 'h1', dx: 2, dy: 0 }], viewport: { preset: 'desktop', width: 1412, height: 806 } }],
        endSession: true
      });
      assert.strictEqual(fb.statusCode, 200);
      const delivered = await parked;
      assert.strictEqual(delivered.body.status, 'feedback');
      assert.strictEqual(delivered.body.sessionEnded, true);
      assert.strictEqual(delivered.body.endedBy, 'user');
      const item = delivered.body.items[0];
      assert.strictEqual(item.kind, 'finish');
      assert.strictEqual(item.text, 'ship it');
      assert.strictEqual(fs.readFileSync(item.exportPath, 'utf8').trim(), '<!DOCTYPE html>\n<html><body>done</body></html>');
      assert.strictEqual(store.get(key).status, 'ended');
      assert.strictEqual(store.get(key).chat.at(-1).text, 'Saved and finished with 1 edit: ship it');
      assert.strictEqual(path.basename(item.exportPath), 'card.edited.html');
      const again = await request(port, 'GET', `/api/await?key=${key}&timeoutMs=10`);
      assert.deepStrictEqual(again.body, { status: 'ended', endedBy: 'user' });
      // A stale tab applying after Finish is refused before anything is written.
      const stale = await request(port, 'POST', `/api/session/${key}/feedback`, { items: [{ kind: 'finish', html: '<html><body>stale</body></html>', edits: [] }] });
      assert.strictEqual(stale.statusCode, 409);
      assert.strictEqual(fs.readFileSync(item.exportPath, 'utf8').trim(), '<!DOCTYPE html>\n<html><body>done</body></html>');
    });

    await test('plan sessions still render Plan Canvas and reject ui-only kinds', async () => {
      const plan = path.join(tmp, 'notes.html');
      fs.writeFileSync(plan, '<html><body><p>plan</p></body></html>');
      const open = await request(port, 'POST', '/api/sessions', { file: plan });
      assert.strictEqual(open.body.mode, 'plan');
      const shell = await request(port, 'GET', `/canvas/${open.body.key}`, null, { raw: true });
      assert.ok(shell.body.includes('Approve plan'));
      const art = await request(port, 'GET', `/artifact/${open.body.key}/`, null, { raw: true });
      assert.ok(art.body.includes('/sdk.js') && !art.body.includes('/ui-editor.js'));
      const fb = await request(port, 'POST', `/api/session/${open.body.key}/feedback`, { items: [{ kind: 'finish', html: '<html></html>', edits: [] }] });
      assert.strictEqual(fb.body.accepted, 0, 'finish is not a plan-canvas kind');
      const list = await request(port, 'GET', '/', null, { raw: true });
      assert.ok(list.body.includes('ui canvas'), 'session list tags ui sessions');
    });

    await test('sanitizeUiOptions keeps known presets and WxH, defaults otherwise', () => {
      assert.deepStrictEqual(sanitizeUiOptions({ viewport: 'mobile', title: '  Card  ' }), { viewport: 'mobile', title: 'Card' });
      assert.deepStrictEqual(sanitizeUiOptions({ viewport: '800x600' }), { viewport: '800x600', title: '' });
      assert.deepStrictEqual(sanitizeUiOptions({ viewport: 'javascript:alert(1)' }, { viewport: 'custom', title: 'old' }), { viewport: 'custom', title: 'old' });
      assert.deepStrictEqual(sanitizeUiOptions(null), { viewport: 'desktop', title: '' });
    });

    await test('Stop hook describes ui batches and points at the ui-canvas bin', () => {
      assert.strictEqual(
        pendingHook.describeItem({ kind: 'finish', editCount: 2, exportPath: '/p/card.edited.html', editsPath: '/p/card.edits.json' }),
        'SAVED AND FINISHED (2 edits) - final markup: /p/card.edited.html, edit log: /p/card.edits.json'
      );
      assert.strictEqual(pendingHook.describeItem({ kind: 'edits', edits: [{}], text: 'note' }), 'APPLIED EDITS TO THE PREVIEW (1 edit): note');
      assert.strictEqual(pendingHook.describeItem({ kind: 'chat', text: 'gray', anchor: { snippet: 'Card' } }), 'on "Card": gray');
      const reason = pendingHook.buildReason([{ key: 'aaaaaaaaaaaa', file: '/p/card.html', mode: 'ui', messages: ['x'], sessionEnded: false }]);
      assert.match(reason, /^UI Canvas:/);
      assert.match(reason, /ecc-ui-canvas await --session-key aaaaaaaaaaaa --reply/);
      const finished = pendingHook.buildReason([{ file: '/p/card.html', mode: 'ui', messages: ['x'], sessionEnded: true }]);
      assert.match(finished, /reproduce that exact design/);
      const mixed = pendingHook.buildReason([{ key: 'bbbbbbbbbbbb', file: '/p/a.md', mode: 'plan', messages: ['x'], sessionEnded: false }, { key: 'aaaaaaaaaaaa', file: '/p/card.html', mode: 'ui', messages: ['y'], sessionEnded: false }]);
      assert.match(mixed, /^Plan Canvas:/);
      assert.match(mixed, /ecc-plan-canvas await --session-key bbbbbbbbbbbb/);
    });

    await test('SessionStart hook tags ui sessions and names the ui-canvas resume command', () => {
      const context = sessionsHook.buildContext([
        { file: '/p/plan.md', pendingFeedback: [] },
        { file: '/p/card.html', mode: 'ui', pendingFeedback: [{}, {}] }
      ]);
      assert.match(context, /\/p\/card\.html \[ui canvas\] \(2 undelivered feedback items\)/);
      assert.match(context, /node scripts\/ui-canvas\.js await <file>/);
      const planOnly = sessionsHook.buildContext([{ file: '/p/plan.md', pendingFeedback: [] }]);
      assert.ok(!planOnly.includes('ui-canvas'));
    });
  } finally {
    await canvas.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  console.log('Passed: 0');
  console.log('Failed: 1');
  process.exit(1);
});
