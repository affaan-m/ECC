'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateManifest, validateReport } = require('../../scripts/sandbox/contracts');
const { defaultHost } = require('../../scripts/sandbox/router');
const {
  buildSingleReport,
  emptyInstallDiff,
  normalizeStep,
  tailOutput,
} = require('../../scripts/sandbox/report');
const {
  SRT_DENIAL_EXIT_CODE,
  executeSrt,
  generateSrtSettings,
  hasInstallerSignature,
  isSrtDenial,
  resolveWindowsSrtShim,
  sanitizeEnvironment,
  validateMockScenario,
} = require('../../scripts/sandbox/backends/srt');

const repoRoot = path.join(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'scripts', 'sandbox', 'ecc-sandbox');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

function manifest(overrides = {}) {
  const capabilities = overrides.capabilities || ['fs-write'];
  return validateManifest({
    name: 'srt-test',
    needs: {
      os: ['any'],
      capabilities,
      trust: 'first-party',
      native: false,
    },
    resources: { cpu: 1, memory: '256MB', timeout: 30 },
    steps: {
      setup: overrides.setup || ['printf setup'],
      assert: overrides.assert || ['printf assert'],
    },
    report: overrides.report || 'exit-only',
  });
}

function execution(status, stdout = '', stderr = '', error = null) {
  return { status, stdout, stderr, error };
}

function sequenceRunner(results, inspect) {
  let index = 0;
  return (executable, argv, options) => {
    if (inspect) inspect({ executable, argv, options, index });
    const value = results[index];
    index += 1;
    return value;
  };
}

