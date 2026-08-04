'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  slugify,
  renderTemplate,
  buildOrchestrationPlan,
  executePlan,
  materializePlan,
  normalizeSeedPaths,
  overlaySeedPaths
} = require('../../scripts/lib/tmux-worktree-orchestrator');

console.log('=== Testing tmux-worktree-orchestrator.js ===\n');

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

console.log('Helpers:');
test('slugify normalizes mixed punctuation and casing', () => {
  assert.strictEqual(slugify('Feature Audit: Docs + Tmux'), 'feature-audit-docs-tmux');
});

test('renderTemplate replaces supported placeholders', () => {
  const rendered = renderTemplate('run {worker_name} in {worktree_path}', {
    worker_name: 'Docs Fixer',
    worktree_path: '/tmp/repo-worker'
  });
  assert.strictEqual(rendered, 'run Docs Fixer in /tmp/repo-worker');
});

test('renderTemplate rejects unknown placeholders', () => {
  assert.throws(
    () => renderTemplate('missing {unknown}', { worker_name: 'docs' }),
    /Unknown template variable/
  );
});

console.log('\nPlan generation:');
test('buildOrchestrationPlan creates worktrees, branches, and tmux commands', () => {
  const repoRoot = path.join('/tmp', 'ecc');
  const plan = buildOrchestrationPlan({
    repoRoot,
    sessionName: 'Skill Audit',
    baseRef: 'main',
    launcherCommand: 'codex exec --cwd {worktree_path} --task-file {task_file}',
    workers: [
      { name: 'Docs A', task: 'Fix skills 1-4' },
      { name: 'Docs B', task: 'Fix skills 5-8' }
    ]
  });

  assert.strictEqual(plan.sessionName, 'skill-audit');
  assert.strictEqual(plan.workerPlans.length, 2);
  assert.strictEqual(plan.workerPlans[0].branchName, 'orchestrator-skill-audit-docs-a');
  assert.strictEqual(plan.workerPlans[1].branchName, 'orchestrator-skill-audit-docs-b');
  assert.deepStrictEqual(
    plan.workerPlans[0].gitArgs.slice(0, 4),
    ['worktree', 'add', '-b', 'orchestrator-skill-audit-docs-a'],
    'Should create branch-backed worktrees'
  );
  assert.ok(
    plan.workerPlans[0].worktreePath.endsWith(path.join('ecc-skill-audit-docs-a')),
    'Should create sibling worktree path'
  );
  assert.ok(
    plan.workerPlans[0].taskFilePath.endsWith(path.join('.orchestration', 'skill-audit', 'docs-a', 'task.md')),
    'Should create per-worker task file'
  );
  assert.ok(
    plan.workerPlans[0].handoffFilePath.endsWith(path.join('.orchestration', 'skill-audit', 'docs-a', 'handoff.md')),
    'Should create per-worker handoff file'
  );
  assert.ok(
    plan.workerPlans[0].launchCommand.includes(plan.workerPlans[0].taskFilePath),
    'Launch command should interpolate task file'
  );
  assert.ok(
    plan.workerPlans[0].launchCommand.includes(plan.workerPlans[0].worktreePath),
    'Launch command should interpolate worktree path'
  );
  assert.ok(
    plan.tmuxCommands.some(command => command.args.includes('split-window')),
    'Should include tmux split commands'
  );
  assert.ok(
    plan.tmuxCommands.some(command => command.args.includes('select-layout')),
    'Should include tiled layout command'
  );
});

test('buildOrchestrationPlan requires at least one worker', () => {
  assert.throws(
    () => buildOrchestrationPlan({
      repoRoot: '/tmp/ecc',
      sessionName: 'empty',
      launcherCommand: 'codex exec --task-file {task_file}',
      workers: []
    }),
    /at least one worker/
  );
});

test('buildOrchestrationPlan normalizes global and worker seed paths', () => {
  const plan = buildOrchestrationPlan({
    repoRoot: '/tmp/ecc',
    sessionName: 'seeded',
    launcherCommand: 'echo run',
    seedPaths: ['scripts/orchestrate-worktrees.js', './.claude/plan/workflow-e2e-test.json'],
    workers: [
      {
        name: 'Docs',
        task: 'Update docs',
        seedPaths: ['commands/multi-workflow.md']
      }
    ]
  });

  assert.deepStrictEqual(plan.workerPlans[0].seedPaths, [
    'scripts/orchestrate-worktrees.js',
    '.claude/plan/workflow-e2e-test.json',
    'commands/multi-workflow.md'
  ]);
});

test('buildOrchestrationPlan rejects worker names that collapse to the same slug', () => {
  assert.throws(
    () => buildOrchestrationPlan({
      repoRoot: '/tmp/ecc',
      sessionName: 'duplicates',
      launcherCommand: 'echo run',
      workers: [
        { name: 'Docs A', task: 'Fix skill docs' },
        { name: 'Docs/A', task: 'Fix tests' }
      ]
    }),
    /unique slugs/
  );
});

