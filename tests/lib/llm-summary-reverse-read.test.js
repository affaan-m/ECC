'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');

const summaryPath = require.resolve('../../scripts/lib/llm-summary');
const source = fs.readFileSync(summaryPath, 'utf8');
const realRequire = createRequire(summaryPath);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-summary-reverse-'));
const user = content => JSON.stringify({ type: 'user', message: { content } });
const tool = content => JSON.stringify({ type: 'tool', content });

function loadSummary({ shortRead = Infinity, failure = null } = {}) {
  let stats = { bytes: 0, opens: 0, closes: 0, active: [], calls: [] };
  const facade = Object.freeze({
    ...fs,
    readFileSync(filename, ...args) {
      if (failure) throw new Error('injected transcript read failure');
      const result = fs.readFileSync(filename, ...args);
      stats = { ...stats, bytes: stats.bytes + Buffer.byteLength(result) };
      return result;
    },
    openSync(...args) {
      const fd = fs.openSync(...args);
      stats = { ...stats, opens: stats.opens + 1, active: [...stats.active, fd] };
      return fd;
    },
    fstatSync(fd) {
      if (failure === 'stat') throw new Error('injected fstat failure');
      return fs.fstatSync(fd);
    },
    readSync(fd, buffer, offset, length, position) {
      if (failure === 'read') throw new Error('injected read failure');
      if (failure === 'eof') return 0;
      const count = fs.readSync(fd, buffer, offset, Math.min(length, shortRead), position);
      stats = { ...stats, bytes: stats.bytes + count };
      return count;
    },
    closeSync(fd) {
      fs.closeSync(fd);
      stats = { ...stats, closes: stats.closes + 1, active: stats.active.filter(value => value !== fd) };
    }
  });
  const sandbox = {
    module: { exports: {} },
    process: { env: {}, platform: process.platform },
    require: name => name === 'fs' ? facade : name === 'child_process'
      ? { spawnSync: (...args) => {
        stats = { ...stats, calls: [...stats.calls, args] };
        return { status: 0, stdout: 'saved summary' };
      } }
      : realRequire(name)
  };
  vm.runInNewContext(source, sandbox, { filename: summaryPath });
  return { api: sandbox.module.exports, getStats: () => stats };
}

let sequence = 0;
function transcript(content) {
  const filename = path.join(directory, `${sequence++}.jsonl`);
  fs.writeFileSync(filename, content);
  return filename;
}

let passed = 0;
let failed = 0;
function test(name, callback) {
  try { callback(); console.log(`  PASS ${name}`); passed += 1; }
  catch (error) { console.error(`  FAIL ${name}\n    ${error.stack || error}`); failed += 1; }
}

