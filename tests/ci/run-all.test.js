'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const source = fs.readFileSync(path.join(__dirname, '..', 'run-all.js'), 'utf8');

function run(result, filename = 'sample.test.js', actions = true) {
  const logs = [];
  const exit = {};
  let status;
  let spawns = 0;
  const fakeProcess = {
    env: actions ? { GITHUB_ACTIONS: 'true' } : {},
    exit(code) { status = code; throw exit; },
    set exitCode(code) { status = code; },
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
  ['named suite summaries retain their actual totals', () => {
    const result = run({ status: 0, stdout: 'eval-harness package: Results: Passed: 4, Failed: 0' });
    assert.strictEqual(result.status, 0);
    assert.ok(result.logs.some(line => /Passed:\s+4\s/.test(line)));
  }],
  ['named suite failure summaries cannot be lost with a successful exit', () => {
    const result = run({ status: 0, stdout: 'capsule: Results: Passed: 3, Failed: 1' });
    assert.strictEqual(result.status, 1);
    assert.match(result.annotations[0], /reported 1 failed/);
  }],
  ['outer summary wins over a nested runner failure summary', () => {
    const result = run({ status: 0, stdout: 'Passed: 0, Failed: 1\nPASS verifies nested failure\nResults: Passed: 4, Failed: 0' });
    assert.strictEqual(result.status, 0);
    assert.ok(result.logs.some(line => /Passed:\s+4\s/.test(line)));
  }],
  ['outer failure cannot be hidden by an earlier nested success', () => {
    const result = run({ status: 0, stdout: 'Passed: 99, Failed: 0\nPassed: 2\nFailed: 1' });
    assert.strictEqual(result.status, 1);
    assert.ok(result.logs.some(line => /Passed:\s+2\s/.test(line)));
    assert.match(result.annotations[0], /reported 1 failed/);
  }],
  ['diagnostic mentions of counts are not owned summaries', () => {
    const result = run({ status: 0, stdout: 'Assertion fixture: Passed: 99, Failed: 7\nPassed: 3\nFailed: 0', stderr: 'Error fixture expected "Failed: 8"' });
    assert.strictEqual(result.status, 0);
    assert.ok(result.logs.some(line => /Passed:\s+3\s/.test(line)));
  }],
  ['stdout summary owns counts even when stderr quotes a nested summary', () => {
    const result = run({ status: 0, stdout: 'Passed: 3, Failed: 0', stderr: 'Passed: 0, Failed: 8' });
    assert.strictEqual(result.status, 0);
    assert.ok(result.logs.some(line => /Passed:\s+3\s/.test(line)));
  }],
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
  ['successful files without counts do not invent test totals', () => {
    const result = run({ status: 0, stdout: 'suite complete' });
    assert.strictEqual(result.status, 0);
    assert.ok(result.logs.some(line => /Passed:\s+0\s/.test(line)));
    assert.ok(result.logs.some(line => /Files: 1 passed, 0 failed/.test(line)));
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
  ...[0, 1].map(fixtureFailures => [`piped runner flushes the full tail and summary with exit ${fixtureFailures}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-runner-pipe-'));
    try {
      const testsDir = path.join(root, 'tests');
      fs.mkdirSync(testsDir);
      const runner = path.join(testsDir, 'run-all.js');
      fs.writeFileSync(runner, source);
      // Keep fixture stdout below the runner's default 1 MiB spawnSync ceiling,
      // but above a pipe buffer so the runner must drain pending async writes.
      const payloadBytes = 256 * 1024;
      fs.writeFileSync(path.join(testsDir, 'large.test.js'), [
        `console.log('x'.repeat(${payloadBytes}));`,
        "console.log('FIXTURE_FULL_TAIL');",
        `console.log('Passed: 1, Failed: ${fixtureFailures}');`,
        `process.exitCode = ${fixtureFailures};`,
      ].join('\n'));
      const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` };
      delete env.ECC_TEST_SKIP;
      delete env.ECC_TEST_ALLOW_FAILURES;
      const result = spawnSync(process.execPath, [runner], {
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env,
        maxBuffer: 512 * 1024, timeout: 15000,
      });
      assert.ifError(result.error);
      assert.strictEqual(result.status, fixtureFailures, result.stderr);
      assert.ok(result.stdout.includes('x'.repeat(payloadBytes)), 'full bounded fixture payload must reach the pipe');
      assert.match(result.stdout, /FIXTURE_FULL_TAIL/);
      assert.match(result.stdout, /Final Results/);
      assert.ok(result.stdout.trimEnd().endsWith(`Passed: 1, Failed: ${fixtureFailures}`));
      assert.match(result.stdout, new RegExp(`Files: ${fixtureFailures ? '0 passed, 1 failed' : '1 passed, 0 failed'}`));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }]),
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
