/**
 * Tests for scripts/control-pane.js and its local HTTP API.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const initSqlJs = require('sql.js');

const {
  createControlPaneServer,
  parseArgs,
} = require('../../scripts/lib/control-pane/server');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'control-pane.js');

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

async function runTests() {
  console.log('\n=== Testing control-pane server ===\n');

  let passed = 0;
  let failed = 0;

  if (await test('parses CLI arguments for local-only serving', async () => {
    const parsed = parseArgs([
      'node',
      'scripts/control-pane.js',
      '--host',
      '127.0.0.1',
      '--port',
      '8788',
      '--db',
      '/tmp/ecc2.db',
      '--query',
      'Hermes memory',
      '--no-open',
    ]);

    assert.strictEqual(parsed.host, '127.0.0.1');
    assert.strictEqual(parsed.port, 8788);
    assert.strictEqual(parsed.dbPath, '/tmp/ecc2.db');
    assert.strictEqual(parsed.query, 'Hermes memory');
    assert.strictEqual(parsed.openBrowser, false);
  })) passed++; else failed++;

  if (await test('serves HTML and snapshot JSON from a temp ECC2 database', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-control-pane-server-'));
    const dbPath = path.join(tempDir, 'ecc2.db');

    try {
      await writeMinimalDatabase(dbPath);
      const app = await createControlPaneServer({
        host: '127.0.0.1',
        port: 0,
        dbPath,
        repoRoot: path.join(__dirname, '..', '..'),
        query: 'control pane',
        allowActions: false,
      });

      await app.listen();
      try {
        const html = await fetch(`${app.url}/`).then(response => response.text());
        assert.ok(html.includes('ECC Control Pane'));
        assert.ok(html.includes('id="app"'));

        const snapshot = await fetch(`${app.url}/api/snapshot?query=control`).then(response => response.json());
        assert.strictEqual(snapshot.schemaVersion, 'ecc.control-pane.snapshot.v1');
        assert.strictEqual(snapshot.summary.totalSessions, 1);
        assert.strictEqual(snapshot.sessions[0].id, 'session-a');
      } finally {
        await app.close();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (await test('CLI prints help', async () => {
    const result = spawnSync('node', [SCRIPT, '--help'], {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..', '..'),
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('Usage:'));
    assert.ok(result.stdout.includes('control-pane'));
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
