/**
 * A managed install without scripts/lib must get the remedy, not a stack trace
 * (#3259).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'scripts', 'skills-health.js');

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

let passed = 0;
let failed = 0;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-health-missing-lib-'));
fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
fs.copyFileSync(script, path.join(tmp, 'scripts', 'skills-health.js'));

if (
  test('missing scripts/lib prints the install remedy instead of a stack trace', () => {
    const result = spawnSync('node', [path.join(tmp, 'scripts', 'skills-health.js')], {
      encoding: 'utf8',
      timeout: 15000
    });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /could not load \.\/lib\/skill-evolution\/health/);
    assert.match(result.stderr, /--modules commands-core/);
    assert.match(result.stderr, /full ECC checkout/);
    assert.doesNotMatch(result.stderr, /Cannot find module/);
  })
)
  passed++;
else failed++;

const nested = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-health-nested-missing-'));
fs.mkdirSync(path.join(nested, 'scripts', 'lib'), { recursive: true });
fs.copyFileSync(script, path.join(nested, 'scripts', 'skills-health.js'));
fs.cpSync(
  path.join(__dirname, '..', '..', 'scripts', 'lib', 'skill-evolution'),
  path.join(nested, 'scripts', 'lib', 'skill-evolution'),
  { recursive: true }
);
// Keep skill-evolution in place but drop the shared helper it requires via
// `require('../utils')`; the error message must name that module, not claim
// the whole skill-evolution directory is absent.
fs.rmSync(path.join(nested, 'scripts', 'lib', 'utils.js'), { force: true });

if (
  test('a nested missing helper names the real module instead of the directory', () => {
    const result = spawnSync('node', [path.join(nested, 'scripts', 'skills-health.js')], {
      encoding: 'utf8',
      timeout: 15000
    });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /could not load \.\.\/utils/);
    assert.match(result.stderr, /--modules commands-core/);
    assert.doesNotMatch(result.stderr, /Cannot find module/);
  })
)
  passed++;
else failed++;

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(nested, { recursive: true, force: true });

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
