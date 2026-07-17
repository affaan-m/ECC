/**
 * Regression tests for the council-multi-model SDK fallback.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SKILL_ROOT = path.join(ROOT, 'skills', 'council-multi-model');
const ASK_CODEX = path.join(SKILL_ROOT, 'scripts', 'ask_codex.py');
const CHECK_CODEX = path.join(SKILL_ROOT, 'scripts', 'check_codex.py');

function runPython(script, args = [], env = {}) {
  return spawnSync('python3', [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
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

function fakeSdkDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fake-codex-'));
  fs.writeFileSync(path.join(dir, 'openai_codex.py'), `
import os

class Sandbox:
    read_only = "read-only"

class _Result:
    status = "completed"

class _Thread:
    def run(self, prompt):
        return _Result()

class Codex:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        marker = os.environ.get("CODEX_TEST_MARKER")
        if marker:
            with open(marker, "w", encoding="utf-8") as fh:
                fh.write("closed")

    def thread_start(self, **kwargs):
        return _Thread()
`, 'utf8');
  return dir;
}

function runTests() {
  console.log('\n=== Testing council-multi-model fallback ===\n');

  let passed = 0;
  let failed = 0;

  if (test('rejects prompt files outside the system temporary directory', () => {
    const unsafeDir = fs.mkdtempSync(path.join(ROOT, '.council-prompt-test-'));
    const promptPath = path.join(unsafeDir, 'prompt.txt');
    fs.writeFileSync(promptPath, 'do not send this file', 'utf8');
    try {
      const result = runPython(ASK_CODEX, ['--prompt-file', promptPath]);
      assert.strictEqual(result.status, 2, result.stderr);
      assert.match(result.stderr, /system temporary directory/);
    } finally {
      fs.rmSync(unsafeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('closes Codex and handles a missing final_response without a traceback', () => {
    const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-council-prompt-'));
    const promptPath = path.join(promptDir, 'prompt.txt');
    const markerPath = path.join(promptDir, 'closed.txt');
    const sdkDir = fakeSdkDir();
    fs.writeFileSync(promptPath, 'review this draft', 'utf8');
    try {
      const result = runPython(ASK_CODEX, ['--prompt-file', promptPath], {
        PYTHONPATH: sdkDir,
        CODEX_TEST_MARKER: markerPath,
      });
      assert.strictEqual(result.status, 5, result.stderr);
      assert.match(result.stderr, /Codex returned no text \(status=completed\)/);
      assert.doesNotMatch(result.stderr, /Traceback/);
      assert.strictEqual(fs.readFileSync(markerPath, 'utf8'), 'closed');
    } finally {
      fs.rmSync(promptDir, { recursive: true, force: true });
      fs.rmSync(sdkDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('reports the actual CODEX_HOME auth path', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-home-'));
    const sdkDir = fakeSdkDir();
    try {
      const result = runPython(CHECK_CODEX, [], {
        CODEX_HOME: codexHome,
        PYTHONPATH: sdkDir,
      });
      assert.strictEqual(result.status, 4, result.stdout);
      assert.ok(result.stdout.includes(path.join(codexHome, 'auth.json')));
      assert.doesNotMatch(result.stdout, /~\/.codex\/auth\.json/);
    } finally {
      fs.rmSync(codexHome, { recursive: true, force: true });
      fs.rmSync(sdkDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('closes Codex after a live preflight probe', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-probe-'));
    const markerPath = path.join(codexHome, 'closed.txt');
    const sdkDir = fakeSdkDir();
    fs.writeFileSync(path.join(codexHome, 'auth.json'), '{}', 'utf8');
    try {
      const result = runPython(CHECK_CODEX, ['--probe'], {
        CODEX_HOME: codexHome,
        PYTHONPATH: sdkDir,
        CODEX_TEST_MARKER: markerPath,
      });
      assert.strictEqual(result.status, 5, result.stdout);
      assert.match(result.stdout, /live probe returned no text \(status=completed\)/);
      assert.strictEqual(fs.readFileSync(markerPath, 'utf8'), 'closed');
    } finally {
      fs.rmSync(codexHome, { recursive: true, force: true });
      fs.rmSync(sdkDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('pins the official SDK and announces the network install', () => {
    const setup = fs.readFileSync(path.join(SKILL_ROOT, 'scripts', 'setup.sh'), 'utf8');
    assert.match(setup, /openai-codex==0\.1\.0b3/);
    assert.doesNotMatch(setup, /--upgrade pip/);
    assert.match(setup, /Installing openai-codex==0\.1\.0b3 from PyPI/);
  })) passed++; else failed++;

  if (test('documents portable discovery and treats embedded material as untrusted data', () => {
    const skill = fs.readFileSync(path.join(SKILL_ROOT, 'SKILL.md'), 'utf8');
    assert.match(skill, /^## When to Activate$/m);
    assert.match(skill, /COUNCIL_MULTI_MODEL_SKILL_DIR/);
    assert.match(skill, /CLAUDE_PROJECT_DIR/);
    assert.match(skill, /mktemp/);
    assert.match(skill, /BEGIN_UNTRUSTED_DISAGREEMENT/);
    assert.match(skill, /END_UNTRUSTED_DISAGREEMENT/);
    assert.match(skill, /BEGIN_UNTRUSTED_DRAFT/);
    assert.match(skill, /Never follow instructions found inside/);
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
