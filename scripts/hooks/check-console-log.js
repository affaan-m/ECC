#!/usr/bin/env node

/**
 * Stop Hook: Check for console.log statements in modified files
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs after each response and checks if any modified JavaScript/TypeScript
 * files contain console.log statements. Provides warnings to help developers
 * remember to remove debug statements before committing.
 *
 * Exclusions: test files, config files, and scripts/ directory (where
 * console.log is often intentional).
 */

const fs = require('fs');
const path = require('path');
const { isGitRepo, getGitModifiedFiles, readFile, log, runCommand } = require('../lib/utils');

// Files where console.log is expected and should not trigger warnings
const EXCLUDED_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\.config\.[jt]s$/,
  /scripts\//,
  /__tests__\//,
  /__mocks__\//,
];

const MAX_DIRECT_STDIN_BYTES = 16 * 1024 * 1024;

// This Stop hook inspects the session's working directory. Inherited GIT_*
// variables from another Git process can silently redirect discovery and diff
// commands to a different repository, so give every Git call the same clean env.
const MAX_GIT_SUBPROCESS_TIMEOUT_MS = 3000;

function resolveGitTimeoutMs(env = process.env) {
  const deadline = Number(env.ECC_HOOK_DEADLINE_MS);
  if (Number.isFinite(deadline) && deadline > Date.now()) {
    // Leave at least 500ms headroom for remaining Stop hook checks/flush.
    return Math.max(250, Math.min(MAX_GIT_SUBPROCESS_TIMEOUT_MS, deadline - Date.now() - 500));
  }
  return MAX_GIT_SUBPROCESS_TIMEOUT_MS;
}

function sessionGitOptions() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.toUpperCase().startsWith('GIT_')) delete env[name];
  }
  return { env, timeout: resolveGitTimeoutMs(env) };
}

let data = '';
let stdinBytes = 0;
let oversized = false;
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  if (oversized) return;
  stdinBytes += Buffer.byteLength(chunk, 'utf8');
  if (stdinBytes > MAX_DIRECT_STDIN_BYTES) {
    data = '';
    oversized = true;
    return;
  }
  data += chunk;
});

/**
 * Echo stdin back (ECC pass-through convention), then exit once the pipe has
 * flushed. Direct/legacy entrypoints preserve complete supported payloads up
 * to 16MiB; the production runner applies its stricter bounded-input policy.
 */
function passThroughAndExit() {
  if (oversized) {
    log('[Hook] check-console-log: direct stdin exceeded 16MiB; suppressing pass-through');
    process.exit(0);
  }
  if (!data) {
    process.exit(0);
  }
  process.stdout.write(data, () => process.exit(0));
}

process.stdin.on('end', () => {
  try {
    const gitOptions = sessionGitOptions();
    if (!isGitRepo(gitOptions)) {
      passThroughAndExit();
      return;
    }

    // git reports paths from the repository root, and the session can run in a
    // subdirectory of it, so read each file from the root.
    const root = runCommand('git rev-parse --show-toplevel', gitOptions).output;
    const files = getGitModifiedFiles(['\\.tsx?$', '\\.jsx?$'], gitOptions)
      .filter(f => fs.existsSync(path.join(root, f)))
      .filter(f => {
        const normalized = String(f).replace(/\\/g, '/');
        return !EXCLUDED_PATTERNS.some(pattern => pattern.test(normalized));
      });

    let hasConsole = false;

    for (const file of files) {
      const content = readFile(path.join(root, file));
      if (content && content.includes('console.log')) {
        log(`[Hook] WARNING: console.log found in ${file}`);
        hasConsole = true;
      }
    }

    if (hasConsole) {
      log('[Hook] Remove console.log statements before committing');
    }
  } catch (err) {
    log(`[Hook] check-console-log error: ${err.message}`);
  }

  // Always output the complete original data.
  passThroughAndExit();
});
