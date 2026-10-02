/**
 * Tests for scripts/grok/generate-command-file.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'grok', 'generate-command-file.js');
const {
  generateFromSource,
  parseDescription,
  renderGrokCommand,
  stripFrontmatter,
} = require('../../scripts/grok/generate-command-file');

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

function runTests() {
  console.log('\n=== Testing generate-command-file.js ===\n');
  let passed = 0;
  let failed = 0;

  if (test('preserves the source command description in Grok frontmatter', () => {
    const src = [
      '---',
      'description: Restate requirements and WAIT for CONFIRM.',
      'argument-hint: "[feature]"',
      '---',
      '',
      '# Plan Command',
      '',
      'Body text.',
      '',
    ].join('\n');
    const parsed = stripFrontmatter(src);
    assert.strictEqual(parseDescription(parsed.frontmatter), 'Restate requirements and WAIT for CONFIRM.');
    const rendered = renderGrokCommand({
      name: 'ecc-plan',
      description: parseDescription(parsed.frontmatter),
      body: parsed.body,
    });
    assert.match(rendered, /^---\nname: ecc-plan\ndescription: "Restate requirements and WAIT for CONFIRM\."\n---\n/);
    assert.ok(rendered.includes('# Plan Command'));
    assert.ok(!rendered.includes('argument-hint'));
    assert.ok(!rendered.startsWith('# ECC Grok Command'));
  })) passed++; else failed++;

  if (test('does not use a Source path line as the description', () => {
    const rendered = renderGrokCommand({
      name: 'ecc-plan',
      description: 'Restate requirements.',
      body: 'Body\n',
    });
    assert.ok(!rendered.includes('Source: '));
    assert.match(rendered, /description: "Restate requirements\."/);
  })) passed++; else failed++;

  if (test('CLI writes a Grok command file from an ECC command source', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cmd-gen-'));
    const srcPath = path.join(tempDir, 'plan.md');
    const outPath = path.join(tempDir, 'ecc-plan.md');
    fs.writeFileSync(srcPath, [
      '---',
      'description: Restate requirements, assess risks, and create a plan.',
      '---',
      '',
      '# Plan Command',
      '',
    ].join('\n'));
    try {
      const result = spawnSync('node', [
        scriptPath,
        '--src', srcPath,
        '--out', outPath,
        '--name', 'ecc-plan',
      ], { encoding: 'utf8' });
      assert.strictEqual(result.status, 0, result.stderr);
      const written = fs.readFileSync(outPath, 'utf8');
      assert.match(written, /description: "Restate requirements, assess risks, and create a plan\."/);
      assert.match(written, /^name: ecc-plan$/m);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('generateFromSource round-trips the repo plan command description', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cmd-plan-'));
    const outPath = path.join(tempDir, 'ecc-plan.md');
    try {
      generateFromSource({
        srcPath: path.join(repoRoot, 'commands', 'plan.md'),
        outPath,
        name: 'ecc-plan',
      });
      const written = fs.readFileSync(outPath, 'utf8');
      assert.match(
        written,
        /description: "Restate requirements, assess risks, and create step-by-step implementation plan\. WAIT for user CONFIRM before touching any code\."/
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
