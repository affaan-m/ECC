#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { resolveInstallPlan } = require('../../scripts/lib/install-manifests');

const ROOT = path.resolve(__dirname, '../..');
const CANONICAL = path.join(ROOT, 'skills', 'docs-governance');
const CODEX_MIRROR = path.join(ROOT, '.agents', 'skills', 'docs-governance');
const MIRRORED_FILES = [
  'SKILL.md',
  'references/artifact-role-contract.md',
  'scripts/audit-docs.py',
  'scripts/markdown_links.py',
];
const ROUTED_SKILLS = [
  'ai-regression-testing',
  'architecture-decision-records',
  'living-docs-governance',
  'loop-design-check',
];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    failed += 1;
  }
}

console.log('\n=== Documentation governance surface tests ===\n');

test('Codex distribution files match the canonical skill', () => {
  for (const relativePath of MIRRORED_FILES) {
    const canonical = fs.readFileSync(path.join(CANONICAL, relativePath), 'utf8');
    const mirror = fs.readFileSync(path.join(CODEX_MIRROR, relativePath), 'utf8');
    assert.strictEqual(mirror, canonical, `${relativePath} mirror is stale`);
  }
});

test('router destinations exist on current main', () => {
  for (const skill of ROUTED_SKILLS) {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'skills', skill, 'SKILL.md')),
      `docs-governance routes to missing skill: ${skill}`
    );
  }
});

test('focused surface excludes mutating archive and pre-commit tools', () => {
  assert.ok(!fs.existsSync(path.join(CANONICAL, 'scripts', 'project-log-index.py')));
  assert.ok(!fs.existsSync(path.join(CANONICAL, 'templates', 'pre-commit.example')));
});

test('opt-in install includes every routed skill owner', () => {
  const plan = resolveInstallPlan({
    repoRoot: ROOT,
    profileId: 'minimal',
    includeComponentIds: ['capability:documentation-governance'],
    target: 'codex',
  });
  const installedPaths = new Set(plan.selectedModules.flatMap((module) => module.paths));
  for (const skill of ROUTED_SKILLS) {
    assert.ok(installedPaths.has(`skills/${skill}`), `install plan omits routed skill: ${skill}`);
  }
  assert.ok(installedPaths.has('skills/docs-governance'));
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}\n`);

process.exitCode = failed === 0 ? 0 : 1;
