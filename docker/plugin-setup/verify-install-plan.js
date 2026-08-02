#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

function fail(message) {
  throw new Error(message);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function validatePlan(payload, projectDir, requireDryRun) {
  const expectedRoot = path.resolve(projectDir, '.claude');
  if (!payload || typeof payload !== 'object' || !payload.plan) {
    fail('Install output is missing a plan.');
  }
  if (requireDryRun && payload.dryRun !== true) {
    fail('Install plan did not report dryRun=true.');
  }
  if (payload.plan.target !== 'claude-project') {
    fail('Install plan target is not claude-project.');
  }
  if (path.resolve(payload.plan.installRoot) !== expectedRoot) {
    fail('Install root is not confined to the isolated project.');
  }
  if (!Array.isArray(payload.plan.operations) || payload.plan.operations.length === 0) {
    fail('Install plan has no operations.');
  }
  for (const operation of payload.plan.operations) {
    if (
      !operation
      || typeof operation.destinationPath !== 'string'
      || !isWithin(expectedRoot, path.resolve(operation.destinationPath))
    ) {
      fail('Install plan contains an operation outside the isolated project root.');
    }
  }
}

function main() {
  try {
    const projectDir = process.argv[2];
    if (!projectDir || !path.isAbsolute(projectDir)) {
      fail('Expected an absolute isolated project path.');
    }
    const requireDryRun = process.argv.includes('--dry-run');
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    validatePlan(payload, projectDir, requireDryRun);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { isWithin, validatePlan };
