#!/usr/bin/env node
/**
 * Offline load test for the pi/core profile.
 *
 * Requires the Pi coding agent CLI on PATH (`pi`). Spawns:
 *
 *   PI_OFFLINE=1 pi --offline --mode rpc --no-session --no-context-files \
 *     --no-extensions --skill pi/core/skills --prompt-template pi/core/commands
 *
 * and asserts:
 *   1. the process exits 0 (the profile loads cleanly, fully offline);
 *   2. the RPC `get_commands` response succeeds and reports exactly the
 *      commands listed in manifests/pi-core.json (proof the prompt tree was
 *      actually parsed, not just accepted as a path).
 *
 * Flag note: the natural `--extension pi/core` only loads a package's
 * `pi.extensions` entries; pi/core is a skills+prompts-only package, so the
 * equivalent resource flags `--skill` and `--prompt-template` are used.
 *
 * Usage: node scripts/ci/pi-core-load-test.js
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const PROFILE = path.join(ROOT, 'pi', 'core');
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'manifests', 'pi-core.json'), 'utf8')
);

const expected = manifest.commands.include
  .map(f => f.replace(/\.md$/, ''))
  .sort();

const child = spawn(
  'pi',
  [
    '--offline',
    '--mode', 'rpc',
    '--no-session',
    '--no-context-files',
    '--no-extensions',
    '--skill', path.join(PROFILE, 'skills'),
    '--prompt-template', path.join(PROFILE, 'commands'),
  ],
  { env: { ...process.env, PI_OFFLINE: '1' } }
);

let buffer = '';
let response = null;
let stderr = '';
const watchdog = setTimeout(() => {
  console.error('timed out waiting for pi RPC response');
  child.kill('SIGKILL');
  process.exit(1);
}, 120000);

child.stderr.on('data', d => { stderr += d; });
child.stdout.on('data', d => {
  buffer += d;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    try {
      const msg = JSON.parse(line);
      if (msg.id === '1' && msg.type === 'response' && msg.command === 'get_commands') {
        response = msg;
        child.stdin.end();
      }
    } catch { /* ignore non-JSON chatter */ }
  }
});
child.on('error', err => {
  clearTimeout(watchdog);
  console.error('failed to spawn pi:', err.message);
  process.exit(1);
});

child.stdin.write('{"id":"1","type":"get_commands"}\n');

child.on('close', status => {
  clearTimeout(watchdog);
  if (status !== 0) {
    console.error(`pi exited ${status}`);
    if (stderr) console.error(stderr);
    process.exit(1);
  }
  if (!response || response.success !== true) {
    console.error('get_commands RPC did not succeed');
    process.exit(1);
  }
  const loaded = (response.data.commands || [])
    .filter(c => c.source === 'prompt')
    .map(c => c.name)
    .sort();
  const missing = expected.filter(c => !loaded.includes(c));
  const extra = loaded.filter(c => !expected.includes(c));
  if (missing.length || extra.length) {
    console.error('pi/core command load mismatch');
    if (missing.length) console.error('  missing: ' + missing.join(', '));
    if (extra.length) console.error('  unexpected: ' + extra.join(', '));
    process.exit(1);
  }
  console.log(`pi offline load OK: ${loaded.length}/${expected.length} commands loaded from pi/core`);
});
