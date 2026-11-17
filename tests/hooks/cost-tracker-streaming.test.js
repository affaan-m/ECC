'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const script = path.resolve(__dirname, '../../scripts/hooks/cost-tracker.js');

// Run in the real hook child, retaining real filesystem I/O while controlling
// short reads and an error after a complete record has already been read.
function installReadProbe() {
  const fs = require('node:fs');
  const target = process.env.ECC_TRANSCRIPT_FIXTURE;
  const mode = process.env.ECC_TRANSCRIPT_READ_MODE;
  const original = { open: fs.openSync, read: fs.readSync, close: fs.closeSync, readFile: fs.readFileSync };
  const descriptors = new Set();
  const report = { opened: 0, closed: 0, reads: 0, largestRead: 0 };
  const failure = () => Object.assign(new Error('Fixture read failed'), { code: 'EIO' });
  fs.openSync = function (file, ...args) {
    const descriptor = original.open.call(this, file, ...args);
    if (file === target) { descriptors.add(descriptor); report.opened += 1; }
    return descriptor;
  };
  fs.readFileSync = function (file, ...args) {
    if (file === target && mode === 'error') throw failure();
    return original.readFile.call(this, file, ...args);
  };
  fs.readSync = function (descriptor, buffer, offset, length, position) {
    if (descriptors.has(descriptor)) {
      report.reads += 1;
      report.largestRead = Math.max(report.largestRead, length);
      if (mode === 'error' && report.reads === 2) throw failure();
      if (mode === 'short') length = Math.min(length, 1 + report.reads % 7);
    }
    return original.read.call(this, descriptor, buffer, offset, length, position);
  };
  fs.closeSync = function (descriptor) {
    if (descriptors.delete(descriptor)) report.closed += 1;
    return original.close.call(this, descriptor);
  };
  process.on('exit', () => fs.writeFileSync(process.env.ECC_TRANSCRIPT_READ_REPORT, JSON.stringify(report)));
}

function withHookFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-cost-stream-'));
  const transcript = path.join(root, 'transcript.jsonl');
  const reportPath = path.join(root, 'reads.json');
  const preload = path.join(root, 'read-probe.cjs');
  fs.writeFileSync(preload, `(${installReadProbe.toString()})();\n`);
  function run({ mode = '', heapMb } = {}) {
    const input = JSON.stringify({ session_id: 'stream-fixture', transcript_path: transcript });
    const args = [...(heapMb ? [`--max-old-space-size=${heapMb}`] : []), '--require', preload, script];
    const result = spawnSync(process.execPath, args, {
      input, encoding: 'utf8', timeout: 20000,
      env: { ...process.env, HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: path.join(root, '.claude'),
        TMPDIR: root, TMP: root, TEMP: root,
        ECC_TRANSCRIPT_FIXTURE: transcript, ECC_TRANSCRIPT_READ_MODE: mode, ECC_TRANSCRIPT_READ_REPORT: reportPath }
    });
    assert.equal(result.status, 0, `${result.signal || ''}: ${result.stderr.slice(0, 600)}`);
    assert.equal(result.stdout, input);
    const row = JSON.parse(fs.readFileSync(path.join(root, '.claude/metrics/costs.jsonl'), 'utf8').trim());
    return { row, report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) };
  }
  try { fn({ transcript, run }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function assistant(id, inputTokens, model = 'claude-sonnet-4-20250514') {
  return { type: 'assistant', message: { id, model, usage: { input_tokens: inputTokens, output_tokens: 10 } } };
}

test('records a long transcript under a heap smaller than the transcript', () => withHookFixture(({ transcript, run }) => {
  const line = `${JSON.stringify({ type: 'user', message: { content: 'x'.repeat(4000) } })}\n`;
  const block = line.repeat(256);
  const descriptor = fs.openSync(transcript, 'w');
  try {
    for (let bytes = 0; bytes < 48 * 1024 * 1024; bytes += Buffer.byteLength(block)) fs.writeSync(descriptor, block);
    fs.writeSync(descriptor, `${JSON.stringify(assistant('last', 1000))}\n`);
  } finally { fs.closeSync(descriptor); }

  const { row, report } = run({ heapMb: 40 });
  assert.equal(row.input_tokens, 1000);
  assert.equal(row.output_tokens, 10);
  assert.equal(row.estimated_cost_usd, 0.00315);
  assert.ok(report.largestRead <= 64 * 1024);
  assert.equal(report.opened, report.closed);
}));

test('preserves duplicate IDs, UTF-8 boundaries, CRLF, and an unterminated final record', () => withHookFixture(({ transcript, run }) => {
  const prefix = '{"type":"assistant","message":{"id":"';
  const id = `${'a'.repeat(65535 - Buffer.byteLength(prefix))}😀`;
  const first = assistant(id, 100, 'claude-opus-4-5');
  const last = assistant(id, 300, undefined);
  delete last.message.model;
  fs.writeFileSync(transcript, `${JSON.stringify(first)}\r\n\r\nnot-json\r\n${JSON.stringify(last)}`);
  const { row, report } = run();
  assert.equal(row.input_tokens, 300);
  assert.equal(row.output_tokens, 10);
  assert.equal(row.model, 'claude-opus-4-5');
  assert.equal(row.estimated_cost_usd, 0.00175);
  assert.ok(report.largestRead <= 64 * 1024);
  assert.equal(report.opened, report.closed);
}));

test('continues across short reads and ignores non-record JSON values', () => withHookFixture(({ transcript, run }) => {
  fs.writeFileSync(transcript, [assistant('😀', 100), null, false, 7, [], assistant('😀', 200), assistant(undefined, 50)]
    .map(value => JSON.stringify(value)).join('\n'));
  const { row, report } = run({ mode: 'short' });
  assert.equal(row.input_tokens, 250);
  assert.equal(row.output_tokens, 20);
  assert.equal(row.estimated_cost_usd, 0.00105);
  assert.equal(report.opened, report.closed);
}));

test('closes the transcript and discards partial totals after a read failure', () => withHookFixture(({ transcript, run }) => {
  fs.writeFileSync(transcript, `${JSON.stringify(assistant('first', 100))}\n${' '.repeat(128 * 1024)}`);
  const { row, report } = run({ mode: 'error' });
  assert.equal(row.input_tokens, 0);
  assert.equal(row.output_tokens, 0);
  assert.equal(row.model, 'unknown');
  assert.equal(row.estimated_cost_usd, 0);
  assert.equal(report.opened, report.closed);
}));
