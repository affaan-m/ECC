'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createManifestInstallPlan } = require('../../scripts/lib/install-executor');
const { applyInstallPlan } = require('../../scripts/lib/install/apply');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');

let failed = 0;
let passed = 0;

for (const [target, profile] of [['claude'], ['claude-project'], ['hermes'], ['cursor'], ['claude', 'core'], ['claude-project', 'core'], ['cursor', 'core']]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-health-install-'));
  try {
    const projectRoot = path.join(root, 'project');
    const homeDir = path.join(root, 'home');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });
    // Installed CommonJS scripts must also work inside an ESM consumer project.
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"type":"module"}\n');
    const plan = withHookConsent(createManifestInstallPlan({ target, projectRoot, homeDir,
      ...(profile ? { profileId: profile } : { moduleIds: ['commands-core'] }) }), 'declined');
    assert.ok(!plan.selectedModuleIds.includes('hooks-runtime'));
    applyInstallPlan(plan);
    assert.ok(!fs.existsSync(path.join(plan.targetRoot, 'scripts', 'hooks')));

    const script = path.join(plan.targetRoot, 'scripts', 'skills-health.js');
    const skillRoot = path.join(root, 'skills');
    fs.mkdirSync(path.join(skillRoot, 'example'), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'example', 'SKILL.md'), '# Example\n');
    for (const mode of [[], ['--dashboard']]) {
      const result = spawnSync(process.execPath, [script, '--json', '--home', homeDir,
        '--skills-root', skillRoot, '--runs-file', path.join(root, 'missing-runs.jsonl'), ...mode], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
      });
      assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
      assert.doesNotThrow(() => JSON.parse(result.stdout));
      assert.ok(result.stdout.includes('example'), 'installed report should discover supplied skills');
    }
    passed += 1;
    console.log(`  ✓ ${target} ${profile || 'commands-core'}: installed health and dashboard run without hook runtime`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${target}: ${error.message}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
