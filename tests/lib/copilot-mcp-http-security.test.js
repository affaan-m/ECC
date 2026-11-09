'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const mcp = require('../../scripts/lib/copilot-mcp');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-http-security-'));
const success = { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } };
let passed = 0;
let server;
async function test(name, action) { await action(); passed++; console.log(`PASS ${name}`); }
(async () => {
  try {
    server = http.createServer((req, res) => {
      req.resume();
      if (req.url === '/utf8') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const encoded = Buffer.from(JSON.stringify(success).replace('fixture', 'X'));
        encoded[encoded.indexOf(Buffer.from('"X"')) + 1] = 0xff;
        res.end(encoded); return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (req.url === '/unterminated') { res.end(`data: ${JSON.stringify(success)}`); return; }
      if (req.url === '/live') { res.write(`data: ${JSON.stringify(success)}\n\n`); return; }
      if (req.url === '/notification') {
        res.end(`: heartbeat\n\nevent: message\ndata: {"jsonrpc":"2.0","method":"notifications/message"}\n\ndata: ${JSON.stringify(success)}\n\n`); return;
      }
      if (req.url === '/abort') { res.flushHeaders(); res.write('data: '); res.destroy(); return; }
      res.end('data: {"jsonrpc":"2.0","id":1,\ndata: "result":' + JSON.stringify(success.result) + '}\n\n');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const probe = route => mcp.probeHttp({ type: 'http', url: `http://127.0.0.1:${server.address().port}${route}` }, { timeoutMs: 1000 });
    await test('invalid UTF-8 bytes cannot establish a healthy initialize response', async () => {
      assert.equal((await probe('/utf8')).status, 'invalid-response');
    });
    await test('SSE response requires a completed frame rather than a synthesized EOF delimiter', async () => {
      assert.equal((await probe('/unterminated')).status, 'invalid-response');
    });
    await test('complete SSE response resolves even if server leaves stream open', async () => {
      assert.equal((await probe('/live')).status, 'healthy');
    });
    await test('SSE notifications and multiline data do not change initialize-only control flow', async () => {
      assert.equal((await probe('/notification')).status, 'healthy');
      assert.equal((await probe('/multiline')).status, 'healthy');
      assert.equal((await probe('/abort')).status, 'network-error');
    });
    await test('URL control and bidi characters are rejected before preview or persistence', () => {
      for (const value of ['https://example.invalid/m\u0000cp', 'https://example.invalid/m\u202ecp']) {
        assert.throws(() => mcp.preview({ configPath: path.join(root, 'unsafe.json'),
          catalog: { mcpServers: { remote: { type: 'http', url: value } } }, selected: [{ name: 'remote' }] }));
      }
    });
    await test('selected rollback preserves nonselected ECC-managed server and ownership', () => {
      const configPath = path.join(root, 'scope.json');
      const catalog = { mcpServers: {
        memory: { command: process.execPath, args: ['memory.js'] },
        other: { command: process.execPath, args: ['other.js'] },
      } };
      mcp.apply(mcp.preview({ configPath, catalog, selected: [{ name: 'memory' }, { name: 'other' }] }));
      const ownership = JSON.parse(fs.readFileSync(`${configPath}.ecc-managed.json`));
      assert.deepEqual(mcp.rollback({ configPath, aliases: ['memory'] }).removed, ['memory']);
      assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(configPath)).mcpServers), ['other']);
      assert.deepEqual(JSON.parse(fs.readFileSync(`${configPath}.ecc-managed.json`)).managed, { other: ownership.managed.other });
      const before = fs.readFileSync(configPath);
      for (const aliases of [null, ['other', 'other'], ['../other']]) assert.throws(() => mcp.rollback({ configPath, aliases }));
      assert.deepEqual(fs.readFileSync(configPath), before);
    });
    console.log(`Passed: ${passed}, Failed: 0`);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
