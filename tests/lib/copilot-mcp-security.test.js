'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mcp = require('../../scripts/lib/copilot-mcp');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-review-'));
let passed = 0;
function test(name, action) { action(); passed++; console.log(`PASS ${name}`); }
const configPath = path.join(root, 'mcp.json');
function preview(server) { return mcp.preview({ configPath, catalog: { mcpServers: { demo: server } }, selected: [{ name: 'demo' }] }); }
try {
  test('literal credential flags URLs and assignments never enter previews', () => {
    for (const args of [['--token', 'synthetic-token'], ['--api-key=synthetic-key'], ['password=sentinel'], ['https://alice:password@example.invalid/mcp'], ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz']]) {
      assert.throws(() => preview({ command: 'node', args }), /credential|secret/i);
    }
    assert.throws(() => preview({ command: 'https://alice:password@example.invalid/mcp', args: [] }), /credential|secret/i);
    assert.ok(!fs.existsSync(configPath));
    assert.equal(preview({ command: 'node', args: ['server.js'], env: { API_TOKEN: 'sentinel' } }).additions.demo.env.API_TOKEN, '${API_TOKEN}');
  });
  test('malformed server collections and ownership hashes are rejected', () => {
    for (const value of [null, false, [], 'invalid']) {
      fs.writeFileSync(configPath, JSON.stringify({ mcpServers: value }));
      assert.throws(() => mcp.doctor({ configPath }), /object/i);
    }
    fs.writeFileSync(configPath, '{"mcpServers":{}}');
    fs.writeFileSync(`${configPath}.ecc-managed.json`, JSON.stringify({ version: 1, managed: { demo: 'not-a-hash' } }));
    assert.throws(() => mcp.doctor({ configPath }), /ownership/i);
    fs.unlinkSync(`${configPath}.ecc-managed.json`);
  });
  test('symlink and hardlink config targets are never overwritten', () => {
    fs.unlinkSync(configPath);
    const sentinel = path.join(root, 'sentinel'); fs.writeFileSync(sentinel, '{"mcpServers":{}}');
    fs.linkSync(sentinel, configPath);
    assert.throws(() => preview({ command: 'node', args: [] }), /Linked/);
    fs.unlinkSync(configPath); fs.symlinkSync(sentinel, configPath);
    assert.throws(() => preview({ command: 'node', args: [] }), /Linked/);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), '{"mcpServers":{}}');
  });
  console.log(`Passed: ${passed}\nFailed: 0`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
