/**
 * Tests for post-bash-build-complete.js and post-bash-pr-created.js
 *
 * Run with: node tests/hooks/post-bash-hooks.test.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const buildCompleteScript = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'post-bash-build-complete.js');
const prCreatedScript = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'post-bash-pr-created.js');

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

function runScript(scriptPath, input) {
  return spawnSync('node', [scriptPath], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

let passed = 0;
let failed = 0;

// ── post-bash-build-complete.js ──────────────────────────────────

console.log('\nPost-Bash Build Complete Hook Tests');
console.log('====================================\n');

console.log('Build command detection:');

if (test('stderr contains "Build completed" for npm run build command', () => {
  const input = JSON.stringify({ tool_input: { command: 'npm run build' } });
  const result = runScript(buildCompleteScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.ok(result.stderr.includes('Build completed'), `stderr should contain "Build completed", got: ${result.stderr}`);
})) passed++; else failed++;

if (test('stderr contains "Build completed" for pnpm build command', () => {
  const input = JSON.stringify({ tool_input: { command: 'pnpm build' } });
  const result = runScript(buildCompleteScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.ok(result.stderr.includes('Build completed'), `stderr should contain "Build completed", got: ${result.stderr}`);
})) passed++; else failed++;

if (test('stderr contains "Build completed" for yarn build command', () => {
  const input = JSON.stringify({ tool_input: { command: 'yarn build' } });
  const result = runScript(buildCompleteScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.ok(result.stderr.includes('Build completed'), `stderr should contain "Build completed", got: ${result.stderr}`);
})) passed++; else failed++;

console.log('\nNon-build command detection:');

if (test('no stderr message for npm test command', () => {
  const input = JSON.stringify({ tool_input: { command: 'npm test' } });
  const result = runScript(buildCompleteScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.strictEqual(result.stderr, '', 'stderr should be empty for non-build command');
})) passed++; else failed++;

if (test('no stderr message for ls command', () => {
  const input = JSON.stringify({ tool_input: { command: 'ls -la' } });
  const result = runScript(buildCompleteScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.strictEqual(result.stderr, '', 'stderr should be empty for non-build command');
})) passed++; else failed++;

if (test('no stderr message for git status command', () => {
  const input = JSON.stringify({ tool_input: { command: 'git status' } });
  const result = runScript(buildCompleteScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.strictEqual(result.stderr, '', 'stderr should be empty for non-build command');
})) passed++; else failed++;

console.log('\nStdout pass-through:');

if (test('stdout passes through input for build command', () => {
  const input = JSON.stringify({ tool_input: { command: 'npm run build' } });
  const result = runScript(buildCompleteScript, input);
  assert.strictEqual(result.stdout, input, 'stdout should be the original input');
})) passed++; else failed++;

if (test('stdout passes through input for non-build command', () => {
  const input = JSON.stringify({ tool_input: { command: 'npm test' } });
  const result = runScript(buildCompleteScript, input);
  assert.strictEqual(result.stdout, input, 'stdout should be the original input');
})) passed++; else failed++;

if (test('stdout passes through input for invalid JSON', () => {
  const input = 'not valid json';
  const result = runScript(buildCompleteScript, input);
  assert.strictEqual(result.stdout, input, 'stdout should be the original input');
})) passed++; else failed++;

if (test('stdout passes through empty input', () => {
  const input = '';
  const result = runScript(buildCompleteScript, input);
  assert.strictEqual(result.stdout, input, 'stdout should be the original input');
})) passed++; else failed++;

// ── post-bash-pr-created.js ──────────────────────────────────────

console.log('\n\nPost-Bash PR Created Hook Tests');
console.log('================================\n');

console.log('PR creation detection:');

if (test('stderr contains PR URL when gh pr create output has PR URL', () => {
  const input = JSON.stringify({
    tool_input: { command: 'gh pr create --title "Fix bug" --body "desc"' },
    tool_output: { output: 'https://github.com/owner/repo/pull/42\n' }
  });
  const result = runScript(prCreatedScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.ok(result.stderr.includes('https://github.com/owner/repo/pull/42'), `stderr should contain PR URL, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('[Hook] PR created:'), 'stderr should contain PR created message');
  assert.ok(result.stderr.includes('gh pr review 42'), 'stderr should contain review command');
})) passed++; else failed++;

if (test('stderr contains PR URL when Claude Code sends the Bash result as tool_response', () => {
  const input = JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --fill' },
    tool_response: { stdout: 'https://github.com/owner/repo/pull/42\n', stderr: '', interrupted: false, isImage: false }
  });
  const result = runScript(prCreatedScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.ok(result.stderr.includes('[Hook] PR created: https://github.com/owner/repo/pull/42'), `stderr should contain PR URL, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('gh pr review 42 --repo owner/repo'), 'stderr should contain review command');
})) passed++; else failed++;

if (test('stderr contains correct repo in review command', () => {
  const input = JSON.stringify({
    tool_input: { command: 'gh pr create' },
    tool_output: { output: 'Created PR\nhttps://github.com/my-org/my-repo/pull/123\nDone' }
  });
  const result = runScript(prCreatedScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.ok(result.stderr.includes('--repo my-org/my-repo'), `stderr should contain correct repo, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('gh pr review 123'), 'stderr should contain correct PR number');
})) passed++; else failed++;

console.log('\nNon-PR command detection:');

if (test('no stderr about PR for non-gh command', () => {
  const input = JSON.stringify({ tool_input: { command: 'npm test' } });
  const result = runScript(prCreatedScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.strictEqual(result.stderr, '', 'stderr should be empty for non-PR command');
})) passed++; else failed++;

if (test('no stderr about PR for gh issue command', () => {
  const input = JSON.stringify({ tool_input: { command: 'gh issue list' } });
  const result = runScript(prCreatedScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.strictEqual(result.stderr, '', 'stderr should be empty for non-PR create command');
})) passed++; else failed++;

if (test('no stderr about PR for gh pr create without PR URL in output', () => {
  const input = JSON.stringify({
    tool_input: { command: 'gh pr create' },
    tool_output: { output: 'Error: could not create PR' }
  });
  const result = runScript(prCreatedScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.strictEqual(result.stderr, '', 'stderr should be empty when no PR URL in output');
})) passed++; else failed++;

if (test('no stderr about PR for gh pr list command', () => {
  const input = JSON.stringify({ tool_input: { command: 'gh pr list' } });
  const result = runScript(prCreatedScript, input);
  assert.strictEqual(result.status, 0, 'Should exit with code 0');
  assert.strictEqual(result.stderr, '', 'stderr should be empty for gh pr list');
})) passed++; else failed++;

console.log('\nStdout pass-through:');

if (test('stdout passes through input for PR create command', () => {
  const input = JSON.stringify({
    tool_input: { command: 'gh pr create' },
    tool_output: { output: 'https://github.com/owner/repo/pull/1' }
  });
  const result = runScript(prCreatedScript, input);
  assert.strictEqual(result.stdout, input, 'stdout should be the original input');
})) passed++; else failed++;

if (test('stdout passes through input for non-PR command', () => {
  const input = JSON.stringify({ tool_input: { command: 'echo hello' } });
  const result = runScript(prCreatedScript, input);
  assert.strictEqual(result.stdout, input, 'stdout should be the original input');
})) passed++; else failed++;

if (test('stdout passes through input for invalid JSON', () => {
  const input = 'not valid json';
  const result = runScript(prCreatedScript, input);
  assert.strictEqual(result.stdout, input, 'stdout should be the original input');
})) passed++; else failed++;

if (test('stdout passes through empty input', () => {
  const input = '';
  const result = runScript(prCreatedScript, input);
  assert.strictEqual(result.stdout, input, 'stdout should be the original input');
})) passed++; else failed++;

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
