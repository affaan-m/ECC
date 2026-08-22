'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCHEMA = 'ecc.codex-legacy-sync.v1';
const BEGIN_MARKER = '<!-- BEGIN ECC -->';
const END_MARKER = '<!-- END ECC -->';

function getStatePath(codexHome) {
  return path.join(codexHome, 'ecc', 'legacy-sync-state.json');
}

function openRegularFileNoFollow(filePath, writable = false) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const flags = (writable ? fs.constants.O_RDWR : fs.constants.O_RDONLY) | noFollow;
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, flags);
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        const unresolved = fs.lstatSync(filePath);
        if (unresolved.isSymbolicLink() || !unresolved.isFile()) {
          throw new Error(`Refusing to manage non-regular legacy sync path: ${filePath}`);
        }
      } catch (lstatError) {
        if (lstatError.code === 'ENOENT') return null;
        throw lstatError;
      }
      throw error;
    }
    if (error.code === 'ELOOP') {
      throw new Error(`Refusing to manage non-regular legacy sync path: ${filePath}`);
    }
    throw error;
  }
  const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
  let finalPathStat;
  try {
    finalPathStat = fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    fs.closeSync(descriptor);
    if (error.code === 'ENOENT') {
      throw new Error(`Legacy sync path changed while opening: ${filePath}`);
    }
    throw error;
  }
  if (
    !descriptorStat.isFile()
    || !finalPathStat.isFile()
    || finalPathStat.isSymbolicLink()
    || descriptorStat.dev !== finalPathStat.dev
    || descriptorStat.ino !== finalPathStat.ino
    || descriptorStat.nlink !== 1n
    || finalPathStat.nlink !== 1n
  ) {
    fs.closeSync(descriptor);
    throw new Error(`Refusing to manage non-regular legacy sync path: ${filePath}`);
  }
  return { descriptor, stat: fs.fstatSync(descriptor) };
}

function readRegularFileNoFollow(filePath, encoding = null) {
  const opened = openRegularFileNoFollow(filePath);
  if (!opened) return null;
  try {
    return {
      content: fs.readFileSync(opened.descriptor, encoding || undefined),
      mode: opened.stat.mode & 0o777,
    };
  } finally {
    fs.closeSync(opened.descriptor);
  }
}

function replaceOpenedRegularFile(opened, content, mode = null) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  fs.ftruncateSync(opened.descriptor, 0);
  fs.writeSync(opened.descriptor, buffer, 0, buffer.length, 0);
  if (mode) fs.fchmodSync(opened.descriptor, mode);
  fs.fsyncSync(opened.descriptor);
}

