'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MARKETPLACE_PATH = '.grok-plugin/marketplace.json';
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function validateGrokPin(root = path.resolve(__dirname, '../..'), { release = false } = {}) {
  const marketplace = JSON.parse(fs.readFileSync(path.join(root, MARKETPLACE_PATH), 'utf8'));
  const source = marketplace.plugins && marketplace.plugins[0] && marketplace.plugins[0].source;
  const sha = source && source.sha;
  if (!SHA_PATTERN.test(sha || '')) {
    throw new Error('Grok marketplace source must pin a 40-character lowercase commit SHA');
  }

  const head = git(root, ['rev-parse', 'HEAD']);
  const pinned = git(root, ['rev-parse', '--verify', `${sha}^{commit}`]);
  if (pinned !== sha) throw new Error(`Grok marketplace pin is not a commit: ${sha}`);
  try {
    git(root, ['merge-base', '--is-ancestor', sha, 'HEAD']);
  } catch {
    throw new Error(`Grok marketplace pin ${sha} is not an ancestor of HEAD ${head}`);
  }
  // Development retains the last pinned snapshot; releases must include all source changes.
  if (release) {
    try {
      git(root, ['diff', '--quiet', sha, 'HEAD', '--', '.', `:(exclude)${MARKETPLACE_PATH}`]);
    } catch {
      throw new Error(`Grok marketplace pin ${sha} is stale; source changes exist after the pinned commit`);
    }
  }
  return { sha, head };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--release')) {
      throw new Error('Usage: node scripts/ci/validate-grok-pin.js [--release]');
    }
    const release = args[0] === '--release';
    const { sha, head } = validateGrokPin(undefined, { release });
    console.log(release
      ? `Grok marketplace pin ${sha} matches source at ${head}`
      : `Grok marketplace pin ${sha} is a valid ancestor of ${head}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { validateGrokPin };
