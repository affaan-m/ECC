'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_CAPTURE_BYTES = 1024 * 1024;

function captureBytes(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_CAPTURE_BYTES;
}

function parseChildResult(value) {
  if (!value || value.length === 0) return null;
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : value);
  } catch {
    return null;
  }
}

function childSpawnError(details) {
  if (!details) return undefined;
  const error = new Error(details.message || 'streamed command could not start');
  for (const name of ['name', 'code', 'errno', 'syscall', 'path', 'spawnargs']) {
    if (details[name] !== undefined) error[name] = details[name];
  }
  return error;
}

function runStreaming(executable, argv, options) {
  const stream = options.streamOutput;
  const captureLimit = captureBytes(options.maxBuffer);
  const forwarded = { ...options };
  delete forwarded.streamOutput;
  forwarded.encoding = forwarded.encoding || 'utf8';
  forwarded.maxBuffer = Math.max(DEFAULT_CAPTURE_BYTES, captureLimit);
  forwarded.stdio = ['pipe', 'inherit', 'inherit', 'pipe', 'pipe', 'pipe'];
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'stream-exec.js'),
    stream.runId,
    stream.root,
    stream.phase,
    '--capture-bytes',
    String(captureLimit),
    '--',
    executable,
    ...argv,
  ], forwarded);
  const streamed = {
    ...result,
    stdout: result.output?.[3] || '',
    stderr: result.output?.[4] || '',
  };
  const childResult = result.error ? null : parseChildResult(result.output?.[5]);
  if (!childResult) return streamed;
  return {
    ...streamed,
    status: childResult.status,
    signal: childResult.signal,
    error: childSpawnError(childResult.error),
  };
}

module.exports = {
  DEFAULT_CAPTURE_BYTES,
  captureBytes,
  childSpawnError,
  parseChildResult,
  runStreaming,
};
