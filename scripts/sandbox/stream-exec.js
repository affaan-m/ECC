#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { StringDecoder } = require('string_decoder');
const {
  appendEvent, clearResource, consumeControl, listControls, readResources, readRun,
  redactText, updateState, writeControlResponse, writeResource,
} = require('./session-store');

const CLASSIFICATION_SIGNAL_PATTERN = /(?:operation not permitted|permission denied|access is denied|unauthorizedaccessexception|read-only file system|\bEPERM\b|\bEACCES\b|blocked by network allowlist|sandbox(?:ed)?[^\n]{0,256}(?:deny|denied|violation)|system has not been booted with systemd as init system|system has not been booted with systemd|failed to connect to bus|running in chroot|systemd is not running|reg(?:\.exe)?: (?:command not found|not found)|'reg(?:\.exe)?' is not recognized|registry editing has been disabled|unable to find the specified registry|cannot open display|failed to (?:connect to|open) (?:the )?display|no display (?:name|server)|DISPLAY (?:is )?not set|no method available for opening|headless (?:environment|session))/i;
const CLASSIFICATION_SCAN_CHARS = 4 * 1024;
const CLASSIFICATION_TAIL_LINES = 40;
const LONG_LINE_CHUNK_BYTES = 16 * 1024;
const REDACTION_LOOKBEHIND_BYTES = 256;
const STREAM_SECRET_PREFIXES = [
  { pattern: /\bBearer\s+/gi, continues: character => /[A-Za-z0-9._~+/=-]/.test(character) },
  {
    pattern: /\b(?:token|password|passwd|secret|api[_-]?key)\s*[=:]\s*/gi,
    continues: character => !/\s/.test(character),
  },
  {
    pattern: /\bAWS_(?:SECRET_ACCESS_KEY|ACCESS_KEY_ID|SESSION_TOKEN)\s*=\s*/g,
    continues: character => !/\s/.test(character),
  },
  {
    pattern: /\b[A-Z][A-Z0-9_]*(?:TOKEN|PASSWORD|PASSWD|SECRET|API_KEY|AUTHORIZATION|COOKIE)\s*=\s*/g,
    continues: character => !/\s/.test(character),
  },
  {
    pattern: /["'](?:token|password|passwd|secret|api[_-]?key)["']\s*:\s*["']/gi,
    continues: character => character !== '"' && character !== "'",
  },
  {
    pattern: /:\/\/[^\s/@:]+:/g,
    continues: character => !/[\s@]/.test(character),
  },
  {
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_/g,
    continues: character => /[A-Za-z0-9_]/.test(character),
  },
  {
    pattern: /\b(?:sk|rk|pk)-/g,
    continues: character => /[A-Za-z0-9_-]/.test(character),
  },
];

function processIdentity(pid, run = spawnSync) {
  const inspected = run('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='], {
    encoding: 'utf8', shell: false, timeout: 5_000, maxBuffer: 1024 * 1024,
  });
  if (inspected.error || inspected.status !== 0) return null;
  const match = String(inspected.stdout || '').trim().match(
    /^(\S+\s+\S+\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/
  );
  return match ? { started: match[1], command: match[2] } : null;
}

function processGroupMembers(pgid, run = spawnSync) {
  const inspected = run('/bin/ps', ['-axo', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-o', 'command='], {
    encoding: 'utf8', shell: false, timeout: 5_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (inspected.error || inspected.status !== 0) return null;
  return String(inspected.stdout || '').split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/);
    if (!match || Number(match[2]) !== Number(pgid)) return [];
    return [{ pid: Number(match[1]), pgid: Number(match[2]), started: match[3], command: match[4] }];
  });
}

