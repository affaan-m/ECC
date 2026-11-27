/**
 * Tests for scripts/catalog.js
 */

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'catalog.js');

function run(args = []) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing catalog.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('shows help with no arguments', () => {
    const result = run();
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Discover ECC install components and profiles'));
  })) passed++; else failed++;

  if (test('shows help with an explicit help flag', () => {
    const result = run(['--help']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Usage:'));
    assert.ok(result.stdout.includes('node scripts/catalog.js show <component-id>'));
  })) passed++; else failed++;

  if (test('lists install profiles', () => {
    const result = run(['profiles']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Install profiles'));
    assert.ok(result.stdout.includes('core'));
  })) passed++; else failed++;

  if (test('filters components by family and emits JSON', () => {
    const result = run(['components', '--family', 'language', '--json']);
    assert.strictEqual(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(parsed.components));
    assert.ok(parsed.components.length > 0);
    assert.ok(parsed.components.every(component => component.family === 'language'));
    assert.ok(parsed.components.some(component => component.id === 'lang:typescript'));
    assert.ok(parsed.components.every(component => component.id !== 'framework:nextjs'));
  })) passed++; else failed++;

  if (test('shows a resolved component payload', () => {
    const result = run(['show', 'framework:nextjs', '--json']);
    assert.strictEqual(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.id, 'framework:nextjs');
    assert.strictEqual(parsed.family, 'framework');
    assert.deepStrictEqual(parsed.moduleIds, ['framework-language']);
    assert.ok(Array.isArray(parsed.modules));
    assert.strictEqual(parsed.modules[0].id, 'framework-language');
  })) passed++; else failed++;

  if (test('fails on unknown subcommands', () => {
    const result = run(['bogus']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('Unknown catalog command'));
  })) passed++; else failed++;

  if (test('fails on unknown component ids', () => {
    const result = run(['show', 'framework:not-real']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('Unknown install component'));
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
