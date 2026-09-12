'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const childProcess = require('child_process');
const { CASES, OVERLAYS, overlay, selectCases } = require('./overlay.cjs');

const REVISIONS = new Set([
  '472cfa94fbf5fae05e46fbaaf7a3d08077ef6be3',
  '95b9fe157f815ef064793e49eacfecdbbfc5b813',
]);
const originalExecFileSync = childProcess.execFileSync;
const preload = path.join(__dirname, 'preload.cjs');
const testRelativePath = 'tests/scripts/install-apply.test.js';

function report(event, data) {
  fs.writeSync(1, `${JSON.stringify({ event, ...data })}\n`);
}

function checkSources(repo) {
  const selected = selectCases(fs.readFileSync(path.join(repo, testRelativePath), 'utf8'));
  assert.strictEqual((selected.match(/  if \(test\('/g) || []).length, 2);
  new vm.Script(Module.wrap(selected));
  for (const relative of Object.keys(OVERLAYS)) {
    const transformed = overlay(relative, fs.readFileSync(path.join(repo, relative), 'utf8'));
    new vm.Script(Module.wrap(transformed.replace(/^#![^\n]*\n/, '\n')));
  }
  return selected;
}

function childEnvironment(repo, temp) {
  const env = {};
  const allowed = new Set(['path', 'pathext', 'systemroot', 'windir', 'comspec', 'temp', 'tmp']);
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.has(key.toLowerCase())) env[key] = value;
  }
  return {
    ...env,
    HOME: temp,
    USERPROFILE: temp,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    ECC_DIAGNOSTIC_REPO: repo,
    CLAUDE_CODE_PACKAGE_MANAGER: 'yarn',
    CI: 'true',
  };
}

function instrumentedExec(command, args, options, tracePath, caseName) {
  // Keep the original helper's execFileSync call, stderr/stdout, error, and deadline.
  assert.strictEqual(command, 'node');
  assert.deepStrictEqual(args.slice(1), ['--profile', 'core', '--enable-hooks']);
  assert.strictEqual(path.resolve(args[0]), path.join(process.env.ECC_DIAGNOSTIC_REPO, 'scripts', 'install-apply.js'));
  assert.strictEqual(options.timeout, 30000);
  assert.deepStrictEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
  const fd = fs.openSync(tracePath, 'wx');
  const started = process.hrtime.bigint();
  let outcome = { status: 0, signal: null, error: null };
  try {
    return originalExecFileSync(command, ['--require', preload, ...args], {
      ...options,
      stdio: [...options.stdio, fd],
    });
  } catch (error) {
    outcome = {
      status: error.status ?? null,
      signal: error.signal ?? null,
      error: {
        code: error.code ?? null,
        errno: error.errno ?? null,
        syscall: error.syscall ?? null,
      },
    };
    throw error;
  } finally {
    fs.closeSync(fd);
    const trace = fs.readFileSync(tracePath, 'utf8');
    const lines = trace.trim().split('\n').filter(Boolean);
    // A killed write may leave one incomplete final line. Retain the raw trace too.
    let lastProgress = null;
    for (const line of lines) {
      try { lastProgress = JSON.parse(line); } catch { /* Retained below, never treated as a complete record. */ }
    }
    report('installer-outcome', {
      case: caseName,
      deadlineMs: options.timeout,
      elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
      ...outcome,
      lastProgress,
      traceBytes: Buffer.byteLength(trace),
    });
    fs.writeSync(1, trace);
  }
}

function runCases(repo) {
  assert.strictEqual(process.platform, 'win32', 'Real cases are restricted to hosted Windows');
  assert.strictEqual(process.versions.node.split('.')[0], '18');
  const source = checkSources(repo);
  let calls = 0;
  childProcess.execFileSync = (command, args, options) => {
    assert.ok(calls < 2, 'No extra installer invocations are permitted');
    const index = calls++;
    const caseName = globalThis[Symbol.for('ecc.windows-installer-diagnostic.case')];
    assert.ok(CASES.includes(caseName));
    return instrumentedExec(command, args, options,
      path.join(process.env.TEMP, `installer-${index}.jsonl`), caseName);
  };
  process.on('exit', () => {
    report('case-count', { expected: 2, observed: calls });
    if (calls !== 2) process.exitCode = 1;
  });
  const filename = path.join(repo, testRelativePath);
  const testModule = new Module(filename, module);
  testModule.filename = filename;
  testModule.paths = Module._nodeModulePaths(path.dirname(filename));
  testModule._compile(source, filename);
}

function selfCheck(repo) {
  checkSources(repo);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-diagnostic-wiring-'));
  try {
    const file = path.join(temp, 'synthetic.jsonl');
    const fd = fs.openSync(file, 'wx');
    const result = childProcess.spawnSync(process.execPath, ['--require', preload, '-e',
      "globalThis[Symbol.for('ecc.windows-installer-diagnostic')]('synthetic:wiring');"], {
      env: childEnvironment(repo, temp), cwd: temp,
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe', fd], timeout: 2000,
    });
    fs.closeSync(fd);
    assert.strictEqual(result.status, 0, result.stderr);
    const records = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepStrictEqual(records.map(record => record.phase), ['preload:ready', 'synthetic:wiring', 'process:exit']);
    const timeoutFile = path.join(temp, 'synthetic-timeout.jsonl');
    const timeoutFd = fs.openSync(timeoutFile, 'wx');
    let timeoutError;
    try {
      originalExecFileSync(process.execPath, ['--require', preload, '-e',
        "globalThis[Symbol.for('ecc.windows-installer-diagnostic')]('synthetic:blocked'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);"], {
        env: childEnvironment(repo, temp), cwd: temp, encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe', timeoutFd], timeout: 500,
      });
    } catch (error) {
      timeoutError = error;
    } finally {
      fs.closeSync(timeoutFd);
    }
    assert.strictEqual(timeoutError?.code, 'ETIMEDOUT');
    const timeoutRecords = fs.readFileSync(timeoutFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(timeoutRecords.at(-1).phase, 'synthetic:blocked');
    report('synthetic-wiring-pass', {
      installerProcesses: 0, records: records.length, platform: process.platform,
      syntheticTimeoutMs: 500, status: timeoutError.status, signal: timeoutError.signal,
      error: timeoutError.code, lastProgress: timeoutRecords.at(-1),
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function main() {
  const [mode, repoArg, revision] = process.argv.slice(2);
  const repo = path.resolve(repoArg || '.');
  if (mode === '--check') {
    checkSources(repo);
    report('source-wiring-pass', { cases: CASES, overlayFiles: Object.keys(OVERLAYS) });
    return;
  }
  if (mode === '--self-check') return selfCheck(repo);
  if (mode === '--cases') return runCases(repo);
  assert.strictEqual(mode, '--run');
  assert.strictEqual(process.platform, 'win32');
  assert.strictEqual(process.versions.node.split('.')[0], '18');
  assert.strictEqual(process.env.GITHUB_ACTIONS, 'true');
  assert.strictEqual(process.env.GITHUB_REF, 'refs/heads/ci/windows-installer-diagnostic-20260912');
  assert.ok(REVISIONS.has(revision), 'Only the pinned candidate and parent are permitted');
  const actual = originalExecFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.strictEqual(actual, revision);
  checkSources(repo);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-windows-installer-diagnostic-'));
  try {
    report('revision-start', { revision, node: process.version, platform: process.platform, cases: CASES });
    const result = childProcess.spawnSync(process.execPath, [__filename, '--cases', repo], {
      cwd: temp, env: childEnvironment(repo, temp), encoding: 'utf8',
      timeout: 90000, maxBuffer: 16 * 1024 * 1024,
    });
    fs.writeSync(1, result.stdout || '');
    report('revision-end', {
      revision, status: result.status, signal: result.signal,
      error: result.error ? { code: result.error.code } : null,
      stderr: result.stderr || '',
    });
    if (result.error || result.status === null) {
      // The supervisor may kill --cases before its finally block prints fd 3.
      // Recover synthetic traces while labeling them incomplete, never as an installer verdict.
      const traces = fs.readdirSync(temp).filter(name => /^installer-[01]\.jsonl$/.test(name));
      report('incomplete-diagnostic-evidence', {
        classification: 'supervisor-failure', recoveredFiles: traces.length,
      });
      for (const name of traces) {
        const raw = fs.readFileSync(path.join(temp, name), 'utf8');
        report('recovered-trace', { name, mayDuplicateEarlierOutput: true, incomplete: true });
        fs.writeSync(1, raw);
      }
    }
    process.exitCode = result.status === 0 && !result.error ? 0 : 1;
  } finally {
    try {
      fs.rmSync(temp, { recursive: true, force: true });
    } catch (error) {
      report('incomplete-diagnostic-evidence', { classification: 'cleanup-failure', code: error.code });
      process.exitCode = 1;
    }
  }
}

try {
  main();
} catch (error) {
  // The workflow retains stdout only; keep harness/preflight failures visible there.
  report(process.argv[2] === '--self-check' ? 'diagnostic-wiring-fail' : 'diagnostic-harness-fail', {
    classification: 'diagnostic-failure',
    error: { name: error.name, code: error.code ?? null, message: error.message },
  });
  process.exitCode = 1;
}
