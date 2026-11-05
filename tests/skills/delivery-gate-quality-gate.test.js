/**
 * Subprocess tests for skills/delivery-gate/hooks/quality-gate.py.
 *
 * Run with: node tests/skills/delivery-gate-quality-gate.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'skills', 'delivery-gate', 'hooks', 'quality-gate.py');

function findPython() {
  const candidates = [
    { command: process.env.PYTHON, args: [] },
    { command: 'python3', args: [] },
    { command: 'python', args: [] },
    { command: 'py', args: ['-3'] },
  ].filter(candidate => candidate.command);

  // Probe for Python 3 itself: a Python 2 `--version` also exits 0, but the
  // driver below needs importlib.util.
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, '-c', 'import sys; sys.exit(sys.version_info[0] != 3)'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    if (result.status === 0) {
      return candidate;
    }
  }
  return null;
}

const PYTHON = findPython();

// Load the hyphenated hook file as a module and pin the disk check (free GB in
// argv[2]), so the result does not depend on the test machine's free space.
const DRIVER = [
  'import importlib.util, sys',
  'spec = importlib.util.spec_from_file_location("quality_gate", sys.argv[1])',
  'm = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(m)',
  'm.check_disk = lambda: int(sys.argv[2])',
  'm.main()',
].join('\n');

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

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-gate-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'My Project_v1.2');
  fs.mkdirSync(project, { recursive: true });

  // Claude Code maps every non-alphanumeric character to '-'.
  const encoded = project.replace(/[^A-Za-z0-9]/g, '-');
  const memDir = path.join(home, '.claude', 'projects', encoded, 'memory');
  fs.mkdirSync(memDir, { recursive: true }); // present, but no learning libs

  const transcript = path.join(root, 'transcript.jsonl');
  fs.writeFileSync(transcript, [1, 2, 3]
    .map(i => JSON.stringify({ type: 'tool_use', name: 'Edit', input: { file_path: `f${i}.js` } }))
    .join('\n'), 'utf8');

  return { root, home, project, memDir, transcript };
}

function runHook(ctx, payload, diskFreeGb = 100) {
  return spawnSync(PYTHON.command, [...PYTHON.args, '-c', DRIVER, SCRIPT, String(diskFreeGb)], {
    input: JSON.stringify({ transcript_path: ctx.transcript, ...payload }),
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home, CLAUDE_PROJECT_DIR: ctx.project },
  });
}

function runTests() {
  console.log('\n=== Testing delivery-gate quality-gate.py ===\n');

  if (!PYTHON) {
    console.log('  - skipped: python not found');
    console.log('\nPassed: 0');
    console.log('Failed: 0');
    return;
  }

  let passed = 0;
  let failed = 0;
  const ctx = setup();

  try {
    if (test('finds the memory dir of a project path with spaces and punctuation', () => {
      const result = runHook(ctx, {});
      assert.strictEqual(result.status, 2, `expected block, got ${result.status}: ${result.stderr}`);
      assert.match(result.stderr, /learning libs stale/);
      assert.ok(!result.stderr.includes('No project memory directory found'), result.stderr);
    })) passed++; else failed++;

    if (test('blocks on critical disk space when stop_hook_active is absent', () => {
      const result = runHook(ctx, {}, 1);
      assert.strictEqual(result.status, 2, `expected block, got ${result.status}: ${result.stderr}`);
      assert.match(result.stderr, /Blocked: disk space/);
    })) passed++; else failed++;

    if (test('does not block again when stop_hook_active is true', () => {
      const result = runHook(ctx, { stop_hook_active: true }, 1);
      assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    })) passed++; else failed++;
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

runTests();
