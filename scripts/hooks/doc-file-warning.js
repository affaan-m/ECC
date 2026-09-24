#!/usr/bin/env node
/**
 * Doc file warning hook (PreToolUse - Write)
 *
 * Uses a denylist approach: only warn on known ad-hoc documentation
 * filenames (NOTES, TODO, SCRATCH, etc.) outside structured directories.
 * This avoids false positives for legitimate markdown-heavy workflows
 * (specs, ADRs, command definitions, skill files, etc.).
 *
 * Policy ported from the intent of PR #962 into the current hook architecture.
 * Exit code 0 always (warns only, never blocks).
 */

'use strict';

const path = require('path');
const { buildPreToolUseAdditionalContext } = require('./pretooluse-visible-output');

const MAX_DIRECT_STDIN_BYTES = 16 * 1024 * 1024;

// Known ad-hoc filenames that indicate impulse/scratch files (case-sensitive, uppercase only)
const ADHOC_FILENAMES = /^(NOTES|TODO|SCRATCH|TEMP|DRAFT|BRAINSTORM|SPIKE|DEBUG|WIP)\.(md|txt)$/;

// Structured directories where even ad-hoc names are intentional
const STRUCTURED_DIRS = /(^|\/)(docs|\.claude|\.github|commands|skills|benchmarks|templates|\.history|memory)\//;

function isSuspiciousDocPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const basename = path.basename(normalized);

  // Only inspect .md and .txt files (case-sensitive, consistent with ADHOC_FILENAMES)
  if (!/\.(md|txt)$/.test(basename)) return false;

  // Only flag known ad-hoc filenames
  if (!ADHOC_FILENAMES.test(basename)) return false;

  // Allow ad-hoc names inside structured directories (intentional usage)
  if (STRUCTURED_DIRS.test(normalized)) return false;

  return true;
}

/**
 * Exportable run() for in-process execution via run-with-flags.js.
 * Avoids the ~50-100ms spawnSync overhead when available.
 */
function run(inputOrRaw, _options = {}) {
  let input;
  try {
    input = typeof inputOrRaw === 'string'
      ? (inputOrRaw.trim() ? JSON.parse(inputOrRaw) : {})
      : (inputOrRaw || {});
  } catch {
    return { exitCode: 0 };
  }
  const filePath = String(input?.tool_input?.file_path || '');

  if (filePath && isSuspiciousDocPath(filePath)) {
    return {
      exitCode: 0,
      additionalContext: [
        '[Hook] WARNING: Ad-hoc documentation filename detected',
        `[Hook] File: ${filePath}`,
        '[Hook] Consider using a structured path (e.g. docs/, .claude/, skills/, .github/, benchmarks/, templates/)',
      ],
    };
  }

  return { exitCode: 0 };
}

/**
 * Stdin entrypoint for direct/spawnSync execution: reads the hook payload from
 * stdin, runs the policy, and writes the PreToolUse result to stdout. Direct
 * and legacy entrypoints preserve complete supported payloads up to 16MiB;
 * the production runner applies its stricter bounded-input policy. Must only
 * run when invoked directly so stdin listeners are not leaked into a parent.
 */
function main() {
  let data = '';
  let stdinBytes = 0;
  let oversized = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => {
    if (oversized) return;
    stdinBytes += Buffer.byteLength(c, 'utf8');
    if (stdinBytes > MAX_DIRECT_STDIN_BYTES) {
      data = '';
      oversized = true;
      return;
    }
    data += c;
  });

  process.stdin.on('end', () => {
    if (oversized) return;
    const result = run(data);

    if (result.stderr) {
      process.stderr.write(result.stderr + '\n');
    }

    if (Object.prototype.hasOwnProperty.call(result, 'additionalContext')) {
      process.stdout.write(buildPreToolUseAdditionalContext(result.additionalContext));
    } else {
      process.stdout.write(data);
    }
  });
}

module.exports = { run, main };

// Stdin fallback for spawnSync execution — only when invoked directly, not via require()
if (require.main === module) {
  main();
}
