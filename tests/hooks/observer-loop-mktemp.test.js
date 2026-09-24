/**
 * Regression test for #2417 mktemp template portability in observer-loop.sh
 *
 * BSD/macOS mktemp only substitutes a trailing run of X characters. The
 * observer-loop analysis template must therefore keep the randomized X run at
 * the end of the quoted template string.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

const repoRoot = path.resolve(__dirname, '..', '..');
const observerLoopPath = path.join(
  repoRoot,
  'skills',
  'continuous-learning-v2',
  'agents',
  'observer-loop.sh'
);

console.log('\n=== Observer-loop mktemp portability regression (#2417) ===\n');

test('every mktemp template ends with the randomized X run', () => {
  const content = fs.readFileSync(observerLoopPath, 'utf8');
  const mktempTemplates = [...content.matchAll(/mktemp\s+"([^"]+)"/g)].map(match => match[1]);

  assert.ok(mktempTemplates.length > 0, 'expected at least one mktemp template');

  for (const template of mktempTemplates) {
    assert.ok(
      /X+$/.test(template),
      `mktemp template must end with Xs for BSD/macOS portability: ${template}`
    );
  }
});

console.log('\n=== Test Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}\n`);

process.exit(failed > 0 ? 1 : 0);
