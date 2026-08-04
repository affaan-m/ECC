/**
 * Tests for scripts/control-pane.js and its local HTTP API.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const initSqlJs = require('sql.js');

const { createControlPaneServer, parseArgs, runAction, isAllowedHostHeader, isAllowedOrigin, buildAllowedHostnames } = require('../../scripts/lib/control-pane/server');
const { main: runControlPaneCli } = require('../../scripts/control-pane');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'control-pane.js');
const REPO_ROOT = path.join(__dirname, '..', '..');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

async function writeMinimalDatabase(dbPath) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      project TEXT NOT NULL DEFAULT '',
      task_group TEXT NOT NULL DEFAULT '',
      agent_type TEXT NOT NULL,
      harness TEXT NOT NULL DEFAULT 'unknown',
      detected_harnesses_json TEXT NOT NULL DEFAULT '[]',
      working_dir TEXT NOT NULL DEFAULT '.',
      state TEXT NOT NULL DEFAULT 'pending',
      pid INTEGER,
      worktree_path TEXT,
      worktree_branch TEXT,
      worktree_base TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      tool_calls INTEGER DEFAULT 0,
      files_changed INTEGER DEFAULT 0,
      duration_secs INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0.0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_heartbeat_at TEXT NOT NULL
    );
    INSERT INTO sessions (
      id, task, agent_type, harness, detected_harnesses_json, working_dir, state,
      created_at, updated_at, last_heartbeat_at
    ) VALUES (
      'session-a', 'Build the control pane', 'codex', 'codex', '["codex"]', '/repo/ecc',
      'running', '2026-06-03T10:00:00Z', '2026-06-03T10:05:00Z', '2026-06-03T10:05:00Z'
    );
  `);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

function waitForCliReady(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Timed out waiting for control pane CLI.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 5000);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
      if (!settled && stdout.includes('ECC Control Pane:') && stdout.includes('Actions:')) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr });
      }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`control pane CLI exited early with ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

function waitForExit(child) {
  return new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function fetchLocal(url, options) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function runTests() {
  console.log('\n=== Testing control-pane server ===\n');

  let passed = 0;
  let failed = 0;

  if (
    await test('parses CLI arguments for local-only serving', async () => {
      const parsed = parseArgs([
        'node',
        'scripts/control-pane.js',
        '--host',
        '127.0.0.1',
        '--port',
        '8788',
        '--db',
        '/tmp/ecc2.db',
        '--state-db',
        '/tmp/ecc-state.db',
        '--query',
        'Hermes memory',
        '--no-open'
      ]);

      assert.strictEqual(parsed.host, '127.0.0.1');
      assert.strictEqual(parsed.port, 8788);
      assert.strictEqual(parsed.dbPath, '/tmp/ecc2.db');
      assert.strictEqual(parsed.stateDbPath, '/tmp/ecc-state.db');
      assert.strictEqual(parsed.query, 'Hermes memory');
      assert.strictEqual(parsed.openBrowser, false);
    })
  )
    passed++;
  else failed++;

  if (
    await test('rejects invalid CLI port values', async () => {
      assert.throws(() => parseArgs(['node', 'scripts/control-pane.js', '--port', '70000']), /Invalid --port value/);
      assert.throws(() => parseArgs(['node', 'scripts/control-pane.js', '--port', 'wat']), /Invalid --port value/);
    })
  )
    passed++;
  else failed++;

  if (
    await test('rejects missing state database path values', async () => {
      assert.throws(() => parseArgs(['node', 'scripts/control-pane.js', '--state-db']), /Invalid --state-db value/);
      assert.throws(() => parseArgs(['node', 'scripts/control-pane.js', '--state-db', '--query', 'Hermes']), /Invalid --state-db value/);
    })
  )
    passed++;
  else failed++;

  if (
    await test('serves HTML and snapshot JSON from a temp ECC2 database', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-control-pane-server-'));
      const dbPath = path.join(tempDir, 'ecc2.db');

      try {
        await writeMinimalDatabase(dbPath);
        const app = await createControlPaneServer({
          host: '127.0.0.1',
          port: 0,
          dbPath,
          repoRoot: REPO_ROOT,
          query: 'control pane',
          allowActions: false
        });

        await app.listen();
        try {
          const html = await fetchLocal(`${app.url}/`).then(response => response.text());
          assert.ok(html.includes('ECC Control Pane'));
          assert.ok(html.includes('id="app"'));
          assert.ok(html.includes('id="work-items"'));
          assert.ok(html.includes('function renderWorkItems'));
          assert.ok(html.includes('function showError'));
          assert.ok(html.includes('response.ok'));
          // Board controls must use escaped data-* attributes + delegated
          // listeners, never ids concatenated into inline onclick JS (XSS).
          assert.ok(html.includes('data-wi-action'));
          assert.ok(!/onclick="ecc(Claim|Move)Item\(/.test(html), 'no inline onclick handlers with interpolated ids');

          const snapshot = await fetchLocal(`${app.url}/api/snapshot?query=control`).then(response => response.json());
          assert.strictEqual(snapshot.schemaVersion, 'ecc.control-pane.snapshot.v1');
          assert.strictEqual(snapshot.summary.totalSessions, 1);
          assert.strictEqual(snapshot.workItems.totalCount, 0);
          assert.strictEqual(snapshot.sessions[0].id, 'session-a');
        } finally {
          await app.close();
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await test('serves the 3D agent-airspace page and the proximity JSON feed', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-control-pane-proximity-'));
      const dbPath = path.join(tempDir, 'ecc2.db');

      try {
        await writeMinimalDatabase(dbPath);
        const app = await createControlPaneServer({
          host: '127.0.0.1',
          port: 0,
          dbPath,
          repoRoot: REPO_ROOT,
          allowActions: false
        });

        await app.listen();
        try {
          // The Enterprise/Pro 3D observability view: a self-contained HTML page.
          const page = await fetchLocal(`${app.url}/proximity`);
          assert.strictEqual(page.status, 200);
          assert.ok((page.headers.get('content-type') || '').includes('text/html'));
          const html = await page.text();
          assert.ok(html.includes('Agent Airspace'), 'page is titled Agent Airspace');
          assert.ok(html.includes('<canvas'), 'page renders a canvas');
          assert.ok(html.includes('/api/proximity'), 'page polls the proximity feed');

          // The feed the page polls: shape must carry the airspace arrays.
          const prox = await fetchLocal(`${app.url}/api/proximity`).then(r => r.json());
          assert.ok(Array.isArray(prox.positions), 'positions array present');
          assert.ok(Array.isArray(prox.links), 'links array present');
          assert.ok(Array.isArray(prox.advisories), 'advisories array present');
          assert.ok(prox.counts && typeof prox.counts === 'object', 'counts present');
        } finally {
          await app.close();
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await test('serves health, asset, not-found, invalid body, and read-only action responses', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-control-pane-routes-'));

      try {
        const app = await createControlPaneServer({
          host: '127.0.0.1',
          port: 0,
          dbPath: path.join(tempDir, 'missing.db'),
          repoRoot: tempDir,
          allowActions: false
        });

        await app.listen();
        try {
          const health = await fetchLocal(`${app.url}/api/health`).then(response => response.json());
          assert.strictEqual(health.ok, true);
          assert.strictEqual(health.allowActions, false);

          const realAssetApp = await createControlPaneServer({
            host: '127.0.0.1',
            port: 0,
            dbPath: path.join(tempDir, 'missing.db'),
            repoRoot: REPO_ROOT,
            allowActions: false
          });
          await realAssetApp.listen();
          try {
            const realAsset = await fetchLocal(`${realAssetApp.url}/assets/ecc-icon.svg`);
            assert.strictEqual(realAsset.status, 200);
            assert.match(await realAsset.text(), /<svg/);
          } finally {
            await realAssetApp.close();
          }

          const missingAsset = await fetchLocal(`${app.url}/assets/ecc-icon.svg`);
          assert.strictEqual(missingAsset.status, 404);
          assert.strictEqual(await missingAsset.text(), 'not found');

          const missing = await fetchLocal(`${app.url}/not-here`).then(response => response.json());
          assert.strictEqual(missing.ok, false);
          assert.strictEqual(missing.error, 'not found');

          const blocked = await fetchLocal(`${app.url}/api/actions/sync-knowledge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: 'memory' })
          }).then(async response => ({ status: response.status, body: await response.json() }));
          assert.strictEqual(blocked.status, 403);
          assert.match(blocked.body.error, /disabled/);

          const invalidBody = await fetchLocal(`${app.url}/api/actions/sync-knowledge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{bad json'
          }).then(async response => ({ status: response.status, body: await response.json() }));
          assert.strictEqual(invalidBody.status, 403);
        } finally {
          await app.close();
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await test('guards copy-only and unknown action requests', async () => {
      const app = await createControlPaneServer({
        host: '127.0.0.1',
        port: 0,
        repoRoot: REPO_ROOT,
        allowActions: true
      });

      await app.listen();
      try {
        const copyOnly = await fetchLocal(`${app.url}/api/actions/open-dashboard`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}'
        }).then(async response => ({ status: response.status, body: await response.json() }));
        assert.strictEqual(copyOnly.status, 400);
        assert.strictEqual(copyOnly.body.action, 'open-dashboard');
        assert.match(copyOnly.body.error, /copy-only/);

        const unknown = await fetchLocal(`${app.url}/api/actions/nope`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}'
        }).then(async response => ({ status: response.status, body: await response.json() }));
        assert.strictEqual(unknown.status, 500);
        assert.match(unknown.body.error, /Unknown control-pane action/);

        const invalidBody = await fetchLocal(`${app.url}/api/actions/sync-knowledge`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{bad json'
        }).then(async response => ({ status: response.status, body: await response.json() }));
        assert.strictEqual(invalidBody.status, 500);
        assert.match(invalidBody.body.error, /JSON/);
      } finally {
        await app.close();
      }
    })
  )
    passed++;
  else failed++;

  if (
    await test('classifies Host and Origin headers against the loopback allowlist', async () => {
      const allowed = buildAllowedHostnames('127.0.0.1');
      assert.strictEqual(isAllowedHostHeader('127.0.0.1:8765', allowed), true);
      assert.strictEqual(isAllowedHostHeader('localhost:8765', allowed), true);
      assert.strictEqual(isAllowedHostHeader('LOCALHOST:8765', allowed), true);
      assert.strictEqual(isAllowedHostHeader('[::1]:8765', allowed), true);
      assert.strictEqual(isAllowedHostHeader('attacker.example.com:8765', allowed), false);
      assert.strictEqual(isAllowedHostHeader('rebind.dnsbin.io', allowed), false);
      assert.strictEqual(isAllowedHostHeader('', allowed), false);
      assert.strictEqual(isAllowedHostHeader(undefined, allowed), false);

      // Origin is optional; absence is allowed for non-browser clients.
      assert.strictEqual(isAllowedOrigin(undefined, allowed), true);
      assert.strictEqual(isAllowedOrigin('', allowed), true);
      assert.strictEqual(isAllowedOrigin('http://127.0.0.1:8765', allowed), true);
      assert.strictEqual(isAllowedOrigin('http://localhost', allowed), true);
      assert.strictEqual(isAllowedOrigin('http://attacker.example.com', allowed), false);
      assert.strictEqual(isAllowedOrigin('not-a-url', allowed), false);

      // A non-default configured host should still admit loopback variants.
      const lan = buildAllowedHostnames('192.168.1.10');
      assert.strictEqual(isAllowedHostHeader('192.168.1.10:8765', lan), true);
      assert.strictEqual(isAllowedHostHeader('127.0.0.1:8765', lan), true);
      assert.strictEqual(isAllowedHostHeader('attacker.example.com:8765', lan), false);
    })
  )
    passed++;
  else failed++;

  if (
    await test('rejects requests forged with a non-loopback Host header (DNS rebinding gate)', async () => {
      const app = await createControlPaneServer({
        host: '127.0.0.1',
        port: 0,
        repoRoot: REPO_ROOT,
        allowActions: true
      });

      await app.listen();
      try {
        const address = app.server.address();
        const actualPort = address && typeof address === 'object' ? address.port : 0;

        const sendWithHeaders = (method, pathname, headers, body) =>
          new Promise((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port: actualPort, method, path: pathname, headers }, response => {
              let chunks = '';
              response.on('data', chunk => {
                chunks += chunk.toString('utf8');
              });
              response.on('end', () => {
                resolve({ status: response.statusCode, body: chunks });
              });
            });
            req.on('error', reject);
            if (body) req.write(body);
            req.end();
          });

        const forgedHost = await sendWithHeaders('GET', '/api/health', { Host: 'attacker.example.com:1234' });
        assert.strictEqual(forgedHost.status, 421);
        assert.match(forgedHost.body, /Misdirected request/);

        const forgedActionHost = await sendWithHeaders(
          'POST',
          '/api/actions/sync-knowledge',
          { Host: 'attacker.example.com:1234', 'content-type': 'application/json' },
          JSON.stringify({ query: 'rebound' })
        );
        assert.strictEqual(forgedActionHost.status, 421);

        const forgedOrigin = await sendWithHeaders('GET', '/api/health', {
          Host: '127.0.0.1:' + actualPort,
          Origin: 'http://attacker.example.com'
        });
        assert.strictEqual(forgedOrigin.status, 403);
        assert.match(forgedOrigin.body, /Forbidden origin/);

        const okHost = await sendWithHeaders('GET', '/api/health', { Host: '127.0.0.1:' + actualPort });
        assert.strictEqual(okHost.status, 200);
        const okBody = JSON.parse(okHost.body);
        assert.strictEqual(okBody.ok, true);
      } finally {
        await app.close();
      }
    })
  )
    passed++;
  else failed++;

  if (
    await test('runAction captures success, failure, and bounded output', async () => {
      const repoRoot = REPO_ROOT;
      const success = await runAction({
        id: 'node-success',
        command: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(21010))'],
        cwd: repoRoot
      });
      assert.strictEqual(success.ok, true);
      assert.strictEqual(success.code, 0);
      assert.ok(success.stdout.includes('[truncated '));

      const failure = await runAction({
        id: 'node-failure',
        command: process.execPath,
        args: ['-e', 'process.stderr.write("bad"); process.exit(7)'],
        cwd: repoRoot
      });
      assert.strictEqual(failure.ok, false);
      assert.strictEqual(failure.code, 7);
      assert.strictEqual(failure.stderr, 'bad');

      const spawnError = await runAction({
        id: 'spawn-error',
        command: 'definitely-not-ecc-control-pane-command',
        args: [],
        cwd: repoRoot
      });
      assert.strictEqual(spawnError.ok, false);
      assert.strictEqual(spawnError.code, null);
      assert.match(spawnError.error, /ENOENT/);
    })
  )
    passed++;
  else failed++;

  if (
    await test('runAction terminates commands that exceed the local timeout', async () => {
      const timedOut = await runAction(
        {
          id: 'node-timeout',
          command: process.execPath,
          args: ['-e', 'setTimeout(() => {}, 5000)'],
          cwd: REPO_ROOT
        },
        { timeoutMs: 25 }
      );

      assert.strictEqual(timedOut.ok, false);
      assert.strictEqual(timedOut.signal, 'SIGTERM');
    })
  )
    passed++;
  else failed++;

  if (
    await test('CLI prints help', async () => {
      const result = spawnSync('node', [SCRIPT, '--help'], {
        encoding: 'utf8',
        cwd: REPO_ROOT
      });

      assert.strictEqual(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('Usage:'));
      assert.ok(result.stdout.includes('control-pane'));
    })
  )
    passed++;
  else failed++;

  if (
    await test('CLI browser opener handles spawn errors', async () => {
      const source = fs.readFileSync(SCRIPT, 'utf8');

      assert.match(source, /child\.on\('error'/);
      assert.match(source, /child\.unref\(\)/);
    })
  )
    passed++;
  else failed++;

  if (
    await test('CLI main handles help without starting a server', async () => {
      const originalLog = console.log;
      const lines = [];
      console.log = line => {
        lines.push(String(line));
      };
      try {
        await runControlPaneCli(['node', 'scripts/control-pane.js', '--help']);
      } finally {
        console.log = originalLog;
      }

      assert.match(lines.join('\n'), /Usage:/);
      assert.match(lines.join('\n'), /--read-only/);
    })
  )
    passed++;
  else failed++;

  if (
    await test('CLI starts a read-only local server and shuts down on SIGTERM', async () => {
      const child = spawn(process.execPath, [SCRIPT, '--host', '127.0.0.1', '--port', '0', '--read-only', '--no-open'], {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ECC2_DB_PATH: path.join(os.tmpdir(), 'missing-ecc2-cli.db')
        }
      });
      const exitPromise = waitForExit(child);

      try {
        const ready = await waitForCliReady(child);
        assert.match(ready.stdout, /ECC Control Pane: http:\/\/127\.0\.0\.1:\d+/);
        assert.match(ready.stdout, /Actions: read-only/);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        const result = await exitPromise;
        assert.ok(result.code === 0 || result.signal === 'SIGTERM', `expected graceful shutdown or SIGTERM, got code=${result.code} signal=${result.signal}`);
      }
    })
  )
    passed++;
  else failed++;

  if (
    await test('interactive board: claim and move work items via POST endpoints', async () => {
      const { createStateStore } = require('../../scripts/lib/state-store');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-control-pane-board-'));
      const stateDbPath = path.join(tempDir, 'state.db');

      try {
        const store = await createStateStore({ dbPath: stateDbPath });
        store.upsertWorkItem({ id: 'wi-1', source: 'github-issue', title: 'Unassigned card', status: 'open', priority: 'high', owner: null, metadata: {} });
        store.upsertWorkItem({ id: 'wi-2', source: 'manual', title: 'Movable card', status: 'open', owner: 'codex', metadata: {} });
        store.close();

        const post = (app, suffix, body) =>
          fetchLocal(`${app.url}/api/work-items/${suffix}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          });

        // Read-only server rejects board edits.
        const ro = await createControlPaneServer({ host: '127.0.0.1', port: 0, stateDbPath, repoRoot: REPO_ROOT, allowActions: false });
        await ro.listen();
        try {
          const denied = await post(ro, 'wi-1/claim', { owner: 'alice' });
          assert.strictEqual(denied.status, 403);
        } finally {
          await ro.close();
        }

        // Interactive server claims and moves.
        const app = await createControlPaneServer({ host: '127.0.0.1', port: 0, stateDbPath, repoRoot: REPO_ROOT, allowActions: true });
        await app.listen();
        try {
          const claim = await post(app, 'wi-1/claim', { owner: 'alice', as: 'human' }).then(r => r.json());
          assert.strictEqual(claim.ok, true);
          assert.strictEqual(claim.item.owner, 'alice');
          assert.strictEqual(claim.item.status, 'running');
          assert.strictEqual(claim.item.metadata.assigneeKind, 'human');

          const move = await post(app, 'wi-2/move', { lane: 'blocked' }).then(r => r.json());
          assert.strictEqual(move.ok, true);
          assert.strictEqual(move.item.status, 'blocked');

          // Snapshot reflects the mutations.
          const snapshot = await fetchLocal(`${app.url}/api/snapshot`).then(r => r.json());
          const byId = id => snapshot.workItems.items.find(i => i.id === id);
          assert.strictEqual(byId('wi-1').assigneeKind, 'human');
          assert.strictEqual(byId('wi-2').kanbanState, 'blocked');

          // Invalid lane is a 400.
          const bad = await post(app, 'wi-2/move', { lane: 'nope' });
          assert.strictEqual(bad.status, 400);
        } finally {
          await app.close();
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
