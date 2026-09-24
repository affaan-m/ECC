#!/usr/bin/env node
/**
 * Validate the scheduled supply-chain watch workflow contract.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(
  __dirname,
  '..',
  '..',
  '.github',
  'workflows',
  'supply-chain-watch.yml',
);

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

function run() {
  console.log('\n=== Testing supply-chain watch workflow ===\n');

  const source = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  let passed = 0;
  let failed = 0;

  if (test('runs on schedule and manual dispatch', () => {
    assert.match(source, /schedule:\r?\n\s+- cron: '17 \*\/6 \* \* \*'/);
    assert.match(source, /workflow_dispatch:/);
  })) passed++; else failed++;

  if (test('uses read-only permissions and non-persisting checkout credentials', () => {
    assert.match(source, /permissions:\r?\n\s+contents: read/);
    assert.doesNotMatch(source, /^\s+[A-Za-z-]+:\s*write\b/m);
    assert.match(source, /uses: actions\/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10/);
    assert.match(source, /persist-credentials: false/);
    assert.doesNotMatch(source, /id-token:\s*write/);
    assert.doesNotMatch(source, /actions\/cache@/);
  })) passed++; else failed++;

  if (test('installs without lifecycle scripts and verifies registry signatures', () => {
    assert.match(source, /npm ci --ignore-scripts/);
    assert.match(source, /npm audit signatures/);
    assert.match(source, /npm audit --audit-level=high/);
  })) passed++; else failed++;

  if (test('runs IOC fixtures, emits JSON report, and uploads the artifact', () => {
    assert.match(source, /node tests\/ci\/scan-supply-chain-iocs\.test\.js/);
    assert.match(source, /node scripts\/ci\/scan-supply-chain-iocs\.js --json > artifacts\/supply-chain-ioc-report\.json/);
    assert.match(source, /node tests\/ci\/supply-chain-advisory-sources\.test\.js/);
    assert.match(source, /node scripts\/ci\/supply-chain-advisory-sources\.js --refresh --json > artifacts\/supply-chain-advisory-sources\.json/);
    assert.match(source, /node scripts\/ci\/validate-workflow-security\.js/);
    assert.match(source, /uses: actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
    assert.match(source, /name: supply-chain-ioc-report/);
    assert.match(source, /artifacts\/supply-chain-ioc-report\.json/);
    assert.match(source, /artifacts\/supply-chain-advisory-sources\.json/);
    assert.match(source, /retention-days: 14/);
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

run();
