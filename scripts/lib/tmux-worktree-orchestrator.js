'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function slugify(value, fallback = 'worker') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function renderTemplate(template, variables) {
  if (typeof template !== 'string' || template.trim().length === 0) {
    throw new Error('launcherCommand must be a non-empty string');
  }

  return template.replace(/\{([a-z_]+)\}/g, (match, key) => {
    if (!(key in variables)) {
      throw new Error(`Unknown template variable: ${key}`);
    }
    return String(variables[key]);
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function formatCommand(program, args) {
  return [program, ...args.map(shellQuote)].join(' ');
}

function buildTemplateVariables(values) {
  return Object.entries(values).reduce((accumulator, [key, value]) => {
    const stringValue = String(value);
    const quotedValue = shellQuote(stringValue);

    accumulator[key] = stringValue;
    accumulator[`${key}_raw`] = stringValue;
    accumulator[`${key}_sh`] = quotedValue;
    return accumulator;
  }, {});
}

function buildSessionBannerCommand(sessionName, coordinationDir) {
  return `printf '%s\\n' ${shellQuote(`Session: ${sessionName}`)} ${shellQuote(`Coordination: ${coordinationDir}`)}`;
}

function normalizeSeedPaths(seedPaths, repoRoot) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const entries = Array.isArray(seedPaths) ? seedPaths : [];
  const seen = new Set();
  const normalized = [];

  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      continue;
    }

    const absolutePath = path.resolve(resolvedRepoRoot, entry);
    const relativePath = path.relative(resolvedRepoRoot, absolutePath);

    if (
      relativePath.startsWith('..') ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`seedPaths entries must stay inside repoRoot: ${entry}`);
    }

    const normalizedPath = relativePath.split(path.sep).join('/');
    if (seen.has(normalizedPath)) {
      continue;
    }

    seen.add(normalizedPath);
    normalized.push(normalizedPath);
  }

  return normalized;
}

function overlaySeedPaths({ repoRoot, seedPaths, worktreePath }) {
  const normalizedSeedPaths = normalizeSeedPaths(seedPaths, repoRoot);

  for (const seedPath of normalizedSeedPaths) {
    const sourcePath = path.join(repoRoot, seedPath);
    const destinationPath = path.join(worktreePath, seedPath);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Seed path does not exist in repoRoot: ${seedPath}`);
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.rmSync(destinationPath, { force: true, recursive: true });
    fs.cpSync(sourcePath, destinationPath, {
      dereference: false,
      force: true,
      preserveTimestamps: true,
      recursive: true
    });
  }
}

function buildWorkerArtifacts(workerPlan) {
  const seededPathsSection = workerPlan.seedPaths.length > 0
    ? [
        '',
        '## Seeded Local Overlays',
        ...workerPlan.seedPaths.map(seedPath => `- \`${seedPath}\``)
      ]
    : [];

  return {
    dir: workerPlan.coordinationDir,
    files: [
      {
        path: workerPlan.taskFilePath,
        content: [
          `# Worker Task: ${workerPlan.workerName}`,
          '',
          `- Session: \`${workerPlan.sessionName}\``,
          `- Repo root: \`${workerPlan.repoRoot}\``,
          `- Worktree: \`${workerPlan.worktreePath}\``,
          `- Branch: \`${workerPlan.branchName}\``,
          `- Launcher status file: \`${workerPlan.statusFilePath}\``,
          `- Launcher handoff file: \`${workerPlan.handoffFilePath}\``,
          ...seededPathsSection,
          '',
          '## Objective',
          workerPlan.task,
          '',
          '## Completion',
          'Do not spawn subagents or external agents for this task.',
          'Report results in your final response.',
          `The worker launcher captures your response in \`${workerPlan.handoffFilePath}\` automatically.`,
          `The worker launcher updates \`${workerPlan.statusFilePath}\` automatically.`
        ].join('\n')
      },
      {
        path: workerPlan.handoffFilePath,
        content: [
          `# Handoff: ${workerPlan.workerName}`,
          '',
          '## Summary',
          '- Pending',
          '',
          '## Files Changed',
          '- Pending',
          '',
          '## Tests / Verification',
          '- Pending',
          '',
          '## Follow-ups',
          '- Pending'
        ].join('\n')
      },
      {
        path: workerPlan.statusFilePath,
        content: [
          `# Status: ${workerPlan.workerName}`,
          '',
          '- State: not started',
          `- Worktree: \`${workerPlan.worktreePath}\``,
          `- Branch: \`${workerPlan.branchName}\``
        ].join('\n')
      }
    ]
  };
}

