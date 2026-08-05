/**
 * Tests for scripts/lib/skill-router.js
 *
 * Run with: node tests/lib/skill-router.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the catalog cache before the lib is loaded so tests never touch
// the real ~/.claude/cache.
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-cache-'));
process.env.ECC_SKILL_ROUTER_CACHE_DIR = cacheDir;

const { test, banner } = require('./helpers/mini-test-runner');
const {
  PROFILE_METADATA_FILE,
  tokenize,
  resolveRouterContext,
  routePrompt,
} = require('../../scripts/lib/skill-router');

const repoRoot = path.resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function run(name, fn) {
  if (test(name, fn)) passed++;
  else failed++;
}

function writeSkill(rootDir, skillId, description) {
  const skillDir = path.join(rootDir, 'skills', skillId);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${skillId}\ndescription: ${description}\n---\n\n# ${skillId}\n`
  );
}

banner('Testing skill-router.js');

run('tokenize drops stopwords and short tokens, keeps domain words', () => {
  const tokens = tokenize('Please help me fix the failing database tests');
  assert.ok(!tokens.has('please') && !tokens.has('the'), 'Stopwords must be dropped');
  assert.ok(!tokens.has('me'), 'Short tokens must be dropped');
  assert.ok(tokens.has('database') && tokens.has('fix'), 'Domain words must survive');
});

run('tokenize adds singular forms for long plurals', () => {
  const tokens = tokenize('migrations');
  assert.ok(tokens.has('migrations') && tokens.has('migration'));
});

run('routePrompt requires pluginRoot', () => {
  assert.throws(() => routePrompt('anything'), /pluginRoot/);
});

run('routePrompt finds a matching skill in the real catalog', () => {
  const matches = routePrompt('apply react patterns when refactoring this component', {
    pluginRoot: repoRoot,
  });
  assert.ok(matches.length > 0, 'Expected at least one match');
  assert.ok(matches.some(m => m.id.includes('react')), `Expected a react skill, got ${matches.map(m => m.id).join(', ')}`);
  assert.ok(matches.every(m => m.installed), 'Full catalog root: every match is installed');
});

run('routePrompt returns nothing for unroutable prompts', () => {
  const matches = routePrompt('zzqx wvvk pfff', { pluginRoot: repoRoot });
  assert.deepStrictEqual(matches, []);
});

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-fixture-'));
try {
  writeSkill(fixtureRoot, 'coding-standards', 'Coding standards and conventions for this project');
  writeSkill(fixtureRoot, 'ecc-catalog', 'Index of the full ECC skill catalog for this slim profile plugin');
  fs.writeFileSync(
    path.join(fixtureRoot, PROFILE_METADATA_FILE),
    JSON.stringify({ profileId: 'test', sourceRoot: repoRoot.split(path.sep).join('/') })
  );

  run('resolveRouterContext follows ecc-profile.json to the source catalog', () => {
    const context = resolveRouterContext(fixtureRoot);
    assert.strictEqual(path.resolve(context.sourceRoot), repoRoot);
    assert.ok(context.installedIds.has('coding-standards'));
  });

  run('slim profile routes uninstalled skills as on-demand from the source root', () => {
    const matches = routePrompt('apply react patterns when refactoring this component', {
      pluginRoot: fixtureRoot,
    });
    assert.ok(matches.length > 0, 'Expected matches from the source catalog');
    const reactMatch = matches.find(m => m.id.includes('react'));
    assert.ok(reactMatch, 'Expected a react skill routed from source');
    assert.strictEqual(reactMatch.installed, false, 'react skill is not installed in the fixture profile');
    assert.strictEqual(path.resolve(reactMatch.sourceRoot), repoRoot);
  });

  run('ecc-catalog is never routed', () => {
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-bare-'));
    try {
      writeSkill(bareRoot, 'ecc-catalog', 'Index of the full ECC skill catalog for this slim profile plugin');
      const matches = routePrompt('show the full ecc skill catalog index', { pluginRoot: bareRoot });
      assert.ok(!matches.some(m => m.id === 'ecc-catalog'), 'ecc-catalog must be excluded from routing');
    } finally {
      fs.rmSync(bareRoot, { recursive: true, force: true });
    }
  });

  run('routing is deterministic across repeat calls (cache path)', () => {
    const first = routePrompt('apply react patterns when refactoring this component', { pluginRoot: fixtureRoot });
    const second = routePrompt('apply react patterns when refactoring this component', { pluginRoot: fixtureRoot });
    assert.deepStrictEqual(second, first);
  });

  run('a sourceRoot that is not an ECC checkout is rejected', () => {
    const impostorRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-impostor-'));
    const victimRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-victim-'));
    try {
      // Looks like a skills tree but lacks the manifests fingerprint.
      writeSkill(impostorRoot, 'planted-skill', 'Planted description with react patterns component keywords');
      writeSkill(victimRoot, 'coding-standards', 'Coding standards and conventions');
      fs.writeFileSync(
        path.join(victimRoot, PROFILE_METADATA_FILE),
        JSON.stringify({ profileId: 'test', sourceRoot: impostorRoot.split(path.sep).join('/') })
      );
      const context = resolveRouterContext(victimRoot);
      assert.strictEqual(path.resolve(context.sourceRoot), path.resolve(victimRoot), 'Unverified sourceRoot must fall back to the plugin root');
      const matches = routePrompt('apply react patterns when refactoring this component', { pluginRoot: victimRoot });
      assert.ok(!matches.some(m => m.id === 'planted-skill'), 'Planted catalog must not be routed');
    } finally {
      fs.rmSync(impostorRoot, { recursive: true, force: true });
      fs.rmSync(victimRoot, { recursive: true, force: true });
    }
  });

  run('embedded catalog snapshot routes without scanning the source tree', () => {
    const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-snapshot-'));
    try {
      writeSkill(snapshotRoot, 'coding-standards', 'Coding standards and conventions');
      fs.writeFileSync(
        path.join(snapshotRoot, PROFILE_METADATA_FILE),
        JSON.stringify({
          profileId: 'test',
          sourceRoot: repoRoot.split(path.sep).join('/'),
          catalog: [{ id: 'zebra-snapshot-skill', description: 'Snapshot-only skill about zebra herding patterns' }],
        })
      );
      const matches = routePrompt('zebra herding patterns for the snapshot', { pluginRoot: snapshotRoot });
      assert.ok(matches.some(m => m.id === 'zebra-snapshot-skill'), 'Embedded catalog entry must be routable even though it is not on disk');
    } finally {
      fs.rmSync(snapshotRoot, { recursive: true, force: true });
    }
  });
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.rmSync(cacheDir, { recursive: true, force: true });
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
