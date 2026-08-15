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
  resolveScriptClosure,
  isGeneratedProfilePlugin,
  PROFILE_METADATA_FILE,
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

  run('generateProfilePlugin writes skill-router profile metadata', () => {
    const metadata = JSON.parse(fs.readFileSync(path.join(result.pluginRoot, 'ecc-profile.json'), 'utf8'));
    assert.strictEqual(path.resolve(metadata.sourceRoot), repoRoot, 'sourceRoot must point at the generating repo');
    assert.strictEqual(metadata.version, rootPackage.version);
    assert.strictEqual(metadata.generatedFrom, 'everything-claude-code');
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
    const { marketplace, manifestPath } = writeMarketplaceManifest({ outRoot: tempRoot });
    assert.ok(fs.existsSync(manifestPath));
    assert.strictEqual(marketplace.plugins.length, 1);
    assert.strictEqual(marketplace.plugins[0].name, 'ecc-test-profile');
    assert.strictEqual(marketplace.plugins[0].source, './ecc-test-profile');
    assert.strictEqual(marketplace.plugins[0].version, rootPackage.version);
    assert.ok(/generated/i.test(marketplace.owner.name), 'Owner must identify the marketplace as generated, not upstream');
  });

  run('--no-catalog generation omits the catalog skill', () => {
    const bare = generateProfilePlugin({ plan: generationPlan, outRoot: tempRoot, includeCatalogSkill: false });
    assert.ok(!fs.existsSync(path.join(bare.pluginRoot, 'skills', CATALOG_SKILL_ID)), 'Catalog skill should be absent');
    assert.strictEqual(bare.catalogSkillCount, 0);
  });

  run('runtime-only plan omits empty skills/commands manifest keys', () => {
    const runtimePlan = resolvePluginProfilePlan({
      repoRoot,
      moduleIds: ['hooks-runtime'],
      pluginName: 'ecc-test-runtime',
    });
    assert.strictEqual(runtimePlan.commands.length, 0, 'hooks-runtime should resolve zero commands');
    assert.strictEqual(runtimePlan.skills.length, 0, 'hooks-runtime should resolve zero skills');

    const withCatalog = generateProfilePlugin({ plan: runtimePlan, outRoot: tempRoot });
    assert.ok(!('commands' in withCatalog.manifest), 'commands key must be omitted with zero commands');
    assert.deepStrictEqual(withCatalog.manifest.skills, ['./skills/'], 'catalog skill alone still declares skills');
    assert.ok(!fs.existsSync(path.join(withCatalog.pluginRoot, 'commands')), 'commands directory must not exist');

    const bare = generateProfilePlugin({ plan: runtimePlan, outRoot: tempRoot, includeCatalogSkill: false });
    assert.ok(!('skills' in bare.manifest), 'skills key must be omitted with zero skills and no catalog');
    assert.ok(!('commands' in bare.manifest), 'commands key must be omitted with zero commands');
    assert.ok(!fs.existsSync(path.join(bare.pluginRoot, 'skills')), 'skills directory must not exist');
  });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

// --- frontmatter block scalars -------------------------------------------
// 16 catalog skills declare `description: >-`; reading only the key's own
// line yields the literal indicator and makes those skills unroutable.

run('parseFrontmatter reads a folded (>-) block scalar', () => {
  const { description } = parseFrontmatter(
    '---\nname: demo\ndescription: >-\n  First line of the description\n  continued on a second line.\ntools: Read\n---\n\n# Demo\n'
  );
  assert.strictEqual(description, 'First line of the description continued on a second line.');
});

run('parseFrontmatter reads a literal (|) block scalar', () => {
  const { description } = parseFrontmatter(
    '---\ndescription: |\n  Line one\n  Line two\n---\n'
  );
  assert.strictEqual(description, 'Line one\nLine two');
});

run('parseFrontmatter stops a block scalar at the next top-level key', () => {
  const { description } = parseFrontmatter(
    '---\ndescription: >\n  Only this text belongs to the description.\nmodel: opus\ntools: Read\n---\n'
  );
  assert.strictEqual(description, 'Only this text belongs to the description.');
});

run('parseFrontmatter still handles inline and quoted scalars', () => {
  assert.strictEqual(parseFrontmatter('---\ndescription: Plain inline text\n---\n').description, 'Plain inline text');
  assert.strictEqual(parseFrontmatter('---\ndescription: "Quoted text"\n---\n').description, 'Quoted text');
});

run('every catalog skill resolves a usable description', () => {
  const skillsRoot = path.join(repoRoot, 'skills');
  const unresolved = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const { description } = parseFrontmatter(fs.readFileSync(skillPath, 'utf8'));
    if (!description || /^[>|][-+]?$/.test(description.trim())) {
      unresolved.push(entry.name);
    }
  }
  assert.deepStrictEqual(unresolved, [], `Skills with an unusable description: ${unresolved.join(', ')}`);
});

// --- command runtime closure ---------------------------------------------

