#!/usr/bin/env node
/**
 * Runs the documented Step 7 publish guard of skills/opensource-pipeline/SKILL.md
 * against a throwaway git repo, with `gh` stubbed so nothing is published.
 *
 * Run with: node tests/skills/opensource-pipeline-publish-guard.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL_MD = path.join(__dirname, '..', '..', 'skills', 'opensource-pipeline', 'SKILL.md');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function publishBlock() {
  const md = fs.readFileSync(SKILL_MD, 'utf8');
  const step = md.split('#### Step 7: GitHub Publish')[1];
  assert.ok(step, 'SKILL.md is missing "#### Step 7: GitHub Publish"');
  const m = step.match(/```bash\n([\s\S]*?)```/);
  assert.ok(m, 'no bash block in Step 7');
  return m[1];
}

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim();
}

// One-commit staging repo; returns the commit the sanitizer "scanned".
function withStaging(fn, { committedReport = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-publish-'));
  try {
    const staging = path.join(root, 'staging');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(staging);
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\ntouch "${path.join(root, 'published')}"\n`, { mode: 0o755 });
    git(staging, 'init', '-q');
    git(staging, 'config', 'user.email', 'test@example.com');
    git(staging, 'config', 'user.name', 'test');
    fs.writeFileSync(path.join(staging, 'README.md'), 'clean\n');
    if (committedReport) fs.writeFileSync(path.join(staging, 'FORK_REPORT.md'), 'must not publish\n');
    git(staging, 'add', '-A');
    git(staging, 'commit', '-q', '-m', 'init');
    const scanned = git(staging, 'rev-parse', 'HEAD');
    const publish = () => {
      const script = publishBlock()
        .replaceAll('{STAGING_PATH}', staging)
        .replaceAll('{SCANNED_COMMIT}', scanned);
      const r = spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      });
      return { status: r.status, published: fs.existsSync(path.join(root, 'published')) };
    };
    fn({ staging, publish });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runTests() {
  console.log('\n=== Testing opensource-pipeline publish guard ===\n');

  if (process.platform === 'win32') {
    console.log('  - skipped: bash guard test on Windows');
    console.log('\nPassed: 0');
    console.log('Failed: 0');
    return;
  }

  let passed = 0;
  let failed = 0;

  if (test('publishes the commit the sanitizer scanned', () => {
    withStaging(({ publish }) => {
      const r = publish();
      assert.strictEqual(r.status, 0);
      assert.ok(r.published, 'gh repo create was not run');
    });
  })) passed++; else failed++;

  if (test('refuses to publish a commit amended after the scan', () => {
    withStaging(({ staging, publish }) => {
      fs.writeFileSync(path.join(staging, 'README.md'), 'edited during review: me@example.com\n');
      git(staging, 'commit', '-q', '-a', '--amend', '--no-edit');
      const r = publish();
      assert.notStrictEqual(r.status, 0);
      assert.ok(!r.published, 'gh repo create ran for an unscanned commit');
    });
  })) passed++; else failed++;

  if (test('refuses to publish a commit containing a report', () => {
    withStaging(({ publish }) => {
      const r = publish();
      assert.notStrictEqual(r.status, 0);
      assert.ok(!r.published, 'gh repo create ran with a tracked report');
    }, { committedReport: true });
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

runTests();