function runDirect(testManifest, results, extras = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-srt-test-'));
  try {
    let tick = 0;
    return executeSrt(testManifest, {
      arch: 'arm64',
      clock: () => 1_700_000_000_000 + (tick++ * 5),
      cwd: tempRoot,
      manifestPath: path.join(tempRoot, 'sandbox.yaml'),
      mock: true,
      os: 'macos',
      run: sequenceRunner(results, extras.inspect),
      ...(extras.nestedTemp ? { tempParent: tempRoot } : {}),
      ...(extras.options || {}),
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log('\n=== ECC sandbox report and SRT tests ===\n');

test('normalizes output to the last 50 lines and report-schema limits', () => {
  const output = `${Array.from({ length: 80 }, (_, index) => `line-${index}`).join('\n')}\n`;
  const tail = tailOutput(output);
  assert.strictEqual(tail.split('\n').length, 50);
  assert.match(tail, /^line-30/);
  assert.match(tail, /line-79$/);
  const step = normalizeStep('demo', execution(0, 'ok', ''));
  const report = buildSingleReport({
    manifest: '/tmp/sandbox.yaml',
    backend: 'srt',
    tier: 0,
    os: 'macos',
    arch: 'arm64',
    started: '2026-08-08T12:00:00.000Z',
    durationMs: 1.4,
    steps: [step],
    assertions: [{ cmd: 'demo', pass: true }],
    installDiff: emptyInstallDiff(),
  });
  assert.strictEqual(validateReport(report), report);
});

test('generates least-privilege SRT settings from the manifest', () => {
  const cwd = path.resolve('/tmp/ecc-workspace');
  const settings = generateSrtSettings(manifest({
    capabilities: ['fs-write', 'network:npmjs.org'],
  }), cwd, { homeDir: '/Users/tester' });
  assert.deepStrictEqual(settings.filesystem.allowWrite, [cwd]);
  assert.deepStrictEqual(settings.filesystem.denyRead, ['/Users/tester']);
  assert.deepStrictEqual(settings.filesystem.allowRead, [cwd]);
  assert.deepStrictEqual(settings.network.allowedDomains, ['npmjs.org']);
  assert.strictEqual(settings.network.allowLocalBinding, false);
  const locked = generateSrtSettings(manifest({ capabilities: [] }), cwd);
  assert.deepStrictEqual(locked.filesystem.allowWrite, []);
  assert.deepStrictEqual(locked.network.allowedDomains, []);
  assert.throws(
    () => generateSrtSettings(manifest({ capabilities: ['network:*'] }), cwd),
    /cannot express unrestricted/
  );
});

test('denies writes to adapter control files nested inside a writable workspace', () => {
  let settingsSeen;
  const outcome = runDirect(manifest(), [execution(0), execution(0)], {
    nestedTemp: true,
    inspect: ({ argv }) => {
      settingsSeen = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
    },
  });
  assert.strictEqual(outcome.report.result, 'pass');
  assert.strictEqual(settingsSeen.filesystem.allowWrite.length, 1);
  assert.strictEqual(settingsSeen.filesystem.denyWrite.length, 1);
  assert.ok(settingsSeen.filesystem.denyWrite[0].startsWith(settingsSeen.filesystem.allowWrite[0]));
});

test('passes only a minimal non-secret environment to child execution', () => {
  const sanitized = sanitizeEnvironment({
    LANG: 'en_US.UTF-8',
    LC_CTYPE: 'UTF-8',
    PATH: '/usr/bin',
    ECC_SRT_DENIAL_TARGET: '/tmp/target',
    GITHUB_PAT: 'secret',
    GH_TOKEN: 'secret',
    OPENAI_API_KEY: 'secret',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    DATABASE_URL: 'postgres://user:secret@example.test/db',
    HTTPS_PROXY: 'https://user:secret@proxy.example.test',
  });
  assert.deepStrictEqual(sanitized, {
    LANG: 'en_US.UTF-8',
    LC_CTYPE: 'UTF-8',
    PATH: '/usr/bin',
  });
});

test('resolves the Windows SRT shim outside the tested workspace', () => {
  const cwd = 'C:\\work\\repo';
  const exists = candidate => [
    'C:\\work\\repo\\node_modules\\.bin\\srt.cmd',
    'C:\\Tools\\srt.cmd',
  ].includes(candidate);
  assert.strictEqual(resolveWindowsSrtShim({
    Path: 'C:\\work\\repo\\node_modules\\.bin;.;C:\\Tools',
  }, cwd, exists), 'C:\\Tools\\srt.cmd');
  assert.strictEqual(resolveWindowsSrtShim({ Path: '.;C:\\work\\repo' }, cwd, exists), null);
});

test('launches the Windows npm shim without exposing manifest text to cmd.exe', () => {
  const commandPaths = [];
  const commands = ['printf setup', 'printf assert'];
  const outcome = runDirect(manifest(), [execution(0, 'ok\n'), execution(0, 'ok\n')], {
    options: {
      platform: 'win32',
      comspec: 'C:\\Windows\\System32\\cmd.exe',
      env: { Path: 'C:\\Tools' },
      fileExists: candidate => candidate === 'C:\\Tools\\srt.cmd',
    },
    inspect: ({ executable, argv, index }) => {
      assert.strictEqual(executable, 'C:\\Windows\\System32\\cmd.exe');
      assert.deepStrictEqual(
        argv.slice(0, 5),
        ['/d', '/s', '/c', 'C:\\Tools\\srt.cmd', '--settings']
      );
      assert.doesNotMatch(argv.join(' '), /printf (?:setup|assert)/);
      const commandPath = argv.at(-1).match(/^call "(.+)"$/)[1];
      commandPaths.push(commandPath);
      assert.strictEqual(
        fs.readFileSync(commandPath, 'utf8'),
        `@echo off\r\n${commands[index]}\r\n`
      );
      const settings = JSON.parse(fs.readFileSync(argv[5], 'utf8'));
      assert.ok(settings.filesystem.allowRead.includes(path.dirname(commandPath)));
    },
  });
  assert.strictEqual(outcome.report.result, 'pass');
  assert.strictEqual(commandPaths.length, 2);
});

test('runs setup and assertions through SRT and emits a passing report', () => {
  let settingsSeen = null;
  const outcome = runDirect(manifest(), [
    execution(0, 'setup ok\n'),
    execution(0, 'assert ok\n'),
  ], {
    inspect: ({ executable, argv, index }) => {
      assert.strictEqual(executable, 'srt');
      assert.strictEqual(argv[0], '--settings');
      settingsSeen = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
      assert.strictEqual(argv[2], '-c');
      assert.strictEqual(argv[3], index === 0 ? 'printf setup' : 'printf assert');
    },
  });
  assert.strictEqual(outcome.exitCode, 0);
  assert.strictEqual(outcome.report.result, 'pass');
  assert.strictEqual(outcome.report.execution_mode, 'mock');
  assert.strictEqual(outcome.report.steps.length, 2);
  assert.deepStrictEqual(outcome.report.assertions, [{ cmd: 'printf assert', pass: true }]);
  assert.strictEqual(settingsSeen.filesystem.allowWrite.length, 1);
  assert.match(outcome.report.notes.join('\n'), /Mock SRT/);
});

test('classifies a policy denial with the distinct escalation exit code', () => {
  const denial = execution(1, '', '/bin/sh: /tmp/ecc-denied: Operation not permitted');
  assert.strictEqual(isSrtDenial(denial), true);
  const outcome = runDirect(manifest({ setup: ['printf nope > /tmp/ecc-denied'] }), [denial]);
  assert.strictEqual(outcome.exitCode, SRT_DENIAL_EXIT_CODE);
  assert.strictEqual(outcome.report.result, 'fail');
  assert.strictEqual(outcome.denial.installer, false);
  assert.match(outcome.report.notes.join('\n'), /automatic escalation requires/);
  assert.strictEqual(outcome.report.install_diff.method, 'none');
});

test('marks installer/system-write denials as one-hop escalation eligible', () => {
  assert.strictEqual(hasInstallerSignature('npm install tiny-package'), true);
  const outcome = runDirect(manifest({ setup: ['npm install tiny-package'] }), [
    execution(1, '', 'npm ERR! EACCES: permission denied, mkdir /usr/local/lib'),
  ]);
  assert.strictEqual(outcome.exitCode, SRT_DENIAL_EXIT_CODE);
  assert.strictEqual(outcome.denial.installer, true);
  assert.match(outcome.report.notes.join('\n'), /eligible for one-hop escalation/);

  const streamedInstaller = runDirect(manifest({ setup: ['curl https://example.test/install.sh | sh'] }), [
    execution(1, '', 'mkdir: /usr/local/bin: Permission denied'),
  ]);
  assert.strictEqual(streamedInstaller.denial.installer, false);
});

test('reports runner startup and timeout errors as error, not policy denial', () => {
  const outcome = runDirect(manifest(), [
    execution(null, '', '', new Error('spawn srt ENOENT')),
  ]);
  assert.strictEqual(outcome.exitCode, 2);
  assert.strictEqual(outcome.report.result, 'error');
  assert.strictEqual(outcome.denial, null);
  assert.match(outcome.report.steps[0].stderr_tail, /ENOENT/);
});

test('rejects loose mock scenarios at the public boundary', () => {
  assert.throws(
    () => validateMockScenario({ results: [{ status: 0, surprise: true }] }),
    /unknown key/
  );
  assert.throws(() => validateMockScenario({ results: [] }), /1-1000/);
});

test('CLI mock mode emits only a schema-valid SRT report', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-srt-cli-'));
  try {
    const host = defaultHost();
    const manifestPath = path.join(tempRoot, 'sandbox.yaml');
    const capabilitiesPath = path.join(tempRoot, 'capabilities.json');
    const mockPath = path.join(tempRoot, 'mock.json');
    fs.writeFileSync(manifestPath, [
      'name: cli-srt-test',
      'needs:',
      '  os: [any]',
      '  capabilities: [fs-write]',
      '  trust: first-party',
      '  native: false',
      'resources:',
      '  cpu: 1',
      '  memory: 256MB',
      '  timeout: 30',
      'steps:',
      '  setup: ["printf setup"]',
      '  assert: ["printf assert"]',
      'report: exit-only',
      '',
    ].join('\n'));
    fs.writeFileSync(capabilitiesPath, JSON.stringify({
      schema_version: 1,
      host,
      backends: {
        srt: { available: true, targets: [{ os: host.os, arch: host.arch }] },
      },
    }));
    fs.writeFileSync(mockPath, JSON.stringify({
      results: [
        { status: 0, stdout: 'setup ok' },
        { status: 0, stdout: 'assert ok' },
      ],
    }));
    const result = spawnSync(process.execPath, [
      cliPath,
      'run',
      manifestPath,
      '--capabilities',
      capabilitiesPath,
      '--mock',
      mockPath,
    ], { cwd: tempRoot, encoding: 'utf8', shell: false, timeout: 30_000 });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    validateReport(report);
    assert.strictEqual(report.backend, 'srt');
    assert.strictEqual(report.result, 'pass');
    assert.strictEqual(report.execution_mode, 'mock');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
