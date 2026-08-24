'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'django-celery', 'SKILL.md');
const reliabilityPath = path.join(repoRoot, 'skills', 'django-celery', 'references', 'reliability.md');
const skill = fs.readFileSync(skillPath, 'utf8');
const reliability = fs.readFileSync(reliabilityPath, 'utf8');

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

function getMarkdownSection(document, heading) {
  const lines = document.split('\n');
  const start = lines.indexOf(heading);
  assert.notStrictEqual(start, -1, `Missing section: ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  let end = start + 1;
  let inFence = false;

  while (end < lines.length) {
    if (lines[end].startsWith('```')) {
      inFence = !inFence;
      end += 1;
      continue;
    }
    const nextHeading = inFence ? null : lines[end].match(/^(#+)\s/);
    if (nextHeading?.[1].length <= level) {
      break;
    }
    end += 1;
  }

  return lines.slice(start + 1, end).join('\n');
}

function assertMarkersInOrder(source, markers) {
  markers.reduce((previousIndex, marker) => {
    const index = source.indexOf(marker, previousIndex + 1);
    assert.ok(index > previousIndex, `Expected ${marker} after the previous marker`);
    return index;
  }, -1);
}

function hasActiveAtomicScope(blocks) {
  let executionScopeStart = 0;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index].callable) {
      executionScopeStart = index;
      break;
    }
  }

  return blocks.slice(executionScopeStart).some(block => block.atomic);
}

function findUnprotectedSelectForUpdateLines(source) {
  const blocks = [];
  const atomicDecoratorIndents = new Set();
  const unsafeLines = [];
  const lines = source.split('\n');

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const whitespace = line.match(/^[ \t]*/)[0];
    const indent = whitespace.replaceAll('\t', '    ').length;
    while (blocks.length > 0 && indent <= blocks[blocks.length - 1].indent) {
      blocks.pop();
    }

    if (trimmed.startsWith('@')) {
      if (/^@transaction\.atomic(?:\([^)]*\))?$/.test(trimmed)) {
        atomicDecoratorIndents.add(indent);
      }
      continue;
    }

    if (trimmed.includes('.select_for_update(') && !hasActiveAtomicScope(blocks)) {
      unsafeLines.push(index + 1);
    }

    if (!trimmed.endsWith(':')) {
      atomicDecoratorIndents.delete(indent);
      continue;
    }

    const isFunction = /^(?:async\s+)?def\s+/.test(trimmed);
    const isAtomicWith = /^with\s+transaction\.atomic\([^)]*\):$/.test(trimmed);
    const isAtomicFunction = isFunction && atomicDecoratorIndents.has(indent);
    blocks.push({ indent, atomic: isAtomicWith || isAtomicFunction, callable: isFunction });
    atomicDecoratorIndents.delete(indent);
  }

  return unsafeLines;
}

console.log('\n=== Django Celery skill tests ===\n');

test('documents transaction-aware task publication', () => {
  const skillPublication = getMarkdownSection(skill, '### Publish After the Database Commits');
  const reliabilityPublication = getMarkdownSection(reliability, '## Publish After the Database Commits');

  assert.match(skillPublication, /references\/reliability\.md/);
  assert.match(skillPublication, /delay_on_commit/);
  assert.match(skillPublication, /validated_username/);
  assert.doesNotMatch(skillPublication, /request\.POST/);
  assert.match(reliabilityPublication, /transaction\.on_commit/);
  assert.match(reliabilityPublication, /does not return (?:a )?task ID/i);
  assert.match(reliabilityPublication, /transactional outbox/i);
});

test('states the worker-loss boundary for late acknowledgements', () => {
  const acknowledgements = getMarkdownSection(reliability, '## Acknowledgement and Worker Loss');

  assert.doesNotMatch(acknowledgements, /late ack(?:nowledgement)?[^\n]*re-queue on worker crash/i);
  assert.match(
    acknowledgements,
    /Late acknowledgement[\s\S]*does not by itself guarantee redelivery[\s\S]*task_reject_on_worker_lost/i,
  );
  assert.match(acknowledgements, /message loops/i);
  assert.match(acknowledgements, /idempotent/i);
  assert.match(acknowledgements, /task_acks_on_failure_or_timeout[\s\S]*only[\s\S]*late acknowledgement/i);
});

test('keeps every select_for_update example inside an atomic block', () => {
  const pythonBlocks = [...skill.matchAll(/```python\n([\s\S]*?)```/g)].map(match => match[1]);
  const lockingExamples = pythonBlocks.filter(block => block.includes('select_for_update'));
  const invalidExample = [
    "order = Order.objects.select_for_update().get(pk=order_id)",
    'with transaction.atomic():',
    '    audit_order(order)',
  ].join('\n');
  const deferredCallableExample = [
    'with transaction.atomic():',
    '    def load_order():',
    '        return Order.objects.select_for_update().get(pk=order_id)',
    'load_order()',
  ].join('\n');
  const atomicCallableExample = [
    "@transaction.atomic(using='default')",
    'def load_order():',
    '    return Order.objects.select_for_update().get(pk=order_id)',
  ].join('\n');

  assert.ok(lockingExamples.length > 0, 'Expected at least one select_for_update example');
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(invalidExample), [1]);
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(deferredCallableExample), [3]);
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(atomicCallableExample), []);
  for (const block of lockingExamples) {
    assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(block), []);
  }
});

test('distinguishes eager execution from real worker integration', () => {
  const eagerMode = getMarkdownSection(skill, '### Django Integration Path with Eager Mode');
  const realWorker = getMarkdownSection(skill, '### Worker Integration with a Real Broker');

  assert.match(eagerMode, /worker emulation, not a worker integration test/i);
  assert.match(
    eagerMode,
    /do not use it as[\s\S]*evidence for serialization, routing, acknowledgement, retry, or worker-loss behavior/i,
  );
  assert.match(realWorker, /celery_worker/);
  assert.match(realWorker, /real broker/i);
});

test('warns that a single beat scheduler does not prevent task overlap', () => {
  const beat = getMarkdownSection(skill, '## Beat Scheduling (Periodic Tasks)');

  assert.match(beat, /only one scheduler[\s\S]*avoid duplicate publications/i);
  assert.match(beat, /does not prevent execution overlap[\s\S]*periodic tasks? (?:can|may) overlap/i);
  assert.match(beat, /active-run lease[\s\S]*owner[\s\S]*(?:expiry|recovery)/i);
  assert.match(beat, /unique schedule row[\s\S]*alone does not serialize executions/i);
  assert.match(beat, /idempotent/i);
});

test('claims and owns a payment attempt around external I/O', () => {
  const antiPatterns = getMarkdownSection(skill, '## Anti-Patterns');

  assert.match(antiPatterns, /@shared_task\(bind=True,\s*acks_late=True\)/);
  assertMarkersInOrder(antiPatterns, [
    'self.request.id',
    '.select_for_update(',
    'claim_or_resume_charge',
    'gateway.charge',
    "idempotency_key=f'order:{order_id}'",
    '.select_for_update(',
    'charge_attempt_id',
    'record_charge',
  ]);
  assert.match(antiPatterns, /adapter validates provider data/i);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
