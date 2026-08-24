'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'django-celery', 'SKILL.md');
const reliabilityPath = path.join(repoRoot, 'skills', 'django-celery', 'references', 'reliability.md');
const skill = fs.readFileSync(skillPath, 'utf8');
const reliability = fs.readFileSync(reliabilityPath, 'utf8');
const guidance = `${skill}\n${reliability}`;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

console.log('\n=== Django Celery skill tests ===\n');

test('documents transaction-aware task publication', () => {
  assert.match(skill, /references\/reliability\.md/);
  assert.match(guidance, /delay_on_commit/);
  assert.match(guidance, /transaction\.on_commit/);
  assert.match(guidance, /does not return (?:a )?task ID/i);
  assert.match(guidance, /transactional outbox/i);
});

test('states the worker-loss boundary for late acknowledgements', () => {
  assert.doesNotMatch(guidance, /CELERY_TASK_ACKS_LATE\s*=\s*True[^\n]*re-queue on worker crash/i);
  assert.match(guidance, /task_reject_on_worker_lost/i);
  assert.match(guidance, /message loops/i);
  assert.match(guidance, /idempotent/i);
});

test('keeps every select_for_update example inside an atomic block', () => {
  const pythonBlocks = [...skill.matchAll(/```python\n([\s\S]*?)```/g)].map(match => match[1]);
  const lockingExamples = pythonBlocks.filter(block => block.includes('select_for_update'));

  assert.ok(lockingExamples.length > 0, 'Expected at least one select_for_update example');
  for (const block of lockingExamples) {
    assert.match(block, /transaction\.atomic/);
  }
});

test('distinguishes eager execution from real worker integration', () => {
  assert.match(skill, /eager mode[^\n]*(?:emulat|not a worker integration)/i);
  assert.match(skill, /celery_worker/);
  assert.match(skill, /real broker/i);
});

test('warns that a single beat scheduler does not prevent task overlap', () => {
  assert.match(skill, /periodic tasks? (?:can|may) overlap/i);
  assert.match(skill, /locking strategy/i);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
