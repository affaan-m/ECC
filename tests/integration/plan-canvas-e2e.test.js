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
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', 'scripts', 'plan-canvas.js');
const HOOK = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'plan-canvas-sessions.js');

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