function buildOrchestrationPlan(config = {}) {
  const repoRoot = path.resolve(config.repoRoot || process.cwd());
  const repoName = path.basename(repoRoot);
  const workers = Array.isArray(config.workers) ? config.workers : [];
  const globalSeedPaths = normalizeSeedPaths(config.seedPaths, repoRoot);
  const sessionName = slugify(config.sessionName || repoName, 'session');
  const worktreeRoot = path.resolve(config.worktreeRoot || path.dirname(repoRoot));
  const coordinationRoot = path.resolve(
    config.coordinationRoot || path.join(repoRoot, '.orchestration')
  );
  const coordinationDir = path.join(coordinationRoot, sessionName);
  const baseRef = config.baseRef || 'HEAD';
  const defaultLauncher = config.launcherCommand || '';

  if (workers.length === 0) {
    throw new Error('buildOrchestrationPlan requires at least one worker');
  }

  const seenSlugs = new Set();
  const workerPlans = workers.map((worker, index) => {
    if (!worker || typeof worker.task !== 'string' || worker.task.trim().length === 0) {
      throw new Error(`Worker ${index + 1} is missing a task`);
    }

    const workerName = worker.name || `worker-${index + 1}`;
    const workerSlug = slugify(workerName, `worker-${index + 1}`);

    if (seenSlugs.has(workerSlug)) {
      throw new Error(`Workers must have unique slugs — duplicate: ${workerSlug}`);
    }
    seenSlugs.add(workerSlug);

    const branchName = `orchestrator-${sessionName}-${workerSlug}`;
    const worktreePath = path.join(worktreeRoot, `${repoName}-${sessionName}-${workerSlug}`);
    const workerCoordinationDir = path.join(coordinationDir, workerSlug);
    const taskFilePath = path.join(workerCoordinationDir, 'task.md');
    const handoffFilePath = path.join(workerCoordinationDir, 'handoff.md');
    const statusFilePath = path.join(workerCoordinationDir, 'status.md');
    const launcherCommand = worker.launcherCommand || defaultLauncher;
    const workerSeedPaths = normalizeSeedPaths(worker.seedPaths, repoRoot);
    const seedPaths = normalizeSeedPaths([...globalSeedPaths, ...workerSeedPaths], repoRoot);
    const templateVariables = buildTemplateVariables({
      branch_name: branchName,
      handoff_file: handoffFilePath,
      repo_root: repoRoot,
      session_name: sessionName,
      status_file: statusFilePath,
      task_file: taskFilePath,
      worker_name: workerName,
      worker_slug: workerSlug,
      worktree_path: worktreePath
    });

    if (!launcherCommand) {
      throw new Error(`Worker ${workerName} is missing a launcherCommand`);
    }

    const gitArgs = ['worktree', 'add', '-b', branchName, worktreePath, baseRef];

    return {
      branchName,
      coordinationDir: workerCoordinationDir,
      gitArgs,
      gitCommand: formatCommand('git', gitArgs),
      handoffFilePath,
      launchCommand: renderTemplate(launcherCommand, templateVariables),
      repoRoot,
      sessionName,
      seedPaths,
      statusFilePath,
      task: worker.task.trim(),
      taskFilePath,
      workerName,
      workerSlug,
      worktreePath
    };
  });

  const tmuxCommands = [
    {
      cmd: 'tmux',
      args: ['new-session', '-d', '-s', sessionName, '-n', 'orchestrator', '-c', repoRoot],
      description: 'Create detached tmux session'
    },
    {
      cmd: 'tmux',
      args: [
        'send-keys',
        '-t',
        sessionName,
        buildSessionBannerCommand(sessionName, coordinationDir),
        'C-m'
      ],
      description: 'Print orchestrator session details'
    }
  ];

  for (const workerPlan of workerPlans) {
    tmuxCommands.push(
      {
        cmd: 'tmux',
        args: ['split-window', '-d', '-t', sessionName, '-c', workerPlan.worktreePath],
        description: `Create pane for ${workerPlan.workerName}`
      },
      {
        cmd: 'tmux',
        args: ['select-layout', '-t', sessionName, 'tiled'],
        description: 'Arrange panes in tiled layout'
      },
      {
        cmd: 'tmux',
        args: ['select-pane', '-t', '<pane-id>', '-T', workerPlan.workerSlug],
        description: `Label pane ${workerPlan.workerSlug}`
      },
      {
        cmd: 'tmux',
        args: [
          'send-keys',
          '-t',
          '<pane-id>',
          `cd ${shellQuote(workerPlan.worktreePath)} && ${workerPlan.launchCommand}`,
          'C-m'
        ],
        description: `Launch worker ${workerPlan.workerName}`
      }
    );
  }

  return {
    baseRef,
    coordinationDir,
    replaceExisting: Boolean(config.replaceExisting),
    repoRoot,
    sessionName,
    tmuxCommands,
    workerPlans
  };
}

