'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { getInstallTargetAdapter } = require('../../scripts/lib/install-targets/registry');
const { resolveClaudePaths } = require('../../scripts/lib/install/inventory');
const { resolveEccRoot } = require('../../scripts/lib/resolve-ecc-root');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-tilde-regression-'));
const home = path.join(root, 'home');
const project = path.join(root, 'project');
fs.mkdirSync(home); fs.mkdirSync(project);
let passed = 0; let failed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
try {
  const adapter = getInstallTargetAdapter('claude');
  for (const [configured, relative] of [['~', ''], ['~/profile', 'profile'], ['~\\profile', 'profile'], ['  ~/profile  ', 'profile'], ['   ', '.claude']]) {
    const expected = path.join(home, relative);
    test(`installer resolves ${JSON.stringify(configured)} against explicit home`, () => {
      assert.strictEqual(adapter.resolveRoot({ homeDir: home, projectRoot: project, env: { CLAUDE_CONFIG_DIR: configured } }), expected);
    });
    test(`inventory resolves ${JSON.stringify(configured)} against explicit home`, () => {
      assert.strictEqual(resolveClaudePaths({ homeDir: home, projectRoot: project, configDir: configured }).configDir, expected);
    });
  }
  test('actual install from separate cwd is loadable through the runtime resolver', () => {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/install-apply.js'), '--target', 'claude', 'typescript', '--no-hooks'], {
      cwd: project,
      env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: '~/profile', CLAUDE_RULES_DIR: '', CLAUDE_PLUGIN_ROOT: '' },
      encoding: 'utf8', timeout: 30000,
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(fs.existsSync(path.join(project, '~')), false, 'install must not create cwd/~/profile');
    const runtimeRoot = resolveEccRoot({ envRoot: '', homeDir: home, configDir: '~/profile', probe: 'scripts/lib/utils.js' });
    assert.strictEqual(runtimeRoot, path.join(home, 'profile'));
    assert.strictEqual(resolveClaudePaths({ homeDir: home, projectRoot: project, configDir: '~/profile' }).configDir, runtimeRoot);
    const modulePath = path.join(runtimeRoot, 'scripts/lib/utils.js');
    assert.ok(fs.existsSync(modulePath), 'installed runtime module must exist');
    assert.strictEqual(typeof require(modulePath), 'object');
  });
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log(`Passed: ${passed}`); console.log(`Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
