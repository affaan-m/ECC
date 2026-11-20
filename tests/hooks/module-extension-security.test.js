'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

// Virtual filesystem paths keep cmd.exe metacharacter cases portable, including
// characters which Windows cannot create as actual filenames. Real hook code
// runs below; subprocess calls are recorded before anything could execute.
const root = path.resolve(path.parse(process.cwd()).root, 'ecc-module-security');
const home = path.join(root, 'home');
const extensions = ['mjs', 'cjs', 'mts', 'cts'];

function runHook(hook, filePath) {
  const filename = path.resolve(__dirname, '../../scripts/hooks', `${hook}.js`);
  const actualRequire = createRequire(filename);
  const module = { exports: {} };
  const calls = [];
  const record = (bin, args) => { calls.push({ bin, args: Array.from(args) }); return { status: 0 }; };
  const requireHook = request => {
    if (request === 'fs') return { existsSync: () => true, readFileSync: () => `${filePath}\n`, unlinkSync: () => {} };
    if (request === 'os') return { tmpdir: () => root, homedir: () => home };
    if (request === 'child_process') return { spawnSync: record, execFileSync: record };
    if (request === '../lib/resolve-formatter') return {
      findProjectRoot: () => root, detectFormatter: () => 'prettier',
      resolveFormatterBin: () => ({ bin: 'prettier.cmd', prefix: [] }),
    };
    return actualRequire(request);
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: requireHook, module,
    process: { ...process, platform: 'win32', cwd: () => root, stderr: { write: () => {} } },
  }, { filename });
  const input = JSON.stringify({ session_id: 'security', tool_input: { file_path: filePath } });
  assert.strictEqual(module.exports.run(input), input);
  return calls;
}

let passed = 0;
let failed = 0;
function test(name, callback) {
  try {
    callback();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

for (const extension of extensions) {
  test(`.${extension} preserves Windows command guards after becoming eligible`, () => {
    const safe = path.join(root, `safe.${extension}`);
    assert.strictEqual(runHook('post-edit-format', safe).length, 1, 'positive control reaches the formatter');
    for (const character of ['&', '|', '<', '>', '^', '%', '!', '(', ')']) {
      const unsafe = path.join(root, `unsafe${character}module.${extension}`);
      assert.strictEqual(runHook('post-edit-format', unsafe).length, 0, `direct formatter rejects ${character}`);
      const calls = runHook('stop-format-typecheck', unsafe);
      assert.ok(calls.every(call => call.args[0] === 'tsc'), `Stop formatter rejects ${character}`);
      for (const call of calls) assert.deepStrictEqual(call.args, ['tsc', '--noEmit', '--pretty', 'false']);
    }
  });
  test(`.${extension} plugin-clone edits never reach Stop formatters or typecheck`, () => {
    const safe = path.join(root, `safe.${extension}`);
    assert.ok(runHook('stop-format-typecheck', safe).some(call => call.bin === 'prettier.cmd'));
    for (const base of [root, home]) {
      const pluginFile = path.join(base, '.claude', 'plugins', 'installed', `source.${extension}`);
      assert.strictEqual(runHook('stop-format-typecheck', pluginFile).length, 0);
    }
  });
}

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
