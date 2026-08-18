const assert = require('assert');
const { getNpmPackEntry } = require('./npm-pack-output');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    failed += 1;
  }
}

test('reads the npm 11 array response', () => {
  const entry = getNpmPackEntry([
    { name: 'ecc-universal', filename: 'ecc-universal-2.2.0.tgz' },
  ], 'ecc-universal');

  assert.strictEqual(entry.filename, 'ecc-universal-2.2.0.tgz');
});

test('reads the npm 12 package-keyed response', () => {
  const entry = getNpmPackEntry({
    'ecc-universal': {
      name: 'ecc-universal',
      filename: 'ecc-universal-2.2.0.tgz',
    },
  }, 'ecc-universal');

  assert.strictEqual(entry.filename, 'ecc-universal-2.2.0.tgz');
});

test('returns undefined for empty or malformed responses', () => {
  assert.strictEqual(getNpmPackEntry([], 'ecc-universal'), undefined);
  assert.strictEqual(getNpmPackEntry({}, 'ecc-universal'), undefined);
  assert.strictEqual(getNpmPackEntry(null, 'ecc-universal'), undefined);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
