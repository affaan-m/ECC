#!/usr/bin/env node
/**
 * Validate the dynamic workflow and team-orchestration public surface.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

const SURFACES = [
  {
    path: 'skills/dynamic-workflow-mode/SKILL.md',
    required: [
      'dynamic workflow mode',
      'task-local harness',
      'shared skill',
      'eval',
      'control pane',
      'handoff'
    ],
  },
  {
    path: 'skills/team-agent-orchestration/SKILL.md',
    required: [
      'team-based orchestration',
      'agent kanban',
      'work item',
      'ownership',
      'merge gate',
      'control pane'
    ],
  },
  {
    path: 'docs/business/team-agent-orchestration-content-pack.md',
    required: [
      'Video Concepts',
      'Article Angles',
      'agent kanban',
      'team orchestration',
      'dynamic workflows',
      'distribution'
    ],
    forbidden: [
      'https://x.com/',
      'http://x.com/',
      'twitter.com/'
    ],
  },
];

function readSurface(relativePath) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  assert.ok(fs.existsSync(absolutePath), `${relativePath} is missing`);
  return fs.readFileSync(absolutePath, 'utf8');
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing dynamic workflow team surface ===\n');

  let passed = 0;
  let failed = 0;

  for (const surface of SURFACES) {
    if (test(`${surface.path} exists and carries required concepts`, () => {
      const content = readSurface(surface.path);
      const normalized = content.toLowerCase();

      for (const term of surface.required) {
        assert.ok(
          normalized.includes(term.toLowerCase()),
          `${surface.path} is missing required concept: ${term}`
        );
      }

      for (const forbidden of surface.forbidden || []) {
        assert.ok(
          !normalized.includes(forbidden.toLowerCase()),
          `${surface.path} must not expose private bookmark source URLs: ${forbidden}`
        );
      }
    })) passed++; else failed++;
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
