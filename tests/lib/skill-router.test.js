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
  sanitizeCatalogEntries,
  resolveRouterContext,
  readCatalog,
  buildCatalogCache,
  routePrompt,
} = require('../../scripts/lib/skill-router');

const repoRoot = path.resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function run(name, fn) {
  if (test(name, fn)) passed++;
  else failed++;
}

// routePrompt reads the catalog cache and never builds one, so a fixture
// root has to have its cache built first - exactly as a real install does at
// SessionStart. Tests that assert on a cold, cacheless root call routePrompt
// directly instead.
function routeWithCache(prompt, options) {
  buildCatalogCache(options.pluginRoot);
  return routePrompt(prompt, options);
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
  assert.ok(!tokens.has('please') && !tokens.has('the'));
  assert.ok(!tokens.has('me'));
  assert.ok(tokens.has('database') && tokens.has('fix'));
});

run('tokenize adds singular forms for long plurals', () => {
  const tokens = tokenize('migrations');
  assert.ok(tokens.has('migrations') && tokens.has('migration'));
});

run('routePrompt requires pluginRoot', () => {
  assert.throws(() => routePrompt('anything'), /pluginRoot/);
});

run('routePrompt finds a matching skill in the real catalog', () => {
  const matches = routeWithCache('apply react patterns when refactoring this component', { pluginRoot: repoRoot });
  assert.ok(matches.length > 0);
  assert.ok(matches.some(m => m.id.includes('react')), `Expected a react skill, got ${matches.map(m => m.id).join(', ')}`);
  assert.ok(matches.every(m => m.installed), 'Full catalog root: every match is installed');
  assert.ok(matches.every(m => m.path.startsWith('skills/')), 'paths are plugin-relative');
});

run('routePrompt returns nothing for unroutable prompts', () => {
  buildCatalogCache(repoRoot);
  assert.deepStrictEqual(routePrompt('zzqx wvvk pfff', { pluginRoot: repoRoot }), []);
});

const carrierRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-carrier-'));
try {
  writeSkill(carrierRoot, 'coding-standards', 'Coding standards and conventions for this project');
  writeSkill(carrierRoot, 'ecc-catalog', 'Index of the full ECC skill catalog for this slim profile plugin');
  fs.writeFileSync(
    path.join(carrierRoot, PROFILE_METADATA_FILE),
    JSON.stringify({
      generatedFrom: 'everything-claude-code',
      catalog: [
        { id: 'coding-standards', description: 'Coding standards and conventions', path: 'skills/coding-standards/SKILL.md', installed: true, sha256: 'a'.repeat(64) },
        { id: 'react-patterns', description: 'React component patterns and hooks', path: 'on-demand/react-patterns/SKILL.md', installed: false, sha256: 'b'.repeat(64) },
        { id: 'escape-attempt', description: 'react patterns component escape', path: '../../etc/passwd', installed: false },
        { id: 'abs-attempt', description: 'react patterns component absolute', path: '/etc/passwd', installed: false },
      ],
    })
  );

  run('resolveRouterContext reads the carrier receipt catalog', () => {
    const context = resolveRouterContext(carrierRoot);
    assert.ok(context.installedIds.has('coding-standards'));
    assert.ok(Array.isArray(context.embeddedCatalog));
    assert.deepStrictEqual(context.embeddedCatalog.map(e => e.id).sort(), ['coding-standards', 'react-patterns']);
  });

  run('a carrier routes on-demand skills by their path inside the plugin', () => {
    const matches = routePrompt('apply react patterns when refactoring this component', { pluginRoot: carrierRoot });
    const react = matches.find(m => m.id === 'react-patterns');
    assert.ok(react, 'react-patterns routed from the receipt');
    assert.strictEqual(react.installed, false);
    assert.strictEqual(react.path, 'on-demand/react-patterns/SKILL.md');
  });

  run('receipt rows with paths outside skills/ or on-demand/ are dropped', () => {
    const matches = routePrompt('react patterns component escape absolute', { pluginRoot: carrierRoot });
    assert.ok(!matches.some(m => m.id === 'escape-attempt' || m.id === 'abs-attempt'), 'unsafe paths must never route');
  });

  run('ecc-catalog is never routed', () => {
    const matches = routePrompt('show the full ecc skill catalog index', { pluginRoot: carrierRoot });
    assert.ok(!matches.some(m => m.id === 'ecc-catalog'));
  });

  run('routing is deterministic across repeat calls', () => {
    const first = routePrompt('apply react patterns when refactoring this component', { pluginRoot: carrierRoot });
    const second = routePrompt('apply react patterns when refactoring this component', { pluginRoot: carrierRoot });
    assert.deepStrictEqual(second, first);
  });
} finally {
  fs.rmSync(carrierRoot, { recursive: true, force: true });
}

