'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { run } = require('../../scripts/hooks/copilot-guard');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-guard-'));
assert.strictEqual(spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' }).status, 0);
let passed = 0;
let failed = 0;
function test(name, action) {
  try { action(); passed++; console.log(`  PASS ${name}`); }
  catch (error) { failed++; console.error(`  FAIL ${name}: ${error.message}`); }
}
function shell(tool, command) { return run({ cwd: root, tool_name: tool, tool_input: { command } }); }
function edit(paths) { return run({ cwd: root, tool_name: 'Edit', tool_input: { edits: paths.map(file => ({ file_path: file })) } }); }
try {
  for (const [tool, commands] of [
    ['Bash', ['rm -rf scratch', 'git reset --hard HEAD', 'git clean -fd', 'git push --force', 'echo "$(rm -rf scratch)"', 'git commit -an']],
    ['PowerShell', ['Remove-Item scratch -Recurse', 'Get-ChildItem -Recurse | Remove-Item', '& { Remove-Item scratch -Force }', 'git commit --no-verify', '& "git.exe" commit -an', 'git commit --no-veri', 'git -c core.hooksPath=/dev/null commit -m x', 'pwsh -Command "git commit --no-verify"', "Invoke-Expression 'git commit --no-verify'", 'Write-Output "$(git commit --no-verify)"', 'Set-Alias g git; g commit --no-verify', "Start-Process git -ArgumentList 'commit --no-verify'", 'git commit --no-`verify']],
  ]) {
    commands.forEach((command, index) => test(`${tool} DENY-${index + 1}`, () => {
      assert.strictEqual(shell(tool, command).exitCode, 2);
      assert.strictEqual(shell(tool, command).exitCode, 2, 'repeating a denied operation must not create evidence');
    }));
  }
  for (const [tool, commands] of [
    ['Bash', ['git status', 'git commit -m "mention --no-verify"', 'echo "rm -rf scratch"', 'node --version']],
    ['PowerShell', ['Get-ChildItem', 'git status', 'git commit -m "mention --no-verify"', 'Write-Output "git commit --no-verify"', 'Write-Output "Remove-Item -Recurse"', 'git log -n 1']],
  ]) commands.forEach((command, index) => test(`${tool} ALLOW-${index + 1}`, () => assert.strictEqual(shell(tool, command).exitCode, 0)));
  test('all batch edit targets are checked', () => assert.strictEqual(edit(['safe.js', '.env.local']).exitCode, 2));
  test('ordinary file edits pass', () => assert.strictEqual(edit(['safe.js']).exitCode, 0));
  test('shell redirection and literal writers cannot bypass sensitive-file checks', () => {
    for (const command of ['echo x > .env', 'echo x >>.env', 'tee .env.local', 'cp safe .env', 'mv safe .env', 'rm .env', 'cd auth; echo x > safe', 'command tee .env', 'env cp safe .env', 'bash -c "echo x > .env"', 'echo "$(tee .env)"']) {
      assert.strictEqual(shell('Bash', command).exitCode, 2, command);
    }
    for (const command of ['Set-Content -Path .env -Value x', 'Set-Content -LiteralPath:.env -Value x', 'Copy-Item safe .env', 'Write-Output x > .env', 'Out-File -FilePath .env', 'Out-File -FilePath:.env', 'Set-Content -Path $target -Value x', 'Set-Content -Path (".env") -Value x', "Set-Content -Path 'safe','.env' -Value x"]) {
      assert.strictEqual(shell('PowerShell', command).exitCode, 2, command);
    }
  });
  test('ordinary literal shell writes remain allowed', () => {
    for (const [tool, command] of [['Bash', 'echo x > safe.txt'], ['Bash', 'tee safe.txt'], ['PowerShell', 'Set-Content -Path safe.txt -Value hello']]) {
      assert.strictEqual(shell(tool, command).exitCode, 0, command);
    }
  });
  test('commit staged errors are blocked using canonical heuristics without exposing source', () => {
    fs.writeFileSync(path.join(root, 'source.js'), 'debugger;');
    assert.strictEqual(spawnSync('git', ['add', '--', 'source.js'], { cwd: root }).status, 0);
    for (const tool of ['Bash', 'PowerShell']) {
      const result = shell(tool, 'git commit -m "fix: review source"');
      assert.strictEqual(result.exitCode, 2);
      assert.ok(!result.stderr.includes('debugger;'));
    }
    fs.writeFileSync(path.join(root, 'source.js'), 'const x = 1;');
    assert.strictEqual(spawnSync('git', ['add', '--', 'source.js'], { cwd: root }).status, 0);
    const result = shell('Bash', 'git commit -m "fix: review source"');
    assert.strictEqual(result.exitCode, 0);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /1 staged source/);
  });
  test('push and dev-server preflight emits feedback without changing commands', () => {
    assert.match(JSON.parse(shell('Bash', 'git push origin main').stdout).hookSpecificOutput.additionalContext, /Review changes/);
    assert.match(JSON.parse(shell('PowerShell', 'npm run dev').stdout).hookSpecificOutput.additionalContext, /No tmux or command rewrite/);
    assert.strictEqual(shell('Bash', 'echo "npm run dev"').stdout, undefined);
  });
  test('sensitive symlink targets are checked', () => {
    fs.writeFileSync(path.join(root, '.env'), 'synthetic');
    fs.symlinkSync(path.join(root, '.env'), path.join(root, 'alias.js'));
    assert.strictEqual(edit(['alias.js']).exitCode, 2);
  });
  test('hardlink targets require explicit operator review', () => {
    fs.writeFileSync(path.join(root, 'linked.js'), '');
    fs.linkSync(path.join(root, 'linked.js'), path.join(root, 'second.js'));
    assert.strictEqual(edit(['second.js']).exitCode, 2);
  });
  test('malformed and unsupported requests fail closed', () => {
    for (const input of [null, [], {}, { tool_name: 'Bash', tool_input: {} }, { tool_name: 'Edit', tool_input: { edits: [] } }]) assert.strictEqual(run(input).exitCode, 2);
  });
  test('overlarge inputs are denied without retaining their contents', () => {
    const result = run('x'.repeat(1024 * 1024 + 1));
    assert.strictEqual(result.exitCode, 2);
    assert.ok(result.stderr.length < 200);
  });
  test('stdin executable returns valid hook output', () => {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/hooks/copilot-guard.js')], {
      input: JSON.stringify({ cwd: root, tool_name: 'PowerShell', tool_input: { command: 'git commit --no-verify' } }), encoding: 'utf8', timeout: 5000,
    });
    assert.strictEqual(result.status, 2);
    assert.deepStrictEqual(JSON.parse(result.stdout), {});
    assert.ok(result.stderr.includes('BLOCKED'));
  });
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
