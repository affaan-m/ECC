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

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

// Confine a ledger-relative path to the allowed file shapes under .stories/.
function resolveLedgerPath(dir, rel) {
  const norm = String(rel).replace(/\\/g, '/');
  const valid = EPIC_FILE.test(norm) || SPRINT_FILE.test(norm) || STORY_FILE.test(norm);
  const abs = path.resolve(dir, norm);
  const back = path.relative(dir, abs);
  if (!valid || back.startsWith('..') || path.isAbsolute(back)) throw new LedgerError(`invalid ledger path: ${rel}`);
  return abs;
}

// Allocation markers live in the git common dir so every worktree of a clone shares them.
function registryDir(root, dir) {
  try {
    const common = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return path.join(path.resolve(root, common), 'story-lifecycle', 'ids');
  } catch {
    return path.join(dir, '.ids');
  }
}

function readLock(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, '.lock'), 'utf8')); } catch { return null; }
}

function isStale(holder) { return holder.host === os.hostname() && !pidAlive(holder.pid); }

function acquireLock(dir, waitMs) {
  const lock = path.join(dir, '.lock');
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString() }), { flag: 'wx' });
      return () => fs.rmSync(lock, { force: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    const holder = readLock(dir); // null: lock vanished or half-written; retry
    // ponytail: read-then-unlink of a stale lock has a tiny TOCTOU window; only matters if two recoverers race after a crash.
    if (holder && isStale(holder)) {
      fs.rmSync(lock, { force: true });
      continue;
    }
    if (Date.now() > deadline) {
      throw new LedgerError(`ledger locked by pid ${holder && holder.pid} since ${holder && holder.at}`, 3);
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
    for (const entry of JSON.parse(fs.readFileSync(journalPath, 'utf8')).entries) {
      const target = resolveLedgerPath(dir, entry.path);
      if (entry.backup) fs.copyFileSync(path.join(txn, entry.backup), target);
      else fs.rmSync(target, { force: true });
      rolledBack++;
    }
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
  return story;
}

function replaceTable(md, rel, header, rows) {
  const i = md.indexOf(DERIVED);
  if (i < 0) throw new LedgerError(`${rel}: missing derived-table marker`);
  const start = md.indexOf('\n', i) + 1;
  let end = start;
  while (md[end] === '|') { const nl = md.indexOf('\n', end); end = nl < 0 ? md.length : nl + 1; }
  return md.slice(0, start) + [header, ...rows].join('\n') + '\n' + md.slice(end);
}

// Read the ledger with pending changes overlaid; return regenerated epic/sprint files that differ.
function project(dir, pending = {}) {
  const read = (rel) => (rel in pending ? pending[rel] : fs.readFileSync(path.join(dir, rel), 'utf8'));
  const list = (sub, re) => {
    const abs = path.join(dir, sub);
    const onDisk = fs.existsSync(abs) ? fs.readdirSync(abs).map((f) => (sub ? `${sub}/${f}` : f)) : [];
    return [...new Set([...onDisk, ...Object.keys(pending)])].filter((rel) => re.test(rel)).sort();
  };
  const stories = list('', STORY_FILE).map((rel) => parseStory(rel, read(rel)))
    .sort((a, b) => a.epic.localeCompare(b.epic) || a.n - b.n);
  const derived = {};
  for (const rel of list('epics', EPIC_FILE)) {
    const slug = rel.match(EPIC_FILE)[1];
    const rows = stories.filter((s) => s.epic === slug).map((s) => `| ${s.id} | ${s.title} | ${s.status} |`);
    const next = replaceTable(read(rel), rel, '| ID | Title | Status |\n| --- | --- | --- |', rows);
    if (next !== read(rel)) derived[rel] = next;
  }
  for (const rel of list('sprints', SPRINT_FILE)) {
    const inSprint = stories.filter((s) => s.sprint === rel.match(SPRINT_FILE)[1]);
    const rows = inSprint.map((s) => `| ${s.id} | ${s.title} | ${s.points} | ${s.status} |`);
    const total = inSprint.reduce((sum, s) => sum + (Number(s.points) || 0), 0);
    const next = replaceTable(read(rel), rel, '| ID | Title | Points | Status |\n| --- | --- | --- | --- |', rows)
      .replace(/^## Total Points:.*$/m, `## Total Points: ${total}`);
    if (next !== read(rel)) derived[rel] = next;
  }
  return { stories, derived };
}

function init(dir) {
  for (const sub of ['epics', 'sprints']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const ignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '.lock\n.txn/\n.ids/\n');
  return { ok: true, dir };
}

function allocate(root, dir, epic, count) {
  if (!SLUG.test(epic || '') || epic.length > 64) throw new LedgerError(`invalid epic slug: ${epic}`);
  if (!fs.existsSync(path.join(dir, 'epics', `${epic}.md`))) throw new LedgerError(`unknown epic: ${epic}`);
  if (!(count >= 1 && count <= 50)) throw new LedgerError('--count must be 1..50');
  const reg = registryDir(root, dir);
  fs.mkdirSync(reg, { recursive: true });
  const taken = [...fs.readdirSync(dir), ...fs.readdirSync(reg).map((f) => `${f}.md`)]
    .map((f) => f.match(STORY_FILE)).filter((m) => m && m[1] === epic).map((m) => Number(m[2]));
  let n = Math.max(0, ...taken);
  const ids = [];
  while (ids.length < count) {
    const id = `${epic}-${++n}`;
    try {
      fs.writeFileSync(path.join(reg, id), '', { flag: 'wx' });
      ids.push(id);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  return { ids };
}

// changes: { create: { rel: content }, update: { rel: content } }
function apply(root, dir, changes) {
  const create = changes.create || {};
  const update = changes.update || {};
  const reg = registryDir(root, dir);
  for (const rel of Object.keys(create)) {
    if (fs.existsSync(resolveLedgerPath(dir, rel))) throw new LedgerError(`refusing to overwrite existing ${rel}`, 4);
    const m = rel.match(STORY_FILE);
    if (m && !fs.existsSync(path.join(reg, `${m[1]}-${m[2]}`))) throw new LedgerError(`${rel}: story ID was not allocated`);
  }
  for (const rel of Object.keys(update)) {
    if (!fs.existsSync(resolveLedgerPath(dir, rel))) throw new LedgerError(`cannot update missing ${rel}`);
  }
  const pending = { ...create, ...update };
  const all = { ...pending, ...project(dir, pending).derived };
  const txn = path.join(dir, '.txn');
  fs.mkdirSync(txn);
  const entries = Object.keys(all).map((rel, i) => {
    const existed = fs.existsSync(resolveLedgerPath(dir, rel));
    if (existed) fs.copyFileSync(resolveLedgerPath(dir, rel), path.join(txn, `backup-${i}`));
    fs.writeFileSync(path.join(txn, `new-${i}`), all[rel]);
    return { path: rel, backup: existed ? `backup-${i}` : null, staged: `new-${i}` };
  });
  fs.writeFileSync(path.join(txn, 'journal.tmp'), JSON.stringify({ entries }));
  fs.renameSync(path.join(txn, 'journal.tmp'), path.join(txn, 'journal.json'));
  const crashAfter = Number(process.env.STORY_LEDGER_CRASH_AFTER || -1);
  entries.forEach((entry, i) => {
    if (i === crashAfter) process.exit(70); // test-only fault injection
    fs.renameSync(path.join(txn, entry.staged), resolveLedgerPath(dir, entry.path));
  });
  fs.rmSync(path.join(txn, 'journal.json')); // commit point
  fs.rmSync(txn, { recursive: true, force: true });
  return { ok: true, written: entries.map((e) => e.path) };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];
  const root = path.resolve(opts.root || '.');
  const dir = path.join(root, '.stories');
  if (cmd === 'init') return init(dir);
  if (!fs.existsSync(path.join(dir, 'epics'))) throw new LedgerError('no .stories/ ledger; run `init` first');
  if (cmd === 'status') {
    const { stories, derived } = project(dir);
    const holder = readLock(dir);
    const recoveryPending = fs.existsSync(path.join(dir, '.txn')) && (!holder || isStale(holder));
    return { stories, drift: Object.keys(derived), recoveryPending };
  }
  const release = acquireLock(dir, Number(opts['wait-ms'] || 5000));
  try {
    const rolledBack = recover(dir);
    if (cmd === 'recover') return { ok: true, rolledBack };
    if (cmd === 'allocate') return allocate(root, dir, opts.epic, Number(opts.count || 1));
    if (cmd === 'reconcile') return apply(root, dir, {});
    if (cmd === 'apply') return apply(root, dir, JSON.parse(fs.readFileSync(opts.input, 'utf8')));
    throw new LedgerError(`unknown command: ${cmd}`);
  } finally {
    release();
  }
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