run('sanitizeCatalogEntries drops malformed entries and normalizes paths', () => {
  const entries = sanitizeCatalogEntries([
    { id: 'good-skill', description: 'a real description' },
    { id: 'on-demand-skill', description: 'x', path: 'on-demand/on-demand-skill/SKILL.md', installed: false },
    { id: 'no-description' },
    { description: 'no id' },
    { id: 42, description: 'numeric id' },
    { id: 'bad-path', description: 'x', path: 'C:/Users/someone/SKILL.md' },
    null,
    'not-an-object',
  ]);
  assert.deepStrictEqual(entries, [
    { id: 'good-skill', description: 'a real description', path: 'skills/good-skill/SKILL.md', installed: true },
    { id: 'on-demand-skill', description: 'x', path: 'on-demand/on-demand-skill/SKILL.md', installed: false },
  ]);
});

run('a poisoned cache with malformed entries does not break routing', () => {
  const poisonedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-poison-'));
  try {
    writeSkill(poisonedRoot, 'database-migration', 'Database schema migration workflow');
    // Snapshot first: cacheDir is shared with every earlier test in this
    // file, so "the first .json in the directory" can be another test's
    // cache and this test would then poison the wrong file and assert
    // nothing about the routing it just did.
    const before = new Set(fs.readdirSync(cacheDir));
    buildCatalogCache(poisonedRoot);
    const created = fs.readdirSync(cacheDir).filter(f => !before.has(f) && f.endsWith('.json'));
    assert.strictEqual(created.length, 1, `Expected exactly one new cache file, got ${created.join(', ')}`);
    const cacheFile = path.join(cacheDir, created[0]);
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    cached.entries = [{ id: 99, description: 'malformed' }, { id: 'ok-skill', description: 'fine' }];
    fs.writeFileSync(cacheFile, JSON.stringify(cached));
    assert.doesNotThrow(() => routePrompt('database migration workflow please', { pluginRoot: poisonedRoot }));
  } finally {
    fs.rmSync(poisonedRoot, { recursive: true, force: true });
  }
});

run('cache write never writes through a planted symlink', () => {
  const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-link-'));
  const linkCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-linkcache-'));
  const previousCacheDir = process.env.ECC_SKILL_ROUTER_CACHE_DIR;
  try {
    writeSkill(linkRoot, 'victim-skill', 'A skill used to trigger a catalog scan');
    const victimFile = path.join(linkCacheDir, 'victim.txt');
    fs.writeFileSync(victimFile, 'ORIGINAL');
    const digest = require('crypto').createHash('sha1').update(path.resolve(linkRoot)).digest('hex').slice(0, 12);
    const plantedLink = path.join(linkCacheDir, `ecc-skill-router-${digest}.json`);
    try {
      fs.symlinkSync(victimFile, plantedLink);
    } catch {
      console.log('    SKIP: symlink creation not permitted on this platform; nothing to assert');
      return;
    }
    process.env.ECC_SKILL_ROUTER_CACHE_DIR = linkCacheDir;
    delete require.cache[require.resolve('../../scripts/lib/skill-router')];
    const { buildCatalogCache: build } = require('../../scripts/lib/skill-router');
    build(linkRoot);
    assert.strictEqual(fs.readFileSync(victimFile, 'utf8'), 'ORIGINAL');
    assert.ok(fs.lstatSync(plantedLink).isFile(), 'cache path must end up a regular file');
    assert.deepStrictEqual(fs.readdirSync(linkCacheDir).filter(f => f.endsWith('.tmp')), []);
  } finally {
    if (previousCacheDir === undefined) delete process.env.ECC_SKILL_ROUTER_CACHE_DIR;
    else process.env.ECC_SKILL_ROUTER_CACHE_DIR = previousCacheDir;
    delete require.cache[require.resolve('../../scripts/lib/skill-router')];
    fs.rmSync(linkRoot, { recursive: true, force: true });
    fs.rmSync(linkCacheDir, { recursive: true, force: true });
  }
});

run('readCatalog stops immediately once an already-past deadline is given, marking the scan incomplete', () => {
  const deadlineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-deadline-'));
  try {
    writeSkill(deadlineRoot, 'alpha-skill', 'First skill for deadline test');
    writeSkill(deadlineRoot, 'beta-skill', 'Second skill for deadline test');
    writeSkill(deadlineRoot, 'gamma-skill', 'Third skill for deadline test');
    // An already-expired deadline must be caught on the very first
    // iteration, before any file is read - this is what bounds a cold scan
    // from the inside instead of only discarding results after a full,
    // unbounded scan finishes (Greptile's original repro shape).
    const result = readCatalog(deadlineRoot, { deadlineAt: Date.now() - 60000 });
    assert.strictEqual(result.complete, false);
    assert.deepStrictEqual(result.entries, [], 'an already-expired deadline must stop the scan before reading anything');
  } finally {
    fs.rmSync(deadlineRoot, { recursive: true, force: true });
  }
});

