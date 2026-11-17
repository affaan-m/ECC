'use strict';
/**
 * Tests for scripts/lib/gateguard-readonly-shell.js.
 *
 * Run with: node tests/lib/gateguard-readonly-shell.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hookPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'gateguard-fact-force.js');

console.log('=== Testing gateguard-readonly-shell.js ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${desc}: ${e.message}`);
    failed++;
  }
}

function loadHook() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-readonly-shell-state-'));
  const savedStateDir = process.env.GATEGUARD_STATE_DIR;
  process.env.GATEGUARD_STATE_DIR = stateDir;
  try {
    return require(hookPath);
  } finally {
    if (savedStateDir === undefined) delete process.env.GATEGUARD_STATE_DIR;
    else process.env.GATEGUARD_STATE_DIR = savedStateDir;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

const { isReadOnlyShellCommand } = loadHook();

function expectReadOnly(tool, commands) {
  for (const command of commands) {
    assert.strictEqual(isReadOnlyShellCommand(tool, command), true, `${tool}: ${command} should be read-only`);
  }
}

function expectNotReadOnly(tool, commands) {
  for (const command of commands) {
    assert.strictEqual(isReadOnlyShellCommand(tool, command), false, `${tool}: ${command} should not be read-only`);
  }
}

test('plain introspection commands are read-only', () => {
  expectReadOnly('Bash', [
    'ls',
    'ls -la src',
    'pwd',
    'cat README.md',
    'head -n 20 src/a.js',
    'tail -5 log.txt',
    'wc -l src/a.js src/b.js',
    'rg -n "foo bar" src',
    "grep -rn 'x|y' .",
    'find . -name "*.js" -type f',
    'fd -e js src',
    'tree -L 2 src'
  ]);
});

test('read-only git subcommands are read-only', () => {
  expectReadOnly('Bash', [
    'git status',
    'git status --short --branch',
    'git log --oneline -n 5',
    'git log --oneline -20 -- src/a.js',
    'git diff',
    'git diff --cached --stat',
    'git diff HEAD~1 -- src',
    'git show HEAD --stat',
    'git branch --show-current',
    'git branch -a',
    'git rev-parse --show-toplevel',
    'git ls-files src'
  ]);
});

test('pipes and lists of read-only commands are read-only', () => {
  expectReadOnly('Bash', ['ls src | head', 'git log --oneline | head -n 3', 'pwd && ls', 'cat a.txt; wc -l a.txt', 'ls x || ls y']);
});

test('PowerShell introspection cmdlets are read-only', () => {
  expectReadOnly('PowerShell', [
    'Get-ChildItem -Recurse -Filter *.js',
    'get-childitem src',
    'gci C:\\repo\\src',
    'Get-Content -Path .\\README.md -TotalCount 20',
    'Select-String -Path src\\*.js -Pattern foo',
    'Get-ChildItem src | Select-String foo',
    'Get-Location',
    'git status --short'
  ]);
});

test('redirection to a file is not read-only', () => {
  expectNotReadOnly('Bash', ['ls > out.txt', 'cat a >> b', 'git log 2>err.txt', 'cat < a.txt', 'cat <<EOF', 'ls >| out']);
  expectNotReadOnly('PowerShell', ['Get-ChildItem > out.txt', 'Get-Content a 2>&1', 'Get-Content a *> b']);
});

test('tee and other writers in a pipe are not read-only', () => {
  expectNotReadOnly('Bash', ['ls | tee out.txt', 'cat a | sort -o b', 'git log | xargs rm', 'ls | sh', 'cat a.txt | node']);
  expectNotReadOnly('PowerShell', ['Get-ChildItem | Out-File a.txt', 'Get-Content a | Set-Content b', 'Get-ChildItem | Remove-Item', 'Get-Content a | Tee-Object b']);
});

test('command substitution, backticks and process substitution are not read-only', () => {
  expectNotReadOnly('Bash', ['ls $(pwd)', 'cat `which node`', 'cat <(ls)', 'ls "$(rm -rf x)"', 'cat "`id`"', 'ls $HOME', 'ls "${x:=y}"', 'diff <(ls a) <(ls b)']);
  expectNotReadOnly('PowerShell', ['Get-Content $(Remove-Item a)', 'Get-ChildItem $env:TEMP', 'Get-Content "$x"', 'Get-Content @args', 'Get-Content (Get-Item a)']);
});

test('find actions that execute, delete or write are not read-only', () => {
  expectNotReadOnly('Bash', [
    'find . -name "*.tmp" -exec echo {} +',
    'find . -execdir ls +',
    'find . -ok echo +',
    'find . -okdir echo +',
    'find . -name x -delete',
    'find . -fprint out.txt',
    'find . -fprintf out.txt %p',
    'find . -fls out.txt'
  ]);
});

test('fd, rg and tree options that execute or write are not read-only', () => {
  expectNotReadOnly('Bash', [
    'fd -x echo',
    'fd -HX echo',
    'fd --exec echo',
    'fd --exec-batch echo',
    'rg --pre ./script foo',
    'rg --pre=cat foo',
    'rg --hostname-bin=./x foo',
    'rg -z foo',
    'rg -iz foo',
    'rg --search-zip foo',
    'tree -o out.txt',
    'tree -ao out.txt',
    'tree -R'
  ]);
});

test('xargs, sed, awk and other unknown commands are not read-only', () => {
  expectNotReadOnly('Bash', ['xargs ls', 'sed -i s/a/b/ f', 'sed -n 1p f', 'awk 1 f', 'echo hi', 'npm test', 'node -e 1', 'sort f', 'less f', 'touch a']);
});

test('environment assignments and wrappers are not read-only', () => {
  expectNotReadOnly('Bash', ['FOO=1 ls', 'PAGER=sh git log', 'env ls', 'sudo ls', 'command ls', 'nice ls', 'timeout 5 ls', 'exec ls', 'sh -c ls', 'bash -c "ls"']);
});

test('commands named by path or quoted into another name are not read-only', () => {
  expectNotReadOnly('Bash', ['./ls', '/bin/ls', 'bin/cat a', 'l? a', 'LS']);
  expectNotReadOnly('PowerShell', ['Microsoft.PowerShell.Management\\Get-ChildItem', '.\\ls.ps1', '& Get-ChildItem', '. .\\x.ps1']);
});

test('git subcommands outside the read-only set are not read-only', () => {
  expectNotReadOnly('Bash', [
    'git commit -m x',
    'git checkout main',
    'git stash',
    'git fetch',
    'git pull',
    'git branch new-feature',
    'git branch -d old',
    'git branch -D old',
    'git branch -m a b',
    'git config user.name x',
    'git grep foo',
    'git remote -v',
    'git tag v1',
    'git worktree list'
  ]);
});

test('git options that write, execute or reconfigure are not read-only', () => {
  expectNotReadOnly('Bash', [
    'git -c core.pager=sh log',
    'git -C /elsewhere status',
    'git --git-dir=/x log',
    'git -p log',
    'git diff --output=patch.txt',
    'git diff --out=patch.txt',
    'git log --output=log.txt',
    'git diff --ext-diff',
    'git log --ext-diff -p',
    'git diff --textconv',
    'git show --output=x HEAD'
  ]);
});

test('PowerShell escapes, call operators and stop-parsing are not read-only', () => {
  expectNotReadOnly('PowerShell', [
    'Get-Content a`; Remove-Item b',
    'git log --% ; x',
    'Get-Content a & Remove-Item b',
    'Get-ChildItem {Remove-Item a}',
    'Get-Content [IO.File]::x',
    'pwsh -Command Get-ChildItem',
    'powershell -EncodedCommand AAAA',
    'Invoke-Expression "ls"',
    'Get-ChildItem | ForEach-Object { Remove-Item $_ }',
    "Get-Content 'a\u2019; Remove-Item b",
    'Set-Location src',
    'Remove-Item a'
  ]);
});

test('backslashes, background jobs, newlines and odd characters are not read-only', () => {
  expectNotReadOnly('Bash', ['ls a\\;rm b', "cat 'a\\'; rm b", 'ls &', 'ls & rm x', 'ls\nrm x', 'ls\rrm x', 'ls \u200b', 'ls caf\u00e9', 'ls "unterminated', "cat 'unterminated"]);
});

test('empty, non-string and oversized commands are not read-only', () => {
  assert.strictEqual(isReadOnlyShellCommand('Bash', ''), false);
  assert.strictEqual(isReadOnlyShellCommand('Bash', '   '), false);
  assert.strictEqual(isReadOnlyShellCommand('Bash', ';'), false);
  assert.strictEqual(isReadOnlyShellCommand('Bash', null), false);
  assert.strictEqual(isReadOnlyShellCommand('Bash', { toString: () => 'ls' }), false);
  assert.strictEqual(isReadOnlyShellCommand('Bash', `ls ${'a'.repeat(5000)}`), false);
  assert.strictEqual(isReadOnlyShellCommand('Other', 'ls'), false);
});

test('bash-only commands are not read-only under PowerShell and vice versa', () => {
  expectNotReadOnly('PowerShell', ['find . -name x', 'tree', 'head a', 'fd x']);
  expectNotReadOnly('Bash', ['Get-ChildItem', 'gci', 'Select-String foo']);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
