/**
 * Tests for scripts/lib/resolve-formatter.js
 *
 * Run with: node tests/lib/resolve-formatter.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');

const { findProjectRoot, detectFormatter, resolveFormatterBin, clearCaches } = require('../../scripts/lib/resolve-formatter');

/**
 * Run a single test case, printing pass/fail.
 *
 * @param {string} name - Test description
 * @param {() => void} fn - Test body (throws on failure)
 * @returns {boolean} Whether the test passed
 */
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

/** Track all created tmp dirs for cleanup */
const tmpDirs = [];

/**
 * Create a temporary directory and track it for cleanup.
 *
 * @returns {string} Absolute path to the new temp directory
 */
function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-fmt-'));
  tmpDirs.push(dir);
  return dir;
}

/**
 * Remove all tracked temporary directories.
 */
function cleanupTmpDirs() {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
  tmpDirs.length = 0;
}

function withIsolatedHome(fn) {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-fmt-home-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  process.env.HOME = isolatedHome;
  process.env.USERPROFILE = isolatedHome;

  try {
    return fn(isolatedHome);
  } finally {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    if (originalUserProfile !== undefined) {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }

    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
}

function runTests() {
  console.log('\n=== Testing resolve-formatter.js ===\n');

  let passed = 0;
  let failed = 0;

  function run(name, fn) {
    clearCaches();
    if (test(name, fn)) passed++;
    else failed++;
  }

  // ── findProjectRoot ───────────────────────────────────────────

  run('findProjectRoot: finds package.json in parent dir', () => {
    const root = makeTmpDir();
    const sub = path.join(root, 'src', 'lib');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}');

    assert.strictEqual(findProjectRoot(sub), root);
  });

  run('findProjectRoot: returns startDir when no package.json', () => {
    const root = makeTmpDir();
    const sub = path.join(root, 'deep');
    fs.mkdirSync(sub, { recursive: true });

    // No package.json anywhere in tmp → falls back to startDir
    assert.strictEqual(findProjectRoot(sub), sub);
  });

  run('findProjectRoot: caches result for same startDir', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'package.json'), '{}');

    const first = findProjectRoot(root);
    // Remove package.json — cache should still return the old result
    fs.unlinkSync(path.join(root, 'package.json'));
    const second = findProjectRoot(root);

    assert.strictEqual(first, second);
  });

  run('findProjectRoot: finds shared formatter config above workspace packages', () => {
    for (const config of ['biome.json', '.prettierrc', 'prettier.config.ts']) {
      const root = makeTmpDir();
      const workspace = path.join(root, 'packages', 'web');
      const source = path.join(workspace, 'src');
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(root, config), '{}');
      fs.writeFileSync(path.join(root, 'package.json'), '{}');
      fs.writeFileSync(path.join(workspace, 'package.json'), '{}');
      assert.strictEqual(findProjectRoot(source), root, config);
      assert.strictEqual(detectFormatter(findProjectRoot(source)), config === 'biome.json' ? 'biome' : 'prettier');
    }
  });

  run('findProjectRoot: workspace formatter overrides the shared config', () => {
    const root = makeTmpDir();
    const workspace = path.join(root, 'packages', 'web');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ prettier: {} }));
    assert.strictEqual(findProjectRoot(workspace), workspace);
    assert.strictEqual(detectFormatter(workspace), 'prettier');
  });

  run('findProjectRoot: retains the nearest package when no formatter is configured', () => {
    const root = makeTmpDir();
    const workspace = path.join(root, 'packages', 'web');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.writeFileSync(path.join(workspace, 'package.json'), '{}');
    assert.strictEqual(findProjectRoot(workspace), workspace);
  });

  run('findProjectRoot: keeps the home boundary across Windows path casing', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../scripts/lib/resolve-formatter.js'), 'utf8');
    const existing = new Set([
      'c:\\users\\alice\\.prettierrc',
      'c:\\users\\alice\\project\\package.json',
    ]);
    const mod = { exports: {} };
    const dependencies = {
      path: path.win32,
      os: { homedir: () => 'C:\\Users\\Alice' },
      fs: {
        existsSync: file => existing.has(file.toLowerCase()),
        readFileSync: () => '{}',
      },
    };
    vm.runInNewContext(source, { module: mod, require: id => dependencies[id] });
    for (const project of ['c:\\Users\\Alice\\project', 'C:\\USERS\\ALICE\\project']) {
      assert.strictEqual(mod.exports.findProjectRoot(path.win32.join(project, 'src')), project);
      assert.strictEqual(mod.exports.detectFormatter(project), null);
    }
  });

  run('findProjectRoot: does not borrow a formatter from outside a repository', () => {
    for (const isWorktree of [false, true]) {
      const outer = makeTmpDir();
      const repo = path.join(outer, 'repo');
      const source = path.join(repo, 'src');
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(outer, 'biome.json'), '{}');
      fs.writeFileSync(path.join(repo, 'package.json'), '{}');
      if (isWorktree) fs.writeFileSync(path.join(repo, '.git'), 'gitdir: ../worktrees/repo');
      else fs.mkdirSync(path.join(repo, '.git'));
      assert.strictEqual(findProjectRoot(source), repo);
    }
  });

  // ── detectFormatter ───────────────────────────────────────────

  run('detectFormatter: detects biome.json', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');
    assert.strictEqual(detectFormatter(root), 'biome');
  });

  run('detectFormatter: detects biome.jsonc', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'biome.jsonc'), '{}');
    assert.strictEqual(detectFormatter(root), 'biome');
  });

  run('detectFormatter: detects .prettierrc', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, '.prettierrc'), '{}');
    assert.strictEqual(detectFormatter(root), 'prettier');
  });

  run('detectFormatter: detects prettier.config.js', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'prettier.config.js'), 'module.exports = {}');
    assert.strictEqual(detectFormatter(root), 'prettier');
  });

  run("detectFormatter: detects Prettier's TypeScript and JSON5 config files", () => {
    const names = ['.prettierrc.json5', '.prettierrc.ts', '.prettierrc.mts', '.prettierrc.cts',
      'prettier.config.ts', 'prettier.config.mts', 'prettier.config.cts'];
    for (const name of names) {
      const root = makeTmpDir();
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }));
      fs.writeFileSync(path.join(root, name), 'export default {};\n');
      assert.strictEqual(detectFormatter(root), 'prettier', name);
      const nested = path.join(root, 'src');
      fs.mkdirSync(nested);
      fs.rmSync(path.join(root, 'package.json'));
      assert.strictEqual(findProjectRoot(nested), root, `${name} marks the project root`);
    }
  });

  run('detectFormatter: detects prettier key in package.json', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test', prettier: { singleQuote: true } }));
    assert.strictEqual(detectFormatter(root), 'prettier');
  });

  run('detectFormatter: ignores package.json without prettier key', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }));
    assert.strictEqual(detectFormatter(root), null);
  });

  run('detectFormatter: biome takes priority over prettier', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');
    fs.writeFileSync(path.join(root, '.prettierrc'), '{}');
    assert.strictEqual(detectFormatter(root), 'biome');
  });

  run('detectFormatter: returns null when no config found', () => {
    const root = makeTmpDir();
    assert.strictEqual(detectFormatter(root), null);
  });

  // ── resolveFormatterBin ───────────────────────────────────────

  run('resolveFormatterBin: uses local biome binary when available', () => {
    const root = makeTmpDir();
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const binName = process.platform === 'win32' ? 'biome.cmd' : 'biome';
    fs.writeFileSync(path.join(binDir, binName), '');

    const result = resolveFormatterBin(root, 'biome');
    assert.strictEqual(result.bin, path.join(binDir, binName));
    assert.deepStrictEqual(result.prefix, []);
  });

  run('resolveFormatterBin: falls back to npx for biome', () => {
    const root = makeTmpDir();
    withIsolatedHome(() => {
      const result = resolveFormatterBin(root, 'biome');
      const expectedBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      assert.strictEqual(result.bin, expectedBin);
      assert.deepStrictEqual(result.prefix, ['@biomejs/biome']);
    });
  });

  run('resolveFormatterBin: uses local prettier binary when available', () => {
    const root = makeTmpDir();
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const binName = process.platform === 'win32' ? 'prettier.cmd' : 'prettier';
    fs.writeFileSync(path.join(binDir, binName), '');

    const result = resolveFormatterBin(root, 'prettier');
    assert.strictEqual(result.bin, path.join(binDir, binName));
    assert.deepStrictEqual(result.prefix, []);
  });

  run('resolveFormatterBin: falls back to npx for prettier', () => {
    const root = makeTmpDir();
    withIsolatedHome(() => {
      const result = resolveFormatterBin(root, 'prettier');
      const expectedBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      assert.strictEqual(result.bin, expectedBin);
      assert.deepStrictEqual(result.prefix, ['prettier']);
    });
  });

  run('resolveFormatterBin: returns null for unknown formatter', () => {
    const root = makeTmpDir();
    const result = resolveFormatterBin(root, 'unknown');
    assert.strictEqual(result, null);
  });

  run('resolveFormatterBin: caches resolved binary', () => {
    const root = makeTmpDir();
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const binName = process.platform === 'win32' ? 'biome.cmd' : 'biome';
    fs.writeFileSync(path.join(binDir, binName), '');

    const first = resolveFormatterBin(root, 'biome');
    fs.unlinkSync(path.join(binDir, binName));
    const second = resolveFormatterBin(root, 'biome');

    assert.strictEqual(first.bin, second.bin);
  });

  // ── clearCaches ───────────────────────────────────────────────

  run('clearCaches: clears all cached values', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');

    findProjectRoot(root);
    detectFormatter(root);
    resolveFormatterBin(root, 'biome');

    clearCaches();

    // After clearing, removing config should change detection
    fs.unlinkSync(path.join(root, 'biome.json'));
    assert.strictEqual(detectFormatter(root), null);
  });

  // ── Summary & Cleanup ─────────────────────────────────────────

  cleanupTmpDirs();

  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
