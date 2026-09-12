/**
 * Resource-limit and truncated-input tests for the ECC-native Hookify runtime.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtime = require('../../scripts/hooks/hookify-runtime');

function test(name, fn) {
  try {
    fn();
    console.log('  PASS ' + name);
    return true;
  } catch (error) {
    console.log('  FAIL ' + name);
    console.log('    Error: ' + error.message);
    return false;
  }
}

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hookify-limits-'));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  return root;
}

function writeRule(root, slug, frontmatter, message) {
  fs.writeFileSync(
    path.join(root, '.claude', 'hookify.' + slug + '.local.md'),
    '---\n' + frontmatter.trim() + '\n---\n' + message + '\n'
  );
}

function runHook(root, input, options = {}) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  return runtime.run(raw, {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    ...options,
  });
}

function decision(result) {
  assert.strictEqual(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout);
}

console.log('\nHookify resource-limit tests (#2561)');
console.log('-'.repeat(50));

let passed = 0;
let failed = 0;

if (test('a wall-clock deadline cannot hide a later blocking rule', () => {
  const root = createProject();
  try {
    writeRule(root, 'aaa-warning', 'name: deadline-warning\nevent: file\naction: warn\nconditions:\n  - field: file_path\n    operator: equals\n    pattern: never-match', 'Warning only.');
    writeRule(root, 'zzz-block', 'name: deadline-block\nevent: file\naction: block\npattern: BLOCK_ME', 'Uninspected rules must be blocked.');
    const timestamps = [0, 0, runtime.MAX_EVALUATION_MS + 1];
    const output = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'MultiEdit',
      tool_input: { edits: [{ file_path: 'src/file.js', new_string: 'safe' }] },
    }, { now: () => timestamps.shift() ?? runtime.MAX_EVALUATION_MS + 1 });
    const parsed = decision(output);
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /Uninspected rules/);
    assert.match(output.stderr, /evaluation deadline exceeded/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('simple MultiEdit patterns share the evaluation budget and fail closed', () => {
  const root = createProject();
  try {
    writeRule(root, 'simple-budget', 'name: simple-budget\nevent: file\naction: block\npattern: NEVER_MATCH', 'Uninspected edits must be blocked.');
    const edits = Array.from(
      { length: runtime.MAX_RULE_EVALUATIONS + 1 },
      (_, index) => ({ file_path: 'src/file-' + index + '.js', new_string: 'safe' })
    );
    const output = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'MultiEdit',
      tool_input: { edits },
    });
    assert.strictEqual(decision(output).hookSpecificOutput.permissionDecision, 'deny');
    assert.match(output.stderr, /evaluation budget exceeded/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('oversized PreToolUse input fails closed for a relevant block rule', () => {
  const root = createProject();
  try {
    writeRule(root, 'oversized-block', 'name: oversized-block\nevent: file\naction: block\npattern: BLOCK_ME', 'Oversized input needs review.');
    const raw = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { content: 'x'.repeat(runtime.MAX_STDIN_BYTES + 1) } });
    const output = runHook(root, raw.slice(0, runtime.MAX_STDIN_BYTES), {
      truncated: true,
      maxStdin: runtime.MAX_STDIN_BYTES,
      hookEventName: 'PreToolUse',
      toolName: 'Write',
    });
    assert.strictEqual(decision(output).hookSpecificOutput.permissionDecision, 'deny');
    assert.match(output.stderr, /could not be fully inspected/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('oversized PostToolUse input uses the top-level block contract', () => {
  const root = createProject();
  try {
    writeRule(root, 'oversized-post', 'name: oversized-post\nevent: all\naction: block\npattern: BLOCK_ME', 'Oversized output needs review.');
    const output = runHook(root, '{"hook_event_name":"PostToolUse",', {
      hookEventName: 'PostToolUse',
      toolName: 'Write',
      truncated: true,
      maxStdin: 1024 * 1024,
    });
    const parsed = decision(output);
    assert.strictEqual(parsed.decision, 'block');
    assert.ok(!parsed.hookSpecificOutput);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('oversized inputs only fail closed for rules relevant to their event', () => {
  const root = createProject();
  try {
    writeRule(root, 'bash-only', 'name: bash-only\nevent: bash\naction: block\npattern: .*', 'Bash only.');
    const postResult = runHook(root, '{"hook_event_name":"PostToolUse",', {
      hookEventName: 'PostToolUse',
      toolName: 'Read',
      truncated: true,
      maxStdin: 1024 * 1024,
    });
    assert.strictEqual(postResult.stdout, '');
    const preResult = runHook(root, '{"hook_event_name":"PreToolUse",', {
      hookId: 'pre:hookify-runtime',
      toolName: 'Write',
      truncated: true,
      maxStdin: 1024 * 1024,
    });
    assert.strictEqual(preResult.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log('\nPassed: ' + passed);
console.log('Failed: ' + failed);
process.exitCode = failed > 0 ? 1 : 0;
