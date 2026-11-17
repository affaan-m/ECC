const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ensureDir, sanitizeSessionId } = require('./utils');

function getHomunculusDir() {
  const override = process.env.CLV2_HOMUNCULUS_DIR;
  if (override) {
    if (path.isAbsolute(override)) {
      return override;
    }
    process.stderr.write(`[ecc] CLV2_HOMUNCULUS_DIR=${override} is not absolute; ignoring\n`);
  }

  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome) {
    if (path.isAbsolute(xdgDataHome)) {
      return path.join(xdgDataHome, 'ecc-homunculus');
    }
    process.stderr.write(`[ecc] XDG_DATA_HOME=${xdgDataHome} is not absolute; ignoring\n`);
  }

  return path.join(os.homedir(), '.local', 'share', 'ecc-homunculus');
}

function getProjectsDir() {
  return path.join(getHomunculusDir(), 'projects');
}

function getProjectRegistryPath() {
  return path.join(getHomunculusDir(), 'projects.json');
}

function readProjectRegistry() {
  try {
    return JSON.parse(fs.readFileSync(getProjectRegistryPath(), 'utf8'));
  } catch {
    return {};
  }
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  if (result.status !== 0) return '';
  return (result.stdout || '').trim();
}

function stripRemoteCredentials(remoteUrl) {
  if (!remoteUrl) return '';
  return String(remoteUrl).replace(/:\/\/[^@]+@/, '://');
}

function normalizeRemoteUrl(remoteUrl) {
  if (!remoteUrl) return '';
  const raw = String(remoteUrl);
  const isNetwork = !raw.startsWith('file://') && (raw.includes('://') || /^[^@/:]+@[^:/]+:/.test(raw));
  let normalized = stripRemoteCredentials(raw)
    .replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '')
    .replace(/^[^@/:]+@([^:/]+):/, '$1/')
    .replace(/\.git\/?$/, '')
    .replace(/\/+$/, '');

  if (isNetwork) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

function resolveProjectRoot(cwd = process.cwd()) {
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  if (envRoot && fs.existsSync(envRoot)) {
    return path.resolve(envRoot);
  }

  const gitRoot = runGit(['rev-parse', '--show-toplevel'], cwd);
  if (gitRoot) return path.resolve(gitRoot);

  return '';
}

function resolveMainWorktreeRoot(projectRoot) {
  const listing = runGit(['worktree', 'list', '--porcelain'], projectRoot);
  const line = listing.split(/\r?\n/).find(entry => entry.startsWith('worktree '));
  return line ? line.slice('worktree '.length) : '';
}

function computeProjectId(projectRoot) {
  const remoteUrl = stripRemoteCredentials(runGit(['remote', 'get-url', 'origin'], projectRoot));
  // Same fallback as detect-project.sh: a remote-free linked worktree shares its main checkout's id.
  const hashInput = normalizeRemoteUrl(remoteUrl) || remoteUrl || resolveMainWorktreeRoot(projectRoot) || projectRoot;
  return crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 12);
}

// detect-project.sh creates instincts/ before it updates projects.json, so a
// folder with instincts/ is one the observer writes to (a bare folder may be
// one this module created).
function hasObserverData(projectId) {
  return fs.existsSync(path.join(getProjectsDir(), projectId, 'instincts'));
}

// Match the project CLI's ID boundary before using registry data in paths.
function isSafeProjectId(projectId) {
  return typeof projectId === 'string' && projectId.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(projectId)
    && !projectId.includes('..');
}

/**
 * Choose the project id for a root that has registry entries.
 *
 * After a repository gains a remote, detect-project.sh writes under the
 * remote-hash id while the old path-hash entry stays in the registry. Prefer
 * the id the observer derives now when it is registered or already holds
 * observer data; otherwise keep a sole entry, or take the most recently seen
 * of several. When other ids remain for the root, show a read-only inspection
 * path. The current merge CLI deletes the source directory, including live
 * observer state and files it does not copy, so SessionStart must not suggest it.
 */
function pickRootProjectId(entries, projectRoot) {
  const computedId = computeProjectId(projectRoot);
  const ids = [...new Set(entries.map(entry => entry.id))];
  const lastSeen = entry => Date.parse(entry.last_seen || '') || 0;
  let chosenId;
  if (ids.includes(computedId) || hasObserverData(computedId)) {
    chosenId = computedId;
  } else if (entries.length === 1) {
    return ids[0];
  } else {
    chosenId = entries.reduce((latest, entry) => (lastSeen(entry) > lastSeen(latest) ? entry : latest)).id;
  }

  const others = ids.filter(id => id !== chosenId);
  if (others.length > 0) {
    process.stderr.write(
      `[ecc] ${projectRoot} has project ids ${[chosenId, ...others].join(', ')}; using ${chosenId}. `
      + 'Inspect with instinct-cli.py projects; do not merge live project storage. '
      + 'The merge command removes the source directory.\n'
    );
  }
  return chosenId;
}

