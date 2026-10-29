'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'skills/prompt-caching-strategy/SKILL.md'), 'utf8');
const snippet = source.match(/```javascript\n([\s\S]*?)\n```/);
assert.ok(snippet, 'The documented calculator must be executable offline');
const context = vm.createContext({});
vm.runInContext(`${snippet[1]}\nthis.calculate = compareCacheCost;`, context);
const calculate = context.calculate;
const rates = { input: 3, write: 3.75, read: 0.3, output: 15, storage: 1 };
const usage = { uncached: 20000, written: 10000, read: 90000, output: 20000, storageTokenHours: 0 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n${error.stack || error.message}`);
  }
}

test('ten-request example charges a write premium and unchanged output', () => {
  const costs = calculate(usage, rates);
  near(costs.baseline, 0.66);
  near(costs.actual, 0.4245);
  near(costs.savings, 0.2355);
  near(costs.outputCost, 0.3);
});
test('one-off cache write increases the bill', () => {
  const costs = calculate({ ...usage, uncached: 2000, written: 10000, read: 0, output: 2000 }, rates);
  near(costs.savings, -0.0075);
});
test('ineligible short prefix has no cache reads or writes', () => {
  const costs = calculate({ ...usage, uncached: 5000, written: 0, read: 0, output: 1000 }, rates);
  near(costs.savings, 0);
});
test('storage token-hours add cost separately', () => {
  const costs = calculate({ ...usage, storageTokenHours: 20000 }, rates);
  near(costs.storageCost, 0.02);
  near(costs.actual, 0.4445);
  near(costs.savings, 0.2155);
});
test('output-heavy workload does not multiply savings by the whole bill', () => {
  const costs = calculate({ ...usage, output: 1000000 }, rates);
  near(costs.outputCost, 15);
  near(costs.savings, 0.2355);
});
test('expiration/rewrite cost is charged on every write', () => {
  const costs = calculate({ ...usage, written: 100000, read: 0 }, rates);
  near(costs.savings, -0.075);
});
test('missing or invalid usage and rates fail clearly', () => {
  for (const invalid of [-1, NaN, Infinity, '3', undefined]) {
    assert.throws(() => calculate({ ...usage, read: invalid }, rates), /nonnegative/);
    assert.throws(() => calculate(usage, { ...rates, storage: invalid }), /nonnegative/);
  }
});
test('canonical module and package both distribute the skill', () => {
  const modules = JSON.parse(fs.readFileSync(path.join(root, 'manifests/install-modules.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(modules.modules.find(module => module.id === 'agentic-patterns').paths.includes('skills/prompt-caching-strategy'));
  assert.ok(pkg.files.includes('skills/prompt-caching-strategy/'));
});
console.log('Offline prompt caching checks; runtime cache hits unmeasured.');
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
