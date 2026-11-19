const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const AGENT_PATH = path.join(ROOT, 'agents', 'rag-pipeline-reviewer.md');

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

const body = fs.readFileSync(AGENT_PATH, 'utf8');
let passed = 0;
let failed = 0;

console.log('\n=== Testing rag-pipeline-reviewer evaluation contract ===\n');

if (test('requires the production query and context path', () => {
  assert.match(body, /same query-construction and context-assembly path/i);
  assert.match(body, /low-level search helper directly.*insufficient/i);
})) passed++; else failed++;

if (test('requires production-shaped multi-topic fixtures', () => {
  assert.match(body, /long, multi-topic, and header-heavy/i);
  assert.match(body, /topics in the input.*topics represented in the retrieved context/i);
})) passed++; else failed++;

if (test('requires topic and source-type retrieval breakdowns', () => {
  assert.match(body, /per-topic recall/i);
  assert.match(body, /per-source-type breakdown/i);
})) passed++; else failed++;

if (test('rejects single-query-only coverage and names section fusion', () => {
  assert.match(body, /single-query-only benchmark/i);
  assert.match(body, /per-section retrieval with fused results/i);
})) passed++; else failed++;

if (test('retains the minimum grounding metrics and baseline controls', () => {
  for (const metric of ['faithfulness', 'context_recall', 'context_precision']) {
    assert.ok(body.includes(metric), `missing metric: ${metric}`);
  }
  for (const control of ['versioned baseline dataset', 'acceptance thresholds', 'allowed regression delta']) {
    assert.ok(body.includes(control), `missing control: ${control}`);
  }
})) passed++; else failed++;

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
