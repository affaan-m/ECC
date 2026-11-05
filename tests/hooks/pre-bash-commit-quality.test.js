/**
 * Tests for scripts/hooks/pre-bash-commit-quality.js
 *
 * Run with: node tests/hooks/pre-bash-commit-quality.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const hook = require('../../scripts/hooks/pre-bash-commit-quality');

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

function inTempRepo(fn) {
  const prevCwd = process.cwd();
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-bash-commit-quality-'));

  try {
    spawnSync('git', ['init'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });
    spawnSync('git', ['config', 'user.name', 'ECC Test'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'ecc@example.com'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });
    process.chdir(repoDir);
    return fn(repoDir);
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
}

function captureConsoleError(fn) {
  const previousError = console.error;
  const lines = [];
  console.error = (...args) => {
    lines.push(args.join(' '));
  };

  try {
    const result = fn();
    return { result, stderr: lines.join('\n') };
  } finally {
    console.error = previousError;
  }
}

function writeAndStage(repoDir, relativePath, content) {
  const filePath = path.join(repoDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  spawnSync('git', ['add', relativePath], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });
}

function executableName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function writeFakeExecutable(filePath, output, exitCode) {
  const source = process.platform === 'win32'
    ? `@echo off\r\necho ${output}\r\nexit /b ${exitCode}\r\n`
    : `#!/bin/sh\necho "${output}"\nexit ${exitCode}\n`;

  fs.writeFileSync(filePath, source, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

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

let passed = 0;
let failed = 0;
let skipped = 0;

console.log('\nPre-Bash Commit Quality Hook Tests');
console.log('==================================\n');

if (test('evaluate blocks commits when staged snapshot contains debugger', () => {
  inTempRepo(repoDir => {
    const filePath = path.join(repoDir, 'index.js');
    fs.writeFileSync(filePath, 'function main() {\n  debugger;\n}\n', 'utf8');
    spawnSync('git', ['add', 'index.js'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: test debugger hook"' } });
    const result = hook.evaluate(input);

    assert.strictEqual(result.output, input, 'should preserve stdin payload');
    assert.strictEqual(result.exitCode, 2, 'should block commit when staged snapshot has debugger');
  });
})) passed++; else failed++;

if (test('evaluate inspects staged snapshot instead of newer working tree content', () => {
  inTempRepo(repoDir => {
    const filePath = path.join(repoDir, 'index.js');
    fs.writeFileSync(filePath, 'function main() {\n  return 1;\n}\n', 'utf8');
    spawnSync('git', ['add', 'index.js'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });

    // Working tree diverges after staging; hook should still inspect staged content.
    fs.writeFileSync(filePath, 'function main() {\n  debugger;\n  return 1;\n}\n', 'utf8');

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: staged snapshot only"' } });
    const result = hook.evaluate(input);

    assert.strictEqual(result.output, input, 'should preserve stdin payload');
    assert.strictEqual(result.exitCode, 0, 'should ignore unstaged debugger in working tree');
  });
})) passed++; else failed++;

if (test('passes through non-commit amend malformed JSON and run wrapper paths', () => {
  const readInput = JSON.stringify({ tool_input: { command: 'git status --short' } });
  assert.deepStrictEqual(hook.evaluate(readInput), { output: readInput, exitCode: 0 });

  const amendInput = JSON.stringify({ tool_input: { command: 'git commit --amend -m "fix: update"' } });
  assert.deepStrictEqual(hook.evaluate(amendInput), { output: amendInput, exitCode: 0 });

  const malformed = 'not json {{{';
  const malformedResult = captureConsoleError(() => hook.run(malformed));
  assert.deepStrictEqual(malformedResult.result, { stdout: malformed, exitCode: 0 });
  assert.ok(malformedResult.stderr.includes('[Hook] Error:'), 'should log JSON parse errors without blocking');
})) passed++; else failed++;

if (test('allows git commit when no files are staged', () => {
  inTempRepo(() => {
    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: no staged files"' } });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(stderr.includes('No staged files found'), `expected no-staged warning, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('allows warning-only issues while reporting console TODO and message warnings', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', [
      'console.log("debug only");',
      '// TODO: clean this up',
      '// TODO: tracked in issue #123',
      '// console.log("commented out");',
      '* console.log("doc comment");',
      'const ok = true;',
      ''
    ].join('\n'));

    const input = JSON.stringify({
      tool_input: {
        command: 'git commit -m "fix: Uppercase subject."'
      }
    });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 0, 'warning-only issues should not block');
    assert.ok(stderr.includes('WARNING Line 1'), `expected console warning, got: ${stderr}`);
    assert.ok(stderr.includes('INFO Line 2'), `expected TODO info warning, got: ${stderr}`);
    assert.ok(stderr.includes('Subject should start with lowercase'), `expected capitalization warning, got: ${stderr}`);
    assert.ok(stderr.includes('should not end with a period'), `expected punctuation warning, got: ${stderr}`);
    assert.ok(stderr.includes('Warnings found'), `expected warning summary, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('reports invalid and long commit messages without blocking when files are clean', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', 'const clean = true;\n');

    const longMessage = `Bad message ${'x'.repeat(80)}`;
    const input = JSON.stringify({
      tool_input: {
        command: `git commit --message="${longMessage}"`
      }
    });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(stderr.includes('does not follow conventional commit format'), `expected format warning, got: ${stderr}`);
    assert.ok(stderr.includes('Commit message too long'), `expected length warning, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('blocks commits with staged secret patterns across checkable files', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', [
      "const openai = 'sk-abcdefghijklmnopqrstuvwxyz';",
      "const anthropic = 'sk-ant-api03-AbCdEf-GhIjKlMnOpQrStUvWx_Yz012345';",
      "const token = 'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ';",
      ''
    ].join('\n'));
    writeAndStage(repoDir, 'app.py', [
      'aws = "AKIAABCDEFGHIJKLMNOP"',
      'api_key = "secret-value"',
      ''
    ].join('\n'));

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: block secrets"' } });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 2);
    assert.ok(stderr.includes('Potential OpenAI API key'), `expected OpenAI secret warning, got: ${stderr}`);
    assert.ok(stderr.includes('Potential Anthropic API key'), `expected Anthropic key warning, got: ${stderr}`);
    assert.ok(stderr.includes('Potential GitHub PAT'), `expected GitHub PAT warning, got: ${stderr}`);
    assert.ok(stderr.includes('Potential AWS Access Key'), `expected AWS key warning, got: ${stderr}`);
    assert.ok(stderr.includes('Potential API key'), `expected generic API key warning, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('blocks commits with an unquoted API key assignment', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'config.py', [
      'API_KEY=sk_live_1234567890abcdef',
      ''
    ].join('\n'));

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: unquoted key"' } });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 2);
    assert.ok(stderr.includes('Potential API key'), `expected unquoted API key warning, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('does not flag ordinary unquoted apiKey code references', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', [
      'const apiKey = getApiKeyFromVault();',
      'this.apiKey = options.apiKey;',
      'const apiKey2 = process.env.API_KEY;',
      ''
    ].join('\n'));

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: no secret here"' } });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 0, `expected exit 0 (no secrets), got ${result.exitCode}: ${stderr}`);
    assert.ok(!stderr.includes('Potential API key'), `should not flag ordinary code as a secret, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('runs Windows batch linters through cmd with quoted command and arguments', () => {
  const command = 'C:\\Users\\Jane %team%!\\project\\node_modules\\.bin\\eslint.cmd';
  const args = [
    'index.js',
    '100%.js',
    '!important!.js',
    '%PATH%.js',
    '!PATH!.js',
    '%1.js',
    'mixed %!^&() name.js'
  ];
  const invocation = hook.getLinterInvocation(command, args, 'win32');

  assert.ok(/cmd\.exe$/i.test(invocation.command));
  assert.deepStrictEqual(invocation.args, [
    '/d',
    '/v:off',
    '/s',
    '/c',
    '""%ECC_LINTER_TOKEN_0%" "%ECC_LINTER_TOKEN_1%" "%ECC_LINTER_TOKEN_2%" "%ECC_LINTER_TOKEN_3%" "%ECC_LINTER_TOKEN_4%" "%ECC_LINTER_TOKEN_5%" "%ECC_LINTER_TOKEN_6%" "%ECC_LINTER_TOKEN_7%""'
  ]);
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(invocation.options.env).filter(([key]) => key.startsWith('ECC_LINTER_TOKEN_'))),
    Object.fromEntries([command, ...args].map((value, index) => [`ECC_LINTER_TOKEN_${index}`, value]))
  );
  assert.ok(!invocation.args[4].includes(command), 'untrusted command must not be embedded in cmd source');
  assert.ok(!invocation.args[4].includes(args[1]), 'untrusted argument must not be embedded in cmd source');
  assert.strictEqual(invocation.options.shell, false);
  assert.strictEqual(invocation.options.windowsVerbatimArguments, true);

  const plainCmd = hook.getLinterInvocation('C:\\tools\\eslint.cmd', [], 'win32');
  assert.ok(/cmd\.exe$/i.test(plainCmd.command));
  assert.deepStrictEqual(plainCmd.args, ['/d', '/v:off', '/s', '/c', '""%ECC_LINTER_TOKEN_0%""']);
  assert.strictEqual(plainCmd.options.shell, false);

  const batch = hook.getLinterInvocation('C:\\tools\\lint.BAT', [], 'win32');
  assert.ok(/cmd\.exe$/i.test(batch.command));
  assert.strictEqual(batch.options.shell, false);

  const executable = hook.getLinterInvocation('C:\\Program Files\\eslint.exe', [], 'win32');
  assert.strictEqual(executable.command, 'C:\\Program Files\\eslint.exe');
  assert.strictEqual(executable.options.shell, false);

  const posix = hook.getLinterInvocation('/tmp/project with spaces/eslint', [], 'darwin');
  assert.strictEqual(posix.command, '/tmp/project with spaces/eslint');
  assert.strictEqual(posix.options.shell, false);
})) passed++; else failed++;

if (test('isolates Windows cmd token variables without mutating the parent environment', () => {
  const original = process.env.ECC_LINTER_TOKEN_0;
  process.env.ECC_LINTER_TOKEN_0 = 'parent value';

  try {
    const invocation = hook.getLinterInvocation('C:\\tools\\eslint.cmd', ['100%.js'], 'win32');
    assert.strictEqual(invocation.options.env.ECC_LINTER_TOKEN_0, 'C:\\tools\\eslint.cmd');
    assert.strictEqual(invocation.options.env.ECC_LINTER_TOKEN_1, '100%.js');
    assert.strictEqual(process.env.ECC_LINTER_TOKEN_0, 'parent value');
  } finally {
    if (original === undefined) delete process.env.ECC_LINTER_TOKEN_0;
    else process.env.ECC_LINTER_TOKEN_0 = original;
  }
})) passed++; else failed++;

if (process.platform === 'win32') {
  if (test('passes percent and exclamation filenames literally to a Windows batch linter', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc cmd literal '));
    try {
      const command = path.join(repoDir, 'lint %!.cmd');
      const capturePath = path.join(repoDir, 'captured arguments.txt');
      fs.writeFileSync(command, [
        '@echo off',
        'setlocal DisableDelayedExpansion',
        '> "%ECC_CAPTURE_PATH%" echo(%~1',
        '>> "%ECC_CAPTURE_PATH%" echo(%~2',
        ''
      ].join('\r\n'), 'utf8');

      const invocation = hook.getLinterInvocation(command, ['100% ready.js', '!important!.js'], 'win32');
      const result = spawnSync(invocation.command, invocation.args, {
        ...invocation.options,
        env: { ...invocation.options.env, ECC_CAPTURE_PATH: capturePath }
      });

      assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
      assert.deepStrictEqual(
        fs.readFileSync(capturePath, 'utf8').split(/\r?\n/).filter(Boolean),
        ['100% ready.js', '!important!.js']
      );
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;
} else {
  console.log('  - passes percent and exclamation filenames literally to a Windows batch linter (skipped: Windows only)');
  skipped++;
}

if (test('rejects characters that can break Windows cmd token boundaries', () => {
  assert.throws(
    () => hook.getLinterInvocation('C:\\tools\\eslint.cmd', ['bad"name.js'], 'win32'),
    /Unsafe character/
  );
  assert.throws(
    () => hook.getLinterInvocation('C:\\tools\\eslint.cmd', ['bad\r\nname.js'], 'win32'),
    /Unsafe character/
  );
})) passed++; else failed++;

if (test('treats rejected or failed golint invocations as failures', () => {
  assert.strictEqual(hook.golintSucceeded({ status: 0, stdout: '', error: null }), true);
  assert.strictEqual(hook.golintSucceeded({ status: 0, stdout: 'issue.go:1: warning', error: null }), false);
  assert.strictEqual(hook.golintSucceeded({ status: null, stdout: '', error: new Error('unsafe argument') }), false);
})) passed++; else failed++;

if (test('uses ESLint bundled formatter without the removed compact formatter', () => {
  inTempRepo(repoDir => {
    const eslintPath = path.join(repoDir, 'node_modules', '.bin', executableName('eslint'));
    fs.mkdirSync(path.dirname(eslintPath), { recursive: true });
    const source = process.platform === 'win32'
      ? '@echo off\r\necho %* | findstr /C:"--format compact" >nul && exit /b 9\r\nexit /b 0\r\n'
      : '#!/bin/sh\ncase " $* " in *" --format compact "*) exit 9 ;; esac\nexit 0\n';
    fs.writeFileSync(eslintPath, source, 'utf8');
    fs.chmodSync(eslintPath, 0o755);

    process.chdir(repoDir);
    const result = hook.runLinter(['index.js']);

    assert.ok(result.eslint, 'expected ESLint to run');
    assert.strictEqual(result.eslint.success, true, result.eslint.output);
  });
})) passed++; else failed++;

if (test('reports eslint pylint and golint failures from staged files', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', 'const lint = true;\n');
    writeAndStage(repoDir, 'app.py', 'print("lint")\n');
    writeAndStage(repoDir, 'main.go', 'package main\n');

    const eslintPath = path.join(repoDir, 'node_modules', '.bin', executableName('eslint'));
    fs.mkdirSync(path.dirname(eslintPath), { recursive: true });
    writeFakeExecutable(eslintPath, 'eslint failed', 1);

    const binDir = path.join(repoDir, 'fake-bin');
    fs.mkdirSync(binDir, { recursive: true });
    const pylintPath = path.join(binDir, executableName('pylint'));
    const golintPath = path.join(binDir, executableName('golint'));
    writeFakeExecutable(pylintPath, 'pylint failed', 1);
    writeFakeExecutable(golintPath, 'main.go:1: lint failed', 0);

    const pathKey = pathEnvKey();
    withEnv({ [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] || process.env.PATH || ''}` }, () => {
      const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: lint failures"' } });
      const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

      assert.strictEqual(result.output, input);
      assert.strictEqual(result.exitCode, 2);
      assert.ok(stderr.includes('ESLint Issues'), `expected ESLint output, got: ${stderr}`);
      assert.ok(stderr.includes('eslint failed'), `expected ESLint failure text, got: ${stderr}`);
      assert.ok(stderr.includes('Pylint Issues'), `expected Pylint output, got: ${stderr}`);
      assert.ok(stderr.includes('pylint failed'), `expected Pylint failure text, got: ${stderr}`);
      assert.ok(stderr.includes('golint Issues'), `expected golint output, got: ${stderr}`);
      assert.ok(stderr.includes('main.go:1: lint failed'), `expected golint failure text, got: ${stderr}`);
    });
  });
})) passed++; else failed++;

if (test('stdin entry point truncates oversized input and preserves pass-through output', () => {
  const oversized = JSON.stringify({
    tool_input: {
      command: 'git status',
      filler: 'x'.repeat(1024 * 1024 + 1024)
    }
  });
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-bash-commit-quality.js')], {
    input: oversized,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
    maxBuffer: 2 * 1024 * 1024
  });

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.length > 0, 'expected truncated payload to pass through');
  assert.ok(result.stdout.length <= 1024 * 1024, 'expected stdout to stay within hook input limit');
  assert.strictEqual(result.stdout, oversized.slice(0, result.stdout.length));
  assert.ok(result.stderr.includes('[Hook] Error:'), 'truncated JSON should be logged and allowed');
})) passed++; else failed++;

// --- Secret-scanner placeholder exclusion (false-positive fix, no false-negative) ---

if (test('isPlaceholderSecret suppresses obvious non-secret placeholders', () => {
  for (const v of ['process.env.API_KEY', '${API_KEY}', '<YOUR_KEY>', 'REPLACE_ME', 'CHANGEME', 'YOUR_API_KEY', '']) {
    assert.strictEqual(hook.isPlaceholderSecret(v), true, `should suppress placeholder: ${JSON.stringify(v)}`);
  }
})) passed++; else failed++;

if (test('isPlaceholderSecret does NOT suppress real high-entropy secrets', () => {
  for (const v of [
    'sk-live-abcdef0123456789ABCDEF',          // prefixed
    '9F8A7B6C5D4E3F2A1B0C9D8E7F6A5B4C',          // uppercase hex
    'JBSWY3DPEHPK3PXP',                           // base32 TOTP/HMAC seed
    '1234567890123456',                          // digit-only token
    'PROD_7F3A9C2E_LIVE_8821',                    // uppercase-with-underscore token
    'AbCd1234EfGh5678'                            // mixed token
  ]) {
    assert.strictEqual(hook.isPlaceholderSecret(v), false, `must NOT suppress real secret: ${v}`);
  }
})) passed++; else failed++;

// --- Quote-aware commit-message extraction (truncation fix) ---

if (test('captures full double-quoted -m message containing an apostrophe', () => {
  const res = hook.validateCommitMessage(`git commit -m "fix: don't crash on empty input"`);
  assert.ok(res, 'expected a validation result');
  assert.strictEqual(res.message, "fix: don't crash on empty input");
})) passed++; else failed++;

if (test('captures full single-quoted -m message containing a double quote', () => {
  const res = hook.validateCommitMessage(`git commit -m 'fix: handle the "edge" case'`);
  assert.strictEqual(res.message, 'fix: handle the "edge" case');
})) passed++; else failed++;

if (test('captures full double-quoted -m message with escaped inner quotes (not truncated)', () => {
  const res = hook.validateCommitMessage('git commit -m "fix: say \\"hello\\" to the user"');
  assert.ok(res, 'expected a validation result');
  assert.strictEqual(res.message, 'fix: say "hello" to the user');
})) passed++; else failed++;

if (test('measures length of the full message past an apostrophe (not the truncated prefix)', () => {
  const subject = "fix: it's a deliberately long commit subject that comfortably exceeds seventy-two chars";
  const res = hook.validateCommitMessage(`git commit -m "${subject}"`);
  assert.strictEqual(res.message, subject);
  assert.ok(res.issues.some(i => i.type === 'length'), 'full (>72) message should trigger a length issue');
})) passed++; else failed++;
// --- Subject line and here-document messages ---

if (test('checks only the subject line of a multi-line message', () => {
  const res = hook.validateCommitMessage(
    'git commit -m "fix: handle empty input\n\nThe parser crashed on an empty string. It now returns an empty list."'
  );
  assert.deepStrictEqual(res.issues, []);
})) passed++; else failed++;

if (test('reads the here-document message that Claude Code writes', () => {
  const body = 'feat(hooks): add a check\n\nA body line that says why, and quotes "the case" it covers.';
  const res = hook.validateCommitMessage(`git commit -m "$(cat <<'EOF'\n${body}\nEOF\n)"`);
  assert.strictEqual(res.message, body);
  assert.deepStrictEqual(res.issues, []);
})) passed++; else failed++;

if (test('still reports a bad subject inside a here-document', () => {
  const res = hook.validateCommitMessage('git commit -m "$(cat <<EOF\nUpdate stuff.\n\nbody\nEOF\n)"');
  assert.deepStrictEqual(res.issues.map(i => i.type), ['format', 'punctuation']);
})) passed++; else failed++;

if (test('warns when an unquoted here-document can expand the commit message', () => {
  const command = 'git commit -m "$(cat <<EOF\nfix: ${EMPTY}\nEOF\n)"';
  const res = hook.validateCommitMessage(command);
  assert.strictEqual(res.message, null);
  assert.deepStrictEqual(res.issues.map(i => i.type), ['unverifiable']);
  assert.deepStrictEqual(
    hook.validateCommitMessage('git commit -m "$(cat <<\'EOF\'\nfix: ${EMPTY}\nEOF\n)"').issues,
    []
  );
  assert.deepStrictEqual(
    hook.validateCommitMessage('git commit -m "$(cat <<EOF\nfix: \\${EMPTY}\nEOF\n)"').issues,
    []
  );
})) passed++; else failed++;

if (test('treats a backslash as literal inside a single-quoted commit message', () => {
  const res = hook.validateCommitMessage(String.raw`git commit -m 'Update path\'`);
  assert.ok(res, 'expected a validation result for valid Bash quoting');
  assert.strictEqual(res.message, 'Update path' + String.fromCharCode(92));
  assert.ok(res.issues.some(issue => issue.type === 'format'));
})) passed++; else failed++;

if (test('drops a line continuation from a double-quoted message, as Bash does', () => {
  const res = hook.validateCommitMessage('git commit -m "\\\nfix: handle empty input"');
  assert.strictEqual(res.message, 'fix: handle empty input');
  assert.deepStrictEqual(res.issues, []);
  // An escaped backslash before a newline is one backslash, and the newline stays
  assert.strictEqual(hook.validateCommitMessage('git commit -m "fix: path C:\\\\\nbody"').message, 'fix: path C:\\\nbody');
  // Bash removes the backslash only before $ ` " \ and a newline; before a CR it stays
  assert.strictEqual(hook.validateCommitMessage('git commit -m "fix: keep path\\\r\nbody."').message, 'fix: keep path\\\r\nbody.');
  assert.deepStrictEqual(hook.validateCommitMessage('git commit -m "fix: keep path\\\r\nbody."').issues, []);
  assert.strictEqual(hook.validateCommitMessage('git commit -m "fix: cost \\$5 in \\d+ steps"').message, 'fix: cost $5 in \\d+ steps');
})) passed++; else failed++;

if (test('reads a here-document whose body has a backslash at the end of a line', () => {
  const res = hook.validateCommitMessage('git commit -m "$(cat <<\'EOF\'\nUpdate stuff.\n\nC:\\build\\\nEOF\n)"');
  assert.ok(res, 'expected a validation result');
  assert.strictEqual(res.message, 'Update stuff.\n\nC:\\build\\');
  assert.deepStrictEqual(res.issues.map(i => i.type), ['format', 'punctuation']);
})) passed++; else failed++;

if (test('ends a here-document only at a line that holds just the delimiter', () => {
  const res = hook.validateCommitMessage(
    'git commit -m "$(cat <<\'EOF\'\nfix: keep reading\n\n  EOF\nEOF \nmore body\nEOF\n)"'
  );
  assert.strictEqual(res.message, 'fix: keep reading\n\n  EOF\nEOF \nmore body');
})) passed++; else failed++;

if (test('reads a <<- here-document without its leading tabs', () => {
  const res = hook.validateCommitMessage('git commit -m "$(cat <<-"END"\n\tfix: tabbed subject\n\tEND\n)"');
  assert.strictEqual(res.message, 'fix: tabbed subject');
  assert.deepStrictEqual(res.issues, []);
})) passed++; else failed++;

if (test('needs the description on the subject line itself', () => {
  const res = hook.validateCommitMessage('git commit -m "feat:\nadd a check"');
  assert.ok(res.issues.some(i => i.type === 'format'), 'a subject with nothing after the colon is not conventional');
})) passed++; else failed++;

if (test('passes a valid here-document commit message end to end', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', 'const clean = true;\n');
    const input = JSON.stringify({
      tool_input: {
        command: `git commit -m "$(cat <<'EOF'\nfix(hooks): read the message body\n\nA longer explanation that runs well past seventy-two characters in total.\nEOF\n)"`
      }
    });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.exitCode, 0);
    assert.ok(!stderr.includes('Commit Message Issues'), `expected no message warnings, got: ${stderr}`);
    assert.ok(stderr.includes('All checks passed'), `expected a pass, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('handles hash-prefixed python comments and string false-positives', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'script.py', [
      '# console.log("commented out");',
      '# debugger',
      '# TODO: python unreferenced',
      '# TODO: python issue #456',
      'const str = "# TODO: string false positive";', // Greptile string limitation
      ''
    ].join('\n'));
    
    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix(hooks): python hash comments"' } });
    
    const origConsoleError = console.error;
    let stderr = '';
    console.error = msg => { stderr += msg + '\n'; };
    
    const result = hook.evaluate(input);
    console.error = origConsoleError;
    
    assert.strictEqual(result.exitCode, 0, 'warning-only issues should not block');
    assert.ok(stderr.includes('INFO Line 3:'), `expected python TODO warning`);
    assert.ok(!stderr.includes('INFO Line 4'), 'referenced python TODO should not warn');
    assert.ok(!stderr.includes('ERROR Line 2'), 'commented debugger should not error');
    assert.ok(stderr.includes('INFO Line 5:'), `expected string limitation warning`);
  });
})) passed++; else failed++;
console.log(`\nResults: Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}`);
process.exit(failed > 0 ? 1 : 0);
