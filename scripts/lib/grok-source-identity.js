'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const TEMP_SOURCE_ROOTS = new Set();

process.once('exit', () => {
  for (const tempRoot of TEMP_SOURCE_ROOTS) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function isGitWorkTreeRoot(dir, pathModule = path) {
  try {
    const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return pathModule.resolve(top) === pathModule.resolve(dir);
  } catch {
    return false;
  }
}

function resolvePinnedGitSha(sourceRoot, sha) {
  if (!SHA_PATTERN.test(sha || '')) {
    return null;
  }
  try {
    const resolved = execFileSync(
      'git',
      ['-C', sourceRoot, 'rev-parse', '--verify', `${sha}^{commit}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return resolved === sha ? resolved : null;
  } catch {
    return null;
  }
}

function listGitTreeFiles(sourceRoot, sha) {
  return execFileSync(
    'git',
    ['-C', sourceRoot, 'ls-tree', '-r', '--name-only', '-z', sha],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).split('\0').filter(Boolean);
}

function copyGitTreeFiles(sourceRoot, sha, dest, pathModule = path) {
  const files = listGitTreeFiles(sourceRoot, sha);
  for (const relative of files) {
    const content = execFileSync(
      'git',
      ['-C', sourceRoot, 'show', `${sha}:${relative}`],
      { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const to = pathModule.join(dest, relative);
    fs.mkdirSync(pathModule.dirname(to), { recursive: true });
    fs.writeFileSync(to, content);
  }
}

function copyGitArchive(sourceRoot, sha, dest, pathModule = path) {
  fs.mkdirSync(dest, { recursive: true });
  try {
    const archive = execFileSync(
      'git',
      ['-C', sourceRoot, 'archive', '--format=tar', sha],
      { maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    execFileSync('tar', ['-x', '-C', dest], {
      input: archive,
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
  } catch {
    copyGitTreeFiles(sourceRoot, sha, dest, pathModule);
  }
}

function readPinnedMarketplaceSource(sourceRoot, pathModule = path) {
  const catalogPath = pathModule.join(sourceRoot, '.grok-plugin', 'marketplace.json');
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read Grok marketplace source at ${catalogPath}: ${error.message}`);
  }
  const plugin = catalog && Array.isArray(catalog.plugins) ? catalog.plugins[0] : null;
  const source = plugin && plugin.source;
  if (!source || source.source !== 'url' || typeof source.url !== 'string' || !source.url.trim()) {
    throw new Error('Grok marketplace source must be a Git URL');
  }
  if (!SHA_PATTERN.test(source.sha || '')) {
    throw new Error('Grok marketplace source must pin a 40-character lowercase commit SHA');
  }
  if (typeof plugin.version !== 'string' || !plugin.version.trim()) {
    throw new Error('Grok marketplace source must declare a plugin version');
  }
  return {
    url: source.url,
    sha: source.sha,
    version: plugin.version,
  };
}

function normalizeGitLocation(value, pathModule = path) {
  const location = String(value || '').trim().replace(/\/+$/, '').replace(/\.git$/, '');
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|git@)/i.test(location)) {
    return location;
  }
  return pathModule.resolve(location);
}

function findRegistrySource(sourceRoot, homeDir, pathModule = path) {
  const registryPath = pathModule.join(homeDir, '.grok', 'installed-plugins', 'registry.json');
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Failed to read Grok plugin registry at ${registryPath}: ${error.message}`);
  }
  const expectedPath = fs.realpathSync(sourceRoot);
  for (const record of Object.values(registry.repos || {})) {
    let recordPath;
    try {
      recordPath = fs.realpathSync(record.path);
    } catch {
      continue;
    }
    if (recordPath !== expectedPath || String(record.kind && record.kind.type).toLowerCase() !== 'git') {
      continue;
    }
    return {
      url: record.kind.url,
      sha: record.kind.commit,
    };
  }
  return null;
}

function fetchPinnedGitSource(sourceUrl, sha, parentDir) {
  const gitDir = path.join(parentDir, 'git');
  fs.mkdirSync(gitDir, { recursive: true });
  execFileSync('git', ['init', '--bare', '--quiet', gitDir], { stdio: 'ignore' });
  execFileSync('git', ['-C', gitDir, 'fetch', '--quiet', '--depth=1', '--no-tags', sourceUrl, sha], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const fetched = execFileSync('git', ['-C', gitDir, 'rev-parse', 'FETCH_HEAD^{commit}'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (fetched !== sha) {
    throw new Error(`Fetched Grok source commit ${fetched} does not match pinned SHA ${sha}`);
  }
  return gitDir;
}

function assertNoSymlinks(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Pinned Grok source contains unsupported symlink: ${entryPath}`);
    }
    if (entry.isDirectory()) assertNoSymlinks(entryPath);
  }
}

