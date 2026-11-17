'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createManifestInstallPlan } = require('../../scripts/lib/install/plan');
const { applyInstallPlan } = require('../../scripts/lib/install/apply');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agy-native-'));
const loaderHome = path.join(root, 'loader-home');
fs.mkdirSync(loaderHome);
// Only pass filesystem locations owned by this test; never inherit authentication.
const env = {
  PATH: process.env.PATH,
  HOME: loaderHome,
  USERPROFILE: loaderHome,
  XDG_CONFIG_HOME: path.join(loaderHome, '.config'),
  XDG_DATA_HOME: path.join(loaderHome, '.local', 'share'),
  XDG_CACHE_HOME: path.join(loaderHome, '.cache'),
  ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, APPDATA: loaderHome, LOCALAPPDATA: loaderHome } : {}),
};

function agy(args) {
  return spawnSync('agy', args, { env, cwd: root, encoding: 'utf8', timeout: 15000 });
}

function checked(args) {
  const result = agy(args);
  assert.strictEqual(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return result.stdout;
}

try {
  const version = agy(['--version']);
  if (version.error?.code === 'ENOENT' || (version.status === 0 && version.stdout.trim() !== '1.3.5')) {
    console.log(`SKIP: native plugin validation requires installed agy 1.3.5 (found ${version.stdout?.trim() || 'none'}); no download attempted.`);
    console.log('Results: Passed: 0, Failed: 0');
  } else {
    assert.strictEqual(version.status, 0, version.error?.message || version.stderr);
    const plan = withHookConsent(createManifestInstallPlan({
      sourceRoot: path.resolve(__dirname, '../..'),
      profileId: 'core',
      target: 'antigravity-home',
      projectRoot: path.join(root, 'workspace'),
      homeDir: path.join(root, 'install-home'),
    }), 'enabled');
    applyInstallPlan(plan);
    assert.ok(fs.existsSync(path.join(plan.targetRoot, 'plugin.json')));
    const validation = checked(['plugin', 'validate', plan.targetRoot]);
    assert.match(validation, /\[ok\]/);
    checked(['plugin', 'install', plan.targetRoot]);
    const listed = JSON.parse(checked(['plugin', 'list', '--json']));
    const plugin = listed.find(entry => entry.name === 'ecc');
    assert.ok(plugin, 'Native CLI must discover ECC after explicit local import');
    assert.ok(plugin.hooks.includes('ecc-guard'), 'Native importer must register lifecycle hooks');
    assert.ok(plugin.mcpServers.includes('ecc-memory'), 'Native importer must register ECC memory');
    console.log('PASS: agy 1.3.5 validates and imports the generated ECC plugin in a disposable HOME.');
    console.log('NOT CHECKED: authenticated tool execution, Stop execution, and automatic IDE discovery.');
    console.log('Results: Passed: 1, Failed: 0');
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
