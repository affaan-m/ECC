#!/usr/bin/env node
/**
 * Tests for the Codex adapter scripts under targets/codex/.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const buildAgents = path.join(repoRoot, 'targets', 'codex', 'build-agents-md.sh');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`);
    failed += 1;
  }
}

test('build-agents-md emits global body plus rules index', () => {
  const res = spawnSync('bash', [buildAgents, '~/.codex/instructions', 'common', 'python'], {
    encoding: 'utf8'
  });
  assert.strictEqual(res.status, 0, res.stderr);
  const globalMd = fs.readFileSync(
    path.join(repoRoot, 'content', 'instructions', 'global.md'), 'utf8');
  const firstLine = globalMd.split('\n').find((l) => l.trim().length > 0);
  assert.ok(res.stdout.includes(firstLine), 'global.md body must be included');
  assert.ok(res.stdout.includes('## Rules Index'), 'index heading missing');
  assert.ok(res.stdout.includes('~/.codex/instructions/coding-style.md'),
    'common rule entry missing');
  assert.ok(res.stdout.includes('~/.codex/instructions/python-coding-style.md'),
    'python rule entry missing');
  assert.ok(!res.stdout.includes('instructions/node-coding-style.md'),
    'unselected language must not appear');
});

const os = require('os');
const mergeMcp = path.join(repoRoot, 'targets', 'codex', 'merge-mcp.py');
const hasUv = spawnSync('uv', ['--version'], { encoding: 'utf8' }).status === 0;

function runMerge(configText, extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-'));
  const config = path.join(dir, 'config.toml');
  if (configText !== null) fs.writeFileSync(config, configText);
  const servers = path.join(repoRoot, 'content', 'mcp', 'servers.json');
  const res = spawnSync(
    'uv',
    ['run', '--with', 'tomlkit', 'python3', mergeMcp,
      '--config', config, '--servers', servers, ...extraArgs],
    { encoding: 'utf8' }
  );
  return { res, dir, config };
}

if (!hasUv) {
  console.log('  SKIP  merge-mcp tests (uv not available)');
} else {
  test('merge-mcp adds servers to a fresh config', () => {
    const { res, config } = runMerge(null);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = fs.readFileSync(config, 'utf8');
    assert.ok(out.includes('[mcp_servers.chrome-devtools]'));
    assert.ok(out.includes('command = "npx"'));
    assert.ok(!out.includes('description'), 'description key must be dropped');
  });

  test('merge-mcp preserves user keys and existing servers, and backs up', () => {
    const user = 'model = "gpt-5.6-sol"\n\n[mcp_servers.custom]\ncommand = "mytool"\n';
    const { res, dir, config } = runMerge(user);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = fs.readFileSync(config, 'utf8');
    assert.ok(out.includes('model = "gpt-5.6-sol"'), 'user key lost');
    assert.ok(out.includes('[mcp_servers.custom]'), 'user server lost');
    assert.ok(out.includes('[mcp_servers.chrome-devtools]'), 'new server missing');
    const backups = fs.readdirSync(dir).filter((f) => f.includes('.bak.'));
    assert.strictEqual(backups.length, 1, 'expected exactly one backup');
  });

  test('merge-mcp is idempotent (second run skips, no new backup)', () => {
    const { res, dir, config } = runMerge(null);
    assert.strictEqual(res.status, 0, res.stderr);
    const before = fs.readFileSync(config, 'utf8');
    const servers = path.join(repoRoot, 'content', 'mcp', 'servers.json');
    const res2 = spawnSync(
      'uv',
      ['run', '--with', 'tomlkit', 'python3', mergeMcp,
        '--config', config, '--servers', servers],
      { encoding: 'utf8' }
    );
    assert.strictEqual(res2.status, 0, res2.stderr);
    assert.ok(res2.stdout.includes('SKIP'), 'expected SKIP on second run');
    assert.strictEqual(fs.readFileSync(config, 'utf8'), before, 'file changed on no-op run');
    const backups = fs.readdirSync(dir).filter((f) => f.includes('.bak.'));
    assert.strictEqual(backups.length, 0, 'fresh + no-op runs must not create a backup');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
