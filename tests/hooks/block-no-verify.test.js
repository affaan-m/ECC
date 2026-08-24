/**
 * Tests for scripts/hooks/block-no-verify.js via run-with-flags.js
 */

const assert = require('assert');
const fs = require('fs');
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

// --- --config-env: the second spelling of -c ---
//
// `git --config-env=<name>=<envvar>` reads a config value out of the
// environment, so it sets core.hooksPath exactly as `-c` does:
//   MYVAR=/dev/null git --config-env=core.hooksPath=MYVAR commit -m x
// Verified against git 2.51: both the `=` and space-separated forms are
// accepted and skip the hooks. (An abbreviation of the option itself,
// `--config-en=`, is rejected by git, so exact matching is sufficient.)

if (test('blocks --config-env=core.hooksPath override', () => {
  const r = runHook({ tool_input: { command: 'git --config-env=core.hooksPath=MYVAR commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(/core\.hookspath/i.test(r.stderr), `stderr should mention core.hooksPath: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks --config-env core.hooksPath override (space-separated)', () => {
  const r = runHook({ tool_input: { command: 'git --config-env core.hooksPath=MYVAR commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks --config-env core.HOOKSPATH override (case-variant key)', () => {
  const r = runHook({ tool_input: { command: 'git --config-env=core.HOOKSPATH=MYVAR commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks --config-env core.hooksPath override on git push', () => {
  const r = runHook({ tool_input: { command: 'git --config-env core.hooksPath=MYVAR push origin main' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

// An unrecognised value-taking global option used to blind the subcommand
// scanner: its value token looked like a bare word, so the `commit` after it
// was rejected as the subcommand and the guard stopped inspecting the command
// entirely -- letting even an explicit --no-verify through.
if (test('sees --no-verify past a --config-env that sets an unrelated key', () => {
  const r = runHook({ tool_input: { command: 'git --config-env other.key=MYVAR commit --no-verify -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(/no-verify/i.test(r.stderr), `stderr should mention --no-verify: ${r.stderr}`);
})) passed++; else failed++;

if (test('still allows --config-env that sets an unrelated key', () => {
  const r = runHook({ tool_input: { command: 'git --config-env=other.key=MYVAR commit -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// Quoting is transparent to the shell but was not to the guard: detectGitCommand
// split raw text on whitespace, so `"--config-env=core.hooksPath=MYVAR"` kept its
// quotes, failed the `startsWith('-')` flag check and landed in subcommand position
// -- the whole command then escaped inspection. The same hole covered `-c`, which
// predates --config-env, and a quoted subcommand. Verified against git 2.51: the
// shell strips these quotes, so git receives the option and skips the hooks.
// (`git "-c core.hooksPath=..."` as ONE argv is not covered because git itself
// rejects it: "unknown option: -c core.hooksPath=...", exit 129.)

if (test('blocks a quoted --config-env=core.hooksPath override', () => {
  const r = runHook({ tool_input: { command: 'git "--config-env=core.hooksPath=MYVAR" commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(/core\.hookspath/i.test(r.stderr), `stderr should mention core.hooksPath: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks a quoted space-separated --config-env override', () => {
  const r = runHook({ tool_input: { command: 'git "--config-env" "core.hooksPath=MYVAR" commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks a single-quoted --config-env override', () => {
  const r = runHook({ tool_input: { command: "git '--config-env=core.hooksPath=MYVAR' commit -m 'msg'" } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks a quoted -c core.hooksPath override', () => {
  const r = runHook({ tool_input: { command: 'git "-c" "core.hooksPath=/dev/null" commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('sees --no-verify past a quoted global option', () => {
  const r = runHook({ tool_input: { command: 'git "--config-env=other.key=MYVAR" commit --no-verify -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(/no-verify/i.test(r.stderr), `stderr should mention --no-verify: ${r.stderr}`);
})) passed++; else failed++;

if (test('sees --no-verify past a quoted subcommand', () => {
  const r = runHook({ tool_input: { command: 'git "commit" --no-verify -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('still allows a quoted global option that sets an unrelated key', () => {
  const r = runHook({ tool_input: { command: 'git "--config-env=other.key=MYVAR" commit -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// core.hooksPath is not the only key that moves the hooks. `include.path` makes
// git read another config file and apply everything in it -- core.hooksPath
// included -- so it is the same bypass one level of indirection away.
// Verified against git 2.51, in a repo whose pre-commit hook echoes a marker:
//   git -c include.path=evil.conf commit -m x   -> commit succeeds, marker absent
//   git --config-env=include.path=EVIL config --get core.hooksPath
//                                              -> prints the redirected path
// includeIf.<condition>.path is covered as the same capability, not as a
// reproduction: on git 2.51 a command-line conditional include never matched in
// testing, so it may be inert there.

if (test('blocks -c include.path, which can redirect core.hooksPath', () => {
  const r = runHook({ tool_input: { command: 'git -c include.path=/tmp/evil.conf commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(/include\.path/i.test(r.stderr), `stderr should mention include.path: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks a quoted -c include.path override', () => {
  const r = runHook({ tool_input: { command: 'git "-c" "include.path=/tmp/evil.conf" commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks --config-env=include.path', () => {
  const r = runHook({ tool_input: { command: 'git --config-env=include.path=EVIL commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks --config-env include.path (space-separated)', () => {
  const r = runHook({ tool_input: { command: 'git --config-env include.path=EVIL commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks INCLUDE.PATH (config keys are case-insensitive)', () => {
  const r = runHook({ tool_input: { command: 'git -c INCLUDE.PATH=/tmp/evil.conf commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks includeIf.<condition>.path', () => {
  const r = runHook({ tool_input: { command: 'git -c includeIf.gitdir:/x/.path=/tmp/evil.conf commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks -c include.path on git push', () => {
  const r = runHook({ tool_input: { command: 'git -c include.path=/tmp/evil.conf push origin main' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('still allows an unrelated -c setting', () => {
  const r = runHook({ tool_input: { command: 'git -c user.name=x commit -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('still allows a key that merely ends in .path', () => {
  const r = runHook({ tool_input: { command: 'git -c diff.external.path=/usr/bin/diff commit -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// tokenizeShellWords strips quotes but does not run the shell, so `$(printf commit)`
// arrived verbatim while the shell handed git a plain `commit`. Same for the config
// key: `-c "$(printf core.hooksPath=/dev/null)"` did not match any known key.
// Both predate this PR -- verified ALLOWED against the merge base d8409a4b too.
//
// Failing closed here is deliberately narrow. A dynamic subcommand does not block on
// its own: the guard keeps inspecting and blocks only if --no-verify or a hook
// redirect is also present, so `git $CMD status` is fine. For `-c`, only the KEY half
// is treated as opaque -- an expanded VALUE cannot turn user.name into core.hooksPath.

if (test('blocks --no-verify behind a command-substituted subcommand', () => {
  const r = runHook({ tool_input: { command: 'git "$(printf commit)" --no-verify -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks --no-verify behind a backticked subcommand', () => {
  const r = runHook({ tool_input: { command: 'git `echo commit` --no-verify -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks --no-verify behind a variable subcommand', () => {
  const r = runHook({ tool_input: { command: 'git $SUB --no-verify -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks --no-verify behind a braced variable subcommand', () => {
  const r = runHook({ tool_input: { command: 'git ${SUB} --no-verify -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks a command-substituted config key', () => {
  const r = runHook({ tool_input: { command: 'git -c "$(printf core.hooksPath=/dev/null)" commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('blocks a config key hidden in a variable', () => {
  const r = runHook({ tool_input: { command: 'git -c $CFG commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('still allows a command substitution in the commit message', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "$(cat msg.txt)"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('still allows a backtick inside the commit message', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "see `date`"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('still allows an expanded VALUE on a literal config key', () => {
  const r = runHook({ tool_input: { command: 'git -c user.email=$EMAIL commit -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('still allows a command-substituted config VALUE', () => {
  const r = runHook({ tool_input: { command: 'git -c user.name="$(whoami)" commit -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('still allows a dynamic subcommand with no bypass flag', () => {
  const r = runHook({ tool_input: { command: 'git $CMD status' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('still allows a dynamic branch name on push', () => {
  const r = runHook({ tool_input: { command: 'git push origin $BRANCH' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// `-n` is --no-verify to git commit but "max count" to log/show/diff. Widening the
// flag scan to commit's set for an expanded subcommand therefore rejected an ordinary
// `git $SUB -n 5`. Checked against git 2.51:
//   git log -n 5   ok        git commit -n 5  error: pathspec '5' did not match
//   git log -n5    ok        git commit -n5   error: unknown switch `5'
// so `-n<digits>` can never be a commit bypass, and `-n <digits>` is a pathspec that
// fails unless a file with that numeric name exists. Only those two spellings are
// exempt, and only when the subcommand is unknown.

if (test('allows an expanded subcommand with -n <count>', () => {
  const r = runHook({ tool_input: { command: 'git $SUB -n 5' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows an expanded subcommand with -n<count> attached', () => {
  const r = runHook({ tool_input: { command: 'git $SUB -n5' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows an expanded subcommand with -n <count> and further flags', () => {
  const r = runHook({ tool_input: { command: 'git $SUB -n 5 --oneline' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('still blocks a bare -n behind an expanded subcommand', () => {
  const r = runHook({ tool_input: { command: 'git $SUB -n -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('still blocks -n with no argument behind an expanded subcommand', () => {
  const r = runHook({ tool_input: { command: 'git $SUB -n' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('still blocks --no-verify behind an expanded subcommand regardless of -n rules', () => {
  const r = runHook({ tool_input: { command: 'git $SUB --no-verify -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('the count exemption does not leak to a literal commit', () => {
  const r = runHook({ tool_input: { command: 'git commit -n 5' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

// What settles the ambiguous `-n` is that git commit reads the NEXT token as a
// pathspec, so the command only does anything if that path exists. Checked against
// git 2.51 in a repo whose pre-commit hook exits 1:
//   git commit -n 9 -m x   error: pathspec '9' did not match      -> no commit
//   git commit -n 1 -m x   [main 326cf0b] x, hook never ran       -> real bypass
// So the split form is exempt only while nothing by that name is on disk. The hook
// runs with the repo root as cwd, so these two cases create and remove the path.
const NUMERIC_PATH = '987654321';

if (test('blocks split -n <digits> when that path exists (path-limited commit)', () => {
  fs.writeFileSync(NUMERIC_PATH, '');
  try {
    const r = runHook({ tool_input: { command: `git $SUB -m "msg" -n ${NUMERIC_PATH}` } });
    assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  } finally {
    fs.rmSync(NUMERIC_PATH, { force: true });
  }
})) passed++; else failed++;

if (test('allows split -n <digits> when no such path exists (git commit would error)', () => {
  assert.ok(!fs.existsSync(NUMERIC_PATH), 'fixture path must be absent');
  const r = runHook({ tool_input: { command: `git $SUB -n ${NUMERIC_PATH}` } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('attached -n<digits> stays allowed even when that path exists', () => {
  fs.writeFileSync(NUMERIC_PATH, '');
  try {
    // git commit rejects `-n<digits>` outright ("unknown switch"), so it can never
    // be a bypass regardless of the filesystem.
    const r = runHook({ tool_input: { command: `git $SUB -n${NUMERIC_PATH}` } });
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
  } finally {
    fs.rmSync(NUMERIC_PATH, { force: true });
  }
})) passed++; else failed++;

if (test('a literal commit with a numeric pathspec blocks whether or not it exists', () => {
  const r = runHook({ tool_input: { command: `git commit -n ${NUMERIC_PATH} -m "msg"` } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

console.log('─'.repeat(50));
console.log(`Passed: ${passed}  Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
