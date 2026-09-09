'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const { createRun, listEvents } = require('../../scripts/sandbox/session-store');
const {
  boundedClassificationCapture,
  splitUtf8Prefix,
  streamCommand,
} = require('../../scripts/sandbox/stream-exec');
const { tailOutput } = require('../../scripts/sandbox/report');
const { runStreaming } = require('../../scripts/sandbox/stream-runner');

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

function withRun(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-stream-runner-test-'));
  try {
    const created = createRun({
      root,
      manifestPath: '/repo/sandbox.yaml',
      manifestDigest: 'a'.repeat(64),
      route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
    });
    return fn({ root, runId: created.run_id });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('\n=== ECC sandbox stream runner tests ===\n');

test('matches classification signatures incrementally across capture chunks', () => {
  const capture = boundedClassificationCapture(128);
  capture.append('prefix permis');
  capture.append('sion denied by sandbox policy\n');
  capture.append('x\n'.repeat(256));
  capture.append('\ntail\n');
  const output = capture.value().toString('utf8');
  assert.ok(Buffer.byteLength(output, 'utf8') <= 128);
  assert.match(output, /permission denied/);
  assert.match(output, /tail\n$/);
  assert.match(tailOutput(output), /permission denied/);
});

test('splits long multibyte lines by encoded bytes without corrupting text', () => {
  const text = `${'é'.repeat(10_000)}tail`;
  const [prefix, remainder] = splitUtf8Prefix(text, 16 * 1024);
  assert.ok(Buffer.byteLength(prefix, 'utf8') <= 16 * 1024);
  assert.strictEqual(`${prefix}${remainder}`, text);
  assert.doesNotMatch(prefix, /�/);
  assert.doesNotMatch(remainder, /�/);
});

test('returns bounded output tails without interrupting streamed commands', () => withRun(({ root, runId }) => {
  const maxBuffer = 512;
  const script = [
    "process.stdout.write('stdout-start\\n' + 'o'.repeat(1024) + '\\nstdout-tail\\n')",
    "process.stderr.write('stderr-start\\n' + 'e'.repeat(1024) + '\\nstderr-tail\\n')",
  ].join(';');

  const result = runStreaming(process.execPath, ['-e', script], {
    encoding: 'utf8',
    maxBuffer,
    streamOutput: { runId, root, phase: 'assert' },
  });

  assert.ifError(result.error);
  assert.strictEqual(result.status, 0);
  assert.ok(Buffer.byteLength(result.stdout, 'utf8') <= maxBuffer);
  assert.ok(Buffer.byteLength(result.stderr, 'utf8') <= maxBuffer);
  assert.match(result.stdout, /stdout-tail\n$/);
  assert.match(result.stderr, /stderr-tail\n$/);

  const events = listEvents(runId, root);
  const journal = stream => events
    .filter(event => event.stream === stream)
    .map(event => event.text)
    .join('');
  assert.match(journal('stdout'), /^stdout-start\n/);
  assert.match(journal('stdout'), /stdout-tail\n$/);
  assert.match(journal('stderr'), /^stderr-start\n/);
  assert.match(journal('stderr'), /stderr-tail\n$/);
}));

test('retains early split classification signals alongside bounded output tails', () => withRun(({ root, runId }) => {
  const maxBuffer = 256;
  const script = [
    "process.stderr.write('permis')",
    "process.stdout.write('System has not been booted with syst')",
    "setTimeout(() => {",
    "  process.stderr.write('sion denied by sandbox policy\\n' + 'e'.repeat(2048) + '\\nstderr-tail\\n')",
    "  process.stdout.write('emd as init system\\n' + 'o'.repeat(2048) + '\\nstdout-tail\\n')",
    "}, 20)",
  ].join(';');

  const result = runStreaming(process.execPath, ['-e', script], {
    encoding: 'utf8',
    maxBuffer,
    streamOutput: { runId, root, phase: 'assert' },
  });

  assert.ifError(result.error);
  assert.strictEqual(result.status, 0);
  assert.ok(Buffer.byteLength(result.stdout, 'utf8') <= maxBuffer);
  assert.ok(Buffer.byteLength(result.stderr, 'utf8') <= maxBuffer);
  assert.match(result.stdout, /System has not been booted with systemd as init system/i);
  assert.match(result.stderr, /permission denied/i);
  assert.match(result.stdout, /stdout-tail\n$/);
  assert.match(result.stderr, /stderr-tail\n$/);
}));

test('never writes raw child secrets to inherited terminal streams', () => withRun(({ root, runId }) => {
  const runnerPath = path.join(__dirname, '..', '..', 'scripts', 'sandbox', 'stream-runner.js');
  const resultPath = path.join(root, 'classification.json');
  const stdoutSecret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890';
  const stderrSecret = 'sk-abcdefghijklmnopqrstuvwx';
  const command = [
    `process.stdout.write('token=${stdoutSecret} permission denied\\n')`,
    `process.stderr.write('Authorization: Bearer ${stderrSecret} failed to connect to bus\\n')`,
  ].join(';');
  const harness = [
    `const fs = require('fs')`,
    `const { runStreaming } = require(${JSON.stringify(runnerPath)})`,
    `const result = runStreaming(process.execPath, ['-e', ${JSON.stringify(command)}], {`,
    "  encoding: 'utf8', maxBuffer: 256,",
    `  streamOutput: ${JSON.stringify({ runId, root, phase: 'assert' })},`,
    '})',
    `fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ stdout: result.stdout, stderr: result.stderr }))`,
  ].join('\n');

  const terminal = spawnSync(process.execPath, ['-e', harness], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
  });

  assert.ifError(terminal.error);
  assert.strictEqual(terminal.status, 0);
  assert.strictEqual(terminal.stdout.includes(stdoutSecret), false, 'raw stdout secret leaked');
  assert.strictEqual(terminal.stderr.includes(stderrSecret), false, 'raw stderr secret leaked');
  assert.match(terminal.stdout, /\[REDACTED\].*permission denied/);
  assert.match(terminal.stderr, /\[REDACTED\].*failed to connect to bus/);

  const captured = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.ok(Buffer.byteLength(captured.stdout, 'utf8') <= 256);
  assert.ok(Buffer.byteLength(captured.stderr, 'utf8') <= 256);
  assert.match(captured.stdout, /permission denied/);
  assert.match(captured.stderr, /failed to connect to bus/);
  const journal = listEvents(runId, root).map(event => event.text).join('');
  assert.strictEqual(journal.includes(stdoutSecret), false, 'raw stdout secret reached journal');
  assert.strictEqual(journal.includes(stderrSecret), false, 'raw stderr secret reached journal');
  assert.match(journal, /\[REDACTED\]/);
}));

test('redacts a Bearer token split at a forced long-line boundary', () => withRun(({ root, runId }) => {
  const runnerPath = path.join(__dirname, '..', '..', 'scripts', 'sandbox', 'stream-runner.js');
  const resultPath = path.join(root, 'split-secret-classification.json');
  const secret = 'splitboundarytoken1234567890';
  const prefixSplitSecret = 'prefixsplitsecret1234567890';
  const bearer = 'Bearer ';
  const command = [
    `const prefix = 'x'.repeat(${16 * 1024} - ${bearer.length} - 1) + ' ' + ${JSON.stringify(bearer)}`,
    `process.stdout.write(prefix + ${JSON.stringify(secret)} + 'y'.repeat(48 * 1024) + ' permission denied tail')`,
    `const splitPrefix = 'z'.repeat(${16 * 1024 - 256} - 5) + ' Bear'`,
    `process.stderr.write(splitPrefix + 'er ' + ${JSON.stringify(prefixSplitSecret)} + 'q'.repeat(48 * 1024) + ' failed to connect to bus tail')`,
  ].join(';');
  const harness = [
    `const fs = require('fs')`,
    `const { runStreaming } = require(${JSON.stringify(runnerPath)})`,
    `const result = runStreaming(process.execPath, ['-e', ${JSON.stringify(command)}], {`,
    "  encoding: 'utf8', maxBuffer: 512,",
    `  streamOutput: ${JSON.stringify({ runId, root, phase: 'assert' })},`,
    '})',
    `fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ stdout: result.stdout, stderr: result.stderr }))`,
  ].join('\n');

  const terminal = spawnSync(process.execPath, ['-e', harness], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });

  assert.ifError(terminal.error);
  assert.strictEqual(terminal.status, 0);
  assert.strictEqual(terminal.stdout.includes(secret), false, 'split secret leaked to terminal');
  assert.strictEqual(terminal.stderr.includes(prefixSplitSecret), false, 'prefix-split secret leaked to terminal');
  assert.match(terminal.stdout, /\[REDACTED\]/);
  assert.match(terminal.stderr, /\[REDACTED\]/);
  const captured = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.strictEqual(captured.stdout.includes(secret), false, 'split secret leaked to capture');
  assert.strictEqual(captured.stderr.includes(prefixSplitSecret), false, 'prefix-split secret leaked to capture');
  assert.ok(Buffer.byteLength(captured.stdout, 'utf8') <= 512);
  assert.ok(Buffer.byteLength(captured.stderr, 'utf8') <= 512);
  assert.match(captured.stdout, /permission denied/);
  assert.match(captured.stderr, /failed to connect to bus/);
  const journal = listEvents(runId, root).map(event => event.text).join('');
  assert.strictEqual(journal.includes(secret), false, 'split secret leaked to journal');
  assert.strictEqual(journal.includes(prefixSplitSecret), false, 'prefix-split secret leaked to journal');
  assert.match(journal, /\[REDACTED\]/);
}));

