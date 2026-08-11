#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { isHookEnabled } = require('../lib/hook-flags');

const MAX_STDIN = 1024 * 1024;
const MAX_FAILURE_TEXT = 64 * 1024;
const HOOK_ID = 'post:bash-failure:sandbox-escalation-suggest';
const TRUSTED_CLI = path.resolve(__dirname, '..', 'sandbox', 'ecc-sandbox');
const STRONG_DENIAL_PATTERNS = [
  /\b(?:sandbox|seatbelt)\b[^\n]{0,80}\b(?:deny|denied|blocked|violation)\b/i,
  /\bdeny\(\d+\)/i,
  /\b(?:bwrap|bubblewrap|seccomp)\b[^\n]{0,120}\b(?:denied|not permitted|failed)\b/i,
  /\boperation not permitted\b/i,
  /\bread-only file system\b/i,
  /\bEPERM\b/,
  /\bnetwork\b[^\n]{0,80}\b(?:blocked|denied|not permitted)\b/i,
];
const GENERIC_PERMISSION = /\bpermission denied\b/i;
const ISOLATION_CONTEXT = /\b(?:sandbox|container|podman|docker|filesystem|file system|system|usr|etc|home|root|package|npm|pip|brew|apt|dnf|yum)\b/i;

function readStdin() {
  return new Promise(resolve => {
    let raw = '';
    let truncated = false;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      const remaining = MAX_STDIN - raw.length;
      if (remaining > 0) raw += chunk.slice(0, remaining);
      if (chunk.length > remaining) truncated = true;
    });
    process.stdin.on('end', () => resolve({ raw, truncated }));
    process.stdin.on('error', () => resolve({ raw, truncated: true }));
  });
}

function parseInput(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function stringsFrom(value, depth = 0) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || depth >= 2) return [];
  const fields = ['error', 'message', 'output', 'stderr', 'stdout'];
  return fields.flatMap(field => stringsFrom(value[field], depth + 1));
}

function extractFailureText(input) {
  const fields = ['error', 'message', 'tool_response', 'tool_output'];
  return fields
    .flatMap(field => stringsFrom(input?.[field]))
    .join('\n')
    .slice(-MAX_FAILURE_TEXT);
}

function isSandboxDenial(text) {
  if (!text) return false;
  if (STRONG_DENIAL_PATTERNS.some(pattern => pattern.test(text))) return true;
  return GENERIC_PERMISSION.test(text) && ISOLATION_CONTEXT.test(text);
}

function isEccSandboxCommand(input) {
  const command = input?.tool_input?.command;
  return typeof command === 'string'
    && /(?:^|[\s/])ecc-sandbox["']?(?:\s|$)/.test(command);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function suggestion(input, options = {}) {
  const prefix = '[SandboxTesting] This failure looks like an isolation denial.';
  if (isEccSandboxCommand(input)) {
    return `${prefix} Read the emitted JSON report and its notes/escalations; do not retry with broader host permissions.`;
  }
  const cliPath = options.cliPath || TRUSTED_CLI;
  const cliAvailable = options.cliAvailable ?? fs.existsSync(cliPath);
  const preview = cliAvailable
    ? `preview with the trusted ECC CLI: ${shellQuote(cliPath)} run sandbox.yaml --dry-run`
    : 'install the trusted runtime with npm install --global ecc-universal, then preview with ecc-sandbox run sandbox.yaml --dry-run';
  return `${prefix} Declare the test needs in sandbox.yaml, then ${preview}. Do not execute a repository-local ecc-sandbox lookalike. ECC allows at most one recorded escalation; do not weaken the current host sandbox.`;
}

function run(raw, options = {}) {
  const env = options.env || process.env;
  if (!isHookEnabled(HOOK_ID, { env, profiles: ['standard', 'strict'] })) {
    return { stdout: '', exitCode: 0 };
  }
  if (options.truncated) return { stdout: '', exitCode: 0 };
  const input = parseInput(raw);
  if (!input || !isSandboxDenial(extractFailureText(input))) {
    return { stdout: '', exitCode: 0 };
  }
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUseFailure',
        additionalContext: suggestion(input, options),
      },
    }),
    exitCode: 0,
  };
}

async function cli() {
  const input = await readStdin();
  const result = run(input.raw, { truncated: input.truncated });
  if (result.stdout) process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
}

if (require.main === module) {
  cli().catch(() => {
    process.exitCode = 0;
  });
}

module.exports = {
  extractFailureText,
  isSandboxDenial,
  run,
  shellQuote,
  suggestion,
};
