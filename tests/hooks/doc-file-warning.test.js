#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'doc-file-warning.js');

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

function runScript(input) {
  const result = spawnSync('node', [script], {
    encoding: 'utf8',
    input: JSON.stringify(input),
    timeout: 10000,
  });
  return { code: result.status || 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function parseHookOutput(stdout) {
  return JSON.parse(stdout);
}

function runTests() {
  console.log('\n=== Testing doc-file-warning.js (denylist policy) ===\n');
  let passed = 0;
  let failed = 0;

  // 1. Standard doc filenames - never on denylist, no warning
  const standardFiles = [
    'README.md',
    'CLAUDE.md',
    'AGENTS.md',
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    'LICENSE.md',
    'SKILL.md',
    'MEMORY.md',
    'WORKLOG.md',
  ];
  for (const file of standardFiles) {
    (test(`allows standard doc file: ${file}`, () => {
      const { code, stderr } = runScript({ tool_input: { file_path: file } });
      assert.strictEqual(code, 0, `expected exit code 0, got ${code}`);
      assert.strictEqual(stderr, '', `expected no warning for ${file}, got: ${stderr}`);
    }) ? passed++ : failed++);
  }

  // 2. Structured directory paths - no warning even for ad-hoc names
  const structuredDirPaths = [
    'docs/foo.md',
    'docs/guide/setup.md',
    'docs/TODO.md',
    'docs/specs/NOTES.md',
    'skills/bar.md',
    'skills/testing/tdd.md',
    '.history/session.md',
    'memory/patterns.md',
    '.claude/commands/deploy.md',
    '.claude/plans/roadmap.md',
    '.claude/projects/myproject.md',
    '.github/ISSUE_TEMPLATE/bug.md',
    'commands/triage.md',
    'benchmarks/test.md',
    'templates/DRAFT.md',
  ];
  for (const file of structuredDirPaths) {
    (test(`allows structured directory path: ${file}`, () => {
      const { code, stderr } = runScript({ tool_input: { file_path: file } });
      assert.strictEqual(code, 0, `expected exit code 0, got ${code}`);
      assert.strictEqual(stderr, '', `expected no warning for ${file}, got: ${stderr}`);
    }) ? passed++ : failed++);
  }

  // 3. Allowed .plan.md files - no warning
  (test('allows .plan.md files', () => {
    const { code, stderr } = runScript({ tool_input: { file_path: 'feature.plan.md' } });
    assert.strictEqual(code, 0);
    assert.strictEqual(stderr, '', `expected no warning for .plan.md, got: ${stderr}`);
  }) ? passed++ : failed++);

  (test('allows nested .plan.md files', () => {
    const { code, stderr } = runScript({ tool_input: { file_path: 'src/refactor.plan.md' } });
    assert.strictEqual(code, 0);
    assert.strictEqual(stderr, '', `expected no warning for nested .plan.md, got: ${stderr}`);
  }) ? passed++ : failed++);

  // 4. Non-md/txt files always pass - no warning
  const nonDocFiles = ['foo.js', 'app.py', 'styles.css', 'data.json', 'image.png'];
  for (const file of nonDocFiles) {
    (test(`allows non-doc file: ${file}`, () => {
      const { code, stderr } = runScript({ tool_input: { file_path: file } });
      assert.strictEqual(code, 0);
      assert.strictEqual(stderr, '', `expected no warning for ${file}, got: ${stderr}`);
    }) ? passed++ : failed++);
  }

  // 5. Lowercase, partial-match, and non-standard extension case - NOT on denylist
  const allowedNonDenylist = [
    'random-notes.md',
    'notes.txt',
    'scratch.md',
    'ideas.txt',
    'todo-list.md',
    'my-draft.md',
    'meeting-notes.txt',
    'TODO.MD',
    'NOTES.TXT',
  ];
  for (const file of allowedNonDenylist) {
    (test(`allows non-denylist doc file: ${file}`, () => {
      const { code, stderr } = runScript({ tool_input: { file_path: file } });
      assert.strictEqual(code, 0);
      assert.strictEqual(stderr, '', `expected no warning for ${file}, got: ${stderr}`);
    }) ? passed++ : failed++);
  }

  // 6. Ad-hoc denylist filenames at root/non-structured paths - SHOULD warn
  const deniedFiles = [
    'NOTES.md',
    'TODO.md',
    'SCRATCH.md',
    'TEMP.md',
    'DRAFT.txt',
    'BRAINSTORM.md',
    'SPIKE.md',
    'DEBUG.md',
    'WIP.txt',
    'src/NOTES.md',
    'lib/TODO.txt',
  ];
  for (const file of deniedFiles) {
    (test(`warns on ad-hoc denylist file: ${file}`, () => {
      const { code, stdout, stderr } = runScript({ tool_input: { file_path: file } });
      assert.strictEqual(code, 0, 'should still exit 0 (warn only)');
      assert.strictEqual(stderr, '', `expected visible warning via stdout JSON, got stderr: ${stderr}`);
      const output = parseHookOutput(stdout);
      const additionalContext = output.hookSpecificOutput?.additionalContext || '';
      assert.ok(additionalContext.includes('WARNING'), `expected warning in additionalContext for ${file}, got: ${stdout}`);
      assert.ok(additionalContext.includes(file), `expected file path in additionalContext for ${file}`);
    }) ? passed++ : failed++);
  }

  // 7. Windows backslash paths - normalized correctly
  (test('allows ad-hoc name in structured dir with backslash path', () => {
    const { code, stderr } = runScript({ tool_input: { file_path: 'docs\\specs\\NOTES.md' } });
    assert.strictEqual(code, 0);
    assert.strictEqual(stderr, '', 'expected no warning for structured dir with backslash');
  }) ? passed++ : failed++);

  (test('warns on ad-hoc name with backslash in non-structured dir', () => {
    const { code, stdout, stderr } = runScript({ tool_input: { file_path: 'src\\SCRATCH.md' } });
    assert.strictEqual(code, 0, 'should still exit 0');
    assert.strictEqual(stderr, '', `expected visible warning via stdout JSON, got stderr: ${stderr}`);
    assert.ok(parseHookOutput(stdout).hookSpecificOutput.additionalContext.includes('WARNING'), 'expected warning for non-structured backslash path');
  }) ? passed++ : failed++);

  // 8. Invalid/empty input - passes through without error
  (test('handles empty object input without error', () => {
    const { code, stderr } = runScript({});
    assert.strictEqual(code, 0);
    assert.strictEqual(stderr, '', `expected no warning for empty input, got: ${stderr}`);
  }) ? passed++ : failed++);

  (test('handles missing file_path without error', () => {
    const { code, stderr } = runScript({ tool_input: {} });
    assert.strictEqual(code, 0);
    assert.strictEqual(stderr, '', `expected no warning for missing file_path, got: ${stderr}`);
  }) ? passed++ : failed++);

  (test('handles empty file_path without error', () => {
    const { code, stderr } = runScript({ tool_input: { file_path: '' } });
    assert.strictEqual(code, 0);
    assert.strictEqual(stderr, '', `expected no warning for empty file_path, got: ${stderr}`);
  }) ? passed++ : failed++);

  // 9. Malformed input - passes through without error
  (test('handles non-JSON input without error', () => {
    const result = spawnSync('node', [script], {
      encoding: 'utf8',
      input: 'not-json',
      timeout: 10000,
    });
    assert.strictEqual(result.status || 0, 0);
    assert.strictEqual(result.stderr || '', '');
    assert.strictEqual(result.stdout, 'not-json');
  }) ? passed++ : failed++);

  // 10. Stdout always contains the original input (pass-through)
  (test('passes through input to stdout for allowed file', () => {
    const input = { tool_input: { file_path: 'README.md' } };
    const { stdout } = runScript(input);
    assert.strictEqual(stdout, JSON.stringify(input));
  }) ? passed++ : failed++);

  (test('emits visible additionalContext JSON for warned file', () => {
    const input = { tool_input: { file_path: 'TODO.md' } };
    const { stdout } = runScript(input);
    const output = parseHookOutput(stdout);
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.ok(output.hookSpecificOutput.additionalContext.includes('TODO.md'));
  }) ? passed++ : failed++);

  (test('passes through input to stdout for empty input', () => {
    const input = {};
    const { stdout } = runScript(input);
    assert.strictEqual(stdout, JSON.stringify(input));
  }) ? passed++ : failed++);

  // 11. Regression: requiring the hook in-process (run-with-flags fast path) must not
  //     attach module-scope stdin listeners to the dispatcher process.
  (test('require() does not attach stdin listeners (in-process safe)', () => {
    const resolved = require.resolve(script);
    delete require.cache[resolved];
    const endBefore = process.stdin.listenerCount('end');
    const dataBefore = process.stdin.listenerCount('data');
    const mod = require(resolved);
    assert.strictEqual(process.stdin.listenerCount('end'), endBefore,
      'require() must not attach a stdin "end" listener');
    assert.strictEqual(process.stdin.listenerCount('data'), dataBefore,
      'require() must not attach a stdin "data" listener');
    assert.strictEqual(typeof mod.run, 'function', 'run() must remain exported');
    assert.strictEqual(typeof mod.main, 'function', 'main() must be exported for entrypoints');
  }) ? passed++ : failed++);

  // 12. Regression: exported run() still classifies correctly in-process, no stdin needed.
  (test('exported run() works in-process for warned and allowed files', () => {
    delete require.cache[require.resolve(script)];
    const { run } = require(script);
    const warned = run(JSON.stringify({ tool_input: { file_path: 'TODO.md' } }));
    assert.ok(Array.isArray(warned.additionalContext)
      && warned.additionalContext.join('\n').includes('WARNING'),
      'warned file should return additionalContext with WARNING');
    const allowed = run(JSON.stringify({ tool_input: { file_path: 'README.md' } }));
    assert.ok(!('additionalContext' in allowed), 'allowed file should not return additionalContext');
  }) ? passed++ : failed++);

  // 13. Regression: pre-write-doc-warn.js backward-compat entrypoint still emits the warning.
  (test('pre-write-doc-warn.js shim still warns via main()', () => {
    const shim = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-write-doc-warn.js');
    const r = spawnSync('node', [shim], {
      encoding: 'utf8',
      input: JSON.stringify({ tool_input: { file_path: 'TODO.md' } }),
      timeout: 10000,
    });
    assert.strictEqual(r.status || 0, 0, 'shim should exit 0');
    assert.ok(JSON.parse(r.stdout).hookSpecificOutput.additionalContext.includes('TODO.md'),
      'shim should still emit the ad-hoc filename warning');
  }) ? passed++ : failed++);

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
