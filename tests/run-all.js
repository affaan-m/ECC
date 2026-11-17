#!/usr/bin/env node

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { performance } = require('perf_hooks');

const testsDir = __dirname;
const repoRoot = path.resolve(testsDir, '..');
const TEST_GLOB = 'tests/**/*.test.js';
const filter = (((process.argv || [])[2]) || '').split(path.sep).join('/');
const splitPatterns = value => (value || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
// ECC_TEST_SKIP drops files whose path contains any pattern; ECC_TEST_ONLY keeps
// just the files whose path contains one. CI's package-manager lanes use ONLY to
// run the handful of suites that read CLAUDE_CODE_PACKAGE_MANAGER.
const skipPatterns = splitPatterns(process.env.ECC_TEST_SKIP);
const onlyPatterns = splitPatterns(process.env.ECC_TEST_ONLY);
// ECC_TEST_SERIAL names suites that mutate the shared checkout (for example
// the opencode dist build and the installers that copy from it). The pool
// holds them back and runs them one at a time after every other file.
const serialPatterns = splitPatterns(process.env.ECC_TEST_SERIAL);
// ECC_TEST_JOBS above 1 runs files through a worker pool of that many
// processes. The default is 1: the original synchronous loop, unchanged.
// Output stays grouped per file whatever the pool size.
const jobs = Math.max(1, Math.floor(Number(process.env.ECC_TEST_JOBS)) || 1);

function matchesTestGlob(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (filter && !normalized.includes(filter)) {
    return false;
  }
  if (skipPatterns.some(pattern => normalized.includes(pattern))) {
    return false;
  }
  if (onlyPatterns.length > 0 && !onlyPatterns.some(pattern => normalized.includes(pattern))) {
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
  // Nested runner diagnostics may contain earlier summaries. The file's last
  // standalone summary owns its totals; mentions inside diagnostics do not.
  const summaries = [...combined.matchAll(/^[ \t]*(?:(?:[^\r\n:]+:[ \t]*)?Results:[ \t]*)?(Passed|Failed):[ \t]*(\d+)(?:[ \t]*,?[ \t]+(Passed|Failed):[ \t]*(\d+))?(?:[ \t]*,[ \t]*Skipped:[ \t]*\d+)?[ \t]*\r?$/gm)];
  if (summaries.length) {
    let passed = 0;
    let failed = 0;
    for (const summary of summaries) {
      if (summary[1] === 'Passed') {
        passed = Number(summary[2]);
        failed = 0;
      } else failed = Number(summary[2]);
      if (summary[3] === 'Passed') passed = Number(summary[4]);
      else if (summary[3] === 'Failed') failed = Number(summary[4]);
    }
    return { passed, failed, definite: true };
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

const testFiles = Object.freeze(discoverTestFiles());
const plannedFiles = Object.freeze(testFiles.map(file => file.split(path.sep).join('/')));
const plannedSet = new Set(plannedFiles);
const attempts = new Map();
const records = new Map();
const integrityErrors = [];
if (plannedSet.size !== plannedFiles.length) integrityErrors.push('Duplicate files in execution plan');
console.log(`ECC_TEST_PLAN ${JSON.stringify({ jobs, files: plannedFiles })}`);

const BOX_W = 58;
const boxLine = s => `║${s.padEnd(BOX_W)}║`;

console.log('╔' + '═'.repeat(BOX_W) + '╗');
console.log(boxLine('           ECC - Test Suite'));
console.log('╚' + '═'.repeat(BOX_W) + '╝');
console.log();

if (skipPatterns.length > 0) {
  console.log(`Skipped patterns: ${skipPatterns.join(', ')}`);
  console.log();
}
if (onlyPatterns.length > 0) {
  console.log(`Only patterns: ${onlyPatterns.join(', ')}`);
  console.log();
}
if (jobs > 1) {
  console.log(`Running ${testFiles.length} files with ${jobs} parallel jobs${serialPatterns.length ? `, serial after the pool: ${serialPatterns.join(', ')}` : ''}`);
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

function childEnvFor() {
  const childEnv = { ...process.env };
  // Git context would leak into fixtures; ONLY and JOBS are runner controls and
  // must not reach suites that spawn the runner themselves.
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'ECC_TEST_ONLY', 'ECC_TEST_JOBS', 'ECC_TEST_SERIAL', 'ECC_TEST_REPORT']) {
    delete childEnv[key];
  }
  return childEnv;
}

function runTestFileSync(testFile) {
  return spawnSync('node', [path.join(testsDir, testFile)], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnvFor()
  });
}

function runTestFile(testFile) {
  const testPath = path.join(testsDir, testFile);
  const childEnv = childEnvFor();
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn('node', [testPath], { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });
    } catch (error) {
      resolve({ error, status: null, signal: null, stdout, stderr });
      return;
    }
    // spawnSync with piped stdio and no input hands the child a closed stdin;
    // spawn leaves it open, and a suite that reads stdin would wait forever.
    child.stdin.end();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => resolve({ error, status: null, signal: null, stdout, stderr }));
    child.on('close', (status, signal) => resolve({ error: null, status, signal, stdout, stderr }));
  });
}

