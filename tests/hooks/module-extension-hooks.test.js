'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { createRequire } = require('module');

const extensions = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts'];
let passed = 0;
let failed = 0;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-module-hooks-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.writeFileSync(path.join(root, '.prettierrc'), '{}');
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
  const bin = path.join(root, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'prettier.cmd' : 'prettier'), '');
  const files = extensions.map(extension => path.join(root, `source.${extension}`));
  for (const file of files) fs.writeFileSync(file, 'export const value = 1;\n');
  return { root, files };
}

function invokeHook(name, root, input, options = {}) {
  const filename = path.resolve(__dirname, '../../scripts/hooks', `${name}.js`);
  const actualRequire = createRequire(filename);
  const module = { exports: {} };
  const calls = [];
  let output = '';
  let diagnostics = '';
  const execute = (bin, args, spawnOptions) => {
    calls.push({ bin, args: Array.from(args), cwd: spawnOptions.cwd });
    if (args[0] === 'tsc') {
      if (options.compilerResult) return options.compilerResult;
      const stdout = extensions.map(extension => `source.${extension}(1,1): error TS2322: Module diagnostic`).join('\n');
      throw Object.assign(new Error('Type check failed'), { stdout, stderr: '' });
    }
    if (options.formatterFails) throw new Error('Formatter failed');
    return Buffer.alloc(0);
  };
  const requireHook = request => {
    if (request === 'child_process') return {
      execFileSync: execute,
      spawnSync: (...args) => {
        try {
          const result = execute(...args);
          return args[1][0] === 'tsc' && options.compilerResult ? result : { status: 0 };
        }
        catch (error) { return { status: 2, stdout: error.stdout, stderr: error.stderr }; }
      },
    };
    if (request === 'fs' && options.accumulatorUnlinkError) return {
      ...fs, unlinkSync: () => { throw options.accumulatorUnlinkError; },
    };
    if (request === 'os') return { ...os, tmpdir: () => root, homedir: () => path.join(root, 'home') };
    if (request === '../lib/resolve-formatter' && options.platform === 'win32') return {
      ...actualRequire(request),
      resolveFormatterBin: () => ({ bin: 'prettier.cmd', prefix: [] }),
    };
    return actualRequire(request);
  };
  const direct = name === 'post-edit-typecheck';
  requireHook.main = direct ? module : null;
  const stdin = new EventEmitter();
  stdin.setEncoding = () => {};
  const hookProcess = {
    ...process, env: { ...process.env, ECC_STOP_BUILD_FIX: options.buildFix || '' }, platform: options.platform || process.platform, cwd: () => root, stdin,
    stdout: { write: (text, done) => { output += text; if (done) done(); } },
    stderr: { write: text => { diagnostics += text; } },
    exit: () => {},
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: requireHook, module, process: hookProcess, Buffer,
    __filename: filename, __dirname: path.dirname(filename),
    console: { error: (...args) => { diagnostics += `${args.join(' ')}\n`; } },
  }, { filename });
  if (direct) {
    stdin.emit('data', input);
    stdin.emit('end');
  } else {
    output = module.exports.run(input);
  }
  if (options.expectBlock) {
    const decision = JSON.parse(output);
    assert.strictEqual(decision.decision, 'block');
    assert.strictEqual(decision.reason.includes('/build-fix'), options.buildFix === '1');
    assert.ok(decision.reason.includes('source.mts(1,1): error TS2322'));
  } else assert.strictEqual(output, input, `${name} preserves its input`);
  return { calls, diagnostics, output };
}

