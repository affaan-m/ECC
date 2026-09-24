/**
 * Tests for scripts/grok/install-agents-skills.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const installerPath = path.join(repoRoot, 'scripts', 'grok', 'install-agents-skills.js');
const {
  escapeRegex,
  hasSourceCommandWrapper,
  installAgentsSkills,
  isWhitespaceEquivalent,
  normalizeFluff,
  wrapperDirName,
} = require('../../scripts/grok/install-agents-skills');

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

function runTests() {
  console.log('\n=== Testing install-agents-skills.js ===\n');
  let passed = 0;
  let failed = 0;

  if (test('normalizeFluff drops whitespace and line breaks only', () => {
    assert.strictEqual(normalizeFluff('a \n\t b\r\n'), 'ab');
    assert.strictEqual(isWhitespaceEquivalent('gpt-5.5', 'grok-4.6'), false);
    assert.ok(isWhitespaceEquivalent('hello   world', 'hello\nworld'));
  })) passed++; else failed++;

  if (test('wrapper regex matches source-command-${name} exactly', () => {
    assert.ok(hasSourceCommandWrapper(['source-command-plan', 'plan-canvas'], 'plan'));
    assert.ok(!hasSourceCommandWrapper(['source-command-plan-canvas'], 'plan'));
    assert.ok(hasSourceCommandWrapper(['source-command-plan-canvas'], 'plan-canvas'));
    assert.strictEqual(wrapperDirName('plan-canvas'), 'source-command-plan-canvas');
    assert.ok(new RegExp(`^source-command-${escapeRegex('plan-canvas')}$`).test('source-command-plan-canvas'));
  })) passed++; else failed++;

  if (test('no wrapper copies missing native files and leaves other dest entries alone', () => {
    const root = createTempDir('skills-copy-none-');
    try {
      writeFile(path.join(root, 'src', 'tdd-workflow', 'SKILL.md'), '# TDD\nbody\n');
      writeFile(path.join(root, 'src', 'tdd-workflow', 'agents', 'openai.yaml'), 'name: tdd\n');
      writeFile(path.join(root, 'dest', 'source-command-plan', 'SKILL.md'), '# plan wrapper\n');
      const result = installAgentsSkills({
        srcDir: path.join(root, 'src'),
        destDir: path.join(root, 'dest'),
      });
      assert.deepStrictEqual(result.copied.sort(), [
        'tdd-workflow/SKILL.md',
        'tdd-workflow/agents/openai.yaml',
      ].sort());
      assert.strictEqual(result.skippedEquivalent.length, 0);
      assert.strictEqual(
        fs.readFileSync(path.join(root, 'dest', 'source-command-plan', 'SKILL.md'), 'utf8'),
        '# plan wrapper\n'
      );
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('equivalent wrapper skips the native copy and does not modify the wrapper', () => {
    const root = createTempDir('skills-copy-eq-');
    try {
      const native = '---\nname: foo\n---\n\n# Foo\nUse grok-4.6.\n';
      const wrapper = '---\nname: foo\n---\n\n# Foo\n\nUse   grok-4.6.\n';
      writeFile(path.join(root, 'src', 'foo', 'SKILL.md'), native);
      writeFile(path.join(root, 'src', 'foo', 'agents', 'openai.yaml'), 'x: 1\n');
      writeFile(path.join(root, 'dest', 'source-command-foo', 'SKILL.md'), wrapper);
      const result = installAgentsSkills({
        srcDir: path.join(root, 'src'),
        destDir: path.join(root, 'dest'),
      });
      assert.deepStrictEqual(result.copied, []);
      assert.deepStrictEqual(result.skippedEquivalent, ['foo']);
      assert.ok(!fs.existsSync(path.join(root, 'dest', 'foo')));
      assert.strictEqual(
        fs.readFileSync(path.join(root, 'dest', 'source-command-foo', 'SKILL.md'), 'utf8'),
        wrapper
      );
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('different wrapper copies native files and does not modify the wrapper', () => {
    const root = createTempDir('skills-copy-diff-');
    try {
      writeFile(path.join(root, 'src', 'plan-canvas', 'SKILL.md'), '---\nname: plan-canvas\n---\nUse grok-4.6\n');
      const wrapper = '---\nname: source-command-plan-canvas\n---\nUse gpt-5.5\n';
      writeFile(path.join(root, 'dest', 'source-command-plan-canvas', 'SKILL.md'), wrapper);
      const result = installAgentsSkills({
        srcDir: path.join(root, 'src'),
        destDir: path.join(root, 'dest'),
      });
      assert.deepStrictEqual(result.copied, ['plan-canvas/SKILL.md']);
      assert.strictEqual(result.skippedEquivalent.length, 0);
      assert.strictEqual(
        fs.readFileSync(path.join(root, 'dest', 'plan-canvas', 'SKILL.md'), 'utf8'),
        '---\nname: plan-canvas\n---\nUse grok-4.6\n'
      );
      assert.strictEqual(
        fs.readFileSync(path.join(root, 'dest', 'source-command-plan-canvas', 'SKILL.md'), 'utf8'),
        wrapper
      );
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('existing native files are never overwritten', () => {
    const root = createTempDir('skills-copy-exists-');
    try {
      writeFile(path.join(root, 'src', 'foo', 'SKILL.md'), 'NEW CONTENT\n');
      writeFile(path.join(root, 'src', 'foo', 'extra.md'), 'extra\n');
      writeFile(path.join(root, 'dest', 'foo', 'SKILL.md'), 'DO NOT TOUCH\n');
      const result = installAgentsSkills({
        srcDir: path.join(root, 'src'),
        destDir: path.join(root, 'dest'),
      });
      assert.deepStrictEqual(result.copied, ['foo/extra.md']);
      assert.deepStrictEqual(result.skippedExists, ['foo/SKILL.md']);
      assert.strictEqual(
        fs.readFileSync(path.join(root, 'dest', 'foo', 'SKILL.md'), 'utf8'),
        'DO NOT TOUCH\n'
      );
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('dry-run reports copies without writing', () => {
    const root = createTempDir('skills-copy-dry-');
    try {
      writeFile(path.join(root, 'src', 'foo', 'SKILL.md'), '# Foo\n');
      const result = installAgentsSkills({
        srcDir: path.join(root, 'src'),
        destDir: path.join(root, 'dest'),
        dryRun: true,
      });
      assert.deepStrictEqual(result.copied, ['foo/SKILL.md']);
      assert.ok(!fs.existsSync(path.join(root, 'dest', 'foo', 'SKILL.md')));
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('CLI copies and prints created dest paths on stdout', () => {
    const root = createTempDir('skills-copy-cli-');
    try {
      writeFile(path.join(root, 'src', 'foo', 'SKILL.md'), '# Foo\n');
      const destDir = path.join(root, 'dest');
      const ran = spawnSync('node', [installerPath, path.join(root, 'src'), destDir], {
        encoding: 'utf8',
      });
      assert.strictEqual(ran.status, 0, ran.stderr);
      const copied = ran.stdout.trim().split('\n').filter(Boolean);
      assert.deepStrictEqual(copied, [path.join(destDir, 'foo', 'SKILL.md')]);
      assert.ok(fs.existsSync(path.join(destDir, 'foo', 'SKILL.md')));
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
