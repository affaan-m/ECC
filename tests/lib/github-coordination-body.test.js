'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { editIssue, commentIssue, getIssue, runGhJson } = require('../../scripts/lib/github-coordination/gh-api');
const { extractCoordinationState } = require('../../scripts/lib/github-coordination/parsing');
const { createStateStore } = require('../../scripts/lib/state-store');

const LARGE_BODY = '# Epic\n\n' + '说明'.repeat(23000);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-coordination-body-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const statePath = path.join(root, 'remote.json');
  const callsPath = path.join(root, 'calls.jsonl');
  const shim = path.join(root, 'gh.cjs');
  const state = { number: 42, title: 'Fixture epic', body: LARGE_BODY,
    url: 'https://github.com/example/project/issues/42', state: 'OPEN',
    labels: [{ name: 'epic' }], author: { login: 'test-author' }, updatedAt: '2026-01-01T00:00:00Z' };
  fs.writeFileSync(statePath, JSON.stringify(state));
  fs.writeFileSync(shim, `const fs = require('node:fs');
const args = process.argv.slice(2);
const input = fs.readFileSync(0, 'utf8');
const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const body = value('--body-file') === '-' ? input : value('--body');
fs.appendFileSync(process.env.ECC_BODY_TEST_CALLS, JSON.stringify({ args, input, body,
  tokenPresent: Boolean(process.env.GITHUB_TOKEN) }) + '\\n');
if (args[0] === 'fail') { console.error('fixture failure'); process.exit(7); }
if (args[0] === 'empty') process.exit(0);
if (args[0] === 'malformed') { process.stdout.write('invalid JSON'); process.exit(0); }
const state = JSON.parse(fs.readFileSync(process.env.ECC_BODY_TEST_STATE, 'utf8'));
if (args[0] === 'issue' && args[1] === 'view') process.stdout.write(JSON.stringify(state));
else if (args[0] === 'issue' && args[1] === 'edit') {
  if (body !== undefined) state.body = body;
  fs.writeFileSync(process.env.ECC_BODY_TEST_STATE, JSON.stringify(state));
  process.stdout.write('updated');
} else if (args[0] === 'issue' && args[1] === 'comment') process.stdout.write('commented');
else { console.error('Unexpected fixture command'); process.exit(3); }
`);
  const env = { ECC_GH_SHIM: shim, ECC_BODY_TEST_STATE: statePath, ECC_BODY_TEST_CALLS: callsPath };
  const calls = () => fs.existsSync(callsPath)
    ? fs.readFileSync(callsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  // Library calls are synchronous; never retain these overrides across an await.
  const invoke = fn => {
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    try { return fn(); } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
  return { root, state, statePath, env, calls, invoke };
}

function withoutLargeError(fn) {
  try { return fn(); } catch (error) {
    // The old spawn error repeats the entire issue body; retain its useful tail.
    assert.fail(error.message.slice(-240));
  }
}

for (const action of ['edit', 'comment']) {
  test('large Unicode ' + action + ' body reaches the subprocess intact', t => {
    const f = fixture(t);
    const result = withoutLargeError(() => f.invoke(() => action === 'edit'
      ? editIssue('example/project', 42, { body: LARGE_BODY })
      : commentIssue('example/project', 42, LARGE_BODY)));
    assert.equal(result, action === 'edit' ? 'updated' : 'commented');
    const [call] = f.calls();
    assert.equal(call.body, LARGE_BODY);
    assert.ok(Math.max(...call.args.map(argument => Buffer.byteLength(argument))) < 4096,
      'The body must not consume the operating system argument budget');
  });
}

test('small, empty and multiline bodies preserve exact text for both operations', t => {
  const f = fixture(t);
  const bodies = ['', 'plain text', '  spaces\r\n中文 \u{1F9EA}\r\n', '--not-a-flag\n$& $$ `literal` "quoted"\n'];
  f.invoke(() => {
    for (const body of bodies) {
      editIssue('example/project', 42, { body });
      commentIssue('example/project', 42, body);
    }
  });
  assert.deepEqual(f.calls().map(call => call.body), bodies.flatMap(body => [body, body]));
});

test('body updates preserve all other edit options', t => {
  const f = fixture(t);
  const options = { body: 'text', addLabels: ['ready', 'needs review'], removeLabels: ['old'],
    title: 'New title', assignee: 'operator' };
  f.invoke(() => editIssue('example/project', 42, options));
  const [call] = f.calls();
  for (const [flag, value] of [['--title', options.title], ['--add-assignee', options.assignee], ['--remove-label', 'old']]) {
    assert.equal(call.args[call.args.indexOf(flag) + 1], value);
  }
  assert.deepEqual(call.args.flatMap((argument, index) => argument === '--add-label' ? [call.args[index + 1]] : []), options.addLabels);
  assert.deepEqual(options, { body: 'text', addLabels: ['ready', 'needs review'], removeLabels: ['old'],
    title: 'New title', assignee: 'operator' });
});

test('an edit without a body leaves the existing body alone', t => {
  const f = fixture(t);
  f.invoke(() => editIssue('example/project', 42, { title: 'Only a title' }));
  const [call] = f.calls();
  assert.equal(call.body, undefined);
  assert.equal(call.input, '');
  assert.equal(JSON.parse(fs.readFileSync(f.statePath, 'utf8')).body, LARGE_BODY);
});

test('read commands and subprocess failures retain their contracts', t => {
  const f = fixture(t);
  f.invoke(() => {
    assert.deepEqual(runGhJson(['issue', 'view', '42', '--repo', 'example/project']), f.state);
    assert.throws(() => runGhJson(['fail']), /fixture failure/);
    assert.equal(runGhJson(['empty']), null);
    assert.throws(() => runGhJson(['malformed']), /returned invalid JSON/);
    fs.writeFileSync(f.statePath, 'null');
    assert.throws(() => getIssue('example/project', 42), /Unable to load issue/);
  });
  assert.equal(f.calls()[0].input, '');
});

test('body input preserves the existing optional GitHub token filtering', t => {
  const f = fixture(t);
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ecc-synthetic-token';
  try {
    f.invoke(() => {
      editIssue('example/project', 42, { body: 'text', stripGithubToken: true });
      commentIssue('example/project', 42, 'text');
    });
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  }
  assert.deepEqual(f.calls().map(call => call.tokenPresent), [false, true]);
  assert.deepEqual(f.calls().map(call => call.body), ['text', 'text']);
});

test('a missing GitHub executable remains a reported subprocess failure', t => {
  const f = fixture(t);
  const previous = process.env.PATH;
  const emptyPath = path.join(f.root, 'no-programs');
  fs.mkdirSync(emptyPath);
  f.invoke(() => {
    delete process.env.ECC_GH_SHIM;
    process.env.PATH = emptyPath;
    try {
      assert.throws(() => editIssue('example/project', 42, { body: 'text' }), /failed:.*ENOENT/);
    } finally {
      if (previous === undefined) delete process.env.PATH;
      else process.env.PATH = previous;
    }
  });
  assert.deepEqual(f.calls(), []);
});

for (const dryRun of [false, true]) {
  test('public claim with a large body ' + (dryRun ? 'previews without writes' : 'writes state and its audit comment'), async t => {
    const f = fixture(t);
    const dbPath = path.join(f.root, 'state.db');
    const env = { ...process.env, ...f.env };
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    const child = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/github-coordination.js'),
      'claim', '42', '--repo', 'example/project', '--actor', 'test-author', '--db', dbPath, '--json',
      ...(dryRun ? ['--dry-run'] : [])], { cwd: f.root, env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 10000 });
    assert.equal(child.status, 0, child.stderr.slice(-240));
    assert.equal(JSON.parse(child.stdout).status, 'claimed');
    const calls = f.calls();
    assert.deepEqual(calls.map(call => call.args[1]), dryRun ? ['view'] : ['view', 'edit', 'comment']);
    const storedIssue = JSON.parse(fs.readFileSync(f.statePath, 'utf8'));
    const store = await createStateStore({ dbPath });
    try {
      const items = store.listWorkItems({ limit: 10 }).items;
      if (dryRun) {
        assert.equal(storedIssue.body, LARGE_BODY);
        assert.deepEqual(items, []);
      } else {
        assert.ok(storedIssue.body.startsWith(LARGE_BODY + '\n\n'));
        const state = extractCoordinationState(storedIssue.body);
        assert.equal(state.owner, 'test-author');
        assert.equal(state.status, 'claimed');
        assert.equal(items.length, 1);
        assert.deepEqual(items[0].metadata.coordination, state);
        assert.ok(calls[2].body.includes('ECC coordination claimed'));
      }
    } finally { store.close(); }
  });
}