function reportTestFile(displayPath, result) {
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  console.log(`\n━━━ Running ${displayPath} ━━━`);
  if (stdout) console.log(stdout);
  if (stderr) console.log(stderr);

  const combined = `${stdout}\n${stderr}`;
  // Counts belong to stdout when a suite prints its summary there. Stderr is
  // diagnostic output and may quote the failing nested process verbatim.
  const stdoutCounts = parseCounts(stdout);
  const counts = stdoutCounts.definite ? stdoutCounts : parseCounts(stderr);
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
    }
  }
  return failureReason || null;
}

function beginTestFile(testFile, phase) {
  const file = testFile.split(path.sep).join('/');
  if (!plannedSet.has(file) || attempts.has(file)) {
    throw new Error(`Unplanned or duplicate test attempt: ${file}`);
  }
  const attempt = { file, phase, attemptedAt: new Date().toISOString(), clock: performance.now() };
  attempts.set(file, attempt);
  return attempt;
}

function completeTestFile(attempt, result) {
  if (attempts.get(attempt.file) !== attempt || records.has(attempt.file)) {
    throw new Error(`Unplanned or duplicate test completion: ${attempt.file}`);
  }
  const completedAt = new Date().toISOString();
  const durationMs = performance.now() - attempt.clock;
  const failureReason = reportTestFile(attempt.file, result);
  const record = {
    file: attempt.file, phase: attempt.phase, attemptedAt: attempt.attemptedAt,
    completedAt, durationMs, exitCode: result.status ?? null, signal: result.signal || null,
    error: result.error ? result.error.message : failureReason,
    outcome: failureReason ? 'failed' : 'passed'
  };
  records.set(attempt.file, record);
  console.log(`ECC_TEST_FILE ${JSON.stringify(record)}`);
}

function runAllSync() {
  // Never drop a discovered file: a file removed by another suite must fail.
  for (const testFile of testFiles) {
    const attempt = beginTestFile(testFile, 'serial');
    completeTestFile(attempt, runTestFileSync(testFile));
  }
}

function isSerial(testFile) {
  const normalized = testFile.split(path.sep).join('/');
  return serialPatterns.some(pattern => normalized.includes(pattern));
}

async function runAllParallel() {
  const queue = testFiles.filter(testFile => !isSerial(testFile));
  const serial = testFiles.filter(isSerial);
  const worker = async () => {
    while (queue.length > 0) {
      const testFile = queue.shift();
      const attempt = beginTestFile(testFile, 'pool');
      const result = await runTestFile(testFile);
      completeTestFile(attempt, result);
    }
  };
  const workers = await Promise.allSettled(Array.from({ length: Math.min(jobs, queue.length) }, worker));
  for (const result of workers) {
    if (result.status === 'rejected') integrityErrors.push(result.reason.message || String(result.reason));
  }
  if (serial.length > 0) console.log(`\nRunning ${serial.length} serial files after the pool`);
  for (const testFile of serial) {
    const attempt = beginTestFile(testFile, 'serial');
    completeTestFile(attempt, await runTestFile(testFile));
  }
}

function finish() {
  for (const file of plannedFiles) {
    if (!attempts.has(file) || !records.has(file)) integrityErrors.push(`Incomplete planned file: ${file}`);
  }
  if (records.size !== plannedFiles.length || filesPassed + filesFailed !== plannedFiles.length) {
    integrityErrors.push('Execution counts do not match the plan');
  }
  const report = {
    version: 1, jobs, plannedFiles,
    records: plannedFiles.filter(file => records.has(file)).map(file => records.get(file)),
    integrity: { ok: integrityErrors.length === 0, errors: integrityErrors },
    counts: {
      planned: plannedFiles.length, attempted: attempts.size, completed: records.size,
      passed: filesPassed, failed: filesFailed
    }
  };
  if (process.env.ECC_TEST_REPORT) {
    try {
      fs.mkdirSync(path.dirname(process.env.ECC_TEST_REPORT), { recursive: true });
      fs.writeFileSync(process.env.ECC_TEST_REPORT, `${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
      integrityErrors.push(`Cannot write execution report: ${error.message}`);
    }
  }
  console.log(`ECC_TEST_COMPLETE ${JSON.stringify({ counts: report.counts, integrity: { ok: integrityErrors.length === 0, errors: integrityErrors } })}`);
  for (const error of integrityErrors) console.log(`Execution integrity error: ${error}`);
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

  process.exitCode = totalFailed > 0 || integrityErrors.length > 0 ? 1 : 0;
}

function failRun(error) {
  integrityErrors.push(error.message || String(error));
  finish();
}

if (jobs > 1) {
  runAllParallel().then(finish, failRun);
} else {
  try {
    runAllSync();
    finish();
  } catch (error) {
    failRun(error);
  }
}
