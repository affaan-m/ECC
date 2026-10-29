'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');

for (const entry of ['install-guided.js', 'install-apply.js', 'ecc.js']) {
  test(`global dry-run protects the actual ${entry} guided workflow`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-guided-global-preview-'));
    try {
      const home = path.join(root, 'home');
      const project = path.join(root, 'project');
      fs.mkdirSync(home);
      fs.mkdirSync(project);
      const args = entry === 'ecc.js' ? ['--dry-run', 'install', '--guided']
        : entry === 'install-apply.js' ? ['--guided'] : [];
      const child = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', entry),
        ...args, '--harness', 'kimi', '--profile', 'minimal', '--yes', '--json'], {
        cwd: project, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, HOME: home, USERPROFILE: home,
          CLAUDE_CONFIG_DIR: path.join(home, '.claude'), ECC_DRY_RUN: '1' },
      });
      assert.equal(child.status, 0, child.stderr);
      const payload = JSON.parse(child.stdout);
      assert.equal(payload.dryRun, true);
      assert.equal(payload.plan.request.dryRun, true);
      assert.deepEqual(fs.readdirSync(home), []);
      assert.deepEqual(fs.readdirSync(project), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('invalid global dry-run input is rejected before guided planning', () => {
  const child = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/install-guided.js'),
    '--harness', 'kimi', '--yes', '--json'], {
    encoding: 'utf8', env: { ...process.env, ECC_DRY_RUN: 'yes' },
  });
  assert.equal(child.status, 1);
  assert.match(JSON.parse(child.stderr).error.message, /ECC_DRY_RUN must be "1" or "0"/);
});
