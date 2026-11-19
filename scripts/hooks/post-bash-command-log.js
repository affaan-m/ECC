#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
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
function isJwtHeader(header) {
  if (header.startsWith('eyJ')) return true;
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    return Boolean(decoded && typeof decoded === 'object' && typeof decoded.alg === 'string');
  } catch {
    // Not a JWT header; keep the text.
    return false;
  }
}

// Constant-time prefilter: the second decoded byte of a JSON object header is
// whitespace or `"`. Rejects word prefixes such as `eyewear` without decoding
// the whole segment.
function mayBeJwtHeader(seg, j) {
  const bytes = Buffer.from(seg.slice(j, j + 4), 'base64url');
  return bytes.length >= 2 && (bytes[1] === 0x22 || bytes[1] === 0x20 || bytes[1] === 0x09 || bytes[1] === 0x0a || bytes[1] === 0x0d);
}

// Full header decodes allowed per segment; keeps adversarial `eyAg-eyAg-...`
// runs linear while still trying every realistic candidate.
const MAX_HEADER_DECODES = 8;

// Index of the first JWT header in `seg`, starting at its beginning or after a
// `-` or `_`, or -1. A candidate that fails validation (e.g. `eyewear` in
// `eyewear_session_<JWT>`) does not stop the scan. Once the decode budget is
// spent, the next candidate that passes the prefilter is treated as a header
// (fail closed), so padding a JWT with decoy candidates cannot hide it.
function findJwtHeader(seg) {
  let decodes = 0;
  for (let j = 0; j + 10 <= seg.length; j++) {
    if (!((j === 0 || seg[j - 1] === '-' || seg[j - 1] === '_') && seg[j] === 'e' && (seg[j + 1] === 'y' || seg[j + 1] === 'w'))) continue;
    if (seg.startsWith('eyJ', j)) return j;
    if (!mayBeJwtHeader(seg, j)) continue;
    if (decodes >= MAX_HEADER_DECODES) return j;
    decodes++;
    if (isJwtHeader(seg.slice(j))) return j;
  }
  return -1;
}

