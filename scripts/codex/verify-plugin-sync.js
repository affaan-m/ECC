#!/usr/bin/env node
'use strict';

/**
 * Audit SHA-256 parity between a Codex plugin cache directory and the source checkout
 * for SessionStart hook assets (#3526).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TARGET_FILES = [
  'hooks/codex-hooks.json',
  'scripts/hooks/plugin-hook-bootstrap.js',
  'scripts/hooks/session-start-bootstrap.js',
  'scripts/hooks/run-with-flags.js',
  'scripts/hooks/session-start.js',
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function compareCacheToRepo(cacheDir, repoRoot = path.resolve(__dirname, '..', '..')) {
  const results = [];
  for (const rel of TARGET_FILES) {
    const repoFile = path.join(repoRoot, rel);
    const cacheFile = path.join(cacheDir, rel);
    if (!fs.existsSync(cacheFile)) {
      results.push({ file: rel, status: 'MISSING_IN_CACHE' });
      continue;
    }
    const repoHash = fs.existsSync(repoFile) ? sha256(repoFile) : null;
    const cacheHash = sha256(cacheFile);
    results.push({
      file: rel,
      status: repoHash === cacheHash ? 'MATCH' : 'DIFFERENT',
      cacheHash,
      repoHash,
    });
  }
  return results;
}

if (require.main === module) {
  if (process.argv.includes('--help')) {
    console.log('Usage: verify-plugin-sync.js [--plugin-dir <dir>]');
    process.exit(0);
  }
  const idx = process.argv.indexOf('--plugin-dir');
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const cacheDir = idx >= 0 && process.argv[idx + 1]
    ? path.resolve(process.argv[idx + 1])
    : path.join(codexHome, 'plugins', 'cache', 'ecc', 'ecc', pkg.version);
  const rows = compareCacheToRepo(cacheDir);
  console.log(JSON.stringify({ cacheDir, rows }, null, 2));
  process.exit(rows.some((r) => r.status !== 'MATCH') ? 1 : 0);
}

module.exports = { compareCacheToRepo, TARGET_FILES };