function preparePinnedGrokSource(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || '');
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const catalogSource = readPinnedMarketplaceSource(sourceRoot);
  const sourceUrl = options.sourceUrl || catalogSource.url;
  const sourceSha = options.sourceSha || catalogSource.sha;
  if (normalizeGitLocation(sourceUrl) !== normalizeGitLocation(catalogSource.url)) {
    throw new Error('Recorded Grok source URL does not match the marketplace source');
  }
  if (!SHA_PATTERN.test(sourceSha || '')) {
    throw new Error('Recorded Grok source must pin a 40-character lowercase commit SHA');
  }

  let gitSourceRoot = null;
  if (isGitWorkTreeRoot(sourceRoot) && resolvePinnedGitSha(sourceRoot, sourceSha)) {
    gitSourceRoot = sourceRoot;
  } else {
    const registrySource = findRegistrySource(sourceRoot, homeDir);
    if (!registrySource
      || normalizeGitLocation(registrySource.url) !== normalizeGitLocation(sourceUrl)
      || registrySource.sha !== sourceSha) {
      throw new Error('Non-Git Grok source is unverifiable without matching registry URL/SHA evidence');
    }
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-grok-source-'));
  TEMP_SOURCE_ROOTS.add(tempRoot);
  const snapshotRoot = path.join(tempRoot, 'snapshot');
  try {
    if (!gitSourceRoot) {
      gitSourceRoot = fetchPinnedGitSource(sourceUrl, sourceSha, tempRoot);
    }
    copyGitArchive(gitSourceRoot, sourceSha, snapshotRoot);
    assertNoSymlinks(snapshotRoot);
    const snapshotManifest = JSON.parse(
      fs.readFileSync(path.join(snapshotRoot, '.grok-plugin', 'plugin.json'), 'utf8')
    );
    // The current catalog version proves the default pin. An explicit
    // rollback pin may intentionally resolve an older release, whose version
    // must come from that immutable snapshot instead of today's catalog.
    if (sourceSha === catalogSource.sha && snapshotManifest.version !== catalogSource.version) {
      throw new Error(
        `Pinned Grok plugin version ${snapshotManifest.version || '(missing)'} does not match marketplace version ${catalogSource.version}`
      );
    }
    fs.writeFileSync(path.join(snapshotRoot, '.ecc-source.json'), `${JSON.stringify({
      source: 'url',
      url: sourceUrl,
      sha: sourceSha,
    }, null, 2)}\n`);
    return {
      sourceRoot: snapshotRoot,
      sourceUrl,
      sourceSha,
      sourceVersion: snapshotManifest.version,
      cleanup: () => {
        TEMP_SOURCE_ROOTS.delete(tempRoot);
        fs.rmSync(tempRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    TEMP_SOURCE_ROOTS.delete(tempRoot);
    throw error;
  }
}

module.exports = {
  SHA_PATTERN,
  isGitWorkTreeRoot,
  resolvePinnedGitSha,
  readPinnedMarketplaceSource,
  preparePinnedGrokSource,
};
