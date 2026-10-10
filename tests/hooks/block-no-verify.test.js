/**
 * Tests for scripts/hooks/block-no-verify.js via run-with-flags.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const hook = require('../../scripts/hooks/block-no-verify');
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

function runHook(input) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = hook.run(rawInput);
  return { code: result.exitCode, stdout: result.stdout || '', stderr: result.stderr || '' };
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


// --- Quoted/heredoc candidates: preserve blocking, prevent flag leakage ---

const executingPayloads = [
  // Quoted heredoc delimiter disables shell expansion but Python still consumes code; unsupported interpreter language remains conservative on a literal bypass phrase.
  ['hyphenated Python heredoc delimiter', 'python3 - <<\'PY-SCRIPT\'\nprint("git commit -n")\nPY-SCRIPT\nbash -n x.sh'],
  ['block double-quoted git executable', '"git" commit -n -m x'],
  ['block single-quoted git executable', "'git' commit -n -m x"],
  ['block git executable assembled with empty single quotes', "g''it commit -n -m x"],
  ['block git executable assembled with empty double quotes', 'g""it commit --no-verify -m x'],
  ['block git executable assembled from quoted prefix', "'g'it commit -n -m x"],
  ['block git executable assembled from quoted middle', "g'i't commit -n -m x"],
  ['block git executable assembled with an escape', 'g\\it commit -n -m x'],
  ['block double-quoted git plus exe suffix', '"git".exe commit -n -m x'],
  ['block single-quoted git plus exe suffix', "'git'.exe commit -n -m x"],
  ['block hooksPath after double-quoted git plus exe suffix', '"git".exe -c core.hooksPath=/tmp/no commit -m x'],
  ['block hooksPath after single-quoted git plus exe suffix', "'git'.exe -c core.hooksPath=/tmp/no commit -m x"],
  ['block double-quoted git with quote-assembled exe suffix', '"git".e""xe commit -n -m x'],
  ['block single-quoted git with quote-assembled exe suffix', "'git'.e''xe commit -n -m x"],
  ['block quoted git with escaped exe suffix', '"git".\\exe commit -n -m x'],
  ['block hooksPath after quote-assembled exe suffix', '"git".e""xe -c core.hooksPath=/tmp/no commit -m x'],
  ['quoted hash does not hide a later commit bypass', 'echo "#"; git commit -n -m x'],
  ['hash text in quotes does not hide a later commit bypass', 'echo "not # a comment" && git commit --no-verify -m x'],
  ['word-internal hash does not hide a later commit bypass', 'echo foo#bar; git commit -n -m x'],
  ['word-internal hash does not hide a later push bypass', 'printf %s foo#bar && git push --no-verify'],
  ['pipe echo data to bash', "echo 'git commit -n -m x' | bash"],
  ['pipe printf data to sh', "printf '%s\\n' 'git commit --no-verify -m x' | sh"],
  ['execute data through xargs and bash -c', "printf '%s\\n' 'git commit -n -m x' | xargs -I CMD bash -c CMD"],
  ['execute command substitution text through bash', "echo '$(git commit -n -m x)' | bash"],
  ['execute bash here-string', "bash <<< 'git commit -n -m x'"],
  ['execute sh here-string', "sh -s <<< 'git commit --no-verify -m x'"],
  ['block backtick command substitution', 'echo "`git commit -n -m x`"'],
  ['block substitution after quoted parenthesis', 'echo "$(printf \')\'; git commit -n -m x)"'],
  ['block substitution after case parenthesis', 'echo "$(case x in x) :;; esac; git commit -n -m x)"'],
  ['block bash --noprofile -c', "bash --noprofile -c 'git commit -n -m x'"],
  ['block bash -O extglob -c', "bash -O extglob -c 'git commit -n -m x'"],
  ['block bash -o pipefail -c', "bash -o pipefail -c 'git commit -n -m x'"],
  ['block bash -c after option terminator', "bash -c -- 'git commit -n -m x'"],
  ['block sh -c after option terminator', "sh -c -- 'git commit --no-verify -m x'"],
  ['block heredoc piped to bash', 'cat <<EOF | bash\ngit commit -n -m x\nEOF'],
  ['block heredoc piped to sudo bash', 'cat <<EOF | sudo bash\ngit commit --no-verify -m x\nEOF'],
  ['block heredoc on leading redirection', '<<EOF bash\ngit commit -n -m x\nEOF'],
  ['block executable command after CRLF heredoc', 'python3 - <<\'PY\'\r\nprint("git commit -n")\r\nPY\r\ngit commit -n -m x'],
  ['block bash -c double-quoted payload', 'bash -c "git commit -n -m x"'],
  ['block eval payload', 'eval "git commit --no-verify -m x"'],
  ['block bash heredoc payload', 'bash <<EOF\ngit commit -n -m x\nEOF'],
  ['block second command in a chain', 'git commit -m ok; git commit --no-verify -m x'],
  ['block third command in a chain', 'git add -A && git commit -m ok && git push --no-verify'],
  ['block combined short flag after a clean command', 'git commit -m ok; git commit -am x -n'],
  ['block bypass in a whitespace-separated command sequence', 'git commit -m ok            git push --no-verify'],
  ['block ANSI-C quoted git executable', "$'git' commit -n -m x"],
  ['block ANSI-C quoted git with long flag', "$'git' commit --no-verify -m x"],
  ['block line-continued commit bypass', 'git commit \\\n--no-verify -m x'],
  ['block heredoc line-continued commit bypass', 'cat <<EOF | bash\ngit commit \\\n--no-verify -m x\nEOF'],
];

for (const [name, command] of executingPayloads) {
  if (test(name, () => {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}: ${r.stderr}`);
  })) passed++; else failed++;
}

const nonLeakingPayloads = [
  // Inside double quotes a backslash before dot remains literal, so decoded executable is git\.exe, not git.exe.
  ['allows the distinct executable with a literal escaped dot', '"git""\\.exe" commit -n -m x'],
  // A complete echo operand is data; accepted role repair intentionally corrects the authored broad-blocking expectation.
  ['allows quoted echo data (corrected author expectation)', 'echo "git commit -n"'],
  ['python heredoc string with later bash -n', 'python3 - <<\'PY\'\nold="git add -A\\nif ! git diff --cached --quiet; then\\n  git commit -q -m \\"vault sync"\nPY\nbash -n vault-sync.sh'],
  ['assignment string with later bash -n', 'old="git commit -q -m x"; bash -n x.sh'],
  ['plain commit followed by later-line bash -n', 'git commit -m x\nbash -n s.sh'],
  ['plain commit followed by grep -n', 'git commit -m x; grep -n foo f.txt'],
  ['JSON string followed by sed -n', 'printf \'%s\' \'{"cmd":"git commit -q -m \\"x\\""}\' | node x.js; sed -n 1p f'],
  ['non-shell heredoc after bash argument', "bash -c 'cat' <<EOF\ngit commit -q -m x\nEOF\nbash -n y.sh"],
  ['separate commits do not inherit bash -n', 'git commit -m x   ;   git commit --no-edit   ;   bash -n x.sh   ;   git commit -tn'],
  ['double-quoted literal does not inherit grep -n', 'echo "git commit -q -m x"; grep -n needle file'],
  ['single-quoted push literal does not inherit later flag', "note='git push'; printf '%s\\n' --no-verify"],
  ['Python heredoc line does not inherit sed flag', 'python3 <<EOF\nprint("git commit -q -m x")\nEOF\nsed --no-verify file'],
  ['assignment literal does not inherit grep long flag', "payload='git commit -m x'; grep --no-verify file"],
  ['printf literal does not inherit bash -n', 'printf \'%s\' "git commit -m x"; bash -n script.sh'],
  ['assignment literal does not inherit quoted echo -n data', 'old="git commit -q"; echo " -n"'],
  ['push literal does not inherit quoted printf long flag data', "payload='git push'; printf ' --no-verify'"],
  ['printf literal does not inherit later quoted echo -n data', 'printf "%s" "git commit -q"; echo " -n"'],
  ['quoted git executable does not inherit later grep -n', '"git" status; grep -n needle file'],
  ['assembled git executable does not inherit later bash -n', "g''it status && bash -n script.sh"],
  ['quoted git executable does not inherit quoted echo -n data', "'git' status; echo \" -n\""],
  ['quoted git commit does not inherit later bash -n', '"git" commit -m x; bash -n y.sh'],
  ['ANSI-C quoted status does not inherit later grep -n', "$'git' status; grep -n needle file"],
  ['heredoc python string line ending in backslash does not inherit later bash -n', 'python3 - <<\'PY\'\nprint("git commit -q \\\n")\nPY\nbash -n x.sh'],
];

for (const [name, command] of nonLeakingPayloads) {
  if (test(name, () => {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
  })) passed++; else failed++;
}
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


// Finite literal role regressions: supplied command strings are never executed.
for (const command of [
  "git commit -m \"$(git push --no-verify)\"",
  "git commit -m \"$(git -c core.hooksPath=/dev/null push)\"",
  "git commit --message=\"$(git push --no-veri)\"",
  "git commit -m \"`git push --no-verify`\"",
  "echo '#'; git push --no-verify",
  "'bash' -c 'git push --no-verify'",
  "printf '%s' 'git commit --no-verify'; git push --no-verify",
  "printf '%s' 'git push --no-verify' | sh",
  "printf '%s' 'git push --no-verify' | sudo -u root bash",
  "git commit -m \"$(printf '%s' 'git push --no-verify' | sh)\"",
  "echo $(echo $(git push --no-verify))",
  "cat <(git push --no-verify)",
  "cat <<EOF\n'$(git push --no-verify)'\nEOF",
  "cat <<EOF\n`git push --no-verify`\nEOF",
  "bash <<'EOF'\ngit push --no-verify\nEOF",
  "cat <<'EOF' | bash\ngit push --no-verify\nEOF",
  "cat <<-EOF | sh\n\tgit push --no-verify\n\tEOF",
  "cat <<A <<B\nsafe\nA\n$(git push --no-verify)\nB",
  "A=$(git push --no-verify) echo safe",
  "A=x command -- git push --no-verify",
  "command -p git commit --no-verif",
  "exec -a git /usr/bin/git commit --no-verify",
  "env -u HOME git push --no-verify",
  "sudo -u git git push --no-verify",
  "eval 'git' 'push' '--no-verify'",
  "bash -lc 'git push --no-verify' 'data'",
  "sh -c -- 'git commit --no-verify' arg0",
  "(git commit -m safe; git push --no-verify)",
  "if true; then git push --no-verify; fi",
  "echo safe # git commit -m safe\ngit push --no-verify",
  "g\\\nit push --no-verify",
  "git com''mit --no-verify",
  "git commit --no-veri # actual option",
  "git push '--no-verify'",
  "custom-wrapper 'git push --no-verify'",
  "python -c 'os.system(\"git push --no-verify\")'",
  "python3 <<'PY'\nprint(\"git commit -n\")\nPY"
]) {
  if (test(`literal denied: ${JSON.stringify(command)}`, () => {
    const result = runHook({ tool_input: { command } });
    assert.strictEqual(result.code, 2, result.stderr);
    assert.deepStrictEqual(runHook({ tool_input: { command } }), result, 'Second call must not inherit lexical state');
  })) passed++; else failed++;
}
for (const command of [
  "printf '%s' 'git commit --no-verify'",
  "printf '%s' eval 'git commit --no-verify'",
  "echo 'git commit' --no-verify",
  "bash -c 'echo ok' 'git push --no-verify'",
  "'bash' -c 'printf %s safe' 'git push --no-verify'",
  "git commit -m --no-verify",
  "git commit -Skeyn -m x",
  "git commit -- --no-verify",
  "git push '--no-verify;literal'",
  "git push '--no-verify)literal'",
  "git commit -m '$(git push --no-verify)'",
  "printf '%s' '$(git push --no-verify)'",
  "echo \"\\$(git push --no-verify)\"",
  "echo \"\\`git push --no-verify\\`\"",
  "cat <<'EOF'\n$(git push --no-verify)\nEOF",
  "cat <<\\EOF\ngit push --no-verify\nEOF",
  "cat <<EOF\ngit push --no-verify\nEOF",
  "cat <<EOF\n\\$(git push --no-verify)\nEOF",
  "cat <<'EOF'\ntext\nEOF\ngit commit -m safe",
  "echo 'git commit --no-verify' | cat",
  "printf '%s' 'git push --no-verify' | grep git",
  "cat <<'EOF' | cat\ngit push --no-verify\nEOF",
  "bash -c cat <<'EOF'\ngit push --no-verify\nEOF",
  "echo '# git push --no-verify'",
  "echo safe # git push --no-verify",
  "git commit -m safe # --no-verify",
  "payload='git push --no-verify'",
  "command -v git push --no-verify",
  "command -pV git commit --no-verify",
  "exec -a git echo 'push --no-verify'",
  "env -u git echo 'git push --no-verify'",
  "sudo -u git echo 'git push --no-verify'",
  "git commit -m safe > --no-verify",
  "git commit -m safe 2> --no-verify",
  "printf '%s' 'git push --no-verify'; git push origin main",
  "git -C '/tmp/git push --no-verify' status",
  "echo 'git commit --no-verify' > log",
  "bash script.sh 'git push --no-verify'"
]) {
  if (test(`literal allowed: ${JSON.stringify(command)}`, () => {
    const result = runHook({ tool_input: { command } });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.deepStrictEqual(runHook({ tool_input: { command } }), result, 'Second call must not inherit lexical state');
  })) passed++; else failed++;
}

if (test('bounded wide quoted data remains data', () => {
  assert.strictEqual(runHook(`printf '%s' ${"'git push --no-verify' ".repeat(2000)}`).code, 0);
})) passed++; else failed++;
if (test('deep nested substitutions fail closed within the work budget', () => {
  assert.strictEqual(runHook('echo ' + '$('.repeat(120) + 'git push --no-verify' + ')'.repeat(120)).code, 2);
})) passed++; else failed++;

for (const command of [
  'echo note{git push --no-verify}',
  'printf %s note{git push --no-verify}',
  'echo "$(printf %s case)"',
  "echo 'case x in x) git push --no-verify;; esac'",
]) {
  if (test(`literal role control: ${JSON.stringify(command)}`, () => {
    assert.strictEqual(runHook(command).code, 0);
  })) passed++; else failed++;
}
if (test('moderate nested execution identifies the actual Git bypass', () => {
  const result = runHook('echo ' + '$('.repeat(8) + 'git push --no-verify' + ')'.repeat(8));
  assert.strictEqual(result.code, 2);
  assert.match(result.stderr, /git push/);
})) passed++; else failed++;

if (test('escaped backtick inside substitution does not hide a later command', () => {
  const result = runHook('echo "`printf %s \\`; git push --no-verify`"');
  assert.strictEqual(result.code, 2);
  assert.match(result.stderr, /git push/);
})) passed++; else failed++;


// Review regressions: literal option roles and nested execution boundaries.
for (const [expected, commands] of [
  [2, [
    "bash +x -c 'git push --no-verify'",
    "bash +o posix -c 'git push --no-verify'",
    "bash +o errexit -c 'git push --no-verify'",
    "bash +O extglob -c 'git commit -n'",
    "bash +xo posix -c 'git push --no-verify'",
    "bash +oO posix extglob -c 'git push --no-verify'",
    "bash -c +x 'git push --no-verify'",
    "bash -co posix 'git push --no-verify'",
    "bash +c 'git push --no-verify'",
    "bash +x -c -- 'git push --no-verify'",
    "bash +x -c - 'git push --no-verify'",
    "bash +unknown -c 'git push --no-verify'",
    "echo \"$(cat <<'EOF'\n)\nEOF\ngit push --no-verify\n)\"",
    "echo \"$(cat <<EOF\n)\nEOF\ngit push --no-verify\n)\"",
    "echo \"$(cat <<')'\ntext\n)\ngit push --no-verify\n)\"",
    "echo \"$(cat <<E'OF'\n)\nEOF\ngit push --no-verify\n)\"",
    "echo \"$(cat <<\\EOF\n)\nEOF\ngit push --no-verify\n)\"",
    "echo \"$(cat <<-EOF\n\t)\n\tEOF\ngit push --no-verify\n)\"",
    "echo \"$(cat <<A <<'B'\n)\nA\n)\nB\ngit push --no-verify\n)\"",
    "echo \"$(cat <<'EOF' # delimiter is pending\n)\nEOF\ngit push --no-verify\n)\"",
    "echo \"$(echo $(cat <<'EOF'\n)\nEOF\ngit push --no-verify\n))\"",
    "echo \"$(cat <<EOF\n)\n$(git push --no-verify)\nEOF\n)\"",
    "echo \"`echo \\`git push --no-verify\\``\"",
    "echo \"`echo \\$(git push --no-verify)`\"",
    "echo \"`git push --no-verify`\"",
    "echo \"$(echo $(git push --no-verify))\"",
  ]],
  [0, [
    "bash +x -c 'echo safe' 'git push --no-verify'",
    "bash +o posix -c 'echo safe' 'git push --no-verify'",
    "bash +O extglob -c 'echo safe' 'git push --no-verify'",
    "bash +oO posix extglob -c 'echo safe' 'git push --no-verify'",
    "bash -co posix 'echo safe' 'git push --no-verify'",
    "bash -c +x 'echo safe' 'git push --no-verify'",
    "bash +x script.sh 'git push --no-verify'",
    "bash -- +x -c 'git push --no-verify'",
    "echo \"$(cat <<'EOF'\n)\ngit push --no-verify\nEOF\n)\"",
    "echo \"$(cat <<EOF\n)\ngit push --no-verify\nEOF\n)\"",
    "echo \"$(cat <<')'\ngit push --no-verify\n)\n)\"",
    "echo \"$(cat <<E'OF'\n)\n$(git push --no-verify)\nEOF\n)\"",
    "echo \"$(cat <<-EOF\n\t)\n\tgit push --no-verify\n\tEOF\n)\"",
    "echo \"$(cat <<A <<'B'\n)\nA\ngit push --no-verify\n)\nB\n)\"",
    "echo \"\\`git push --no-verify\\`\"",
    "echo '`echo \\`git push --no-verify\\``'",
    "echo \"`echo 'git push --no-verify'`\"",
    "printf '%s' 'git push --no-verify'",
  ]],
]) {
  for (const command of commands) {
    if (test(`review boundary ${expected}: ${JSON.stringify(command)}`, () => {
      const result = runHook(command);
      assert.strictEqual(result.code, expected, result.stderr);
      if (expected === 2) assert.match(result.stderr, /git (push|commit)/, 'The literal bypass, not budget exhaustion, must be identified');
    })) passed++; else failed++;
  }
}

// Nearby delimiter roles use the same lexer and must not become heredocs.
for (const [expected, command] of [
  [2, "echo \"$(cat <<\\\n EOF\n)\nEOF\ngit push --no-verify\n)\""],
  [0, "echo \"$(cat <<\\\n EOF\n)\ngit push --no-verify\nEOF\n)\""],
  [2, "echo \"$(cat <<<EOF\ngit push --no-verify\n)\""],
  [0, "echo \"$(cat <<<EOF\nprintf '%s' 'git push --no-verify'\n)\""],
  [2, "echo \"$(cat <<\"EOF\"\n)\nEOF\ngit push --no-verify\n)\""],
  [0, "echo \"$(cat <<\"EOF\"\n)\n$(git push --no-verify)\nEOF\n)\""],
  [2, "echo \"$(cat <<''\n)\n\ngit push --no-verify\n)\""],
  [0, "echo \"$(cat <<''\n)\ngit push --no-verify\n\n)\""],
]) {
  if (test(`delimiter role ${expected}: ${JSON.stringify(command)}`, () => {
    const result = runHook(command);
    assert.strictEqual(result.code, expected, result.stderr);
    if (expected === 2) assert.match(result.stderr, /git push/);
  })) passed++; else failed++;
}

// Private VM instrumentation loads the exact source without changing the host
// globals, module cache, production API or executing any supplied command.
function countedClassification(command, quota) {
  const context = vm.createContext({});
  vm.runInContext(`
    globalThis.copiedElements = 0;
    globalThis.copiedStateEntries = 0;
    const NativeMap = Map;
    const NativeSet = Set;
    globalThis.Map = class extends NativeMap {
      constructor(entries) {
        super();
        if (entries) for (const [key, value] of entries) { globalThis.copiedStateEntries++; super.set(key, value); }
      }
    };
    globalThis.Set = class extends NativeSet {
      constructor(entries) {
        super();
        if (entries) for (const value of entries) { globalThis.copiedStateEntries++; super.add(value); }
      }
    };
    const originalSlice = Array.prototype.slice;
    Array.prototype.slice = function(start = 0, end = this.length) {
      const a = start < 0 ? Math.max(0, this.length + start) : Math.min(this.length, start);
      const b = end < 0 ? Math.max(0, this.length + end) : Math.min(this.length, end);
      globalThis.copiedElements += Math.max(0, b - a);
      return originalSlice.call(this, start, end);
    };
  `, context);
  const lexer = { exports: {} };
  const hookModule = { exports: {} };
  const hooks = path.join(__dirname, '../../scripts/hooks');
  const load = (file, module, require) => vm.compileFunction(fs.readFileSync(file, 'utf8').replace(/^#![^\n]*\n/, ''), ['module', 'require'], { parsingContext: context, filename: file })(module, require);
  load(path.join(hooks, 'lib/shell-scan.js'), lexer, () => { throw new Error('Unexpected scanner dependency'); });
  let spent = 0;
  let valueReads = 0;
  const instrumentedLexer = {
    ...lexer.exports,
    createBudget(length) {
      const budget = lexer.exports.createBudget(length);
      return { spend(amount = 1) {
        spent += amount;
        // Throw in the module's own realm so its fail-closed catch is exercised.
        if (quota !== undefined && spent > quota) vm.runInContext('throw new RangeError("Test work quota exceeded")', context);
        budget.spend(amount);
      } };
    },
    scanShell(text, budget) {
      const scan = lexer.exports.scanShell(text, budget);
      for (const command of scan.commands) {
        for (const word of command.words) {
          const value = word.value;
          Object.defineProperty(word, 'value', { get() { valueReads++; return value; } });
        }
      }
      return scan;
    },
  };
  load(path.join(hooks, 'block-no-verify.js'), hookModule, name => {
    assert.strictEqual(name, './lib/shell-scan');
    return instrumentedLexer;
  });
  const result = hookModule.exports.run(command);
  return { result, copiedElements: context.copiedElements, copiedStateEntries: context.copiedStateEntries, spent, valueReads };
}
for (const n of [64, 128]) {
  if (test(`opaque Git candidates avoid quadratic suffix copies at ${n}`, () => {
    const command = 'unknown ' + 'git '.repeat(n);
    const result = countedClassification(command);
    assert.strictEqual(result.result.exitCode, 0);
    assert.ok(result.copiedElements <= 2 * (n + 1), JSON.stringify(result));
    assert.ok(result.valueReads <= 12 * (n + 1), JSON.stringify(result));
  })) passed++; else failed++;
  if (test(`repeated global-option traversal spends the shared quota at ${n}`, () => {
    const result = countedClassification('unknown git ' + '-c git '.repeat(n), 3000);
    assert.strictEqual(result.result.exitCode, 2, JSON.stringify(result));
    assert.match(result.result.stderr, /work budget/);
    assert.ok(result.spent >= 3000 && result.spent < 3100, JSON.stringify(result));
    assert.ok(result.valueReads < 6000, JSON.stringify(result));
  })) passed++; else failed++;
}


// Unquoted heredoc ending delimiters use logical lines; quoted ones do not.
for (const quoted of [false, true]) {
  for (const stripTabs of [false, true]) {
    for (const nested of [false, true]) {
      for (const backslashes of [1, 2, 3, 4]) {
        const delimiter = quoted ? "'EOF'" : 'EOF';
        const tab = stripTabs ? '\t' : '';
        let command = `cat <<${stripTabs ? '-' : ''}${delimiter}\n${tab}EO${'\\'.repeat(backslashes)}\nF\ngit push --no-verify\n${tab}EOF\n`;
        if (nested) command = `echo "$( ${command})"`;
        const expected = !quoted && backslashes === 1 ? 2 : 0;
        if (test(`heredoc logical ending quoted=${quoted} tabs=${stripTabs} nested=${nested} escapes=${backslashes}`, () => {
          const result = runHook(command);
          assert.strictEqual(result.code, expected, result.stderr);
          if (expected === 2) assert.match(result.stderr, /git push/);
        })) passed++; else failed++;
      }
    }
  }
}
for (const [expected, command] of [
  [2, 'cat <<EOF\nE\\\nO\\\nF\ngit push --no-verify\n'],
  [0, "cat <<'EOF'\nE\\\nO\\\nF\ngit push --no-verify\nEOF\n"],
  [0, 'cat <<-EOF\n\tEO\\\n\tF\ngit push --no-verify\n\tEOF\n'],
  [2, 'cat <<EOF\nhello\nEOF\ngit push --no-verify\n'],
  [2, 'cat <<EOF\n$\\\n(git push --no-verify)\nEOF\n'],
  [0, "cat <<'EOF'\n$\\\n(git push --no-verify)\nEOF\n"],
  [0, 'cat <<EOF\n\\$\\\n(git push --no-verify)\nEOF\n'],
  [2, "echo \"$(cat <<EOF\nEO\\\nF\ngit push --no-verify\n)\""],
  [0, "echo \"$(cat <<'EOF'\nEO\\\nF\n)\ngit push --no-verify\nEOF\n)\""],
]) {
  if (test(`joined heredoc role ${expected}: ${JSON.stringify(command)}`, () => {
    const result = runHook(command);
    assert.strictEqual(result.code, expected, result.stderr);
    if (expected === 2) assert.match(result.stderr, /git push/);
  })) passed++; else failed++;
}
for (const option of ['-oerrexit', '+oerrexit', '-xoerrexit', '+xoerrexit', '-o errexit', '+o errexit', '-coerrexit']) {
  for (const [expected, code, tail] of [
    [2, 'git push --no-verify', ''],
    [0, 'echo safe', " 'git push --no-verify'"],
  ]) {
    const command = `zsh ${option} -c '${code}'${tail}`;
    if (test(`zsh named option role ${expected}: ${command}`, () => {
      const result = runHook(command);
      assert.strictEqual(result.code, expected, result.stderr);
      if (expected === 2) assert.match(result.stderr, /git push/);
    })) passed++; else failed++;
  }
}
for (const [expected, command] of [
  [2, "zsh -coerrexit 'git push --no-verify'"],
  [0, "zsh -coerrexit 'echo safe' 'git push --no-verify'"],
  [0, "zsh -oerrexit script.sh 'git push --no-verify'"],
  [0, "zsh +oerrexit -- script.sh 'git push --no-verify'"],
  [2, "bash +o errexit -c 'git push --no-verify'"],
  [0, "bash +o errexit -c 'echo safe' 'git push --no-verify'"],
]) {
  if (test(`shell-specific option control ${expected}: ${command}`, () => {
    assert.strictEqual(runHook(command).code, expected);
  })) passed++; else failed++;
}


// Named option arity is only modeled for Bash and the scoped zsh o grammar.
// For other literal shell names these are opaque, not guessed script operands.
for (const shell of ['sh', 'dash', 'ksh']) {
  for (const option of ['-oerrexit', '+oerrexit', '-o errexit', '+o errexit', '-Oextglob', '+Oextglob', '-O extglob', '+O extglob']) {
    for (const [expected, payload] of [[2, 'git push --no-verify'], [0, 'echo safe']]) {
      const command = `${shell} ${option} -c '${payload}'`;
      if (test(`opaque shell named option ${expected}: ${command}`, () => {
        const result = runHook(command);
        assert.strictEqual(result.code, expected, result.stderr);
        if (expected === 2) assert.match(result.stderr, /git push/);
      })) passed++; else failed++;
    }
  }
  for (const [expected, tail] of [
    [2, "-oerrexit -c 'echo safe' 'git push --no-verify'"],
    [2, "-O extglob script.sh 'git push --no-verify'"],
    [0, "-c 'echo safe' 'git push --no-verify'"],
    [2, "-c 'git push --no-verify'"],
    [0, "script.sh 'git push --no-verify'"],
    [2, "-s <<'EOF'\ngit push --no-verify\nEOF"],
    [0, "-s <<'EOF'\necho safe\nEOF"],
  ]) {
    if (test(`opaque versus supported ${shell}: ${JSON.stringify(tail)}`, () => {
      // The first two are intentionally conservative refusals, including
      // potentially inert positional data; no execution semantics are claimed.
      const result = runHook(`${shell} ${tail}`);
      assert.strictEqual(result.code, expected, result.stderr);
      if (expected === 2) assert.match(result.stderr, /git push/);
    })) passed++; else failed++;
  }
}


// Review-followup witnesses remain inert strings passed only to the classifier.
const reviewFollowupCases = [
  [
    "transformed executable pipeline",
    2,
    "printf '%s' x | sed 's/x/git push --no-verify/' | bash"
  ],
  [
    "transformed executable pipeline",
    2,
    "printf '%s' x | sed 's/x/git commit -n/' | sh"
  ],
  [
    "transformed executable pipeline",
    2,
    "printf '%s' x | sed 's|x|GIT push --no-verify|' | env bash -s"
  ],
  [
    "transformed executable pipeline",
    2,
    "printf '%s' x | sed 's/x/git push --no-verify/' | tee file | bash"
  ],
  [
    "transformed executable pipeline",
    2,
    "echo \"$(printf '%s' x | sed 's/x/git push --no-verify/' | bash)\""
  ],
  [
    "transformed executable pipeline",
    0,
    "printf '%s' x | sed 's/x/git push --no-verify/'"
  ],
  [
    "transformed executable pipeline",
    0,
    "printf '%s' x | sed 's/x/git push --no-verify/' | tee file"
  ],
  [
    "transformed executable pipeline",
    0,
    "printf '%s' x | sed 's/x/echo safe/' | bash"
  ],
  [
    "transformed executable pipeline",
    0,
    "printf '%s' x | sed 's/x/git status/' | bash"
  ],
  [
    "transformed executable pipeline",
    0,
    "printf '%s' x | sed 's/x/git push --no-verify/' | bash script.sh"
  ],
  [
    "transformed executable pipeline",
    0,
    "printf '%s' x | sed 's/x/git push --no-verify/' | bash -c 'echo safe'"
  ],
  [
    "tee data versus executable sink",
    0,
    "tee file <<'EOF'\ngit push --no-verify\nEOF"
  ],
  [
    "tee data versus executable sink",
    0,
    "tee -a file <<EOF\ngit push --no-verify\nEOF"
  ],
  [
    "tee data versus executable sink",
    0,
    "tee file <<'EOF'\n$(git push --no-verify)\nEOF"
  ],
  [
    "tee data versus executable sink",
    2,
    "tee file <<EOF\n$(git push --no-verify)\nEOF"
  ],
  [
    "tee data versus executable sink",
    2,
    "tee file <<'EOF' | bash\ngit push --no-verify\nEOF"
  ],
  [
    "tee data versus executable sink",
    2,
    "tee file <<'EOF' | cat | sh -s\ngit push --no-verify\nEOF"
  ],
  [
    "tee data versus executable sink",
    0,
    "tee file <<'EOF' | cat\ngit push --no-verify\nEOF"
  ],
  [
    "tee data versus executable sink",
    0,
    "tee file <<'EOF' | bash -c 'echo safe'\ngit push --no-verify\nEOF"
  ],
  [
    "Git basename case",
    2,
    "GIT commit -n -m x"
  ],
  [
    "Git basename case",
    2,
    "GIT push --no-verify"
  ],
  [
    "Git basename case",
    0,
    "GIT status"
  ],
  [
    "Git basename case",
    0,
    "GIT commit -m \"git push --no-verify\""
  ],
  [
    "Git basename case",
    2,
    "Git commit -n -m x"
  ],
  [
    "Git basename case",
    2,
    "Git push --no-verify"
  ],
  [
    "Git basename case",
    0,
    "Git status"
  ],
  [
    "Git basename case",
    0,
    "Git commit -m \"git push --no-verify\""
  ],
  [
    "Git basename case",
    2,
    "git.EXE commit -n -m x"
  ],
  [
    "Git basename case",
    2,
    "git.EXE push --no-verify"
  ],
  [
    "Git basename case",
    0,
    "git.EXE status"
  ],
  [
    "Git basename case",
    0,
    "git.EXE commit -m \"git push --no-verify\""
  ],
  [
    "Git basename case",
    2,
    "/opt/bin/GiT commit -n -m x"
  ],
  [
    "Git basename case",
    2,
    "/opt/bin/GiT push --no-verify"
  ],
  [
    "Git basename case",
    0,
    "/opt/bin/GiT status"
  ],
  [
    "Git basename case",
    0,
    "/opt/bin/GiT commit -m \"git push --no-verify\""
  ],
  [
    "Git basename case",
    2,
    "\"C:\\\\tools\\\\git.EXE\" commit -n -m x"
  ],
  [
    "Git basename case",
    2,
    "\"C:\\\\tools\\\\git.EXE\" push --no-verify"
  ],
  [
    "Git basename case",
    0,
    "\"C:\\\\tools\\\\git.EXE\" status"
  ],
  [
    "Git basename case",
    0,
    "\"C:\\\\tools\\\\git.EXE\" commit -m \"git push --no-verify\""
  ],
  [
    "opaque Git basename case",
    2,
    "unknown 'GIT push --no-verify'"
  ],
  [
    "passive Git basename case",
    0,
    "echo 'GIT push --no-verify'"
  ],
  [
    "Git config-env",
    2,
    "HP=/dev/null git --config-env=core.hooksPath=HP commit -m x"
  ],
  [
    "Git config-env",
    2,
    "git --config-env=CORE.HOOKSPATH=HP push origin main"
  ],
  [
    "Git config-env",
    2,
    "git --config-env core.hooksPath=HP commit -m x"
  ],
  [
    "Git config-env",
    0,
    "git --config-env=color.ui=COLOR commit -m x"
  ],
  [
    "Git config-env",
    0,
    "git --config-env=core.hooksPath=HP status"
  ],
  [
    "Git config-env",
    0,
    "git commit -m \"--config-env=core.hooksPath=HP\""
  ],
  [
    "Git config-env",
    0,
    "echo 'HP=/dev/null git --config-env=core.hooksPath=HP commit'"
  ],
  [
    "Git config-env",
    2,
    "env HP=/dev/null git --config-env=core.hooksPath=HP merge branch"
  ],
  [
    "explicit Git environment",
    2,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x"
  ],
  [
    "explicit Git environment",
    2,
    "env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git push"
  ],
  [
    "explicit Git environment",
    2,
    "env -i GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null command git rebase main"
  ],
  [
    "explicit Git environment",
    2,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null bash -c 'git commit -m x'"
  ],
  [
    "explicit Git environment",
    2,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git -c core.hooksPath=safe-hooks commit -m x"
  ],
  [
    "explicit Git environment",
    0,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git status"
  ],
  [
    "explicit Git environment",
    0,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null echo 'git push --no-verify'"
  ],
  [
    "explicit Git environment",
    0,
    "GIT_CONFIG_COUNT=0 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit"
  ],
  [
    "explicit Git environment",
    0,
    "GIT_CONFIG_COUNT= GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit"
  ],
  [
    "explicit Git environment",
    0,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=color.ui GIT_CONFIG_VALUE_0=core.hooksPath=/dev/null git commit"
  ],
  [
    "explicit Git environment",
    0,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath git commit"
  ],
  [
    "explicit Git environment",
    0,
    "GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit"
  ],
  [
    "explicit Git environment",
    0,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null env -i git commit"
  ],
  [
    "explicit Git environment",
    0,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null env -u GIT_CONFIG_COUNT git commit"
  ],
  [
    "explicit Git environment",
    0,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null env --unset=GIT_CONFIG_KEY_0 git commit"
  ],
  [
    "explicit Git environment",
    0,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null bash -c 'env -i git commit'"
  ],
  [
    "explicit Git environment",
    2,
    "GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=color.ui GIT_CONFIG_VALUE_0=auto GIT_CONFIG_KEY_1=CORE.HOOKSPATH GIT_CONFIG_VALUE_1= git am patches"
  ],
  [
    "explicit Git environment",
    2,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0= git merge branch"
  ],
  [
    "explicit Git environment",
    0,
    "git commit -m \"GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath\""
  ],
  [
    "Git parameter environment",
    2,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" git commit -m x"
  ],
  [
    "Git parameter environment",
    0,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" git status"
  ],
  [
    "Git parameter environment",
    0,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" echo safe"
  ],
  [
    "Git parameter environment",
    2,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath'='/dev/null'\" git commit -m x"
  ],
  [
    "Git parameter environment",
    0,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath'='/dev/null'\" git status"
  ],
  [
    "Git parameter environment",
    0,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath'='/dev/null'\" echo safe"
  ],
  [
    "Git parameter environment",
    0,
    "GIT_CONFIG_PARAMETERS=\"'color.ui=core.hooksPath=/dev/null'\" git commit"
  ],
  [
    "Git parameter environment",
    0,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" env -i git commit"
  ],
  [
    "ANSI-C quote boundary",
    2,
    "echo $'x\\'' ; git push --no-verify #'"
  ],
  [
    "ANSI-C quote boundary",
    2,
    "echo \"$(echo $'x\\'' ; git push --no-verify #')\n)\""
  ],
  [
    "ANSI-C quote boundary",
    2,
    "echo \"$(echo $'x\\' )'; git push --no-verify)\""
  ],
  [
    "ANSI-C quote boundary",
    0,
    "echo $'x\\'; git push --no-verify'"
  ],
  [
    "ANSI-C quote boundary",
    0,
    "echo $'$(git push --no-verify)'"
  ],
  [
    "ANSI-C quote boundary",
    0,
    "echo \"$(echo $'x\\'; git push --no-verify')\""
  ],
  [
    "ANSI-C quote boundary",
    2,
    "echo $'x\\\\'; git push --no-verify"
  ],
  [
    "ANSI-C quote boundary",
    0,
    "echo $'x\\\\; git push --no-verify'"
  ],
  [
    "ANSI-C quote boundary",
    2,
    "$'git' push --no-verify"
  ],
  [
    "ANSI-C quote boundary",
    0,
    "$'git' commit -m $'document git push --no-verify'"
  ],
  [
    "ANSI-C quote boundary",
    2,
    "echo $'x\\''; git commit -n # ignored'"
  ],
  [
    "ANSI-C quote boundary",
    0,
    "printf '%s' $'x\\'; git commit -n'"
  ]
];
reviewFollowupCases.push(...[
  [
    "exec environment reset",
    0,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null exec -c git commit"
  ],
  [
    "exec environment reset",
    0,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null exec -cl git commit"
  ],
  [
    "exec environment reset",
    2,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null exec -acustom git commit"
  ],
  [
    "exec environment reset",
    2,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null exec -a c git commit"
  ],
  [
    "exec environment reset",
    0,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null exec -ca custom git commit"
  ],
  [
    "Git count grammar",
    2,
    "GIT_CONFIG_COUNT='+1' GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit"
  ],
  [
    "Git count grammar",
    2,
    "GIT_CONFIG_COUNT=' 1' GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit"
  ],
  [
    "Git count grammar",
    2,
    "GIT_CONFIG_COUNT='\t+1' GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit"
  ],
  [
    "Git count grammar",
    2,
    "GIT_CONFIG_COUNT='0001' GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit"
  ],
  [
    "Git count grammar",
    0,
    "GIT_CONFIG_COUNT='1 ' GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit"
  ],
  [
    "Git count grammar",
    0,
    "GIT_CONFIG_COUNT='-1' GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit"
  ],
  [
    "Git count grammar",
    0,
    "GIT_CONFIG_COUNT='2147483648' GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit"
  ]
]);
for (const [family, expected, command] of reviewFollowupCases) {
  if (test(`${family} ${expected}: ${JSON.stringify(command)}`, () => {
    const result = runHook(command);
    assert.strictEqual(result.code, expected, result.stderr);
    if (expected === 2) assert.match(result.stderr, /BLOCKED/);
  })) passed++; else failed++;
}


// Literal shell-state propagation; witness text is never executed. Pipeline-last
// and conditional state changes are conservative alternatives, not flow proofs.
const stickyEnvironmentCases = Object.freeze([
  [
    "literal exported parameter",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit -m x"
  ],
  [
    "exported ordinary Git control",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git status"
  ],
  [
    "literal exported parameter",
    2,
    "declare -x GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit -m x"
  ],
  [
    "exported ordinary Git control",
    0,
    "declare -x GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git status"
  ],
  [
    "literal exported parameter",
    2,
    "typeset -x GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit -m x"
  ],
  [
    "exported ordinary Git control",
    0,
    "typeset -x GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git status"
  ],
  [
    "literal exported parameter",
    2,
    "declare -gx GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit -m x"
  ],
  [
    "exported ordinary Git control",
    0,
    "declare -gx GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git status"
  ],
  [
    "literal exported parameter",
    2,
    "typeset -gx GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit -m x"
  ],
  [
    "exported ordinary Git control",
    0,
    "typeset -gx GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git status"
  ],
  [
    "literal exported parameter",
    2,
    "export -- GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit -m x"
  ],
  [
    "exported ordinary Git control",
    0,
    "export -- GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git status"
  ],
  [
    "sticky export order",
    2,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; export GIT_CONFIG_PARAMETERS; git commit"
  ],
  [
    "sticky export order",
    2,
    "export GIT_CONFIG_PARAMETERS; GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "sticky export order",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"\ngit push"
  ],
  [
    "sticky export order",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=''; GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git am patches"
  ],
  [
    "sticky export order",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; readonly GIT_CONFIG_PARAMETERS; git merge main"
  ],
  [
    "sticky export order",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; command git rebase main"
  ],
  [
    "sticky export order",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -i git status; git commit"
  ],
  [
    "sticky export order",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -u GIT_CONFIG_PARAMETERS git status; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "declare GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "typeset GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "readonly GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" echo safe; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "env GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" echo safe; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "command -v export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "export -p; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "declare -xp GIT_CONFIG_PARAMETERS; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; unset GIT_CONFIG_PARAMETERS; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; unset -v GIT_CONFIG_PARAMETERS; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; export -n GIT_CONFIG_PARAMETERS; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; declare +x GIT_CONFIG_PARAMETERS; git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -i git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -u GIT_CONFIG_PARAMETERS git commit"
  ],
  [
    "literal variable/export boundary",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; exec -c git commit"
  ],
  [
    "sticky count/key/value",
    2,
    "export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null; git commit"
  ],
  [
    "sticky count/key/value",
    2,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null; export GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0; git push"
  ],
  [
    "sticky count/key/value",
    2,
    "export GIT_CONFIG_COUNT=1; export GIT_CONFIG_KEY_0=core.hooksPath; export GIT_CONFIG_VALUE_0=/dev/null; git commit"
  ],
  [
    "sticky count/key/value",
    2,
    "export GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0; GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null; git commit"
  ],
  [
    "count export controls",
    0,
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null; git commit"
  ],
  [
    "count export controls",
    0,
    "export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null; GIT_CONFIG_COUNT=0; git commit"
  ],
  [
    "count export controls",
    0,
    "export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null; unset GIT_CONFIG_COUNT; git commit"
  ],
  [
    "count export controls",
    0,
    "export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null; export -n GIT_CONFIG_VALUE_0; git commit"
  ],
  [
    "count export controls",
    0,
    "export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null; git status"
  ],
  [
    "nested scope inherits shell state",
    2,
    "(export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit)"
  ],
  [
    "nested scope inherits shell state",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; (git commit)"
  ],
  [
    "nested scope inherits shell state",
    2,
    "{ export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; }; git commit"
  ],
  [
    "nested scope inherits shell state",
    2,
    "{ export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit; } | cat"
  ],
  [
    "nested scope inherits shell state",
    2,
    "(export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit) | cat"
  ],
  [
    "nested scope inherits shell state",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; printf \"%s\" \"$(git commit)\""
  ],
  [
    "nested scope inherits shell state",
    2,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; printf \"%s\" \"$(export GIT_CONFIG_PARAMETERS; git commit)\""
  ],
  [
    "nested scope inherits shell state",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; cat <<EOF\n$(git commit)\nEOF"
  ],
  [
    "isolated/data scope control",
    0,
    "(export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"); git commit"
  ],
  [
    "isolated/data scope control",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" | cat; git commit"
  ],
  [
    "isolated/data scope control",
    0,
    "{ export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; } | cat; git commit"
  ],
  [
    "isolated/data scope control",
    0,
    "printf x | { export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; }; git status"
  ],
  [
    "isolated/data scope control",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" & git commit"
  ],
  [
    "isolated/data scope control",
    0,
    "{ export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; } & git commit"
  ],
  [
    "isolated/data scope control",
    0,
    "printf \"%s\" \"$(export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\")\"; git commit"
  ],
  [
    "isolated/data scope control",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; cat <<'EOF'\ngit commit\nEOF"
  ],
  [
    "isolated/data scope control",
    0,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; printf \"%s\" \"$(git commit)\""
  ],
  [
    "eval keeps same shell variables",
    2,
    "eval \"export GIT_CONFIG_PARAMETERS=\\\"'core.hooksPath=/dev/null'\\\"\"; git commit"
  ],
  [
    "eval keeps same shell variables",
    2,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; eval \"export GIT_CONFIG_PARAMETERS\"; git commit"
  ],
  [
    "eval keeps same shell variables",
    2,
    "eval \"GIT_CONFIG_PARAMETERS=\\\"'core.hooksPath=/dev/null'\\\"\"; export GIT_CONFIG_PARAMETERS; git commit"
  ],
  [
    "child shell exported state",
    2,
    "bash -c \"export GIT_CONFIG_PARAMETERS=\\\"'core.hooksPath=/dev/null'\\\"; git commit\""
  ],
  [
    "child shell exported state",
    2,
    "bash -c \"GIT_CONFIG_PARAMETERS=\\\"'core.hooksPath=/dev/null'\\\"; export GIT_CONFIG_PARAMETERS; git push\""
  ],
  [
    "child shell state never leaks",
    0,
    "bash -c \"export GIT_CONFIG_PARAMETERS=\\\"'core.hooksPath=/dev/null'\\\"\"; git commit"
  ],
  [
    "unexported shell values not child environment",
    0,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; bash -c \"git commit\""
  ],
  [
    "exported values reach child environment",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; bash -c \"git commit\""
  ],
  [
    "conditional reset may not execute",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; false && unset GIT_CONFIG_PARAMETERS; git commit"
  ],
  [
    "conditional export may execute",
    2,
    "true && export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "last pipeline builtin may run in parent",
    2,
    "printf x | export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "assignment-only malformed quoted name remains data",
    0,
    "\"GIT_CONFIG_PARAMETERS=\\\"'core.hooksPath=/dev/null'\\\"\"; git commit"
  ],
  [
    "readonly value cannot be cleared",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; readonly GIT_CONFIG_PARAMETERS; GIT_CONFIG_PARAMETERS=; git commit"
  ],
  [
    "readonly value cannot be unset",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; readonly GIT_CONFIG_PARAMETERS; unset GIT_CONFIG_PARAMETERS; git commit"
  ],
  [
    "readonly exported declaration",
    2,
    "declare -rx GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=; git commit"
  ],
  [
    "readonly exported value updates refused",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; readonly GIT_CONFIG_PARAMETERS; export GIT_CONFIG_PARAMETERS=; git commit"
  ],
  [
    "readonly unexported variable stays local",
    0,
    "readonly GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "readonly does not freeze export attribute",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; readonly GIT_CONFIG_PARAMETERS; export -n GIT_CONFIG_PARAMETERS; git commit"
  ],
  [
    "external export basename is not builtin",
    0,
    "/tmp/export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "external declare basename is not builtin",
    0,
    "/tmp/declare -x GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "external command basename is not builtin",
    0,
    "/tmp/command export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "external env cannot change parent attributes",
    0,
    "env export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "command builtin retains export semantics",
    2,
    "command export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "last pipeline brace may affect parent",
    2,
    "printf x | { export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; }; git commit"
  ],
  [
    "last pipeline subshell stays isolated",
    0,
    "printf x | (export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"); git commit"
  ],
  [
    "nonfinal pipeline brace stays isolated",
    0,
    "printf x | { export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; } | cat; git commit"
  ],
  [
    "background pipeline brace stays isolated",
    0,
    "printf x | { export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; } & git commit"
  ],
  [
    "same-shell brace can clear variable",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; { unset GIT_CONFIG_PARAMETERS; }; git commit"
  ],
  [
    "subshell reset does not clear parent",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; (unset GIT_CONFIG_PARAMETERS); git commit"
  ],
  [
    "substitution reset does not clear parent",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; printf \"%s\" \"$(unset GIT_CONFIG_PARAMETERS)\"; git commit"
  ],
  [
    "prefixed eval receives literal environment",
    2,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" eval \"git commit\""
  ],
  [
    "prefixed eval persistence is host-mode uncertain",
    2,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" eval true; git commit"
  ],
  [
    "prefixed eval with safe Git control",
    0,
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" eval \"git status\""
  ],
  [
    "exported environment applies to Git executable case",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; /usr/bin/GIT.exe commit"
  ],
  [
    "exported non-hook setting is safe",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'color.ui=core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "unsupported declaration attributes cannot prove reset",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; declare -i GIT_CONFIG_PARAMETERS=0; git commit"
  ],
  [
    "conditional local clear cannot prove export reset",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; false && GIT_CONFIG_PARAMETERS=; git commit"
  ],
  [
    "conditional readonly does not permit unsafe clear proof",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; true && readonly GIT_CONFIG_PARAMETERS; GIT_CONFIG_PARAMETERS=; git commit"
  ],
  [
    "conditional eval reset may not execute",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; false && eval 'unset GIT_CONFIG_PARAMETERS'; git commit"
  ],
  [
    "unconditional eval reset does execute",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; eval 'unset GIT_CONFIG_PARAMETERS'; git commit"
  ],
  [
    "nested conditional eval reset may not execute",
    2,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; false && eval \"eval \\\"unset GIT_CONFIG_PARAMETERS\\\"\"; git commit"
  ],
  [
    "conditional eval safe Git control",
    0,
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; false && eval 'unset GIT_CONFIG_PARAMETERS'; git status"
  ],
  ["uninvoked function reset is not proof", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; f() { unset GIT_CONFIG_PARAMETERS; }; git commit"],
  ["uninvoked function safe Git control", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; f() { unset GIT_CONFIG_PARAMETERS; }; git status"],
  ["uninvoked function reset is not proof", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; function f { unset GIT_CONFIG_PARAMETERS; }; git commit"],
  ["uninvoked function safe Git control", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; function f { unset GIT_CONFIG_PARAMETERS; }; git status"],
  ["uninvoked function reset is not proof", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; function f() { unset GIT_CONFIG_PARAMETERS; }; git commit"],
  ["uninvoked function safe Git control", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; function f() { unset GIT_CONFIG_PARAMETERS; }; git status"],
  ["unresolved assignment retains prior unsafe alternative", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\"; git commit"],
  ["unresolved assignment safe Git control", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\"; git status"],
  ["unresolved assignment retains prior unsafe alternative", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=${GIT_CONFIG_PARAMETERS}; git commit"],
  ["unresolved assignment safe Git control", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=${GIT_CONFIG_PARAMETERS}; git status"],
  ["unresolved assignment retains prior unsafe alternative", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; export GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\"; git commit"],
  ["unresolved assignment safe Git control", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; export GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\"; git status"],
  ["unresolved assignment retains prior unsafe alternative", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; declare -x GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\"; git commit"],
  ["unresolved assignment safe Git control", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; declare -x GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\"; git status"],
  ["unresolved assignment retains prior unsafe alternative", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=$(printf x); git commit"],
  ["unresolved assignment safe Git control", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=$(printf x); git status"],
  ["unresolved assignment retains prior unsafe alternative", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=`printf x`; git commit"],
  ["unresolved assignment safe Git control", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=`printf x`; git status"],
  ["literal dollar reset remains data", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS='$GIT_CONFIG_PARAMETERS'; git commit"],
  ["literal dollar reset remains data", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=\\$GIT_CONFIG_PARAMETERS; git commit"],
  ["literal dollar reset remains data", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=\"\\$GIT_CONFIG_PARAMETERS\"; git commit"],
  ["literal dollar reset remains data", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=$'$GIT_CONFIG_PARAMETERS'; git commit"],
  ["unresolved exported count assignment retains bypass", 2, "export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null; GIT_CONFIG_COUNT=$GIT_CONFIG_COUNT; git commit"],
  ["unresolved command-prefix count cannot prove reset", 2, "export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null; GIT_CONFIG_COUNT=$GIT_CONFIG_COUNT git commit"],
  ["unresolved command-prefix parameters cannot prove reset", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\" git commit"],
  ["literal prefix dollar is data", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; GIT_CONFIG_PARAMETERS='$GIT_CONFIG_PARAMETERS' git commit"],
  ["unresolved export retains known local value and export attribute", 2, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; export GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\"; git commit"],
  ["unresolved export safe Git control", 0, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; export GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\"; git status"],
  ["unresolved export retains known local value and export attribute", 2, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; declare -x GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\"; git commit"],
  ["unresolved export safe Git control", 0, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; declare -x GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\"; git status"],
  ["unresolved export retains known local value and export attribute", 2, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; typeset -xr GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\"; git commit"],
  ["unresolved export safe Git control", 0, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; typeset -xr GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\"; git status"],
  ["new literal bypass is retained alongside old dynamic value", 2, "export GIT_CONFIG_PARAMETERS=''; export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'$GIT_CONFIG_PARAMETERS\"; git commit"],
  ["new literal bypass is retained alongside old dynamic value", 2, "export GIT_CONFIG_PARAMETERS=''; GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'$GIT_CONFIG_PARAMETERS\"; git commit"],
  ["new literal prefix bypass is retained", 2, "export GIT_CONFIG_PARAMETERS=''; GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'$GIT_CONFIG_PARAMETERS\" git commit"],
  ["dynamic env operand expands in caller before child reset", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -i GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\" git commit"],
  ["quoted env operand is data after child reset", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -i GIT_CONFIG_PARAMETERS='$GIT_CONFIG_PARAMETERS' git commit"],
  ["plain child reset remains effective", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -i git commit"],
  ["dynamic env operand expands in caller before child reset", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -u GIT_CONFIG_PARAMETERS GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\" git commit"],
  ["quoted env operand is data after child reset", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -u GIT_CONFIG_PARAMETERS GIT_CONFIG_PARAMETERS='$GIT_CONFIG_PARAMETERS' git commit"],
  ["plain child reset remains effective", 0, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -u GIT_CONFIG_PARAMETERS git commit"],
  ["dynamic env operand expands in caller before child reset", 2, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -i GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\" git commit"],
  ["quoted env operand is data after child reset", 0, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -i GIT_CONFIG_PARAMETERS='$GIT_CONFIG_PARAMETERS' git commit"],
  ["plain child reset remains effective", 0, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -i git commit"],
  ["dynamic env operand expands in caller before child reset", 2, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -u GIT_CONFIG_PARAMETERS GIT_CONFIG_PARAMETERS=\"$GIT_CONFIG_PARAMETERS\" git commit"],
  ["quoted env operand is data after child reset", 0, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -u GIT_CONFIG_PARAMETERS GIT_CONFIG_PARAMETERS='$GIT_CONFIG_PARAMETERS' git commit"],
  ["plain child reset remains effective", 0, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; env -u GIT_CONFIG_PARAMETERS git commit"],
  ["export print flag with assignment still exports", 2, "export -p GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit"],
  ["export print-only keeps local variable unexported", 0, "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; export -p; git commit"],
  ["readonly print flag assignment prevents later reset", 2, "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; readonly -p GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; unset GIT_CONFIG_PARAMETERS; git commit"],
  ["readonly print flag safe Git control", 0, "readonly -p GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git status"]
]);
// Append assignments are shell syntax before a command or in declarations.
// env's NAME+=VALUE is a different, literal variable name, not shell append.
const appendEnvironmentCases = [
  ['prefix from unset', 'GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'"'],
  ['export from unset', 'export GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'";'],
  ['declare from unset', 'declare -x GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'";'],
  ['typeset from unset', 'typeset -x GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'";'],
  ['standalone then export', 'GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'"; export GIT_CONFIG_PARAMETERS;'],
  ['append to exported safe parameters', 'export GIT_CONFIG_PARAMETERS="\'color.ui=false\'"; GIT_CONFIG_PARAMETERS+=" \'core.hooksPath=/dev/null\'";'],
  ['append split declaration', 'export GIT_CONFIG_PARAMETERS="\'core.hooks"; export GIT_CONFIG_PARAMETERS+="Path=/dev/null\'";'],
  ['append split standalone', 'GIT_CONFIG_PARAMETERS="\'core.hooks"; GIT_CONFIG_PARAMETERS+="Path=/dev/null\'"; export GIT_CONFIG_PARAMETERS;'],
  ['append split prefix from local', 'GIT_CONFIG_PARAMETERS="\'core.hooks"; GIT_CONFIG_PARAMETERS+="Path=/dev/null\'"'],
  ['multiple prefix operands', 'GIT_CONFIG_PARAMETERS="\'core.hooks" GIT_CONFIG_PARAMETERS+="Path=/dev/null\'"'],
  ['count triplet prefix', 'GIT_CONFIG_COUNT+=1 GIT_CONFIG_KEY_0+=core.hooksPath GIT_CONFIG_VALUE_0+=/dev/null'],
  ['count triplet declaration', 'export GIT_CONFIG_COUNT+=1 GIT_CONFIG_KEY_0+=core.hooksPath GIT_CONFIG_VALUE_0+=/dev/null;'],
  ['split key declaration', 'export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core. GIT_CONFIG_VALUE_0=/dev/null; declare -x GIT_CONFIG_KEY_0+=hooksPath;'],
  ['split key prefix', 'GIT_CONFIG_KEY_0=core.; GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0+=hooksPath GIT_CONFIG_VALUE_0=/dev/null'],
  ['conditional append possible', 'false && export GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'";'],
  ['append cannot erase prior unknown-value alternative', 'export GIT_CONFIG_PARAMETERS="\'core.hooksPath=/dev/null\'"; GIT_CONFIG_PARAMETERS+="$UNKNOWN";'],
  ['dynamic prefix cannot erase prior alternative', 'export GIT_CONFIG_PARAMETERS="\'core.hooksPath=/dev/null\'"; GIT_CONFIG_PARAMETERS+="$UNKNOWN"'],
  ['dynamic declaration retains new literal operand', 'export GIT_CONFIG_PARAMETERS=""; export GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'$UNKNOWN";'],
  ['dynamic prefix retains new literal operand', 'GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'$UNKNOWN"'],
];
const appendCases = [];
for (const [family, setup] of appendEnvironmentCases) {
  appendCases.push([`append ${family}`, 2, `${setup} git commit`]);
  appendCases.push([`append ${family} safe Git control`, 0, `${setup} git status`]);
}
appendCases.push(
  ['unexported append stays local', 0, 'GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'"; git commit'],
  ['export attribute removal remains effective', 0, 'export GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'"; export -n GIT_CONFIG_PARAMETERS; git commit'],
  ['explicit unset removes appended state', 0, 'export GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'"; unset GIT_CONFIG_PARAMETERS; git commit'],
  ['child environment reset removes appended state', 0, 'export GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'"; env -i git commit'],
  ['env append-like name is literal data', 0, 'env GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'" git commit'],
  ['env append-like name after reset is literal data', 0, 'export GIT_CONFIG_PARAMETERS="\'core.hooksPath=/dev/null\'"; env -i GIT_CONFIG_PARAMETERS+= git commit'],
  ['env literal name does not reset real exported key', 2, 'export GIT_CONFIG_PARAMETERS="\'core.hooksPath=/dev/null\'"; env GIT_CONFIG_PARAMETERS+= git commit'],
  ['quoted shell assignment name stays data', 0, '"GIT_CONFIG_PARAMETERS+=\'core.hooksPath=/dev/null\'" git commit'],
  ['readonly safe value cannot acquire appended override', 0, 'declare -rx GIT_CONFIG_PARAMETERS=""; GIT_CONFIG_PARAMETERS+="\'core.hooksPath=/dev/null\'"; git commit'],
  ['readonly unsafe value cannot lose override through append', 2, 'export GIT_CONFIG_PARAMETERS="\'core.hooksPath=/dev/null\'"; readonly GIT_CONFIG_PARAMETERS; GIT_CONFIG_PARAMETERS+="x"; git commit'],
  ['ordinary append parameters do not disable hooks', 0, 'export GIT_CONFIG_PARAMETERS="\'color.ui="; GIT_CONFIG_PARAMETERS+="false\'"; git commit'],
  ['empty appended count is not an override', 0, 'export GIT_CONFIG_COUNT=0; GIT_CONFIG_COUNT+=""; git commit'],
);

appendCases.push(...[
  [
    "unknown prior export commit",
    2,
    "export GIT_CONFIG_PARAMETERS=\"$UNKNOWN\"; export GIT_CONFIG_PARAMETERS+=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "unknown prior export status",
    0,
    "export GIT_CONFIG_PARAMETERS=\"$UNKNOWN\"; export GIT_CONFIG_PARAMETERS+=\"'core.hooksPath=/dev/null'\"; git status"
  ],
  [
    "unknown prior standalone commit",
    2,
    "GIT_CONFIG_PARAMETERS=\"$UNKNOWN\"; GIT_CONFIG_PARAMETERS+=\"'core.hooksPath=/dev/null'\"; export GIT_CONFIG_PARAMETERS; git commit"
  ],
  [
    "unknown prior standalone status",
    0,
    "GIT_CONFIG_PARAMETERS=\"$UNKNOWN\"; GIT_CONFIG_PARAMETERS+=\"'core.hooksPath=/dev/null'\"; export GIT_CONFIG_PARAMETERS; git status"
  ],
  [
    "unknown prior prefix commit",
    2,
    "GIT_CONFIG_PARAMETERS=\"$UNKNOWN\"; GIT_CONFIG_PARAMETERS+=\"'core.hooksPath=/dev/null'\" git commit"
  ],
  [
    "unknown prior prefix status",
    0,
    "GIT_CONFIG_PARAMETERS=\"$UNKNOWN\"; GIT_CONFIG_PARAMETERS+=\"'core.hooksPath=/dev/null'\" git status"
  ],
  [
    "unknown repeated prefix commit",
    2,
    "GIT_CONFIG_PARAMETERS=\"$UNKNOWN\" GIT_CONFIG_PARAMETERS+=\"'core.hooksPath=/dev/null'\" git commit"
  ],
  [
    "unknown repeated prefix status",
    0,
    "GIT_CONFIG_PARAMETERS=\"$UNKNOWN\" GIT_CONFIG_PARAMETERS+=\"'core.hooksPath=/dev/null'\" git status"
  ],
  [
    "three ordered prefix operands commit",
    2,
    "GIT_CONFIG_PARAMETERS=\"'core.\" GIT_CONFIG_PARAMETERS+=\"hooks\" GIT_CONFIG_PARAMETERS+=\"Path=/dev/null'\" git commit"
  ],
  [
    "three ordered prefix operands status",
    0,
    "GIT_CONFIG_PARAMETERS=\"'core.\" GIT_CONFIG_PARAMETERS+=\"hooks\" GIT_CONFIG_PARAMETERS+=\"Path=/dev/null'\" git status"
  ],
  [
    "unknown count followed by literal append commit",
    2,
    "export GIT_CONFIG_COUNT=\"$UNKNOWN\" GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null; GIT_CONFIG_COUNT+=1; git commit"
  ],
  [
    "unknown count followed by literal append status",
    0,
    "export GIT_CONFIG_COUNT=\"$UNKNOWN\" GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null; GIT_CONFIG_COUNT+=1; git status"
  ],
  [
    "unknown prior child context commit",
    2,
    "export GIT_CONFIG_PARAMETERS=\"$UNKNOWN\"; sh -c \"GIT_CONFIG_PARAMETERS+=\\\"'core.hooksPath=/dev/null'\\\"; git commit\""
  ],
  [
    "unknown prior child context status",
    0,
    "export GIT_CONFIG_PARAMETERS=\"$UNKNOWN\"; sh -c \"GIT_CONFIG_PARAMETERS+=\\\"'core.hooksPath=/dev/null'\\\"; git status\""
  ],
  [
    "literal prior is not unresolved '$UNKNOWN'",
    0,
    "GIT_CONFIG_PARAMETERS='$UNKNOWN'; export GIT_CONFIG_PARAMETERS+=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "literal prior is not unresolved \\$UNKNOWN",
    0,
    "GIT_CONFIG_PARAMETERS=\\$UNKNOWN; export GIT_CONFIG_PARAMETERS+=\"'core.hooksPath=/dev/null'\"; git commit"
  ],
  [
    "literal prior is not unresolved \"\\$UNKNOWN\"",
    0,
    "GIT_CONFIG_PARAMETERS=\"\\$UNKNOWN\"; export GIT_CONFIG_PARAMETERS+=\"'core.hooksPath=/dev/null'\"; git commit"
  ]
]);

for (const [family, expected, command] of [...stickyEnvironmentCases, ...appendCases]) {
  if (test(`${family} ${expected}: ${JSON.stringify(command)}`, () => {
    const result = runHook(command);
    assert.strictEqual(result.code, expected, result.stderr);
    if (expected === 2) assert.match(result.stderr, /core\.hooksPath/, 'Must identify the literal override, not exhaust the budget');
  })) passed++; else failed++;
}

for (const n of [8, 12]) {
  if (test(`conditional environment alternatives charge copies within a shared quota at ${n}`, () => {
    const command = 'export GIT_CONFIG_COUNT=0; ' + 'true && GIT_CONFIG_COUNT=0; '.repeat(n) + 'git status';
    const result = countedClassification(command, 3000);
    assert.strictEqual(result.result.exitCode, 2, JSON.stringify(result));
    assert.match(result.result.stderr, /work budget/);
    assert.ok(result.spent >= 3000 && result.spent < 3100, JSON.stringify(result));
    // Include fixed module-level Set construction as a constant allowance.
    assert.ok(result.copiedStateEntries <= result.spent + 128, JSON.stringify(result));
  })) passed++; else failed++;
}

const pureOnly = process.argv.includes('--pure-only');
if (pureOnly) console.log('Pure classifier mode: 3 bounded Node routing checks omitted.');
else {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-no-verify-'));
  try {
    for (const [name, input, disabled, code, direct] of [
      ['raw stdin passes through direct hook', 'git status', false, 0, true],
      ['JSON bypass blocks through runner', JSON.stringify({ tool_input: { command: 'git push --no-verify' } }), false, 2],
      ['disabled hook is silent', 'git push --no-verify', true, 0],
    ]) {
      if (test(name, () => {
        const args = direct ? [path.join(__dirname, '../../scripts/hooks/block-no-verify.js')] : [runner, 'pre:bash:block-no-verify', 'scripts/hooks/block-no-verify.js', 'minimal,standard,strict'];
        const result = spawnSync(process.execPath, args, {
          input, encoding: 'utf8', timeout: 3000,
          env: { PATH: path.dirname(process.execPath), HOME: home, USERPROFILE: home, TMPDIR: home, TMP: home, TEMP: home,
            ECC_HOOK_PROFILE: 'standard', ECC_HOOK_CONFIG: path.join(home, 'absent.json'),
            ECC_DISABLED_HOOKS: disabled ? 'pre:bash:block-no-verify' : '' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        assert.ifError(result.error);
        assert.strictEqual(result.status, code, result.stderr);
        if (code === 0) assert.strictEqual(result.stdout, direct ? input : '');
        if (disabled) assert.strictEqual(result.stderr, '');
        if (code === 2) assert.match(result.stderr, /BLOCKED/);
      })) passed++; else failed++;
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// Contributor carry-forward regressions for #2858 and #2897.
for (const [name, command, expected] of [
  [
    "blocks include.path config override",
    "git -c include.path=/tmp/evil.conf commit -m x",
    2
  ],
  [
    "blocks quoted include.path config",
    "git \"-c\" \"include.path=/tmp/evil.conf\" push origin main",
    2
  ],
  [
    "blocks inline include.path config",
    "git -cinclude.path=/tmp/evil.conf commit -m x",
    2
  ],
  [
    "blocks include.path config-env",
    "git --config-env=include.path=EVIL commit -m x",
    2
  ],
  [
    "blocks separated include.path config-env",
    "git --config-env include.path=EVIL commit -m x",
    2
  ],
  [
    "blocks case-insensitive include.path",
    "git -c INCLUDE.PATH=/tmp/evil.conf commit -m x",
    2
  ],
  [
    "blocks conditional include capability",
    "git -c includeIf.gitdir:**/.path=/tmp/evil.conf commit -m x",
    2
  ],
  [
    "blocks counted include.path environment",
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=include.path GIT_CONFIG_VALUE_0=/tmp/evil.conf git commit -m x",
    2
  ],
  [
    "blocks encoded include.path parameters",
    "GIT_CONFIG_PARAMETERS=\"'include.path'='/tmp/evil.conf'\" git commit -m x",
    2
  ],
  [
    "allows unrelated config value",
    "git -c user.name=ECC commit -m x",
    0
  ],
  [
    "allows include setting outside protected command",
    "git -c include.path=/tmp/evil.conf status",
    0
  ],
  [
    "blocks env long inline split-string",
    "env --split-string='git commit --no-verify -m x'",
    2
  ],
  [
    "blocks env split-string after ignore-environment",
    "env -i --split-string='git commit --no-verify -m x'",
    2
  ],
  [
    "blocks env separated long split-string",
    "env --split-string 'git commit --no-verify -m x'",
    2
  ],
  [
    "blocks env attached short split-string",
    "env -S'git commit --no-verify -m x'",
    2
  ],
  [
    "blocks appended argv after env split-string",
    "env --split-string='git commit' --no-verify -m x",
    2
  ],
  [
    "allows quoted bypass text passed through env printf",
    "env --split-string=\"printf '%s' 'git commit --no-verify -m x'\"",
    0
  ]
]) {
  if (test(name, () => {
    const result = runHook({ tool_input: { command } });
    assert.strictEqual(result.code, expected, result.stderr);
  })) passed++; else failed++;
}

