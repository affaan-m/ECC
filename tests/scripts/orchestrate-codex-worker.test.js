'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const execFileSync = require('child_process').execFileSync;

const IS_WSL_BASH = spawnSync('bash', ['-lc', 'test -d /mnt/c -o -d /mnt/d'], {
  stdio: 'ignore',
}).status === 0;

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'orchestrate-codex-worker.sh');

function toBashPath(filePath) {
  if (IS_WSL_BASH) {
    return String(filePath)
      .replace(/^([A-Za-z]):/, (_, driveLetter) => `/mnt/${driveLetter.toLowerCase()}`)
      .replace(/\\/g, '/');
  }

  if (process.platform !== 'win32') {
    return filePath;
  }

  try {
    return execFileSync('bash', ['-lc', 'cygpath -u -- "$1"', 'bash', filePath], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return String(filePath)
      .replace(/^([A-Za-z]):/, (_, driveLetter) => `/${driveLetter.toLowerCase()}`)
      .replace(/\\/g, '/');
  }
}

console.log('=== Testing orchestrate-codex-worker.sh ===\n');

let passed = 0;
let failed = 0;


if (IS_WSL_BASH && process.platform === 'win32') {
  console.log('  - orchestrate-codex-worker.sh integration test (skipped on Windows/WSL path bridge)');
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(0);
}

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
test('fails fast for an unreadable task file and records failure artifacts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-orch-worker-'));
  const handoffFile = path.join(tempRoot, '.orchestration', 'docs', 'handoff.md');
  const statusFile = path.join(tempRoot, '.orchestration', 'docs', 'status.md');
  const missingTaskFile = path.join(tempRoot, '.orchestration', 'docs', 'task.md');

  try {
    spawnSync('git', ['init'], { cwd: tempRoot, stdio: 'ignore' });

    const result = spawnSync('bash', ['-s', '--', toBashPath(missingTaskFile), toBashPath(handoffFile), toBashPath(statusFile)], {
      cwd: tempRoot,
      encoding: 'utf8',
      input: fs.readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n')
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
