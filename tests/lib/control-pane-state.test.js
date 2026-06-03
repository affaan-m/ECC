/**
 * Tests for the local ECC2 control-pane state projection.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const initSqlJs = require('sql.js');

const {
  buildControlPaneSnapshot,
  resolveControlPaneConfig,
} = require('../../scripts/lib/control-pane/state');

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

async function writeSampleEcc2Database(dbPath) {
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
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_session TEXT NOT NULL,
      to_session TEXT NOT NULL,
      content TEXT NOT NULL,
      msg_type TEXT NOT NULL DEFAULT 'info',
      read INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL
    );
    CREATE TABLE context_graph_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      entity_key TEXT NOT NULL UNIQUE,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT,
      summary TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE context_graph_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      entity_id INTEGER NOT NULL,
      observation_type TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE context_graph_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      from_entity_id INTEGER NOT NULL,
      to_entity_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE context_graph_connector_checkpoints (
      connector_name TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_signature TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (connector_name, source_path)
    );
  `);

  const insertSession = db.prepare(`
    INSERT INTO sessions (
      id, task, project, task_group, agent_type, harness, detected_harnesses_json,
      working_dir, state, pid, worktree_path, worktree_branch, worktree_base,
      input_tokens, output_tokens, tokens_used, tool_calls, files_changed,
      duration_secs, cost_usd, created_at, updated_at, last_heartbeat_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSession.run([
    'lead-hermes',
    'Coordinate Hermes desktop and ECC release work',
    'ECC',
    '2.0-control-pane',
    'claude',
    'claude',
    JSON.stringify(['claude', 'codex']),
    '/repo/ecc',
    'running',
    4242,
    '/tmp/ecc-worktrees/hermes',
    'ecc/hermes-control-pane',
    'main',
    1200,
    800,
    2000,
    19,
    6,
    540,
    0.42,
    '2026-06-03T10:00:00Z',
    '2026-06-03T10:15:00Z',
    '2026-06-03T10:15:00Z',
  ]);
  insertSession.run([
    'worker-kb',
    'Index operator memory',
    'ECC',
    'knowledge',
    'codex',
    'codex',
    JSON.stringify(['codex']),
    '/repo/ecc',
    'idle',
    null,
    null,
    null,
    null,
    300,
    200,
    500,
    4,
    2,
    120,
    0.07,
    '2026-06-03T10:05:00Z',
    '2026-06-03T10:14:00Z',
    '2026-06-03T10:14:00Z',
  ]);
  insertSession.free();

  db.run(
    'INSERT INTO messages (from_session, to_session, content, msg_type, read, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
    ['worker-kb', 'lead-hermes', 'Need approval for connector sync', 'approval_request', 0, '2026-06-03T10:16:00Z']
  );

  const insertEntity = db.prepare(`
    INSERT INTO context_graph_entities (
      session_id, entity_key, entity_type, name, path, summary, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertEntity.run([
    'lead-hermes',
    'runbook:Hermes revenue runbook:/notes/hermes.md',
    'runbook',
    'Hermes revenue runbook',
    '/notes/hermes.md',
    'How Affaan routes Hermes Desktop, Zellij panes, Devin-style delegation, and ECC release control work.',
    JSON.stringify({ source: 'hermes_workspace', platform: 'desktop' }),
    '2026-06-03T10:10:00Z',
    '2026-06-03T10:10:00Z',
  ]);
  insertEntity.run([
    null,
    'concept:gbrain memory:/notes/gbrain.md',
    'concept',
    'gbrain memory',
    '/notes/gbrain.md',
    'Operator knowledge base pattern for cross-platform agent memory.',
    JSON.stringify({ source: 'workspace_notes' }),
    '2026-06-03T10:11:00Z',
    '2026-06-03T10:11:00Z',
  ]);
  insertEntity.free();

  db.run(
    'INSERT INTO context_graph_observations (session_id, entity_id, observation_type, priority, pinned, summary, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      'lead-hermes',
      1,
      'operator_memory',
      3,
      1,
      'Hermes Desktop and ECC should share recall before dispatching work.',
      JSON.stringify({ note: 'safe public summary only' }),
      '2026-06-03T10:12:00Z',
    ]
  );
  db.run(
    'INSERT INTO context_graph_relations (session_id, from_entity_id, to_entity_id, relation_type, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['lead-hermes', 1, 2, 'depends_on', 'Runbook uses durable memory concepts.', '2026-06-03T10:13:00Z']
  );
  db.run(
    'INSERT INTO context_graph_connector_checkpoints (connector_name, source_path, source_signature, updated_at) VALUES (?, ?, ?, ?)',
    ['hermes_workspace', '/notes/hermes.md', 'sig-1', '2026-06-03T10:12:00Z']
  );

  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

async function runTests() {
  console.log('\n=== Testing control-pane state ===\n');

  let passed = 0;
  let failed = 0;

  if (await test('builds an operator snapshot from ECC2 SQLite and configured connectors', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-control-pane-state-'));
    const dbPath = path.join(tempDir, 'ecc2.db');

    try {
      await writeSampleEcc2Database(dbPath);
      const snapshot = await buildControlPaneSnapshot({
        dbPath,
        repoRoot: path.join(__dirname, '..', '..'),
        query: 'Hermes Desktop Zellij gbrain',
        config: {
          memoryConnectors: {
            hermes_workspace: {
              kind: 'markdown_directory',
              path: '/notes',
              recurse: true,
            },
            safe_env: {
              kind: 'dotenv_file',
              path: '/notes/.env',
              includeSafeValues: false,
            },
          },
        },
      });

      assert.strictEqual(snapshot.schemaVersion, 'ecc.control-pane.snapshot.v1');
      assert.strictEqual(snapshot.summary.totalSessions, 2);
      assert.strictEqual(snapshot.summary.runningSessions, 1);
      assert.strictEqual(snapshot.summary.unreadMessages, 1);
      assert.strictEqual(snapshot.sessions[0].id, 'lead-hermes');
      assert.deepStrictEqual(snapshot.sessions[0].detectedHarnesses, ['claude', 'codex']);
      assert.strictEqual(snapshot.knowledge.query, 'Hermes Desktop Zellij gbrain');
      assert.strictEqual(snapshot.knowledge.results[0].entity.name, 'Hermes revenue runbook');
      assert.ok(snapshot.knowledge.results[0].matchedTerms.includes('hermes'));
      assert.strictEqual(snapshot.knowledge.results[0].hasPinnedObservation, true);
      assert.strictEqual(snapshot.connectors.length, 2);
      assert.strictEqual(snapshot.connectors[0].name, 'hermes_workspace');
      assert.strictEqual(snapshot.connectors[0].syncedSources, 1);
      assert.strictEqual(snapshot.connectors[1].syncedSources, 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (await test('resolves config from explicit db path and TOML connector file', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-control-pane-config-'));
    const dbPath = path.join(tempDir, 'state.db');
    const configPath = path.join(tempDir, 'ecc2.toml');

    try {
      fs.writeFileSync(
        configPath,
        [
          `db_path = "${dbPath.replace(/\\/g, '\\\\')}"`,
          '',
          '[memory_connectors.hermes_workspace]',
          'kind = "markdown_directory"',
          'path = "/tmp/hermes"',
          'recurse = true',
          'default_entity_type = "operator_note"',
        ].join('\n'),
        'utf8'
      );

      const config = resolveControlPaneConfig({
        cwd: tempDir,
        configPath,
      });

      assert.strictEqual(config.dbPath, dbPath);
      assert.strictEqual(config.memoryConnectors.hermes_workspace.kind, 'markdown_directory');
      assert.strictEqual(config.memoryConnectors.hermes_workspace.path, '/tmp/hermes');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (await test('prefers the operator home config over stale app-support config', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-control-pane-precedence-'));
    const homeDir = path.join(tempDir, 'home');
    const homeConfigDir = path.join(homeDir, '.claude');
    const appConfigDir = path.join(homeDir, 'Library', 'Application Support', 'ecc2');
    const homeDbPath = path.join(tempDir, 'operator.db');
    const staleDbPath = path.join(tempDir, 'stale-smoke.db');

    try {
      fs.mkdirSync(homeConfigDir, { recursive: true });
      fs.mkdirSync(appConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(appConfigDir, 'config.toml'),
        `db_path = "${staleDbPath.replace(/\\/g, '\\\\')}"\n`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(homeConfigDir, 'ecc2.toml'),
        `db_path = "${homeDbPath.replace(/\\/g, '\\\\')}"\n`,
        'utf8'
      );

      const config = resolveControlPaneConfig({
        cwd: tempDir,
        env: { HOME: homeDir },
      });

      assert.strictEqual(config.dbPath, homeDbPath);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (await test('shows configured connectors even when the SQLite database is missing', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-control-pane-missing-db-'));

    try {
      const snapshot = await buildControlPaneSnapshot({
        repoRoot: path.join(__dirname, '..', '..'),
        dbPath: path.join(tempDir, 'missing.db'),
        config: {
          memoryConnectors: {
            hermes_workspace: {
              kind: 'markdown_directory',
              path: '/notes/hermes',
              recurse: true,
            },
          },
        },
      });

      assert.strictEqual(snapshot.database.exists, false);
      assert.strictEqual(snapshot.connectors.length, 1);
      assert.strictEqual(snapshot.connectors[0].name, 'hermes_workspace');
      assert.strictEqual(snapshot.connectors[0].syncedSources, 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
