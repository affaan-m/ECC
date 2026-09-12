#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertLoopbackUrl,
  exportPdf,
  isCompletePdf,
  pdfFileName,
  resolveChromiumExecutable
} = require('../../scripts/lib/plan-canvas/pdf');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.stack || error.message}`);
    return false;
  }
}

function fakeChild(onSpawn) {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = signal => {
    child.signalCode = signal;
    setImmediate(() => {
      child.exitCode = 0;
      child.emit('close', 0, signal);
    });
    return true;
  };
  onSpawn(child);
  return child;
}

async function main() {
  console.log('\n=== Testing Plan Canvas PDF export ===\n');
  let results = [];
  const record = async (name, fn) => {
    results = [...results, await test(name, fn)];
  };

  await record('builds safe, useful PDF filenames', () => {
    assert.strictEqual(pdfFileName('/tmp/feature-fleet-2.2.plan.md'), 'feature-fleet-2.2.pdf');
    assert.strictEqual(pdfFileName('/tmp/release-preview.html'), 'release-preview.pdf');
    assert.strictEqual(pdfFileName('/tmp/bad:name?.md'), 'bad-name-.pdf');
    assert.strictEqual(pdfFileName(''), 'plan.pdf');
  });

  await record('restricts the renderer to loopback artifact URLs', () => {
    assert.strictEqual(
      assertLoopbackUrl('http://127.0.0.1:4518/artifact/abc/?pdf=1'),
      'http://127.0.0.1:4518/artifact/abc/?pdf=1'
    );
    assert.throws(() => assertLoopbackUrl('https://127.0.0.1/artifact/abc'), { code: 'PDF_EXPORT_INVALID_URL' });
    assert.throws(() => assertLoopbackUrl('http://example.com/artifact/abc'), { code: 'PDF_EXPORT_INVALID_URL' });
  });

  await record('honors an explicit Chromium executable override', () => {
    const fsImpl = {
      accessSync(file) { assert.strictEqual(file, '/opt/test/chrome'); },
      statSync() { return { isFile: () => true }; }
    };
    assert.strictEqual(
      resolveChromiumExecutable({
        env: { ECC_PLAN_CANVAS_CHROME_PATH: '/opt/test/chrome', PATH: '' },
        platform: 'linux',
        fsImpl
      }),
      '/opt/test/chrome'
    );
  });

  await record('fails actionably when no local PDF renderer is installed', async () => {
    await assert.rejects(
      exportPdf({
        url: 'http://127.0.0.1:4517/artifact/abc123/?pdf=1',
        artifactFile: '/workspace/launch.plan.md',
        env: { PATH: '' },
        platform: 'linux'
      }),
      error => error.code === 'PDF_BROWSER_NOT_FOUND' && error.message.includes('ECC_PLAN_CANVAS_CHROME_PATH')
    );
  });

  await record('recognizes only complete PDF output', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-pdf-complete-'));
    const file = path.join(tmp, 'artifact.pdf');
    fs.writeFileSync(file, '%PDF-1.4\npartial');
    assert.strictEqual(isCompletePdf(file), false);
    fs.appendFileSync(file, '\n%%EOF\n');
    assert.strictEqual(isCompletePdf(file), true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await record('validates PDF metadata from the opened file handle', () => {
    const content = Buffer.from('%PDF-1.4\nlocal plan\n%%EOF\n');
    const fsImpl = {
      openSync(file, flags) {
        assert.strictEqual(file, '/private/export.pdf');
        assert.strictEqual(flags, 'r');
        return 41;
      },
      fstatSync(fd) {
        assert.strictEqual(fd, 41);
        return { isFile: () => true, size: content.length };
      },
      readSync(fd, target, offset, length, position) {
        assert.strictEqual(fd, 41);
        return content.copy(target, offset, position, position + length);
      },
      closeSync(fd) { assert.strictEqual(fd, 41); },
      statSync() { throw new Error('path metadata must not be checked before opening'); }
    };
    assert.strictEqual(isCompletePdf('/private/export.pdf', fsImpl), true);
  });

  await record('renders, isolates network access, terminates its browser, and removes temporary state', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-pdf-test-'));
    let spawned = null;
    let child = null;
    const spawnImpl = (command, args, options) => {
      spawned = { command, args, options };
      const outputFile = args.find(arg => arg.startsWith('--print-to-pdf=')).slice('--print-to-pdf='.length);
      child = fakeChild(() => {
        setTimeout(() => fs.writeFileSync(outputFile, '%PDF-1.4\nlocal plan\n%%EOF\n'), 20);
      });
      return child;
    };

    const result = await exportPdf({
      url: 'http://localhost:4517/artifact/abc123/?pdf=1',
      artifactFile: '/workspace/launch.plan.md',
      executable: '/opt/test/chrome',
      timeoutMs: 1000,
      spawnImpl,
      osImpl: { tmpdir: () => tempRoot }
    });

    assert.strictEqual(result.filename, 'launch.pdf');
    assert.ok(result.buffer.subarray(0, 5).equals(Buffer.from('%PDF-')));
    assert.strictEqual(spawned.command, '/opt/test/chrome');
    assert.strictEqual(spawned.options.shell, false);
    assert.ok(spawned.args.includes('--headless=new'));
    assert.ok(spawned.args.includes('--disable-background-networking'));
    assert.ok(spawned.args.includes('--disable-quic'));
    assert.ok(spawned.args.some(arg => /^--proxy-server=http:\/\/127\.0\.0\.1:\d+$/.test(arg)));
    assert.ok(spawned.args.includes('--proxy-bypass-list=<-loopback>;http://localhost:4517'));
    assert.ok(spawned.args.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'));
    assert.ok(spawned.args.includes('http://localhost:4517/artifact/abc123/?pdf=1'));
    assert.strictEqual(child.signalCode, 'SIGTERM');
    assert.deepStrictEqual(fs.readdirSync(tempRoot), []);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log('\n========================================');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('========================================');
  process.exit(failed ? 1 : 0);
}

main();
