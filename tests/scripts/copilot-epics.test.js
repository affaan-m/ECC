'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO, 'scripts/copilot-epics.js');
let passed = 0;
let failed = 0;

function exec(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 20000 });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc epic copilot-'));
  const checkout = path.join(root, 'checkout');
  const cwd = path.join(root, 'workspace');
  fs.mkdirSync(path.join(checkout, 'scripts/lib'), { recursive: true });
  fs.mkdirSync(cwd);
  for (const p of ['scripts/github-coordination.js', 'scripts/lib/github-coordination.js', 'scripts/lib/github-coordination', 'scripts/lib/state-store', 'schemas/state-store.schema.json']) {
    fs.cpSync(path.join(REPO, p), path.join(checkout, p), { recursive: true });
  }
  fs.writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ name: 'ecc-universal', version: '2.2.3' }));
  fs.writeFileSync(path.join(checkout, '.gitignore'), 'node_modules/\n');
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(checkout, 'node_modules'), 'dir');
  exec('git', ['init', '-q'], checkout);
  exec('git', ['add', '.'], checkout);
  exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Reviewed fixture'], checkout);
  const commit = exec('git', ['rev-parse', 'HEAD'], checkout);
  const dataHome = path.join(root, 'copilot');
  const log = path.join(root, 'gh.log');
  const data = path.join(root, 'issues.json');
  const shim = path.join(root, 'gh-shim.js');
  fs.writeFileSync(shim, `const fs=require('fs'); const args=process.argv.slice(2); fs.appendFileSync(process.env.EPIC_TEST_LOG,JSON.stringify(args)+'\\n');
const issues=JSON.parse(fs.readFileSync(process.env.EPIC_TEST_DATA,'utf8'));
if(args[0]==='api'&&args[1]==='user'){process.stdout.write('test-actor');}
else if(args[0]==='issue'&&args[1]==='view'){process.stdout.write(JSON.stringify(issues.find(i=>i.number===Number(args[2]))));}
else if(args[0]==='issue'&&args[1]==='list'){process.stdout.write(JSON.stringify(issues));}
else if(args[0]==='issue'&&['edit','comment'].includes(args[1])){process.stdout.write('{}');}
else{process.stderr.write('unexpected');process.exitCode=3;}`);
  const backend = require(path.join(REPO, 'scripts/lib/github-coordination'));
  const state = { ...backend.defaultCoordinationState({ number: 10, body: '- [ ] Implement\nDepends on #11', labels: ['epic'] }), status: 'blocked', owner: 'test-actor', review: 'approved', validation: 'passed' };
  const issue = { number: 10, title: 'Epic fixture', body: '# Epic\n- [ ] Implement\n' + backend.renderCoordinationState(state), labels: [{ name: 'epic' }], state: 'OPEN', url: 'https://github.com/example/project/issues/10', author: { login: 'test-actor' } };
  fs.writeFileSync(data, JSON.stringify([issue, { number: 11, title: 'Dependency', body: '', labels: [], state: 'CLOSED' }]));
  const env = { ...process.env, ECC_COPILOT_CHECKOUT_ROOT: checkout, ECC_COPILOT_CHECKOUT_COMMIT: commit, COPILOT_HOME: dataHome,
    ECC_GH_SHIM: shim, EPIC_TEST_LOG: log, EPIC_TEST_DATA: data };
  const run = (args, overrides = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 30000 });
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  return { root, checkout, cwd, dataHome, env, run, calls, data };
}

