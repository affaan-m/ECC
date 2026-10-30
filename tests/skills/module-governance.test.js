#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { listInstallComponents, resolveInstallPlan } = require('../../scripts/lib/install-manifests');
const { createManifestInstallPlan } = require('../../scripts/lib/install-executor');

const ROOT = path.resolve(__dirname, '../..');
const OWNERS = [
  'module-governance', 'context-and-decisions', 'architecture-decision-records',
  'contract-first', 'change-impact', 'living-docs-governance', 'docs-governance',
];
let passed = 0;
let failed = 0;
function test(name, run) {
  try {
    run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

for (const target of ['claude', 'codex']) {
  test(`opt-in ${target} installation includes every delegated knowledge owner`, () => {
    const plan = resolveInstallPlan({
      repoRoot: ROOT, profileId: 'minimal',
      includeComponentIds: ['capability:module-governance'], target,
    });
    const paths = new Set(plan.selectedModules.flatMap(module => module.paths));
    for (const owner of OWNERS) {
      assert.ok(paths.has(`skills/${owner}`), `missing ${owner}`);
    }
  });
}

for (const target of ['claude', 'claude-project', 'cursor', 'antigravity', 'codex',
  'opencode', 'codebuddy', 'joycode', 'qwen', 'zed']) {
  test(`advertised ${target} capability produces copies of every delegated owner`, () => {
    assert.ok(listInstallComponents({ repoRoot: ROOT, target }).some(
      component => component.id === 'capability:module-governance'
    ));
    const plan = createManifestInstallPlan({
      sourceRoot: ROOT, target, homeDir: '/private/tmp/ecc-module-plan-preview',
      projectRoot: '/private/tmp/ecc-module-plan-preview', profileId: 'minimal',
      includeComponentIds: ['capability:module-governance'],
      // This checks skill-copy planning; installer tests validate the compiled payload.
      exemptValidationCodes: ['opencode-plugin-not-built'],
    });
    for (const owner of OWNERS) {
      assert.ok(plan.operations.some(operation => operation.kind === 'copy-file'
        && operation.sourceRelativePath.replace(/\\/g, '/').endsWith(`skills/${owner}/SKILL.md`)),
      `missing ${owner} copy on ${target}`);
    }
  });
}

for (const target of ['hermes', 'openclaw', 'kimi', 'adal', 'copilot']) {
  test(`does not advertise the incomplete ${target} dependency closure`, () => {
    assert.ok(!listInstallComponents({ repoRoot: ROOT, target }).some(
      component => component.id === 'capability:module-governance'
    ), `module governance is not installable on ${target}`);
    const plan = createManifestInstallPlan({
      sourceRoot: ROOT, target, homeDir: '/private/tmp/ecc-module-plan-preview',
      projectRoot: '/private/tmp/ecc-module-plan-preview', profileId: 'minimal',
      includeComponentIds: ['capability:module-governance'],
    });
    assert.ok(plan.skippedModuleIds.includes('documentation-module-governance'));
    assert.ok(!plan.selectedModuleIds.includes('documentation-module-governance'));
    // agents-core may copy Codex metadata; that is not this capability's installation.
    assert.ok(!plan.operations.some(operation => operation.moduleId
      === 'documentation-module-governance'));
  });
}

test('Codex module workflow is the canonical implementation', () => {
  assert.strictEqual(
    fs.readFileSync(path.join(ROOT, 'skills/module-governance/SKILL.md'), 'utf8'),
    fs.readFileSync(path.join(ROOT, '.agents/skills/module-governance/SKILL.md'), 'utf8')
  );
});

test('standalone Pi carries the workflow and its delegated knowledge owners', () => {
  for (const owner of OWNERS) {
    assert.ok(fs.existsSync(path.join(ROOT, `pi/core/skills/${owner}/SKILL.md`)), owner);
  }
});

console.log(`\nPassed: ${passed}\nFailed: ${failed}`);
process.exitCode = failed ? 1 : 0;
