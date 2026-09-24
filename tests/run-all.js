#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const testsDir = __dirname;
const repoRoot = path.resolve(testsDir, '..');
const TEST_GLOB = 'tests/**/*.test.js';
const filter = (((process.argv || [])[2]) || '').split(path.sep).join('/');
const skipPatterns = (process.env.ECC_TEST_SKIP || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function matchesTestGlob(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (filter && !normalized.includes(filter)) {
    return false;
  }
  if (skipPatterns.some(pattern => normalized.includes(pattern))) {
    return false;
  }
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

function parseCounts(combined) {
  const passedMatch = combined.match(/Passed:\s*(\d+)/);
  const failedMatch = combined.match(/Failed:\s*(\d+)/);
  if (passedMatch || failedMatch) {
    return {
      passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
      failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
      definite: true,
    };
  }
  const lines = combined.split(/\r?\n/);
  let tapPassed = 0;
  let tapFailed = 0;
  let tapSeen = false;
  for (const line of lines) {
    if (/^ok\b/.test(line.trim())) {
      tapSeen = true;
      tapPassed += 1;
    } else if (/^not ok\b/.test(line.trim())) {
      tapSeen = true;
      tapFailed += 1;
    }
  }
  if (tapSeen) {
    return { passed: tapPassed, failed: tapFailed, definite: true };
  }
  return { passed: 0, failed: 0, definite: false };
}

const testFiles = discoverTestFiles();

const BOX_W = 58;
const boxLine = s => `║${s.padEnd(BOX_W)}║`;

console.log('╔' + '═'.repeat(BOX_W) + '╗');
console.log(boxLine('           Everything Claude Code - Test Suite'));
console.log('╚' + '═'.repeat(BOX_W) + '╝');
console.log();

if (skipPatterns.length > 0) {
  console.log(`⚠ Skipped patterns: ${skipPatterns.join(', ')}`);
  console.log();
}

if (testFiles.length === 0) {
  console.log(`✗ No test files matched ${TEST_GLOB}${filter ? ` with filter "${filter}"` : ''}`);
  process.exit(1);
}

let totalPassed = 0;
let totalFailed = 0;
let filesPassed = 0;
let filesFailed = 0;
const failedFiles = [];

for (const testFile of testFiles) {
  const testPath = path.join(testsDir, testFile);
  const displayPath = testFile.split(path.sep).join('/');

  if (!fs.existsSync(testPath)) {
    console.log(`WARNING Skipping ${displayPath} (file not found)`);
    continue;
  }

  console.log(`\n━━━ Running ${displayPath} ━━━`);

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

  if (stdout) console.log(stdout);
  if (stderr) console.log(stderr);

  const combined = `${stdout}\n${stderr}`;
  const counts = parseCounts(combined);
  const processFailed = Boolean(result.error) || result.status !== 0;

  let failureReason;
  if (result.error) {
    failureReason = `failed to start: ${result.error.message}`;
  } else if (result.status !== 0) {
    failureReason = result.signal
      ? `terminated by signal ${result.signal}`
      : `exited with status ${result.status}`;
  } else if (counts.definite && counts.failed > 0) {
    failureReason = `reported ${counts.failed} failed tests`;
  }

  if (failureReason) {
    filesFailed += 1;
    failedFiles.push(displayPath);
    totalPassed += counts.passed;
    totalFailed += processFailed ? Math.max(counts.failed, 1) : counts.failed;
    console.log(`✗ ${displayPath} ${failureReason}`);
    annotateFailure(displayPath, failureReason, combined);
  } else {
    filesPassed += 1;
    if (counts.definite) {
      totalPassed += counts.passed;
      totalFailed += counts.failed;
    } else {
      totalPassed += 1;
    }
  }
}

const totalTests = totalPassed + totalFailed;

console.log('\n╔' + '═'.repeat(BOX_W) + '╗');
console.log(boxLine('                     Final Results'));
console.log('╠' + '═'.repeat(BOX_W) + '╣');
console.log(boxLine(`  Total Tests: ${String(totalTests).padStart(4)}`));
console.log(boxLine(`  Passed:      ${String(totalPassed).padStart(4)}  ✓`));
console.log(boxLine(`  Failed:      ${String(totalFailed).padStart(4)}  ${totalFailed > 0 ? '✗' : ' '}`));
console.log(boxLine(`  Files: ${filesPassed} passed, ${filesFailed} failed`));
if (failedFiles.length > 0) {
  console.log('╠' + '═'.repeat(BOX_W) + '╣');
  for (const name of failedFiles.slice(0, 10)) {
    console.log(boxLine(`  ✗ ${name}`.slice(0, BOX_W)));
  }
  if (failedFiles.length > 10) {
    console.log(boxLine(`  ... and ${failedFiles.length - 10} more`));
  }
}
console.log('╚' + '═'.repeat(BOX_W) + '╝');
console.log(`\nPassed: ${totalPassed}, Failed: ${totalFailed}`);

process.exit(totalFailed > 0 ? 1 : 0);