run('resolveScriptClosure walks transitive relative requires', () => {
  const closure = resolveScriptClosure(['scripts/plugin-profiles.js'], repoRoot);
  assert.ok(closure.includes('scripts/plugin-profiles.js'), 'Entry point must be included');
  assert.ok(closure.includes('scripts/lib/plugin-profiles.js'), 'Direct require must be included');
  assert.ok(closure.includes('scripts/lib/install-manifests.js'), 'Transitive require must be included');
  assert.ok(
    closure.some(f => f.startsWith('scripts/lib/install-targets/')),
    'Deeper transitive requires must be included'
  );
  assert.ok(closure.every(f => !f.startsWith('..')), 'Closure must stay inside the repo');
});

run('resolveScriptClosure ignores unresolvable and bare specifiers', () => {
  assert.deepStrictEqual(resolveScriptClosure(['scripts/does-not-exist.js'], repoRoot), []);
  const closure = resolveScriptClosure(['scripts/plugin-profiles.js'], repoRoot);
  assert.ok(closure.every(f => f.endsWith('.js')), 'Only real files may appear');
});

// The `minimal` profile omits hooks-runtime, so it never receives
// `scripts/lib` — without the closure its /plugin-profiles command is dead.
run('a profile without hooks-runtime still ships a runnable /plugin-profiles', () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-profile-closure-'));
  try {
    const plan = resolvePluginProfilePlan({ repoRoot, profileId: 'minimal' });
    assert.ok(plan.commands.includes('plugin-profiles.md'), 'minimal ships the command file');
    assert.ok(
      !plan.runtimePaths.includes('scripts/lib'),
      'minimal must not pull all of scripts/lib -- that would defeat the closure test'
    );
    for (const required of ['scripts/plugin-profiles.js', 'scripts/lib/plugin-profiles.js', 'manifests']) {
      assert.ok(plan.runtimePaths.includes(required), `Plan must ship ${required}`);
    }

    const { pluginRoot } = generateProfilePlugin({ plan, outRoot });
    const { execFileSync } = require('child_process');
    const stdout = execFileSync(process.execPath, ['scripts/plugin-profiles.js', 'list'], {
      cwd: pluginRoot,
      encoding: 'utf8',
    });
    assert.match(stdout, /Available install profiles/, 'Shipped CLI must run from inside the generated plugin');
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

run('closure paths already covered by a parent runtime path are not duplicated', () => {
  const plan = resolvePluginProfilePlan({ repoRoot, profileId: 'core' });
  assert.ok(plan.runtimePaths.includes('scripts/lib'), 'core ships all of scripts/lib');
  assert.ok(
    !plan.runtimePaths.includes('scripts/lib/plugin-profiles.js'),
    'A file under an already-copied directory must not be listed separately'
  );
});

// --- destructive overwrite guard -----------------------------------------

run('generateProfilePlugin refuses to overwrite a directory it did not generate', () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-profile-guard-'));
  try {
    const victim = path.join(outRoot, 'ecc-minimal');
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(path.join(victim, 'important.txt'), 'DO NOT DELETE');

    const plan = resolvePluginProfilePlan({ repoRoot, profileId: 'minimal' });
    assert.throws(
      () => generateProfilePlugin({ plan, outRoot }),
      /Refusing to overwrite/,
      'Must refuse a directory with no generated-plugin marker'
    );
    assert.strictEqual(fs.readFileSync(path.join(victim, 'important.txt'), 'utf8'), 'DO NOT DELETE');
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

run('generateProfilePlugin replaces a plugin it generated earlier', () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-profile-regen-'));
  try {
    const plan = resolvePluginProfilePlan({ repoRoot, profileId: 'minimal' });
    const first = generateProfilePlugin({ plan, outRoot });
    assert.ok(isGeneratedProfilePlugin(first.pluginRoot), 'Generated plugin carries its marker');
    fs.writeFileSync(path.join(first.pluginRoot, 'stale.txt'), 'from the previous run');

    const second = generateProfilePlugin({ plan, outRoot });
    assert.ok(
      !fs.existsSync(path.join(second.pluginRoot, 'stale.txt')),
      'Regeneration must clear stale files from the previous run'
    );
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

run('generateProfilePlugin --force replaces a non-generated directory', () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-profile-force-'));
  try {
    const victim = path.join(outRoot, 'ecc-minimal');
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(path.join(victim, 'important.txt'), 'replaceable');

    const plan = resolvePluginProfilePlan({ repoRoot, profileId: 'minimal' });
    const result = generateProfilePlugin({ plan, outRoot, force: true });
    assert.ok(!fs.existsSync(path.join(victim, 'important.txt')), '--force replaces the directory');
    assert.ok(fs.existsSync(path.join(result.pluginRoot, PROFILE_METADATA_FILE)), 'Marker is written');
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

run('isGeneratedProfilePlugin rejects a lookalike marker', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-profile-lookalike-'));
  try {
    assert.strictEqual(isGeneratedProfilePlugin(dir), false, 'No marker at all');
    fs.writeFileSync(path.join(dir, PROFILE_METADATA_FILE), JSON.stringify({ generatedFrom: 'something-else' }));
    assert.strictEqual(isGeneratedProfilePlugin(dir), false, 'Wrong generatedFrom value');
    fs.writeFileSync(path.join(dir, PROFILE_METADATA_FILE), 'not json at all');
    assert.strictEqual(isGeneratedProfilePlugin(dir), false, 'Unparseable marker');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
