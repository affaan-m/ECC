#!/usr/bin/env node
/**
 * Validate the Nuxt reviewer public surface stays wired to Nuxt-specific risks.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

const SURFACES = [
  {
    path: 'agents/nuxt-reviewer.md',
    required: [
      'nuxt-reviewer',
      'runtimeConfig.public',
      'useFetch',
      'useAsyncData',
      '$fetch',
      'Nitro',
      'readValidatedBody',
      'useRequestFetch',
      'routeRules',
      '@nuxt/test-utils'
    ],
  },
  {
    path: 'commands/nuxt-review.md',
    required: [
      'nuxt-reviewer',
      'typescript-reviewer',
      'nuxt4-patterns',
      'runtimeConfig',
      'useFetch',
      'useAsyncData',
      'server/api'
    ],
  },
  {
    path: 'skills/nuxt4-patterns/SKILL.md',
    required: [
      'nuxt-reviewer',
      'rules/nuxt',
      '/nuxt-review'
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
  console.log('\n=== Testing Nuxt reviewer surface ===\n');

  let passed = 0;
  let failed = 0;

  for (const surface of SURFACES) {
    if (test(`${surface.path} exists and carries Nuxt review concepts`, () => {
      const content = readSurface(surface.path);
      const normalized = content.toLowerCase();

      for (const term of surface.required) {
        assert.ok(
          normalized.includes(term.toLowerCase()),
          `${surface.path} is missing required concept: ${term}`
        );
      }
    })) passed++; else failed++;
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
