#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_SESSIONS = 1000;
const MAX_SESSION_BYTES = 4 * 1024 * 1024;
const MAX_AGGREGATE_BYTES = 64 * 1024 * 1024;
const MAX_RECORD_BYTES = 128 * 1024;
const MAX_MODELS = 128;
const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'];
const NOTE = 'Native nano-AI units, premium requests and tokens are accounting quantities, not prices. Missing values are unavailable.';

class ScanLimitError extends Error {}
class SessionEntryError extends Error {
  constructor(kind = 'invalid') {
    super('Native session data unavailable.');
    this.kind = kind;
  }
}

function validSessionId(value) {
  // Restrict names to portable directory components and spreadsheet-safe IDs.
  return typeof value === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/.test(value)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);
}

function configRoot(env) {
  const configured = env.COPILOT_HOME;
  if (configured !== undefined && !path.isAbsolute(configured)) throw new Error('COPILOT_HOME must be absolute.');
  return configured || path.join(os.homedir(), '.copilot');
}

function assertDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SessionEntryError();
}

function scanNames(root) {
  const names = [];
  const directory = fs.opendirSync(root);
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (names.length >= MAX_SESSIONS) throw new ScanLimitError();
      names.push(entry.name);
    }
  } finally {
    directory.closeSync();
  }
  return names.sort();
}

function readBounded(file, reserveBytes) {
  const expected = fs.lstatSync(file);
  if (!expected.isFile() || expected.isSymbolicLink() || expected.nlink !== 1 || expected.size > MAX_SESSION_BYTES) {
    throw new SessionEntryError();
  }

  // Count every candidate read, including invalid and foreign data. A file
  // changed during inspection cannot grow the buffer or evade the quota.
  reserveBytes(expected.size);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  const fd = fs.openSync(file, flags);
  try {
    const unchanged = stat => stat.isFile() && stat.nlink === 1
      && stat.dev === expected.dev && stat.ino === expected.ino && stat.size === expected.size
      && stat.mtimeMs === expected.mtimeMs && stat.ctimeMs === expected.ctimeMs;
    if (!unchanged(fs.fstatSync(fd))) throw new SessionEntryError();
    const buffer = Buffer.alloc(expected.size);
    let used = 0;
    while (used < buffer.length) {
      const count = fs.readSync(fd, buffer, used, buffer.length - used, null);
      if (count === 0) throw new SessionEntryError();
      used += count;
    }
    if (!unchanged(fs.fstatSync(fd)) || !unchanged(fs.lstatSync(file))) throw new SessionEntryError();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { throw new SessionEntryError(); }
  } finally {
    fs.closeSync(fd);
  }
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SessionEntryError();
  return value;
}

function parseEvent(line) {
  if (Buffer.byteLength(line) > MAX_RECORD_BYTES) throw new SessionEntryError();
  try { return object(JSON.parse(line)); }
  catch { throw new SessionEntryError(); }
}

function canonicalWorkspace(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new SessionEntryError();
  try {
    const canonical = fs.realpathSync(dir);
    if (!fs.statSync(canonical).isDirectory()) throw new SessionEntryError();
    return canonical;
  } catch {
    throw new SessionEntryError();
  }
}

function amount(value, integer = true) {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new SessionEntryError();
  }
  return value;
}

function readModelMetrics(value = {}) {
  const metrics = Object.entries(object(value));
  if (metrics.length > MAX_MODELS) throw new SessionEntryError();
  return Object.fromEntries(metrics.map(([model, entry]) => {
    if (!/^[A-Za-z0-9_][A-Za-z0-9._:/-]{0,99}$/.test(model)) throw new SessionEntryError();
    const data = object(entry);
    const usage = data.usage === undefined ? {} : object(data.usage);
    const requests = data.requests === undefined ? {} : object(data.requests);
    return [model, {
      usage: Object.fromEntries(TOKEN_FIELDS.map(key => [key, amount(usage[key])])),
      requests: { count: amount(requests.count) },
      totalNanoAiu: amount(data.totalNanoAiu),
    }];
  }));
}