// Native real paths expand Windows 8.3 names; the JS realpath walker may retain
// a non-symlink short spelling. Canonicalize only root comparison; keep the Git
// spelling in computeProjectId's fallback hash for detect-project.sh parity.
// Unavailable roots cannot claim aliases.
function canonicalProjectRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return '';
  try {
    const realpath = fs.realpathSync.native || fs.realpathSync;
    return realpath(root);
  } catch {
    return '';
  }
}

function resolveProjectContext(cwd = process.cwd()) {
  const projectRoot = resolveProjectRoot(cwd);
  if (!projectRoot) {
    const projectDir = getHomunculusDir();
    ensureDir(projectDir);
    return { projectId: 'global', projectRoot: '', projectDir, isGlobal: true };
  }

  const registry = readProjectRegistry();
  const canonicalRoot = canonicalProjectRoot(projectRoot);
  const rootEntries = Object.values(registry).filter(entry => entry && isSafeProjectId(entry.id)
    && canonicalRoot && canonicalProjectRoot(entry.root) === canonicalRoot);
  const projectId = rootEntries.length > 0
    ? pickRootProjectId(rootEntries, projectRoot)
    : computeProjectId(projectRoot);
  const projectDir = path.join(getProjectsDir(), projectId);
  ensureDir(projectDir);
  const aliasProjectIds = [...new Set(rootEntries.map(entry => entry.id))].filter(id => id !== projectId);

  return { projectId, projectRoot, projectDir, isGlobal: false, aliasProjectIds };
}

/**
 * Contexts for the other registry ids that share this root. A remote added
 * mid-session moves the root to a new id, so a SessionStart lease can still
 * sit under one of these.
 */
function getAliasContexts(context) {
  return [...new Set((context.aliasProjectIds || []).filter(isSafeProjectId))].map(projectId => ({
    ...context,
    projectId,
    projectDir: path.join(getProjectsDir(), projectId),
    aliasProjectIds: []
  }));
}

function getObserverPidFile(context) {
  return path.join(context.projectDir, '.observer.pid');
}

function getObserverSignalCounterFile(context) {
  return path.join(context.projectDir, '.observer-signal-counter');
}

function getObserverActivityFile(context) {
  return path.join(context.projectDir, '.observer-last-activity');
}

function getSessionLeaseDir(context) {
  return path.join(context.projectDir, '.observer-sessions');
}

function resolveSessionId(rawSessionId = process.env.CLAUDE_SESSION_ID) {
  return sanitizeSessionId(rawSessionId || '') || '';
}

function getSessionLeaseFile(context, rawSessionId = process.env.CLAUDE_SESSION_ID) {
  const sessionId = resolveSessionId(rawSessionId);
  if (!sessionId) return '';
  return path.join(getSessionLeaseDir(context), `${sessionId}.json`);
}

function writeSessionLease(context, rawSessionId = process.env.CLAUDE_SESSION_ID, extra = {}) {
  const leaseFile = getSessionLeaseFile(context, rawSessionId);
  if (!leaseFile) return '';

  ensureDir(getSessionLeaseDir(context));
  const payload = {
    sessionId: resolveSessionId(rawSessionId),
    cwd: process.cwd(),
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    ...extra
  };
  fs.writeFileSync(leaseFile, JSON.stringify(payload, null, 2) + '\n');
  return leaseFile;
}

function removeSessionLease(context, rawSessionId = process.env.CLAUDE_SESSION_ID) {
  const leaseFile = getSessionLeaseFile(context, rawSessionId);
  if (!leaseFile) return false;
  try {
    fs.rmSync(leaseFile, { force: true });
    return true;
  } catch {
    return false;
  }
}

function listSessionLeases(context) {
  const leaseDir = getSessionLeaseDir(context);
  if (!fs.existsSync(leaseDir)) return [];
  return fs.readdirSync(leaseDir)
    .filter(name => name.endsWith('.json'))
    .map(name => path.join(leaseDir, name));
}

function stopObserverForContext(context) {
  const pidFile = getObserverPidFile(context);
  if (!fs.existsSync(pidFile)) return false;

  const pid = (fs.readFileSync(pidFile, 'utf8') || '').trim();
  if (!/^[0-9]+$/.test(pid) || pid === '0' || pid === '1') {
    fs.rmSync(pidFile, { force: true });
    return false;
  }

  try {
    process.kill(Number(pid), 0);
  } catch {
    fs.rmSync(pidFile, { force: true });
    return false;
  }

  try {
    process.kill(Number(pid), 'SIGTERM');
  } catch {
    return false;
  }

  fs.rmSync(pidFile, { force: true });
  fs.rmSync(getObserverSignalCounterFile(context), { force: true });
  return true;
}

module.exports = {
  getHomunculusDir,
  normalizeRemoteUrl,
  resolveProjectContext,
  getAliasContexts,
  getObserverActivityFile,
  getObserverPidFile,
  getSessionLeaseDir,
  writeSessionLease,
  removeSessionLease,
  listSessionLeases,
  stopObserverForContext,
  resolveSessionId
};
