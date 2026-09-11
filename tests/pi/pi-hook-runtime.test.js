#!/usr/bin/env node
'use strict';

// Run the real adapter against a recording process boundary. A simulated OMP
// executable is never launched, so a regression cannot create a process storm.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const ts = require('typescript');

const extensionDir = path.resolve(__dirname, '../../.pi/extensions');
const extensionSource = fs.readFileSync(path.join(extensionDir, 'index.ts'), 'utf8');
const compiled = ts.transpileModule(extensionSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;

/** Load the adapter and its runtime selector with the same host metadata. */
function loadAdapter(host, spawnError) {
  const launches = [];
  const handlers = new Map();
  const warnings = [];
  const runtimeModule = { exports: {} };
  const simulatedProcess = { env: {}, release: { name: 'node' }, versions: {}, ...host };
  vm.runInNewContext(fs.readFileSync(path.join(extensionDir, 'hook-runtime.js'), 'utf8'), {
    module: runtimeModule, require, process: simulatedProcess
  });
  const adapterModule = { exports: {} };
  const recordExecFile = (file, args, options, callback) => {
    const call = { file, args, options };
    launches.push(call);
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = input => {
      call.input = JSON.parse(input);
      callback(spawnError || null, '');
    };
    return child;
  };
  vm.runInNewContext(compiled, {
    module: adapterModule,
    exports: adapterModule.exports,
    __dirname: extensionDir,
    process: simulatedProcess,
    require: name => {
      if (name === 'node:child_process') return { execFile: recordExecFile };
      if (name === './hook-runtime.js') return runtimeModule.exports;
      return require(name);
    }
  });
  adapterModule.exports.default({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: () => {}
  });
  const context = {
    cwd: path.resolve(__dirname, '../..'),
    sessionManager: { getSessionId: () => 'runtime-regression' },
    ui: { notify: message => warnings.push(message) }
  };
  return { launches, warnings, run: () => handlers.get('session_start')({ reason: 'resume' }, context) };
}

/** Exercise the actual lifecycle entrypoint without spawning host executables. */
async function main() {
  let passed = 0;
  let failed = 0;
  const explicitNode = path.resolve('test node runtime', 'node');
  const cases = [
    ['normal Node', { execPath: process.execPath }, process.execPath],
    ['compiled OMP reporting Node', { execPath: '/fake/omp' }, 'node'],
    ['compiled OMP on Bun', { execPath: '/fake/omp', versions: { bun: '1.4.0' } }, 'node'],
    ['Bun with a Node basename', { execPath: '/fake/node', versions: { bun: '1.4.0' } }, 'node'],
    ['explicit absolute Node path with spaces', {
      execPath: '/fake/omp', env: { ECC_HOOK_NODE: explicitNode }
    }, explicitNode]
  ];
  for (const [name, host, expected] of cases) {
    try {
      const adapter = loadAdapter(host);
      await adapter.run();
      assert.strictEqual(adapter.launches.length, 1);
      const launch = adapter.launches[0];
      assert.strictEqual(launch.file, expected);
      assert.strictEqual(launch.args[1], 'session:start');
      assert.strictEqual(launch.input.source, 'resume');
      assert.strictEqual(launch.input.session_id, 'runtime-regression');
      assert.ok(launch.options.timeout > 0 && launch.options.timeout <= 30000);
      assert.ok(launch.options.maxBuffer > 0 && launch.options.maxBuffer <= 16 * 1024 * 1024);
      assert.ok(!launch.options.shell);
      assert.strictEqual(adapter.warnings.length, 0);
      console.log(`  ✓ ${name} launches exactly one bounded Node hook`);
      passed++;
    } catch (error) {
      console.error(`  ✗ ${name}: ${error.message}`);
      failed++;
    }
  }
  for (const [name, host, spawnError, expectedLaunches] of [
    ['invalid override', { execPath: '/fake/omp', env: { ECC_HOOK_NODE: './omp' } }, null, 0],
    ['missing PATH node', { execPath: '/fake/omp' }, new Error('spawn node ENOENT'), 1]
  ]) {
    try {
      const adapter = loadAdapter(host, spawnError);
      await adapter.run();
      assert.strictEqual(adapter.launches.length, expectedLaunches);
      assert.strictEqual(adapter.warnings.length, 1);
      assert.match(adapter.warnings[0], /hook skipped/);
      console.log(`  ✓ ${name} warns without retrying the host executable`);
      passed++;
    } catch (error) {
      console.error(`  ✗ ${name}: ${error.message}`);
      failed++;
    }
  }
  console.log(`\nPassed: ${passed}\nFailed: ${failed}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
