'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClaudeHistoryAdapter } = require('../../scripts/lib/session-adapters/claude-history');
const aliases = require('../../scripts/lib/session-aliases');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-history-alias-read-')));
const data = path.join(root, '.claude');
const sessions = path.join(data, 'session-data');
fs.mkdirSync(sessions, { recursive: true });
const id = 'a1111111-e29b-41d4-a716-446655440000';
const prefix = id.slice(0, 8);
const name = `2026-10-10-${id}-session.tmp`;
const sessionA = path.join(sessions, name);
const sessionB = path.join(sessions, '2026-10-10-b2222222-session.tmp');
for (const [file, label] of [[sessionA, 'A'], [sessionB, 'B']]) {
  fs.writeFileSync(file, `# History ${label}\n**Worktree:** /fixture/project\n\n### Completed\n- [x] history-${label}-sentinel\n`);
}
const aliasPath = path.join(data, 'session-aliases.json');
const collisionNames = ['a', prefix, id, 'kept'];
const aliasBytes = JSON.stringify({ version: '1.0', aliases: Object.fromEntries(
  collisionNames.map(alias => [alias, { sessionPath: sessionB }])) });
fs.writeFileSync(aliasPath, aliasBytes);
const keys = ['HOME', 'USERPROFILE', 'ECC_AGENT_DATA_HOME'];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
Object.assign(process.env, { HOME: root, USERPROFILE: root, ECC_AGENT_DATA_HOME: data });
const recording = path.join(root, 'canonical-snapshot.json');
const publications = [];
const adapter = createClaudeHistoryAdapter({ persistCanonicalSnapshotImpl(snapshot) {
  publications.push(snapshot);
  fs.writeFileSync(recording, JSON.stringify(snapshot));
} });
let passed = 0;
let failed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
function denyAliasReads(code, run) {
  const originalRead = fs.readFileSync;
  const expected = Object.assign(new Error('injected unreadable alias store'), { code });
  fs.readFileSync = function (file) {
    if (file === aliasPath) throw expected;
    return originalRead.apply(this, arguments);
  };
  try { run(expected); }
  finally { fs.readFileSync = originalRead; }
  assert.strictEqual(fs.readFileSync(aliasPath, 'utf8'), aliasBytes);
  assert.deepStrictEqual(fs.readdirSync(data).sort(), ['session-aliases.json', 'session-data']);
}
try {
  test('readable aliases select B despite conflicting A prefixes and UUIDs', () => {
    for (const alias of collisionNames) {
      const snapshot = adapter.open(`claude:${alias}`).getSnapshot();
      assert.deepStrictEqual(snapshot.session.sourceTarget, { type: 'claude-alias', value: alias });
      assert.strictEqual(snapshot.workers[0].artifacts.sessionFile, sessionB);
      assert.strictEqual(JSON.parse(fs.readFileSync(recording, 'utf8')).workers[0].artifacts.sessionFile, sessionB);
    }
    assert.strictEqual(fs.readFileSync(aliasPath, 'utf8'), aliasBytes);
  });
  for (const code of ['EACCES', 'EPERM']) {
    test(`${code} alias collisions preserve errors and never publish another conversation`, () => {
      adapter.open('claude:a').getSnapshot();
      const before = fs.readFileSync(recording, 'utf8');
      publications.length = 0;
      denyAliasReads(code, expected => {
        for (const target of [...collisionNames, 'does-not-exist']) {
          let thrown;
          try { adapter.open(`claude:${target}`).getSnapshot(); } catch (error) { thrown = error; }
          assert.strictEqual(publications.length, 0, 'Unresolved alias identity must not publish any snapshot');
          assert.strictEqual(fs.readFileSync(recording, 'utf8'), before);
          assert.strictEqual(thrown, expected);
        }
        assert.throws(() => aliases.setAlias('added', '/new'), error => error === expected);
      });
    });
    test(`${code} still permits an exact filename with truthful history identity`, () => {
      publications.length = 0;
      denyAliasReads(code, () => {
        const snapshot = adapter.open(`claude:${name}`).getSnapshot();
        assert.deepStrictEqual(snapshot.session.sourceTarget, { type: 'claude-history', value: name });
        assert.strictEqual(snapshot.workers[0].artifacts.sessionFile, sessionA);
        assert.ok(snapshot.workers[0].outputs.summary.includes('history-A-sentinel'));
        assert.strictEqual(publications.length, 1);
        assert.strictEqual(JSON.parse(fs.readFileSync(recording, 'utf8')).workers[0].artifacts.sessionFile, sessionA);
      });
    });
  }
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`Results: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
