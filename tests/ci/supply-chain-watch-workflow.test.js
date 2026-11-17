#!/usr/bin/env node
/**
 * Validate the scheduled supply-chain watch workflow contract.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

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
    assert.match(source, /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
    assert.match(source, /persist-credentials: false/);
    assert.doesNotMatch(source, /id-token:\s*write/);
    assert.doesNotMatch(source, /actions\/cache@/);
  })) passed++; else failed++;

  if (test('installs without lifecycle scripts and verifies registry signatures', () => {
    assert.match(source, /npm ci --ignore-scripts/);
    assert.match(source, /npm audit signatures/);
    assert.match(source, /npm audit --omit=dev --audit-level=high/);
  })) passed++; else failed++;

  // Keep a green PR audit from masking an outdated scheduled verifier.
  if (test('every signature audit uses a pinned keyless-capable verifier first', () => {
    let checked = 0;
    for (const file of ['ci.yml', 'supply-chain-watch.yml', 'maintenance.yml']) {
      const workflow = yaml.load(fs.readFileSync(path.join(path.dirname(WORKFLOW_PATH), file), 'utf8'),
        { schema: yaml.CORE_SCHEMA });
      for (const [name, job] of Object.entries(workflow.jobs)) {
        const steps = job.steps || [];
        const audit = steps.findIndex(step => /^\s*npm audit signatures\s*$/m.test(step.run || ''));
        if (audit < 0) continue;
        const verifier = steps.slice(0, audit).find(step => /npm install --global npm@/.test(step.run || ''));
        const label = file + ':' + name;
        assert.ok(verifier, label + ' audits without its pinned verifier');
        const version = /npm install --global npm@(\d+\.\d+\.\d+)\b/.exec(verifier.run)?.[1];
        assert.ok(version, label + ' must pin an exact verifier version');
        const [major, minor, patch] = version.split('.').map(Number);
        assert.ok(major > 11 || (major === 11 && (minor > 21 || (minor === 21 && patch >= 2))),
          label + ' verifier predates the keyless-attestation fix');
        assert.match(verifier.run, /--ignore-scripts\b/);
        assert.ok(verifier.run.includes('test "$(npm --version)" = "' + version + '"'));
        checked++;
      }
    }
    assert.ok(checked >= 3, 'PR, scheduled watch, and maintenance audit jobs must be covered');
  })) passed++; else failed++;

  if (test('runs IOC fixtures, emits JSON report, and uploads the artifact', () => {
    assert.match(source, /node tests\/ci\/scan-supply-chain-iocs\.test\.js/);
    assert.match(source, /node scripts\/ci\/scan-supply-chain-iocs\.js --json > artifacts\/supply-chain-ioc-report\.json/);
    assert.match(source, /node tests\/ci\/supply-chain-advisory-sources\.test\.js/);
    assert.match(source, /node scripts\/ci\/supply-chain-advisory-sources\.js --refresh --json > artifacts\/supply-chain-advisory-sources\.json/);
    assert.match(source, /node scripts\/ci\/validate-workflow-security\.js/);
    assert.match(source, /uses: actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/);
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