test('buildOrchestrationPlan exposes shell-safe launcher aliases alongside raw defaults', () => {
  const repoRoot = path.join('/tmp', 'My Repo');
  const plan = buildOrchestrationPlan({
    repoRoot,
    sessionName: 'Spacing Audit',
    launcherCommand: 'bash {repo_root_sh}/scripts/orchestrate-codex-worker.sh {task_file_sh} {handoff_file_sh} {status_file_sh} {worker_name_sh} {worker_name}',
    workers: [{ name: 'Docs Fixer', task: 'Update docs' }]
  });
  const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
  const resolvedRepoRoot = plan.workerPlans[0].repoRoot;

  assert.ok(
    plan.workerPlans[0].launchCommand.includes(`bash ${quote(resolvedRepoRoot)}/scripts/orchestrate-codex-worker.sh`),
    'repo_root_sh should provide a shell-safe path'
  );
  assert.ok(
    plan.workerPlans[0].launchCommand.includes(quote(plan.workerPlans[0].taskFilePath)),
    'task_file_sh should provide a shell-safe path'
  );
  assert.ok(
    plan.workerPlans[0].launchCommand.includes(`${quote(plan.workerPlans[0].workerName)} ${plan.workerPlans[0].workerName}`),
    'raw defaults should remain available alongside shell-safe aliases'
  );
});

test('buildOrchestrationPlan shell-quotes the orchestration banner command', () => {
  const repoRoot = path.join('/tmp', "O'Hare Repo");
  const plan = buildOrchestrationPlan({
    repoRoot,
    sessionName: 'Quote Audit',
    launcherCommand: 'echo run',
    workers: [{ name: 'Docs', task: 'Update docs' }]
  });
  const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
  const bannerCommand = plan.tmuxCommands[1].args[3];

  assert.strictEqual(
    bannerCommand,
    `printf '%s\\n' ${quote(`Session: ${plan.sessionName}`)} ${quote(`Coordination: ${plan.coordinationDir}`)}`,
    'Banner command should quote coordination paths safely for tmux send-keys'
  );
});

test('normalizeSeedPaths rejects paths outside the repo root', () => {
  assert.throws(
    () => normalizeSeedPaths(['../outside.txt'], '/tmp/ecc'),
    /inside repoRoot/
  );
});

