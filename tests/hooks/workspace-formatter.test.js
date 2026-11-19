'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { test } = require('node:test');
const { clearCaches } = require('../../scripts/lib/resolve-formatter');

function loadHook(name, calls) {
  const filename = path.resolve(__dirname, '../../scripts/hooks', name);
  const nativeRequire = createRequire(filename);
  const record = (bin, args, options) => {
    calls.push({ bin, args: Array.from(args), cwd: options.cwd });
    return { status: 0, stdout: '', stderr: '' };
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: id => id === 'child_process'
      ? { execFileSync: record, spawnSync: record }
      : nativeRequire(id),
    module: mod, exports: mod.exports, process, Buffer,
    __dirname: path.dirname(filename), __filename: filename,
  }, { filename });
  return mod.exports;
}

function withWorkspace(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-workspace-format-'));
  clearCaches();
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    fs.writeFileSync(path.join(root, '.prettierrc'), '{}');
    const binary = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prettier.cmd' : 'prettier');
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, 'fixture only; process calls are recorded');
    const files = ['first', 'second'].map(name => {
      const pkg = path.join(root, 'packages', name);
      fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
      fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name }));
      const file = path.join(pkg, 'src', 'index.js');
      fs.writeFileSync(file, 'const value=1;');
      return file;
    });
    fn({ root, binary, files });
  } finally {
    clearCaches();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('post-edit formatter uses the workspace config and local binary', () => {
  withWorkspace(({ root, binary, files }) => {
    const calls = [];
    const hook = loadHook('post-edit-format.js', calls);
    const input = JSON.stringify({ tool_input: { file_path: files[0] } });
    assert.strictEqual(hook.run(input), input);
    assert.deepStrictEqual(calls, [{ bin: binary, args: ['--write', files[0]], cwd: root }]);
  });
});

test('Stop batches files from sibling packages under their shared formatter', () => {
  withWorkspace(({ root, binary, files }) => {
    const calls = [];
    const hook = loadHook('stop-format-typecheck.js', calls);
    const sessionId = `workspace-format-${process.pid}-${Date.now()}`;
    const accumulator = path.join(os.tmpdir(), `ecc-edited-${sessionId}.txt`);
    fs.writeFileSync(accumulator, files.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    try {
      const input = JSON.stringify({ session_id: sessionId });
      assert.strictEqual(hook.run(input), input);
      assert.deepStrictEqual(calls, [{ bin: binary, args: ['--write', ...files], cwd: root }]);
      assert.strictEqual(fs.existsSync(accumulator), false);
    } finally {
      fs.rmSync(accumulator, { force: true });
    }
  });
});