test('forwards caller input to the streamed command', () => withRun(({ root, runId }) => {
  const result = runStreaming(process.execPath, [
    '-e',
    "process.stdin.once('data', chunk => process.stdout.write(`received:${chunk}`))",
  ], {
    encoding: 'utf8',
    input: 'hello\n',
    maxBuffer: 512,
    streamOutput: { runId, root, phase: 'setup' },
  });

  assert.ifError(result.error);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, 'received:hello\n');
}));

test('returns wrapper startup diagnostics through captured stderr', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-stream-missing-run-'));
  try {
    const result = runStreaming(process.execPath, ['-e', 'process.exit(0)'], {
      encoding: 'utf8',
      maxBuffer: 512,
      streamOutput: { runId: `run_${'0'.repeat(32)}`, root, phase: 'setup' },
    });
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /Sandbox session is unavailable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves spawn ENOENT metadata for streamed commands', () => withRun(({ root, runId }) => {
  const executable = path.join(root, 'missing-executable');
  const result = runStreaming(executable, [], {
    encoding: 'utf8',
    maxBuffer: 512,
    streamOutput: { runId, root, phase: 'setup' },
  });
  assert.strictEqual(result.status, null);
  assert.strictEqual(result.signal, null);
  assert.strictEqual(result.error?.code, 'ENOENT');
  assert.strictEqual(result.error?.path, executable);
  assert.match(result.stderr, /ENOENT/);
}));