// Redact JWTs inside one run of `[A-Za-z0-9_.-]` characters. A JWT may follow
// a word prefix joined by `-` or `_` (`session=jwt-<JWT>`, `session_<JWT>`), so
// each dot-separated segment is checked for a header starting at its beginning
// or after a `-` or `_`.
// Every segment is scanned once with a bounded number of decodes, keeping long
// `ey-ey-...` runs linear (a `\b`-anchored regex retries at each `-`).
function redactJwtsInChain(chain) {
  if (!chain.includes('.')) return chain;
  const segs = chain.split('.');
  const out = [];
  let i = 0;
  while (i < segs.length) {
    const seg = segs[i];
    if (i + 2 < segs.length && segs[i + 1].length > 0) {
      const start = findJwtHeader(seg);
      if (start >= 0) {
        out.push(`${seg.slice(0, start)}<REDACTED>`);
        i += 3;
        continue;
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

// The logs hold every Bash command, so they are owner-only and size-capped:
// past LOG_MAX_BYTES the log moves to `<log>.1` (replacing the previous one)
// and a fresh log starts. Same scheme as scripts/lib/gateguard-metrics.js,
// inlined because hooks cannot require scripts/lib/ (see #3259).
const LOG_MAX_BYTES = 10 * 1024 * 1024;
const LOG_FILE_MODE = 0o600;

// Keep this hook standalone: managed copies may omit scripts/lib. Lock
// publication and release use descriptor identities, as the installer does.
const LOG_LOCK_WAIT_MS = 500;
function sameLogLock(left, right) {
  return left.ino === right.ino && (left.dev === right.dev
    || (process.platform === 'win32' && (!left.dev || !right.dev)));
}

function restoreLogLock(quarantine, lockPath) {
  // Exclusive publication never overwrites a replacement owner's lock. Keep
  // the displaced file for inspection if another owner already holds the path.
  fs.linkSync(quarantine, lockPath);
  fs.unlinkSync(quarantine);
}

function reserveLogQuarantine(lockPath, phase) {
  const quarantine = `${lockPath}.${phase}-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  // Reserve exclusively before rename, which otherwise overwrites a colliding
  // foreign file. A failed reservation must never enter path cleanup.
  const descriptor = fs.openSync(quarantine, 'wx', LOG_FILE_MODE);
  fs.closeSync(descriptor);
  return quarantine;
}

function publishLogLock(lockPath) {
  const temporary = `${lockPath}.create-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  let descriptor = fs.openSync(temporary, 'wx', LOG_FILE_MODE);
  let identity;
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid }));
    fs.fsyncSync(descriptor);
    identity = fs.fstatSync(descriptor, { bigint: true });
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temporary, lockPath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
  return () => {
    const quarantine = reserveLogQuarantine(lockPath, 'release');
    fs.renameSync(lockPath, quarantine);
    if (!sameLogLock(fs.lstatSync(quarantine, { bigint: true }), identity)) {
      restoreLogLock(quarantine, lockPath);
      throw new Error('Command log lock changed owner before release');
    }
    fs.unlinkSync(quarantine);
  };
}

function inspectLogLock(lockPath) {
  const descriptor = fs.openSync(lockPath, fs.constants.O_RDONLY
    | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const identity = fs.fstatSync(descriptor, { bigint: true });
    const named = fs.lstatSync(lockPath, { bigint: true });
    if (!identity.isFile() || named.isSymbolicLink() || !sameLogLock(identity, named)
      || identity.size > 4096n) return null;
    const bytes = Buffer.alloc(4097);
    const count = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    if (count > 4096) return null;
    const owner = JSON.parse(bytes.subarray(0, count).toString('utf8'));
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return null;
    try { process.kill(owner.pid, 0); return null; }
    catch (error) { return error.code === 'ESRCH' ? identity : null; }
  } finally { fs.closeSync(descriptor); }
}

function recoverLogLock(lockPath) {
  let releaseGuard;
  try { releaseGuard = publishLogLock(`${lockPath}.recover`); }
  catch { return null; }
  // The recovery guard is not recursively reclaimed. A crash here may leave
  // it behind, so later calls preserve events through append-only fallback.
  try {
    const identity = inspectLogLock(lockPath);
    if (!identity) return null; // Never take a live or unverifiable owner's lock.
    const quarantine = reserveLogQuarantine(lockPath, 'stale');
    fs.renameSync(lockPath, quarantine);
    if (!sameLogLock(fs.lstatSync(quarantine, { bigint: true }), identity)) {
      restoreLogLock(quarantine, lockPath);
      return null;
    }
    fs.unlinkSync(quarantine);
    return publishLogLock(lockPath);
  } finally { releaseGuard(); }
}

function acquireLogLock(filePath) {
  const lockPath = `${filePath}.lock`;
  const deadline = performance.now() + LOG_LOCK_WAIT_MS;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    try { return publishLogLock(lockPath); }
    catch (error) { if (error.code !== 'EEXIST') return null; }
    try {
      const release = recoverLogLock(lockPath);
      if (release) return release;
    } catch { /* A writer can finish while recovery inspects the path. */ }
    const remaining = deadline - performance.now();
    if (remaining <= 0) return null;
    Atomics.wait(sleeper, 0, 0, Math.min(10, remaining));
  }
}

function appendOnly(filePath, data) {
  const descriptor = fs.openSync(filePath, 'a', LOG_FILE_MODE);
  try {
    if (process.platform !== 'win32') fs.fchmodSync(descriptor, LOG_FILE_MODE);
    fs.writeSync(descriptor, data);
  } finally { fs.closeSync(descriptor); }
}

function appendLine(filePath, line) {
  const data = `${line}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const release = acquireLogLock(filePath);
  if (!release) {
    // Preserve the command after a bounded wait or unsupported lock operation.
    // Only the lock owner rotates; size enforcement resumes when the lock
    // becomes available. An orphan recovery guard can defer this indefinitely.
    appendOnly(filePath, data);
    return;
  }
  try {
    let stat = null;
    try {
      stat = fs.statSync(filePath);
    } catch {
      // No log yet.
    }
    // Logs written by earlier versions were group/world readable. Tighten an
    // existing log before it can be rotated, so the `.1` copy is private too.
    // Windows has no POSIX permission bits to tighten.
    if (stat && stat.isFile() && process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      fs.chmodSync(filePath, LOG_FILE_MODE);
    }
    if (stat && stat.isFile() && stat.size > 0 && stat.size + Buffer.byteLength(data) > LOG_MAX_BYTES) {
      try {
        fs.renameSync(filePath, `${filePath}.1`);
      } catch {
        // Rotation is best effort (another process may have rotated first, or
        // Windows may refuse the rename); still record this command.
      }
    }
    appendOnly(filePath, data);
  } finally {
    try { release(); } catch { /* Preserve the write result and foreign locks. */ }
  }
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
  LOG_MAX_BYTES,
  run,
  sanitizeCommand,
};
