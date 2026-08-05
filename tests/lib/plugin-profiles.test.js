/**
 * Tests for scripts/lib/plugin-profiles.js
 *
 * Run with: node tests/lib/plugin-profiles.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { test, banner } = require('./helpers/mini-test-runner');
const {
  CATALOG_SKILL_ID,
  classifyModulePath,
  parseFrontmatter,
  estimatePlanCatalogTokens,
  resolvePluginProfilePlan,
  generateProfilePlugin,
  writeMarketplaceManifest,
} = require('../../scripts/lib/plugin-profiles');

const repoRoot = path.resolve(__dirname, '../..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

let passed = 0;
let failed = 0;

function run(name, fn) {
  if (test(name, fn)) passed++;
  else failed++;
}

banner('Testing plugin-profiles.js');

run('classifyModulePath maps plugin surfaces', () => {
  assert.strictEqual(classifyModulePath('skills/react-patterns').surface, 'skills');
  assert.strictEqual(classifyModulePath('skills').surface, 'skills');
  assert.strictEqual(classifyModulePath('agents').surface, 'agents');
  assert.strictEqual(classifyModulePath('commands').surface, 'commands');
  assert.strictEqual(classifyModulePath('hooks').surface, 'runtime');
  assert.strictEqual(classifyModulePath('scripts/hooks').surface, 'runtime');
  assert.strictEqual(classifyModulePath('scripts/harness-audit.js').surface, 'runtime');
});

run('classifyModulePath skips installer-only surfaces', () => {
  assert.strictEqual(classifyModulePath('rules').surface, 'skipped');
  assert.strictEqual(classifyModulePath('.agents').surface, 'skipped');
  assert.strictEqual(classifyModulePath('AGENTS.md').surface, 'skipped');
  assert.strictEqual(classifyModulePath('.claude-plugin').surface, 'skipped');
});

run('parseFrontmatter extracts description', () => {
  const { raw, description } = parseFrontmatter('---\nname: x\ndescription: Hello world\n---\n\n# Body');
  assert.ok(raw.startsWith('---'));
  assert.strictEqual(description, 'Hello world');
});

run('minimal profile plan resolves a real plugin surface', () => {
  const plan = resolvePluginProfilePlan({ repoRoot, profileId: 'minimal' });
  assert.strictEqual(plan.pluginName, 'ecc-minimal');
  assert.strictEqual(plan.version, rootPackage.version);
  assert.ok(plan.skills.length > 0, 'Expected workflow-quality skills');
  assert.ok(plan.agents.length > 0, 'Expected agents-core agent files');
  assert.ok(plan.commands.length > 0, 'Expected commands-core command files');
  assert.ok(plan.skippedPaths.includes('rules'), 'Expected rules to be skipped');
  assert.strictEqual(plan.warnings.length, 0, `Unexpected warnings: ${plan.warnings.join('; ')}`);
});

run('developer profile includes framework-language skills and hook runtime', () => {
  const plan = resolvePluginProfilePlan({ repoRoot, profileId: 'developer' });
  assert.ok(plan.skills.includes('coding-standards'), 'Expected coding-standards skill');
  assert.ok(plan.runtimePaths.includes('hooks'), 'Expected hooks runtime path');
  assert.ok(plan.runtimePaths.includes('scripts/hooks'), 'Expected scripts/hooks runtime path');
});

run('includeHooks: false drops hook runtime paths', () => {
  const plan = resolvePluginProfilePlan({ repoRoot, profileId: 'developer', includeHooks: false });
  assert.ok(!plan.runtimePaths.includes('hooks'), 'hooks should be dropped');
  assert.ok(!plan.runtimePaths.includes('scripts/hooks'), 'scripts/hooks should be dropped');
});

run('component selection composes with modules', () => {
  const plan = resolvePluginProfilePlan({
    repoRoot,
    moduleIds: ['commands-core'],
    includeComponentIds: ['skill:coding-standards'],
  });
  // skill:* components resolve through their owning module(s) plus module
  // dependencies, so the selection includes those surfaces too.
  assert.ok(plan.skills.includes('coding-standards'), 'Expected coding-standards skill');
  assert.ok(plan.commands.length > 0, 'Expected commands from commands-core');
  assert.ok(plan.selectedModuleIds.includes('commands-core'), 'Expected commands-core module');
});

run('invalid plugin name throws', () => {
  assert.throws(
    () => resolvePluginProfilePlan({ repoRoot, profileId: 'minimal', pluginName: 'Bad Name' }),
    /Invalid plugin name/
  );
});

run('slim profile catalog tokens are far below the full catalog', () => {
  const minimalPlan = resolvePluginProfilePlan({ repoRoot, profileId: 'minimal' });
  const fullPlan = resolvePluginProfilePlan({ repoRoot, profileId: 'full' });
  const minimalTokens = estimatePlanCatalogTokens(minimalPlan);
  const fullTokens = estimatePlanCatalogTokens(fullPlan);
  assert.ok(minimalTokens > 0, 'Expected nonzero minimal estimate');
  assert.ok(minimalTokens < fullTokens / 2, `Expected minimal (${minimalTokens}) well below full (${fullTokens})`);
});

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-plugin-profiles-'));
try {
  const generationPlan = resolvePluginProfilePlan({
    repoRoot,
    moduleIds: ['commands-core'],
    includeComponentIds: ['skill:coding-standards'],
    pluginName: 'ecc-test-profile',
  });
  const result = generateProfilePlugin({ plan: generationPlan, outRoot: tempRoot });

  run('generateProfilePlugin writes the plugin surface', () => {
    assert.ok(fs.existsSync(path.join(result.pluginRoot, 'skills', 'coding-standards', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(result.pluginRoot, 'commands')));
    assert.ok(fs.existsSync(path.join(result.pluginRoot, 'scripts', 'harness-audit.js')), 'Expected commands-core runtime script');
  });

  run('generated plugin.json follows Claude validator rules', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(result.pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(manifest.name, 'ecc-test-profile');
    assert.strictEqual(manifest.version, rootPackage.version);
    assert.ok(!('agents' in manifest), 'agents field must not be declared');
    assert.ok(!('hooks' in manifest), 'hooks field must not be declared');
    assert.deepStrictEqual(manifest.mcpServers, {}, 'mcpServers must be explicitly empty');
    assert.deepStrictEqual(manifest.skills, ['./skills/']);
    assert.deepStrictEqual(manifest.commands, ['./commands/']);
  });

  run('catalog escape-hatch skill indexes the full catalog', () => {
    const catalogPath = path.join(result.pluginRoot, 'skills', CATALOG_SKILL_ID, 'SKILL.md');
    assert.ok(fs.existsSync(catalogPath), 'Expected generated ecc-catalog skill');
    const source = fs.readFileSync(catalogPath, 'utf8');
    const { description } = parseFrontmatter(source);
    assert.ok(description.length > 0, 'Expected catalog skill description');
    assert.ok(source.includes('| coding-standards | installed |'), 'Installed skill should be marked');
    assert.ok(source.includes('| on demand |'), 'Uninstalled skills should be listed on demand');
    assert.ok(result.catalogSkillCount > 100, `Expected full catalog index, got ${result.catalogSkillCount}`);
  });

  run('writeMarketplaceManifest lists generated plugins', () => {
    const { marketplace, manifestPath } = writeMarketplaceManifest({ outRoot: tempRoot, repoRoot });
    assert.ok(fs.existsSync(manifestPath));
    assert.strictEqual(marketplace.plugins.length, 1);
    assert.strictEqual(marketplace.plugins[0].name, 'ecc-test-profile');
    assert.strictEqual(marketplace.plugins[0].source, './ecc-test-profile');
    assert.strictEqual(marketplace.plugins[0].version, rootPackage.version);
  });

  run('--no-catalog generation omits the catalog skill', () => {
    const bare = generateProfilePlugin({ plan: generationPlan, outRoot: tempRoot, includeCatalogSkill: false });
    assert.ok(!fs.existsSync(path.join(bare.pluginRoot, 'skills', CATALOG_SKILL_ID)), 'Catalog skill should be absent');
    assert.strictEqual(bare.catalogSkillCount, 0);
  });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
