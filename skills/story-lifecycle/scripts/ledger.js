#!/usr/bin/env node
'use strict';
// Collision-safe, all-or-nothing writer for the .stories/ planning ledger.
// Usage: node ledger.js <init|allocate|apply|status|reconcile|recover> --root <repo> [options]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STORY_FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)-([1-9][0-9]*)\.md$/;
const EPIC_FILE = /^epics\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const SPRINT_FILE = /^sprints\/sprint-([1-9][0-9]*)\.md$/;
const STATUSES = ['todo', 'in-progress', 'review', 'done'];
const SPRINT_VALUE = /^(unassigned|[1-9][0-9]*)$/;
const POINTS = ['1', '2', '3', '5', '8'];
const BACKUP = /^backup-[0-9]+$/;
const DERIVED = '<!-- Derived from story files';

class LedgerError extends Error {
  constructor(message, code = 2) { super(message); this.exitCode = code; }
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
    else opts._.push(argv[i]);
  }
  return opts;
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function identity(stat) { return { dev: stat.dev, ino: stat.ino }; }

function sameFile(file, expected) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && stat.dev === expected.dev && stat.ino === expected.ino;
  } catch (err) { if (err.code === 'ENOENT') return false; throw err; }
}

// Bind writes to an exclusively created descriptor, never a checked path.
function writeNew(file, content, { keepOpen = false } = {}) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT |
    fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let retained = false;
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    const owner = identity(fs.fstatSync(fd));
    if (keepOpen) { owner.fd = fd; retained = true; }
    return owner;
  } finally { if (!retained) fs.closeSync(fd); }
}

function readSnapshot(file, encoding) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new LedgerError(`not a regular file: ${file}`);
    return { content: fs.readFileSync(fd, encoding), owner: identity(stat) };
  } finally { fs.closeSync(fd); }
}

function readRegular(file, encoding) { return readSnapshot(file, encoding).content; }

function removeOwned(file, owner) {
  if (sameFile(file, owner)) fs.unlinkSync(file);
}

