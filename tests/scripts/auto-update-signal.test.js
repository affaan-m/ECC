'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('auto-update stops after a Git subprocess is terminated by a signal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-update-signal-'));
  const originalSpawn = childProcess.spawnSync;
  const modulePath = require.resolve('../../scripts/auto-update');
  const calls = [];
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ecc-universal' }));
    fs.writeFileSync(path.join(root, 'scripts', 'install-apply.js'), '');
    // Keep the real update command/error handling. Only substitute the Git
    // subprocess with a real child that receives SIGTERM, without any network.
    childProcess.spawnSync = (command, args, options) => {
      calls.push([command, ...args]);
      if (command === 'git' && args[0] === 'fetch') {
        return originalSpawn(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'], options);
      }
      return { status: 0, stdout: '{}', stderr: '' };
    };
    delete require.cache[modulePath];
    const { runAutoUpdate } = require(modulePath);
    const record = {
      exists: true,
      adapter: { id: 'claude-home', target: 'claude', kind: 'home' },
      installStatePath: path.join(root, 'home', '.claude', 'ecc', 'install-state.json'),
      state: { target: { target: 'claude' }, request: { legacyLanguages: ['typescript'] } },
    };
    assert.throws(() => runAutoUpdate({ repoRoot: root, homeDir: path.join(root, 'home') }, {
      discoverInstalledStates: () => [record],
    }), /git fetch.*(?:SIGTERM|failed)/);
    assert.deepEqual(calls, [['git', 'fetch', '--all', '--prune']], 'pull and reinstall must not run after a terminated fetch');
  } finally {
    childProcess.spawnSync = originalSpawn;
    delete require.cache[modulePath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the auto-update CLI reports interrupted fetch, pull, and reinstall stages as failures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-update-cli-signal-'));
  const cli = path.resolve(__dirname, '../../scripts/auto-update.js');
  const lifecycle = require.resolve('../../scripts/lib/install-lifecycle');
  const logPath = path.join(root, 'calls.jsonl');
  const preload = path.join(root, 'subprocess-fixture.cjs');
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ecc-universal' }));
    fs.writeFileSync(path.join(root, 'scripts', 'install-apply.js'), '');
    const record = {
      exists: true,
      adapter: { id: 'claude-home', target: 'claude', kind: 'home' },
      installStatePath: path.join(root, 'home', '.claude', 'ecc', 'install-state.json'),
      state: { target: { target: 'claude' }, request: { legacyLanguages: ['typescript'] } },
    };
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      const childProcess = require('node:child_process');
      const originalSpawn = childProcess.spawnSync;
      require(${JSON.stringify(lifecycle)}).discoverInstalledStates = () => [${JSON.stringify(record)}];
      childProcess.spawnSync = (command, args, options) => {
        const stage = command === 'git' ? args[0] : 'install';
        fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(stage) + '\\n');
        if (stage === process.env.ECC_AUTO_UPDATE_TEST_SIGNAL_STAGE && process.env.ECC_AUTO_UPDATE_TEST_FAILURE === 'exit') {
          return originalSpawn(process.execPath, ['-e', 'process.stderr.write("update fixture failed"); process.exit(2)'], options);
        }
        if (stage === process.env.ECC_AUTO_UPDATE_TEST_SIGNAL_STAGE && process.env.ECC_AUTO_UPDATE_TEST_FAILURE === 'stdout') {
          return originalSpawn(process.execPath, ['-e', 'process.stdout.write("update fixture failed"); process.exit(2)'], options);
        }
        if (stage === process.env.ECC_AUTO_UPDATE_TEST_SIGNAL_STAGE && process.env.ECC_AUTO_UPDATE_TEST_FAILURE === 'spawn') {
          return originalSpawn(${JSON.stringify(path.join(root, 'missing-command'))}, [], options);
        }
        if (stage === process.env.ECC_AUTO_UPDATE_TEST_SIGNAL_STAGE) {
          return originalSpawn(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'], options);
        }
        return { status: 0, stdout: '{}', stderr: '' };
      };
    `);
    for (const [stage, failure, expectedCalls, dryRun = false] of [
      ['', '', ['fetch', 'pull', 'install']],
      ['fetch', 'signal', ['fetch']],
      ['pull', 'signal', ['fetch', 'pull']],
      ['install', 'signal', ['fetch', 'pull', 'install']],
      ['fetch', 'exit', ['fetch']],
      ['fetch', 'stdout', ['fetch']],
      ['install', 'exit', ['fetch', 'pull', 'install']],
      ['fetch', 'spawn', ['fetch']],
      ['install', 'spawn', ['fetch', 'pull', 'install']],
      ['', '', ['install'], true],
      ['install', 'signal', ['install'], true],
    ]) {
      fs.writeFileSync(logPath, '');
      const args = ['--require', preload, cli, '--repo-root', root, ...(dryRun ? ['--dry-run'] : [])];
      const result = childProcess.spawnSync(process.execPath, args, {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, ECC_AUTO_UPDATE_TEST_SIGNAL_STAGE: stage, ECC_AUTO_UPDATE_TEST_FAILURE: failure, ECC_DRY_RUN: '0' },
      });
      assert.ifError(result.error);
      assert.equal(result.status, stage ? 1 : 0, `${stage || 'success'}: ${result.stdout}${result.stderr}`);
      assert.deepEqual(fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse), expectedCalls);
      if (stage) {
        assert.match(result.stdout + result.stderr, /(?:terminated by SIGTERM|failed|ENOENT)/);
        assert.doesNotMatch(result.stdout, /Status: (?:UPDATED|PLANNED)/);
        if (failure === 'exit' || failure === 'stdout') {
          assert.match(result.stdout + result.stderr, /update fixture failed/);
        }
      } else {
        assert.match(result.stdout, dryRun ? /Status: PLANNED/ : /Status: UPDATED/);
      }
    }
    const jsonResult = childProcess.spawnSync(process.execPath, ['--require', preload, cli, '--repo-root', root, '--json'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ECC_AUTO_UPDATE_TEST_SIGNAL_STAGE: 'install', ECC_AUTO_UPDATE_TEST_FAILURE: 'signal', ECC_DRY_RUN: '0' },
    });
    assert.equal(jsonResult.status, 1, jsonResult.stderr);
    const payload = JSON.parse(jsonResult.stdout);
    assert.equal(payload.summary.updatedCount, 0);
    assert.equal(payload.summary.errorCount, 1);
    assert.equal(payload.results[0].status, 'error');
    assert.match(payload.results[0].error, /(?:SIGTERM|failed)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
