/**
 * Regression tests for #2859: `start-observer.sh status` counted only *.yaml.
 *
 * The producer writes `<id>.md` (agents/observer-loop.sh instructs the analyzer
 * to) and the loader accepts .yaml/.yml/.md (ALLOWED_INSTINCT_EXTENSIONS in
 * scripts/instinct-cli.py), so the one command an operator runs to confirm that
 * learning works reported `Instincts: 0` on a working install — and an operator
 * cannot tell that apart from a silently dead observer.
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillRoot = path.join(repoRoot, 'skills', 'continuous-learning-v2');
const observerScript = path.join(skillRoot, 'agents', 'start-observer.sh');
const detectProject = path.join(skillRoot, 'scripts', 'detect-project.sh');
const instinctCli = path.join(skillRoot, 'scripts', 'instinct-cli.py');
const bashBinary = process.env.ECC_TEST_BASH || (process.platform === 'win32' ? null : 'bash');

function toShellPath(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  return normalized.replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
}

function readAllowedExtensions() {
  const cliSource = fs.readFileSync(instinctCli, 'utf8');
  const match = cliSource.match(/ALLOWED_INSTINCT_EXTENSIONS\s*=\s*\(([^)]*)\)/);
  assert.ok(match, 'ALLOWED_INSTINCT_EXTENSIONS not found in instinct-cli.py');
  return match[1]
    .split(',')
    .map(part => part.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function readStatusCounter() {
  const observerSource = fs.readFileSync(observerScript, 'utf8');
  const counter = observerSource
    .split('\n')
    .filter(line => line.includes('instinct_count=') || line.includes('instinct_find_expr='))
    .join('\n');
  assert.ok(counter, 'status branch no longer computes an instinct count');
  return counter;
}

function resolvePython() {
  for (const candidate of [process.env.ECC_TEST_PYTHON, 'python3', 'python']) {
    if (!candidate) continue;
    const probe = spawnSync(candidate, ['-c', 'print(1)'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const pythonCmd = bashBinary ? resolvePython() : null;

function runStatus(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observer-'));
  try {
    const projectDir = path.join(tmp, 'proj');
    fs.mkdirSync(projectDir, { recursive: true });
    const writes = files
      .map(name => `printf 'id: x' > "$INST/${name}"`)
      .join('\n      ');
    const script = [
      `source "${toShellPath(detectProject)}"`,
      'INST="$PROJECT_DIR/instincts/personal"',
      'mkdir -p "$INST/nested"',
      writes,
      ': > "$PROJECT_DIR/observations.jsonl"',
      'sleep 10 &',
      'OBSERVER_PID=$!',
      'echo "$OBSERVER_PID" > "$PROJECT_DIR/.observer.pid"',
      `bash "${toShellPath(observerScript)}" status`,
      'status=$?',
      'kill "$OBSERVER_PID" 2>/dev/null || true',
      'exit $status',
    ].join('\n');
    const result = spawnSync(bashBinary, ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CLV2_HOMUNCULUS_DIR: toShellPath(path.join(tmp, 'homunculus')),
        CLAUDE_PROJECT_DIR: toShellPath(projectDir),
        CLV2_PYTHON_CMD: pythonCmd,
      },
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const line = (result.stdout || '').split('\n').find(l => l.startsWith('Instincts:'));
    assert.ok(line, `no "Instincts:" line in status output:\n${result.stdout}`);
    return Number(line.split(':')[1].trim());
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function buildTests() {
  const tests = [];

  // ── The counter must accept every extension the loader accepts ──

  tests.push(['the loader still declares several instinct extensions', () => {
    const allowed = readAllowedExtensions();
    assert.ok(allowed.length >= 3, `expected several extensions, got ${allowed}`);
  }]);

  for (const ext of readAllowedExtensions()) {
    tests.push([`status counts ${ext} — the loader accepts it`, () => {
      const counter = readStatusCounter();
      assert.ok(
        counter.includes(`*${ext}"`) || counter.includes(`*${ext}'`),
        `status count must match ${ext} (ALLOWED_INSTINCT_EXTENSIONS)`
      );
    }]);
  }

  // Depth and case must match the loader: Path.iterdir() is top-level only and
  // is_file() skips directories; suffix.lower() makes the match case-insensitive.
  tests.push(['status does not recurse — the loader does not', () => {
    assert.ok(readStatusCounter().includes('-maxdepth 1'));
  }]);
  tests.push(['status skips directories', () => {
    assert.ok(readStatusCounter().includes('-type f'));
  }]);
  tests.push(['status matches case-insensitively', () => {
    assert.ok(!/-name\s+["']\*/.test(readStatusCounter()),
      'status count must use -iname, not -name');
  }]);

  // ── The shipped script, run for real ──

  if (!(bashBinary && pythonCmd)) return tests;

  tests.push(['start-observer.sh parses', () => {
    const syntax = spawnSync(bashBinary, ['-n', toShellPath(observerScript)], { encoding: 'utf8' });
    assert.strictEqual(syntax.status, 0, syntax.stderr);
  }]);

  // The reported shape: every instinct on disk is a .md file.
  tests.push(['markdown instincts are counted', () => {
    assert.strictEqual(runStatus(['a.md', 'b.md', 'c.md']), 3);
  }]);

  // Every accepted extension, mixed case, plus the two things the loader skips:
  // a non-instinct file and a nested directory.
  tests.push(['the count matches the loader exactly', () => {
    assert.strictEqual(
      runStatus(['a.md', 'b.yaml', 'c.yml', 'd.YAML', 'notes.txt', 'nested/deep.md']),
      4
    );
  }]);

  tests.push(['an empty instincts directory reports 0', () => {
    assert.strictEqual(runStatus([]), 0);
  }]);

  return tests;
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

function main() {
  console.log('\n=== Testing observer status instinct count (#2859) ===\n');

  let passed = 0;
  let failed = 0;
  let tests;

  // Collecting the cases reads instinct-cli.py and start-observer.sh, so a
  // missing or renamed file has to be reported as a failure rather than crash
  // the process — tests/run-all.js totals the "Passed:"/"Failed:" tokens below.
  try {
    tests = buildTests();
  } catch (error) {
    console.log('  ✗ could not build the test list');
    console.error(`    ${error.message}`);
    tests = [];
    failed += 1;
  }

  for (const [name, fn] of tests) {
    if (runTest(name, fn)) passed += 1;
    else failed += 1;
  }

  if (!(bashBinary && pythonCmd)) {
    console.log('  - integration coverage skipped (needs bash + python; set ECC_TEST_BASH/ECC_TEST_PYTHON)');
  }

  console.log(`\n  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  // exitCode, not exit(1): stdout is async when it is a pipe, which is how
  // tests/run-all.js runs this, and process.exit() does not wait for pending
  // writes — it could drop the two lines above, which the aggregator totals.
  if (failed > 0) process.exitCode = 1;
}

main();
