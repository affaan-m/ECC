'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'orchestrate-codex-worker.sh');

console.log('=== Testing orchestrate-codex-worker.sh ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${desc}: ${error.message}`);
    failed++;
  }
}

function runWorker({ policy, exitCode = 0 } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-orch-worker-'));
  const binDir = path.join(tempRoot, 'bin');
  const captureFile = path.join(tempRoot, 'args.json');
  const taskFile = path.join(tempRoot, 'task.md');
  const handoffFile = path.join(tempRoot, 'handoff.md');
  const statusFile = path.join(tempRoot, 'status.md');

  try {
    fs.mkdirSync(binDir);
    fs.writeFileSync(taskFile, 'Make a focused change.');
    fs.writeFileSync(path.join(binDir, 'codex'), `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.ECC_TEST_CAPTURE, JSON.stringify(args));
// Approval is a global option, not an exec option in current Codex CLI.
const execIndex = args.indexOf('exec');
if (execIndex < 0 || args.indexOf('--ask-for-approval') > execIndex) {
  console.error("unexpected argument '--ask-for-approval' found");
  process.exit(2);
}
const outputIndex = args.indexOf('-o');
fs.writeFileSync(args[outputIndex + 1], 'Completed the focused task.');
process.exit(Number(process.env.ECC_TEST_EXIT));
`, { mode: 0o755 });
    spawnSync('git', ['init'], { cwd: tempRoot, stdio: 'ignore' });
    const env = { ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      ECC_TEST_CAPTURE: captureFile,
      ECC_TEST_EXIT: String(exitCode),
      ECC_CODEX_APPROVAL_POLICY: policy || 'never'
    };
    const result = spawnSync('bash', [SCRIPT, taskFile, handoffFile, statusFile], {
      cwd: tempRoot, env, encoding: 'utf8', timeout: 10000
    });
    return {
      ...result,
      args: fs.existsSync(captureFile) ? JSON.parse(fs.readFileSync(captureFile, 'utf8')) : null,
      handoff: fs.existsSync(handoffFile) ? fs.readFileSync(handoffFile, 'utf8') : '',
      workerStatus: fs.readFileSync(statusFile, 'utf8')
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('starts a worker with the current CLI grammar and configured model', () => {
  const result = runWorker();
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(!result.args.includes('-m') && !result.args.includes('--model'),
    'Worker should inherit the configured model rather than pin a retired model');
  assert.ok(result.handoff.includes('Completed the focused task.'));
  assert.ok(result.workerStatus.includes('- State: completed'));
});

test('forwards the explicit supported approval policy', () => {
  const result = runWorker({ policy: 'on-request' });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.args[result.args.indexOf('--ask-for-approval') + 1], 'on-request');
});

test('rejects the deprecated approval policy before invoking Codex', () => {
  const result = runWorker({ policy: 'on-failure' });
  assert.notStrictEqual(result.status, 0);
  assert.strictEqual(result.args, null);
  assert.ok(result.workerStatus.includes('unsupported approval policy'));
});

test('records failure artifacts when a started worker exits nonzero', () => {
  const result = runWorker({ exitCode: 1 });
  assert.strictEqual(result.status, 1);
  assert.ok(result.args);
  assert.ok(result.workerStatus.includes('- State: failed'));
  assert.ok(result.handoff.includes('The Codex worker exited with a non-zero status.'));
});

test('fails fast for an unreadable task file and records failure artifacts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-orch-worker-'));
  const handoffFile = path.join(tempRoot, '.orchestration', 'docs', 'handoff.md');
  const statusFile = path.join(tempRoot, '.orchestration', 'docs', 'status.md');
  const missingTaskFile = path.join(tempRoot, '.orchestration', 'docs', 'task.md');

  try {
    spawnSync('git', ['init'], { cwd: tempRoot, stdio: 'ignore' });

    const result = spawnSync('bash', [SCRIPT, missingTaskFile, handoffFile, statusFile], {
      cwd: tempRoot,
      encoding: 'utf8'
    });

    assert.notStrictEqual(result.status, 0, 'Script should fail when task file is unreadable');
    assert.ok(fs.existsSync(statusFile), 'Script should still write a status file');
    assert.ok(fs.existsSync(handoffFile), 'Script should still write a handoff file');

    const statusContent = fs.readFileSync(statusFile, 'utf8');
    const handoffContent = fs.readFileSync(handoffFile, 'utf8');

    assert.ok(statusContent.includes('- State: failed'), 'Status file should record the failure state');
    assert.ok(
      statusContent.includes('task file is missing or unreadable'),
      'Status file should explain the task-file failure'
    );
    assert.ok(
      handoffContent.includes('Task file is missing or unreadable'),
      'Handoff file should explain the task-file failure'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
