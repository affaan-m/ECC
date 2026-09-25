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
const { isGitRepo, getGitModifiedFiles, readFile, log } = require('../lib/utils');

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
    if (!isGitRepo()) {
      passThroughAndExit();
      return;
    }

    const files = getGitModifiedFiles(['\\.tsx?$', '\\.jsx?$'])
      .filter(f => fs.existsSync(f))
      .filter(f => !EXCLUDED_PATTERNS.some(pattern => pattern.test(f)));

    let hasConsole = false;

    for (const file of files) {
      const content = readFile(file);
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
