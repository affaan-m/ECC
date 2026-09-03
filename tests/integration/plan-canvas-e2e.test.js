/**
 * End-to-end test for Plan Canvas: the complete review workflow through the
 * real CLI (scripts/plan-canvas.js) and a real detached server process, with
 * the browser side simulated over the same HTTP surface the chrome uses.
 *
 * Flow under test:
 *   agent: open --no-open            → detached server starts, session opens
 *   browser: loads canvas + artifact
 *   agent: await (blocking child)    → long poll
 *   browser: POST annotation + request-changes verdict
 *   agent: await resolves with feedback JSON
 *   agent: edits plan, await --reply → reply lands in canvas chat
 *   browser: POST end                → user end is sticky
 *   agent: open refused / --reopen works / end / stop
 *
 * Run with: node tests/integration/plan-canvas-e2e.test.js
 */

const assert = require('assert');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', 'scripts', 'plan-canvas.js');
const HOOK = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'plan-canvas-sessions.js');
const { withServerStartLock } = require('../../scripts/plan-canvas');

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
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, ...env }
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    // leave null; callers assert
  }
  return { ...result, parsed };
}

function cliAsync(env, args, { timeoutMs = 15000 } = {}) {
  return new Promise(resolve => {
    const child = spawn('node', [CLI, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        // leave null; callers assert
      }
      resolve({ status, signal, stdout, stderr, parsed });
    });
  });
}

