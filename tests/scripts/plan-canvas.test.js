/**
 * Integration tests for the Plan Canvas server (scripts/lib/plan-canvas/).
 *
 * Spins up the real HTTP server in-process and drives it exactly like the
 * browser chrome (fetch + SSE) and the agent CLI (long-poll) do.
 *
 * Run with: node tests/scripts/plan-canvas.test.js
 * Offline artifact checks: add --artifact-security-only (no listener).
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { compileFunction } = require('node:vm');
const { createRequire } = require('node:module');

const { createSessionStore } = require('../../scripts/lib/plan-canvas/sessions');
const { createPlanCanvasServer } = require('../../scripts/lib/plan-canvas/server');

class SkippedTest extends Error {}

function failureText(error) {
  try { return error?.stack || error?.message || String(error); }
  catch { return 'Unprintable thrown value'; }
}

function createTestRunner(log = console.log) {
  let results = { passed: 0, failed: 0, skipped: 0 };
  return {
    get results() { return results; },
    async test(name, fn) {
      try {
        await fn();
        results = { ...results, passed: results.passed + 1 };
        log(`  PASS ${name}`);
      } catch (error) {
        if (error instanceof SkippedTest) {
          results = { ...results, skipped: results.skipped + 1 };
          log(`  SKIP ${name}: ${error.message}`);
        } else {
          results = { ...results, failed: results.failed + 1 };
          log(`  FAIL ${name}\n    Error: ${failureText(error)}`);
        }
      }
    }
  };
}

function createTestSymlink(target, link, type = 'file', { symlink = fs.symlinkSync, platform = process.platform } = {}) {
  try {
    symlink(target, link, type);
  } catch (error) {
    if (error.code === 'ENOSYS' || error.code === 'ENOTSUP'
      || (platform === 'win32' && error.code === 'EPERM')) {
      throw new SkippedTest(`symlink creation unavailable (${platform}, ${error.code})`);
    }
    throw error;
  }
}

function printResults(results) {
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Skipped: ${results.skipped}`);
  process.exitCode = results.failed > 0 ? 1 : 0;
}

// A failed or stalled close may leave handles alive. Bound the whole async
// run, then drain both output queues before exiting so the summary survives.
// A blocked event loop or broken output sink still needs an outer watchdog.
async function runTestProcess(run, suite, { timeoutMs = 60_000, flushTimeoutMs = 2_000 } = {}) {
  process.exitCode = 1;
  let deadline;
  const timeout = new Promise(resolve => {
    deadline = setTimeout(() => resolve({
      failed: true,
      error: new Error(`Plan Canvas test deadline exceeded (${timeoutMs}ms); setup, test, or cleanup did not settle`),
    }), timeoutMs);
  });
  const execution = Promise.resolve().then(run).then(
    () => ({ failed: false }),
    error => ({ failed: true, error })
  );
  const outcome = await Promise.race([execution, timeout]);
  clearTimeout(deadline);
  const results = {
    ...suite.results,
    failed: suite.results.failed + (outcome.failed ? 1 : 0),
  };
  let status = results.failed > 0 ? 1 : 0;
  try {
    if (outcome.failed) console.error(failureText(outcome.error));
    console.log('\n' + '='.repeat(40));
    printResults(results);
    console.log('='.repeat(40));
  } catch {
    status = 1;
  }
  // Capture the result before a late task can affect process.exitCode. The
  // deadline loser is observed by execution's rejection handler above.
  process.exitCode = status;
  let flushDeadline;
  const flushed = await Promise.race([
    Promise.all([process.stdout, process.stderr].map(stream => new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        stream.removeListener('error', onError);
        stream.removeListener('close', onClose);
        if (error) reject(error);
        else resolve();
      };
      const onError = error => finish(error || new Error('Test output stream failed'));
      const onClose = () => finish(new Error('Test output stream closed before flush'));
      if (stream.destroyed || stream.writableEnded) {
        onClose();
        return;
      }
      stream.once('error', onError);
      stream.once('close', onClose);
      try { stream.write('', error => error ? onError(error) : finish()); }
      catch (error) { onError(error); }
    }))).then(() => true, () => false),
    new Promise(resolve => { flushDeadline = setTimeout(() => resolve(false), flushTimeoutMs); }),
  ]);
  clearTimeout(flushDeadline);
  process.exit(flushed ? status : 1);
}

// Compile the exact trusted module privately; this is not a security sandbox.
// Relative dependencies retain normal resolution, without rewriting source or
// changing module loaders, shared exports, or require.cache.
const artifactServerFilename = require.resolve('../../scripts/lib/plan-canvas/server');
const artifactServerSource = fs.readFileSync(artifactServerFilename, 'utf8');
const artifactRequire = createRequire(artifactServerFilename);

function loadArtifactServer(filesystem, localHttp) {
  const localRequire = name => {
    if (name === 'fs' || name === 'node:fs') return filesystem;
    if (name === 'http' || name === 'node:http') return localHttp;
    return artifactRequire(name);
  };
  const localModule = { exports: {} };
  const evaluate = compileFunction(artifactServerSource,
    ['require', 'module', 'exports', '__filename', '__dirname'], { filename: artifactServerFilename });
  evaluate.call(localModule.exports, localRequire, localModule, localModule.exports,
    artifactServerFilename, path.dirname(artifactServerFilename));
  return localModule.exports;
}

// Preserve arbitrary primary thrown values, including falsy values. Secondary
// cleanup diagnostics are intentionally discarded when a primary exists.
async function withFixtureCleanup(callback, cleanups) {
  let didThrow = false;
  let primary;
  let result;
  try { result = await callback(); } catch (error) { didThrow = true; primary = error; }
  let cleanupThrew = false;
  let firstCleanup;
  for (const cleanup of cleanups()) {
    try { await cleanup(); } catch (error) {
      if (!cleanupThrew) { cleanupThrew = true; firstCleanup = error; }
    }
  }
  if (didThrow) throw primary;
  if (cleanupThrew) throw firstCleanup;
  return result;
}

// Explicit close and finally cleanup await the same attempt, including failure.
function onceCleanup(cleanup) {
  let pending;
  return () => {
    if (!pending) pending = Promise.resolve().then(cleanup);
    return pending;
  };
}

async function withResourceScope(callback) {
  const clients = [];
  const servers = [];
  const roots = [];
  const own = (group, cleanup) => {
    const close = onceCleanup(cleanup);
    group.push(close);
    return close;
  };
  const resources = {
    client: cleanup => own(clients, cleanup),
    server: cleanup => own(servers, cleanup),
    root: cleanup => own(roots, cleanup),
  };
  return withFixtureCleanup(() => callback(resources), () => [...clients, ...servers, ...roots]);
}

// Requests are owned before setup writes or awaits. Destroy the response and
// request independently so one cleanup failure cannot leave the other open.
function ownHttpClient(req, getResponse, resources) {
  const cleanup = () => withFixtureCleanup(() => {}, () => {
    const response = getResponse();
    return [...(response ? [() => response.destroy()] : []), () => req.destroy()];
  });
  return resources ? resources.client(cleanup) : onceCleanup(cleanup);
}

// Capture fresh real dispatchers without binding sockets. Each request captures
// its own filesystem facade; the fixture owns those canvases until teardown.
// Artifact bodies are inert response bytes, never executed in a browser.
async function withArtifactHandler(callback, {
  closeCanvas = canvas => canvas.close(),
  removeRoot = root => fs.rmSync(root, { recursive: true, force: true })
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-artifact-'));
  const canvases = [];
  return withFixtureCleanup(async () => {
    const base = path.join(root, 'artifacts');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(base);
    fs.mkdirSync(outside);
    const session = { key: '0123456789ab', file: path.join(base, 'main.md') };
    fs.writeFileSync(session.file, '# Inert fixture\n');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'private-fixture-secret');
    const get = (asset, filesystem = fs) => new Promise(resolve => {
      let handler;
      const localHttp = Object.freeze({ ...http, createServer(requestHandler) {
        handler = requestHandler;
        return {
          listen() { throw new Error('Artifact tests must not open a listener'); },
          close(done) { done(); }
        };
      } });
      const localServer = loadArtifactServer(filesystem, localHttp);
      const canvas = localServer.createPlanCanvasServer({
        store: { get: key => key === session.key ? session : null }, idleTimeoutMs: 0
      });
      canvases.push(canvas);
      const response = { headersSent: false };
      response.writeHead = (statusCode, headers) => {
        response.statusCode = statusCode;
        response.headers = headers;
        response.headersSent = true;
      };
      response.end = data => resolve({ statusCode: response.statusCode, headers: response.headers, body: String(data || '') });
      handler({ method: 'GET', headers: { host: '127.0.0.1' }, url: `/artifact/${session.key}/${asset}` }, response);
    });
    return callback({ base, outside, session, get });
  }, () => [...canvases.map(canvas => () => closeCanvas(canvas)), () => removeRoot(root)]);
}

async function artifactSecurityTests(test) {
  const sandbox = 'sandbox allow-scripts allow-forms allow-popups';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>window.inertFixture = true;</script></svg>';
  await test('SVG sibling documents keep their MIME and use the artifact sandbox', () => withArtifactHandler(async ({ base, get }) => {
    fs.writeFileSync(path.join(base, 'shape.svg'), svg);
    const response = await get('shape.svg');
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.headers['content-type'], 'image/svg+xml');
    assert.strictEqual(response.headers['content-security-policy'], sandbox);
    assert.strictEqual(response.body, svg);
  }));
  await test('SVG symlink request and target MIME fallback both receive sandbox CSP', () => withArtifactHandler(async ({ base, get }) => {
    fs.writeFileSync(path.join(base, 'extensionless'), svg);
    fs.writeFileSync(path.join(base, 'shape.svg'), svg);
    createTestSymlink(path.join(base, 'extensionless'), path.join(base, 'by-name.svg'));
    createTestSymlink(path.join(base, 'shape.svg'), path.join(base, 'by-target'));
    for (const alias of ['by-name.svg', 'by-target']) {
      const response = await get(alias);
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['content-type'], 'image/svg+xml');
      assert.strictEqual(response.headers['content-security-policy'], sandbox);
      assert.strictEqual(response.body, svg);
    }
  }));
  await test('HTML and Markdown artifact policies and ordinary CSS MIME are preserved', () => withArtifactHandler(async ({ base, session, get }) => {
    fs.writeFileSync(path.join(base, 'note.html'), '<html><body>inert HTML</body></html>');
    fs.writeFileSync(path.join(base, 'style.css'), 'body { color: red }');
    for (const asset of ['', 'note.html']) {
      const response = await get(asset);
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['content-type'], 'text/html; charset=utf-8');
      assert.strictEqual(response.headers['content-security-policy'], sandbox);
    }
    session.file = path.join(base, 'note.html');
    const html = await get('');
    assert.strictEqual(html.headers['content-security-policy'], sandbox);
    assert.ok(html.body.includes('<script src="/sdk.js"></script>'));
    const css = await get('style.css');
    assert.strictEqual(css.statusCode, 200);
    assert.strictEqual(css.headers['content-type'], 'text/css; charset=utf-8');
    assert.strictEqual(css.headers['content-security-policy'], undefined);
    assert.strictEqual(css.body, 'body { color: red }');
  }));
  await test('outside file and directory symlinks are refused without exposing their bytes', () => withArtifactHandler(async ({ base, outside, get }) => {
    createTestSymlink(path.join(outside, 'secret.txt'), path.join(base, 'outside.txt'));
    createTestSymlink(outside, path.join(base, 'outside-dir'), 'dir');
    for (const asset of ['outside.txt', 'outside-dir/secret.txt']) {
      const response = await get(asset);
      assert.strictEqual(response.statusCode, 403);
      assert.ok(!response.body.includes('private-fixture-secret'));
    }
  }));
  await test('internal CSS symlink MIME uses the requested extension', () => withArtifactHandler(async ({ base, get }) => {
    fs.writeFileSync(path.join(base, 'raw-style'), 'body { color: blue }');
    createTestSymlink(path.join(base, 'raw-style'), path.join(base, 'theme.css'));
    const response = await get('theme.css');
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.headers['content-type'], 'text/css; charset=utf-8');
    assert.strictEqual(response.body, 'body { color: blue }');
  }));
  await test('broken sibling links return 404', () => withArtifactHandler(async ({ base, get }) => {
    createTestSymlink(path.join(base, 'missing.txt'), path.join(base, 'broken.txt'));
    assert.strictEqual((await get('broken.txt')).statusCode, 404);
  }));
  await test('encoded lexical traversal stays forbidden', () => withArtifactHandler(async ({ get }) => {
    const response = await get('..%2Foutside%2Fsecret.txt');
    assert.strictEqual(response.statusCode, 403);
    assert.ok(!response.body.includes('private-fixture-secret'));
  }));
  await test('missing paths escape angle brackets and quotes under restrictive CSP', () => withArtifactHandler(async ({ base, session, get }) => {
    // This is a missing-path string, not a platform-dependent filename.
    session.file = path.join(base, '<svg "quoted" & \'single\'>.md');
    const response = await get('');
    assert.strictEqual(response.statusCode, 404);
    assert.ok(response.body.includes('&lt;svg &quot;quoted&quot; &amp; &#39;single&#39;&gt;.md'));
    assert.ok(!response.body.includes('<svg'));
    assert.ok(response.headers['content-security-policy'].includes("default-src 'self'"));
  }));
  await test('known unavailable symlink capability is counted separately from passes', async () => {
    const suite = createTestRunner(() => {});
    await suite.test('synthetic Windows privilege boundary', () => createTestSymlink('target', 'link', 'file', {
      platform: 'win32', symlink() { throw Object.assign(new Error('privilege unavailable'), { code: 'EPERM' }); }
    }));
    assert.deepStrictEqual(suite.results, { passed: 0, failed: 0, skipped: 1 });
  });
  await test('unexpected symlink and ordinary fixture errors count as failures', async () => {
    const suite = createTestRunner(() => {});
    await suite.test('unexpected existing link', () => createTestSymlink('target', 'link', 'file', {
      platform: 'win32', symlink() { throw Object.assign(new Error('already exists'), { code: 'EEXIST' }); }
    }));
    await suite.test('ordinary write error', () => { throw Object.assign(new Error('fixture write failed'), { code: 'EIO' }); });
    await suite.test('non-Windows permission error', () => createTestSymlink('target', 'link', 'file', {
      platform: 'darwin', symlink() { throw Object.assign(new Error('permission denied'), { code: 'EPERM' }); }
    }));
    assert.deepStrictEqual(suite.results, { passed: 0, failed: 3, skipped: 0 });
  });
}

// Deterministic filesystem boundaries, using private regular files only. Native
// descriptors are owned here even when a spy returns a different private file.
async function withAssetIo(asset, overrides, callback, { cleanupClose = fs.closeSync, additionalAssets = [] } = {}) {
  const targets = new Set([asset, ...additionalAssets].map(candidate => fs.realpathSync(candidate)));
  const methods = ['openSync', 'fstatSync', 'lstatSync', 'readSync', 'closeSync'];
  const original = Object.fromEntries(methods.map(name => [name, fs[name]]));
  const live = new Set();
  const calls = { opens: 0, reads: 0, closes: 0, fstats: 0, requested: [], returned: 0, flags: [] };
  const filesystem = Object.freeze({ ...fs, openSync(candidate, flags, ...rest) {
    if (typeof candidate !== 'string' || !targets.has(path.resolve(candidate))) return original.openSync(candidate, flags, ...rest);
    calls.opens++;
    calls.flags.push(flags);
    const fd = overrides.open
      ? overrides.open({ candidate, flags, original, calls })
      : original.openSync(candidate, flags, ...rest);
    live.add(fd);
    return fd;
  },
  fstatSync(fd, ...rest) {
    const stats = original.fstatSync(fd, ...rest);
    if (!live.has(fd)) return stats;
    calls.fstats++;
    return overrides.fstat ? overrides.fstat(stats, calls) : stats;
  },
  lstatSync(candidate, ...rest) {
    const stats = original.lstatSync(candidate, ...rest);
    return overrides.lstat ? overrides.lstat(path.resolve(candidate), stats, calls) : stats;
  },
  readSync(fd, buffer, offset, length, position) {
    if (!live.has(fd)) return original.readSync(fd, buffer, offset, length, position);
    calls.reads++;
    calls.requested.push({ length, position, capacity: buffer.length });
    const count = overrides.read
      ? overrides.read({ fd, buffer, offset, length, position, original, calls })
      : original.readSync(fd, buffer, offset, length, position);
    calls.returned += count;
    return count;
  },
  closeSync(fd) {
    if (!live.has(fd)) return original.closeSync(fd);
    calls.closes++;
    // Close the actual fixture descriptor before optionally simulating a close
    // error. The test never leaks an fd to imitate an ambiguous OS error.
    live.delete(fd);
    original.closeSync(fd);
    if (overrides.close) overrides.close(calls);
  } });
  return withFixtureCleanup(async () => {
    await callback(calls, filesystem);
    // Assert BEFORE fallback cleanup: closing a leaked fd cannot make it pass.
    assert.strictEqual(live.size, 0, 'All returned descriptors must close');
  }, () => [() => closeOwnedDescriptors(live, cleanupClose)]);
}

function closeOwnedDescriptors(owned, close) {
  let didThrow = false;
  let first;
  for (const fd of owned) {
    owned.delete(fd); // An ambiguous close result must never cause a retry.
    try { close(fd); } catch (error) {
      if (!didThrow) { didThrow = true; first = error; }
    }
  }
  if (didThrow) throw first;
}

function changedStats(stats, changes) {
  return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, changes);
}

function assertAssetRefusal(response, status, base, outside) {
  assert.strictEqual(response.statusCode, status);
  assert.ok(!response.body.includes('private-fixture-secret'));
  assert.ok(!response.body.includes(base));
  assert.ok(!response.body.includes(outside));
}

async function artifactRaceTests(test) {
  const withFile = callback => withArtifactHandler(async value => {
    const base = fs.realpathSync(value.base);
    const outside = fs.realpathSync(value.outside);
    const parent = path.join(base, 'nested');
    fs.mkdirSync(parent);
    const asset = path.join(parent, 'asset.txt');
    fs.writeFileSync(asset, 'inert');
    fs.writeFileSync(path.join(outside, 'asset.txt'), 'private-fixture-secret');
    await callback({ ...value, base, outside, parent, asset, fetch: filesystem => value.get('nested/asset.txt', filesystem) });
  });
  await test('sibling reads use one guarded descriptor and at most size plus one bytes', () => withFile(async ({ asset, fetch }) => {
    await withAssetIo(asset, {}, async (calls, filesystem) => {
      const response = await fetch(filesystem);
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body, 'inert');
      assert.deepStrictEqual([calls.opens, calls.closes], [1, 1]);
      assert.ok(calls.fstats >= 2);
      assert.strictEqual(typeof calls.flags[0], 'number');
      for (const flag of [fs.constants.O_NOFOLLOW || 0, fs.constants.O_NONBLOCK || 0]) {
        assert.strictEqual(calls.flags[0] & flag, flag);
      }
      assert.ok(calls.requested.length > 0);
      assert.ok(calls.requested.every(call => call.capacity === 6 && call.length <= 6 && Number.isInteger(call.position)));
      assert.strictEqual(calls.returned, 5);
    });
  }));
  await test('a leaf symlink replacement before native open never reads outside bytes', () => withFile(async ({ asset, base, outside, fetch }) => {
    const probe = path.join(base, 'probe');
    createTestSymlink(path.join(outside, 'asset.txt'), probe);
    fs.unlinkSync(probe);
    await withAssetIo(asset, { open({ candidate, flags, original }) {
      fs.unlinkSync(asset);
      fs.symlinkSync(path.join(outside, 'asset.txt'), asset, 'file');
      return original.openSync(candidate, flags);
    } }, async (calls, filesystem) => {
      assertAssetRefusal(await fetch(filesystem), 403, base, outside);
      assert.strictEqual(calls.reads, 0);
      assert.ok(calls.closes === 0 || calls.closes === 1);
    });
  }));
  await test('a substituted descriptor is rejected even with an unchanged pathname', () => withFile(async ({ asset, base, outside, fetch }) => {
    await withAssetIo(asset, { open({ original }) {
      return original.openSync(path.join(outside, 'asset.txt'), fs.constants.O_RDONLY);
    } }, async (calls, filesystem) => {
      assertAssetRefusal(await fetch(filesystem), 403, base, outside);
      assert.deepStrictEqual([calls.reads, calls.closes], [0, 1]);
    });
  }));
  await test('an intermediate directory symlink swap before open never reads outside bytes', () => withFile(async ({ asset, parent, base, outside, fetch }) => {
    const probe = path.join(base, 'probe');
    createTestSymlink(outside, probe, 'dir');
    fs.unlinkSync(probe);
    await withAssetIo(asset, { open({ candidate, flags, original }) {
      fs.renameSync(parent, `${parent}.saved`);
      fs.symlinkSync(outside, parent, 'dir');
      return original.openSync(candidate, flags);
    } }, async (calls, filesystem) => {
      assertAssetRefusal(await fetch(filesystem), 403, base, outside);
      assert.deepStrictEqual([calls.reads, calls.closes], [0, 1]);
    });
  }));
  await test('parent replacement is refused even with the same leaf inode and simulated stable leaf metadata', () => withFile(async ({ asset, parent, base, outside, fetch }) => {
    const before = fs.statSync(asset, { bigint: true });
    const stable = stats => changedStats(stats, { mtimeNs: before.mtimeNs, ctimeNs: before.ctimeNs });
    await withAssetIo(asset, {
      open({ candidate, flags, original }) {
        fs.renameSync(parent, `${parent}.saved`);
        fs.mkdirSync(parent);
        fs.renameSync(path.join(`${parent}.saved`, 'asset.txt'), asset);
        const current = fs.statSync(asset, { bigint: true });
        assert.deepStrictEqual([current.dev, current.ino], [before.dev, before.ino]);
        return original.openSync(candidate, flags);
      },
      fstat: stable,
      lstat(candidate, stats) { return candidate === asset ? stable(stats) : stats; }
    }, async (calls, filesystem) => {
      assertAssetRefusal(await fetch(filesystem), 403, base, outside);
      assert.deepStrictEqual([calls.reads, calls.closes], [0, 1]);
    });
  }));
  await test('simulated ancestor replacement above the artifact base is refused before read', () => withFile(async ({ asset, base, outside, fetch }) => {
    await withAssetIo(asset, { lstat(candidate, stats, calls) {
      return calls.opens > 0 && candidate === path.dirname(base)
        ? changedStats(stats, { ino: stats.ino + 1n }) : stats;
    } }, async (calls, filesystem) => {
      assertAssetRefusal(await fetch(filesystem), 403, base, outside);
      assert.deepStrictEqual([calls.reads, calls.closes], [0, 1]);
    });
  }));
  for (const change of ['descriptor metadata', 'ancestor identity']) {
    await test(`simulated ${change} change after reading discards the buffered body`, () => withFile(async ({ asset, parent, base, outside, fetch }) => {
      await withAssetIo(asset, {
        fstat(stats, calls) { return change === 'descriptor metadata' && calls.reads > 0
          ? changedStats(stats, { mtimeNs: stats.mtimeNs + 1n }) : stats; },
        lstat(candidate, stats, calls) { return change === 'ancestor identity' && calls.reads > 0 && candidate === parent
          ? changedStats(stats, { ino: stats.ino + 1n }) : stats; }
      }, async (calls, filesystem) => {
        assertAssetRefusal(await fetch(filesystem), 403, base, outside);
        assert.ok(calls.reads > 0);
        assert.strictEqual(calls.closes, 1);
      });
    }));
  }
  await test('retargeting an in-root alias after read discards buffered bytes', () => withFile(async ({ asset, base, outside, get }) => {
    const alias = path.join(base, 'alias.txt');
    const other = path.join(base, 'other.txt');
    fs.writeFileSync(other, 'other');
    createTestSymlink(asset, alias);
    await withAssetIo(asset, { read({ fd, buffer, offset, length, position, original, calls }) {
      const count = original.readSync(fd, buffer, offset, length, position);
      if (calls.reads === 1) { fs.unlinkSync(alias); fs.symlinkSync(other, alias, 'file'); }
      return count;
    } }, async (calls, filesystem) => {
      assertAssetRefusal(await get('alias.txt', filesystem), 403, base, outside);
      assert.strictEqual(calls.closes, 1);
    });
  }));
  for (const size of [67108865n, -1n, 1.5, Infinity]) {
    await test(`invalid or over-limit sampled size ${size} is refused before open`, () => withFile(async ({ asset, base, outside, fetch }) => {
      await withAssetIo(asset, { lstat(candidate, stats) { return candidate === asset ? changedStats(stats, { size }) : stats; } }, async (calls, filesystem) => {
        const status = size === 67108865n ? 413 : 403;
        const response = await fetch(filesystem);
        assertAssetRefusal(response, status, base, outside);
        if (status === 413) assert.deepStrictEqual(JSON.parse(response.body), { error: 'asset too large' });
        assert.deepStrictEqual([calls.opens, calls.reads, calls.closes], [0, 0, 0]);
      });
    }));
  }
  await test('non-regular opened descriptors are refused without reading', () => withFile(async ({ asset, base, outside, fetch }) => {
    await withAssetIo(asset, { fstat(stats) { return changedStats(stats, { isFile: () => false }); } }, async (calls, filesystem) => {
      assertAssetRefusal(await fetch(filesystem), 403, base, outside);
      assert.deepStrictEqual([calls.reads, calls.closes], [0, 1]);
    });
  }));
  for (const kind of ['growth sentinel', 'early EOF']) {
    await test(`bounded read refuses ${kind}`, () => withFile(async ({ asset, base, outside, fetch }) => {
      await withAssetIo(asset, { read({ buffer, offset, length }) {
        if (kind === 'early EOF') return 0;
        buffer.fill(97, offset, offset + length);
        return length;
      } }, async (calls, filesystem) => {
        assertAssetRefusal(await fetch(filesystem), 403, base, outside);
        assert.ok(calls.returned <= 6);
        assert.ok(calls.requested.every(call => call.length <= 6 && call.capacity === 6));
        assert.strictEqual(calls.closes, 1);
      });
    }));
  }
  for (const boundary of ['open', 'fstat', 'read', 'close', 'read and close']) {
    await test(`${boundary} failure closes only acquired descriptors once and returns no body`, () => withFile(async ({ asset, base, outside, fetch }) => {
      const failure = code => Object.assign(new Error(`private failure at ${asset}`), { code });
      const overrides = {};
      if (boundary === 'open') overrides.open = () => { throw failure('EACCES'); };
      if (boundary === 'fstat') overrides.fstat = () => { throw failure('EIO'); };
      if (boundary.includes('read')) overrides.read = () => { throw failure('EIO'); };
      if (boundary.includes('close')) overrides.close = () => { throw failure(boundary === 'read and close' ? 'ELOOP' : 'EIO'); };
      await withAssetIo(asset, overrides, async (calls, filesystem) => {
        assertAssetRefusal(await fetch(filesystem), 404, base, outside);
        assert.strictEqual(calls.closes, boundary === 'open' ? 0 : 1);
      });
    }));
  }
  await test('primary descriptor validation refusal survives a secondary close error', () => withFile(async ({ asset, base, outside, fetch }) => {
    await withAssetIo(asset, {
      open({ original }) { return original.openSync(path.join(outside, 'asset.txt'), fs.constants.O_RDONLY); },
      close() { throw Object.assign(new Error('secondary close error'), { code: 'EIO' }); }
    }, async (calls, filesystem) => {
      assertAssetRefusal(await fetch(filesystem), 403, base, outside);
      assert.deepStrictEqual([calls.reads, calls.closes], [0, 1]);
    });
  }));
  await test('empty sibling files and static in-root directory aliases remain supported', () => withFile(async ({ asset, parent, base, get }) => {
    fs.writeFileSync(asset, '');
    createTestSymlink(parent, path.join(base, 'inside'), 'dir');
    await withAssetIo(asset, {}, async (calls, filesystem) => {
      const response = await get('inside/asset.txt', filesystem);
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body, '');
      assert.deepStrictEqual([calls.opens, calls.closes, calls.returned], [1, 1, 0]);
      assert.ok(calls.requested.every(call => call.capacity === 1));
    });
  }));
}

// Fixture-only regressions: real private files, direct dispatch, no listener.
async function fixtureIsolationTests(test) {
  const methods = ['openSync', 'fstatSync', 'lstatSync', 'readSync', 'closeSync'];
  const native = Object.fromEntries(methods.map(name => [name, fs[name]]));
  const createServer = http.createServer;
  const normalModule = require('../../scripts/lib/plan-canvas/server');
  function assertSharedIdentity() {
    for (const name of methods) assert.strictEqual(fs[name], native[name], `shared fs.${name} changed`);
    assert.strictEqual(http.createServer, createServer, 'shared HTTP factory changed');
    assert.strictEqual(require('../../scripts/lib/plan-canvas/server'), normalModule);
  }
  async function capture(callback) {
    try { await callback(); return { didThrow: false }; }
    catch (error) { return { didThrow: true, error }; }
  }
  const withAsset = callback => withArtifactHandler(async value => {
    const asset = path.join(fs.realpathSync(value.base), 'isolation.txt');
    fs.writeFileSync(asset, 'isolated');
    await callback({ ...value, asset });
  });
  function secondOwnedAsset(asset) {
    const other = path.join(path.dirname(asset), 'second-owned.txt');
    fs.writeFileSync(other, 'second private descriptor', { flag: 'wx' });
    return other;
  }

  await test('fixture overrides never replace shared modules, even during an awaited callback', () => withAsset(async ({ asset, get }) => {
    await withAssetIo(asset, {}, async (calls, filesystem = fs) => {
      assertSharedIdentity();
      assert.ok(Object.isFrozen(filesystem), 'case filesystem facade must be frozen');
      assert.strictEqual((await get('isolation.txt', filesystem)).body, 'isolated');
      assert.strictEqual(calls.opens, 1);
      await Promise.resolve();
      assertSharedIdentity();
    });
    assertSharedIdentity();
    const primary = Object.freeze(new Error('frozen callback failure'));
    const caught = await capture(() => withAssetIo(asset, {}, async (_calls, filesystem = fs) => {
      await get('isolation.txt', filesystem);
      assertSharedIdentity();
      throw primary;
    }));
    assert.strictEqual(caught.didThrow, true);
    assert.strictEqual(caught.error, primary);
    assertSharedIdentity();
  }));

  await test('interleaved private handlers consume only their own filesystem facades', () => withAsset(async ({ asset, get }) => {
    await withAssetIo(asset, {}, async (left, leftFs = fs) => {
      await withAssetIo(asset, {}, async (right, rightFs = fs) => {
        assert.notStrictEqual(leftFs, rightFs, 'simultaneously active fixtures need distinct facades');
        assert.strictEqual((await get('isolation.txt', leftFs)).body, 'isolated');
        assert.deepStrictEqual([left.opens, right.opens], [1, 0]);
        assert.strictEqual((await get('isolation.txt', rightFs)).body, 'isolated');
        assert.deepStrictEqual([left.opens, right.opens], [1, 1]);
        assert.strictEqual((await get('isolation.txt', leftFs)).body, 'isolated');
        assert.deepStrictEqual([left.opens, right.opens, left.closes, right.closes], [2, 1, 2, 1]);
        assertSharedIdentity();
      });
    });
  }));

  await test('private CommonJS loader uses exact source and leaves the normal module identity intact', () => {
    const filename = require.resolve('../../scripts/lib/plan-canvas/server');
    const before = fs.readFileSync(filename, 'utf8');
    const localHttp = Object.freeze({ ...http, createServer() { assertSharedIdentity(); throw new Error('local factory'); } });
    const isolated = loadArtifactServer(fs, localHttp);
    assert.notStrictEqual(isolated, normalModule);
    assert.notStrictEqual(isolated.createPlanCanvasServer, normalModule.createPlanCanvasServer);
    assert.strictEqual(artifactServerSource, before, 'compile the unchanged on-disk source');
    assert.throws(() => isolated.createPlanCanvasServer({ store: { get() {} }, idleTimeoutMs: 0 }), /local factory/);
    assert.strictEqual(fs.readFileSync(filename, 'utf8'), before);
    assertSharedIdentity();
  });

  for (const primary of [Object.freeze(new Error('primary fixture failure')), 0, false, null, undefined]) {
    await test(`descriptor fallback preserves exact ${String(primary)} and attempts all owned fds`, () => withAsset(async ({ asset }) => {
      const otherAsset = secondOwnedAsset(asset);
      const fds = [];
      const attempts = [];
      const secondary = new Error('secondary cleanup');
      const caught = await capture(() => withAssetIo(asset, {}, (_calls, filesystem = fs) => {
        fds.push(filesystem.openSync(asset, 'r'), filesystem.openSync(otherAsset, 'r'));
        throw primary;
      }, { additionalAssets: [otherAsset], cleanupClose(fd) {
        attempts.push(fd);
        native.closeSync(fd);
        if (attempts.length === 1) throw secondary;
      } }));
      assert.strictEqual(caught.didThrow, true);
      assert.ok(Object.is(caught.error, primary), 'cleanup must preserve the exact arbitrary thrown value');
      assert.deepStrictEqual(attempts, fds, 'each remaining descriptor gets one cleanup attempt');
      for (const fd of fds) assert.throws(() => native.fstatSync(fd), error => error.code === 'EBADF');
      assertSharedIdentity();
    }));
  }

  await test('fallback cleanup cannot turn a leaked-descriptor assertion into a pass', () => withAsset(async ({ asset }) => {
    const otherAsset = secondOwnedAsset(asset);
    const fds = [];
    const attempts = [];
    const secondary = new Error('cleanup after leak assertion');
    const caught = await capture(() => withAssetIo(asset, {}, (_calls, filesystem = fs) => {
      fds.push(filesystem.openSync(asset, 'r'), filesystem.openSync(otherAsset, 'r'));
    }, { additionalAssets: [otherAsset], cleanupClose(fd) { attempts.push(fd); native.closeSync(fd); throw secondary; } }));
    assert.strictEqual(caught.didThrow, true);
    assert.match(caught.error.message, /All returned descriptors must close/);
    assert.notStrictEqual(caught.error, secondary);
    assert.deepStrictEqual(attempts, fds);
    for (const fd of fds) assert.throws(() => native.fstatSync(fd), error => error.code === 'EBADF');
  }));

  await test('descriptor cleanup alone removes ownership before each single attempt and reports its first failure', () => withAsset(async ({ asset }) => {
    const otherAsset = secondOwnedAsset(asset);
    const fds = [];
    const owned = new Set();
    const attempts = [];
    const first = new Error('first cleanup failure');
    try {
      for (const file of [asset, otherAsset]) {
        const fd = native.openSync(file, 'r');
        owned.add(fd);
        fds.push(fd);
      }
      const caught = await capture(() => closeOwnedDescriptors(owned, fd => {
        assert.ok(!owned.has(fd), 'ownership must be removed before ambiguous close');
        attempts.push(fd);
        native.closeSync(fd);
        throw attempts.length === 1 ? first : new Error('later cleanup failure');
      }));
      assert.strictEqual(caught.didThrow, true);
      assert.strictEqual(caught.error, first);
      assert.deepStrictEqual(attempts, fds);
      assert.strictEqual(owned.size, 0);
    } finally {
      // Safety cleanup only for an unimplemented/broken helper in RED. Entries
      // already attempted must have been removed and are never retried.
      for (const fd of owned) { owned.delete(fd); native.closeSync(fd); }
    }
    for (const fd of fds) assert.throws(() => native.fstatSync(fd), error => error.code === 'EBADF');
  }));

  for (const state of ['frozen primary', 'falsy primary', 'cleanup only']) {
    await test(`canvas and root cleanup preserve ${state} and attempt every stage`, async () => {
      const primary = state === 'frozen primary' ? Object.freeze(new Error('primary canvas callback')) : 0;
      const closeFailure = new Error('canvas cleanup failure');
      const rootFailure = new Error('root cleanup failure');
      const stages = [];
      let fixtureRoot;
      const caught = await capture(() => withArtifactHandler(async ({ base, get }) => {
        fixtureRoot = path.dirname(base);
        await get('');
        await get('');
        if (state !== 'cleanup only') throw primary;
      }, {
        async closeCanvas(canvas) { stages.push('close'); await canvas.close(); throw closeFailure; },
        removeRoot(root) { stages.push('root'); fs.rmSync(root, { recursive: true, force: true }); throw rootFailure; }
      }));
      assert.strictEqual(caught.didThrow, true);
      assert.ok(Object.is(caught.error, state === 'cleanup only' ? closeFailure : primary));
      assert.deepStrictEqual(stages, ['close', 'close', 'root']);
      assert.strictEqual(fs.existsSync(fixtureRoot), false);
      assertSharedIdentity();
    });
  }
}

function request(port, method, requestPath, {
  body = null, headers = {}, resources, transport = http, onData = () => {}
} = {}) {
  let response;
  const pending = new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = transport.request(
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
        response = res;
        res.on('error', reject);
        let data = '';
        res.on('data', chunk => {
          data += chunk;
          onData(chunk);
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      }
    );
    ownHttpClient(req, () => response, resources);
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
  // Cleanup can reject an abandoned long-poll; awaiters still see this rejection.
  pending.catch(() => {});
  return pending;
}

function jsonBody(res) {
  return JSON.parse(res.body.trim());
}

// Open an SSE stream and collect parsed events into `received`.
function openSse(port, key, { resources, transport = http } = {}) {
  const received = [];
  let close = () => {};
  let response;
  const ready = new Promise((resolve, reject) => {
    const req = transport.get(
      { host: '127.0.0.1', port, path: `/events/${key}`, agent: false },
      res => {
        response = res;
        res.on('error', reject);
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
    close = ownHttpClient(req, () => response, resources);
    req.on('error', reject);
  });
  ready.catch(() => {});
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

// Deterministic ownership checks: no socket/listener or shared module mutation.
async function integrationCleanupTests(test) {
  async function capture(callback) {
    try { return { threw: false, value: await callback() }; }
    catch (error) { return { threw: true, error }; }
  }
  for (const primary of [Object.freeze(new Error('primary integration failure')), 0, false, null, undefined]) {
    await test(`integration resource cleanup preserves ${String(primary)} and attempts all stages`, async () => {
      const stages = [];
      const secondary = new Error('cleanup failure');
      const result = await capture(() => withResourceScope(async resources => {
        resources.root(() => { stages.push('root'); throw secondary; });
        resources.server(() => { stages.push('server'); throw secondary; });
        resources.client(() => { stages.push('client'); throw secondary; });
        throw primary;
      }));
      assert.strictEqual(result.threw, true);
      assert.ok(Object.is(result.error, primary));
      assert.deepStrictEqual(stages, ['client', 'server', 'root']);
    });
    await test(`runner records falsy/frozen failure ${String(primary)} without replacing it`, async () => {
      const output = [];
      const runner = createTestRunner(line => output.push(line));
      await runner.test('failure', () => { throw primary; });
      assert.deepStrictEqual(runner.results, { passed: 0, failed: 1, skipped: 0 });
      assert.strictEqual(output.length, 1);
      assert.match(output[0], /FAIL failure/);
    });
  }
  await test('cleanup-only failure reports the first failure after every owned stage', async () => {
    const first = Object.freeze(new Error('client cleanup'));
    const stages = [];
    const result = await capture(() => withResourceScope(resources => {
      resources.client(() => { stages.push('client'); throw first; });
      resources.server(() => { stages.push('server'); throw new Error('server cleanup'); });
      resources.root(() => { stages.push('root'); throw new Error('root cleanup'); });
    }));
    assert.strictEqual(result.error, first);
    assert.deepStrictEqual(stages, ['client', 'server', 'root']);
  });
  await test('explicit server close and automatic cleanup share one close attempt', async () => {
    let attempts = 0;
    await withResourceScope(async resources => {
      const close = resources.server(async () => { attempts++; });
      await close();
      await close();
    });
    assert.strictEqual(attempts, 1);
  });
  await test('second acquisition failure still closes the first server and roots', async () => {
    const primary = new Error('second acquisition');
    const stages = [];
    const result = await capture(() => withResourceScope(resources => {
      resources.root(() => stages.push('root-one'));
      resources.server(() => stages.push('server-one'));
      resources.root(() => stages.push('root-two'));
      throw primary;
    }));
    assert.strictEqual(result.error, primary);
    assert.deepStrictEqual(stages, ['server-one', 'root-one', 'root-two']);
  });
  function fakeHttp() {
    const { EventEmitter } = require('events');
    const stages = [];
    const request = new EventEmitter();
    const response = new EventEmitter();
    let respond;
    request.write = () => {};
    request.end = () => {};
    request.destroy = () => { stages.push('request'); request.emit('error', new Error('owned request destroyed')); };
    response.destroy = () => { stages.push('response'); };
    return {
      stages, request, response,
      transport: { get(_options, callback) { respond = callback; return request; }, request(_options, callback) { respond = callback; return request; } },
      respond() { respond(response); },
    };
  }
  for (const headers of [false, true]) {
    await test(`SSE failure cleanup owns request before headers=${headers}`, async () => {
      const fake = fakeHttp();
      const primary = new Error('SSE assertion');
      let sse;
      const result = await capture(() => withResourceScope(async resources => {
        sse = openSse(1, 'synthetic', { resources, transport: fake.transport });
        if (headers) { fake.respond(); await sse.ready; }
        throw primary;
      }));
      assert.strictEqual(result.error, primary);
      assert.deepStrictEqual(fake.stages, headers ? ['response', 'request'] : ['request']);
      await sse.ready.catch(() => {});
      await sse.close();
      assert.strictEqual(fake.stages.filter(stage => stage === 'request').length, 1);
    });
  }
  await test('abandoned long-poll cleanup reaps its client without an unhandled rejection', async () => {
    const fake = fakeHttp();
    const primary = new Error('heartbeat assertion');
    let pending;
    const chunks = [];
    const result = await capture(() => withResourceScope(async resources => {
      pending = request(1, 'GET', '/synthetic', { resources, transport: fake.transport, onData: chunk => chunks.push(chunk.toString()) });
      fake.respond();
      fake.response.emit('data', Buffer.from(' '));
      throw primary;
    }));
    assert.strictEqual(result.error, primary);
    assert.deepStrictEqual(chunks, [' ']);
    assert.deepStrictEqual(fake.stages, ['response', 'request']);
    assert.strictEqual((await capture(() => pending)).threw, true);
  });
  await test('request setup failure after acquisition closes its client and keeps the original error', async () => {
    const fake = fakeHttp();
    const primary = Object.freeze(new Error('write failed'));
    fake.request.write = () => { throw primary; };
    const result = await capture(() => withResourceScope(resources => request(1, 'POST', '/synthetic', {
      body: {}, resources, transport: fake.transport,
    })));
    assert.strictEqual(result.error, primary);
    assert.deepStrictEqual(fake.stages, ['request']);
  });
}

async function main(suite = createTestRunner()) {
  console.log('\n=== Testing plan-canvas server ===\n');

  const { test } = suite;
  await artifactSecurityTests(test);
  await artifactRaceTests(test);
  await fixtureIsolationTests(test);
  await integrationCleanupTests(test);
  if (process.argv.includes('--artifact-security-only')) return;

  await withResourceScope(async resources => {
    const integrationTest = (name, callback) => test(name, () => withResourceScope(owned => callback({
      request: (port, method, requestPath, options = {}) => request(port, method, requestPath, { ...options, resources: owned }),
      openSse: (port, key) => openSse(port, key, { resources: owned }),
      ownServer: canvas => owned.server(() => canvas.close()),
    })));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-server-'));
    resources.root(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const artifact = path.join(tmp, 'demo.plan.md');
    fs.writeFileSync(artifact, '# Plan: Demo\n\n## Files to Change\n\n| File | Action |\n|---|---|\n| `a.js` | UPDATE |\n');
    const htmlArtifact = path.join(tmp, 'report.html');
    fs.writeFileSync(htmlArtifact, '<!DOCTYPE html><html><body><h1>Report</h1></body></html>');
    fs.writeFileSync(path.join(tmp, 'style.css'), 'body { color: red }');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-outside-'));
    resources.root(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
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
    const closeCanvas = resources.server(() => canvas.close());
    const { port } = await canvas.listen(0);

    let key = null;
    let htmlKey = null;

    await integrationTest('GET /health identifies the app and version', async ({ request }) => {
      const res = await request(port, 'GET', '/health');
      assert.deepStrictEqual(jsonBody(res), { ok: true, app: 'ecc-plan-canvas', version: '9.9.9-test' });
    });

    await integrationTest('requests with a non-loopback Host header are rejected', async ({ request }) => {
      const res = await request(port, 'GET', '/health', { headers: { host: 'evil.example.com' } });
      assert.strictEqual(res.statusCode, 403);
    });

    await integrationTest('requests with a cross-site Origin are rejected', async ({ request }) => {
      const res = await request(port, 'POST', '/shutdown', { headers: { origin: 'https://evil.example.com' } });
      assert.strictEqual(res.statusCode, 403);
    });

    await integrationTest('POST /api/sessions opens a session for an existing artifact', async ({ request }) => {
      const res = await request(port, 'POST', '/api/sessions', { body: { file: artifact } });
      assert.strictEqual(res.statusCode, 200);
      const body = jsonBody(res);
      assert.strictEqual(body.status, 'open');
      assert.match(body.key, /^[a-f0-9]{12}$/);
      key = body.key;
    });

    await integrationTest('POST /api/sessions 404s for a missing artifact', async ({ request }) => {
      const res = await request(port, 'POST', '/api/sessions', { body: { file: path.join(tmp, 'nope.md') } });
      assert.strictEqual(res.statusCode, 404);
    });

    await integrationTest('GET /canvas/:key serves the ECC chrome with CSP', async ({ request }) => {
      const res = await request(port, 'GET', `/canvas/${key}`);
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers['content-security-policy'].includes("default-src 'self'"));
      assert.ok(res.body.includes('Plan Canvas'));
      assert.ok(res.body.includes('pc-session'));
      assert.ok(res.body.includes('Approve plan'));
      assert.ok(res.body.includes('sandbox="allow-scripts allow-forms allow-popups"'));
    });

    await integrationTest('markdown artifacts render in the ECC plan template with the SDK', async ({ request }) => {
      const res = await request(port, 'GET', `/artifact/${key}/`);
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.includes('<h1 id="plan-demo">'));
      assert.ok(res.body.includes('<table>'));
      assert.ok(res.body.includes('<script src="/sdk.js">'));
      assert.strictEqual(res.headers['content-security-policy'], 'sandbox allow-scripts allow-forms allow-popups');
      // No diagram in this plan → no Mermaid loader shipped.
      assert.ok(!res.body.includes('mermaid.run'));
    });

    await integrationTest('a plan containing ```mermaid serves the themed Mermaid loader', async ({ request }) => {
      const diagram = path.join(tmp, 'flow.plan.md');
      fs.writeFileSync(diagram, '# Flow\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
      const opened = jsonBody(await request(port, 'POST', '/api/sessions', { body: { file: diagram } }));
      const res = await request(port, 'GET', `/artifact/${opened.key}/`);
      assert.ok(res.body.includes('<pre class="mermaid">'), 'diagram container present');
      assert.ok(res.body.includes('mermaid.run'), 'loader injected');
      assert.ok(res.body.includes("securityLevel: 'strict'"), 'sanitizing config present');
      await request(port, 'POST', '/api/end', { body: { file: diagram } });
    });

    await integrationTest('HTML artifacts pass through with the SDK injected before </body>', async ({ request }) => {
      const open = await request(port, 'POST', '/api/sessions', { body: { file: htmlArtifact } });
      htmlKey = jsonBody(open).key;
      const res = await request(port, 'GET', `/artifact/${htmlKey}/`);
      assert.ok(res.body.includes('<h1>Report</h1>'));
      assert.ok(res.body.includes('<script src="/sdk.js"></script>\n</body>'));
    });

    await integrationTest('sibling assets are served, traversal is blocked', async ({ request }) => {
      const ok = await request(port, 'GET', `/artifact/${key}/style.css`);
      assert.strictEqual(ok.statusCode, 200);
      assert.ok(ok.body.includes('color: red'));
      const escape = await request(port, 'GET', `/artifact/${key}/..%2F${path.basename(outsideDir)}%2Fsecret.txt`);
      assert.strictEqual(escape.statusCode, 403);
    });

    await integrationTest('artifact responses carry a sandbox CSP (direct-navigation hardening)', async ({ request }) => {
      const md = await request(port, 'GET', `/artifact/${key}/`);
      assert.strictEqual(md.statusCode, 200);
      assert.strictEqual(md.headers['content-security-policy'], 'sandbox allow-scripts allow-forms allow-popups');
      const html = await request(port, 'GET', `/artifact/${htmlKey}/`);
      assert.strictEqual(html.statusCode, 200);
      assert.strictEqual(html.headers['content-security-policy'], 'sandbox allow-scripts allow-forms allow-popups');
    });

    await integrationTest('missing-artifact 404 escapes the file path', async ({ request }) => {
      // Quotes and ampersands are escapable on every platform (Windows
      // rejects < > in filenames, so angle brackets stay out of fixtures).
      const evilFile = path.join(tmp, `evil'b&xss.plan.md`);
      fs.writeFileSync(evilFile, '# Evil\n');
      const opened = jsonBody(await request(port, 'POST', '/api/sessions', { body: { file: evilFile } }));
      fs.rmSync(evilFile);
      const res = await request(port, 'GET', `/artifact/${opened.key}/`);
      assert.strictEqual(res.statusCode, 404);
      assert.ok(!res.body.includes(`evil'b&xss`), 'raw filename must not appear in the 404 page');
      assert.ok(res.body.includes('evil&#39;b&amp;xss'), 'filename must be HTML-escaped in the 404 page');
    });

    await integrationTest('symlinked sibling assets escaping the artifact dir are blocked', async ({ request }) => {
      createTestSymlink(path.join(outsideDir, 'secret.txt'), path.join(tmp, 'evil-link.txt'));
      createTestSymlink(path.join(tmp, 'style.css'), path.join(tmp, 'ok-link.css'));
      const blocked = await request(port, 'GET', `/artifact/${key}/evil-link.txt`);
      assert.strictEqual(blocked.statusCode, 403);
      const allowed = await request(port, 'GET', `/artifact/${key}/ok-link.css`);
      assert.strictEqual(allowed.statusCode, 200);
      assert.ok(allowed.body.includes('color: red'));
    });

    await integrationTest('served HTML siblings carry the sandbox CSP', async ({ request }) => {
      fs.writeFileSync(path.join(tmp, 'note.html'), '<!DOCTYPE html><html><body><p>hi</p></body></html>');
      const res = await request(port, 'GET', `/artifact/${key}/note.html`);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['content-security-policy'], 'sandbox allow-scripts allow-forms allow-popups');
    });

    await integrationTest('symlinked assets take their MIME from the link name', async ({ request }) => {
      fs.writeFileSync(path.join(tmp, 'realfile'), 'body { color: blue }');
      createTestSymlink(path.join(tmp, 'realfile'), path.join(tmp, 'theme.css'));
      const res = await request(port, 'GET', `/artifact/${key}/theme.css`);
      assert.strictEqual(res.statusCode, 200);
      assert.ok(String(res.headers['content-type']).startsWith('text/css'));
    });

    await integrationTest('static chrome assets are served', async ({ request }) => {
      for (const asset of ['/canvas.css', '/client.js', '/sdk.js']) {
        const res = await request(port, 'GET', asset);
        assert.strictEqual(res.statusCode, 200, `${asset} should be 200`);
      }
    });

    await integrationTest('await with timeoutMs returns waiting when idle', async ({ request }) => {
      const res = await request(port, 'GET', `/api/await?file=${encodeURIComponent(artifact)}&timeoutMs=50`);
      assert.strictEqual(jsonBody(res).status, 'waiting');
    });

    await integrationTest('await returns missing for files without a session', async ({ request }) => {
      const res = await request(port, 'GET', `/api/await?file=${encodeURIComponent(path.join(tmp, 'other.md'))}`);
      assert.strictEqual(jsonBody(res).status, 'missing');
    });

    await integrationTest('browser feedback wakes a blocking await; presence transitions', async ({ request, openSse }) => {
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

      await waitFor(() => sse.received.some(e => e.event === 'presence' && e.data.state === 'thinking'));
      await waitFor(() => sse.received.some(e => e.event === 'chat-sync' && e.data.chat.length === 2));
      await sse.close();
    });

    // Regression: feedback sent with nobody parked on `await` used to leave the
    // pill claiming "agent working" while the message sat undelivered forever.
    await integrationTest('feedback with no listener reports queued, not working', async ({ request, openSse }) => {
      const queuedArtifact = path.join(tmp, 'queued.plan.md');
      fs.writeFileSync(queuedArtifact, '# Plan: Queued\n');
      const opened = jsonBody(await request(port, 'POST', '/api/sessions', { body: { file: queuedArtifact } }));
      const sse = openSse(port, opened.key);
      await sse.ready;
      await waitFor(() => sse.received.some(e => e.event === 'presence' && e.data.state === 'waiting'));

      const post = await request(port, 'POST', `/api/session/${opened.key}/feedback`, {
        body: { items: [{ kind: 'chat', text: 'anyone there?' }] }
      });
      assert.strictEqual(jsonBody(post).presence, 'queued');
      assert.strictEqual(canvas.presenceFor(opened.key), 'queued');
      await waitFor(() => sse.received.some(e => e.event === 'presence' && e.data.state === 'queued'));

      // Draining it hands the batch over and flips the indicator to thinking.
      const drained = jsonBody(await request(port, 'GET', `/api/await?key=${opened.key}&timeoutMs=0`));
      assert.strictEqual(drained.status, 'feedback');
      assert.strictEqual(canvas.presenceFor(opened.key), 'thinking');
      await sse.close();
    });

    await integrationTest('typing endpoint drives the indicator and reply clears it', async ({ request, openSse }) => {
      const typingArtifact = path.join(tmp, 'typing.plan.md');
      fs.writeFileSync(typingArtifact, '# Plan: Typing\n');
      const opened = jsonBody(await request(port, 'POST', '/api/sessions', { body: { file: typingArtifact } }));
      const sse = openSse(port, opened.key);
      await sse.ready;

      const typing = await request(port, 'POST', `/api/session/${opened.key}/typing`, { body: { state: 'typing' } });
      assert.strictEqual(jsonBody(typing).presence, 'typing');
      await waitFor(() => sse.received.some(e => e.event === 'presence' && e.data.state === 'typing'));

      const thinking = await request(port, 'POST', `/api/session/${opened.key}/typing`, { body: { state: 'thinking' } });
      assert.strictEqual(jsonBody(thinking).presence, 'thinking');

      const bad = await request(port, 'POST', `/api/session/${opened.key}/typing`, { body: { state: 'dancing' } });
      assert.strictEqual(bad.statusCode, 400);

      // A landed reply must take the bubble down, not leave it spinning.
      await request(port, 'POST', `/api/session/${opened.key}/reply`, { body: { text: 'done' } });
      assert.strictEqual(canvas.presenceFor(opened.key), 'waiting');
      await waitFor(() => sse.received.some(e => e.event === 'presence' && e.data.state === 'waiting'));
      await sse.close();
    });

    await integrationTest('thinking and typing states expire instead of sticking', async ({ request, ownServer }) => {
      const staleArtifact = path.join(tmp, 'stale.plan.md');
      fs.writeFileSync(staleArtifact, '# Plan: Stale\n');
      const staleStore = createSessionStore({ stateDir: path.join(tmp, 'stale-state') });
      const staleCanvas = createPlanCanvasServer({
        store: staleStore,
        version: '9.9.9-test',
        idleTimeoutMs: 0,
        thinkingStaleMs: 40,
        typingExpiryMs: 20,
        presenceSweepMs: 0
      });
      const closeStaleCanvas = ownServer(staleCanvas);
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
      await closeStaleCanvas();
    });

    // The stuck pill only self-heals if the decay is pushed to an idle browser
    // that is not making any requests of its own.
    await integrationTest('presence sweep pushes the decayed state to an idle browser', async ({ request, openSse, ownServer }) => {
      const sweepArtifact = path.join(tmp, 'sweep.plan.md');
      fs.writeFileSync(sweepArtifact, '# Plan: Sweep\n');
      const sweepStore = createSessionStore({ stateDir: path.join(tmp, 'sweep-state') });
      const sweepCanvas = createPlanCanvasServer({
        store: sweepStore,
        version: '9.9.9-test',
        idleTimeoutMs: 0,
        thinkingStaleMs: 50,
        presenceSweepMs: 20
      });
      const closeSweepCanvas = ownServer(sweepCanvas);
      const bound = await sweepCanvas.listen(0);
      const opened = jsonBody(await request(bound.port, 'POST', '/api/sessions', { body: { file: sweepArtifact } }));
      const sse = openSse(bound.port, opened.key);
      await sse.ready;

      await request(bound.port, 'POST', `/api/session/${opened.key}/typing`, { body: { state: 'thinking' } });
      await waitFor(() => sse.received.some(e => e.event === 'presence' && e.data.state === 'thinking'));

      const before = sse.received.length;
      await waitFor(() =>
        sse.received.slice(before).some(e => e.event === 'presence' && e.data.state === 'waiting')
      );
      await sse.close();
      await closeSweepCanvas();
    });

    await integrationTest('long-poll heartbeat whitespace arrives before the payload', async ({ request }) => {
      const chunks = [];
      const done = request(port, 'GET', `/api/await?file=${encodeURIComponent(artifact)}`, {
        onData: chunk => chunks.push(chunk.toString()),
      });
      // Heartbeats tick every 25ms in this test server; wait for a few first.
      await waitFor(() => chunks.join('').length >= 3);
      assert.ok(/^\s+$/.test(chunks.join('')), 'expected only whitespace before payload');
      await request(port, 'POST', `/api/session/${key}/feedback`, { body: { items: [{ kind: 'chat', text: 'wake up' }] } });
      await done;
      const full = chunks.join('');
      assert.strictEqual(JSON.parse(full.trim()).status, 'feedback');
    });

    await integrationTest('agent reply lands in the chat via SSE chat-sync', async ({ request, openSse }) => {
      const sse = openSse(port, key);
      await sse.ready;
      const res = await request(port, 'POST', `/api/session/${key}/reply`, { body: { text: 'reworked, please re-check' } });
      assert.strictEqual(jsonBody(res).status, 'sent');
      await waitFor(() =>
        sse.received.some(
          e => e.event === 'chat-sync' && e.data.chat.some(m => m.role === 'agent' && m.text.includes('reworked'))
        )
      );
      await sse.close();
    });

    await integrationTest('live reload: editing the artifact emits an SSE reload event', async ({ openSse }) => {
      const sse = openSse(port, key);
      await sse.ready;
      fs.appendFileSync(artifact, '\n## Addendum\n');
      await waitFor(() => sse.received.some(e => e.event === 'reload'), { timeoutMs: 4000 });
      await sse.close();
    });

    await integrationTest('send-and-end delivers the final batch and ends the session', async ({ request }) => {
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
    });

    await integrationTest('user-ended sessions return 409 on plain reopen, open with reopen:true', async ({ request }) => {
      const refused = await request(port, 'POST', '/api/sessions', { body: { file: artifact } });
      assert.strictEqual(refused.statusCode, 409);
      assert.strictEqual(jsonBody(refused).status, 'user-ended');
      const forced = await request(port, 'POST', '/api/sessions', { body: { file: artifact, reopen: true } });
      assert.strictEqual(forced.statusCode, 200);
    });

    await integrationTest('agent end via POST /api/end allows plain reopen', async ({ request }) => {
      const res = await request(port, 'POST', '/api/end', { body: { file: artifact } });
      assert.strictEqual(jsonBody(res).endedBy, 'agent');
      const reopened = await request(port, 'POST', '/api/sessions', { body: { file: artifact } });
      assert.strictEqual(reopened.statusCode, 200);
    });

    await integrationTest('feedback on an ended session is refused with 409', async ({ request }) => {
      await request(port, 'POST', `/api/end`, { body: { file: htmlArtifact } });
      const res = await request(port, 'POST', `/api/session/${htmlKey}/feedback`, {
        body: { items: [{ kind: 'chat', text: 'too late' }] }
      });
      assert.strictEqual(res.statusCode, 409);
    });

    await integrationTest('GET / lists sessions in the ECC shell', async ({ request }) => {
      const res = await request(port, 'GET', '/');
      assert.ok(res.body.includes('Plan Canvas sessions'));
      assert.ok(res.body.includes('demo.plan.md'));
    });

    await integrationTest('POST /shutdown triggers the shutdown callback', async ({ request }) => {
      const res = await request(port, 'POST', '/shutdown');
      assert.strictEqual(jsonBody(res).status, 'stopping');
      await waitFor(() => idleFired);
    });

    await integrationTest('close() settles a held long-poll instead of hanging', async ({ request }) => {
      await request(port, 'POST', '/api/sessions', { body: { file: artifact, reopen: true } });
      const held = request(port, 'GET', `/api/await?file=${encodeURIComponent(artifact)}`);
      await waitFor(() => canvas.presenceFor(store.findByFile(artifact).key) === 'listening');
      await closeCanvas();
      const result = jsonBody(await held);
      assert.strictEqual(result.status, 'waiting');
      assert.ok(result.note.includes('shutting down'));
    });
  });

}

const suite = createTestRunner();
runTestProcess(() => main(suite), suite);
