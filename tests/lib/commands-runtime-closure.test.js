/**
 * Tests that commands-core ships everything its entry scripts need.
 *
 * commands-core lists scripts/harness-audit.js, scripts/plugin-profiles.js
 * and scripts/skills-health.js, but their require() closure lives under
 * scripts/lib, which only hooks-runtime carried. Any target that installed
 * commands-core without hooks-runtime — the `opencode` profile, for one —
 * got three slash commands that die with MODULE_NOT_FOUND.
 *
 * Run with: node tests/lib/commands-runtime-closure.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { test, banner } = require('./helpers/mini-test-runner');
const { resolveInstallPlan } = require('../../scripts/lib/install-manifests');
const { resolveScriptClosure } = require('../../scripts/lib/plugin-profiles');

const repoRoot = path.resolve(__dirname, '../..');
const COMMAND_ENTRY_SCRIPTS = [
  'scripts/harness-audit.js',
  'scripts/plugin-profiles.js',
  'scripts/skills-health.js',
];

let passed = 0;
let failed = 0;

function run(name, fn) {
  if (test(name, fn)) passed++;
  else failed++;
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Every repo-relative path a module selection installs.
 *
 * @param {object} selection resolveInstallPlan options.
 * @returns {Set<string>} POSIX paths.
 */
function selectedPaths(selection) {
  const plan = resolveInstallPlan({ repoRoot, ...selection });
  const paths = new Set();
  for (const module of plan.selectedModules) {
    for (const relPath of module.paths || []) {
      paths.add(relPath.split(path.sep).join('/').replace(/\/+$/, ''));
    }
  }
  return paths;
}

function isCovered(paths, target) {
  return [...paths].some(candidate => candidate === target || target.startsWith(`${candidate}/`));
}

banner('Testing commands-core runtime closure');

run('commands-core pulls in commands-runtime as a dependency', () => {
  const plan = resolveInstallPlan({ repoRoot, moduleIds: ['commands-core'] });
  assert.ok(
    plan.selectedModuleIds.includes('commands-runtime'),
    `expected commands-runtime, got ${plan.selectedModuleIds.join(', ')}`
  );
});

run('selecting commands-core without hooks-runtime still covers the whole require closure', () => {
  const paths = selectedPaths({ moduleIds: ['commands-core'] });
  assert.ok(!paths.has('scripts/hooks'), 'this selection must not drag in the hook runtime');

  const closure = resolveScriptClosure(COMMAND_ENTRY_SCRIPTS, repoRoot);
  assert.deepStrictEqual(closure.unresolved, [], 'the closure itself must resolve in the repo');

  const missing = closure.files.filter(file => !isCovered(paths, file));
  assert.deepStrictEqual(missing, [], `commands-core does not ship: ${missing.join(', ')}`);
});

run('the manifests the CLI reads at runtime are shipped too', () => {
  const paths = selectedPaths({ moduleIds: ['commands-core'] });
  assert.ok(isCovered(paths, 'manifests/install-profiles.json'), 'plugin-profiles.js reads the install manifests');
});

run('every install profile that ships commands-core also ships its closure', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifests', 'install-profiles.json'), 'utf8'));
  const closure = resolveScriptClosure(COMMAND_ENTRY_SCRIPTS, repoRoot);
  for (const profileId of Object.keys(manifest.profiles)) {
    const paths = selectedPaths({ profileId });
    if (!isCovered(paths, 'commands')) {
      continue;
    }
    const missing = closure.files.filter(file => !isCovered(paths, file));
    assert.deepStrictEqual(missing, [], `profile ${profileId} ships commands but not: ${missing.join(', ')}`);
  }
});

run('a real opencode install can run all three command entry points', () => {
  const home = tempDir('ecc-a6-install-');
  try {
    const install = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'install-apply.js'), '--target', 'claude-project', '--profile', 'opencode'],
      { cwd: home, encoding: 'utf8', timeout: 180000 }
    );
    assert.strictEqual(install.status, 0, `install failed: ${install.stderr}`);

    const installed = path.join(home, '.claude');
    assert.ok(
      fs.existsSync(path.join(installed, 'scripts', 'lib', 'skill-evolution', 'health.js')),
      'the closure must land on disk, not just in the plan'
    );

    for (const [script, ...args] of [
      ['scripts/skills-health.js', '--help'],
      ['scripts/plugin-profiles.js', 'list'],
      ['scripts/harness-audit.js', '--help'],
    ]) {
      const result = spawnSync(process.execPath, [script, ...args], {
        cwd: installed,
        encoding: 'utf8',
        timeout: 60000,
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: installed },
      });
      assert.strictEqual(result.status, 0, `${script} failed in an opencode install: ${result.stderr}`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