function parseArgs(args) {
  const boundary = args.indexOf('--');
  if (args.length < 5 || boundary < 3 || boundary === args.length - 1) {
    throw new Error('stream-exec requires RUN_ID STATE_ROOT PHASE -- EXECUTABLE [ARGS]');
  }
  const wrapperArgs = args.slice(3, boundary);
  let captureBytes = 0;
  if (wrapperArgs.length > 0) {
    if (wrapperArgs.length !== 2 || wrapperArgs[0] !== '--capture-bytes'
      || !/^[1-9][0-9]*$/.test(wrapperArgs[1])) {
      throw new Error('stream-exec accepts only --capture-bytes POSITIVE_INTEGER before --');
    }
    captureBytes = Number(wrapperArgs[1]);
    if (!Number.isSafeInteger(captureBytes)) {
      throw new Error('stream-exec capture byte limit is too large');
    }
  }
  return {
    runId: args[0], root: args[1], phase: args[2],
    captureBytes,
    executable: args[boundary + 1], argv: args.slice(boundary + 2),
  };
}

function boundedTail(maxBytes) {
  let tail = Buffer.alloc(0);
  return {
    append(chunk) {
      if (maxBytes <= 0) return;
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (incoming.length >= maxBytes) {
        tail = Buffer.from(incoming.subarray(incoming.length - maxBytes));
        return;
      }
      const combined = Buffer.concat([tail, incoming]);
      tail = combined.length > maxBytes
        ? Buffer.from(combined.subarray(combined.length - maxBytes))
        : combined;
    },
    value() {
      return tail;
    },
  };
}

function splitUtf8Prefix(value, maxBytes) {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return [value, ''];
  let lower = 0;
  let upper = Math.min(value.length, maxBytes);
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= maxBytes) lower = middle;
    else upper = middle - 1;
  }
  let boundary = lower;
  const before = value.charCodeAt(boundary - 1);
  const after = value.charCodeAt(boundary);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
    boundary -= 1;
  }
  return [value.slice(0, boundary), value.slice(boundary)];
}

function boundarySecret(value, boundary) {
  let found = null;
  for (const specification of STREAM_SECRET_PREFIXES) {
    specification.pattern.lastIndex = 0;
    let match = specification.pattern.exec(value);
    while (match) {
      const valueStart = match.index + match[0].length;
      const prefixCrossesBoundary = match.index < boundary && valueStart > boundary;
      if (prefixCrossesBoundary && specification.continues(value[valueStart])) {
        if (!found || match.index < found.start) {
          found = {
            start: match.index,
            valueStart,
            continues: specification.continues,
          };
        }
      } else if (valueStart <= boundary && specification.continues(value[boundary])) {
        let cursor = valueStart;
        while (cursor < boundary && specification.continues(value[cursor])) cursor += 1;
        if (cursor === boundary && (!found || match.index < found.start)) {
          found = {
            start: match.index,
            valueStart,
            continues: specification.continues,
          };
        }
      }
      match = specification.pattern.exec(value);
    }
  }
  return found;
}

function consumeSecret(value, continues) {
  let cursor = 0;
  while (cursor < value.length && continues(value[cursor])) cursor += 1;
  return { remainder: value.slice(cursor), complete: cursor < value.length };
}

function lineBoundedTail(value, maxLines) {
  let newlines = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] !== 0x0a) continue;
    newlines += 1;
    if (newlines > maxLines) return value.subarray(index + 1);
  }
  return value;
}

function boundedClassificationCapture(maxBytes) {
  const tail = boundedTail(maxBytes);
  let scanWindow = '';
  let signal = null;
  return {
    append(chunk) {
      if (maxBytes <= 0) return;
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      tail.append(incoming);
      if (signal) return;
      const searchable = scanWindow + incoming.toString('utf8');
      const match = searchable.match(CLASSIFICATION_SIGNAL_PATTERN);
      if (match) signal = Buffer.from(match[0], 'utf8');
      scanWindow = searchable.slice(-CLASSIFICATION_SCAN_CHARS);
    },
    value() {
      const tailValue = tail.value();
      if (!signal) return tailValue;
      const lineTail = lineBoundedTail(tailValue, CLASSIFICATION_TAIL_LINES);
      if (CLASSIFICATION_SIGNAL_PATTERN.test(lineTail.toString('utf8'))) return lineTail;
      if (signal.length >= maxBytes) return Buffer.from(signal.subarray(0, maxBytes));
      const separator = Buffer.from('\n');
      const tailBytes = maxBytes - signal.length - separator.length;
      if (tailBytes <= 0) return Buffer.from(signal);
      const retainedTail = lineBoundedTail(
        tailValue.subarray(Math.max(0, tailValue.length - tailBytes)),
        CLASSIFICATION_TAIL_LINES
      );
      return Buffer.concat([
        signal,
        separator,
        retainedTail,
      ]);
    },
  };
}

