'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'run-all.js'), 'utf8');

function run(result, filename = 'sample.test.js', actions = true) {
  const logs = [];
  const exit = {};
  let status;
  let spawns = 0;
  const fakeProcess = {
    env: actions ? { GITHUB_ACTIONS: 'true' } : {},
    exit(code) { status = code; throw exit; },
  };
  const fakeFs = {
    readdirSync: () => [{
      name: filename,
      isDirectory: () => false,
      isFile: () => true,
    }],
    existsSync: () => true,
  };
  try {
    vm.runInNewContext(source, {
      __dirname: path.resolve('/virtual/tests'),
      process: fakeProcess,
      console: { log: (...args) => logs.push(args.join(' ')) },
      require(name) {
        if (name === 'fs') return fakeFs;
        if (name === 'path') return path;
        if (name === 'child_process') return {
          spawnSync() { spawns += 1; return result; },
        };
        throw new Error(`Unexpected dependency: ${name}`);
      },
    });
  } catch (error) {
    if (error !== exit) throw error;
  }
  assert.strictEqual(spawns, 1);
  return { status, logs, annotations: logs.filter(line => line.startsWith('::error ')) };
}

const tests = [
  ['nonzero exit overrides a zero-failure summary', () => {
    const result = run({ status: 1, stdout: 'Passed: 2, Failed: 0', stderr: 'Error: late crash' });
    assert.strictEqual(result.status, 1);
    assert.strictEqual(result.annotations.length, 1);
    assert.match(result.annotations[0], /file=tests\/sample.test.js/);
    assert.match(result.annotations[0], /status 1.*Error: late crash/);
    assert.ok(result.logs.includes('Error: late crash'));
  }],
  ['startup errors always count as failures and annotate their cause', () => {
    const result = run({ status: null, stdout: 'Failed: 0', error: new Error('spawn node ENOENT') });
    assert.strictEqual(result.status, 1);
    assert.strictEqual(result.annotations.length, 1);
    assert.match(result.annotations[0], /failed to start.*spawn node ENOENT/);
  }],
  ['annotation properties and messages escape workflow command characters', () => {
    const result = run({ status: null, error: new Error('100% broken\r\nnext line') }, 'sample%,:.test.js');
    assert.strictEqual(result.annotations.length, 1);
    assert.ok(result.annotations[0].includes('file=tests/sample%25%2C%3A.test.js'));
    assert.ok(result.annotations[0].includes('100%25 broken%0D%0Anext line'));
    assert.ok(!result.annotations[0].includes('\n'));
    assert.ok(!result.annotations[0].includes('\r'));
  }],
  ['failure summaries annotate concise context even with a successful exit', () => {
    const output = `${'routine log\n'.repeat(100)}FAIL regression example\nPassed: 2, Failed: 1`;
    const result = run({ status: 0, stdout: output });
    assert.strictEqual(result.status, 1);
    assert.strictEqual(result.annotations.length, 1);
    assert.match(result.annotations[0], /FAIL regression example/);
    assert.ok(result.annotations[0].length < 1500);
    assert.ok(!result.annotations[0].includes('routine log'));
    assert.ok(result.logs.includes(output));
    assert.ok(result.logs.some(line => /Failed:\s+1\s/.test(line)));
  }],
  ['signals fail even when no summary was printed', () => {
    const result = run({ status: null, signal: 'SIGTERM' });
    assert.strictEqual(result.status, 1);
    assert.match(result.annotations[0], /SIGTERM/);
  }],
  ['passing error-handling cases cannot hide the actual failure', () => {
    const output = `${'PASS handles Error conditions\n'.repeat(5)}FAIL actual regression\n    AssertionError: mismatch\nFailed: 1`;
    const result = run({ status: 1, stdout: output });
    assert.match(result.annotations[0], /FAIL actual regression/);
    assert.match(result.annotations[0], /AssertionError: mismatch/);
    assert.ok(!result.annotations[0].includes('PASS handles'));
  }],
  ['healthy suites preserve successful totals and emit no annotation', () => {
    const result = run({ status: 0, stdout: 'Passed: 3, Failed: 0' });
    assert.strictEqual(result.status, 0);
    assert.deepStrictEqual(result.annotations, []);
    assert.ok(result.logs.some(line => /Passed:\s+3\s/.test(line)));
  }],
  ['local failures retain console diagnostics without workflow annotations', () => {
    const result = run({ status: 1, stderr: 'Error: local failure' }, 'sample.test.js', false);
    assert.strictEqual(result.status, 1);
    assert.deepStrictEqual(result.annotations, []);
    assert.ok(result.logs.includes('Error: local failure'));
  }],
];

let failed = 0;
for (const [name, test] of tests) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n${error.stack || error.message}`);
  }
}
console.log(`Passed: ${tests.length - failed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
