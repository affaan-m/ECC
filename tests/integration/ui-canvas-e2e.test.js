/**
 * End-to-end test for UI Canvas through the real CLI (scripts/ui-canvas.js)
 * and a real detached canvas server, with the browser side simulated over
 * the same HTTP surface the shell uses.
 *
 * Flow under test:
 *   agent: open --no-open --viewport mobile   → server starts, ui session opens
 *   agent: open on a markdown file            → refused before touching the server
 *   agent: await (blocking child)             → long poll, agent identity recorded
 *   browser: POST chat with anchor            → await resolves with ui guidance
 *   agent: await --reply + browser finish     → export written, finish guidance
 *   agent: pending / status / end / stop
 *
 * Run with: node tests/integration/ui-canvas-e2e.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', 'scripts', 'ui-canvas.js');

const results = [];
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    results.push(true);
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.stack || err.message}`);
    results.push(false);
  }
}

function cli(env, args, { timeoutMs = 15000 } = {}) {
  const result = spawnSync('node', [CLI, ...args], { encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, ...env } });
  let parsed = null;
  try { parsed = JSON.parse(result.stdout.trim()); } catch { /* callers assert */ }
  return { ...result, parsed };
}

function request(port, method, requestPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, method, path: requestPath, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve({ statusCode: res.statusCode, body: JSON.parse(data.trim() || '{}') }); } catch { resolve({ statusCode: res.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function startAwait(env, file, extra = []) {
  const child = spawn('node', [CLI, 'await', file, ...extra], { env: { ...process.env, ...env, ECC_CANVAS_AGENT: 'Test Harness' } });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', () => {});
  const done = new Promise(resolve => child.on('close', () => resolve(stdout)));
  return { child, done };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log('ui-canvas e2e');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-canvas-e2e-'));
  const stateDir = path.join(tmp, 'state');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ECC_PLAN_CANVAS_STATE_DIR: stateDir, ECC_PLAN_CANVAS_PORT: String(port) };
  const mockup = path.join(tmp, 'card.html');
  fs.writeFileSync(mockup, '<!DOCTYPE html><html><body><article id="card"><h1>Hi</h1></article></body></html>');
  let key = null;

  try {
    await test('open refuses non-HTML before starting a server', async () => {
      const plan = path.join(tmp, 'plan.md');
      fs.writeFileSync(plan, '# plan');
      const res = cli(env, ['open', plan, '--no-open']);
      assert.ok(res.parsed && /\.html/.test(res.parsed.error), res.stdout);
      assert.strictEqual(cli(env, []).parsed.server, 'not running');
    });

    await test('open starts the shared server and opens a ui session', async () => {
      const res = cli(env, ['open', mockup, '--no-open', '--viewport', 'mobile', '--title', 'Card']);
      assert.strictEqual(res.parsed.status, 'open', res.stdout);
      assert.match(res.parsed.url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/canvas/[a-f0-9]{12}$`));
      assert.match(res.parsed.next_step, /ecc-ui-canvas await/);
      key = res.parsed.url.split('/').pop();
      const status = cli(env, []);
      assert.strictEqual(status.parsed.sessions[0].mode, 'ui');
      const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'sessions.json'), 'utf8'));
      assert.deepStrictEqual(state.sessions[key].ui, { viewport: 'mobile', title: 'Card' });
    });

    await test('await records the agent and resolves with ui guidance on chat', async () => {
      const waiting = startAwait(env, mockup);
      await sleep(500);
      const sessions = await request(port, 'GET', '/api/sessions');
      assert.strictEqual(sessions.body.sessions[0].agent.name, 'Test Harness');
      await request(port, 'POST', `/api/session/${key}/feedback`, {
        items: [{ kind: 'chat', text: 'make it gray', anchor: { selector: '#card', tag: 'article', snippet: 'Hi' }, pendingEdits: ['removed h1'] }]
      });
      const out = JSON.parse(await waiting.done);
      assert.strictEqual(out.status, 'feedback');
      assert.strictEqual(out.items[0].anchor.selector, '#card');
      assert.match(out.next_step, /live-reloads/);
      assert.match(out.next_step, /ecc-ui-canvas await <file> --reply/);
    });

    await test('await --reply lands in chat and finish delivers export paths', async () => {
      const waiting = startAwait(env, mockup, ['--reply', 'Gray it is.']);
      await sleep(500);
      const sessions = await request(port, 'GET', '/api/sessions');
      assert.strictEqual(sessions.body.sessions[0].status, 'open');
      await request(port, 'POST', `/api/session/${key}/feedback`, {
        items: [{ kind: 'finish', html: '<!DOCTYPE html>\n<html><body><article id="card" style="background:#333"><h1>Hi</h1></article></body></html>\n', edits: [{ kind: 'style', selector: '#card', property: 'background-color', before: 'white', after: '#333' }], viewport: { preset: 'mobile', width: 393, height: 852 } }],
        endSession: true
      });
      const out = JSON.parse(await waiting.done);
      assert.strictEqual(out.sessionEnded, true);
      const finish = out.items[0];
      assert.strictEqual(finish.kind, 'finish');
      assert.strictEqual(finish.exportPath, path.join(fs.realpathSync(tmp), 'card.edited.html'));
      assert.ok(fs.existsSync(finish.exportPath));
      assert.match(out.next_step, /Save and Finish/);
      assert.ok(out.next_step.includes(finish.exportPath));
      const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'sessions.json'), 'utf8'));
      const chat = state.sessions[key].chat.map(entry => entry.text);
      assert.ok(chat.includes('Gray it is.'));
      assert.ok(chat.includes('Saved and finished with 1 edit'));
    });

    await test('a user-finished session refuses a plain reopen and reports ended on await', async () => {
      const reopen = cli(env, ['open', mockup, '--no-open']);
      assert.strictEqual(reopen.parsed.status, 'user-ended');
      const ended = cli(env, ['await', mockup, '--timeout-ms', '200']);
      assert.strictEqual(ended.parsed.status, 'ended');
      assert.match(ended.parsed.next_step, /ended the preview/);
    });

    await test('pending lists ui sessions with a ui-canvas resume command', async () => {
      const other = path.join(tmp, 'sidebar$(touch injected).html');
      fs.writeFileSync(other, '<html><body><nav>x</nav></body></html>');
      const opened = cli(env, ['open', other, '--no-open']);
      assert.strictEqual(opened.parsed.status, 'open');
      const otherKey = opened.parsed.url.split('/').pop();
      await request(port, 'POST', `/api/session/${otherKey}/feedback`, { items: [{ kind: 'chat', text: 'queued for nobody' }] });
      const pending = cli(env, ['pending']);
      assert.strictEqual(pending.parsed.status, 'pending');
      assert.strictEqual(pending.parsed.sessions[0].mode, 'ui');
      assert.strictEqual(pending.parsed.sessions[0].resume, `ecc-ui-canvas await --session-key ${otherKey}`);
      if (process.platform !== 'win32') {
        const binDir = path.join(tmp, 'bin');
        const recorder = path.join(tmp, 'record-argv.cjs');
        const recorded = path.join(tmp, 'argv.json');
        fs.mkdirSync(binDir);
        fs.writeFileSync(recorder, 'require("node:fs").writeFileSync(process.env.ECC_CANVAS_ARGV_RECORD, JSON.stringify(process.argv.slice(2)));\n');
        const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
        fs.writeFileSync(path.join(binDir, 'ecc-ui-canvas'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(recorder)} "$@"\n`, { mode: 0o700 });
        const shell = spawnSync('sh', ['-c', pending.parsed.sessions[0].resume], {
          cwd: tmp, encoding: 'utf8',
          env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, ECC_CANVAS_ARGV_RECORD: recorded },
        });
        assert.strictEqual(shell.status, 0, shell.stderr);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(recorded, 'utf8')), ['await', '--session-key', otherKey]);
        const hook = require('../../scripts/hooks/plan-canvas-pending');
        const reason = hook.buildReason([{ key: otherKey, file: other, mode: 'ui', messages: ['literal path'], sessionEnded: false }]);
        const command = reason.split('\n').find(line => line.startsWith('    ecc-ui-canvas'));
        assert.ok(command && !command.includes('sidebar'), 'Hook commands must not embed artifact paths');
        const hookShell = spawnSync('sh', ['-c', command], {
          cwd: tmp, encoding: 'utf8',
          env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, ECC_CANVAS_ARGV_RECORD: recorded },
        });
        assert.strictEqual(hookShell.status, 0, hookShell.stderr);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(recorded, 'utf8')), ['await', '--session-key', otherKey, '--reply', '<what you did>']);
      }
      const resumed = cli(env, ['await', '--session-key', otherKey, '--reply', 'Literal filename accepted', '--timeout-ms', '200']);
      assert.strictEqual(resumed.parsed.status, 'feedback', resumed.stdout);
      assert.strictEqual(resumed.parsed.items[0].text, 'queued for nobody');
      assert.ok(fs.existsSync(other), 'A metacharacter filename stays literal');
      assert.ok(!fs.existsSync(path.join(tmp, 'injected')));
      for (const invalid of ['', 'BADKEY', 'a'.repeat(13), 'a'.repeat(12) + '\n']) {
        const refused = cli(env, ['await', '--session-key', invalid, '--timeout-ms', '1']);
        assert.strictEqual(refused.status, 1);
        assert.match(refused.parsed.error, /session-key/);
      }
      const missing = cli(env, ['await', '--session-key', '000000000000', '--timeout-ms', '1']);
      assert.strictEqual(missing.parsed.status, 'missing');
      const ended = cli(env, ['end', other]);
      assert.strictEqual(ended.parsed.status, 'ended');
      assert.strictEqual(cli(env, ['await', '--session-key', otherKey, '--timeout-ms', '1']).parsed.status, 'ended');
    });

    await test('pending retains a saved Finish until key await consumes it without reopening', async () => {
      const saved = path.join(tmp, 'saved.html');
      fs.writeFileSync(saved, '<html><body>original</body></html>');
      const opened = cli(env, ['open', saved, '--no-open']);
      const savedKey = opened.parsed.url.split('/').pop();
      await request(port, 'POST', `/api/session/${savedKey}/feedback`, {
        items: [{ kind: 'finish', html: '<html><body>saved</body></html>', edits: [] }], endSession: true,
      });
      const pending = cli(env, ['pending']);
      assert.strictEqual(pending.parsed.status, 'pending');
      assert.strictEqual(pending.parsed.sessions[0].resume, `ecc-ui-canvas await --session-key ${savedKey}`);
      const delivered = cli(env, ['await', '--session-key', savedKey, '--timeout-ms', '200']);
      assert.strictEqual(delivered.parsed.sessionEnded, true);
      assert.strictEqual(delivered.parsed.items[0].kind, 'finish');
      assert.match(delivered.parsed.next_step, /Do not reopen/);
      assert.strictEqual(cli(env, ['pending']).parsed.status, 'clear');
      assert.strictEqual(cli(env, ['open', saved, '--no-open']).parsed.status, 'user-ended');
    });

    await test('stop shuts the shared server down', async () => {
      const stop = cli(env, ['stop']);
      assert.strictEqual(stop.parsed.status, 'stopping');
      let gone = false;
      for (let i = 0; i < 30 && !gone; i++) {
        await sleep(100);
        gone = cli(env, []).parsed.server === 'not running';
      }
      assert.ok(gone, 'server should stop listening after stop');
    });
  } finally {
    cli(env, ['stop']);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log('\n' + '='.repeat(40));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('='.repeat(40));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  console.log('Passed: 0');
  console.log('Failed: 1');
  process.exit(1);
});