try {
  const oldHistory = (tool('x'.repeat(1000)) + '\n').repeat(8192);
  const recent = Array.from({ length: 30 }, (_, index) => user(`recent ${index}`));
  const largeFile = transcript(oldHistory + recent.join('\n') + '\n');
  const expected = Array.from({ length: 25 }, (_, index) => `**User:** recent ${index + 5}`).join('\n\n');

  test('reads only a small tail of a large transcript once the recent window is full', () => {
    const { api, getStats } = loadSummary();
    assert.strictEqual(api.extractConversationText(largeFile), expected);
    assert.ok(getStats().bytes <= 128 * 1024, `read ${getStats().bytes} bytes for 25 recent turns`);
    assert.strictEqual(getStats().active.length, 0, 'early exit must close the transcript');
    assert.strictEqual(getStats().opens, getStats().closes);
  });

  test('decodes complete UTF-8 records across chunks and short reads with CRLF and no final newline', () => {
    const content = '界\u{1F642}'.repeat(22000);
    const file = transcript([
      user('first'), user(content), '{broken',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'last response' }] } })
    ].join('\r\n'));
    const { api, getStats } = loadSummary({ shortRead: 17 });
    assert.strictEqual(api.extractConversationText(file), [
      '**User:** first', `**User:** ${content.slice(0, 400)}`, '**Claude:** last response'
    ].join('\n\n'));
    assert.strictEqual(getStats().active.length, 0);
    assert.strictEqual(getStats().opens, getStats().closes);
  });

  test('continues past a large non-conversation tail instead of imposing a byte cutoff', () => {
    const file = transcript(recent.join('\n') + '\n' + (tool('x'.repeat(1000)) + '\n').repeat(512));
    const { api, getStats } = loadSummary();
    assert.strictEqual(api.extractConversationText(file), expected);
    assert.ok(getStats().bytes > 512 * 1024, 'complete skipped records must not hide older usable turns');
    assert.strictEqual(getStats().active.length, 0);
  });

  test('read failures and unexpected EOF return the existing fallback without leaking descriptors', () => {
    const file = transcript(user('preserve fallback') + '\n');
    for (const failure of ['stat', 'read', 'eof']) {
      const { api, getStats } = loadSummary({ failure });
      assert.strictEqual(api.extractConversationText(file), null, failure);
      assert.strictEqual(getStats().active.length, 0, failure);
      assert.strictEqual(getStats().opens, getStats().closes, failure);
    }
  });

  test('the actual summary generation path preserves the prompt while avoiding old-history I/O', () => {
    const { api, getStats } = loadSummary();
    assert.strictEqual(api.generateSessionSummary(largeFile), 'saved summary');
    assert.strictEqual(getStats().calls.length, 1);
    const [command, args, options] = getStats().calls[0];
    assert.strictEqual(command, 'claude');
    assert.deepStrictEqual(Array.from(args), ['--model', 'haiku', '-p']);
    assert.ok(options.input.includes(expected));
    assert.ok(!options.input.includes('recent 4\n'));
    assert.strictEqual(options.env.ECC_SKIP_LLM_SUMMARY, '1');
    assert.ok(getStats().bytes <= 128 * 1024, `summary generation read ${getStats().bytes} bytes`);
    assert.strictEqual(getStats().active.length, 0);
  });

  test('the pre-compact CLI persists a summary generated from the same recent conversation', () => {
    const dataHome = path.join(directory, 'agent-data');
    const sessions = path.join(dataHome, 'session-data');
    fs.mkdirSync(sessions, { recursive: true });
    const session = path.join(sessions, 'active-session.tmp');
    fs.writeFileSync(session, `**Worktree:** ${directory}\n<!-- ECC:SUMMARY:START -->\nold summary\n<!-- ECC:SUMMARY:END -->\n`);
    const promptPath = path.join(directory, 'captured-prompt.txt');
    const preload = path.join(directory, 'local-summarizer.cjs');
    // Run the real hook in a child process; replace only its external LLM boundary.
    fs.writeFileSync(preload, [
      "const fs = require('fs');",
      "const cp = require('child_process');",
      'const spawn = cp.spawnSync;',
      'cp.spawnSync = (command, args, options) => {',
      "  if (command !== 'claude') return spawn(command, args, options);",
      '  fs.writeFileSync(process.env.ECC_SUMMARY_TEST_PROMPT, options.input);',
      "  return { status: 0, stdout: 'summary from recent turns' };",
      '};'
    ].join('\n'));
    const result = spawnSync(process.execPath, ['--require', preload,
      path.join(__dirname, '../../scripts/hooks/pre-compact.js')], {
      cwd: directory,
      input: JSON.stringify({ transcript_path: largeFile }),
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, ECC_AGENT_DATA_HOME: dataHome, ECC_SUMMARY_TEST_PROMPT: promptPath,
        ECC_SKIP_LLM_SUMMARY: '', ECC_HOOK_DEADLINE_MS: String(Date.now() + 10000) }
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(fs.readFileSync(promptPath, 'utf8').includes(expected));
    const saved = fs.readFileSync(session, 'utf8');
    assert.ok(saved.includes('summary from recent turns'));
    assert.ok(!saved.includes('old summary'));
    assert.ok(saved.includes('LLM_SUMMARY:pre-compact:'));
  });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
