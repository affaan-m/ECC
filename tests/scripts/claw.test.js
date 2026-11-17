/**
 * Tests for scripts/claw.js
 *
 * Tests the NanoClaw agent REPL module — storage, context, delegation, meta.
 *
 * Run with: node tests/scripts/claw.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  getClawDir,
  getSessionPath,
  listSessions,
  loadHistory,
  appendTurn,
  loadECCContext,
  buildPrompt,
  askClaude,
  isValidSessionName,
  handleClear,
  getSessionMetrics,
  searchSessions,
  branchSession,
  exportSession,
  compactSession
} = require(path.join(__dirname, '..', '..', 'scripts', 'claw.js'));

// Test helper — matches ECC's custom test pattern
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    if (err.stack) { console.log(`    Stack: ${err.stack}`); }
    return false;
  }
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claw-test-'));
}

// askClaude() spawns whatever `claude` is on PATH. The askClaude tests pin
// PATH (same helpers as tests/hooks/pre-bash-commit-quality.test.js) so they
// never start a developer's real Claude CLI.
function pathEnvKey() {
  return Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';
}

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    process.env[key] = overrides[key];
  }

  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (typeof previous[key] === 'string') {
        process.env[key] = previous[key];
      } else {
        delete process.env[key];
      }
    }
  }
}

function writeClaudeStub(binDir, lines) {
  fs.writeFileSync(path.join(binDir, 'claude'), ['#!/bin/sh', ...lines, ''].join('\n'), { mode: 0o755 });
}

function runTests() {
  console.log('\n=== Testing claw.js ===\n');

  let passed = 0;
  let failed = 0;

  // ── Storage tests (6) ──────────────────────────────────────────────────

  console.log('Storage:');

  if (test('getClawDir() returns path ending in .claude/claw', () => {
    const dir = getClawDir();
    assert.ok(dir.endsWith(path.join('.claude', 'claw')),
      `Expected path ending in .claude/claw, got: ${dir}`);
  })) passed++; else failed++;

  if (test('getSessionPath("foo") returns correct .md path', () => {
    const p = getSessionPath('foo');
    assert.ok(p.endsWith(path.join('.claude', 'claw', 'foo.md')),
      `Expected path ending in .claude/claw/foo.md, got: ${p}`);
  })) passed++; else failed++;

  if (test('listSessions() returns empty array for empty dir', () => {
    const tmpDir = makeTmpDir();
    try {
      const sessions = listSessions(tmpDir);
      assert.deepStrictEqual(sessions, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('listSessions() finds .md files and strips extension', () => {
    const tmpDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir, 'alpha.md'), 'test');
      fs.writeFileSync(path.join(tmpDir, 'beta.md'), 'test');
      fs.writeFileSync(path.join(tmpDir, 'not-a-session.txt'), 'test');
      const sessions = listSessions(tmpDir);
      assert.ok(sessions.includes('alpha'), 'Should find alpha');
      assert.ok(sessions.includes('beta'), 'Should find beta');
      assert.strictEqual(sessions.length, 2, 'Should only find .md files');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('loadHistory() returns "" for non-existent file', () => {
    const result = loadHistory('/tmp/claw-test-nonexistent-' + Date.now() + '.md');
    assert.strictEqual(result, '');
  })) passed++; else failed++;

  if (test('appendTurn() writes correct markdown format', () => {
    const tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, 'test.md');
    try {
      appendTurn(filePath, 'User', 'Hello world', '2025-01-15T10:00:00.000Z');
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('### [2025-01-15T10:00:00.000Z] User'),
        'Should include timestamp and role header');
      assert.ok(content.includes('Hello world'), 'Should include content');
      assert.ok(content.includes('---'), 'Should include separator');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Context tests (3) ─────────────────────────────────────────────────

  console.log('\nContext:');

  if (test('loadECCContext() returns "" when no skills specified', () => {
    const result = loadECCContext('');
    assert.strictEqual(result, '');
  })) passed++; else failed++;

  if (test('loadECCContext() skips missing skill directories gracefully', () => {
    const result = loadECCContext('nonexistent-skill-xyz');
    assert.strictEqual(result, '');
  })) passed++; else failed++;

  if (test('loadECCContext() concatenates multiple skill files', () => {
    // Use real skills from the ECC repo if they exist
    const skillsDir = path.join(process.cwd(), 'skills');
    if (!fs.existsSync(skillsDir)) {
      console.log('    (skipped — no skills/ directory in CWD)');
      return;
    }
    const available = fs.readdirSync(skillsDir).filter(d => {
      const skillFile = path.join(skillsDir, d, 'SKILL.md');
      return fs.existsSync(skillFile);
    });
    if (available.length < 2) {
      console.log('    (skipped — need 2+ skills with SKILL.md)');
      return;
    }
    const twoSkills = available.slice(0, 2).join(',');
    const result = loadECCContext(twoSkills);
    assert.ok(result.length > 0, 'Should return non-empty context');
    // Should contain content from both skills
    for (const name of available.slice(0, 2)) {
      const skillContent = fs.readFileSync(
        path.join(skillsDir, name, 'SKILL.md'), 'utf8'
      );
      // Check that at least part of each skill is present
      const firstLine = skillContent.split('\n').find(l => l.trim().length > 10);
      if (firstLine) {
        assert.ok(result.includes(firstLine.trim()),
          `Should include content from skill ${name}`);
      }
    }
  })) passed++; else failed++;

  // ── Delegation tests (4) ──────────────────────────────────────────────

  console.log('\nDelegation:');

  if (test('buildPrompt() constructs correct prompt structure', () => {
    const prompt = buildPrompt('system info', 'chat history', 'user question');
    assert.ok(prompt.includes('=== SYSTEM CONTEXT ==='), 'Should have system section');
    assert.ok(prompt.includes('system info'), 'Should include system prompt');
    assert.ok(prompt.includes('=== CONVERSATION HISTORY ==='), 'Should have history section');
    assert.ok(prompt.includes('chat history'), 'Should include history');
    assert.ok(prompt.includes('=== USER MESSAGE ==='), 'Should have user section');
    assert.ok(prompt.includes('user question'), 'Should include user message');
    // Sections should be in order
    const sysIdx = prompt.indexOf('SYSTEM CONTEXT');
    const histIdx = prompt.indexOf('CONVERSATION HISTORY');
    const userIdx = prompt.indexOf('USER MESSAGE');
    assert.ok(sysIdx < histIdx, 'System should come before history');
    assert.ok(histIdx < userIdx, 'History should come before user message');
  })) passed++; else failed++;

  if (test('askClaude() returns an error string when claude is not on PATH', () => {
    const binDir = makeTmpDir();
    try {
      const result = withEnv({ [pathEnvKey()]: binDir }, () => askClaude('sys', 'hist', 'msg'));
      assert.match(result, /^\[Error: /, `Expected an error string, got: ${result}`);
    } finally {
      fs.rmSync(binDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('askClaude() sends the prompt on stdin and returns trimmed stdout', () => {
    if (process.platform === 'win32') {
      console.log('    (skipped on Windows: the claude stub is a POSIX shell script)');
      return;
    }
    const binDir = makeTmpDir();
    try {
      writeClaudeStub(binDir, [
        `printf '%s\\n' "$@" > "$CLAW_TEST_DIR/args.txt"`,
        `printf '%s' "\${CLAUDECODE-unset}" > "$CLAW_TEST_DIR/claudecode.txt"`,
        'cat > "$CLAW_TEST_DIR/stdin.txt"',
        `printf '  stub reply  \\n'`,
      ]);
      const result = withEnv({
        [pathEnvKey()]: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
        CLAW_TEST_DIR: binDir,
      }, () => askClaude('sys', 'hist', 'msg', 'haiku'));
      assert.strictEqual(result, 'stub reply');
      assert.deepStrictEqual(
        fs.readFileSync(path.join(binDir, 'args.txt'), 'utf8').trim().split('\n'),
        ['--model', 'haiku', '-p']);
      assert.strictEqual(fs.readFileSync(path.join(binDir, 'stdin.txt'), 'utf8'), buildPrompt('sys', 'hist', 'msg'));
      assert.strictEqual(fs.readFileSync(path.join(binDir, 'claudecode.txt'), 'utf8'), '',
        'CLAUDECODE should be set to an empty string for the child process');
    } finally {
      fs.rmSync(binDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('askClaude() reports a non-zero exit with its stderr', () => {
    if (process.platform === 'win32') {
      console.log('    (skipped on Windows: the claude stub is a POSIX shell script)');
      return;
    }
    const binDir = makeTmpDir();
    try {
      writeClaudeStub(binDir, ['cat > /dev/null', 'echo "rate limited" >&2', 'exit 3']);
      const result = withEnv({ [pathEnvKey()]: `${binDir}${path.delimiter}${process.env.PATH || ''}` },
        () => askClaude('sys', 'hist', 'msg'));
      assert.strictEqual(result, '[Error: claude exited with code 3: rate limited]');
    } finally {
      fs.rmSync(binDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── REPL/Meta tests (3) ───────────────────────────────────────────────

  console.log('\nREPL/Meta:');

  if (test('module exports all required functions', () => {
    const claw = require(path.join(__dirname, '..', '..', 'scripts', 'claw.js'));
    const required = [
      'getClawDir', 'getSessionPath', 'listSessions', 'loadHistory',
      'appendTurn', 'loadECCContext', 'askClaude', 'main'
    ];
    for (const fn of required) {
      assert.strictEqual(typeof claw[fn], 'function',
        `Should export function ${fn}`);
    }
  })) passed++; else failed++;

  if (test('/clear truncates session file', () => {
    const tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, 'session.md');
    try {
      fs.writeFileSync(filePath, 'some existing history content');
      assert.ok(fs.readFileSync(filePath, 'utf8').length > 0, 'File should have content before clear');
      handleClear(filePath);
      const after = fs.readFileSync(filePath, 'utf8');
      assert.strictEqual(after, '', 'File should be empty after clear');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('isValidSessionName rejects invalid characters', () => {
    assert.strictEqual(isValidSessionName('my-project'), true);
    assert.strictEqual(isValidSessionName('default'), true);
    assert.strictEqual(isValidSessionName('test123'), true);
    assert.strictEqual(isValidSessionName('a'), true);
    assert.strictEqual(isValidSessionName(''), false);
    assert.strictEqual(isValidSessionName('has spaces'), false);
    assert.strictEqual(isValidSessionName('has/slash'), false);
    assert.strictEqual(isValidSessionName('../traversal'), false);
    assert.strictEqual(isValidSessionName('-starts-dash'), false);
    assert.strictEqual(isValidSessionName(null), false);
    assert.strictEqual(isValidSessionName(undefined), false);
  })) passed++; else failed++;

  console.log('\nNanoClaw v2:');

  if (test('getSessionMetrics returns non-zero token estimate for populated history', () => {
    const tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, 'metrics.md');
    try {
      appendTurn(filePath, 'User', 'Implement auth');
      appendTurn(filePath, 'Assistant', 'Working on it');
      const metrics = getSessionMetrics(filePath);
      assert.strictEqual(metrics.turns, 2);
      assert.ok(metrics.tokenEstimate > 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('searchSessions finds query in saved session', () => {
    const tmpDir = makeTmpDir();
    try {
      const clawDir = path.join(tmpDir, '.claude', 'claw');
      const sessionPath = path.join(clawDir, 'alpha.md');
      fs.mkdirSync(clawDir, { recursive: true });
      appendTurn(sessionPath, 'User', 'Need oauth migration');
      const results = searchSessions('oauth', clawDir);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].session, 'alpha');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('branchSession copies history into new branch session', () => {
    const tmpDir = makeTmpDir();
    try {
      const clawDir = path.join(tmpDir, '.claude', 'claw');
      const source = path.join(clawDir, 'base.md');
      fs.mkdirSync(clawDir, { recursive: true });
      appendTurn(source, 'User', 'base content');
      const result = branchSession(source, 'feature-branch', clawDir);
      assert.strictEqual(result.ok, true);
      const branched = fs.readFileSync(result.path, 'utf8');
      assert.ok(branched.includes('base content'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('exportSession writes JSON export', () => {
    const tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, 'export.md');
    const outPath = path.join(tmpDir, 'export.json');
    try {
      appendTurn(filePath, 'User', 'hello');
      appendTurn(filePath, 'Assistant', 'world');
      const result = exportSession(filePath, 'json', outPath);
      assert.strictEqual(result.ok, true);
      const exported = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      assert.strictEqual(Array.isArray(exported.turns), true);
      assert.strictEqual(exported.turns.length, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('compactSession reduces long histories', () => {
    const tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, 'compact.md');
    try {
      for (let i = 0; i < 30; i++) {
        appendTurn(filePath, i % 2 ? 'Assistant' : 'User', `turn-${i}`);
      }
      const changed = compactSession(filePath, 10);
      assert.strictEqual(changed, true);
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('NanoClaw Compaction'));
      assert.ok(!content.includes('turn-0'));
      assert.ok(content.includes('turn-29'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Summary ───────────────────────────────────────────────────────────

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
