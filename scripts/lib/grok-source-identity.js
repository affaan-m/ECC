'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SHA_PATTERN = /^[0-9a-f]{40}$/;

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

function copyInstallSource(sourceRoot, dest, pathModule = path, sha) {
  if (isGitWorkTreeRoot(sourceRoot, pathModule)) {
    if (!resolvePinnedGitSha(sourceRoot, sha)) {
      throw new Error(`pinned SHA ${sha} is not in source git`);
    }
    copyGitArchive(sourceRoot, sha, dest, pathModule);
    return { mode: 'git-archive', sha };
  }

  fs.cpSync(sourceRoot, dest, { recursive: true });
  return { mode: 'tree' };
}

function assertSourceIdentity(sourceRoot, source, pathModule = path) {
  if (isGitWorkTreeRoot(sourceRoot, pathModule)) {
    if (!resolvePinnedGitSha(sourceRoot, source && source.sha)) {
      throw new Error(`pinned SHA ${source && source.sha} is not in source git`);
    }
    return 'git-archive';
  }

  const catalogPath = pathModule.join(sourceRoot, '.grok-plugin', 'marketplace.json');
  if (!fs.existsSync(catalogPath)) {
    return 'tree';
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const plugin = catalog && Array.isArray(catalog.plugins) ? catalog.plugins[0] : null;
  const catalogSha = plugin && plugin.source && plugin.source.sha;
  if (catalogSha && catalogSha !== source.sha) {
    throw new Error('sourceRoot marketplace sha does not match install plan pin');
  }
  return 'tree';
}

function writePinnedMarketplace(dest, source, pathModule = path) {
  const catalogPath = pathModule.join(dest, '.grok-plugin', 'marketplace.json');
  if (!fs.existsSync(catalogPath)) {
    return false;
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (!catalog.plugins || !catalog.plugins[0]) {
    return false;
  }
  catalog.plugins[0].source = {
    source: source.source,
    url: source.url,
    sha: source.sha,
  };
  fs.mkdirSync(pathModule.dirname(catalogPath), { recursive: true });
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return true;
}

module.exports = {
  SHA_PATTERN,
  isGitWorkTreeRoot,
  resolvePinnedGitSha,
  copyInstallSource,
  assertSourceIdentity,
  writePinnedMarketplace,
};