function writeAll(fd, value) {
  let offset = 0;
  try {
    while (offset < value.length) {
      offset += fs.writeSync(fd, value, offset, value.length - offset);
    }
  } catch (error) {
    if (error.code !== 'EPIPE') throw error;
  }
}

function writeOptional(fd, value) {
  try {
    writeAll(fd, value);
  } catch (error) {
    if (error.code !== 'EBADF' && error.code !== 'EINVAL') throw error;
  }
}

function serializedError(error) {
  return Object.fromEntries([
    'name', 'message', 'code', 'errno', 'syscall', 'path', 'spawnargs',
  ].flatMap(name => error?.[name] === undefined ? [] : [[name, error[name]]]));
}

function streamCommand(options, dependencies = {}) {
  const session = readRun(options.runId, options.root).session;
  const spawnImpl = dependencies.spawn || spawn;
  const platform = dependencies.platform || process.platform;
  const usesPosixProcessGroups = platform !== 'win32';
  const child = spawnImpl(options.executable, options.argv, {
    env: process.env,
    detached: true,
    shell: false,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  let forceTimer = null;
  let controlTimer = null;
  let closed = false;
  let stopRequested = false;
  let spawnError = null;
  const captures = {
    stdout: boundedClassificationCapture(options.captureBytes),
    stderr: boundedClassificationCapture(options.captureBytes),
  };
  const terminate = (signal = 'SIGTERM') => {
    if (closed) return;
    if (usesPosixProcessGroups) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') {
          try { child.kill(signal); } catch { /* child already exited */ }
        }
      }
    } else {
      try { child.kill(signal); } catch { /* child already exited */ }
    }
    if (!forceTimer && signal !== 'SIGKILL') {
      forceTimer = setTimeout(() => {
        if (usesPosixProcessGroups) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* child already exited */ }
        } else {
          try { child.kill('SIGKILL'); } catch { /* child already exited */ }
        }
      }, 2_000);
      forceTimer.unref?.();
    }
  };
  const signalHandlers = new Map([
    ['SIGTERM', () => terminate('SIGTERM')],
    ['SIGINT', () => terminate('SIGINT')],
    ['SIGHUP', () => terminate('SIGHUP')],
  ]);
  for (const [signal, handler] of signalHandlers) process.on(signal, handler);
  controlTimer = setInterval(() => {
    let control;
    try {
      control = listControls(options.runId, options.root).find(candidate => candidate.action === 'stop');
    } catch {
      return;
    }
    if (!control) return;
    writeControlResponse(options.runId, options.root, control.control_id, {
      ok: true, stopping: true, phase: options.phase,
    });
    consumeControl(options.runId, options.root, control.control_id);
    updateState(options.runId, options.root, { status: 'stop-requested' });
    stopRequested = true;
    terminate('SIGTERM');
  }, 100);
  controlTimer.unref?.();
  child.once('spawn', () => {
    if (!usesPosixProcessGroups) return;
    try {
      const identity = (dependencies.processIdentity || processIdentity)(child.pid);
      if (!identity) throw new Error('could not establish child process birth identity');
      writeResource(options.runId, options.root, {
        kind: 'process', name: String(child.pid), pid: child.pid, pgid: child.pid,
        started: identity.started, command: identity.command,
        owner_token: session.owner_token,
      });
    } catch (error) {
      forward('stderr', `process receipt failed; terminating command: ${error.message}\n`);
      terminate('SIGKILL');
    }
  });
  const buffers = { stdout: '', stderr: '' };
  const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  const activeRedactions = { stdout: null, stderr: null };
  const publish = (stream, text) => {
    if (!text) return;
    const entry = appendEvent(options.runId, options.root, {
      type: 'step.output', phase: options.phase, stream, text,
    }, {
      now: Date.now(),
      monotonicMs: Math.max(0, Date.now() - session.created_ms),
    });
    const safeText = entry?.text ?? redactText(text).text;
    captures[stream].append(safeText);
    writeAll(stream === 'stdout' ? 1 : 2, Buffer.from(safeText));
  };
  const receive = (stream, chunk) => {
    let decoded = Buffer.isBuffer(chunk) ? decoders[stream].write(chunk) : String(chunk);
    if (activeRedactions[stream]) {
      const consumed = consumeSecret(decoded, activeRedactions[stream]);
      decoded = consumed.remainder;
      if (!consumed.complete) return;
      activeRedactions[stream] = null;
    }
    buffers[stream] += decoded;
    while (buffers[stream].length > 0) {
      const newline = buffers[stream].indexOf('\n');
      if (newline >= 0) {
        publish(stream, buffers[stream].slice(0, newline + 1));
        buffers[stream] = buffers[stream].slice(newline + 1);
      } else if (Buffer.byteLength(buffers[stream], 'utf8') > 32 * 1024) {
        const [prefix, remainder] = splitUtf8Prefix(
          buffers[stream],
          LONG_LINE_CHUNK_BYTES - REDACTION_LOOKBEHIND_BYTES
        );
        const secret = boundarySecret(buffers[stream], prefix.length);
        if (!secret) {
          publish(stream, prefix);
          buffers[stream] = remainder;
          continue;
        }
        publish(stream, `${buffers[stream].slice(0, secret.start)}[REDACTED]`);
        const consumed = consumeSecret(
          buffers[stream].slice(secret.valueStart),
          secret.continues
        );
        buffers[stream] = consumed.remainder;
        if (!consumed.complete) activeRedactions[stream] = secret.continues;
      } else break;
    }
  };
  const forward = (stream, chunk) => {
    receive(stream, chunk);
  };
  child.stdout.on('data', chunk => forward('stdout', chunk));
  child.stderr.on('data', chunk => forward('stderr', chunk));
  child.on('error', error => {
    spawnError = error;
    forward('stderr', `${error.message}\n`);
  });
  child.on('close', (code, signal) => {
    closed = true;
    if (forceTimer) clearTimeout(forceTimer);
    if (controlTimer) clearInterval(controlTimer);
    for (const [name, handler] of signalHandlers) process.removeListener(name, handler);
    buffers.stdout += decoders.stdout.end();
    buffers.stderr += decoders.stderr.end();
    if (signal) forward('stderr', `terminated by ${signal}\n`);
    publish('stdout', buffers.stdout);
    publish('stderr', buffers.stderr);
    const resource = readResources(options.runId, options.root)
      .find(candidate => candidate.kind === 'process' && candidate.pid === child.pid);
    if (resource) {
      const members = (dependencies.processGroupMembers || processGroupMembers)(resource.pgid || child.pid);
      if (Array.isArray(members) && members.length === 0) {
        clearResource(options.runId, options.root, session.owner_token, {
          kind: 'process', pid: child.pid,
        });
      }
    }
    if (options.captureBytes > 0) {
      writeAll(3, captures.stdout.value());
      writeAll(4, captures.stderr.value());
    }
    const childResult = spawnError
      ? { status: null, signal: null, error: serializedError(spawnError) }
      : {
        status: stopRequested ? 130 : (Number.isInteger(code) ? code : null),
        signal: stopRequested ? null : (signal || null),
      };
    writeOptional(5, Buffer.from(JSON.stringify(childResult)));
    process.exitCode = stopRequested
      ? 130
      : (spawnError ? 127 : (Number.isInteger(code) ? code : 1));
  });
}

if (require.main === module) {
  try {
    streamCommand(parseArgs(process.argv.slice(2)));
  } catch (error) {
    const diagnostic = Buffer.from(`${error.message}\n`);
    writeAll(2, diagnostic);
    writeOptional(4, diagnostic);
    process.exitCode = 2;
  }
}

module.exports = {
  boundarySecret,
  boundedClassificationCapture,
  boundedTail,
  parseArgs,
  processGroupMembers,
  processIdentity,
  splitUtf8Prefix,
  streamCommand,
  writeAll,
};