run('readCatalog completes normally with no deadline or a generous one', () => {
  const deadlineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-deadline-ok-'));
  try {
    writeSkill(deadlineRoot, 'alpha-skill', 'First skill for deadline test');
    writeSkill(deadlineRoot, 'beta-skill', 'Second skill for deadline test');

    const noDeadline = readCatalog(deadlineRoot);
    assert.strictEqual(noDeadline.complete, true);
    assert.strictEqual(noDeadline.entries.length, 2);

    const farDeadline = readCatalog(deadlineRoot, { deadlineAt: Date.now() + 60000 });
    assert.strictEqual(farDeadline.complete, true);
    assert.strictEqual(farDeadline.entries.length, 2);
  } finally {
    fs.rmSync(deadlineRoot, { recursive: true, force: true });
  }
});

run('buildCatalogCache never caches an incomplete, deadline-truncated scan', () => {
  const deadlineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-deadline-cache-'));
  try {
    writeSkill(deadlineRoot, 'alpha-skill', 'First skill for deadline cache test');
    const digest = require('crypto').createHash('sha1').update(path.resolve(deadlineRoot)).digest('hex').slice(0, 12);
    const cacheFile = path.join(cacheDir, `ecc-skill-router-${digest}.json`);

    const truncated = buildCatalogCache(deadlineRoot, { deadlineAt: Date.now() - 60000 });
    assert.strictEqual(truncated.complete, false, 'a deadline already in the past cannot complete');
    assert.strictEqual(truncated.written, false);
    assert.ok(!fs.existsSync(cacheFile), 'an incomplete scan must never be written to the long-TTL cache');
    assert.strictEqual(
      routePrompt('alpha skill deadline cache test', { pluginRoot: deadlineRoot }),
      null,
      'with no cache written, routing has nothing to read'
    );

    const full = buildCatalogCache(deadlineRoot);
    assert.strictEqual(full.complete, true);
    assert.ok(fs.existsSync(cacheFile), 'a complete scan is cached as usual');
    const matches = routePrompt('alpha skill deadline cache test', { pluginRoot: deadlineRoot });
    assert.ok(matches.some(m => m.id === 'alpha-skill'), 'routing reads the freshly built cache');
  } finally {
    fs.rmSync(deadlineRoot, { recursive: true, force: true });
  }
});

run('the prompt path reads the cache and never builds one', () => {
  // This is the hot-path guarantee: with no cache, routePrompt returns null,
  // writes nothing, and does not walk the skills directory.
  const coldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-cold-'));
  try {
    writeSkill(coldRoot, 'beta-skill', 'A skill that exists on disk but not in any cache');
    const before = new Set(fs.readdirSync(cacheDir));

    assert.strictEqual(
      routePrompt('beta skill that exists on disk', { pluginRoot: coldRoot }),
      null,
      'a cold root must yield no suggestions rather than a catalog scan'
    );
    assert.deepStrictEqual(
      fs.readdirSync(cacheDir).filter(f => !before.has(f)),
      [],
      'routing must not create a cache file'
    );

    buildCatalogCache(coldRoot);
    const matches = routePrompt('beta skill that exists on disk', { pluginRoot: coldRoot });
    assert.ok(Array.isArray(matches) && matches.some(m => m.id === 'beta-skill'),
      'once the cache exists, the same prompt routes');
  } finally {
    fs.rmSync(coldRoot, { recursive: true, force: true });
  }
});

run('a stale cache is ignored without being rebuilt on the prompt path', () => {
  const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-stale-'));
  try {
    writeSkill(staleRoot, 'gamma-skill', 'A skill whose cache signature will be invalidated');
    buildCatalogCache(staleRoot);
    const digest = require('crypto').createHash('sha1').update(path.resolve(staleRoot)).digest('hex').slice(0, 12);
    const cacheFile = path.join(cacheDir, `ecc-skill-router-${digest}.json`);
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    cached.signature = { dirCount: cached.signature.dirCount + 99, mtimeMs: 1 };
    fs.writeFileSync(cacheFile, JSON.stringify(cached));

    const sizeBefore = fs.statSync(cacheFile).size;
    assert.strictEqual(
      routePrompt('gamma skill signature', { pluginRoot: staleRoot }),
      null,
      'a signature mismatch means no usable catalog'
    );
    assert.strictEqual(fs.statSync(cacheFile).size, sizeBefore, 'the prompt path must not rewrite the cache');
  } finally {
    fs.rmSync(staleRoot, { recursive: true, force: true });
  }
});

fs.rmSync(cacheDir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