function test(name, run) {
  const data = fixture();
  try {
    run(data);
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}: ${error.message}`);
  } finally {
    fs.rmSync(data.root, { recursive: true, force: true });
  }
}

function assertBatchCalls({ calls, diagnostics }, files, platform = process.platform) {
  // Windows Stop intentionally skips a formatter batch if any path contains
  // shell-sensitive characters, including spaces in the host's temp directory.
  const skipsFormatting = platform === 'win32' && files.some(file => /[&|<>^%!\s()]/.test(file));
  const expected = skipsFormatting ? [] : [['--write', ...files]];
  expected.push(['tsc', '--noEmit', '--pretty', 'false']);
  assert.deepStrictEqual(calls.map(call => call.args), expected);
  if (skipsFormatting) assert.ok(diagnostics.includes('unsafe path chars'));
}

test('Edit and MultiEdit accumulate all JS and TS module extensions', ({ root, files }) => {
  for (const file of files) invokeHook('post-edit-accumulator', root,
    JSON.stringify({ session_id: 'single', tool_input: { file_path: file } }));
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'ecc-edited-single.txt'), 'utf8').trim().split('\n'), files);
  const ignored = ['readme.md', 'source.mjs.map', 'source.mtsx'].map(name => path.join(root, name));
  invokeHook('post-edit-accumulator', root, JSON.stringify({
    session_id: 'multi', tool_input: { edits: [...files, ...ignored].map(file_path => ({ file_path })) },
  }));
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'ecc-edited-multi.txt'), 'utf8').trim().split('\n'), files);
});

test('the direct formatter receives each module file', ({ root, files }) => {
  for (const file of files) {
    const { calls } = invokeHook('post-edit-format', root, JSON.stringify({ tool_input: { file_path: file } }));
    assert.strictEqual(calls.length, 1, `formatter invocation for ${path.basename(file)}`);
    assert.deepStrictEqual(calls[0].args, ['--write', file]);
    assert.strictEqual(calls[0].cwd, root);
  }
});

test('the direct typecheck reports mts and cts diagnostics and skips JavaScript files', ({ root, files }) => {
  for (const file of files) {
    const { calls, diagnostics } = invokeHook('post-edit-typecheck', root, JSON.stringify({ tool_input: { file_path: file } }));
    const isTypeScript = ['.ts', '.tsx', '.mts', '.cts'].includes(path.extname(file));
    assert.strictEqual(calls.length, isTypeScript ? 1 : 0, `typecheck invocation for ${path.basename(file)}`);
    if (isTypeScript) {
      assert.ok(diagnostics.includes(`TypeScript errors in ${path.basename(file)}:`));
      assert.ok(diagnostics.includes(`${path.basename(file)}(1,1): error TS2322`));
    } else assert.strictEqual(diagnostics, '');
  }
});

test('the accumulator-to-Stop pipeline formats one batch and typechecks module files once', ({ root, files }) => {
  const plugin = path.join(root, '.claude', 'plugins', 'installed', 'source.mts');
  fs.mkdirSync(path.dirname(plugin), { recursive: true });
  fs.writeFileSync(plugin, 'export const value = 1;\n');
  invokeHook('post-edit-accumulator', root, JSON.stringify({
    session_id: 'batch', tool_input: { edits: [...files, files[0], plugin].map(file_path => ({ file_path })) },
  }));
  const { calls, diagnostics } = invokeHook('stop-format-typecheck', root, JSON.stringify({ session_id: 'batch' }));
  assertBatchCalls({ calls, diagnostics }, files);
  for (const extension of ['ts', 'tsx', 'mts', 'cts']) assert.ok(diagnostics.includes(`TypeScript errors in source.${extension}:`));
  for (const extension of ['js', 'jsx', 'mjs', 'cjs']) assert.ok(!diagnostics.includes(`TypeScript errors in source.${extension}:`));
  assert.ok(!fs.existsSync(path.join(root, 'ecc-edited-batch.txt')), 'Stop consumes the session accumulator');
});

test('module extensions retain Windows formatter guards and batch diagnostic handling', ({ root, files }) => {
  const moduleFile = files.find(file => file.endsWith('.mjs'));
  const input = JSON.stringify({ tool_input: { file_path: moduleFile } });
  const formatted = invokeHook('post-edit-format', root, input, { platform: 'win32' });
  assert.strictEqual(formatted.calls.length, 1);
  assert.strictEqual(formatted.calls[0].bin, 'prettier.cmd');
  const failedFormatter = invokeHook('post-edit-format', root, input, { platform: 'win32', formatterFails: true });
  assert.strictEqual(failedFormatter.calls.length, 1, 'formatter failure remains non-blocking');

  const unsafe = path.join(root, 'unsafe&module.mjs');
  fs.writeFileSync(unsafe, 'export const value = 1;\n');
  assert.strictEqual(invokeHook('post-edit-format', root,
    JSON.stringify({ tool_input: { file_path: unsafe } }), { platform: 'win32' }).calls.length, 0);
  fs.writeFileSync(path.join(root, 'ecc-edited-unsafe.txt'), `${unsafe}\n`);
  const guarded = invokeHook('stop-format-typecheck', root,
    JSON.stringify({ session_id: 'unsafe' }), { platform: 'win32' });
  assert.strictEqual(guarded.calls.length, 0);
  assert.ok(guarded.diagnostics.includes('unsafe path chars'));

  const typed = files.filter(file => file.endsWith('.mts') || file.endsWith('.cts'));
  fs.writeFileSync(path.join(root, 'ecc-edited-typed.txt'), typed.join('\n'));
  const checked = invokeHook('stop-format-typecheck', root,
    JSON.stringify({ session_id: 'typed' }), { platform: 'win32' });
  assertBatchCalls(checked, typed, 'win32');
  assert.ok(checked.diagnostics.includes('TypeScript errors in source.mts:'));
  assert.ok(checked.diagnostics.includes('TypeScript errors in source.cts:'));
});

test('Claude Stop returns edited-file errors once', ({ root, files }) => {
  const file = files.find(candidate => candidate.endsWith('.mts'));
  for (const active of [false, true]) {
    fs.writeFileSync(path.join(root, 'ecc-edited-feedback.txt'), file);
    invokeHook('stop-format-typecheck', root, JSON.stringify({
      session_id: 'feedback', hook_event_name: 'Stop', stop_hook_active: active,
    }), { expectBlock: !active });
  }
});

test('opt-in Stop requests one scoped build-fix attempt', ({ root, files }) => {
  for (const active of [false, true]) {
    fs.writeFileSync(path.join(root, 'ecc-edited-optin.txt'), files.find(file => file.endsWith('.mts')));
    invokeHook('stop-format-typecheck', root, JSON.stringify({
      session_id: 'optin', hook_event_name: 'Stop', stop_hook_active: active,
    }), { buildFix: '1', expectBlock: !active });
  }
});

test('duplicate Stop without new edits has no repair request, but a later turn can request it again', ({ root, files }) => {
  const file = files.find(candidate => candidate.endsWith('.mts'));
  const input = JSON.stringify({ session_id: 'repeat', hook_event_name: 'Stop', stop_hook_active: false });
  const accum = path.join(root, 'ecc-edited-repeat.txt');
  fs.writeFileSync(accum, file);
  invokeHook('stop-format-typecheck', root, input, { buildFix: '1', expectBlock: true });
  const duplicate = invokeHook('stop-format-typecheck', root, input, { buildFix: '1' });
  assert.strictEqual(duplicate.calls.length, 0);
  fs.writeFileSync(accum, file);
  invokeHook('stop-format-typecheck', root, input, { buildFix: '1', expectBlock: true });
});

test('a Stop that cannot consume the accumulator leaves it for a retry', ({ root, files }) => {
  const accum = path.join(root, 'ecc-edited-claim.txt');
  fs.writeFileSync(accum, files.find(candidate => candidate.endsWith('.mts')));
  const input = JSON.stringify({ session_id: 'claim', hook_event_name: 'Stop', stop_hook_active: false });
  const accumulatorUnlinkError = Object.assign(new Error('Access denied'), { code: 'EACCES' });
  const blockedRead = invokeHook('stop-format-typecheck', root, input, { buildFix: '1', accumulatorUnlinkError });
  assert.strictEqual(blockedRead.calls.length, 0);
  assert.ok(fs.existsSync(accum));
  invokeHook('stop-format-typecheck', root, input, { buildFix: '1', expectBlock: true });
});

test('Stop allows missing, malformed, successful, and interrupted compiler results', ({ root, files }) => {
  const file = files.find(candidate => candidate.endsWith('.mts'));
  const diagnostic = 'source.mts(1,1): error TS2322: Test error';
  const cases = [
    { status: 0, stdout: diagnostic },
    { status: 2, stdout: '', stderr: '' },
    { status: 2, stdout: { error: diagnostic }, stderr: null },
    { status: 2, stdout: 'source.mts(1,1): unexpected output' },
    { status: 2, stdout: 'source.mts(1,1): warning TS2322: Test warning' },
    { status: 2, stdout: 'source.mts(1,1): error TS2322:' },
    { status: 2, stdout: 'untracked.mts(1,1): error TS2322: Test error' },
    { status: null, signal: 'SIGTERM', stdout: diagnostic },
    { status: null, error: { code: 'ETIMEDOUT' }, stdout: diagnostic },
    { status: null, error: { code: 'ENOENT' }, stdout: '' },
  ];
  for (const platform of ['win32', 'linux']) {
    for (const compilerResult of cases) {
      fs.writeFileSync(path.join(root, 'ecc-edited-compiler.txt'), file);
      const input = JSON.stringify({ session_id: 'compiler', hook_event_name: 'Stop', stop_hook_active: false });
      const { diagnostics } = invokeHook('stop-format-typecheck', root, input, {
        platform, buildFix: '1', compilerResult,
      });
      assert.ok(!diagnostics.includes('TypeScript errors in'));
    }
  }
});

test('Stop keeps compiler streams separate and caps the total across projects', ({ root, files }) => {
  const secondRoot = path.join(root, 'second');
  fs.mkdirSync(secondRoot);
  fs.writeFileSync(path.join(secondRoot, 'tsconfig.json'), '{}');
  const secondFile = path.join(secondRoot, 'source.cts');
  fs.writeFileSync(secondFile, 'export {};');
  const firstLines = Array.from({ length: 6 }, (_, index) =>
    'source.mts(' + (index + 1) + ',1): error TS2322: First project');
  const secondLines = Array.from({ length: 6 }, (_, index) =>
    'source.cts(' + (index + 1) + ',1): error TS2322: Second project');
  const compilerResult = {
    status: 2,
    stdout: ['untracked.ts(1,1): error TS2322: Ignore', ...firstLines].join('\r\n'),
    stderr: secondLines.join('\n'),
  };
  const filesToCheck = [files.find(file => file.endsWith('.mts')), secondFile];
  fs.writeFileSync(path.join(root, 'ecc-edited-caps.txt'), filesToCheck.join('\n'));
  const input = JSON.stringify({ session_id: 'caps', hook_event_name: 'Stop', stop_hook_active: false });
  const { output, diagnostics } = invokeHook('stop-format-typecheck', root, input, { expectBlock: true, compilerResult });
  assert.deepStrictEqual(JSON.parse(output).reason.split('\n'), [...firstLines, ...secondLines.slice(0, 4)]);
  assert.ok(diagnostics.includes(secondLines[5]), 'stderr retains per-file diagnostics');
});

test('Stop caps the complete reason with and without repair guidance', ({ root, files }) => {
  const file = files.find(candidate => candidate.endsWith('.mts'));
  const compilerResult = { status: 2, stdout: 'source.mts(1,1): error TS2322: ' + 'x'.repeat(4_100) };
  const input = JSON.stringify({ session_id: 'length', hook_event_name: 'Stop', stop_hook_active: false });
  for (const buildFix of ['', 'true', '1']) {
    fs.writeFileSync(path.join(root, 'ecc-edited-length.txt'), file);
    const { output } = invokeHook('stop-format-typecheck', root, input, { compilerResult, buildFix, expectBlock: true });
    assert.strictEqual(JSON.parse(output).reason.length, 4_000);
  }
});

test('malformed stop_hook_active values do not trigger a repair request', ({ root, files }) => {
  const input = JSON.stringify({ session_id: 'malformed', hook_event_name: 'Stop', stop_hook_active: 0 });
  fs.writeFileSync(path.join(root, 'ecc-edited-malformed.txt'), files.find(candidate => candidate.endsWith('.mts')));
  invokeHook('stop-format-typecheck', root, input, { buildFix: '1' });
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
