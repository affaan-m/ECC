'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { validateExecutionPlan, validateTrajectory } = require('../../scripts/sandbox/fabric/contracts');
const { validateReport } = require('../../scripts/sandbox/contracts');

const cliPath = path.join(__dirname, '..', '..', 'scripts', 'sandbox', 'ecc-sandbox');

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ECC Real Test',
      GIT_AUTHOR_EMAIL: 'ecc-real-test@example.invalid',
      GIT_COMMITTER_NAME: 'ECC Real Test',
      GIT_COMMITTER_EMAIL: 'ecc-real-test@example.invalid',
    },
  }).trim();
}

function commandAvailable(command) {
  const check = spawnSync(command, ['--version'], { encoding: 'utf8', shell: false, timeout: 5_000 });
  return !check.error;
}

console.log('\n=== ECC sandbox real Tier 0 fabric CLI test ===\n');

if (!commandAvailable('srt')) {
  console.log('  - skipped: real SRT is unavailable');
  process.exit(0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-real-'));
let artifactDirectory = null;
try {
  git(root, 'init', '-b', 'main');
  const manifestPath = path.join(root, 'sandbox.yaml');
  const capabilitiesPath = path.join(root, 'capabilities.json');
  fs.writeFileSync(manifestPath, [
    'name: fabric-real-tier0',
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
    '  setup: ["printf candidate > fabric-marker.txt"]',
    '  assert:',
    '    - test -f fabric-marker.txt && test "$(cat fabric-marker.txt)" = candidate',
    'report: exit-only',
    '',
  ].join('\n'));
  fs.writeFileSync(capabilitiesPath, JSON.stringify({
    schema_version: 1,
    host: {
      os: process.platform === 'darwin' ? 'macos' : 'linux',
      arch: process.arch === 'x64' ? 'x86_64' : process.arch,
      cpus: os.cpus().length,
      inside_container: false,
      virtualization: 'available',
    },
    backends: {
      srt: {
        available: true,
        targets: [{
          os: process.platform === 'darwin' ? 'macos' : 'linux',
          arch: process.arch === 'x64' ? 'x86_64' : process.arch,
        }],
      },
    },
  }));
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'real fixture');

  const cli = spawnSync(process.execPath, [
    cliPath, 'fabric', manifestPath,
    '--workspace-mode', 'worktree',
    '--candidate-ref', 'refs/heads/ecc/candidates/fabric-real-test',
    '--local-only',
    '--capabilities', capabilitiesPath,
  ], { cwd: root, encoding: 'utf8', shell: false, timeout: 60_000 });

  assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout);
  assert.strictEqual(cli.stderr, '');
  const outcome = JSON.parse(cli.stdout);
  artifactDirectory = outcome.run_directory;
  assert.strictEqual(outcome.kind, 'ecc.sandbox.fabric-run');
  assert.strictEqual(outcome.result, 'pass');
  assert.match(outcome.run_id, /^run_[a-f0-9]{32}$/);
  assert.strictEqual(outcome.plan.plan_id, outcome.run_id.replace(/^run_/, 'plan_'));
  assert.strictEqual(path.basename(outcome.run_directory), outcome.run_id);
  assert.strictEqual(validateExecutionPlan(outcome.plan), outcome.plan);
  assert.strictEqual(validateReport(outcome.report), outcome.report);
  assert.strictEqual(validateTrajectory(outcome.trajectory), outcome.trajectory);
  assert.strictEqual(outcome.report.backend, 'srt');
  assert.strictEqual(outcome.report.execution_mode, 'real');
  assert.strictEqual(outcome.evaluation.verdict, 'accepted');
  assert.strictEqual(outcome.promotion.result, 'promoted');
  assert.strictEqual(outcome.artifact.run_id, outcome.run_id);
  assert.strictEqual(outcome.artifact.job_id, outcome.plan.jobs[0].job_id);
  assert.strictEqual(outcome.trajectory.run_id, outcome.run_id);
  assert.strictEqual(outcome.trajectory.plan_id, outcome.plan.plan_id);
  assert.strictEqual(outcome.trajectory.job_id, outcome.plan.jobs[0].job_id);
  assert.strictEqual(
    git(root, 'show', 'refs/heads/ecc/candidates/fabric-real-test:fabric-marker.txt'),
    'candidate'
  );
  assert.deepStrictEqual(
    outcome.artifact.files.map(file => [file.path, file.status]),
    [['fabric-marker.txt', 'added']]
  );
  assert.strictEqual(outcome.cleanup.pass, true);
  assert.strictEqual(fs.existsSync(path.join(root, 'fabric-marker.txt')), false);
  assert.strictEqual(git(root, 'status', '--porcelain=v1'), '');
  assert.strictEqual(git(root, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);
  console.log('  ✓ real Tier 0 worktree, patch, evaluation, trajectory, and cleanup');
} finally {
  if (artifactDirectory) fs.rmSync(artifactDirectory, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}
