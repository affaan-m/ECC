/**
 * Tests for scripts/hooks/block-no-verify.js via run-with-flags.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runHook(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [runner, 'pre:bash:block-no-verify', 'scripts/hooks/block-no-verify.js', 'minimal,standard,strict'], {
    input: rawInput,
    encoding: 'utf8',
    env: {
      ...process.env,
      ECC_HOOK_PROFILE: 'standard',
      ...env
    },
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

let passed = 0;
let failed = 0;

console.log('\nblock-no-verify hook tests');
console.log('─'.repeat(50));

// --- Basic allow/block ---

if (test('allows plain git commit', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "hello"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks --no-verify on git commit', () => {
  const r = runHook({ tool_input: { command: 'git commit --no-verify -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('BLOCKED'), `stderr should contain BLOCKED: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks -n shorthand on git commit', () => {
  const r = runHook({ tool_input: { command: 'git commit -n -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('BLOCKED'), `stderr should contain BLOCKED: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks core.hooksPath override', () => {
  const r = runHook({ tool_input: { command: 'git -c core.hooksPath=/dev/null commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('core.hooksPath'), `stderr should mention core.hooksPath: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks quoted core.hooksPath override argument', () => {
  const r = runHook({ tool_input: { command: 'git -c "core.hooksPath=/dev/null" commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('core.hooksPath'), `stderr should mention core.hooksPath: ${r.stderr}`);
})) passed++; else failed++;

// --- Chained command false positive prevention (Comment 2) ---

if (test('does not false-positive on -n belonging to git log in a chain', () => {
  const r = runHook({ tool_input: { command: 'git log -n 10 && git commit -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('does not false-positive on --no-verify in a prior non-git command', () => {
  const r = runHook({ tool_input: { command: 'echo --no-verify && git commit -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows --no-verify discussed in a double-quoted commit message', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "fix: --no-verify edge case"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows --no-verify discussed in a single-quoted commit message', () => {
  const r = runHook({ tool_input: { command: "git commit -m 'fix: --no-verify edge case'" } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows -n discussed in a quoted commit message', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "Fixed -n bug in module"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows --no-verify after combined -am message option', () => {
  const r = runHook({ tool_input: { command: 'git commit -am "--no-verify"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows -n after combined -am message option', () => {
  const r = runHook({ tool_input: { command: 'git commit -am "-n"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// --- Short options cluster, so -n need not lead ---

if (test('blocks -n clustered after -a', () => {
  const r = runHook({ tool_input: { command: 'git commit -an -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks -n clustered after -s', () => {
  const r = runHook({ tool_input: { command: 'git commit -sn -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks -n clustered after -v', () => {
  const r = runHook({ tool_input: { command: 'git commit -vn -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('allows -mn, where n is the inline message and not a flag', () => {
  const r = runHook({ tool_input: { command: 'git commit -mn' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows core.hooksPath discussed in a quoted commit message', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "doc: explain core.hooksPath= setting"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows git bypass phrase discussed in a quoted commit message', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "doc: explain git push --no-verify risk"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('still blocks --no-verify on the git commit part of a chain', () => {
  const r = runHook({ tool_input: { command: 'git log -n 5 && git commit --no-verify -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('still blocks a real quoted --no-verify flag', () => {
  const r = runHook({ tool_input: { command: 'git commit "--no-verify" -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('BLOCKED'), `stderr should contain BLOCKED: ${r.stderr}`);
})) passed++; else failed++;

if (test('still blocks bypass flags in later chained git commands', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "msg" && git push --no-verify' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('git push'), `stderr should mention git push: ${r.stderr}`);
})) passed++; else failed++;

// --- Subcommand detection (Comment 4) ---

if (test('does not misclassify "commit" as subcommand when it is an argument to push', () => {
  // "git push origin commit" — "commit" is a refspec arg, not the subcommand
  const r = runHook({ tool_input: { command: 'git push origin commit' } });
  // This should detect "push" as the subcommand, not "commit"
  // Either way it should not block since there's no --no-verify
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// --- Blocks on push --no-verify ---

if (test('blocks --no-verify on git push', () => {
  const r = runHook({ tool_input: { command: 'git push --no-verify' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('git push'), `stderr should mention git push: ${r.stderr}`);
})) passed++; else failed++;

// --- Non-git commands pass through ---

if (test('allows non-git commands', () => {
  const r = runHook({ tool_input: { command: 'npm test' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// --- Plain text input (not JSON) ---

if (test('handles plain text input', () => {
  const r = runHook('git commit -m "hello"');
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks plain text input with --no-verify', () => {
  const r = runHook('git commit --no-verify -m "msg"');
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

// --- Case-insensitivity of git config keys + -t template short option ---

if (test('blocks case-variant core.hooksPath (lowercase)', () => {
  const r = runHook({ tool_input: { command: 'git -c core.hookspath=/dev/null commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(/core\.hookspath/i.test(r.stderr), `stderr should mention core.hooksPath: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks case-variant core.hooksPath (uppercase)', () => {
  const r = runHook({ tool_input: { command: 'git -c core.HOOKSPATH=/dev/null commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('still allows -tn (n is the -t template path, not a flag)', () => {
  const r = runHook({ tool_input: { command: 'git commit -tn -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// --- Optional stuck values (-u, -S) and long-option prefixes ---

if (test('allows -uno (n is the -u untracked-files mode, not a flag)', () => {
  const r = runHook({ tool_input: { command: 'git commit -uno -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows -Sn (n is the -S key id, not a flag)', () => {
  const r = runHook({ tool_input: { command: 'git commit -Sn -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('still blocks -nu (n comes before the optional-value flag)', () => {
  const r = runHook({ tool_input: { command: 'git commit -nu -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks --no-veri (git accepts unambiguous long-option prefixes)', () => {
  const r = runHook({ tool_input: { command: 'git commit --no-veri -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks --no-verif on git push', () => {
  const r = runHook({ tool_input: { command: 'git push --no-verif origin main' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('allows --no-verbose (not a prefix of --no-verify)', () => {
  const r = runHook({ tool_input: { command: 'git commit --no-verbose -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// --- A git command line quoted as an argument to another program is data ---

if (test('allows a quoted git command line passed as an argument to another program', () => {
  for (const command of [
    "node /tmp/cli.js 'git commit --no-verify -m x'",
    'node /tmp/cli.js "git push --no-verify"',
    "printf '%s' 'git commit --no-verify -m x' | node /tmp/x.js",
    "python3 /tmp/check.py 'git commit --no-verify'",
    "node /tmp/cli.js --expect 'git push --no-verify'",
    "grep -n 'git commit --no-verify' docs/hooks.md",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 0, `expected exit 0 for ${command}, got ${r.code}: ${r.stderr}`);
  }
})) passed++; else failed++;

// A runtime given an eval flag executes its quoted argument as source, so a
// bypass in that source runs git for real and stays blocked.
if (test('blocks a git bypass inside a runtime eval payload', () => {
  for (const command of [
    'node -e "require(\'child_process\').execSync(\'git commit --no-verify -m x\')"',
    "node -e 'require(\"child_process\").execSync(\"git push --no-verify\")'",
    'node --eval="git commit --no-verify -m x"',
    'node -p "cp.execSync(\'git push --no-verify\')"',
    "python3 -c 'import os; os.system(\"git push --no-verify\")'",
    "perl -e 'system(\"git commit --no-verify -m x\")'",
    "ruby -e 'system(\"git push --no-verify\")'",
    "php -r 'shell_exec(\"git commit --no-verify -m x\");'",
    'deno eval "git push --no-verify"',
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

if (test('allows a runtime flag that loads code but leaves the quoted argument as data', () => {
  for (const command of [
    // node -r preloads a module; the script and its arguments stay data.
    "node -r setup.js cli.js 'git push --no-verify'",
    'node --require ts-node/register cli.js "git commit --no-verify -m x"',
    "ruby -r./setup cli.rb 'git push --no-verify'",
    "python3 -B check.py 'git commit --no-verify'",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 0, `expected exit 0 for ${command}, got ${r.code}: ${r.stderr}`);
  }
})) passed++; else failed++;

if (test('blocks each runtime through its own eval flag', () => {
  for (const command of [
    'node -p "cp.execSync(\'git push --no-verify\')"',
    "php -r 'shell_exec(\"git commit --no-verify -m x\");'",
    "perl -E 'system(\"git push --no-verify\")'",
    "lua -e 'os.execute(\"git commit --no-verify -m x\")'",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

// find, fd and parallel run a command line of their own for each file or
// input line; a quoted git handed to them runs for real.
if (test('blocks a quoted git command line run by find, fd or parallel', () => {
  for (const command of [
    "find . -exec sh -c 'git commit --no-verify -m x' \\;",
    "find . -name '*.md' -execdir bash -c 'git push --no-verify' \\;",
    "fd -e md -x sh -c 'git commit -n -m x'",
    "find . -exec 'sh' -c 'git commit --no-verify -m x' \\;",
    "parallel 'git push --no-verify {}' ::: origin upstream",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

// Without one of their exec flags, find and fd only search for or print a
// quoted operand.
if (test('allows a bypass phrase that find or fd only searches for or prints', () => {
  for (const command of [
    "find . -name 'git commit --no-verify'",
    "find . -type f -printf 'git push --no-verify %p\\n'",
    "fd 'git push --no-verify' docs",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 0, `expected exit 0 for ${command}, got ${r.code}: ${r.stderr}`);
  }
})) passed++; else failed++;

// A program that find or fd launches decides for itself: grep searches for a
// quoted phrase, a shell runs it. After find's `;` the arguments are find's.
if (test('allows a bypass phrase that a program run by find or fd searches for', () => {
  for (const command of [
    "find . -exec grep 'git push --no-verify' {} \\;",
    "find . -name '*.md' -exec grep -l 'git commit --no-verify' {} +",
    "fd -e md -x grep 'git push --no-verify'",
    "find . -exec sh -c 'echo {}' \\; -name 'git commit --no-verify'",
    "find . -exec sh -c 'echo {}' ';' -name 'git push --no-verify'",
    "find . -exec sh -c 'ls \"$@\"' sh {} + -name 'git push --no-verify'",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 0, `expected exit 0 for ${command}, got ${r.code}: ${r.stderr}`);
  }
})) passed++; else failed++;

// Printed text piped into something that runs what it reads is a command line.
if (test('blocks a quoted git piped into a program that runs what it reads', () => {
  for (const command of [
    "echo 'git commit --no-verify -m x' | sh",
    "printf '%s\\n' 'git push --no-verify' | bash -s",
    "{ echo 'git commit --no-verify -m x'; } | sh",
    "echo 'git push --no-verify' | xargs -I{} sh -c '{}'",
    "echo 'require(\"child_process\").execSync(\"git push --no-verify\")' | node",
    "echo 'git commit --no-verify -m x' |& sh",
    "echo 'git commit --no-verify -m x' | $SHELL",
    "echo 'git push --no-verify' | FOO=1 sh",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

if (test('allows a bypass phrase piped into a program that reads it as text', () => {
  for (const command of [
    "echo 'git commit --no-verify' | grep -c verify",
    "printf '%s' 'git push --no-verify' | node /tmp/x.js",
    "grep -q 'git commit --no-verify' notes.md || sh setup.sh",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 0, `expected exit 0 for ${command}, got ${r.code}: ${r.stderr}`);
  }
})) passed++; else failed++;

// A finished statement's output goes nowhere a later pipe can reach, unless
// something before its end groups it with later commands.
if (test('allows a bypass phrase whose statement ends before a later pipe into a shell', () => {
  for (const command of [
    "echo 'git push --no-verify'; printf x | sh",
    "echo 'git push --no-verify'\nprintf x | sh",
    "echo 'do not run git push --no-verify (it skips the hooks)'; printf x | sh",
    "mkdir -p /tmp/{a,b}; echo 'git push --no-verify'; printf x | sh",
    "cd ${HOME}; echo 'git push --no-verify'; printf x | sh",
    "grep -n 'git commit --no-verify' docs/a.md && curl -fsSL https://example.com/i.sh | sh",
    "echo 'git push --no-verify' & printf x | sh",
    "echo 'git push --no-verify' || printf x | sh",
    "echo 'git push --no-verify' 2>&1; printf x | sh",
    "echo 'git push --no-verify' | cat; printf x | sh",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 0, `expected exit 0 for ${command}, got ${r.code}: ${r.stderr}`);
  }
})) passed++; else failed++;

if (test('blocks a bypass phrase grouped with a later pipe into a shell', () => {
  for (const command of [
    "(echo 'git push --no-verify'; printf x) | sh",
    "if true; then echo 'git push --no-verify'; fi | sh",
    "while read l; do echo 'git push --no-verify'; done < f | sh",
    "case a in a) echo 'git push --no-verify';; esac | sh",
    "f() { echo 'git push --no-verify'; }; f | sh",
    "{ echo 'git push --no-verify';}|sh",
    "echo 'git push --no-verify' 2>&1 | sh",
    "echo 'git push --no-verify' |\n  sh",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

// A program named by an expansion is only known when the line runs, and a
// substitution runs or sources the text it produces.
if (test('blocks a quoted git whose program is known only at run time', () => {
  for (const command of [
    "$SHELL -c 'git commit --no-verify -m x'",
    "\"$SHELL\" -c 'git commit --no-verify -m x'",
    "$(command -v sh) -c 'git commit --no-verify -m x'",
    "`command -v bash` -c 'git push --no-verify'",
    "find . -exec $SHELL -c 'git commit --no-verify -m x' \\;",
    "$(echo 'git commit --no-verify -m x')",
    "source <(echo 'git commit --no-verify -m x')",
    ". <(printf '%s' 'git push --no-verify')",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

if (test('blocks a quoted git that a shell builtin runs or keeps to run', () => {
  for (const command of [
    "builtin eval 'git commit --no-verify -m x'",
    "trap 'git push --no-verify' EXIT",
    "noglob sh -c 'git commit --no-verify -m x'",
    "nocorrect sh -c 'git push --no-verify'",
    "alias gc='git commit --no-verify -m x'",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

// awk takes its program as the first operand, without an eval flag, and
// expect runs a Tcl script given with -c; both can spawn git.
// GNU sed runs a command line through a shell for an `s` command with the `e`
// flag and for an `e` command, so what those run is checked, while a sed
// script that only mentions a bypass flag stays data.
if (test('blocks a git bypass that a sed script runs', () => {
  for (const command of [
    "printf x | sed 's/x/git commit --no-verify/e'",
    "printf x | sed -e 's/x/git commit --no-verify/e'",
    "printf x | sed --expression='s/x/git push --no-verify/e'",
    "printf x | sed 's|x|git push --no-verify|e'",
    "printf x | sed 'e git commit --no-verify'",
    "echo 'git push --no-verify' | sed e",
    "echo 'git push --no-verify' | sed 's/^//e'",
    // Any character but a backslash or a newline can delimit an `s` command.
    "printf foo | sed 'sxfooxgit push --no-verifyxe'",
    // sed reads an escaped character in a replacement as that character.
    "printf x | sed 's/x/git\\ push\\ --no-verify/e'",
    // The script is read wherever sed takes it from.
    'printf x | sed s/x/git\\ push\\ --no-verify/e',
    'printf x | sed -es/x/git\\ push\\ --no-verify/e',
    "printf x | sed --expr='s/x/git push --no-verify/e'",
    "sed -n -- 'e git push --no-verify' notes.md",
    "sed notes.md -e 'e git push --no-verify'",
    "sed -l 80 'e git push --no-verify' notes.md",
    // -ie is -i with the backup suffix e, so the operand is the script.
    "sed -ie -n 'e git push --no-verify' notes.md",
    "printf x | sudo sed 's/x/git push --no-verify/e'",
    "printf x | sed -n '/x/!d; e git push --no-verify'",
    // $EXPR may be an option such as -n, and then the quoted operand is the script.
    "sed \"$EXPR\" 'e git push --no-verify' notes.md",
    // So may the output of a substitution.
    "printf x | sed `printf %s -n` 's/x/git push --no-verify/e'",
    "printf x | sed $(printf %s -n) 's/x/git push --no-verify/e'",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

// sed reads its script command by command: the text `a`, `i` and `c` add, a
// comment, a label or a file name is never a command, and an operand after
// the script, or after an -e or -f option, is an input file.
if (test('allows sed input files, added text and comments that mention a bypass', () => {
  for (const command of [
    "sed 's/x/y/' 'e git commit --no-verify'",
    "sed -e 's/x/y/' 'e git commit --no-verify'",
    "sed --expression='s/x/y/' 'e git push --no-verify'",
    "sed -f fix.sed 'e git push --no-verify'",
    "sed --file=fix.sed 'e git push --no-verify'",
    "sed -i '1i e git push --no-verify is unsafe' README.md",
    "sed -i '$a e git push --no-verify is unsafe' README.md",
    "sed -i '/hooks/c e git push --no-verify is unsafe' README.md",
    "sed -n '# e git push --no-verify' README.md",
    // Addresses that match the text of a sed command that runs git.
    "sed -n '/s|x|git push --no-verify|e/p' notes.md",
    "sed -n '\\%s/x/git push --no-verify/e%p' notes.md",
    "sed -n 'w e git push --no-verify' notes.md",
    // Labels named e, which the t command branches to.
    "echo 'git push --no-verify' | sed -e :e -e '$!N;s/\\n/ /;te'",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 0, `expected exit 0 for ${command}, got ${r.code}: ${r.stderr}`);
  }
})) passed++; else failed++;

if (test('allows a sed script that only mentions a bypass flag', () => {
  for (const command of [
    "sed -i 's/git commit --no-verify/git commit/' notes.md",
    "sed -n '/git push --no-verify/p' docs/hooks.md",
    "echo 'git push --no-verify' | sed 's/push/pull/'",
    "printf x | sed 's/x/git status/e'",
    "sed -i 's/use git commit --no-verify here/use git commit here/' README.md",
    "sed -n '/use git commit --no-verify here/p' README.md",
    "grep -F 's/x/git push --no-verify/e' notes.md",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 0, `expected exit 0 for ${command}, got ${r.code}: ${r.stderr}`);
  }
})) passed++; else failed++;

if (test('blocks a git bypass in awk program source and an expect -c script', () => {
  for (const command of [
    "awk 'BEGIN { system(\"git commit --no-verify -m x\") }'",
    "gawk 'BEGIN { system(\"git push --no-verify\") }' /dev/null",
    "mawk '{ print | \"git commit -n -m x\" }' input.txt",
    "expect -c 'spawn git commit --no-verify -m x'",
    // The payload goes on after the call that runs git.
    "awk 'BEGIN { system(\"git push --no-verify\") }'",
    "node -e 'require(\"child_process\").execSync(\"git push --no-verify\"); console.log(\"done\")'",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

if (test('allows an expect script path whose arguments mention a bypass', () => {
  const command = "expect release.exp 'git push --no-verify'";
  const r = runHook({ tool_input: { command } });
  assert.strictEqual(r.code, 0, `expected exit 0 for ${command}, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('still allows a bypass phrase in an eval payload that does not run git', () => {
  for (const command of [
    'node -e "console.log(\'use --no-verify only in emergencies\')"',
    "python3 -c 'print(\"never pass -n to commit\")'",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 0, `expected exit 0 for ${command}, got ${r.code}: ${r.stderr}`);
  }
})) passed++; else failed++;

if (test('blocks a quoted git command line behind a process prefix or another shell', () => {
  for (const command of [
    "setsid sh -c 'git commit --no-verify -m x'",
    'csh -c "git commit --no-verify -m x"',
    "tcsh -c 'git push --no-verify'",
    "stdbuf -oL bash -c 'git commit -n -m x'",
    "taskset -c 0 sh -c 'git push --no-verify'",
    "unshare -n sh -c 'git commit --no-verify -m x'",
    "runuser -u deploy -- sh -c 'git push --no-verify'",
    "npx some-runner 'git commit --no-verify -m x'",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

if (test('blocks a git command substituted inside a double-quoted data argument', () => {
  for (const command of [
    'echo "$(git commit --no-verify -m x)"',
    'echo "$(git push --no-verify)"',
    'printf "%s" "`git push --no-verify`"',
    'node /tmp/cli.js "result: $(git commit -n -m x)"',
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

if (test('blocks a quoted git command line inside a compound command or a nested substitution', () => {
  for (const command of [
    "( sh -c 'git commit --no-verify -m x' )",
    "{ sh -c 'git push --no-verify'; }",
    "if sh -c 'git commit --no-verify -m x'; then echo ok; fi",
    "for f in a b; do sh -c 'git commit --no-verify -m x'; done",
    'echo "$(echo "x"; git commit --no-verify -m x)"',
    'echo "before $(sh -c \'git commit --no-verify -m x\') after"',
    'echo "$(echo "$(git push --no-verify)")"',
    "FOO=\"pre$(echo x)post\" sh -c 'git commit --no-verify -m x'",
    "PREFIX=\"`date`\" sh -c 'git push --no-verify'",
    "sh -c 'git push --no-verify'; echo done",
    "sh -c 'git push --no-verify' && echo done",
    'sh -c "git commit --no-verify -m x" || true',
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

if (test('stays fast on a large quoted data payload full of git tokens', () => {
  const payload = 'git commit --no-verify -m x '.repeat(12000);
  const command = `node /tmp/cli.js '${payload}'`;
  assert.ok(command.length > 300000, 'payload should exceed 300 KB');
  const started = Date.now();
  const r = runHook({ tool_input: { command } });
  const elapsed = Date.now() - started;
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
  assert.ok(elapsed < 5000, `hook took ${elapsed}ms on a 300 KB quoted payload`);
})) passed++; else failed++;

if (test('still blocks a quoted git command line handed to a shell or command wrapper', () => {
  for (const command of [
    'sh -c "git commit --no-verify -m x"',
    "bash -lc 'git push --no-verify'",
    'sudo git commit --no-verify -m x',
    "xargs -0 git commit --no-verify",
    'env FOO=1 git commit -n -m x',
    "eval 'git commit --no-verify -m x'",
    'node /tmp/cli.js "data" && git commit --no-verify -m x',
    "echo 'git commit --no-verify' ; git push --no-verify",
  ]) {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2 for ${command}, got ${r.code}`);
  }
})) passed++; else failed++;

console.log('─'.repeat(50));
console.log(`Passed: ${passed}  Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
