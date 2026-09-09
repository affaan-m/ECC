#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  appendEvent, clearResource, readRun, resolveRunDirectory, writeResource,
} = require('./session-store');
const { sanitizeEnvironment } = require('./backends/srt');
const { processGroupMembers, processIdentity } = require('./stream-exec');

function parseArgs(args) {
  const boundary = args.indexOf('--');
  if (args.length < 4 || boundary !== 3 || boundary === args.length - 1) {
    throw new Error('interactive-exec requires RUN_ID STATE_ROOT PHASE -- EXECUTABLE [ARGS]');
  }
  return {
    runId: args[0], root: args[1], phase: args[2],
    executable: args[4], argv: args.slice(5),
  };
}

function readableTranscript(value) {
  return String(value || '')
    // Terminal escape sequences require matching control bytes explicitly.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    // ANSI control sequence introducers also contain an explicit escape byte.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '\n')
    // Preserve horizontal tabs and newlines while removing other control bytes.
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0a\x20-\x7e]/g, '');
}

function filteredInteractiveEnvironment(source = process.env) {
  return sanitizeEnvironment(source);
}

function recordInteractive(options, dependencies = {}) {
  if ((dependencies.platform || process.platform) !== 'darwin') {
    throw new Error('live interactive exploration capture currently requires macOS BSD script');
  }
  const current = readRun(options.runId, options.root);
  const expectedDirectory = resolveRunDirectory(options.runId, options.root);
  if (current.run_directory !== expectedDirectory) throw new Error('exploration run directory changed');
  const fifoPath = path.join(current.run_directory, 'exploration.fifo');
  const run = dependencies.run || spawnSync;
  const made = run('/usr/bin/mkfifo', [fifoPath], { encoding: 'utf8', shell: false });
  if (made.error || made.status !== 0) throw new Error('could not create the private exploration transcript pipe');
  fs.chmodSync(fifoPath, 0o600);
  const reader = fs.createReadStream(fifoPath, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW });
  let transcriptBuffer = '';
  const publish = text => {
    if (!text) return;
    appendEvent(options.runId, options.root, {
      type: 'exploration.output', phase: options.phase, stream: 'pty', text,
    }, {
      now: Date.now(),
      monotonicMs: Math.max(0, Date.now() - current.session.created_ms),
    });
  };
  reader.on('data', chunk => {
    transcriptBuffer += readableTranscript(chunk.toString('utf8'));
    while (transcriptBuffer.length > 0) {
      const newline = transcriptBuffer.indexOf('\n');
      if (newline >= 0) {
        publish(transcriptBuffer.slice(0, newline + 1));
        transcriptBuffer = transcriptBuffer.slice(newline + 1);
      } else if (Buffer.byteLength(transcriptBuffer, 'utf8') > 32 * 1024) {
        publish(transcriptBuffer.slice(0, 16 * 1024));
        transcriptBuffer = transcriptBuffer.slice(16 * 1024);
      } else break;
    }
  });
  const spawnImpl = dependencies.spawn || spawn;
  const child = spawnImpl('/usr/bin/script', [
    '-q', '-F', '-t', '0', fifoPath, options.executable, ...options.argv,
  ], {
    cwd: current.session.workspace_path,
    env: filteredInteractiveEnvironment(),
    detached: true,
    shell: false,
    stdio: 'inherit',
  });
  let forceTimer = null;
  const terminate = signal => {
    try { process.kill(-child.pid, signal); } catch { /* child already exited */ }
    if (!forceTimer && signal !== 'SIGKILL') {
      forceTimer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* child already exited */ }
      }, 2_000);
      forceTimer.unref?.();
    }
  };
  const handlers = new Map([
    ['SIGTERM', () => terminate('SIGTERM')],
    ['SIGINT', () => terminate('SIGINT')],
    ['SIGHUP', () => terminate('SIGHUP')],
  ]);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  child.once('spawn', () => {
    try {
      const identity = (dependencies.processIdentity || processIdentity)(child.pid);
      if (!identity) throw new Error('could not establish interactive process birth identity');
      writeResource(options.runId, options.root, {
        kind: 'process', name: String(child.pid), pid: child.pid, pgid: child.pid,
        started: identity.started, command: identity.command,
        owner_token: current.session.owner_token,
      });
    } catch (error) {
      process.stderr.write(`process receipt failed; terminating exploration: ${error.message}\n`);
      terminate('SIGKILL');
    }
  });
  child.once('error', error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 127;
  });
  child.once('close', code => {
    if (forceTimer) clearTimeout(forceTimer);
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    publish(transcriptBuffer);
    reader.destroy();
    fs.rmSync(fifoPath, { force: true });
    try {
      const members = (dependencies.processGroupMembers || processGroupMembers)(child.pid);
      if (Array.isArray(members) && members.length === 0) {
        clearResource(options.runId, options.root, current.session.owner_token, {
          kind: 'process', pid: child.pid,
        });
      }
    } catch { /* guardian may already have cleared it */ }
    process.exitCode = Number.isInteger(code) ? code : 1;
  });
}

if (require.main === module) {
  try {
    recordInteractive(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  filteredInteractiveEnvironment,
  parseArgs,
  readableTranscript,
  recordInteractive,
};
