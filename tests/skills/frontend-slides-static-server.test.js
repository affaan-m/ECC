#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'skills', 'frontend-slides', 'scripts');
const SERVER_MODULE = path.join(SCRIPTS_DIR, 'static-server.mjs');
const EXPORT_SCRIPT = path.join(SCRIPTS_DIR, 'export-pdf.sh');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

// http.request sends `path` verbatim, so traversal segments reach the server
// exactly as a raw client (curl --path-as-is) would send them.
function rawGet(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: requestPath, method: 'GET', headers },
      res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-slides-server-'));
  const deck = path.join(base, 'deck');
  fs.mkdirSync(path.join(deck, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(deck, 'index.html'), '<div class="slide">deck</div>');
  fs.writeFileSync(path.join(deck, 'assets', 'my font.css'), 'body{}');
  fs.writeFileSync(path.join(base, 'secret.txt'), 'TOP-SECRET');
  return { base, deck };
}

async function runTests() {
  console.log('\n=== Testing frontend-slides static server ===\n');

  const { startStaticServer, resolveRequestPath, LOOPBACK_HOST } = await import(pathToFileURL(SERVER_MODULE).href);
  const { base, deck } = makeFixture();
  const { server, port } = await startStaticServer({ serveDir: deck, indexFile: 'index.html' });

  let passed = 0;
  let failed = 0;
  const check = async (name, fn) => {
    if (await test(name, fn)) passed += 1;
    else failed += 1;
  };

  try {
    await check('binds to the loopback interface only', async () => {
      assert.strictEqual(LOOPBACK_HOST, '127.0.0.1');
      assert.strictEqual(server.address().address, '127.0.0.1');
    });

    await check('serves the deck index and percent-encoded asset names', async () => {
      const index = await rawGet(port, '/');
      assert.strictEqual(index.status, 200);
      assert.ok(index.body.includes('deck'));
      const asset = await rawGet(port, '/assets/my%20font.css');
      assert.strictEqual(asset.status, 200);
      assert.strictEqual(asset.body, 'body{}');
    });

    const traversalPaths = [
      '/../secret.txt',
      '/assets/../../secret.txt',
      '/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e%2fsecret.txt',
      '/..%5csecret.txt',
    ];
    for (const requestPath of traversalPaths) {
      await check(`never serves files outside the deck: ${requestPath}`, async () => {
        const res = await rawGet(port, requestPath);
        assert.notStrictEqual(res.status, 200);
        assert.ok(!res.body.includes('TOP-SECRET'), 'secret file contents leaked');
      });
    }

    await check('rejects a symlink that points outside the deck', async () => {
      const link = path.join(deck, 'escape.txt');
      try {
        fs.symlinkSync(path.join(base, 'secret.txt'), link);
      } catch {
        return; // Symlinks need extra privileges on some Windows setups.
      }
      const res = await rawGet(port, '/escape.txt');
      assert.strictEqual(res.status, 403);
      assert.ok(!res.body.includes('TOP-SECRET'));
    });

    await check('answers 400 to malformed percent-encoding and keeps serving', async () => {
      const bad = await rawGet(port, '/%E0%A4%A');
      assert.strictEqual(bad.status, 400);
      const after = await rawGet(port, '/');
      assert.strictEqual(after.status, 200);
    });

    await check('rejects foreign Host headers (DNS rebinding)', async () => {
      const res = await rawGet(port, '/', { Host: `attacker.example:${port}` });
      assert.strictEqual(res.status, 403);
      const local = await rawGet(port, '/', { Host: `localhost:${port}` });
      assert.strictEqual(local.status, 200);
    });

    await check('resolveRequestPath keeps every result inside the root', async () => {
      assert.deepStrictEqual(resolveRequestPath(deck, 'index.html', '/%E0%A4%A'), { status: 400 });
      assert.deepStrictEqual(resolveRequestPath(deck, 'index.html', '/a%00b'), { status: 400 });
      assert.deepStrictEqual(resolveRequestPath(deck, 'index.html', '/..%2f..%2fsecret.txt'), { status: 403 });
      assert.strictEqual(resolveRequestPath(deck, 'index.html', '/').filePath, path.join(deck, 'index.html'));
    });

    await check('export-pdf.sh uses the hardened server instead of an inline one', async () => {
      const script = fs.readFileSync(EXPORT_SCRIPT, 'utf8');
      assert.ok(script.includes("import { startStaticServer } from './static-server.mjs';"));
      assert.ok(script.includes('cp "$SCRIPT_DIR/static-server.mjs" "$TEMP_DIR/static-server.mjs"'));
      assert.ok(!/createServer\(/.test(script), 'export-pdf.sh still defines its own HTTP server');
      assert.ok(!/server\.listen\(0\s*,/.test(script), 'export-pdf.sh still listens on all interfaces');
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(base, { recursive: true, force: true });
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error(error);
  process.exit(1);
});
