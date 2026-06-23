/**
 * Tests for scripts/github-coordination.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { createStateStore } = require('../../scripts/lib/state-store');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'github-coordination.js');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeGhShim(rootDir, responses) {
  const shimPath = path.join(rootDir, 'gh-shim.js');
  const logPath = path.join(rootDir, 'gh-calls.jsonl');
  fs.writeFileSync(
    shimPath,
    `
const fs = require('fs');
const responses = ${JSON.stringify(responses)};
const args = process.argv.slice(2);
const key = args.join(' ');
const logPath = process.env.ECC_GH_SHIM_LOG;
if (logPath) {
  fs.appendFileSync(logPath, JSON.stringify({ args }, null, 0) + '\\n');
}
if (Object.prototype.hasOwnProperty.call(responses, key)) {
  process.stdout.write(JSON.stringify(responses[key]));
  process.exit(0);
}
if (args[0] === 'issue' && (args[1] === 'edit' || args[1] === 'comment')) {
  process.stdout.write('{}');
  process.exit(0);
}
console.error('Unexpected gh args: ' + key);
process.exit(3);
`
  );
  return { shimPath, logPath };
}

function run(args = [], options = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || path.join(__dirname, '..', '..'),
    env: {
      ...process.env,
      ...(options.env || {})
    },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  });
}

function parseJson(stdout) {
  return JSON.parse(stdout.trim());
}

async function test(name, fn) {
  try {
    await fn();
    process.stdout.write(`  PASS ${name}\n`);
    return true;
  } catch (error) {
    process.stdout.write(`  FAIL ${name}\n`);
    process.stdout.write(`    Error: ${error.message}\n`);
    return false;
  }
}

async function readStore(dbPath) {
  const store = await createStateStore({ dbPath });
  try {
    return store.listWorkItems({ limit: 20 });
  } finally {
    store.close();
  }
}

async function runTests() {
  process.stdout.write('\n=== Testing github-coordination.js ===\n\n');

  let passed = 0;
  let failed = 0;

  if (
    await test('claims an epic issue, updates GitHub state, and caches a work item', async () => {
      const rootDir = createTempDir('github-coordination-claim-');
      const dbPath = path.join(rootDir, 'state.db');

      try {
        const epicBody = ['# Ship GitHub-native coordination', '', 'We want deterministic epic state.', '', '## Tasks', '- [ ] Claim the epic', '- [ ] Validate the epic'].join('\n');
        const issueView = {
          number: 12,
          title: 'Ship GitHub-native coordination',
          body: epicBody,
          url: 'https://github.com/affaan-m/ECC/issues/12',
          state: 'OPEN',
          labels: [{ name: 'epic' }],
          author: { login: 'maintainer' },
          updatedAt: '2026-06-01T12:00:00Z'
        };
        const shim = writeGhShim(rootDir, {
          'issue view 12 --repo affaan-m/ECC --json number,title,body,url,state,labels,author,updatedAt,assignees': issueView
        });

        const result = run(['claim', '12', '--repo', 'affaan-m/ECC', '--actor', 'codex', '--db', dbPath, '--json'], {
          cwd: rootDir,
          env: {
            ECC_GH_SHIM: shim.shimPath,
            ECC_GH_SHIM_LOG: shim.logPath
          }
        });
        assert.strictEqual(result.status, 0, result.stderr);
        const payload = parseJson(result.stdout);
        assert.strictEqual(payload.status, 'claimed');
        assert.strictEqual(payload.owner, 'codex');
        assert.strictEqual(payload.project.state, 'in-progress');

        const logEntries = fs
          .readFileSync(shim.logPath, 'utf8')
          .trim()
          .split(/\r?\n/)
          .map(line => JSON.parse(line));
        assert.ok(logEntries.some(entry => entry.args[0] === 'issue' && entry.args[1] === 'edit'));
        assert.ok(logEntries.some(entry => entry.args[0] === 'issue' && entry.args[1] === 'comment'));

        const stored = await readStore(dbPath);
        const epicItem = stored.items.find(item => item.source === 'github-epic');
        assert.ok(epicItem, 'expected github epic work item');
        assert.strictEqual(epicItem.status, 'in-progress');
        assert.strictEqual(epicItem.metadata.coordination.status, 'claimed');
        assert.strictEqual(epicItem.metadata.coordination.owner, 'codex');
      } finally {
        cleanup(rootDir);
      }
    })
  )
    passed++;
  else failed++;

  if (
    await test('unblocks an epic when dependencies are closed', async () => {
      const rootDir = createTempDir('github-coordination-unblock-');
      const dbPath = path.join(rootDir, 'state.db');

      try {
        const blockedBody = [
          '# Release readiness',
          '',
          'Dependencies: #2',
          '',
          '<!-- ecc-coordination:start -->',
          '```json',
          JSON.stringify(
            {
              schemaVersion: 'ecc.github.coordination.v1',
              kind: 'epic',
              status: 'blocked',
              owner: 'codex',
              branch: 'feat/release-readiness',
              validation: 'pending',
              review: 'requested',
              project: { state: 'blocked', fields: {} },
              dependencies: [2],
              tasks: [{ title: 'Check release checklist', done: false }],
              labels: ['epic', 'coordination:blocked'],
              lastAction: 'claim',
              lastActionAt: '2026-06-01T13:00:00Z',
              lastSyncAt: '2026-06-01T13:00:00Z',
              notes: null
            },
            null,
            2
          ),
          '```',
          '<!-- ecc-coordination:end -->'
        ].join('\n');
        const openIssue = {
          number: 1,
          title: 'Release readiness',
          body: blockedBody,
          url: 'https://github.com/affaan-m/ECC/issues/1',
          state: 'OPEN',
          labels: [{ name: 'epic' }, { name: 'coordination:blocked' }],
          author: { login: 'codex' },
          updatedAt: '2026-06-01T13:00:00Z'
        };
        const closedDependency = {
          number: 2,
          title: 'Release prerequisite',
          body: '# Release prerequisite',
          url: 'https://github.com/affaan-m/ECC/issues/2',
          state: 'CLOSED',
          labels: [{ name: 'blocked-by-release' }],
          author: { login: 'maintainer' },
          updatedAt: '2026-06-01T10:00:00Z'
        };
        const shim = writeGhShim(rootDir, {
          'issue list --repo affaan-m/ECC --state all --limit 100 --json number,title,body,url,state,labels,author,updatedAt,assignees': [openIssue, closedDependency],
          'issue view 1 --repo affaan-m/ECC --json number,title,body,url,state,labels,author,updatedAt,assignees': openIssue
        });

        const result = run(['unblock', '--repo', 'affaan-m/ECC', '--db', dbPath, '--json'], {
          cwd: rootDir,
          env: {
            ECC_GH_SHIM: shim.shimPath,
            ECC_GH_SHIM_LOG: shim.logPath
          }
        });
        assert.strictEqual(result.status, 0, result.stderr);
        const payload = parseJson(result.stdout);
        assert.strictEqual(payload.count, 1);
        assert.strictEqual(payload.items[0].status, 'ready');

        const logEntries = fs
          .readFileSync(shim.logPath, 'utf8')
          .trim()
          .split(/\r?\n/)
          .map(line => JSON.parse(line));
        assert.ok(logEntries.some(entry => entry.args[0] === 'issue' && entry.args[1] === 'edit'));
        assert.ok(logEntries.some(entry => entry.args[0] === 'issue' && entry.args[1] === 'comment'));

        const stored = await readStore(dbPath);
        const epicItem = stored.items.find(item => item.source === 'github-epic');
        assert.ok(epicItem, 'expected github epic work item');
        assert.strictEqual(epicItem.metadata.coordination.status, 'ready');
      } finally {
        cleanup(rootDir);
      }
    })
  )
    passed++;
  else failed++;

  process.stdout.write(`\nResults: Passed: ${passed}, Failed: ${failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error(error);
  process.exit(1);
});