for (const n of [100, 1000, 4000]) {
  for (const tail of ['git status', 'git commit --no-verify']) {
    if (test(`literal env split copies stay within the input quota at ${n}: ${tail}`, () => {
      const command = 'env ' + '-S -i '.repeat(n) + tail;
      const quota = 24 * (command.length + 1) + 4096;
      const result = countedClassification(command);
      assert.strictEqual(result.result.exitCode, 2, JSON.stringify(result));
      assert.match(result.result.stderr, /work budget/);
      assert.ok(result.copiedElements <= quota, JSON.stringify(result));
      assert.ok(result.copiedElements <= result.spent, JSON.stringify(result));
      // The rejected charge may exceed the quota, but allocation must not run.
      assert.ok(result.spent >= quota && result.spent <= quota + 2 * (2 * n + 4) + 1, JSON.stringify(result));
    })) passed++; else failed++;
  }
}
for (const n of [0, 1, 2, 4]) {
  if (test(`shallow literal env splits allow harmless argv at ${n}`, () => {
    const command = 'env ' + '-S -i '.repeat(n) + 'git status';
    const result = countedClassification(command);
    assert.strictEqual(result.result.exitCode, 0, JSON.stringify(result));
    assert.ok(result.copiedElements <= result.spent, JSON.stringify(result));
  })) passed++; else failed++;
}