function test(name, action) {
  const f = fixture();
  try { action(f); passed++; console.log(`  PASS ${name}`); }
  catch (error) { failed++; console.error(`  FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(f.root, { recursive: true, force: true }); }
}

test('all seven epic previews execute canonical policies without GitHub or cache writes', f => {
  for (const action of ['claim', 'decompose', 'publish', 'review', 'sync', 'unblock', 'validate']) {
    const result = f.run([action, '--repo', 'example/project', ...(['sync', 'unblock'].includes(action) ? [] : ['--issue', '10'])]);
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.mode, 'preview');
    assert.strictEqual(output.action, action);
    assert.ok(output.result);
  }
  assert.ok(f.calls().every(args => !['edit', 'comment'].includes(args[1])));
  assert.ok(!fs.existsSync(f.dataHome), 'previews must not materialize a local SQLite cache');
});

test('exact apply scope changes canonical GitHub state and creates isolated SQLite cache', f => {
  const result = f.run(['claim', '--repo', 'example/project', '--issue', '10', '--actor', 'test-actor', '--apply', '--approve', 'claim:example/project#10']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(JSON.parse(result.stdout).result.status, 'claimed');
  assert.ok(f.calls().some(args => args[1] === 'edit'));
  assert.ok(f.calls().some(args => args[1] === 'comment'));
  const projects = path.join(f.dataHome, 'ecc', 'projects');
  const workspace = path.join(projects, fs.readdirSync(projects)[0]);
  assert.ok(fs.existsSync(path.join(workspace, 'coordination.db')));
  assert.ok(!fs.existsSync(path.join(f.root, '.claude')));
  assert.ok(!fs.existsSync(path.join(f.cwd, '.claude')));
});

test('apply fails before any gh call when approval is missing, foreign or ambiguous', f => {
  for (const extra of [[], ['--approve', 'publish:example/project#10'], ['--approve', 'claim:other/repo#10'], ['--approve', 'claim:example/project#11']]) {
    const result = f.run(['claim', '--repo', 'example/project', '--issue', '10', '--apply', ...extra]);
    assert.notStrictEqual(result.status, 0);
  }
  assert.deepStrictEqual(f.calls(), []);
  assert.ok(!fs.existsSync(f.dataHome));
});

test('repo, issue, actor and operation flags reject traversal/injection before execution', f => {
  for (const args of [[], ['unknown'], ['claim', '--repo', '--help', '--issue', '10'], ['claim', '--repo', 'evil/../repo', '--issue', '10'], ['claim', '--repo', 'example/project', '--issue', '10;touch pwn'], ['claim', '--repo', 'example/project', '--issue', '10', '--db', '/tmp/escape'], ['sync', '--repo', 'example/project', '--limit', '1001']]) {
    assert.notStrictEqual(f.run(args).status, 0);
  }
  assert.deepStrictEqual(f.calls(), []);
});

test('claim actor must be authenticated principal and collection apply needs repo-wide approval', f => {
  const bad = f.run(['claim', '--repo', 'example/project', '--issue', '10', '--actor', 'other-user', '--apply', '--approve', 'claim:example/project#10']);
  assert.notStrictEqual(bad.status, 0);
  assert.ok(f.calls().every(args => args[0] === 'api'));
  const good = f.run(['sync', '--repo', 'example/project', '--apply', '--approve', 'sync:example/project#all']);
  assert.strictEqual(good.status, 0, good.stderr);
  assert.strictEqual(JSON.parse(good.stdout).result.count, 2);
});

test('publish preserves canonical independent review gate', f => {
  const issues = JSON.parse(fs.readFileSync(f.data, 'utf8'));
  issues[0].body = issues[0].body.replace('"review": "approved"', '"review": "requested"');
  fs.writeFileSync(f.data, JSON.stringify(issues));
  const result = f.run(['publish', '--repo', 'example/project', '--issue', '10', '--apply', '--approve', 'publish:example/project#10']);
  assert.notStrictEqual(result.status, 0);
  assert.ok(f.calls().every(args => !['edit', 'comment'].includes(args[1])));
});

test('symlinked Copilot storage is rejected before GitHub mutation', f => {
  fs.mkdirSync(f.dataHome); const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.dataHome, 'ecc'), 'dir');
  const result = f.run(['validate', '--repo', 'example/project', '--issue', '10', '--apply', '--approve', 'validate:example/project#10']);
  assert.notStrictEqual(result.status, 0);
  assert.ok(f.calls().every(args => !['edit', 'comment'].includes(args[1])));
  assert.deepStrictEqual(fs.readdirSync(outside), []);
});

test('projection binds each command to actual helper and never invokes Claude storage', () => {
  const projection = require('../../scripts/lib/install/copilot-epics');
  for (const action of ['claim', 'decompose', 'publish', 'review', 'sync', 'unblock', 'validate']) {
    const body = projection.getNativeBody('epic-' + action);
    assert.match(body, new RegExp(`copilot-epics\\.js ${action} `));
    assert.match(body, /--approve/);
    assert.doesNotMatch(body, /\.claude/);
  }
  assert.strictEqual(projection.getNativeBody('other'), undefined);
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
