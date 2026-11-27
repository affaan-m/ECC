/**
 * Focused tests for validate-agents.js tools frontmatter rules.
 *
 * Run with: node tests/ci/validate-agents-tools.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const validatorsDir = path.join(__dirname, '..', '..', 'scripts', 'ci');
const repoRoot = path.join(__dirname, '..', '..');
const canonicalAgentsDir = path.join(repoRoot, 'agents');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'validate-agents-tools-test-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function stripShebang(source) {
  let s = source;
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  if (s.startsWith('#!')) {
    const nl = s.indexOf('\n');
    s = nl === -1 ? '' : s.slice(nl + 1);
  }
  return s;
}

function runSourceViaTempFile(source) {
  const tmpFile = path.join(repoRoot, `.tmp-validator-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  try {
    fs.writeFileSync(tmpFile, source, 'utf8');
    const stdout = execFileSync('node', [tmpFile], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
      cwd: repoRoot,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

function runValidatorWithDir(validatorName, dirConstant, overridePath) {
  const validatorPath = path.join(validatorsDir, `${validatorName}.js`);
  let source = fs.readFileSync(validatorPath, 'utf8');
  source = stripShebang(source);
  const dirRegex = new RegExp(`const ${dirConstant} = .*?;`);
  source = source.replace(dirRegex, `const ${dirConstant} = ${JSON.stringify(overridePath)};`);
  return runSourceViaTempFile(source);
}

function readCanonicalAgent(file) {
  const resolvedPath = path.resolve(canonicalAgentsDir, file);
  const agentsRoot = path.resolve(canonicalAgentsDir);
  assert.ok(
    resolvedPath.startsWith(`${agentsRoot}${path.sep}`),
    `${file} should resolve inside the canonical agents directory`
  );
  return fs.readFileSync(resolvedPath, 'utf8');
}

function runTests() {
  console.log('\n=== Testing validate-agents tools frontmatter ===\n');

  let passed = 0;
  let failed = 0;

  if (test('canonical agents declare tools as comma-separated scalars', () => {
    const agentFiles = fs.readdirSync(canonicalAgentsDir).filter(file => file.endsWith('.md'));

    for (const file of agentFiles) {
      const content = readCanonicalAgent(file);
      const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      assert.ok(frontmatter, `${file} should have frontmatter`);

      const toolsLine = frontmatter[1].match(/^tools:\s*(.+)$/m);
      assert.ok(toolsLine, `${file} should declare a non-empty tools scalar`);
      assert.ok(
        !toolsLine[1].trim().startsWith('['),
        `${file} should use comma-separated scalar tools, not a YAML sequence`
      );
    }
  })) passed++; else failed++;

  if (test('accepts comma-separated scalar agent tools', () => {
    const testDir = createTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'scalar-tools.md'), '---\nmodel: sonnet\ntools: Read, Glob, Grep\n---\n# Agent');

      const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
      assert.strictEqual(result.code, 0, `Should accept scalar tools, got stderr: ${result.stderr}`);
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('rejects YAML sequence-form agent tools', () => {
    const testDir = createTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'sequence-tools.md'), '---\nmodel: sonnet\ntools: [Read, Glob, Grep]\n---\n# Agent');

      const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
      assert.strictEqual(result.code, 1, 'Should reject sequence-form tools');
      assert.ok(
        result.stderr.includes('comma-separated scalar'),
        `Should explain the supported tools format, got stderr: ${result.stderr}`
      );
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('rejects block sequence-form agent tools', () => {
    const testDir = createTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'block-sequence-tools.md'), '---\nmodel: sonnet\ntools:\n  - Read\n  - Glob\n  - Grep\n---\n# Agent');

      const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
      assert.strictEqual(result.code, 1, 'Should reject block sequence-form tools');
      assert.ok(
        result.stderr.includes('comma-separated scalar'),
        `Should explain the supported tools format, got stderr: ${result.stderr}`
      );
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('rejects explicitly tagged YAML sequence-form agent tools', () => {
    const testDir = createTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'tagged-sequence-tools.md'), '---\nmodel: sonnet\ntools: !!seq [Read, Glob, Grep]\n---\n# Agent');

      const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
      assert.strictEqual(result.code, 1, 'Should reject tagged sequence-form tools');
      assert.ok(
        result.stderr.includes('comma-separated scalar'),
        `Should explain the supported tools format, got stderr: ${result.stderr}`
      );
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
