/** Tests for bounded, streaming control-pane action output. */

const assert = require('assert');
const { once } = require('events');
const path = require('path');
const { PassThrough } = require('stream');
const { captureActionOutput } = require('../../scripts/lib/control-pane/action-output');
const { runAction } = require('../../scripts/lib/control-pane/server');

const REPO_ROOT = path.join(__dirname, '..', '..');

async function capture(chunks) {
  const stream = new PassThrough();
  const readOutput = captureActionOutput(stream);
  const ended = once(stream, 'end');
  for (const chunk of chunks) stream.write(chunk);
  stream.end();
  await ended;
  return readOutput();
}

async function main() {
  const tests = [
    ['preserves empty, short, and exact-limit output', async () => {
      assert.strictEqual(await capture([]), '');
      assert.strictEqual(await capture([Buffer.from('hello')]), 'hello');
      assert.strictEqual(await capture([Buffer.from('x'.repeat(20000))]), 'x'.repeat(20000));
    }],
    ['keeps the original prefix and counts output discarded across chunks', async () => {
      const stream = new PassThrough();
      const readOutput = captureActionOutput(stream);
      const ended = once(stream, 'end');
      stream.write(Buffer.from('a'.repeat(19990)));
      stream.write(Buffer.from('b'.repeat(30)));
      assert.strictEqual(readOutput(), `${'a'.repeat(19990)}${'b'.repeat(10)}\n[truncated 20 chars]`);
      const chunk = Buffer.from('c'.repeat(65536));
      for (let index = 0; index < 256; index += 1) stream.write(chunk);
      stream.end();
      await ended;
      assert.strictEqual(readOutput(), `${'a'.repeat(19990)}${'b'.repeat(10)}\n[truncated ${20 + chunk.length * 256} chars]`);
    }],
    ['decodes UTF-8 characters split at every byte boundary', async () => {
      const text = '\ud55c\ud83d\ude42\u00e9';
      const bytes = Buffer.from(text);
      for (let split = 1; split < bytes.length; split += 1) {
        assert.strictEqual(await capture([bytes.subarray(0, split), bytes.subarray(split)]), text);
      }
      assert.strictEqual(await capture([...bytes].map(byte => Buffer.from([byte]))), text);
    }],
    ['flushes an incomplete final UTF-8 sequence and counts UTF-16 characters', async () => {
      assert.strictEqual(await capture([Buffer.from([0xed])]), '\ufffd');
      assert.strictEqual(
        await capture([Buffer.from('x'.repeat(19999)), Buffer.from('\ud83d\ude42\u00e9')]),
        `${'x'.repeat(19999)}\ud83d\n[truncated 2 chars]`
      );
    }],
    ['tracks independent streams without stopping either stream at its limit', async () => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const readStdout = captureActionOutput(stdout);
      const readStderr = captureActionOutput(stderr);
      const ended = Promise.all([once(stdout, 'end'), once(stderr, 'end')]);
      stdout.write(Buffer.from('out'.repeat(10000)));
      stderr.write(Buffer.from('err'));
      stdout.end(Buffer.from('tail'));
      stderr.end(Buffer.from('or'));
      await ended;
      assert.strictEqual(readStdout(), `${'out'.repeat(10000).slice(0, 20000)}\n[truncated 10004 chars]`);
      assert.strictEqual(readStderr(), 'error');
    }],
    ['runAction drains large stdout and stderr while retaining their prefixes', async () => {
      const result = await runAction({
        id: 'node-large-streams',
        command: process.execPath,
        args: ['-e', [
          'process.stdout.write("x".repeat(4 * 1024 * 1024));',
          'process.stderr.write("y".repeat(4 * 1024 * 1024));',
        ].join('\n')],
        cwd: REPO_ROOT
      });
      const suffix = `\n[truncated ${4 * 1024 * 1024 - 20000} chars]`;
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, `${'x'.repeat(20000)}${suffix}`);
      assert.strictEqual(result.stderr, `${'y'.repeat(20000)}${suffix}`);
    }],
    ['runAction preserves UTF-8 split across stdout and stderr chunks', async () => {
      const result = await runAction({
        id: 'node-streamed-utf8',
        command: process.execPath,
        args: ['-e', [
          'process.stdout.write(Buffer.from([0xed]));',
          'process.stderr.write(Buffer.from([0xf0, 0x9f]));',
          'setTimeout(() => {',
          '  process.stdout.write(Buffer.from([0x95, 0x9c]));',
          '  process.stderr.write(Buffer.from([0x99, 0x82]));',
          '}, 80);',
        ].join('\n')],
        cwd: REPO_ROOT
      });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.stdout, '\ud55c');
      assert.strictEqual(result.stderr, '\ud83d\ude42');
    }],
  ];
  let failed = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`  PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${name}\n    ${error.stack}`);
    }
  }
  console.log(`\nResults: Passed: ${tests.length - failed}, Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
