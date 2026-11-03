#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_STDIN = 1024 * 1024;
let raw = '';

const MODE_CONFIG = {
  audit: {
    fileName: 'bash-commands.log',
    format: command => `[${new Date().toISOString()}] ${command}`,
  },
  cost: {
    fileName: 'cost-tracker.log',
    format: command => `[${new Date().toISOString()}] tool=Bash command=${command}`,
  },
};

// A JWT header is base64url JSON, so it starts with `ey` (`{"`, `{ `) or
// `ew` (`{` followed by a newline or tab). The common `eyJ` form is always
// redacted; other headers must decode to an object with an `alg` field.
function redactJwt(token) {
  if (token.startsWith('eyJ')) return '<REDACTED>';
  try {
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    if (header && typeof header === 'object' && typeof header.alg === 'string') return '<REDACTED>';
  } catch {
    // Not a JWT header; keep the text.
  }
  return token;
}

function sanitizeCommand(command) {
  return String(command || '')
    .replace(/\n/g, ' ')
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, '<REDACTED>')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, '<REDACTED>')
    .replace(/\be[wy][A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, redactJwt)
    // Value: "..." with escapes, $'...' with escapes, '...', or a bare word
    // with backslash escapes. Unterminated quotes are redacted to the end.
    .replace(
      /(\b|_)(secret|api[_-]?key)(\s*[:=]\s*)("(?:[^"\\]|\\.)*(?:"|$)|\$'(?:[^'\\]|\\.)*(?:'|$)|'[^']*(?:'|$)|(?:[^\s"'\\]|\\.)+)/gi,
      '$1$2$3<REDACTED>'
    )
    .replace(/--token[= ][^ ]*/g, '--token=<REDACTED>')
    .replace(/Authorization:[: ]*[^ ]*[: ]*[^ ]*/gi, 'Authorization:<REDACTED>')
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, '<REDACTED>')
    .replace(/\bASIA[A-Z0-9]{16}\b/g, '<REDACTED>')
    .replace(/password[= ][^ ]*/gi, 'password=<REDACTED>')
    .replace(/\bghp_[A-Za-z0-9_]+\b/g, '<REDACTED>')
    .replace(/\bgho_[A-Za-z0-9_]+\b/g, '<REDACTED>')
    .replace(/\bghs_[A-Za-z0-9_]+\b/g, '<REDACTED>')
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, '<REDACTED>');
}

function appendLine(filePath, line) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${line}\n`, 'utf8');
}

// Resolve the Claude profile directory the same way everywhere.
//
// Duplicated rather than imported on purpose: hooks ship in managed installs
// that carry top-level `scripts/` without `scripts/lib/` (see #3259), so a
// require into lib/ would make the hook unloadable there. `~` is expanded the
// way `scripts/lib/agent-data-home.js` expands it, so a profile written as
// `~/.claude-work` resolves to one place rather than two.
function claudeConfigDir() {
  const configured = process.env.CLAUDE_CONFIG_DIR;
  const trimmed = configured ? String(configured).trim() : '';
  if (!trimmed) return path.join(os.homedir(), '.claude');
  if (trimmed.startsWith('~')) {
    const remainder = trimmed.slice(1).replace(/^[/\\]+/, '');
    return remainder ? path.join(os.homedir(), remainder) : os.homedir();
  }
  return path.resolve(trimmed);
}

function run(rawInput, mode = 'audit') {
  const config = MODE_CONFIG[mode];

  try {
    if (config) {
      const input = String(rawInput || '').trim() ? JSON.parse(String(rawInput)) : {};
      const command = sanitizeCommand(input.tool_input?.command || '?');
      appendLine(path.join(claudeConfigDir(), config.fileName), config.format(command));
    }
  } catch {
    // Logging must never block the calling hook.
  }

  return typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
}

function main() {
  const mode = process.argv[2];

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) {
      const remaining = MAX_STDIN - raw.length;
      raw += chunk.substring(0, remaining);
    }
  });

  process.stdin.on('end', () => {
    process.stdout.write(run(raw, mode));
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  run,
  sanitizeCommand,
};