function request(port, method, requestPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: requestPath,
        agent: false,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}
      },
      res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('\n=== Plan Canvas end-to-end workflow ===\n');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-e2e-'));
  const stateDir = path.join(tmp, 'state');
  const plansDir = path.join(tmp, '.claude', 'plans');
  fs.mkdirSync(plansDir, { recursive: true });
  const plan = path.join(plansDir, 'notifications.plan.md');
  fs.writeFileSync(
    plan,
    [
      '# Plan: Real-Time Notifications',
      '',
      '**Complexity**: Medium',
      '',
      '## Summary',
      'Notify users when watched markets resolve.',
      '',
      '## Files to Change',
      '| File | Action | Why |',
      '|---|---|---|',
      '| `lib/notify.ts` | CREATE | delivery service |',
      '',
      '## Tasks',
      '### Task 1: Schema',
      '- **Action**: add notifications table',
      '- **Validate**: `npm test`',
      ''
    ].join('\n')
  );

  // Unique port so the test never collides with a user's real canvas server.
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ECC_PLAN_CANVAS_STATE_DIR: stateDir, ECC_PLAN_CANVAS_PORT: String(port) };
  let key = null;

  try {
    await test('port-scoped startup lock serializes server replacement callers', async () => {
      const lockDir = path.join(tmp, 'startup-locks');
      let active = 0;
      let maximumActive = 0;
      const runLocked = label => withServerStartLock(port + 2, async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, 40));
        active -= 1;
        return label;
      }, { lockDir, timeoutMs: 2000 });
      assert.deepStrictEqual(await Promise.all([runLocked('first'), runLocked('second')]), ['first', 'second']);
      assert.strictEqual(maximumActive, 1);
    });

    await test('port-scoped startup lock preserves an old ticket from the same live process', async () => {
      const lockPort = port + 6;
      const lockDir = path.join(tmp, 'startup-locks');
      let releaseFirst;
      let markFirstEntered;
      let secondEntered = false;
      const firstEntered = new Promise(resolve => { markFirstEntered = resolve; });
      const first = withServerStartLock(lockPort, async () => {
        markFirstEntered();
        await new Promise(resolve => { releaseFirst = resolve; });
      }, { lockDir, timeoutMs: 1000 });
      await firstEntered;
      const ticketName = fs.readdirSync(lockDir).find(name => name.endsWith('.ticket'));
      assert.ok(ticketName);
      const old = new Date(Date.now() - 60 * 1000);
      fs.utimesSync(path.join(lockDir, ticketName), old, old);
      try {
        await assert.rejects(
          withServerStartLock(lockPort, async () => { secondEntered = true; }, {
            lockDir,
            timeoutMs: 200
          }),
          /timed out waiting for Plan Canvas startup lock/
        );
        assert.strictEqual(secondEntered, false);
      } finally {
        releaseFirst();
        await first;
      }
    });

    await test('port-scoped startup lock recovers dead tickets and failed owners', async () => {
      const lockPort = port + 3;
      const lockDir = path.join(tmp, 'startup-locks');
      fs.mkdirSync(lockDir, { recursive: true });
      const deadTicket = path.join(lockDir, `ecc-plan-canvas-${lockPort}-dead-owner.ticket`);
      fs.writeFileSync(deadTicket, JSON.stringify({ pid: 2147483647, token: 'dead-owner', number: 1 }));
      await assert.rejects(
        withServerStartLock(lockPort, async () => { throw new Error('owner failed'); }, { lockDir, timeoutMs: 2000 }),
        /owner failed/
      );
      assert.strictEqual(
        await withServerStartLock(lockPort, async () => 'recovered', { lockDir, timeoutMs: 2000 }),
        'recovered'
      );
      assert.ok(!fs.existsSync(deadTicket));
      assert.ok(!fs.readdirSync(lockDir).some(name => name.startsWith(`ecc-plan-canvas-${lockPort}-`)));
    });

    await test('port-scoped startup lock recovers a stale ticket after PID reuse', async () => {
      const lockPort = port + 5;
      const lockDir = path.join(tmp, 'startup-locks');
      fs.mkdirSync(lockDir, { recursive: true });
      const reusedPidTicket = path.join(lockDir, `ecc-plan-canvas-${lockPort}-reused-pid.ticket`);
      fs.writeFileSync(
        reusedPidTicket,
        JSON.stringify({
          pid: process.pid,
          processIdentity: 'an-exited-process-instance',
          token: 'reused-pid',
          number: 1
        })
      );
      assert.strictEqual(
        await withServerStartLock(lockPort, async () => 'recovered', {
          lockDir,
          timeoutMs: 1000
        }),
        'recovered'
      );
      assert.ok(!fs.existsSync(reusedPidTicket));
    });

    await test('unrelated UDP traffic on the Canvas port does not block startup', async () => {
      const servicePort = port + 4;
      const unrelatedSocket = dgram.createSocket('udp4');
      await new Promise((resolve, reject) => {
        unrelatedSocket.once('error', reject);
        unrelatedSocket.bind(servicePort, '127.0.0.1', resolve);
      });
      try {
        assert.strictEqual(
          await withServerStartLock(servicePort, async () => 'started', { timeoutMs: 2000 }),
          'started'
        );
      } finally {
        unrelatedSocket.close();
      }
    });

    await test('concurrent opens serialize replacement of a same-version legacy server', async () => {
      const legacyPort = port + 1;
      const legacyStateDir = path.join(tmp, 'legacy-state');
      const legacyEnv = {
        ECC_PLAN_CANVAS_STATE_DIR: legacyStateDir,
        ECC_PLAN_CANVAS_PORT: String(legacyPort)
      };
      const version = require('../../package.json').version;
      let shutdownRequested = false;
      const legacyServer = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, app: 'ecc-plan-canvas', version }));
        }
        if (req.method === 'POST' && req.url === '/shutdown') {
          shutdownRequested = true;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'stopping' }));
          return setImmediate(() => legacyServer.close());
        }
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'legacy server handled a current CLI request' }));
      });
      await new Promise((resolve, reject) => {
        legacyServer.once('error', reject);
        legacyServer.listen(legacyPort, '127.0.0.1', resolve);
      });

      try {
        const results = await Promise.all([
          cliAsync(legacyEnv, ['open', plan, '--no-open']),
          cliAsync(legacyEnv, ['open', plan, '--no-open'])
        ]);
        for (const result of results) {
          assert.strictEqual(result.status, 0, result.stderr);
          assert.strictEqual(result.parsed.status, 'open');
        }
        assert.strictEqual(shutdownRequested, true, 'current CLI should retire the stale server');
        const health = JSON.parse((await request(legacyPort, 'GET', '/health')).body);
        assert.strictEqual(health.protocolVersion, 4);
      } finally {
        if (legacyServer.listening) {
          await new Promise(resolve => legacyServer.close(resolve));
        }
        cli(legacyEnv, ['stop']);
      }
    });

    await test('agent opens the plan: detached server starts, session created', async () => {
      const result = cli(env, ['open', plan, '--no-open']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.parsed.status, 'open');
      assert.ok(result.parsed.url.includes(`127.0.0.1:${port}/canvas/`));
      key = result.parsed.url.split('/canvas/')[1];
      const info = JSON.parse(fs.readFileSync(path.join(stateDir, 'server.json'), 'utf8'));
      assert.strictEqual(info.port, port);
    });

    await test('browser loads the canvas chrome and the rendered plan', async () => {
      const chrome = await request(port, 'GET', `/canvas/${key}`);
      assert.strictEqual(chrome.statusCode, 200);
      assert.ok(chrome.body.includes('Plan Canvas'));
      assert.ok(chrome.body.includes('notifications.plan.md'));
      const doc = await request(port, 'GET', `/artifact/${key}/`);
      assert.ok(doc.body.includes('<h1 id="plan-real-time-notifications">'));
      assert.ok(doc.body.includes('lib/notify.ts'));
      assert.ok(doc.body.includes('/sdk.js'));
    });

    await test('SessionStart hook surfaces the open review', async () => {
      const hook = spawnSync('node', [HOOK], { encoding: 'utf8', input: '{}', env: { ...process.env, ...env } });
      assert.strictEqual(hook.status, 0);
      assert.ok(hook.stdout.includes('notifications.plan.md'));
    });

    let awaitChild = null;
    let awaitStdout = '';
    const awaitExit = () =>
      new Promise(resolve => {
        awaitChild.on('close', resolve);
      });

    await test('agent blocks on await; user annotation + verdict resolve it', async () => {
      awaitChild = spawn('node', [CLI, 'await', plan], { env: { ...process.env, ...env } });
      awaitChild.stdout.on('data', chunk => {
        awaitStdout += chunk;
      });
      const exited = awaitExit();
      // Queued-then-drained semantics make this race-free: feedback posted
      // before the poll attaches is delivered the moment it does.
      const post = await request(port, 'POST', `/api/session/${key}/feedback`, {
        items: [
          {
            kind: 'annotation',
            text: 'Also notify via webhook, not just email',
            anchor: { selector: 'h3:nth-of-type(1)', tag: 'h3', snippet: 'Task 1: Schema' }
          },
          { kind: 'verdict', verdict: 'request-changes' }
        ]
      });
      assert.strictEqual(post.statusCode, 200);
      await exited;
      const feedback = JSON.parse(awaitStdout.trim());
      assert.strictEqual(feedback.status, 'feedback');
      assert.strictEqual(feedback.items.length, 2);
      assert.strictEqual(feedback.items[0].kind, 'annotation');
      assert.ok(feedback.items[0].anchor.snippet.includes('Task 1'));
      assert.strictEqual(feedback.items[1].verdict, 'request-changes');
      assert.ok(feedback.next_step.includes('--reply'));
    });

    await test('agent edits the plan and replies; reply reaches the canvas chat', async () => {
      fs.appendFileSync(plan, '\n### Task 2: Webhook channel\n- **Action**: add webhook delivery\n');
      const result = cli(env, ['await', plan, '--reply', 'Added webhook delivery as Task 2.', '--timeout-ms', '400']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.parsed.status, 'waiting');
      // The chrome bootstraps its chat from the canvas page.
      const chrome = await request(port, 'GET', `/canvas/${key}`);
      assert.ok(chrome.body.includes('Added webhook delivery as Task 2.'));
      const doc = await request(port, 'GET', `/artifact/${key}/`);
      assert.ok(doc.body.includes('Webhook channel'));
    });

    await test('user approves; the verdict arrives as plan confirmation', async () => {
      awaitChild = spawn('node', [CLI, 'await', plan], { env: { ...process.env, ...env } });
      awaitStdout = '';
      awaitChild.stdout.on('data', chunk => {
        awaitStdout += chunk;
      });
      const exited = awaitExit();
      await request(port, 'POST', `/api/session/${key}/feedback`, {
        items: [{ kind: 'verdict', verdict: 'approve' }]
      });
      await exited;
      const feedback = JSON.parse(awaitStdout.trim());
      assert.strictEqual(feedback.items[0].verdict, 'approve');
    });

    await test('user ends the session; plain reopen is refused, --reopen works', async () => {
      await request(port, 'POST', `/api/session/${key}/end`);
      const refused = cli(env, ['open', plan, '--no-open']);
      assert.strictEqual(refused.parsed.status, 'user-ended');
      assert.ok(refused.parsed.next_step.includes('Do not reopen'));
      const forced = cli(env, ['open', plan, '--no-open', '--reopen']);
      assert.strictEqual(forced.parsed.status, 'open');
    });

    await test('await on a user-ended session reports ended with guidance', async () => {
      await request(port, 'POST', `/api/session/${key}/end`);
      const result = cli(env, ['await', plan, '--timeout-ms', '400']);
      assert.strictEqual(result.parsed.status, 'ended');
      assert.strictEqual(result.parsed.endedBy, 'user');
      assert.ok(result.parsed.next_step.includes('Stop polling'));
    });

    await test('agent end + status + stop shut everything down', async () => {
      cli(env, ['open', plan, '--no-open', '--reopen']);
      const ended = cli(env, ['end', plan]);
      assert.strictEqual(ended.parsed.endedBy, 'agent');
      const status = cli(env, []);
      assert.ok(String(status.parsed.server).includes(`127.0.0.1:${port}`));
      const stop = cli(env, ['stop']);
      assert.strictEqual(stop.parsed.status, 'stopping');
      // Server actually exits: health checks fail shortly after.
      let gone = false;
      for (let i = 0; i < 30 && !gone; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        gone = await request(port, 'GET', '/health').then(() => false).catch(() => true);
      }
      assert.ok(gone, 'server should stop listening after stop');
      const after = cli(env, []);
      assert.strictEqual(after.parsed.server, 'not running');
    });
  } finally {
    // Belt and braces: never leave a server running even if a test failed.
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
