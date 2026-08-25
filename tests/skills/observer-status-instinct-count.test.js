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

let passed = 0;

function toShellPath(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  return normalized.replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
}

// ── The counter must accept every extension the loader accepts ──

const cliSource = fs.readFileSync(instinctCli, 'utf8');
const allowedMatch = cliSource.match(/ALLOWED_INSTINCT_EXTENSIONS\s*=\s*\(([^)]*)\)/);
assert.ok(allowedMatch, 'ALLOWED_INSTINCT_EXTENSIONS not found in instinct-cli.py');
const allowedExtensions = allowedMatch[1]
  .split(',')
  .map(part => part.trim().replace(/^["']|["']$/g, ''))
  .filter(Boolean);
assert.ok(allowedExtensions.length >= 3, `expected several extensions, got ${allowedExtensions}`);
passed++;

const observerSource = fs.readFileSync(observerScript, 'utf8');
const statusCount = observerSource
  .split('\n')
  .filter(line => line.includes('instinct_count=') || line.includes('instinct_find_expr='))
  .join('\n');
assert.ok(statusCount, 'status branch no longer computes an instinct count');

for (const ext of allowedExtensions) {
  assert.ok(
    statusCount.includes(`*${ext}"`) || statusCount.includes(`*${ext}'`),
    `status count must match ${ext} — the loader accepts it (ALLOWED_INSTINCT_EXTENSIONS)`
  );
  passed++;
}

// Depth and case must match the loader: Path.iterdir() is top-level only and
// is_file() skips directories; suffix.lower() makes the match case-insensitive.
assert.ok(statusCount.includes('-maxdepth 1'), 'status count must not recurse — the loader does not');
assert.ok(statusCount.includes('-type f'), 'status count must skip directories');
assert.ok(!/-name\s+["']\*/.test(statusCount), 'status count must use case-insensitive -iname');
passed += 3;

// ── The shipped script, run for real ──

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

if (bashBinary && pythonCmd) {
  const syntax = spawnSync(bashBinary, ['-n', toShellPath(observerScript)], { encoding: 'utf8' });
  assert.strictEqual(syntax.status, 0, syntax.stderr);
  passed++;

  // The reported shape: every instinct on disk is a .md file.
  assert.strictEqual(runStatus(['a.md', 'b.md', 'c.md']), 3, 'markdown instincts must be counted');
  passed++;

  // Every accepted extension, mixed case, plus the two things the loader skips:
  // a non-instinct file and a nested directory.
  assert.strictEqual(
    runStatus(['a.md', 'b.yaml', 'c.yml', 'd.YAML', 'notes.txt', 'nested/deep.md']),
    4,
    'count must match the loader: every allowed extension, case-insensitive, top level only'
  );
  passed++;

  assert.strictEqual(runStatus([]), 0, 'an empty instincts directory must still report 0');
  passed++;
} else {
  console.log('  Integration coverage skipped (needs bash + python; set ECC_TEST_BASH/ECC_TEST_PYTHON)');
}

console.log(`  Passed: ${passed}`);
console.log('  Failed: 0');
