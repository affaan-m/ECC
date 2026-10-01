/** Exercise the published plugin using OpenCode's native callback envelopes. */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function main() {
  const root = path.resolve(__dirname, '..');
  const compiler = require.resolve('typescript/bin/tsc');
  const build = spawnSync(process.execPath, [compiler, '-p', path.join(root, '.opencode/tsconfig.json')], {
    cwd: root, encoding: 'utf8', timeout: 30000
  });
  assert.ifError(build.error);
  assert.strictEqual(build.status, 0, build.stderr || build.stdout);
  const { ECCHooksPlugin } = await import(pathToFileURL(path.join(root, '.opencode/dist/plugins/ecc-hooks.js')).href);
  const store = await import(pathToFileURL(path.join(root, '.opencode/dist/plugins/lib/changed-files-store.js')).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-opencode-native-'));
  const previousProfile = process.env.ECC_HOOK_PROFILE;
  const previousDisabled = process.env.ECC_DISABLED_HOOKS;
  let passed = 0;
  let failed = 0;
  try {
    process.env.ECC_HOOK_PROFILE = 'strict';
    delete process.env.ECC_DISABLED_HOOKS;
    const logs = [];
    const shell = () => ({ then: (_resolve, reject) => reject(new Error('fixture shell disabled')), text: async () => '' });
    const hooks = await ECCHooksPlugin({
      client: { app: { log: ({ body }) => { logs.push(body); return Promise.resolve(); } } },
      $: shell, directory: dir, worktree: dir
    });
    const emit = (type, properties = {}) => hooks.event({ event: { type, properties } });
    async function test(name, fn) {
      store.clearChanges();
      logs.length = 0;
      try { await fn(); passed++; console.log(`  ✓ ${name}`); }
      catch (error) { failed++; console.error(`  ✗ ${name}: ${error.message}`); }
    }
    await test('native session.created reaches the session-start handler', async () => {
      await emit('session.created', { info: { id: 'session-a' } });
      assert.ok(logs.some(x => /Session started/.test(x.message)));
    });
    await test('native file.edited translates the file field', async () => {
      await emit('file.edited', { file: 'src/example.ts' });
      assert.ok(store.getChanges().has(path.normalize('src/example.ts')));
    });
    await test('native watcher add and unlink retain their change types', async () => {
      await emit('file.watcher.updated', { file: 'new.txt', event: 'add' });
      await emit('file.watcher.updated', { file: 'gone.txt', event: 'unlink' });
      assert.strictEqual(store.getChanges().get('new.txt'), 'added');
      assert.strictEqual(store.getChanges().get('gone.txt'), 'deleted');
    });
    await test('native todo status drives progress reporting', async () => {
      await emit('todo.updated', { sessionID: 'session-a', todos: [
        { content: 'done', status: 'completed' }, { content: 'waiting', status: 'pending' }
      ] });
      assert.ok(logs.some(x => /Progress: 1\/2/.test(x.message)));
    });
    await test('native idle runs the audit and the last tracked session clears workspace changes', async () => {
      await emit('file.edited', { file: 'src/idle.ts' });
      await emit('session.idle', { sessionID: 'session-a' });
      assert.ok(logs.some(x => /Session idle/.test(x.message)));
      await emit('session.deleted', { info: { id: 'session-a' } });
      assert.strictEqual(store.hasChanges(), false);
    });
    await test('native before output.args classifies a new write as added', async () => {
      await hooks['tool.execute.before']({ tool: 'write', sessionID: 'session-a', callID: 'write-a' }, {
        args: { filePath: 'new.md' }
      });
      await hooks['tool.execute.after']({ tool: 'write', sessionID: 'session-a', callID: 'write-a', args: { filePath: 'new.md' } }, {});
      assert.strictEqual(store.getChanges().get('new.md'), 'added');
    });
    await test('native bash command arguments trigger push and PR reminders', async () => {
      await hooks['tool.execute.before']({ tool: 'bash', sessionID: 'session-a', callID: 'bash-a' }, {
        args: { command: 'git push' }
      });
      await hooks['tool.execute.after']({ tool: 'bash', sessionID: 'session-a', callID: 'bash-b', args: { command: 'gh pr create' } }, {});
      assert.ok(logs.some(x => /review changes before pushing/.test(x.message)));
      assert.ok(logs.some(x => /PR created/.test(x.message)));
    });
    await test('deleting session A preserves session B pending writes and audit files', async () => {
      await emit('session.created', { info: { id: 'session-a' } });
      await emit('session.created', { info: { id: 'session-b' } });
      await hooks['tool.execute.before']({ tool: 'write', sessionID: 'session-b', callID: 'write-b' }, {
        args: { filePath: 'session-b.md' }
      });
      await emit('file.edited', { file: 'src/session-b.ts' });
      await emit('session.deleted', { info: { id: 'session-a' } });
      assert.strictEqual(store.getChanges().get(path.normalize('src/session-b.ts')), 'modified');
      await hooks['tool.execute.after']({ tool: 'write', sessionID: 'session-b', callID: 'write-b', args: { filePath: 'session-b.md' } }, {});
      assert.strictEqual(store.getChanges().get('session-b.md'), 'added');
      await emit('session.idle', { sessionID: 'session-b' });
      assert.ok(logs.some(x => /Session idle/.test(x.message)));
      await emit('session.deleted', { info: { id: 'session-b' } });
      assert.strictEqual(store.hasChanges(), false);
      fs.writeFileSync(path.join(dir, 'session-b.md'), 'committed fixture');
      await emit('session.created', { info: { id: 'session-c' } });
      await hooks['tool.execute.before']({ tool: 'write', sessionID: 'session-c', callID: 'later-write' }, { args: { filePath: 'session-b.md' } });
      await hooks['tool.execute.after']({ tool: 'write', sessionID: 'session-c', callID: 'later-write', args: { filePath: 'session-b.md' } }, {});
      assert.strictEqual(store.getChanges().get('session-b.md'), 'modified');
      await emit('session.deleted', { info: { id: 'session-c' } });
    });
    await test('new files remain added through native edits, watcher changes and later writes', async () => {
      await emit('file.watcher.updated', { file: 'new.txt', event: 'add' });
      await emit('file.edited', { file: 'new.txt' });
      await emit('file.watcher.updated', { file: 'new.txt', event: 'change' });
      fs.writeFileSync(path.join(dir, 'new.txt'), 'new');
      await hooks['tool.execute.before']({ tool: 'write', sessionID: 'session-b', callID: 'rewrite' }, { args: { filePath: 'new.txt' } });
      await hooks['tool.execute.after']({ tool: 'write', sessionID: 'session-b', callID: 'rewrite', args: { filePath: 'new.txt' } }, {});
      assert.deepStrictEqual(store.getChangedPaths('added'), [{ path: 'new.txt', changeType: 'added' }]);
      await emit('file.watcher.updated', { file: 'new.txt', event: 'unlink' });
      assert.strictEqual(store.getChanges().get('new.txt'), 'deleted');
    });
    await test('malformed native payloads are rejected without coercion or partial todo totals', async () => {
      for (const event of [null, {}, { type: 'file.edited', properties: null },
        { type: 'file.watcher.updated', properties: { file: 'bad.txt', event: 'unknown' } },
        { type: 'session.deleted', properties: { info: {} } },
        { type: 'todo.updated', properties: { sessionID: 'a', todos: [{ content: {}, status: 'completed' }, { content: 'valid', status: 'pending' }] } }
      ]) await hooks.event({ event });
      assert.deepStrictEqual(logs, []);
      assert.strictEqual(store.hasChanges(), false);
    });
    await test('unknown native events have no effect', async () => {
      await emit('message.updated', { info: {} });
      assert.deepStrictEqual(logs, []);
      assert.strictEqual(store.hasChanges(), false);
    });
  } finally {
    store.clearChanges();
    if (previousProfile === undefined) delete process.env.ECC_HOOK_PROFILE;
    else process.env.ECC_HOOK_PROFILE = previousProfile;
    if (previousDisabled === undefined) delete process.env.ECC_DISABLED_HOOKS;
    else process.env.ECC_DISABLED_HOOKS = previousDisabled;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\nPassed: ${passed}\nFailed: ${failed}`);
  process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
