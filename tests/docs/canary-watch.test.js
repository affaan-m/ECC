const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(__dirname, '..', '..', 'skills', 'canary-watch', 'SKILL.md');

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
  console.log('\n=== Testing canary-watch skill docs ===\n');

  let passed = 0;
  let failed = 0;
  const body = fs.readFileSync(SKILL_PATH, 'utf8');

  if (test('description monitoring claims are backed by watch sections', () => {
    for (const phrase of [
      'HTTP endpoints',
      'SSE streams',
      'static assets',
      'console errors',
      'performance regressions',
    ]) {
      assert.ok(body.toLowerCase().includes(phrase.toLowerCase()), `missing phrase: ${phrase}`);
    }
    assert.ok(body.includes('Static Assets'), 'watch list should include static assets');
    assert.ok(body.includes('SSE Streams'), 'watch list should include SSE streams');
    assert.ok(body.includes('SSE endpoint cannot connect'), 'critical thresholds should cover SSE failures');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
