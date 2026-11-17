'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const initSqlJs = require('sql.js');
const { buildControlPaneSnapshot, resolveControlPaneConfig } = require('../../scripts/lib/control-pane/state');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-control-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const workspace = path.join(home, 'workspace');
  const project = path.join(workspace, 'app');
  const nested = path.join(project, 'src');
  fs.mkdirSync(nested, { recursive: true });
  return { root, home, workspace, project, nested, env: { HOME: home, USERPROFILE: home } };
}

function writeConfig(directory, content, legacy = false) {
  const file = path.join(directory, ...(legacy ? ['.claude', 'ecc2.toml'] : ['ecc2.toml']));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test('nearest project files override global defaults without inheriting parent project settings', t => {
  const f = fixture(t);
  const globalFile = writeConfig(f.home, 'db_path = "global.db"\n[memory_connectors.global]\nkind = "markdown_directory"\n', true);
  writeConfig(f.workspace, 'db_path = "parent.db"\n[memory_connectors.parent]\nkind = "markdown_directory"\n');
  const legacyFile = writeConfig(f.project, 'db_path = "legacy.db"\n[memory_connectors.local]\nkind = "markdown_directory"\nrecurse = true\npath = "legacy"\n', true);
  const primaryFile = writeConfig(f.project, 'db_path = "project.db"\n[memory_connectors.local]\npath = "primary"\n');
  const config = resolveControlPaneConfig({ cwd: f.nested, env: f.env });
  assert.equal(config.dbPath, 'project.db');
  assert.deepEqual(config.configPaths, [globalFile, legacyFile, primaryFile]);
  assert.deepEqual(Object.keys(config.memoryConnectors), ['global', 'local']);
  assert.deepEqual(config.memoryConnectors.local, { kind: 'markdown_directory', recurse: true, path: 'primary' });
});

test('walking from a nested directory stops at the first project configuration layer', t => {
  const f = fixture(t);
  writeConfig(f.home, 'db_path = "ancestor.db"\n');
  const nearest = writeConfig(f.workspace, 'db_path = "workspace.db"\n', true);
  const config = resolveControlPaneConfig({ cwd: f.nested, env: f.env });
  assert.equal(config.dbPath, 'workspace.db');
  assert.deepEqual(config.configPaths, [nearest]);
});

test('an unrelated malformed parent config does not break a valid nested project', t => {
  const f = fixture(t);
  writeConfig(f.workspace, 'not valid TOML [');
  const local = writeConfig(f.project, 'db_path = "local.db"\n');
  const config = resolveControlPaneConfig({ cwd: f.nested, env: f.env });
  assert.equal(config.dbPath, 'local.db');
  assert.deepEqual(config.configPaths, [local]);
});

test('global priority, explicit files, and database overrides keep their existing behavior', t => {
  const f = fixture(t);
  const appSupport = path.join(f.home, 'Library', 'Application Support', 'ecc2', 'config.toml');
  fs.mkdirSync(path.dirname(appSupport), { recursive: true });
  fs.writeFileSync(appSupport, 'db_path = "app-support.db"\n');
  const operator = writeConfig(f.home, 'db_path = "operator.db"\n', true);
  const global = resolveControlPaneConfig({ cwd: f.nested, env: f.env });
  assert.equal(global.dbPath, 'operator.db');
  assert.deepEqual(global.configPaths, [appSupport, operator]);
  writeConfig(f.project, 'db_path = "project.db"\n');
  const explicit = writeConfig(path.join(f.root, 'explicit'), 'db_path = "explicit.db"\n');
  const config = resolveControlPaneConfig({ cwd: f.nested, env: f.env, configPath: explicit });
  assert.equal(config.dbPath, 'explicit.db');
  assert.deepEqual(config.configPaths, [explicit]);
  const env = { ...f.env, ECC2_DB_PATH: 'environment.db', ECC_STATE_DB_PATH: 'environment-state.db' };
  assert.equal(resolveControlPaneConfig({ cwd: f.nested, env }).dbPath, 'environment.db');
  const options = resolveControlPaneConfig({ cwd: f.nested, env, dbPath: 'option.db', stateDbPath: 'option-state.db' });
  assert.equal(options.dbPath, 'option.db');
  assert.equal(options.stateDbPath, 'option-state.db');
});

test('the public control-pane snapshot loads sessions from the nearest project database', async t => {
  const f = fixture(t);
  const SQL = await initSqlJs();
  for (const [directory, id] of [[f.workspace, 'parent-session'], [f.project, 'project-session']]) {
    const dbPath = path.join(directory, 'sessions.db');
    const db = new SQL.Database();
    try {
      db.run('CREATE TABLE sessions (id TEXT, state TEXT, created_at TEXT, updated_at TEXT)');
      db.run('INSERT INTO sessions VALUES (?, ?, ?, ?)', [id, 'running', '2026-11-17', '2026-11-17']);
      fs.writeFileSync(dbPath, Buffer.from(db.export()));
    } finally {
      db.close();
    }
    writeConfig(directory, `db_path = ${JSON.stringify(dbPath)}\n`);
  }
  const snapshot = await buildControlPaneSnapshot({ cwd: f.nested, env: f.env });
  assert.equal(snapshot.dbPath, path.join(f.project, 'sessions.db'));
  assert.equal(snapshot.database.exists, true);
  assert.deepEqual(snapshot.sessions.map(session => session.id), ['project-session']);
  assert.equal(snapshot.summary.runningSessions, 1);
});