function createRegularFileNoFollow(filePath, content, mode = 0o600) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow;
  const descriptor = fs.openSync(filePath, flags, mode);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new Error(`Refusing to create non-regular legacy sync path: ${filePath}`);
    }
    fs.writeFileSync(descriptor, content);
    fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function removeOpenedRegularFile(filePath, opened) {
  const quarantineDir = fs.mkdtempSync(path.join(path.dirname(filePath), '.ecc-remove-'));
  const quarantinePath = path.join(quarantineDir, path.basename(filePath));
  fs.renameSync(filePath, quarantinePath);
  const quarantined = openRegularFileNoFollow(quarantinePath);
  const openedStat = fs.fstatSync(opened.descriptor, { bigint: true });
  const quarantinedStat = fs.fstatSync(quarantined.descriptor, { bigint: true });
  fs.closeSync(quarantined.descriptor);
  fs.closeSync(opened.descriptor);
  opened.descriptor = null;
  if (quarantinedStat.dev !== openedStat.dev || quarantinedStat.ino !== openedStat.ino) {
    try {
      fs.linkSync(quarantinePath, filePath);
      fs.unlinkSync(quarantinePath);
      fs.rmdirSync(quarantineDir);
    } catch (_restoreError) {
      throw new Error(
        `Legacy sync path changed before removal; preserved replacement at ${quarantinePath}`
      );
    }
    throw new Error(`Legacy sync path changed before removal: ${filePath}`);
  }
  fs.unlinkSync(quarantinePath);
  fs.rmdirSync(quarantineDir);
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function readState(statePath) {
  const snapshot = readRegularFileNoFollow(statePath, 'utf8');
  if (!snapshot) throw new Error(`Legacy Codex sync state not found at ${statePath}`);
  return parseState(snapshot.content, statePath);
}

function readStateIfPresent(statePath) {
  const snapshot = readRegularFileNoFollow(statePath, 'utf8');
  return snapshot ? parseState(snapshot.content, statePath) : null;
}

function parseState(content, statePath) {
  const state = JSON.parse(content);
  if (state.schema !== SCHEMA || !Array.isArray(state.paths)) {
    throw new Error(`Invalid legacy Codex sync state at ${statePath}`);
  }
  return state;
}

function hasUnsafeManagedAncestor(filePath, codexHome) {
  const relativePath = path.relative(codexHome, filePath);
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return relativePath !== '';
  }
  const segments = relativePath.split(path.sep).slice(0, -1);
  let currentPath = codexHome;
  for (const segment of [null, ...segments]) {
    if (segment !== null) currentPath = path.join(currentPath, segment);
    try {
      const stat = fs.lstatSync(currentPath);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return true;
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  return false;
}

function isWithinRoot(filePath, rootPath) {
  const relativePath = path.relative(rootPath, filePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function getTrustedRoot(state, filePath) {
  const roots = Array.isArray(state.trustedRoots) && state.trustedRoots.length > 0
    ? state.trustedRoots
    : [state.codexHome];
  return roots
    .map(rootPath => path.resolve(rootPath))
    .find(rootPath => isWithinRoot(filePath, rootPath)) || null;
}

function snapshotLegacyPath(filePath) {
  const snapshot = readRegularFileNoFollow(filePath);
  const previousType = snapshot ? 'file' : 'missing';
  return {
    path: filePath,
    installedSha256: null,
    previousType,
    previousContentBase64: snapshot ? snapshot.content.toString('base64') : null,
    previousMode: snapshot ? snapshot.mode : null,
  };
}

function assertInstalledStateUnmodified(state) {
  for (const entry of state.paths) {
    const filePath = path.resolve(entry.path);
    const trustedRoot = getTrustedRoot(state, filePath);
    if (!trustedRoot || hasUnsafeManagedAncestor(filePath, trustedRoot)) {
      throw new Error(`Refusing to reuse unsafe legacy Codex ownership path: ${filePath}`);
    }
    const snapshot = readRegularFileNoFollow(filePath);
    if (!entry.installedSha256) {
      if (snapshot) throw new Error(`Refusing to replace modified legacy Codex artifact: ${filePath}`);
      continue;
    }
    const digest = snapshot
      ? crypto.createHash('sha256').update(snapshot.content).digest('hex')
      : null;
    if (digest !== entry.installedSha256) {
      throw new Error(`Refusing to replace modified legacy Codex artifact: ${filePath}`);
    }
  }
}

function beginLegacySyncState(options) {
  const codexHome = path.resolve(options.codexHome);
  const statePath = getStatePath(codexHome);
  const configPath = path.join(codexHome, 'config.toml');
  const agentsPath = path.join(codexHome, 'AGENTS.md');
  const installedHooksPath = options.installedHooksPath ? path.resolve(options.installedHooksPath) : null;
  const priorState = readStateIfPresent(statePath);
  if (priorState && priorState.status !== 'installed') {
    throw new Error(`Legacy Codex sync state requires recovery before reinstall: ${statePath}`);
  }
  if (priorState) assertInstalledStateUnmodified(priorState);
  const trustedRoots = [...new Set([
    codexHome,
    ...(Array.isArray(priorState?.trustedRoots) ? priorState.trustedRoots : []),
    ...(priorState?.installedHooksPath ? [priorState.installedHooksPath] : []),
    ...(installedHooksPath ? [installedHooksPath] : []),
  ].map(rootPath => path.resolve(rootPath)))];
  const state = priorState ? {
    ...priorState,
    status: 'applying',
    updatedAt: new Date().toISOString(),
    backupDir: options.backupDir ? path.resolve(options.backupDir) : priorState.backupDir,
    installedHooksPath,
    trustedRoots,
    rollbackPreviousHooksPath: options.previousHooksPath || null,
    rollbackPaths: priorState.paths.map(entry => snapshotLegacyPath(path.resolve(entry.path))),
    previousInstalledState: priorState,
  } : {
    schema: SCHEMA,
    status: 'applying',
    createdAt: new Date().toISOString(),
    codexHome,
    backupDir: options.backupDir ? path.resolve(options.backupDir) : null,
    previousHooksPath: options.previousHooksPath || null,
    installedHooksPath,
    trustedRoots,
    before: {},
    paths: [],
    rollbackPaths: [],
  };

  for (const [key, filePath] of [['config', configPath], ['agents', agentsPath]]) {
    if (priorState) break;
    const snapshot = readRegularFileNoFollow(filePath, 'utf8');
    state.before[key] = snapshot ? snapshot.content : null;
  }
  atomicWriteJson(statePath, state);
  return statePath;
}

function recordLegacySyncPath(options) {
  const state = readState(options.statePath);
  const filePath = path.resolve(options.filePath);
  const trustedRoot = getTrustedRoot(state, filePath);
  if (!trustedRoot) {
    throw new Error(`Refusing to record a legacy sync path outside trusted roots: ${filePath}`);
  }
  if (hasUnsafeManagedAncestor(filePath, trustedRoot)) {
    throw new Error(`Refusing to manage legacy sync path through symlinked ancestor: ${filePath}`);
  }
  if (!state.paths.some(entry => entry.path === filePath)) {
    const snapshot = snapshotLegacyPath(filePath);
    state.paths.push(snapshot);
    state.rollbackPaths = [...(state.rollbackPaths || []), { ...snapshot }];
    atomicWriteJson(options.statePath, state);
  }
}

function rollbackLegacyCodexSync(options) {
  const state = readState(options.statePath);
  const restoredPaths = [];
  const retainedPaths = [];

  const rollbackPaths = Array.isArray(state.rollbackPaths) ? state.rollbackPaths : state.paths;
  for (const entry of [...rollbackPaths].reverse()) {
    const filePath = path.resolve(entry.path);
    const trustedRoot = getTrustedRoot(state, filePath);
    if (!trustedRoot) {
      retainedPaths.push(filePath);
      continue;
    }
    if (hasUnsafeManagedAncestor(filePath, trustedRoot)) {
      retainedPaths.push(filePath);
      continue;
    }
    let opened = null;
    try {
      opened = openRegularFileNoFollow(filePath, true);
    } catch (_error) {
      retainedPaths.push(filePath);
      continue;
    }
    if (entry.previousType === 'file' && typeof entry.previousContentBase64 === 'string') {
      const previousContent = Buffer.from(entry.previousContentBase64, 'base64');
      const previousMode = entry.previousMode || 0o600;
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      if (opened) {
        try {
          replaceOpenedRegularFile(opened, previousContent, previousMode);
        } finally {
          if (opened.descriptor !== null) fs.closeSync(opened.descriptor);
        }
      } else {
        createRegularFileNoFollow(filePath, previousContent, previousMode);
      }
      restoredPaths.push(filePath);
    } else if (entry.previousType === 'missing' || entry.previousType === undefined) {
      if (opened) {
        try {
          removeOpenedRegularFile(filePath, opened);
        } finally {
          if (opened.descriptor !== null) fs.closeSync(opened.descriptor);
        }
      }
      restoredPaths.push(filePath);
    } else {
      if (opened && opened.descriptor !== null) fs.closeSync(opened.descriptor);
      retainedPaths.push(filePath);
    }
  }

  if (state.installedHooksPath) {
    const getHooks = options.getGlobalHooksPath || defaultGetHooksPath;
    const setHooks = options.setGlobalHooksPath || defaultSetHooksPath;
    const currentHooks = getHooks();
    if (currentHooks && path.resolve(currentHooks) === path.resolve(state.installedHooksPath)) {
      setHooks(state.rollbackPreviousHooksPath ?? state.previousHooksPath ?? '');
    } else if (currentHooks && currentHooks !== (state.rollbackPreviousHooksPath ?? state.previousHooksPath)) {
      retainedPaths.push(`git:core.hooksPath=${currentHooks}`);
    }
  }

  if (retainedPaths.length === 0) {
    if (state.previousInstalledState) {
      atomicWriteJson(options.statePath, state.previousInstalledState);
    } else {
      fs.rmSync(options.statePath, { force: true });
    }
  }
  return {
    status: retainedPaths.length === 0 ? 'rolled-back' : 'partial',
    statePath: options.statePath,
    restoredPaths,
    retainedPaths: [...new Set(retainedPaths)].sort(),
  };
}

function finalizeLegacySyncState(options) {
  const state = readState(options.statePath);
  state.status = 'installed';
  state.installedAt = new Date().toISOString();
  delete state.rollbackPaths;
  delete state.rollbackPreviousHooksPath;
  delete state.previousInstalledState;
  state.paths = state.paths.map(entry => {
    const trustedRoot = getTrustedRoot(state, path.resolve(entry.path));
    let installedSha256 = null;
    if (trustedRoot && !hasUnsafeManagedAncestor(entry.path, trustedRoot)) {
      try {
        const snapshot = readRegularFileNoFollow(entry.path);
        installedSha256 = snapshot
          ? crypto.createHash('sha256').update(snapshot.content).digest('hex')
          : null;
      } catch (_error) {
        installedSha256 = null;
      }
    }
    return { ...entry, installedSha256 };
  });
  atomicWriteJson(options.statePath, state);
  return state;
}

function stripMarkerBlock(content) {
  const markers = [];
  let fence = null;
  let offset = 0;
  for (const lineWithEnding of content.match(/.*(?:\r?\n|$)/g) || []) {
    if (lineWithEnding === '') continue;
    const line = lineWithEnding.replace(/\r?\n$/, '');
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const run = fenceMatch[1];
      const marker = run[0];
      if (!fence) {
        fence = { marker, length: run.length };
      } else if (
        marker === fence.marker
        && run.length >= fence.length
        && fenceMatch[2].trim() === ''
      ) {
        fence = null;
      }
    } else if (!fence && (line === BEGIN_MARKER || line === END_MARKER)) {
      markers.push({ marker: line, index: offset });
    }
    offset += lineWithEnding.length;
  }
  const begins = markers.filter(match => match.marker === BEGIN_MARKER);
  const ends = markers.filter(match => match.marker === END_MARKER);
  if (begins.length !== 1 || ends.length !== 1 || ends[0].index < begins[0].index) {
    return content;
  }
  const suffixStart = ends[0].index + END_MARKER.length;
  const suffixWithLineEnding = content.slice(suffixStart).replace(/^\r?\n/, '');
  return `${content.slice(0, begins[0].index)}${suffixWithLineEnding}`;
}

function defaultGetHooksPath() {
  try {
    return execFileSync('git', ['config', '--global', '--get', 'core.hooksPath'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    }).trim();
  } catch (_error) {
    return '';
  }
}

function defaultSetHooksPath(value) {
  const args = value
    ? ['config', '--global', 'core.hooksPath', value]
    : ['config', '--global', '--unset-all', 'core.hooksPath'];
  try {
    execFileSync('git', args, { stdio: 'ignore', timeout: 5000 });
  } catch (error) {
    if (value || error.status !== 5) throw error;
  }
}

function listLegacyCandidates(codexHome) {
  const candidates = [];
  const promptsDir = path.join(codexHome, 'prompts');
  if (fs.existsSync(promptsDir)) {
    for (const entry of fs.readdirSync(promptsDir)) {
      if (entry.startsWith('ecc-') || entry.startsWith('ecc_') || entry.includes('ecc-rules-pack')) {
        candidates.push(path.join(promptsDir, entry));
      }
    }
  }
  for (const relativePath of [
    'docs/CODEX-NAVIGATION-GUIDE.md',
    'docs/COMMAND-AGENT-MAP.md',
    'COMMANDS-QUICK-REF.md',
    'CONTRIBUTING.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'ecc-prompts-manifest.txt',
    'ecc-extension-prompts-manifest.txt',
  ]) {
    const candidate = path.join(codexHome, relativePath);
    if (fs.existsSync(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function hasMarkerBlock(codexHome) {
  const agentsPath = path.join(codexHome, 'AGENTS.md');
  try {
    const snapshot = readRegularFileNoFollow(agentsPath, 'utf8');
    if (snapshot) {
      const stripped = stripMarkerBlock(snapshot.content);
      return stripped !== snapshot.content;
    }
  } catch (_error) {
    // Non-regular or unreadable AGENTS.md is not a clean marker signal.
  }
  return false;
}

function detectLegacyCodexSync(codexHome) {
  const resolvedCodexHome = path.resolve(codexHome || process.env.CODEX_HOME || path.join(process.env.HOME || os.homedir(), '.codex'));
  if (readStateIfPresent(getStatePath(resolvedCodexHome))) return true;
  return hasMarkerBlock(resolvedCodexHome);
}

function uninstallLegacyCodexSync(options = {}) {
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(process.env.HOME || os.homedir(), '.codex'));
  const statePath = getStatePath(codexHome);
  const dryRun = options.dryRun === true;
  const retainedPaths = [];
  const plannedRemovals = [];
  const removedPaths = [];
  const agentsPath = path.join(codexHome, 'AGENTS.md');
  const state = readStateIfPresent(statePath);

  if (!state) {
    let openedAgents = null;
    try {
      openedAgents = openRegularFileNoFollow(agentsPath, !dryRun);
      if (openedAgents) {
        const content = fs.readFileSync(openedAgents.descriptor, 'utf8');
        const stripped = stripMarkerBlock(content);
        if (stripped !== content) {
          plannedRemovals.push(`${agentsPath}#ecc-marker-block`);
          if (!dryRun) replaceOpenedRegularFile(openedAgents, stripped, openedAgents.stat.mode & 0o777);
        }
      }
    } catch (_error) {
      if (_error.code !== 'ENOENT') retainedPaths.push(agentsPath);
    } finally {
      if (openedAgents) fs.closeSync(openedAgents.descriptor);
    }
    retainedPaths.push(...listLegacyCandidates(codexHome));
    const hasWork = plannedRemovals.length > 0 || removedPaths.length > 0;
    const status = dryRun
      ? (hasWork || retainedPaths.length > 0 ? 'planned' : 'not-found')
      : (retainedPaths.length > 0 ? 'partial' : (hasWork ? 'uninstalled' : 'not-found'));
    return {
      status,
      statePath: null,
      plannedRemovals,
      removedPaths,
      retainedPaths: [...new Set(retainedPaths)].sort(),
      warnings: retainedPaths.length > 0
        ? ['Legacy Codex artifacts without an ownership manifest were preserved for manual review.']
        : [],
    };
  }

  for (const entry of state.paths) {
    const filePath = path.resolve(entry.path);
    const trustedRoot = getTrustedRoot(state, filePath);
    if (!trustedRoot) {
      retainedPaths.push(filePath);
      continue;
    }
    if (hasUnsafeManagedAncestor(filePath, trustedRoot)) {
      retainedPaths.push(filePath);
      continue;
    }
    let opened = null;
    try {
      opened = openRegularFileNoFollow(filePath, !dryRun);
    } catch (_error) {
      retainedPaths.push(filePath);
      continue;
    }
    if (!opened) continue;
    const currentContent = fs.readFileSync(opened.descriptor);
    const matches = entry.installedSha256
      ? crypto.createHash('sha256').update(currentContent).digest('hex') === entry.installedSha256
      : false;
    if (!matches) {
      if (opened.descriptor !== null) fs.closeSync(opened.descriptor);
      retainedPaths.push(filePath);
      continue;
    }
    plannedRemovals.push(filePath);
    if (!dryRun) {
      if (entry.previousType === 'file' && typeof entry.previousContentBase64 === 'string') {
        replaceOpenedRegularFile(
          opened,
          Buffer.from(entry.previousContentBase64, 'base64'),
          entry.previousMode || 0o600
        );
      } else if (entry.previousType === 'missing' || entry.previousType === undefined) {
        removeOpenedRegularFile(filePath, opened);
      } else {
        if (opened.descriptor !== null) fs.closeSync(opened.descriptor);
        retainedPaths.push(filePath);
        continue;
      }
      removedPaths.push(filePath);
    }
    if (opened.descriptor !== null) fs.closeSync(opened.descriptor);
  }

  if (state.installedHooksPath) {
    const getHooks = options.getGlobalHooksPath || defaultGetHooksPath;
    const setHooks = options.setGlobalHooksPath || defaultSetHooksPath;
    const currentHooks = getHooks();
    if (path.resolve(currentHooks || '.') === path.resolve(state.installedHooksPath)) {
      if (!dryRun) setHooks(state.previousHooksPath || '');
    } else if (currentHooks) {
      retainedPaths.push(`git:core.hooksPath=${currentHooks}`);
    }
  }

  if (!dryRun && retainedPaths.length === 0) {
    fs.rmSync(statePath, { force: true });
  }
  return {
    status: dryRun ? 'planned' : retainedPaths.length > 0 ? 'partial' : 'uninstalled',
    statePath,
    plannedRemovals: [...new Set(plannedRemovals)],
    removedPaths,
    retainedPaths: [...new Set(retainedPaths)].sort(),
    warnings: retainedPaths.length > 0
      ? ['Modified or unverifiable legacy Codex artifacts were preserved.']
      : [],
  };
}

module.exports = {
  BEGIN_MARKER,
  END_MARKER,
  SCHEMA,
  beginLegacySyncState,
  detectLegacyCodexSync,
  finalizeLegacySyncState,
  getStatePath,
  recordLegacySyncPath,
  rollbackLegacyCodexSync,
  stripMarkerBlock,
  uninstallLegacyCodexSync,
};
