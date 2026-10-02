/** Regression checks for the coordination CLI's local-state boundaries. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../../scripts/github-coordination.js');
const LIBRARY = path.resolve(__dirname, '../../scripts/lib/github-coordination.js');
const { createStateStore } = require('../../scripts/lib/state-store');

async function runTests() {
  let passed = 0;
  let failed = 0;
  async function test(name, fn) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-coordination-lifecycle-'));
    try {
      await fn(root);
      passed += 1;
      console.log(`  PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${name}: ${error.message}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  await test('dry-run preserves an existing database byte for byte', async root => {
    const dbPath = path.join(root, 'state.db');
    const store = await createStateStore({ dbPath });
    store.close();
    const before = fs.readFileSync(dbPath);
    // A migration write also changes file metadata even when the SQL is unchanged.
    const oldTime = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(dbPath, oldTime, oldTime);
    const shimPath = path.join(root, 'gh-shim.js');
    fs.writeFileSync(shimPath, "if(process.argv[2]!=='issue'||process.argv[3]!=='list')process.exit(3);process.stdout.write('[]');");
    const result = spawnSync(process.execPath, [SCRIPT, 'sync', '--repo', 'owner/repo', '--db', dbPath, '--dry-run', '--json'], {
      cwd: root,
      env: { ...process.env, ECC_GH_SHIM: shimPath },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).count, 0);
    assert.deepStrictEqual(fs.readFileSync(dbPath), before);
    assert.strictEqual(fs.statSync(dbPath).mtimeMs, oldTime.getTime(), 'dry-run must not rewrite the database');
  });

  await test('an action error closes the real store before exiting with failure', async root => {
    const marker = path.join(root, 'closed.txt');
    const probePath = path.join(root, 'probe.js');
    const shimPath = path.join(root, 'gh-error.js');
    fs.writeFileSync(shimPath, "process.stderr.write('fixture action read failed'); process.exit(3);");
    fs.writeFileSync(probePath, `
const fs = require('fs');
const lib = require(${JSON.stringify(LIBRARY)});
const open = lib.openStore;
lib.openStore = async options => {
  const store = await open(options);
  const close = store.close.bind(store);
  store.close = () => { close(); fs.writeFileSync(${JSON.stringify(marker)}, 'closed'); };
  return store;
};
require(${JSON.stringify(SCRIPT)}).main();
`);
    const result = spawnSync(process.execPath, [probePath, 'validate', '12', '--repo', 'owner/repo', '--db', path.join(root, 'state.db')], {
      cwd: root,
      env: { ...process.env, ECC_GH_SHIM: shimPath },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(result.status, 1, result.stderr);
    assert.match(result.stderr, /fixture action read failed/);
    assert.strictEqual(fs.existsSync(marker), true, 'the finally block must run');
  });

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  return { passed, failed };
}

if (require.main === module) {
  runTests().then(result => { process.exitCode = result.failed > 0 ? 1 : 0; });
}

module.exports = { runTests };
