'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { OVERLAYS, overlay } = require('./overlay.cjs');

const root = process.env.ECC_DIAGNOSTIC_REPO;
if (!root) throw new Error('Diagnostic preload requires an explicit repository');
const start = process.hrtime.bigint();
let sequence = 0;
let currentPath = null;
let traceWriteMs = 0;

function safePath(value) {
  for (const [label, base] of [['home', process.env.HOME], ['project', process.cwd()], ['repo', root]]) {
    const relative = path.relative(base, value);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return `${label}/${relative.split(path.sep).join('/')}`;
    }
  }
  return '<outside-synthetic-roots>';
}

function trace(phase, details = {}) {
  if (details.path) currentPath = safePath(details.path);
  const record = {
    sequence: ++sequence,
    elapsedMs: Number(process.hrtime.bigint() - start) / 1e6,
    phase,
    ...details,
    path: currentPath,
    traceWriteMs,
  };
  const before = process.hrtime.bigint();
  // Dedicated inherited file descriptor, so the original stdout/stderr buffers remain intact.
  fs.writeSync(3, `${JSON.stringify(record)}\n`);
  traceWriteMs += Number(process.hrtime.bigint() - before) / 1e6;
}

globalThis[Symbol.for('ecc.windows-installer-diagnostic')] = trace;
const originalExtension = Module._extensions['.js'];
Module._extensions['.js'] = function diagnosticExtension(module, filename) {
  const relative = path.relative(root, filename).split(path.sep).join('/');
  if (!Object.hasOwn(OVERLAYS, relative)) return originalExtension(module, filename);
  trace('overlay:load', { module: relative });
  module._compile(overlay(relative, fs.readFileSync(filename, 'utf8')), filename);
};

trace('preload:ready', { node: process.version, platform: process.platform });
process.on('exit', code => trace('process:exit', { code }));