test('preserves child termination signals for streamed commands', () => withRun(({ root, runId }) => {
  const result = runStreaming(process.execPath, [
    '-e', "process.kill(process.pid, 'SIGTERM')",
  ], {
    encoding: 'utf8',
    maxBuffer: 512,
    streamOutput: { runId, root, phase: 'assert' },
  });
  assert.strictEqual(result.status, null);
  assert.strictEqual(result.signal, 'SIGTERM');
  assert.strictEqual(result.error, undefined);
  assert.match(result.stderr, /terminated by SIGTERM/);
}));

test('does not require POSIX process inspection for simulated Windows execution', () => withRun(({ root, runId }) => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const kills = [];
  child.kill = signal => kills.push(signal);
  let inspected = false;
  const previousExitCode = process.exitCode;
  try {
    streamCommand({
      runId, root, phase: 'setup', captureBytes: 0,
      executable: 'mock.exe', argv: [],
    }, {
      platform: 'win32',
      spawn: () => child,
      processIdentity: () => {
        inspected = true;
        throw new Error('POSIX process inspection is unavailable');
      },
    });
    child.emit('spawn');
    child.stdout.emit('data', Buffer.from('valid output\n'));
    child.emit('close', 0, null);
    assert.strictEqual(inspected, false);
    assert.deepStrictEqual(kills, []);
    assert.strictEqual(listEvents(runId, root).at(-1).text, 'valid output\n');
  } finally {
    process.exitCode = previousExitCode;
  }
}));

test('does not leak capture-pipe errors when a streamed command times out', () => withRun(({ root, runId }) => {
  const runnerPath = path.join(__dirname, '..', '..', 'scripts', 'sandbox', 'stream-runner.js');
  const command = [
    "process.on('SIGTERM', () => {})",
    "process.stderr.write('permission denied\\n')",
    'setTimeout(() => {}, 5000)',
  ].join(';');
  const harness = [
    `const { runStreaming } = require(${JSON.stringify(runnerPath)})`,
    `runStreaming(process.execPath, ['-e', ${JSON.stringify(command)}], {`,
    "  encoding: 'utf8', maxBuffer: 512, timeout: 50,",
    `  streamOutput: ${JSON.stringify({ runId, root, phase: 'assert' })},`,
    '})',
  ].join('\n');

  const result = spawnSync(process.execPath, ['-e', harness], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    timeout: 5_000,
  });

  assert.ifError(result.error);
  assert.doesNotMatch(result.stderr, /(?:write\s+)?EPIPE/);
}));

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
