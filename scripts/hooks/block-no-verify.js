#!/usr/bin/env node
/**
 * PreToolUse Hook: Block git hook bypasses
 *
 * Delegates to the block-no-verify package, which blocks --no-verify,
 * core.hooksPath overrides and hook-manager skip variables so AI agents
 * cannot skip pre-commit, commit-msg and pre-push hooks.
 *
 * Exit codes:
 *   0 = allow
 *   2 = block
 */

'use strict';

const { checkCommand } = require('./vendor/block-no-verify.cjs');

const MAX_STDIN = 1024 * 1024;

/**
 * Extract the command string from hook input (JSON or plain text).
 *
 * @param {string} rawInput
 * @returns {string}
 */
function extractCommand(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null) return trimmed;
    if (typeof parsed.tool_input?.command === 'string') return parsed.tool_input.command;
    for (const key of ['command', 'cmd', 'input', 'shell', 'script']) {
      if (typeof parsed[key] === 'string') return parsed[key];
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Exportable run() for in-process execution via run-with-flags.js.
 *
 * @param {string} rawInput
 * @returns {{exitCode: number, stderr?: string}}
 */
function run(rawInput) {
  let result;
  try {
    result = checkCommand(extractCommand(rawInput));
  } catch (error) {
    // Fail closed: a crash would exit 1, which agents treat as allow.
    return { exitCode: 2, stderr: `BLOCKED: block-no-verify could not analyse this command (${error.message}), so hook-bypass safety could not be established.` };
  }
  return result.blocked ? { exitCode: 2, stderr: result.reason } : { exitCode: 0 };
}

module.exports = { run };

// Stdin fallback for spawnSync execution — only when invoked directly, not via require()
if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) raw += chunk.substring(0, MAX_STDIN - raw.length);
  });
  process.stdin.on('end', () => {
    const result = run(raw);
    if (result.exitCode === 2) {
      process.stderr.write(result.stderr + '\n');
      process.exit(2);
    }
    process.stdout.write(raw);
  });
}
