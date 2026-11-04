'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const source = fs.readFileSync(path.join(__dirname, '..', 'run-all.js'), 'utf8');

function run(result, filename = 'sample.test.js', actions = true, fileExists = true) {
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
    existsSync: () => fileExists,
  };
  try {
    vm.runInNewContext(source, {
      __dirname: path.resolve('/virtual/tests'),
      process: fakeProcess,
      console: { log: (...args) => logs.push(args.join(' ')) },
      require(name) {
        if (name === 'fs') return fakeFs;
        if (name === 'path') return path;
        if (name === 'perf_hooks') return require('perf_hooks');
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

function fixtureRun(files, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-runner-integrity-'));
  try {
    const testsDir = path.join(root, 'tests');
    fs.mkdirSync(testsDir);
    fs.writeFileSync(path.join(testsDir, 'run-all.js'), source);
    for (const [name, body] of Object.entries(files)) {
      const target = path.join(testsDir, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
    const reportPath = options.reportDirectory ? root : path.join(root, 'report.json');
    const env = { ...process.env };
    for (const key of ['ECC_TEST_REPORT', 'ECC_TEST_ONLY', 'ECC_TEST_SKIP', 'ECC_TEST_SERIAL', 'ECC_TEST_JOBS', 'ECC_TEST_ALLOW_FAILURES']) delete env[key];
    Object.assign(env, {
      PATH: options.spawnError ? path.join(root, 'no-executables') : `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`,
      ECC_TEST_REPORT: reportPath,
      ECC_TEST_JOBS: String(options.jobs || 1),
      ECC_TEST_SERIAL: options.serial || '',
      FIXTURE_ROOT: root,
    });
    const result = spawnSync(process.execPath, [path.join(testsDir, 'run-all.js')], { encoding: 'utf8', env, timeout: 20000 });
    assert.ifError(result.error);
    const report = !options.reportDirectory && fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
    const eventsPath = path.join(root, 'events.jsonl');
    const events = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    return { ...result, report, events };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function assertCompleteReport(result, expectedFiles, expectedFailed = 0) {
  assert.ok(result.report, `execution manifest must be written\n${result.stdout}\n${result.stderr}`);
  const report = result.report;
  assert.strictEqual(report.version, 1);
  assert.deepStrictEqual(report.plannedFiles.slice().sort(), expectedFiles.slice().sort());
  assert.deepStrictEqual(report.records.map(record => record.file).sort(), expectedFiles.slice().sort());
  assert.strictEqual(new Set(report.records.map(record => record.file)).size, expectedFiles.length, 'each planned file must complete exactly once');
  assert.deepStrictEqual(report.counts, {
    planned: expectedFiles.length, attempted: expectedFiles.length, completed: expectedFiles.length,
    passed: expectedFiles.length - expectedFailed, failed: expectedFailed,
  });
  assert.strictEqual(report.integrity.ok, true);
  assert.deepStrictEqual(report.integrity.errors, []);
  for (const record of report.records) {
    assert.ok(['pool', 'serial'].includes(record.phase));
    assert.ok(Number.isFinite(Date.parse(record.attemptedAt)), 'valid attempt timestamp');
    assert.ok(Number.isFinite(Date.parse(record.completedAt)), 'valid completion timestamp');
    assert.ok(Number.isFinite(record.durationMs) && record.durationMs >= 0, 'finite monotonic elapsed milliseconds');
    for (const key of ['exitCode', 'signal', 'error', 'outcome']) assert.ok(Object.hasOwn(record, key), `record includes ${key}`);
    assert.ok(['passed', 'failed'].includes(record.outcome));
  }
  const lines = result.stdout.split(/\r?\n/);
  assert.strictEqual(lines.filter(line => line.startsWith('ECC_TEST_PLAN ')).length, 1);
  assert.strictEqual(lines.filter(line => line.startsWith('ECC_TEST_FILE ')).length, expectedFiles.length);
  assert.ok(lines.findIndex(line => line.startsWith('ECC_TEST_FILE ')) < lines.findIndex(line => line.includes('Final Results')), 'machine records precede final console summary');
  return report;
}

const tests = [
  ['CI assigns two workers only to full Windows lanes and retains other lane worker counts', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    const match = workflow.match(/^\s+ECC_TEST_JOBS: \$\{\{(.+)\}\}\s*$/m);
    assert.ok(match, 'test job has an explicit worker expression');
    for (const [platform, scope, expected] of [
      ['Windows', 'full', '2'], ['Windows', 'pm', '1'],
      ['Linux', 'full', '4'], ['Linux', 'pm', '4'],
      ['macOS', 'full', '4'], ['macOS', 'pm', '4'],
    ]) {
      const actual = vm.runInNewContext(match[1], { runner: { os: platform }, matrix: { scope } });
      assert.strictEqual(String(actual), expected, `${platform}/${scope} worker count`);
    }
  }],
  ['Windows timing-sensitive suites remain executable files in the serial tail rather than being skipped', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const block = workflow.match(/if \[ "\$RUNNER_OS" = "Windows" \]; then([\s\S]*?)^\s+fi\s*$/m);
    assert.ok(block, 'Windows-specific serial scheduling block exists');
    const assignment = block[1].match(/ECC_TEST_SERIAL="\$ECC_TEST_SERIAL,([^"]+)"/);
    assert.ok(assignment, 'Windows appends to the existing serial set');
    const additions = assignment[1].split(',');
    const expected = [
      'hooks/hookify-runtime.test.js', 'integration/hooks.test.js', 'hooks/hooks.test.js',
      'ci/agent-payment-x402-seller-guard.test.js', 'lib/context-profile-sandbox.test.js',
      'hooks/gateguard-fact-force.test.js',
    ];
    assert.deepStrictEqual(additions.slice().sort(), expected.slice().sort());
    for (const file of additions) assert.ok(fs.statSync(path.join(repoRoot, 'tests', file)).isFile(), `${file} remains a real suite`);
    assert.ok(!/ECC_TEST_SKIP\s*=/.test(block[1]), 'timing suites are serialized, never excluded');
  }],
  ['serial and two-worker runs preserve the exact planned file set and timing records', () => {
    const files = {
      'a.test.js': "console.log('Passed: 2, Failed: 0');",
      'nested/b.test.js': "console.log('suite without assertion totals');",
      'z-serial.test.js': "console.log('Passed: 1, Failed: 0');",
    };
    const expected = Object.keys(files);
    for (const jobs of [1, 2]) {
      const result = fixtureRun(files, { jobs, serial: 'z-serial' });
      assert.strictEqual(result.status, 0, result.stderr);
      const report = assertCompleteReport(result, expected);
      assert.strictEqual(report.jobs, jobs);
    }
  }],
  ['two workers overlap and a serial tail waits until all pool children finish', () => {
    const eventCode = "const fs=require('fs'),path=require('path');const event=kind=>fs.appendFileSync(path.join(process.env.FIXTURE_ROOT,'events.jsonl'),JSON.stringify({file:path.basename(__filename),kind})+'\\n');";
    const files = {};
    for (const name of ['a', 'b']) {
      files[`${name}.test.js`] = eventCode + `
        event('start');
        fs.writeFileSync(path.join(process.env.FIXTURE_ROOT, '${name}.started'), '1');
        const watchdog=setTimeout(()=>{console.error('second worker did not start');process.exitCode=1;clearInterval(wait);},6000);
        const wait=setInterval(()=>{
          if(!['a','b'].every(n=>fs.existsSync(path.join(process.env.FIXTURE_ROOT,n+'.started'))))return;
          clearInterval(wait);clearTimeout(watchdog);
          event('end');console.log('Passed: 1, Failed: 0');
        },10);
      `;
    }
    files['c.test.js'] = eventCode + "event('start');event('end');console.log('Passed: 1, Failed: 0');";
    files['z-serial.test.js'] = eventCode + "event('start');event('end');console.log('Passed: 1, Failed: 0');";
    const result = fixtureRun(files, { jobs: 2, serial: 'z-serial' });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const report = assertCompleteReport(result, Object.keys(files));
    let active = 0;
    let maxActive = 0;
    const ended = new Set();
    for (const event of result.events) {
      if (event.kind === 'start') {
        if (event.file === 'z-serial.test.js') {
          assert.strictEqual(active, 0, 'serial suite never overlaps the pool');
          assert.strictEqual(ended.size, 3, 'every pool file has completed');
        }
        active++;
        maxActive = Math.max(active, maxActive);
      } else { active--; ended.add(event.file); }
      assert.ok(active >= 0 && active <= 2, 'pool stays within worker cap');
    }
    assert.strictEqual(maxActive, 2, 'two real child processes overlap');
    assert.strictEqual(active, 0);
    assert.strictEqual(result.events.length, 8);
    assert.strictEqual(report.records.find(record => record.file === 'z-serial.test.js').phase, 'serial');
    assert.ok(report.records.filter(record => record.file !== 'z-serial.test.js').every(record => record.phase === 'pool'));
  }],
  ['a planned file removed by an earlier suite is recorded as a failure instead of skipped', () => {
    const result = fixtureRun({
      'a-delete.test.js': "require('fs').unlinkSync(require('path').join(__dirname,'z-missing.test.js'));console.log('Passed: 1, Failed: 0');",
      'z-missing.test.js': "console.log('Passed: 1, Failed: 0');",
    });
    assert.strictEqual(result.status, 1, 'missing planned file must fail the run');
    const report = assertCompleteReport(result, ['a-delete.test.js', 'z-missing.test.js'], 1);
    const missing = report.records.find(record => record.file === 'z-missing.test.js');
    assert.strictEqual(missing.outcome, 'failed');
    assert.ok(missing.error || missing.exitCode !== 0);
  }],
  ['report output path cannot leak into nested suite processes', () => {
    const result = fixtureRun({
      'nested.test.js': "if(Object.hasOwn(process.env,'ECC_TEST_REPORT'))throw new Error('parent report path leaked');console.log('Passed: 1, Failed: 0');",
    }, { jobs: 2 });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assertCompleteReport(result, ['nested.test.js']);
  }],
  ['an unwritable report target fails the run even when every suite passes', () => {
    const result = fixtureRun({ 'a.test.js': "console.log('Passed: 1, Failed: 0');" }, { reportDirectory: true });
    assert.strictEqual(result.status, 1, 'report write failure must fail execution integrity');
    assert.match(result.stdout + result.stderr, /report|manifest|EISDIR|EPERM/i);
  }],
  ['async child startup errors produce exactly one failed terminal record', () => {
    const result = fixtureRun({ 'a.test.js': "console.log('Passed: 1, Failed: 0');" }, { jobs: 2, spawnError: true });
    assert.strictEqual(result.status, 1);
    const report = assertCompleteReport(result, ['a.test.js'], 1);
    assert.strictEqual(report.records[0].outcome, 'failed');
    assert.match(report.records[0].error, /ENOENT|spawn/i);
  }],
  ['a discovered file missing before scheduling cannot be silently removed from the plan', () => {
    const result = run({ status: 1, stderr: 'Error: Cannot find module sample.test.js' }, 'sample.test.js', true, false);
    assert.strictEqual(result.status, 1);
    const records = result.logs.filter(line => line.startsWith('ECC_TEST_FILE ')).map(line => JSON.parse(line.slice('ECC_TEST_FILE '.length)));
    assert.strictEqual(records.length, 1, 'missing planned file gets exactly one terminal record');
    assert.strictEqual(records[0].file, 'sample.test.js');
    assert.strictEqual(records[0].outcome, 'failed');
  }],
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
      delete env.ECC_TEST_REPORT;
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
  ['worker pool runs every file, keeps per-file output grouped, and keeps the summary last', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-runner-pool-'));
    try {
      const testsDir = path.join(root, 'tests');
      fs.mkdirSync(testsDir);
      fs.writeFileSync(path.join(testsDir, 'run-all.js'), source);
      for (const [name, failures] of [['a', 0], ['b', 1], ['c', 0]]) {
        fs.writeFileSync(path.join(testsDir, `${name}.test.js`), [
          `console.log('BEGIN ${name}');`,
          `console.log('Passed: 2, Failed: ${failures}');`,
          `console.log('END ${name}');`,
        ].join('\n'));
      }
      const env = { ...process.env, ECC_TEST_JOBS: '3', PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` };
      delete env.ECC_TEST_REPORT;
      delete env.ECC_TEST_SKIP;
      delete env.ECC_TEST_ONLY;
      const result = spawnSync(process.execPath, [path.join(testsDir, 'run-all.js')], { encoding: 'utf8', env, timeout: 15000 });
      assert.ifError(result.error);
      assert.strictEqual(result.status, 1, result.stderr);
      assert.match(result.stdout, /Running 3 files with 3 parallel jobs/);
      for (const name of ['a', 'b', 'c']) {
        assert.match(result.stdout, new RegExp(`━━━ Running ${name}\\.test\\.js ━━━\\n(?:.*\\n)*?BEGIN ${name}\\n[^━]*END ${name}`), `output for ${name} stays grouped`);
      }
      assert.match(result.stdout, /✗ b\.test\.js reported 1 failed tests/);
      assert.match(result.stdout, /Files: 2 passed, 1 failed/);
      assert.ok(result.stdout.trimEnd().endsWith('Passed: 6, Failed: 1'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }],
  ['ECC_TEST_SERIAL files run one at a time after the pool drains', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-runner-serial-'));
    try {
      const testsDir = path.join(root, 'tests');
      fs.mkdirSync(testsDir);
      fs.writeFileSync(path.join(testsDir, 'run-all.js'), source);
      const marker = path.join(root, 'serial-marker');
      // Pool files sleep briefly; the serial file asserts nothing else is still running by
      // checking that both pool files already wrote their markers.
      for (const name of ['pool-a', 'pool-b']) {
        fs.writeFileSync(path.join(testsDir, `${name}.test.js`), [
          "setTimeout(() => {",
          `  require('fs').writeFileSync(${JSON.stringify(path.join(root, `${name}.done`))}, '1');`,
          "  console.log('Passed: 1, Failed: 0');",
          '}, 150);',
        ].join('\n'));
      }
      fs.writeFileSync(path.join(testsDir, 'opencode-dist.test.js'), [
        "const fs = require('fs');",
        `const done = ['pool-a', 'pool-b'].filter(n => fs.existsSync(${JSON.stringify(root)} + '/' + n + '.done')).length;`,
        `fs.writeFileSync(${JSON.stringify(marker)}, String(done));`,
        "console.log(done === 2 ? 'Passed: 1, Failed: 0' : 'Passed: 0, Failed: 1');",
        'process.exitCode = done === 2 ? 0 : 1;',
      ].join('\n'));
      const env = { ...process.env, ECC_TEST_JOBS: '3', ECC_TEST_SERIAL: 'opencode-dist', PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` };
      delete env.ECC_TEST_REPORT;
      delete env.ECC_TEST_SKIP;
      delete env.ECC_TEST_ONLY;
      const result = spawnSync(process.execPath, [path.join(testsDir, 'run-all.js')], { encoding: 'utf8', env, timeout: 15000 });
      assert.ifError(result.error);
      assert.strictEqual(result.status, 0, result.stdout);
      assert.match(result.stdout, /serial after the pool: opencode-dist/);
      assert.match(result.stdout, /Running 1 serial files after the pool/);
      assert.strictEqual(fs.readFileSync(marker, 'utf8'), '2');
      assert.match(result.stdout, /Files: 3 passed, 0 failed/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }],
  ['ECC_TEST_ONLY keeps just the files whose path contains a pattern', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-runner-only-'));
    try {
      const testsDir = path.join(root, 'tests');
      fs.mkdirSync(path.join(testsDir, 'lib'), { recursive: true });
      fs.mkdirSync(path.join(testsDir, 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(testsDir, 'run-all.js'), source);
      fs.writeFileSync(path.join(testsDir, 'lib', 'package-manager.test.js'), "console.log('Passed: 1, Failed: 0');");
      fs.writeFileSync(path.join(testsDir, 'hooks', 'hooks.test.js'), "console.log('Passed: 1, Failed: 0');");
      fs.writeFileSync(path.join(testsDir, 'lib', 'other.test.js'), "console.log('Passed: 0, Failed: 1'); process.exitCode = 1;");
      const env = { ...process.env, ECC_TEST_ONLY: 'package-manager, hooks/hooks.test', PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` };
      delete env.ECC_TEST_REPORT;
      delete env.ECC_TEST_SKIP;
      delete env.ECC_TEST_JOBS;
      const result = spawnSync(process.execPath, [path.join(testsDir, 'run-all.js')], { encoding: 'utf8', env, timeout: 15000 });
      assert.ifError(result.error);
      assert.strictEqual(result.status, 0, result.stdout);
      assert.match(result.stdout, /Only patterns: package-manager, hooks\/hooks\.test/);
      assert.ok(!result.stdout.includes('other.test.js'), 'unmatched file must not run');
      assert.match(result.stdout, /Files: 2 passed, 0 failed/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
