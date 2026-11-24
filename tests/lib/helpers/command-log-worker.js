'use strict';
const fs = require('fs');
const path = require('path');
const [root, role] = process.argv.slice(2);
const file = path.join(root, '.claude', 'bash-commands.log');
if (['collision', 'release-collision', 'stale-collision'].includes(role)) {
  require('crypto').randomBytes = size => Buffer.alloc(size);
  const phase = { collision: 'create', 'release-collision': 'release', 'stale-collision': 'stale' }[role];
  fs.writeFileSync(`${file}.lock.${phase}-${process.pid}-${'00'.repeat(8)}`, `foreign-${phase}`, { flag: 'wx', mode: 0o600 });
}
const signal = name => fs.writeFileSync(path.join(root, name), '', { mode: 0o600 });
const rename = fs.renameSync;
let paused = false;
fs.renameSync = function (source, destination, ...args) {
  if (!paused && source === file && destination === `${file}.1` && ['owner', 'contender'].includes(role)) {
    paused = true;
    signal(`${role}-rotate-ready`);
    const sleep = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(path.join(root, `${role}-release`))) {
      if (Date.now() > deadline) throw new Error('Rotation release deadline exceeded');
      Atomics.wait(sleep, 0, 0, 10);
    }
  }
  if (role === 'replacement' && source === `${file}.lock` && destination.startsWith(`${file}.lock.release-`)) {
    rename.call(fs, source, `${file}.original-lock`);
    fs.writeFileSync(source, JSON.stringify({ pid: process.ppid }), { flag: 'wx', mode: 0o600 });
  }
  return rename.call(fs, source, destination, ...args);
};
const link = fs.linkSync;
fs.linkSync = function (source, destination, ...args) {
  try { return link.call(fs, source, destination, ...args); }
  catch (error) {
    if (destination === `${file}.lock` && error.code === 'EEXIST') signal(`${role}-contended`);
    throw error;
  }
};
process.env.HOME = root;
process.env.USERPROFILE = root;
process.env.CLAUDE_CONFIG_DIR = path.join(root, '.claude');
require('../../../scripts/hooks/post-bash-command-log').run(JSON.stringify({ tool_input: { command: `echo ${role}` } }), 'audit');
signal(`${role}-finished`);
