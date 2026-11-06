'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

test('coverage checkout includes pinned Grok source history', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml');
  const workflow = yaml.load(fs.readFileSync(workflowPath, 'utf8'));
  const checkout = workflow.jobs.coverage.steps.find(step => step.name === 'Checkout');
  assert.ok(checkout, 'coverage job must check out source');
  assert.equal(checkout.with['fetch-depth'], 0,
    'coverage tests verify historical Grok source pins and need complete Git history');
});
