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

// Redact JWTs inside one run of `[A-Za-z0-9_.-]` characters. A JWT may follow
// a word prefix joined by `-` or `_` (`session=jwt-<JWT>`, `session_<JWT>`), so
// each dot-separated segment is checked for a header starting at its beginning
// or after a `-` or `_`.
// Every segment is scanned once and decoded at most once, keeping long
// `ey-ey-...` runs linear (a `\b`-anchored regex retries at each `-`).
function redactJwtsInChain(chain) {
  if (!chain.includes('.')) return chain;
  const segs = chain.split('.');
  const out = [];
  let i = 0;
  while (i < segs.length) {
    const seg = segs[i];
    if (i + 2 < segs.length && segs[i + 1].length > 0) {
      let first = -1;
      let preferred = -1;
      for (let j = 0; j + 10 <= seg.length; j++) {
        if ((j === 0 || seg[j - 1] === '-' || seg[j - 1] === '_') && seg[j] === 'e' && (seg[j + 1] === 'y' || seg[j + 1] === 'w')) {
          if (first < 0) first = j;
          if (seg.startsWith('eyJ', j)) {
            preferred = j;
            break;
          }
        }
      }
      const start = preferred >= 0 ? preferred : first;
      if (start >= 0) {
        const token = [seg.slice(start), segs[i + 1], segs[i + 2]].join('.');
        if (redactJwt(token) !== token) {
          out.push(`${seg.slice(0, start)}<REDACTED>`);
          i += 3;
          continue;
        }
      }
    }
    out.push(seg);
    i++;
  }
  return out.join('.');
}

const ASSIGNMENT_KEY = /(\b|_)(secret|api[_-]?key)(\s*[:=]\s*)/gi;

function isQuoteStart(text, i) {
  return text[i] === '"' || text[i] === "'" || (text[i] === '$' && text[i + 1] === "'");
}

// Index just past the quoted fragment opening at `start`, or the end of the
// text when the quote is never closed.
function skipQuoted(text, start) {
  const ansi = text[start] === '$';
  const quote = ansi ? "'" : text[start];
  const escapes = ansi || quote === '"';
  let i = start + (ansi ? 2 : 1);
  while (i < text.length) {
    if (escapes && text[i] === '\\') i += 2;
    else if (text[i] === quote) return i + 1;
    else i++;
  }
  return text.length;
}

// End of the shell word starting at `start`. Bash joins adjacent fragments,
// so `'prefix-'suffix`, `a"b c"` and `first\ second` are each one value.
function wordEnd(text, start) {
  let i = start;
  while (i < text.length && !/\s/.test(text[i])) {
    if (isQuoteStart(text, i)) i = skipQuoted(text, i);
    else if (text[i] === '\\') i += 2;
    else i++;
  }
  return Math.min(i, text.length);
}

// End of a value that sits inside an enclosing quoted string, e.g.
// `-H "x-api-key: VALUE"`: the value runs to the enclosing closing quote.
function enclosedEnd(text, start, open) {
  const close = open === '"' ? '"' : "'";
  const escapes = open !== "'";
  if (text[start] === close) {
    // `grep "secret =" file` is a search, not an assignment. If a word
    // follows the quote instead, the quote state was misread; fall back to
    // redacting the whole word so nothing leaks.
    const next = text[start + 1];
    return next === undefined || /\s/.test(next) ? start : wordEnd(text, start);
  }
  let i = start;
  while (i < text.length && text[i] !== close) i += escapes && text[i] === '\\' ? 2 : 1;
  return Math.min(i, text.length);
}

// Redact secret=/api_key= values in one pass, tracking the enclosing quote.
function redactAssignments(text) {
  let out = '';
  let copied = 0;
  let scan = 0;
  let open = null; // '"', "'", "$'" or null
  ASSIGNMENT_KEY.lastIndex = 0;
  let match;
  while ((match = ASSIGNMENT_KEY.exec(text))) {
    const valueStart = match.index + match[0].length;
    while (scan < valueStart) {
      if (open === null) {
        if (isQuoteStart(text, scan)) {
          open = text[scan] === '$' ? "$'" : text[scan];
          scan += open.length;
        } else scan += text[scan] === '\\' ? 2 : 1;
      } else if (open !== "'" && text[scan] === '\\') scan += 2;
      else {
        if (text[scan] === (open === '"' ? '"' : "'")) open = null;
        scan++;
      }
    }
    const end = open === null ? wordEnd(text, valueStart) : enclosedEnd(text, valueStart, open);
    if (end > valueStart) {
      out += `${text.slice(copied, valueStart)}<REDACTED>`;
      copied = end;
      ASSIGNMENT_KEY.lastIndex = end;
    }
  }
  return out + text.slice(copied);
}

function sanitizeCommand(command) {
  const masked = String(command || '')
    .replace(/\n/g, ' ')
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, '<REDACTED>')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, '<REDACTED>')
    .replace(/[A-Za-z0-9_.-]+/g, redactJwtsInChain);
  return redactAssignments(masked)
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
