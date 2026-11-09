'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const mcp = require('../../scripts/lib/copilot-mcp');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-http-'));
let passed = 0;
const requests = [];
let server;
function request(configPath, entry) {
  return { configPath, catalog: { mcpServers: { remote: entry } }, selected: [{ name: 'remote' }] };
}
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
const success = { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } };
(async () => {
  try {
    await test('authless remote mapping previews only selected servers with empty tools and explicit transport', () => {
      const configPath = path.join(root, 'preview.json');
      for (const type of ['http', 'streamable-http', 'sse']) {
        const plan = mcp.preview(request(configPath, { type, url: 'https://example.invalid/mcp', description: 'operator-selected fixture' }));
        assert.deepEqual(plan.additions.remote, { type: type === 'streamable-http' ? 'http' : type,
          url: 'https://example.invalid/mcp', headers: {}, tools: [] });
        assert.equal(fs.existsSync(configPath), false);
      }
    });
    await test('remote ownership apply reapply and rollback preserve user configuration', () => {
      const configPath = path.join(root, 'owned.json');
      const original = { mcpServers: { user: { type: 'http', url: 'https://user.invalid/mcp', tools: ['query'] } }, custom: 'keep' };
      fs.writeFileSync(configPath, JSON.stringify(original));
      const selected = request(configPath, { type: 'http', url: 'https://remote.invalid/mcp' });
      mcp.apply(mcp.preview(selected));
      assert.deepEqual(mcp.preview(selected).additions, {});
      const report = mcp.doctor({ configPath });
      assert.equal(report.transports.remote, 'http');
      assert.equal(report.servers.remote, 'configured-not-probed');
      assert.deepEqual(mcp.rollback({ configPath }).removed, ['remote']);
      assert.deepEqual(JSON.parse(fs.readFileSync(configPath)), original);
    });
    await test('URL credentials opaque auth settings mixed transports and insecure destinations reject before write', () => {
      const configPath = path.join(root, 'rejected.json');
      for (const entry of [
        { type: 'http', url: 'https://alice:password@example.invalid/mcp' },
        { type: 'http', url: 'https://example.invalid/mcp?token=secret' },
        { type: 'http', url: 'https://example.invalid/mcp#secret' },
        { type: 'http', url: 'http://example.invalid/mcp' },
        { type: 'http', url: 'file:///tmp/mcp' },
        { type: 'http', url: 'https://example.invalid/\nmcp' },
        { type: 'http', url: 'https://example.invalid/${TOKEN}' },
        { type: 'http', url: 'https://example.invalid/mcp', headers: { Authorization: '${TOKEN}' } },
        { type: 'http', url: 'https://example.invalid/mcp', command: 'node', args: [] },
        { type: 'http', url: 'https://example.invalid/mcp', env: { TOKEN: '${TOKEN}' } },
      ]) assert.throws(() => mcp.preview(request(configPath, entry)));
      assert.equal(fs.existsSync(configPath), false);
    });
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        requests.push({ url: req.url, body: JSON.parse(body), method: req.method, headers: req.headers });
        if (req.url === '/timeout') return;
        if (req.url === '/auth') { res.writeHead(401); res.end('do not expose provider details'); return; }
        if (req.url === '/redirect') { res.writeHead(307, { Location: '/healthy' }); res.end(); return; }
        if (req.url === '/large') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('x'.repeat(70000)); return; }
        if (req.url === '/event') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(`: keepalive\n\nevent: message\ndata: ${JSON.stringify(success)}\n\n`); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(req.url === '/invalid' ? { ...success, result: { ...success.result, serverInfo: [] } } : success));
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = route => `http://127.0.0.1:${server.address().port}${route}`;
    await test('HTTP and streamable SSE initialize probe is bounded and performs no tools or retries', async () => {
      for (const route of ['/healthy', '/event']) {
        const result = await mcp.probeHttp({ type: 'http', url: url(route), headers: {}, tools: [] }, { timeoutMs: 3000 });
        assert.deepEqual(result, { status: 'healthy', attempts: 1, tool_calls: 0 });
      }
      assert.equal(requests.length, 2);
      for (const actual of requests) {
        assert.equal(actual.method, 'POST'); assert.equal(actual.body.method, 'initialize');
        assert.equal(actual.headers.authorization, undefined);
        assert.equal(actual.headers.cookie, undefined);
      }
    });
    await test('HTTP timeout auth malformed output quota and redirects stay distinct without retry', async () => {
      for (const [route, expected] of [['/timeout', 'timeout'], ['/auth', 'auth-required'], ['/invalid', 'invalid-response'],
        ['/large', 'output-limit'], ['/redirect', 'redirect-not-followed']]) {
        const before = requests.length;
        const result = await mcp.probeHttp({ type: 'http', url: url(route) }, { timeoutMs: route === '/timeout' ? 100 : 3000 });
        assert.equal(result.status, expected); assert.equal(result.attempts, 1); assert.equal(result.tool_calls, 0);
        assert.equal(requests.length, before + 1);
      }
    });
    await test('configured HTTP probes dispatch only on explicit request; legacy SSE remains diagnostic-only', async () => {
      const configPath = path.join(root, 'probe.json');
      mcp.apply(mcp.preview(request(configPath, { type: 'http', url: url('/healthy') })));
      const before = requests.length; const bytes = fs.readFileSync(configPath);
      assert.equal(mcp.doctor({ configPath }).transports.remote, 'http');
      assert.equal(requests.length, before); assert.deepEqual(fs.readFileSync(configPath), bytes);
      assert.equal((await mcp.probeConfigured({ configPath, alias: 'remote', timeoutMs: 3000 })).status, 'healthy');
      assert.equal((await mcp.probeHttp({ type: 'sse', url: url('/healthy') })).status, 'unsupported-transport');
      assert.equal(requests.length, before + 1);
      assert.throws(() => mcp.probeHttp({ type: 'http', url: url('/healthy') }, { timeoutMs: 0 }), /timeout/i);
    });
    console.log(`Passed: ${passed}, Failed: 0`);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
