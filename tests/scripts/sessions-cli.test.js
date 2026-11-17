'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { parseArgs } = require('../../scripts/sessions-cli');
const { createStateStore } = require('../../scripts/lib/state-store');

const SCRIPT = path.resolve(__dirname, '../../scripts/sessions-cli.js');

async function withTempHome(fn) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-sessions-cli-'));
  try {
    await fn(homeDir);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function runCli(homeDir, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: homeDir,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
  });
}

test('requires a value for every db and limit option', () => {
  for (const flag of ['--db', '--limit']) {
    for (const args of [[flag], [flag, '--json'], [flag, '-h'], [flag, 'value', flag]]) {
      assert.throws(() => parseArgs(['node', SCRIPT, ...args]), { message: `Missing value for ${flag}` });
    }
  }
  const parsed = parseArgs(['node', SCRIPT, '--db', 'state.db', '--limit', '2', '--json', 'demo']);
  assert.equal(parsed.dbPath, 'state.db');
  assert.equal(parsed.limit, '2');
  assert.equal(parsed.json, true);
  assert.equal(parsed.sessionId, 'demo');
});

test('rejects incomplete options without creating a database', async () => {
  await withTempHome(async homeDir => {
    for (const flag of ['--db', '--limit']) {
      for (const args of [[flag], [flag, '--json'], [flag, '-h']]) {
        const result = runCli(homeDir, args);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, new RegExp(`Missing value for ${flag}`));
        assert.deepEqual(fs.readdirSync(homeDir), []);
      }
    }
    assert.match(runCli(homeDir, ['--help']).stdout, /Usage:/);
    assert.deepEqual(fs.readdirSync(homeDir), []);
  });
});

test('retains valid database and limit options for listing and inspecting sessions', async () => {
  await withTempHome(async homeDir => {
    const dbPath = path.join(homeDir, 'state.db');
    const empty = runCli(homeDir, ['--db', dbPath]);
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stdout, /No sessions found/);
    const store = await createStateStore({ dbPath });
    try {
      store.upsertSession({
        id: 'demo', adapterId: 'claude-history', harness: 'claude', state: 'recorded', repoRoot: homeDir,
        startedAt: '2026-03-15T08:00:00Z', endedAt: '2026-03-15T09:00:00Z',
        snapshot: { workers: [{ id: 'worker', state: 'active', branch: 'main', worktree: homeDir }, {}] },
      });
      store.upsertSession({ id: 'empty', adapterId: 'claude-history', harness: 'claude', state: 'recorded' });
      store.insertSkillRun({
        id: 'run', skillId: 'demo-skill', skillVersion: 'v1', sessionId: 'demo', taskDescription: 'A task', outcome: 'success',
      });
      store.insertDecision({ id: 'choice', sessionId: 'demo', title: 'A choice', rationale: 'A reason', status: 'active' });
    } finally {
      store.close();
    }
    const list = runCli(homeDir, ['--db', dbPath, '--limit', '1', '--json']);
    assert.equal(list.status, 0, list.stderr);
    assert.equal(JSON.parse(list.stdout).sessions.length, 1);
    const human = runCli(homeDir, ['--db', dbPath]);
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stdout, /Total sessions: 2/);
    const detail = runCli(homeDir, ['demo', '--db', dbPath]);
    assert.equal(detail.status, 0, detail.stderr);
    assert.match(detail.stdout, /Workers: 2/);
    assert.match(detail.stdout, /Task: A task/);
    assert.match(detail.stdout, /Title: A choice/);
    const emptyDetail = runCli(homeDir, ['empty', '--db', dbPath, '--json']);
    assert.equal(emptyDetail.status, 0, emptyDetail.stderr);
    assert.deepEqual(JSON.parse(emptyDetail.stdout).workers, []);
    assert.match(runCli(homeDir, ['empty', '--db', dbPath]).stdout, /Workers: 0/);
    assert.match(runCli(homeDir, ['missing', '--db', dbPath]).stderr, /Session not found: missing/);
  });
});
