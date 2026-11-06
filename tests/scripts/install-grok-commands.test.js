/**
 * Tests for scripts/grok/install-grok-commands.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  GROK_BUILTIN_COMMANDS,
  installGrokCommands,
  resolveCommandName,
} = require('../../scripts/grok/install-grok-commands');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function commandSource(description, body = '# Body\n') {
  return `---\ndescription: ${description}\n---\n\n${body}`;
}

function runTests() {
  console.log('\n=== Testing install-grok-commands.js ===\n');
  let passed = 0;
  let failed = 0;

  if (test('uses the unprefixed name when nothing conflicts', () => {
    const resolution = resolveCommandName({
      stem: 'aside',
      sourceText: commandSource('Quick side question'),
      skillBodies: new Map(),
      destDir: '/tmp/does-not-exist-commands',
      managedNames: new Set(),
    });
    assert.deepStrictEqual(resolution, { name: 'aside', reason: 'free' });
  })) passed++; else failed++;

  if (test('prefixes ecc- when a Grok builtin owns the name', () => {
    assert.ok(GROK_BUILTIN_COMMANDS.has('plan'));
    const resolution = resolveCommandName({
      stem: 'plan',
      sourceText: commandSource('Implementation plan'),
      skillBodies: new Map(),
      destDir: '/tmp/does-not-exist-commands',
      managedNames: new Set(),
    });
    assert.strictEqual(resolution.name, 'ecc-plan');
    assert.strictEqual(resolution.reason, 'builtin');
  })) passed++; else failed++;

  if (test('prefixes ecc- when a preexisting skill is different', () => {
    const resolution = resolveCommandName({
      stem: 'code-review',
      sourceText: commandSource('PR review'),
      skillBodies: new Map([
        ['code-review', '---\nname: code-review\ndescription: Strict maintainability audit\n---\n'],
      ]),
      destDir: '/tmp/does-not-exist-commands',
      managedNames: new Set(),
    });
    assert.strictEqual(resolution.name, 'ecc-code-review');
    assert.strictEqual(resolution.reason, 'different-skill');
  })) passed++; else failed++;

  if (test('skips install when a preexisting skill is whitespace-equivalent', () => {
    const body = '---\nname: foo\ndescription: "Same desc"\n---\n\n# Foo\nHello\n';
    const resolution = resolveCommandName({
      stem: 'foo',
      sourceText: '---\ndescription: Same desc\n---\n\n# Foo\nHello\n',
      skillBodies: new Map([['foo', body]]),
      destDir: '/tmp/does-not-exist-commands',
      managedNames: new Set(),
    });
    assert.strictEqual(resolution.skip, true);
    assert.strictEqual(resolution.reason, 'equivalent');
  })) passed++; else failed++;

  if (test('install writes unprefixed files, prefixes builtins, and removes stale ecc- files', () => {
    const root = createTempDir('grok-cmds-');
    try {
      writeFile(path.join(root, 'src', 'aside.md'), commandSource('Side question', '# Aside\n'));
      writeFile(path.join(root, 'src', 'plan.md'), commandSource('Implementation plan', '# Plan\n'));
      const destDir = path.join(root, 'dest');
      const manifestPath = path.join(destDir, 'ecc-commands-manifest.txt');
      writeFile(path.join(destDir, 'ecc-aside.md'), 'OLD ASIDE\n');
      writeFile(manifestPath, 'ecc-aside.md\necc-plan.md\n');
      const result = installGrokCommands({
        srcDir: path.join(root, 'src'),
        destDir,
        manifestPath,
        skillRoots: [],
      });
      assert.ok(fs.existsSync(path.join(destDir, 'aside.md')));
      assert.ok(fs.existsSync(path.join(destDir, 'ecc-plan.md')));
      assert.ok(!fs.existsSync(path.join(destDir, 'ecc-aside.md')));
      const aside = fs.readFileSync(path.join(destDir, 'aside.md'), 'utf8');
      assert.match(aside, /^---\nname: aside\ndescription: "Side question"\n---\n/);
      const plan = fs.readFileSync(path.join(destDir, 'ecc-plan.md'), 'utf8');
      assert.match(plan, /^---\nname: ecc-plan\ndescription: "Implementation plan"\n---\n/);
      assert.ok(result.removed.some(filePath => filePath.endsWith('ecc-aside.md')));
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('does not overwrite an unmanaged prefixed dest file', () => {
    const root = createTempDir('grok-cmds-keep-prefixed-');
    try {
      writeFile(path.join(root, 'src', 'plan.md'), commandSource('Implementation plan', '# Plan\n'));
      const destDir = path.join(root, 'dest');
      writeFile(path.join(destDir, 'ecc-plan.md'), 'USER PLAN\n');
      const result = installGrokCommands({
        srcDir: path.join(root, 'src'),
        destDir,
        manifestPath: path.join(destDir, 'ecc-commands-manifest.txt'),
        skillRoots: [],
      });
      assert.strictEqual(fs.readFileSync(path.join(destDir, 'ecc-plan.md'), 'utf8'), 'USER PLAN\n');
      assert.ok(result.skipped.includes('ecc-plan'));
      assert.ok(!fs.existsSync(path.join(destDir, 'plan.md')));
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('refuses to write a command manifest that is a symlink escaping destDir', () => {
    const root = createTempDir('grok-cmds-manifest-link-');
    try {
      writeFile(path.join(root, 'src', 'aside.md'), commandSource('Side question', '# Aside\n'));
      const destDir = path.join(root, 'dest');
      fs.mkdirSync(destDir, { recursive: true });
      const outside = path.join(root, 'outside.txt');
      fs.writeFileSync(outside, 'KEEP\n');
      fs.symlinkSync(outside, path.join(destDir, 'ecc-commands-manifest.txt'));
      assert.throws(
        () => installGrokCommands({
          srcDir: path.join(root, 'src'),
          destDir,
          manifestPath: path.join(destDir, 'ecc-commands-manifest.txt'),
          skillRoots: [],
        }),
        /not within|non-regular command manifest/
      );
      assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'KEEP\n');
      assert.ok(!fs.existsSync(path.join(destDir, 'aside.md')));
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('refuses to delete stale manifest entries that escape destDir', () => {
    const root = createTempDir('grok-cmds-escape-');
    try {
      writeFile(path.join(root, 'src', 'aside.md'), commandSource('Side question', '# Aside\n'));
      const destDir = path.join(root, 'dest');
      const outside = path.join(root, 'outside.txt');
      fs.writeFileSync(outside, 'KEEP\n');
      writeFile(path.join(destDir, 'ecc-commands-manifest.txt'), '../outside.txt\n');
      assert.throws(
        () => installGrokCommands({
          srcDir: path.join(root, 'src'),
          destDir,
          manifestPath: path.join(destDir, 'ecc-commands-manifest.txt'),
          skillRoots: [],
        }),
        /unsafe managed command name|not within/
      );
      assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'KEEP\n');
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