function summarize(id, raw, workspace) {
  const workspaces = new Set();
  let started = false;
  let latest;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const event = parseEvent(line);
    if (event.type === 'session.start') {
      if (event.data?.sessionId !== id) throw new SessionEntryError();
      workspaces.add(canonicalWorkspace(event.data?.context?.cwd));
      started = true;
    } else if (event.type === 'session.context_changed') {
      workspaces.add(canonicalWorkspace(event.data?.cwd));
    } else if (event.type === 'session.shutdown' || event.type === 'session.usage_checkpoint') {
      latest = event;
    }
  }

  if (!started || workspaces.size !== 1) throw new SessionEntryError();
  if (!workspaces.has(workspace)) throw new SessionEntryError('foreign');

  const data = latest ? object(latest.data) : {};
  const totalNanoAiu = amount(data.totalNanoAiu);
  return {
    sessionId: id,
    totalNanoAiu,
    totalPremiumRequests: amount(data.totalPremiumRequests, false),
    complete: latest?.type === 'session.shutdown' && totalNanoAiu !== null,
    modelMetrics: readModelMetrics(data.modelMetrics),
  };
}

function parseArgs(args) {
  let session;
  let csv = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--session' && session === undefined && validSessionId(args[index + 1])) {
      session = args[++index];
    } else if (args[index] === '--csv' && !csv) {
      csv = true;
    } else {
      throw new Error('Usage: copilot-cost-report.cjs [--session <id>] [--csv]');
    }
  }
  return { session, csv };
}

function entryKind(error) {
  if (error instanceof SessionEntryError) return error.kind;
  if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return 'missing';
  if (['EACCES', 'EPERM', 'ELOOP', 'EBUSY', 'EIO'].includes(error.code)) return 'invalid';
  return null;
}

function collectUsage(session, workspace, env) {
  const skipped = { missing: 0, invalid: 0, foreign: 0 };
  const sessions = [];
  const root = path.join(configRoot(env), 'session-state');
  let remainingBytes = MAX_AGGREGATE_BYTES;
  const reserveBytes = bytes => {
    if (bytes > remainingBytes) throw new ScanLimitError();
    remainingBytes -= bytes;
  };

  let names;
  try {
    assertDirectory(root);
    names = session ? [session] : scanNames(root);
  } catch (error) {
    if (session || error.code !== 'ENOENT') throw error;
    names = [];
  }

  for (const id of names) {
    try {
      if (!validSessionId(id)) throw new SessionEntryError();
      const dir = path.join(root, id);
      assertDirectory(dir);
      const raw = readBounded(path.join(dir, 'events.jsonl'), reserveBytes);
      sessions.push(summarize(id, raw, workspace));
    } catch (error) {
      const kind = entryKind(error);
      if (session || !kind) throw error;
      skipped[kind]++;
    }
  }

  const known = sessions.filter(row => row.totalNanoAiu !== null);
  const totalNanoAiu = known.length ? known.reduce((sum, row) => sum + row.totalNanoAiu, 0) : null;
  if (totalNanoAiu !== null && !Number.isSafeInteger(totalNanoAiu)) throw new ScanLimitError();

  return {
    schema: 'ecc.copilot.usage.v1',
    totalNanoAiu,
    estimatedCostUsd: null,
    complete: sessions.length > 0 && sessions.every(row => row.complete) && !skipped.missing && !skipped.invalid,
    skipped,
    sessions,
    note: NOTE,
  };
}

function main() {
  const { session, csv } = parseArgs(process.argv.slice(2));
  const report = collectUsage(session, fs.realpathSync(process.cwd()), process.env);
  if (!csv) {
    process.stdout.write(JSON.stringify(report) + '\n');
    return;
  }

  const { missing, invalid, foreign } = report.skipped;
  if (!report.complete || foreign) {
    const coverage = report.complete ? 'complete' : 'incomplete';
    process.stderr.write(`Usage coverage: ${coverage}; skipped missing=${missing}, invalid=${invalid}, foreign=${foreign}.\n`);
  }
  const rows = report.sessions.map(row => [
    row.sessionId, row.totalNanoAiu ?? '', row.totalPremiumRequests ?? '', row.complete,
  ].join(','));
  process.stdout.write(['session_id,total_nano_aiu,total_premium_requests,complete', ...rows].join('\n') + '\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof ScanLimitError
    ? 'Usage unavailable: scan or exact numeric limit exceeded; select one native session.'
    : 'Usage unavailable: missing, malformed, foreign, oversized or unsafe native session data.';
  process.stdout.write(JSON.stringify({ error: message }) + '\n');
  process.exitCode = 1;
}
