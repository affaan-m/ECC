#!/usr/bin/env node
/**
 * Run all tests
 *
 * Usage: node tests/run-all.js
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const testsDir = __dirname;
const repoRoot = path.resolve(testsDir, '..');
const TEST_GLOB = 'tests/**/*.test.js';

function matchesTestGlob(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (typeof path.matchesGlob === 'function') {
    return path.matchesGlob(normalized, TEST_GLOB);
  }

  return /^tests\/(?:.+\/)?[^/]+\.test\.js$/.test(normalized);
}

function walkFiles(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, acc);
    } else if (entry.isFile()) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function discoverTestFiles() {
  return walkFiles(testsDir)
    .map(fullPath => path.relative(repoRoot, fullPath))
    .filter(matchesTestGlob)
    .map(repoRelativePath => path.relative(testsDir, path.join(repoRoot, repoRelativePath)))
    .sort();
}

function escapeAnnotation(value, property = false) {
  const escaped = value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return property ? escaped.replace(/:/g, '%3A').replace(/,/g, '%2C') : escaped;
}

function annotateFailure(displayPath, reason, output) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const context = output.split(/\r?\n/)
    .filter(line => /^\s*(?:FAIL\b|not ok\b|[A-Za-z]*Error\b|[\u2717\u274c])/i.test(line))
    .slice(0, 3)
    .join('\n');
  const message = [reason, context].filter(Boolean).join(': ').slice(0, 1000);
  console.log(`::error file=${escapeAnnotation(`tests/${displayPath}`, true)}::${escapeAnnotation(message)}`);
}

const testFiles = discoverTestFiles();

const BOX_W = 58; // inner width between ║ delimiters
const boxLine = s => `║${s.padEnd(BOX_W)}║`;

console.log('╔' + '═'.repeat(BOX_W) + '╗');
console.log(boxLine('           Everything Claude Code - Test Suite'));
console.log('╚' + '═'.repeat(BOX_W) + '╝');
console.log();

if (testFiles.length === 0) {
  console.log(`✗ No test files matched ${TEST_GLOB}`);
  process.exit(1);
}

let totalPassed = 0;
let totalFailed = 0;
let totalTests = 0;

for (const testFile of testFiles) {
  const testPath = path.join(testsDir, testFile);
  const displayPath = testFile.split(path.sep).join('/');

  if (!fs.existsSync(testPath)) {
    console.log(`WARNING Skipping ${displayPath} (file not found)`);
    continue;
  }

  console.log(`\n━━━ Running ${displayPath} ━━━`);

  // Run each test hermetically: strip inherited git env vars. When the suite
  // runs inside a git hook (e.g. pre-push), git sets GIT_DIR/GIT_WORK_TREE,
  // which would hijack `git -C <dir>` calls in tests that exercise real git
  // and make them operate on the host repo instead of their own fixtures.
  const childEnv = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX']) {
    delete childEnv[key];
  }

  const result = spawnSync('node', [testPath], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  // Show both stdout and stderr so hook warnings are visible
  if (stdout) console.log(stdout);
  if (stderr) console.log(stderr);

  // Parse results from combined output
  const combined = `${stdout}\n${stderr}`;
  const passedMatch = combined.match(/Passed:\s*(\d+)/);
  const failedMatch = combined.match(/Failed:\s*(\d+)/);

  if (passedMatch) totalPassed += parseInt(passedMatch[1], 10);
  const reportedFailures = failedMatch ? parseInt(failedMatch[1], 10) : 0;
  const processFailed = Boolean(result.error) || result.status !== 0;
  totalFailed += processFailed ? Math.max(reportedFailures, 1) : reportedFailures;

  let failureReason;
  if (result.error) {
    failureReason = `failed to start: ${result.error.message}`;
  } else if (result.status !== 0) {
    failureReason = result.signal
      ? `terminated by signal ${result.signal}`
      : `exited with status ${result.status}`;
  } else if (reportedFailures > 0) {
    failureReason = `reported ${reportedFailures} failed tests`;
  }

  if (failureReason) {
    console.log(`✗ ${displayPath} ${failureReason}`);
    annotateFailure(displayPath, failureReason, combined);
  }
}

totalTests = totalPassed + totalFailed;

console.log('\n╔' + '═'.repeat(BOX_W) + '╗');
console.log(boxLine('                     Final Results'));
console.log('╠' + '═'.repeat(BOX_W) + '╣');
console.log(boxLine(`  Total Tests: ${String(totalTests).padStart(4)}`));
console.log(boxLine(`  Passed:      ${String(totalPassed).padStart(4)}  ✓`));
console.log(boxLine(`  Failed:      ${String(totalFailed).padStart(4)}  ${totalFailed > 0 ? '✗' : ' '}`));
console.log('╚' + '═'.repeat(BOX_W) + '╝');

process.exit(totalFailed > 0 ? 1 : 0);
