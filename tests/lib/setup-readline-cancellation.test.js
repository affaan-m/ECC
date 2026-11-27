'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const { questionWithCancellation } = require('../../scripts/setup');

async function run() {
  const terminal = new EventEmitter();
  terminal.question = () => new Promise(() => {});

  const pendingAnswer = questionWithCancellation(terminal, 'Choose: ');
  terminal.emit('close');

  await assert.rejects(
    pendingAnswer,
    error => error.code === 'ABORT_ERR' && /readline was closed/i.test(error.message)
  );
  console.log('  ✓ readline close rejects an otherwise unresolved question');
  console.log('\nResults: Passed: 1, Failed: 0');
}

run().catch(error => {
  console.log(`  ✗ ${error.message}`);
  console.log('\nResults: Passed: 0, Failed: 1');
  process.exitCode = 1;
});
