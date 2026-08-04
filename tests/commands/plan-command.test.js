'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const planCommandPath = path.join(repoRoot, 'commands', 'plan.md');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function readPlanCommand() {
  return fs.readFileSync(planCommandPath, 'utf8');
}

console.log('\n=== Testing /plan command prompt ===\n');

test('/plan runs inline by default without requiring planner agent installation', () => {
  const source = readPlanCommand();

  assert.ok(
    source.includes('Do not call the Task tool or any subagent by default'),
    'Expected /plan to avoid default subagent delegation',
  );
  assert.ok(
    source.includes('If the `planner` subagent is unavailable'),
    'Expected /plan to define a planner-unavailable fallback',
  );
  assert.ok(
    !source.includes('This command invokes the **planner** agent'),
    'Expected /plan not to claim unconditional planner invocation',
  );
  assert.ok(
    !source.includes('The planner agent will:'),
    'Expected /plan to describe inline behavior, not mandatory agent behavior',
  );
  assert.ok(
    !source.includes('Agent (planner):'),
    'Expected /plan examples not to imply the planner agent is required',
  );
});

test('/plan preserves the explicit confirmation gate before code edits', () => {
  const source = readPlanCommand();

  assert.ok(
    source.includes('WAIT for user CONFIRM before touching any code'),
    'Expected frontmatter to preserve the no-code-before-confirmation rule',
  );
  assert.ok(
    source.includes('WAITING FOR CONFIRMATION'),
    'Expected example output to preserve the confirmation handoff',
  );
  assert.ok(
    source.includes('will **NOT** write any code until you explicitly confirm'),
    'Expected important notes to preserve the confirmation contract',
  );
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
