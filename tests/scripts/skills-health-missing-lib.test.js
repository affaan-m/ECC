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
    assert.match(result.stderr, /missing from this installation/i);
    assert.match(result.stderr, /install-apply\.js/);
    assert.doesNotMatch(result.stderr, /Cannot find module/);
  })
)
  passed++;
else failed++;

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
