'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function stripCodeTicks(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseSection(content, heading) {
  if (typeof content !== 'string' || content.length === 0) {
    return '';
  }

  const lines = content.split('\n');
  const headingLines = new Set([`## ${heading}`, `**${heading}**`]);
  const startIndex = lines.findIndex(line => headingLines.has(line.trim()));

  if (startIndex === -1) {
    return '';
  }

  const collected = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith('## ') || (/^\*\*.+\*\*$/.test(trimmed) && !headingLines.has(trimmed))) {
      break;
    }
    collected.push(line);
  }

  return collected.join('\n').trim();
}

function parseBullets(section) {
  if (!section) {
    return [];
  }

  return section
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => stripCodeTicks(line.replace(/^- /, '').trim()));
}

function parseWorkerStatus(content) {
  const status = {
    state: null,
    updated: null,
    branch: null,
    worktree: null,
    taskFile: null,
    handoffFile: null
  };

  if (typeof content !== 'string' || content.length === 0) {
    return status;
  }

  for (const line of content.split('\n')) {
    const match = line.match(/^- ([A-Za-z ]+):\s*(.+)$/);
    if (!match) {
      continue;
    }

    const key = match[1].trim().toLowerCase().replace(/\s+/g, '');
    const value = stripCodeTicks(match[2]);

    if (key === 'state') status.state = value;
    if (key === 'updated') status.updated = value;
    if (key === 'branch') status.branch = value;
    if (key === 'worktree') status.worktree = value;
    if (key === 'taskfile') status.taskFile = value;
    if (key === 'handofffile') status.handoffFile = value;
  }

  return status;
}

function parseWorkerTask(content) {
  return {
    objective: parseSection(content, 'Objective'),
    seedPaths: parseBullets(parseSection(content, 'Seeded Local Overlays'))
  };
}

function parseWorkerHandoff(content) {
  return {
    summary: parseBullets(parseSection(content, 'Summary')),
    validation: parseBullets(parseSection(content, 'Validation')),
    remainingRisks: parseBullets(parseSection(content, 'Remaining Risks'))
  };
}

function readTextIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }

  return fs.readFileSync(filePath, 'utf8');
}

function listWorkerDirectories(coordinationDir) {
  if (!coordinationDir || !fs.existsSync(coordinationDir)) {
    return [];
  }

  return fs.readdirSync(coordinationDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => {
      const workerDir = path.join(coordinationDir, entry.name);
      return ['status.md', 'task.md', 'handoff.md']
        .some(filename => fs.existsSync(path.join(workerDir, filename)));
    })
    .map(entry => entry.name)
    .sort();
}

function loadWorkerSnapshots(coordinationDir) {
  return listWorkerDirectories(coordinationDir).map(workerSlug => {
    const workerDir = path.join(coordinationDir, workerSlug);
    const statusPath = path.join(workerDir, 'status.md');
    const taskPath = path.join(workerDir, 'task.md');
    const handoffPath = path.join(workerDir, 'handoff.md');

    const status = parseWorkerStatus(readTextIfExists(statusPath));
    const task = parseWorkerTask(readTextIfExists(taskPath));
    const handoff = parseWorkerHandoff(readTextIfExists(handoffPath));

    return {
      workerSlug,
      workerDir,
      status,
      task,
      handoff,
      files: {
        status: statusPath,
        task: taskPath,
        handoff: handoffPath
      }
    };
  });
}

function listTmuxPanes(sessionName, options = {}) {
  const { spawnSyncImpl = spawnSync } = options;
  const format = [
    '#{pane_id}',
    '#{window_index}',
    '#{pane_index}',
    '#{pane_title}',
    '#{pane_current_command}',
    '#{pane_current_path}',
    '#{pane_active}',
    '#{pane_dead}',
    '#{pane_pid}'
  ].join('\t');

  const result = spawnSyncImpl('tmux', ['list-panes', '-t', sessionName, '-F', format], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      return [];
    }
    throw result.error;
  }

  if (result.status !== 0) {
    return [];
  }

  return (result.stdout || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [
        paneId,
        windowIndex,
        paneIndex,
        title,
        currentCommand,
        currentPath,
        active,
        dead,
        pid
      ] = line.split('\t');

      return {
        paneId,
        windowIndex: Number(windowIndex),
        paneIndex: Number(paneIndex),
        title,
        currentCommand,
        currentPath,
        active: active === '1',
        dead: dead === '1',
        pid: pid ? Number(pid) : null
      };
    });
}

function summarizeWorkerStates(workers) {
  return workers.reduce((counts, worker) => {
    const state = worker.status.state || 'unknown';
    counts[state] = (counts[state] || 0) + 1;
    return counts;
  }, {});
}

function buildSessionSnapshot({ sessionName, coordinationDir, panes }) {
  const workerSnapshots = loadWorkerSnapshots(coordinationDir);
  const paneMap = new Map(panes.map(pane => [pane.title, pane]));

  const workers = workerSnapshots.map(worker => ({
    ...worker,
    pane: paneMap.get(worker.workerSlug) || null
  }));

  return {
    sessionName,
    coordinationDir,
    sessionActive: panes.length > 0,
    paneCount: panes.length,
    workerCount: workers.length,
    workerStates: summarizeWorkerStates(workers),
    panes,
    workers
  };
}

function resolveSnapshotTarget(targetPath, cwd = process.cwd()) {
  const absoluteTarget = path.resolve(cwd, targetPath);

  if (fs.existsSync(absoluteTarget) && fs.statSync(absoluteTarget).isFile()) {
    const config = JSON.parse(fs.readFileSync(absoluteTarget, 'utf8'));
    const repoRoot = path.resolve(config.repoRoot || cwd);
    const coordinationRoot = path.resolve(
      config.coordinationRoot || path.join(repoRoot, '.orchestration')
    );

    return {
      sessionName: config.sessionName,
      coordinationDir: path.join(coordinationRoot, config.sessionName),
      repoRoot,
      targetType: 'plan'
    };
  }

  return {
    sessionName: targetPath,
    coordinationDir: path.join(cwd, '.claude', 'orchestration', targetPath),
    repoRoot: cwd,
    targetType: 'session'
  };
}

function collectSessionSnapshot(targetPath, cwd = process.cwd()) {
  const target = resolveSnapshotTarget(targetPath, cwd);
  const panes = listTmuxPanes(target.sessionName);
  const snapshot = buildSessionSnapshot({
    sessionName: target.sessionName,
    coordinationDir: target.coordinationDir,
    panes
  });

  return {
    ...snapshot,
    repoRoot: target.repoRoot,
    targetType: target.targetType
  };
}

module.exports = {
  buildSessionSnapshot,
  collectSessionSnapshot,
  listTmuxPanes,
  loadWorkerSnapshots,
  normalizeText: stripCodeTicks,
  parseWorkerHandoff,
  parseWorkerStatus,
  parseWorkerTask,
  resolveSnapshotTarget
};