const quoteSplitPayload = payload => `'${payload.replace(/'/g, `'\\''`)}'`;
const escapedSplitCases = [
  ['unquoted escaped separators', 'git\\_commit\\_--no-verify', 2],
  ['single-quoted literal separators', "'git\\_commit\\_--no-verify'", 0],
  ['double-quoted escaped separators', '"git\\_commit\\_--no-verify"', 2],
  ['mixed quoted escaped separators', 'git\\_commit\\_"--no-verify"', 2],
  ['unsupported stop escape', 'printf ok\\c ignored', 2],
  ['unsupported double-quoted stop escape', 'printf "ok\\c" ignored', 2],
  ['single-quoted stop data', "printf '%s' 'ok\\c'", 0],
  ['single-quoted separator data', "printf '%s' 'git\\_commit\\_--no-verify'", 0],
  ['single-quoted newline format', "printf '%s\\n' 'git commit --no-verify'", 0],
  ['unsupported newline escape', 'printf ok\\n', 2],
  ['unsupported tab escape', 'printf ok\\t', 2],
  ['unsupported escaped backslash', 'printf ok\\\\_', 2],
  ['unsupported single-quoted backslash escape', "printf '%s' 'ok\\\\_'", 2],
  ['unsupported single-quoted apostrophe escape', "printf '%s' 'ok\\'data'", 2],
];
for (const [name, payload, expected] of escapedSplitCases) {
  for (const option of ['-S ', '-S', '--split-string=', '--split-string ']) {
    if (test(`env escape boundary ${name}: ${option}`, () => {
      const command = 'env ' + option + quoteSplitPayload(payload);
      for (const input of [command, JSON.stringify({ tool_input: { command } })]) {
        const result = runHook(input);
        assert.strictEqual(result.code, expected, result.stderr);
        if (expected === 2) assert.match(result.stderr, /Unsupported env split-string escape/);
      }
    })) passed++; else failed++;
  }
}

// --- GNU sed execution model (#3051 test intent) ---
// sed is a text transformer: its script operand and file operands are data,
// except the `e` command and the s///e flag, which run text through the shell.
// Ported from the #3051 litmus set: quoted-as-data stays data, real execution
// is blocked, and unmodeled invocations keep the conservative opaque default.

const sedCases = [
  // False positives fixed: non-executing sed operands are data.
  ['sed filename is data (the #3051 false positive)', "sed 's/x/y/' 'e git commit --no-verify'", 0],
  ['non-executing script containing a git command is data', "sed 's/x/git commit --no-verify/'", 0],
  ['file operand containing git is data', "sed 's/eee/zzz/' 'git commit --no-verify.txt'", 0],
  ['benign line-range script is data', "sed -n '1,3p' file.txt", 0],
  ['s///e replacement is shell source', "printf x | sed 's/x/git commit --no-verify/e'", 2],
  ['s///e replacement still blocked further downstream', "printf x | sed 's/x/git commit --no-verify/e' | cat", 2],
  ['e command operand is shell source', "sed -e 'e git commit --no-verify'", 2],
  ['bare e consumes piped source as shell code', "printf 'git commit --no-verify' | sed -e 'e'", 2],
  ['--expression= form is modeled', "sed --expression='s/x/git commit --no-verify/e'", 2],
  // Conservative defaults preserved: unmodeled invocations stay opaque.
  ['-f scripts are unreadable: opaque default', "sed -f script.sed 'git commit --no-verify'", 2],
  ['-i suffix ambiguity: opaque default', "sed -i 's/a/b/' 'git commit --no-verify'", 2],
  // Litmus anchors from the #3051 direction check (existing behavior pinned).
  ['quoted-as-data through echo stays allowed', 'echo "git commit --no-verify"', 0],
  ['direct --no-verify stays blocked', 'git commit --no-verify -m x', 2],
  ['mixed quoting smuggling a real flag stays blocked', "git commit '--no-verify' -m x", 2],
  // GNU sed collects -e scripts from any argv position (CodeRabbit finding on
  // this PR): an execution construct after positional operands still executes.
  ['later -e script after positional operands is scanned', "printf x | sed -e 's/x/y/' - -e 's/y/git commit --no-verify/e'", 2],
  ['later -e after a positional script operand is scanned', "sed 's/x/y/' -e 'e git commit --no-verify'", 2],
  ['later --expression= after positionals is scanned', "sed 's/x/y/' --expression='s/x/git commit --no-verify/e'", 2],
  ['-- ends options: later tokens are file operands', "sed -e 's/x/y/' -- 'git commit --no-verify'", 0],
  // GNU sed decodes escapes in exec-bearing fragments before execution
  // (Greptile P1 findings on this PR): decoding that surface faithfully is out
  // of scope, so escaped fragments are conservatively blocked instead.
  ['hex escape decoding bypass is conservatively blocked', "printf x | sed 's/x/\\x67it commit --no-verify/e'", 2],
  ['unknown escape decoding bypass is conservatively blocked', "printf x | sed 's/x/\\git commit --no-verify/e'", 2],
  ['escaped-newline continued e operand is conservatively blocked', "printf x | sed -e 'e git commit \\\n--no-verify'", 2],
  ['octal escape decoding bypass is conservatively blocked', "printf x | sed 's/x/\\147it commit --no-verify/e'", 2],
  ['backslash in a non-executing script stays data', "sed 's/a\\/b/c/' 'git commit --no-verify'", 0]
];
for (const [name, command, expected] of sedCases) {
  if (test(`sed model ${name}`, () => {
    for (const input of [command, JSON.stringify({ tool_input: { command } })]) {
      const result = runHook(input);
      assert.strictEqual(result.code, expected, `expected exit ${expected}, got ${result.code}: ${result.stderr}`);
      if (expected === 2) assert.match(result.stderr, /BLOCKED/);
    }
  })) passed++; else failed++;
}

console.log('─'.repeat(50));
console.log(`Passed: ${passed}  Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