// Probe the intended ledger volume, before creating directories, locks or journals.
// Hardlinks preserve exclusive publication and rollback inode ownership; copying
// is not an equivalent fallback. Status deliberately remains entirely read-only.
function requireHardlinks(dir) {
  let ancestor = dir;
  for (;;) {
    try {
      if (!fs.statSync(ancestor).isDirectory()) throw new LedgerError(`not a directory: ${ancestor}`);
      break;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw err;
      ancestor = parent;
    }
  }
  let probe, probeOwner, source, target, owner, fd;
  try {
    probe = fs.mkdtempSync(path.join(ancestor, '.hardlink-probe-'));
    probeOwner = identity(fs.lstatSync(probe));
    source = path.join(probe, 'source');
    target = path.join(probe, 'linked');
    fd = fs.openSync(source, fs.constants.O_WRONLY | fs.constants.O_CREAT |
      fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    owner = identity(fs.fstatSync(fd));
    fs.writeFileSync(fd, 'story-ledger hardlink capability probe');
    fs.linkSync(source, target);
    if (!sameFile(target, owner)) throw new LedgerError('hardlink probe did not preserve file identity');
  } catch (err) {
    throw new LedgerError(`hardlink-capable writable storage required at ${ancestor} (${err.code || err.message}); ` +
      'no ledger write or recovery attempted. If storage changed with a pending transaction, use reviewed manual recovery.');
  } finally {
    try {
      if (owner) { removeOwned(target, owner); removeOwned(source, owner); }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      // Never recursively delete a probe directory: unexpected files belong to
      // somebody else and must survive, even when cleanup cannot finish.
      if (probe && probeOwner) {
        const stat = fs.lstatSync(probe);
        if (stat.isDirectory() && stat.dev === probeOwner.dev && stat.ino === probeOwner.ino) fs.rmdirSync(probe);
      }
    }
  }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

// Confine a ledger-relative path to the allowed file shapes under .stories/; refuse symlinks.
function resolveLedgerPath(dir, rel) {
  const norm = String(rel).replace(/\\/g, '/');
  const valid = EPIC_FILE.test(norm) || SPRINT_FILE.test(norm) || STORY_FILE.test(norm);
  const abs = path.resolve(dir, norm);
  const back = path.relative(dir, abs);
  if (!valid || back.startsWith('..') || path.isAbsolute(back)) throw new LedgerError(`invalid ledger path: ${rel}`);
  let isLink = false;
  try { isLink = fs.lstatSync(abs).isSymbolicLink(); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  if (isLink) throw new LedgerError(`refusing symlinked ledger file: ${rel}`);
  return abs;
}

// A symlinked ledger directory would redirect reads or writes outside .stories/.
function assertNoSymlinkDirs(dir) {
  for (const p of [dir, ...['epics', 'sprints', '.txn', '.ids'].map((sub) => path.join(dir, sub))]) {
    let st;
    try { st = fs.lstatSync(p); } catch (err) { if (err.code === 'ENOENT') continue; throw err; }
    if (st.isSymbolicLink()) throw new LedgerError(`refusing symlinked ledger directory: ${p}`);
  }
}

// Allocation markers live in the git common dir so every worktree of a clone shares them.
function registryDir(root, dir) {
  try {
    const common = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const base = path.resolve(root, common);
    for (const sub of ['story-lifecycle', 'story-lifecycle/ids']) {
      const candidate = path.join(base, sub);
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        throw new LedgerError(`refusing symlinked allocation registry: ${candidate}`);
      }
    }
    return path.join(base, 'story-lifecycle', 'ids');
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    return path.join(dir, '.ids');
  }
}

function readLock(dir, { keepOpen = false } = {}) {
  let fd, retained = false;
  try {
    fd = fs.openSync(path.join(dir, '.lock'), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return null;
    const holder = { ...JSON.parse(fs.readFileSync(fd, 'utf8')), owner: identity(stat) };
    if (keepOpen) { holder.owner.fd = fd; retained = true; }
    return holder;
  } catch { return null; } finally { if (fd !== undefined && !retained) fs.closeSync(fd); }
}

function isStale(holder) { return holder.host === os.hostname() && !pidAlive(holder.pid); }

// Remove a stale lock only while holding .lock.break, after re-reading it, so a
// waiter that saw the old stale lock can never delete a newer live one.
// Returns false if another waiter (or a crashed one) holds .lock.break.
function breakStaleLock(dir) {
  const brk = path.join(dir, '.lock.break');
  let owner, holder;
  try {
    owner = writeNew(brk, String(process.pid), { keepOpen: true });
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
  try {
    holder = readLock(dir, { keepOpen: true });
    if (holder && isStale(holder)) removeOwned(path.join(dir, '.lock'), holder.owner);
    return true;
  } finally {
    try { removeOwned(brk, owner); } finally {
      fs.closeSync(owner.fd);
      if (holder?.owner.fd !== undefined) fs.closeSync(holder.owner.fd);
    }
  }
}

function acquireLock(dir, waitMs) {
  const lock = path.join(dir, '.lock');
  const deadline = Date.now() + waitMs;
  let accessError = null;
  for (;;) {
    try {
      // A live descriptor keeps this inode allocated, even if a foreign writer
      // replaces the pathname. dev/ino alone can alias after an early close.
      const owner = writeNew(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString() }), { keepOpen: true });
      return () => { try { removeOwned(lock, owner); } finally { fs.closeSync(owner.fd); } };
    } catch (err) {
      if (err.code === 'EEXIST') accessError = null;
      else if (process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) accessError = err.code;
      else throw err;
    }
    const holder = readLock(dir); // null: lock vanished or half-written; retry
    if (holder && isStale(holder) && breakStaleLock(dir)) continue;
    if (Date.now() > deadline) {
      const brk = fs.existsSync(path.join(dir, '.lock.break')) ? '; .lock.break is held (delete it only if no ledger command is running)' : '';
      const denied = accessError ? `; Windows file access ${accessError}; check active writers or directory permissions` : '';
      throw new LedgerError(`ledger locked by pid ${holder && holder.pid} since ${holder && holder.at}${brk}${denied}`, 3);
    }
    sleep(25 + Math.floor(Math.random() * 50));
  }
}

// Roll back an interrupted transaction: restore backups, delete created files.
function recover(dir) {
  const txn = path.join(dir, '.txn');
  const journalPath = path.join(txn, 'journal.json');
  let rolledBack = 0;
  if (fs.existsSync(journalPath)) {
    const { entries } = JSON.parse(readRegular(journalPath, 'utf8'));
    for (const entry of entries) {
      resolveLedgerPath(dir, entry.path);
      if (entry.backup && !(BACKUP.test(entry.backup) && fs.lstatSync(path.join(txn, entry.backup)).isFile())) {
        throw new LedgerError(`invalid journal backup: ${entry.backup}`);
      }
    }
    for (const entry of entries) {
      const target = resolveLedgerPath(dir, entry.path);
      if (entry.backup) {
        if (entry.original && !sameFile(target, entry.original) && !sameFile(target, entry.owner) &&
            !(entry.backupOwner && sameFile(target, entry.backupOwner))) {
          throw new LedgerError(`interrupted update changed ownership: ${entry.path}`);
        }
        // Fresh temp file, then rename: neither step writes through a planted symlink.
        const tmp = path.join(txn, 'restore.tmp');
        fs.rmSync(tmp, { force: true });
        // Preserve the backup inode so a crash during recovery is retryable.
        readRegular(path.join(txn, entry.backup)); // no-follow, regular-file validation
        fs.linkSync(path.join(txn, entry.backup), tmp);
        fs.renameSync(tmp, target);
      } else {
        // A failed exclusive publication may leave a competing owner's file.
        // Only delete the inode staged by this transaction, never that file.
        if (entry.owner) removeOwned(target, entry.owner);
        else if (fs.existsSync(target)) throw new LedgerError(`cannot prove interrupted create ownership: ${entry.path}`);
      }
      rolledBack++;
    }
    // Restoration is complete. Cleanup failure must never repeat a completed
    // rollback after another owner has changed a restored file.
    fs.rmSync(journalPath);
  }
  fs.rmSync(txn, { recursive: true, force: true });
  return rolledBack;
}

function field(md, name) {
  const m = md.match(new RegExp(`^\\*\\*${name}:\\*\\*[ \\t]*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

function parseStory(rel, md) {
  const [, epic, n] = rel.match(STORY_FILE);
  const id = `${epic}-${n}`;
  const story = {
    id, n: Number(n), epic, title: (md.match(/^# Story:[ \t]*(.+)$/m) || [])[1],
    status: field(md, 'Status'), sprint: field(md, 'Sprint'), points: field(md, 'Points'),
  };
  if (field(md, 'ID') !== id || field(md, 'Epic') !== epic) throw new LedgerError(`${rel}: ID/Epic fields must match file name`);
  if (!story.title || !STATUSES.includes(story.status)) throw new LedgerError(`${rel}: missing title or invalid status`);
  if (!SPRINT_VALUE.test(story.sprint || '')) throw new LedgerError(`${rel}: Sprint must be unassigned or a sprint number`);
  if (!POINTS.includes(story.points)) throw new LedgerError(`${rel}: Points must be one of ${POINTS.join(', ')}`);
  return story;
}

function replaceTable(md, rel, header, rows) {
  const i = md.indexOf(DERIVED);
  if (i < 0) throw new LedgerError(`${rel}: missing derived-table marker`);
  const newline = md.indexOf('\n', i);
  const afterMarker = newline < 0 ? md.length : newline + 1;
  const skipBlanks = (at) => at + (md.slice(at).match(/^(?:[ \t]*\r?\n)+/) || [''])[0].length;
  const hasDerivedHeader = (at) => md.slice(at).split(/\r?\n/, 2).join('\n').replace(/[ \t]/g, '') === header.replace(/[ \t]/g, '');
  const first = skipBlanks(afterMarker);
  const start = hasDerivedHeader(first) ? first : afterMarker;
  let end = start;
  while (hasDerivedHeader(end)) {
    while (md[end] === '|') {
      const nextLine = md.slice(end).split(/\r?\n/, 2)[1] || '';
      if (end !== start && /^\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(nextLine) && !hasDerivedHeader(end)) break;
      const nl = md.indexOf('\n', end); end = nl < 0 ? md.length : nl + 1;
    }
    // Older projections could insert a second table before a blank-separated
    // original. Only adjacent copies of this derived header belong to us.
    const next = skipBlanks(end);
    if (!hasDerivedHeader(next)) break;
    end = next;
  }
  const separator = start === end && md[start] === '|' ? '\n' : '';
  return md.slice(0, start) + (newline < 0 ? '\n' : '') + [header, ...rows].join('\n') + '\n' + separator + md.slice(end);
}

// Read the ledger with pending changes overlaid; return regenerated epic/sprint files that differ.
function project(dir, pending = {}) {
  const read = (rel) => (rel in pending ? pending[rel] : readRegular(resolveLedgerPath(dir, rel), 'utf8'));
  const list = (sub, re) => {
    const abs = path.join(dir, sub);
    const onDisk = fs.existsSync(abs) ? fs.readdirSync(abs).map((f) => (sub ? `${sub}/${f}` : f)) : [];
    return [...new Set([...onDisk, ...Object.keys(pending)])].filter((rel) => re.test(rel)).sort();
  };
  const stories = list('', STORY_FILE).map((rel) => parseStory(rel, read(rel)))
    .sort((a, b) => a.epic.localeCompare(b.epic) || a.n - b.n);
  const sprints = list('sprints', SPRINT_FILE);
  for (const s of stories) {
    if (s.sprint !== 'unassigned' && !sprints.includes(`sprints/sprint-${s.sprint}.md`)) {
      throw new LedgerError(`${s.id}.md: sprint ${s.sprint} does not exist`);
    }
  }
  const derived = {};
  const cell = (title) => title.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  for (const rel of list('epics', EPIC_FILE)) {
    const slug = rel.match(EPIC_FILE)[1];
    const rows = stories.filter((s) => s.epic === slug).map((s) => `| ${s.id} | ${cell(s.title)} | ${s.status} |`);
    const next = replaceTable(read(rel), rel, '| ID | Title | Status |\n| --- | --- | --- |', rows);
    if (next !== read(rel)) derived[rel] = next;
  }
  for (const rel of sprints) {
    const inSprint = stories.filter((s) => s.sprint === rel.match(SPRINT_FILE)[1]);
    const rows = inSprint.map((s) => `| ${s.id} | ${cell(s.title)} | ${s.points} | ${s.status} |`);
    const total = inSprint.reduce((sum, s) => sum + Number(s.points), 0);
    const next = replaceTable(read(rel), rel, '| ID | Title | Points | Status |\n| --- | --- | --- | --- |', rows)
      .replace(/^## Total Points:.*$/m, `## Total Points: ${total}`);
    if (next !== read(rel)) derived[rel] = next;
  }
  return { stories, derived };
}

function init(dir) {
  for (const sub of ['epics', 'sprints']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const ignore = path.join(dir, '.gitignore');
  try { writeNew(ignore, '.lock\n.lock.break\n.txn/\n.ids/\n'); } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    if (!fs.lstatSync(ignore).isFile()) throw new LedgerError('refusing non-regular ledger ignore file');
  }
  return { ok: true, dir };
}

function allocate(root, dir, epic, count) {
  if (!SLUG.test(epic || '') || epic.length > 64) throw new LedgerError(`invalid epic slug: ${epic}`);
  if (!fs.existsSync(path.join(dir, 'epics', `${epic}.md`))) throw new LedgerError(`unknown epic: ${epic}`);
  if (!(Number.isSafeInteger(count) && count >= 1 && count <= 50)) throw new LedgerError('--count must be 1..50');
  const reg = registryDir(root, dir);
  fs.mkdirSync(reg, { recursive: true });
  const taken = [...fs.readdirSync(dir), ...fs.readdirSync(reg).map((f) => `${f}.md`)]
    .map((f) => f.match(STORY_FILE)).filter((m) => m && m[1] === epic).map((m) => Number(m[2]));
  if (taken.some((n) => !Number.isSafeInteger(n))) {
    throw new LedgerError('existing story ID is not a safe integer');
  }
  let n = Math.max(0, ...taken);
  const ids = [];
  while (ids.length < count) {
    n += 1;
    if (!Number.isSafeInteger(n)) throw new LedgerError('story ID exceeds safe integer range');
    const id = `${epic}-${n}`;
    try {
      writeNew(path.join(reg, id), '');
      ids.push(id);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  return { ids };
}

function publishTransaction(dir, txn, all, create) {
  const entries = Object.keys(all).map((rel, i) => {
    const existed = fs.existsSync(resolveLedgerPath(dir, rel));
    if (rel in create && existed) throw new LedgerError(`refusing to overwrite existing ${rel}`, 4);
    const previous = existed ? readSnapshot(resolveLedgerPath(dir, rel)) : null;
    const backupOwner = previous ? writeNew(path.join(txn, `backup-${i}`), previous.content) : null;
    const owner = writeNew(path.join(txn, `new-${i}`), all[rel]);
    return { path: rel, backup: existed ? `backup-${i}` : null, staged: `new-${i}`,
      owner, original: previous ? previous.owner : null, backupOwner };
  });
  writeNew(path.join(txn, 'journal.tmp'), JSON.stringify({ entries }));
  fs.renameSync(path.join(txn, 'journal.tmp'), path.join(txn, 'journal.json'));
  const crashAfter = Number(process.env.STORY_LEDGER_CRASH_AFTER || -1);
  entries.forEach((entry, i) => {
    if (i === crashAfter) process.exit(70); // test-only fault injection
    const staged = path.join(txn, entry.staged);
    const target = resolveLedgerPath(dir, entry.path);
    if (entry.backup) {
      if (!sameFile(target, entry.original)) throw new LedgerError(`update changed ownership: ${entry.path}`, 4);
      fs.renameSync(staged, target);
    } else {
      // link publishes the staged inode exclusively; rename would clobber a
      // file created after validation by an independent owner.
      fs.linkSync(staged, target);
      fs.unlinkSync(staged);
    }
  });
  fs.rmSync(path.join(txn, 'journal.json')); // commit point
  fs.rmSync(txn, { recursive: true, force: true });
  return { ok: true, written: entries.map((e) => e.path) };
}

// changes: { create: { rel: content }, update: { rel: content } }
function apply(root, dir, changes) {
  const keys = new Set();
  const normalize = (obj = {}) => Object.fromEntries(Object.entries(obj).map(([rel, content]) => {
    const key = rel.replace(/\\/g, '/');
    if (keys.has(key)) throw new LedgerError(`duplicate path in batch: ${key}`);
    keys.add(key);
    return [key, content];
  }));
  const create = normalize(changes.create);
  const update = normalize(changes.update);
  const reg = registryDir(root, dir);
  for (const rel of Object.keys(create)) {
    if (fs.existsSync(resolveLedgerPath(dir, rel))) throw new LedgerError(`refusing to overwrite existing ${rel}`, 4);
    const m = rel.match(STORY_FILE);
    if (m && !fs.existsSync(path.join(reg, `${m[1]}-${m[2]}`))) throw new LedgerError(`${rel}: story ID was not allocated`);
    if (m && parseStory(rel, create[rel]).status !== 'todo') throw new LedgerError(`${rel}: new stories start as todo`);
  }
  for (const rel of Object.keys(update)) {
    const abs = resolveLedgerPath(dir, rel);
    if (!fs.existsSync(abs)) throw new LedgerError(`cannot update missing ${rel}`);
    if (!STORY_FILE.test(rel)) continue;
    const from = parseStory(rel, readRegular(abs, 'utf8')).status;
    const to = parseStory(rel, update[rel]).status;
    if (to !== from && STATUSES.indexOf(to) !== STATUSES.indexOf(from) + 1) {
      throw new LedgerError(`${rel}: status ${from} -> ${to} is not allowed; status moves forward one step at a time`);
    }
  }
  const pending = { ...create, ...update };
  const all = { ...pending, ...project(dir, pending).derived };
  return withTransaction(dir, txn => publishTransaction(dir, txn, all, create));
}

function describeError(error) { return `${error.code ? `${error.code}: ` : ''}${error.message}`; }

function withOwnerLock(dir, waitMs, operation) {
  const release = acquireLock(dir, waitMs);
  let result, primaryError;
  try { result = operation(); } catch (error) { primaryError = error; }
  try { release(); } catch (releaseError) {
    if (!primaryError) throw releaseError;
    throw new LedgerError(`${describeError(primaryError)}; lock release failed: ${describeError(releaseError)}`, primaryError.exitCode || 1);
  }
  if (primaryError) throw primaryError;
  return result;
}

function withTransaction(dir, operation) {
  const txn = path.join(dir, '.txn');
  fs.mkdirSync(txn, { mode: 0o700 });
  try {
    return operation(txn);
  } catch (error) {
    // Caller retains the live owner lock throughout restoration. A removed
    // journal marks a committed batch, so recover then only cleans debris.
    try { recover(dir); } catch (recoveryError) {
      const state = fs.existsSync(path.join(dir, '.txn', 'journal.json')) ? 'recovery pending' : 'transaction cleanup pending';
      throw new LedgerError(`${describeError(error)}; ${state}: ${describeError(recoveryError)}; ` +
        'resolve the cause, then run recover to retry without overwriting foreign-owned files.', error.exitCode || 1);
    }
    throw error;
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];
  const root = path.resolve(opts.root || '.');
  const dir = path.join(root, '.stories');
  assertNoSymlinkDirs(dir);
  if (cmd === 'init') { requireHardlinks(dir); return init(dir); }
  if (!fs.existsSync(path.join(dir, 'epics'))) throw new LedgerError('no .stories/ ledger; run `init` first');
  if (cmd === 'status') {
    const holder = readLock(dir);
    const transactionPending = fs.existsSync(path.join(dir, '.txn'));
    const recoveryPending = transactionPending && (!holder || isStale(holder));
    if (transactionPending) return { stories: [], drift: [], recoveryPending, projectionAvailable: false,
      recoveryAdvice: 'Recovery requires unchanged hardlink-capable storage; storage changes require reviewed manual recovery.' };
    const { stories, derived } = project(dir);
    return { stories, drift: Object.keys(derived), recoveryPending };
  }
  const waitMs = Number(opts['wait-ms'] ?? 5000);
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 60000) {
    throw new LedgerError('--wait-ms must be an integer in 0..60000');
  }
  requireHardlinks(dir);
  return withOwnerLock(dir, waitMs, () => {
    const rolledBack = recover(dir);
    if (cmd === 'recover') return { ok: true, rolledBack };
    if (cmd === 'allocate') return allocate(root, dir, opts.epic, Number(opts.count || 1));
    if (cmd === 'reconcile') return apply(root, dir, {});
    if (cmd === 'apply') return apply(root, dir, JSON.parse(fs.readFileSync(opts.input, 'utf8')));
    throw new LedgerError(`unknown command: ${cmd}`);
  });
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`[story-ledger] ${err.message}\n`);
    process.exit(err.exitCode || 1);
  }
}

module.exports = { resolveLedgerPath, project };