test('materializePlan keeps worker instructions inside the worktree boundary', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-orchestrator-test-'));

  try {
    const plan = buildOrchestrationPlan({
      repoRoot: tempRoot,
      coordinationRoot: path.join(tempRoot, '.claude', 'orchestration'),
      sessionName: 'Workflow E2E',
      launcherCommand: 'bash {repo_root}/scripts/orchestrate-codex-worker.sh {task_file} {handoff_file} {status_file}',
      workers: [{ name: 'Docs', task: 'Update the workflow docs.' }]
    });

    materializePlan(plan);

    const taskFile = fs.readFileSync(plan.workerPlans[0].taskFilePath, 'utf8');

    assert.ok(
      taskFile.includes('Report results in your final response.'),
      'Task file should tell the worker to report in stdout'
    );
    assert.ok(
      taskFile.includes('Do not spawn subagents or external agents for this task.'),
      'Task file should keep nested workers single-session'
    );
    assert.ok(
      !taskFile.includes('Write results and handoff notes to'),
      'Task file should not require writing handoff files outside the worktree'
    );
    assert.ok(
      !taskFile.includes('Update `'),
      'Task file should not instruct the nested worker to update orchestration status files'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('overlaySeedPaths copies local overlays into the worker worktree', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-orchestrator-overlay-'));
  const repoRoot = path.join(tempRoot, 'repo');
  const worktreePath = path.join(tempRoot, 'worktree');

  try {
    fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, '.claude', 'plan'), { recursive: true });
    fs.mkdirSync(path.join(worktreePath, 'scripts'), { recursive: true });

    fs.writeFileSync(
      path.join(repoRoot, 'scripts', 'orchestrate-worktrees.js'),
      'local-version\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(repoRoot, '.claude', 'plan', 'workflow-e2e-test.json'),
      '{"seeded":true}\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(worktreePath, 'scripts', 'orchestrate-worktrees.js'),
      'head-version\n',
      'utf8'
    );

    overlaySeedPaths({
      repoRoot,
      seedPaths: [
        'scripts/orchestrate-worktrees.js',
        '.claude/plan/workflow-e2e-test.json'
      ],
      worktreePath
    });

    assert.strictEqual(
      fs.readFileSync(path.join(worktreePath, 'scripts', 'orchestrate-worktrees.js'), 'utf8'),
      'local-version\n'
    );
    assert.strictEqual(
      fs.readFileSync(path.join(worktreePath, '.claude', 'plan', 'workflow-e2e-test.json'), 'utf8'),
      '{"seeded":true}\n'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('executePlan rolls back partial setup when orchestration fails mid-run', () => {
  const plan = {
    repoRoot: '/tmp/ecc',
    sessionName: 'rollback-test',
    coordinationDir: '/tmp/ecc/.orchestration/rollback-test',
    replaceExisting: false,
    workerPlans: [
      {
        workerName: 'Docs',
        workerSlug: 'docs',
        worktreePath: '/tmp/ecc-rollback-docs',
        seedPaths: ['commands/multi-workflow.md'],
        gitArgs: ['worktree', 'add', '-b', 'orchestrator-rollback-test-docs', '/tmp/ecc-rollback-docs', 'HEAD'],
        launchCommand: 'echo run'
      }
    ]
  };
  const calls = [];
  const rollbackCalls = [];

  assert.throws(
    () => executePlan(plan, {
      spawnSync(program, args) {
        calls.push({ type: 'spawnSync', program, args });
        if (program === 'tmux' && args[0] === 'has-session') {
          return { status: 1, stdout: '', stderr: '' };
        }
        throw new Error(`Unexpected spawnSync call: ${program} ${args.join(' ')}`);
      },
      runCommand(program, args) {
        calls.push({ type: 'runCommand', program, args });
        if (program === 'git' && args[0] === 'rev-parse') {
          return { status: 0, stdout: 'true\n', stderr: '' };
        }
        if (program === 'tmux' && args[0] === '-V') {
          return { status: 0, stdout: 'tmux 3.4\n', stderr: '' };
        }
        if (program === 'git' && args[0] === 'worktree') {
          return { status: 0, stdout: '', stderr: '' };
        }
        throw new Error(`Unexpected runCommand call: ${program} ${args.join(' ')}`);
      },
      materializePlan(receivedPlan) {
        calls.push({ type: 'materializePlan', receivedPlan });
      },
      overlaySeedPaths() {
        throw new Error('overlay failed');
      },
      rollbackCreatedResources(receivedPlan, createdState) {
        rollbackCalls.push({ receivedPlan, createdState });
      }
    }),
    /overlay failed/
  );

  assert.deepStrictEqual(
    rollbackCalls.map(call => call.receivedPlan),
    [plan],
    'executePlan should invoke rollback on failure'
  );
  assert.deepStrictEqual(
    rollbackCalls[0].createdState.workerPlans,
    plan.workerPlans,
    'executePlan should only roll back resources created before the failure'
  );
  assert.ok(
    calls.some(call => call.type === 'runCommand' && call.program === 'git' && call.args[0] === 'worktree'),
    'executePlan should attempt setup before rolling back'
  );
});

test('executePlan does not mark pre-existing resources for rollback when worktree creation fails', () => {
  const plan = {
    repoRoot: '/tmp/ecc',
    sessionName: 'rollback-existing',
    coordinationDir: '/tmp/ecc/.orchestration/rollback-existing',
    replaceExisting: false,
    workerPlans: [
      {
        workerName: 'Docs',
        workerSlug: 'docs',
        worktreePath: '/tmp/ecc-existing-docs',
        seedPaths: [],
        gitArgs: ['worktree', 'add', '-b', 'orchestrator-rollback-existing-docs', '/tmp/ecc-existing-docs', 'HEAD'],
        launchCommand: 'echo run',
        branchName: 'orchestrator-rollback-existing-docs'
      }
    ]
  };
  const rollbackCalls = [];

  assert.throws(
    () => executePlan(plan, {
      spawnSync(program, args) {
        if (program === 'tmux' && args[0] === 'has-session') {
          return { status: 1, stdout: '', stderr: '' };
        }
        throw new Error(`Unexpected spawnSync call: ${program} ${args.join(' ')}`);
      },
      runCommand(program, args) {
        if (program === 'git' && args[0] === 'rev-parse') {
          return { status: 0, stdout: 'true\n', stderr: '' };
        }
        if (program === 'tmux' && args[0] === '-V') {
          return { status: 0, stdout: 'tmux 3.4\n', stderr: '' };
        }
        if (program === 'git' && args[0] === 'worktree') {
          throw new Error('branch already exists');
        }
        throw new Error(`Unexpected runCommand call: ${program} ${args.join(' ')}`);
      },
      materializePlan() {},
      rollbackCreatedResources(receivedPlan, createdState) {
        rollbackCalls.push({ receivedPlan, createdState });
      }
    }),
    /branch already exists/
  );

  assert.deepStrictEqual(
    rollbackCalls[0].createdState.workerPlans,
    [],
    'Failures before creation should not schedule any worker resources for rollback'
  );
  assert.strictEqual(
    rollbackCalls[0].createdState.sessionCreated,
    false,
    'Failures before tmux session creation should not mark a session for rollback'
  );
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
