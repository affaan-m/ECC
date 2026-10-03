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

function withoutSetValue(values, target) {
  return new Set([...values].filter(value => value !== target));
}

function getPythonLineDetails(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const whitespace = line.match(/^[ \t]*/)[0];
  return {
    code: trimmed.replace(/\s+#.*$/, ''),
    indent: whitespace.replaceAll('\t', '    ').length,
  };
}

function trimBlocksForIndent(blocks, indent) {
  let visibleBlocks = blocks;
  while (visibleBlocks.length > 0 && indent <= visibleBlocks[visibleBlocks.length - 1].indent) {
    visibleBlocks = visibleBlocks.slice(0, -1);
  }
  return visibleBlocks;
}

function inspectPendingAtomicLine(state, code, lineNumber) {
  const closingAtomic = code.match(/^\)\s*(?:as\s+[A-Za-z_]\w*\s*)?:\s*/);
  if (!closingAtomic) {
    const unsafeQuery = code.includes('.select_for_update(');
    return unsafeQuery ? { ...state, unsafeLines: [...state.unsafeLines, lineNumber] } : state;
  }

  const inlineBody = code.slice(closingAtomic[0].length);
  const deferredLambda = /^[A-Za-z_]\w*(?:\s*:[^=]+)?\s*=\s*lambda\b/.test(inlineBody);
  const unsafeQuery = inlineBody.includes('.select_for_update(') && deferredLambda;
  const blocks = inlineBody
    ? state.blocks
    : [...state.blocks, { indent: state.pendingAtomicWithIndent, atomic: true, callable: false }];
  return {
    ...state,
    blocks,
    pendingAtomicWithIndent: null,
    unsafeLines: unsafeQuery ? [...state.unsafeLines, lineNumber] : state.unsafeLines,
  };
}

function inspectPythonStatement(state, code, indent, lineNumber) {
  if (code.startsWith('@')) {
    const atomicDecorator = /^@transaction\.atomic(?:\([^)]*\))?$/.test(code);
    return atomicDecorator
      ? { ...state, atomicDecoratorIndents: new Set([...state.atomicDecoratorIndents, indent]) }
      : state;
  }
  if (/^with\s+transaction\.atomic\(\s*$/.test(code)) {
    return { ...state, pendingAtomicWithIndent: indent };
  }

  const atomicWith = code.match(
    /^with\s+transaction\.atomic\([^)]*\)\s*(?:as\s+[A-Za-z_]\w*\s*)?:\s*/,
  );
  const inlineAtomicBody = atomicWith ? code.slice(atomicWith[0].length) : '';
  const isFunction = /^(?:async\s+)?def\s+/.test(code);
  const isAtomicFunction = isFunction && state.atomicDecoratorIndents.has(indent);
  const queryIndex = code.indexOf('.select_for_update(');
  const functionColon = isFunction ? code.indexOf(':') : -1;
  const inlineFunctionQuery = queryIndex > functionColon && functionColon !== -1;
  const queryScope = inlineAtomicBody || code;
  const deferredLambda = /^[A-Za-z_]\w*(?:\s*:[^=]+)?\s*=\s*lambda\b/.test(queryScope);

  let queryProtected = hasActiveAtomicScope(state.blocks);
  queryProtected = atomicWith && inlineAtomicBody ? true : queryProtected;
  queryProtected = inlineFunctionQuery ? isAtomicFunction : queryProtected;
  queryProtected = deferredLambda ? false : queryProtected;
  const unsafeQuery = queryIndex !== -1 && !queryProtected;
  const blocks = code.endsWith(':')
    ? [...state.blocks, { indent, atomic: Boolean(atomicWith) || isAtomicFunction, callable: isFunction }]
    : state.blocks;
  return {
    ...state,
    blocks,
    atomicDecoratorIndents: withoutSetValue(state.atomicDecoratorIndents, indent),
    unsafeLines: unsafeQuery ? [...state.unsafeLines, lineNumber] : state.unsafeLines,
  };
}

function inspectPythonLine(state, line, lineNumber) {
  const details = getPythonLineDetails(line);
  if (!details) {
    return state;
  }
  const scopedState = { ...state, blocks: trimBlocksForIndent(state.blocks, details.indent) };
  return scopedState.pendingAtomicWithIndent === null
    ? inspectPythonStatement(scopedState, details.code, details.indent, lineNumber)
    : inspectPendingAtomicLine(scopedState, details.code, lineNumber);
}

function findUnprotectedSelectForUpdateLines(source) {
  const initialState = {
    blocks: [],
    atomicDecoratorIndents: new Set(),
    pendingAtomicWithIndent: null,
    unsafeLines: [],
  };
  const finalState = source
    .split('\n')
    .reduce((state, line, index) => inspectPythonLine(state, line, index + 1), initialState);
  return finalState.unsafeLines;
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
  const deferredLambdaExample = [
    'with transaction.atomic():',
    '    load_order = lambda: Order.objects.select_for_update().get(pk=order_id)',
    'load_order()',
  ].join('\n');
  const sameLineAtomicExample = [
    'with transaction.atomic(): order = Order.objects.select_for_update().get(pk=order_id)',
  ].join('\n');
  const multilineAtomicExample = [
    'with transaction.atomic(',
    "    using='default',",
    '):',
    '    order = Order.objects.select_for_update().get(pk=order_id)',
  ].join('\n');
  const multilineAtomicAliasExample = [
    'with transaction.atomic(',
    "    using='default',",
    ') as atomic_context:',
    '    order = Order.objects.select_for_update().get(pk=order_id)',
  ].join('\n');
  const sameLineAtomicAliasExample = [
    'with transaction.atomic() as atomic_context:',
    '    order = Order.objects.select_for_update().get(pk=order_id)',
  ].join('\n');
  const inlineAtomicAliasExample = [
    'with transaction.atomic() as atomic_context: order = Order.objects.select_for_update().get(pk=order_id)',
  ].join('\n');
  const atomicArgumentQueryExample = [
    'with transaction.atomic(',
    '    using=Order.objects.select_for_update().get(pk=order_id)._state.db,',
    '):',
    '    process_order()',
  ].join('\n');
  const unterminatedAtomicExample = [
    'with transaction.atomic(',
    "    using='default',",
    'order = Order.objects.select_for_update().get(pk=order_id)',
  ].join('\n');

  assert.ok(lockingExamples.length > 0, 'Expected at least one select_for_update example');
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(invalidExample), [1]);
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(deferredCallableExample), [3]);
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(atomicCallableExample), []);
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(deferredLambdaExample), [2]);
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(sameLineAtomicExample), []);
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(multilineAtomicExample), []);
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(multilineAtomicAliasExample), []);
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(sameLineAtomicAliasExample), []);
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(inlineAtomicAliasExample), []);
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(atomicArgumentQueryExample), [2]);
  assert.deepStrictEqual(findUnprotectedSelectForUpdateLines(unterminatedAtomicExample), [3]);
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
    'attempt_id = self.request.id',
    '.select_for_update().get(',
    'claim_or_resume_charge',
    'gateway.charge',
    "idempotency_key=f'order:{order_id}'",
    '.select_for_update().get(',
    'charge_attempt_id',
    'record_charge',
  ]);
  assert.match(antiPatterns, /adapter validates provider data/i);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
