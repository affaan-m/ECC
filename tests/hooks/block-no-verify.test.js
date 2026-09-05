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
  ['retain broad blocking of a quoted git literal', 'echo "git commit -n"'],
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
  ['block adjacent quoted git and escaped exe suffix', '"git""\\.exe" commit -n -m x'],
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
  ['block bypass in a whitespace-separated command sequence', 'git commit -n -m x            git commit --no-verify -m x            git commit -am x -n            git push --no-verify'],
];

for (const [name, command] of executingPayloads) {
  if (test(name, () => {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}: ${r.stderr}`);
  })) passed++; else failed++;
}

const nonLeakingPayloads = [
  ['python heredoc string with later bash -n', 'python3 - <<\'PY\'\nold="git add -A\\nif ! git diff --cached --quiet; then\\n  git commit -q -m \\"vault sync"\nPY\nbash -n vault-sync.sh'],
  ['assignment string with later bash -n', 'old="git commit -q -m x"; bash -n x.sh'],
  ['plain commit followed by later-line bash -n', 'git commit -m x\nbash -n s.sh'],
  ['plain commit followed by grep -n', 'git commit -m x; grep -n foo f.txt'],
  ['JSON string followed by sed -n', 'printf \'%s\' \'{"cmd":"git commit -q -m \\"x\\""}\' | node x.js; sed -n 1p f'],
  ['hyphenated Python heredoc delimiter', 'python3 - <<\'PY-SCRIPT\'\nprint("git commit -n")\nPY-SCRIPT\nbash -n x.sh'],
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
];

for (const [name, command] of nonLeakingPayloads) {
  if (test(name, () => {
    const r = runHook({ tool_input: { command } });
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
  })) passed++; else failed++;
}

console.log('─'.repeat(50));
console.log(`Passed: ${passed}  Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