function materializePlan(plan) {
  for (const workerPlan of plan.workerPlans) {
    const artifacts = buildWorkerArtifacts(workerPlan);
    fs.mkdirSync(artifacts.dir, { recursive: true });
    for (const file of artifacts.files) {
      fs.writeFileSync(file.path, file.content + '\n', 'utf8');
    }
  }
}

function runCommand(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`${program} ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return result;
}

function commandSucceeds(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return result.status === 0;
}

function canonicalizePath(targetPath) {
  const resolvedPath = path.resolve(targetPath);

  try {
    return fs.realpathSync.native(resolvedPath);
  } catch (_error) {
    const parentPath = path.dirname(resolvedPath);

    try {
      return path.join(fs.realpathSync.native(parentPath), path.basename(resolvedPath));
    } catch (_parentError) {
      return resolvedPath;
    }
  }
}

function branchExists(repoRoot, branchName) {
  return commandSucceeds('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
    cwd: repoRoot
  });
}

function listWorktrees(repoRoot) {
  const listed = runCommand('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
  const lines = (listed.stdout || '').split('\n');
  const worktrees = [];

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      const listedPath = line.slice('worktree '.length).trim();
      worktrees.push({
        listedPath,
        canonicalPath: canonicalizePath(listedPath)
      });
    }
  }

  return worktrees;
}

function cleanupExisting(plan) {
  runCommand('git', ['worktree', 'prune', '--expire', 'now'], { cwd: plan.repoRoot });

  const hasSession = spawnSync('tmux', ['has-session', '-t', plan.sessionName], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (hasSession.status === 0) {
    runCommand('tmux', ['kill-session', '-t', plan.sessionName], { cwd: plan.repoRoot });
  }

  for (const workerPlan of plan.workerPlans) {
    const expectedWorktreePath = canonicalizePath(workerPlan.worktreePath);
    const existingWorktree = listWorktrees(plan.repoRoot).find(
      worktree => worktree.canonicalPath === expectedWorktreePath
    );

    if (existingWorktree) {
      runCommand('git', ['worktree', 'remove', '--force', existingWorktree.listedPath], {
        cwd: plan.repoRoot
      });
    }

    if (fs.existsSync(workerPlan.worktreePath)) {
      fs.rmSync(workerPlan.worktreePath, { force: true, recursive: true });
    }

    runCommand('git', ['worktree', 'prune', '--expire', 'now'], { cwd: plan.repoRoot });

    if (branchExists(plan.repoRoot, workerPlan.branchName)) {
      runCommand('git', ['branch', '-D', workerPlan.branchName], { cwd: plan.repoRoot });
    }
  }
}

function rollbackCreatedResources(plan, createdState, runtime = {}) {
  const runCommandImpl = runtime.runCommand || runCommand;
  const listWorktreesImpl = runtime.listWorktrees || listWorktrees;
  const branchExistsImpl = runtime.branchExists || branchExists;
  const errors = [];

  if (createdState.sessionCreated) {
    try {
      runCommandImpl('tmux', ['kill-session', '-t', plan.sessionName], { cwd: plan.repoRoot });
    } catch (error) {
      errors.push(error.message);
    }
  }

  for (const workerPlan of [...createdState.workerPlans].reverse()) {
    const expectedWorktreePath = canonicalizePath(workerPlan.worktreePath);
    const existingWorktree = listWorktreesImpl(plan.repoRoot).find(
      worktree => worktree.canonicalPath === expectedWorktreePath
    );

    if (existingWorktree) {
      try {
        runCommandImpl('git', ['worktree', 'remove', '--force', existingWorktree.listedPath], {
          cwd: plan.repoRoot
        });
      } catch (error) {
        errors.push(error.message);
      }
    } else if (fs.existsSync(workerPlan.worktreePath)) {
      fs.rmSync(workerPlan.worktreePath, { force: true, recursive: true });
    }

    try {
      runCommandImpl('git', ['worktree', 'prune', '--expire', 'now'], { cwd: plan.repoRoot });
    } catch (error) {
      errors.push(error.message);
    }

    if (branchExistsImpl(plan.repoRoot, workerPlan.branchName)) {
      try {
        runCommandImpl('git', ['branch', '-D', workerPlan.branchName], { cwd: plan.repoRoot });
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  if (createdState.removeCoordinationDir && fs.existsSync(plan.coordinationDir)) {
    fs.rmSync(plan.coordinationDir, { force: true, recursive: true });
  }

  if (errors.length > 0) {
    throw new Error(`rollback failed: ${errors.join('; ')}`);
  }
}

function executePlan(plan, runtime = {}) {
  const spawnSyncImpl = runtime.spawnSync || spawnSync;
  const runCommandImpl = runtime.runCommand || runCommand;
  const materializePlanImpl = runtime.materializePlan || materializePlan;
  const overlaySeedPathsImpl = runtime.overlaySeedPaths || overlaySeedPaths;
  const cleanupExistingImpl = runtime.cleanupExisting || cleanupExisting;
  const rollbackCreatedResourcesImpl = runtime.rollbackCreatedResources || rollbackCreatedResources;
  const createdState = {
    workerPlans: [],
    sessionCreated: false,
    removeCoordinationDir: !fs.existsSync(plan.coordinationDir)
  };

  runCommandImpl('git', ['rev-parse', '--is-inside-work-tree'], { cwd: plan.repoRoot });
  runCommandImpl('tmux', ['-V']);

  if (plan.replaceExisting) {
    cleanupExistingImpl(plan);
  } else {
    const hasSession = spawnSyncImpl('tmux', ['has-session', '-t', plan.sessionName], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (hasSession.status === 0) {
      throw new Error(`tmux session already exists: ${plan.sessionName}`);
    }
  }

  try {
    materializePlanImpl(plan);

    for (const workerPlan of plan.workerPlans) {
      runCommandImpl('git', workerPlan.gitArgs, { cwd: plan.repoRoot });
      createdState.workerPlans.push(workerPlan);
      overlaySeedPathsImpl({
        repoRoot: plan.repoRoot,
        seedPaths: workerPlan.seedPaths,
        worktreePath: workerPlan.worktreePath
      });
    }

    runCommandImpl(
      'tmux',
      ['new-session', '-d', '-s', plan.sessionName, '-n', 'orchestrator', '-c', plan.repoRoot],
      { cwd: plan.repoRoot }
    );
    createdState.sessionCreated = true;
    runCommandImpl(
      'tmux',
      [
        'send-keys',
        '-t',
        plan.sessionName,
        buildSessionBannerCommand(plan.sessionName, plan.coordinationDir),
        'C-m'
      ],
      { cwd: plan.repoRoot }
    );

    for (const workerPlan of plan.workerPlans) {
      const splitResult = runCommandImpl(
        'tmux',
        ['split-window', '-d', '-P', '-F', '#{pane_id}', '-t', plan.sessionName, '-c', workerPlan.worktreePath],
        { cwd: plan.repoRoot }
      );
      const paneId = splitResult.stdout.trim();

      if (!paneId) {
        throw new Error(`tmux split-window did not return a pane id for ${workerPlan.workerName}`);
      }

      runCommandImpl('tmux', ['select-layout', '-t', plan.sessionName, 'tiled'], { cwd: plan.repoRoot });
      runCommandImpl('tmux', ['select-pane', '-t', paneId, '-T', workerPlan.workerSlug], {
        cwd: plan.repoRoot
      });
      runCommandImpl(
        'tmux',
        [
          'send-keys',
          '-t',
          paneId,
          `cd ${shellQuote(workerPlan.worktreePath)} && ${workerPlan.launchCommand}`,
          'C-m'
        ],
        { cwd: plan.repoRoot }
      );
    }
  } catch (error) {
    try {
      rollbackCreatedResourcesImpl(plan, createdState, {
        branchExists: runtime.branchExists,
        listWorktrees: runtime.listWorktrees,
        runCommand: runCommandImpl
      });
    } catch (cleanupError) {
      error.message = `${error.message}; cleanup failed: ${cleanupError.message}`;
    }
    throw error;
  }

  return {
    coordinationDir: plan.coordinationDir,
    sessionName: plan.sessionName,
    workerCount: plan.workerPlans.length
  };
}

module.exports = {
  buildOrchestrationPlan,
  executePlan,
  materializePlan,
  normalizeSeedPaths,
  overlaySeedPaths,
  rollbackCreatedResources,
  renderTemplate,
  slugify
};
