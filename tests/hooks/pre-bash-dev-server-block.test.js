/**
 * Tests for pre-bash-dev-server-block.js hook
 *
 * Run with: node tests/hooks/pre-bash-dev-server-block.test.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-bash-dev-server-block.js');

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

function runScript(command) {
  const input = { tool_input: { command } };
  const result = spawnSync('node', [script], {
    encoding: 'utf8',
    input: JSON.stringify(input),
    timeout: 10000,
  });
  return { code: result.status || 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/**
 * Run the hook with `process.platform` forced to a POSIX value.
 *
 * The hook is a no-op on Windows, so its decision cannot be observed there at
 * all — yet the decision itself has nothing platform-specific in it.
 */
function runScriptAsPosix(command) {
  const input = { tool_input: { command } };
  const bootstrap =
    "Object.defineProperty(process, 'platform', { value: 'linux' });" +
    `require(${JSON.stringify(script)});`;
  const result = spawnSync('node', ['-e', bootstrap], {
    encoding: 'utf8',
    input: JSON.stringify(input),
    timeout: 10000,
  });
  return { code: result.status || 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function runTests() {
  console.log('\n=== Testing pre-bash-dev-server-block.js ===\n');

  let passed = 0;
  let failed = 0;

  const isWindows = process.platform === 'win32';

  // --- Blocking tests (non-Windows only) ---

  if (!isWindows) {
    (test('blocks npm run dev (exit code 2, stderr contains BLOCKED)', () => {
      const result = runScript('npm run dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
      assert.ok(result.stderr.includes('BLOCKED'), `Expected stderr to contain BLOCKED, got: ${result.stderr}`);
    }) ? passed++ : failed++);

    (test('blocks dev launch after an ANSI-C escaped apostrophe', () => {
      for (const command of ["export x=$'it\\'s here'; npm run dev", "export x=$'it\\'s here'\nnpm run dev"]) {
        const result = runScript(command);
        assert.strictEqual(result.code, 2, `Expected exit code 2 for ${command}, got ${result.code}`);
      }
    }) ? passed++ : failed++);

    (test('blocks dev launch after a $$ that a quote follows', () => {
      for (const command of ["echo $$'\\'; npm run dev", "cat <<$$'EOF'\nbody\n$$EOF\nnpm run dev"]) {
        const result = runScript(command);
        assert.strictEqual(result.code, 2, `Expected exit code 2 for ${JSON.stringify(command)}, got ${result.code}`);
      }
    }) ? passed++ : failed++);

    (test('allows a dev command quoted after a $$', () => {
      const result = runScript("echo $$'; npm run dev'");
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('allows a dev command mentioned inside an ANSI-C quoted string', () => {
      const result = runScript("echo $'x\\' && npm run dev'");
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks pnpm dev (exit code 2)', () => {
      const result = runScript('pnpm dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks yarn dev (exit code 2)', () => {
      const result = runScript('yarn dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks bun run dev (exit code 2)', () => {
      const result = runScript('bun run dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('still blocks npm run dev:ssr — colon variant is a dev server (exit 2)', () => {
      const result = runScript('npm run dev:ssr');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('still blocks tmux run-shell and tmux -c — no pane keeps the log (exit 2)', () => {
      for (const command of [
        'tmux run-shell "npm run dev"',
        'tmux -L work run-shell "npm run dev"',
        'tmux -c "npm run dev"',
        "tmux -c'npm run dev'",
        // In -vL the L takes `new-session` as its socket name, so run-shell is the command.
        'tmux -vL new-session run-shell "npm run dev"',
        // A pane command earlier in a sequence does not cover a later run-shell.
        'tmux new-session -d \\; run-shell "npm run dev"',
        'tmux -L work new-session -d \\; run-shell "npm run dev"',
        // A `;` that ends an argument separates tmux commands too.
        "tmux -L work new-session -d 'npm run dev;' run-shell 'npm run dev'"
      ]) {
        const result = runScript(command);
        assert.strictEqual(result.code, 2, `Expected exit code 2 for ${command}, got ${result.code}`);
      }
    }) ? passed++ : failed++);
  } else {
    console.log('  (skipping blocking tests on Windows)\n');
  }

  // --- Allow tests ---

  (test('allows tmux-wrapped npm run dev (exit code 0)', () => {
    const result = runScript('tmux new-session -d -s dev "npm run dev"');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows a tmux launch after tmux options, a path, an env prefix or a command alias (exit code 0)', () => {
    for (const command of [
      'tmux -L work new-session -d -s dev "npm run dev"',
      'tmux -f ~/.tmux.dev.conf new-session -d "npm run dev"',
      '/opt/homebrew/bin/tmux new-session -d -s dev "npm run dev"',
      'env TERM=xterm-256color tmux new-session -d "npm run dev"',
      'tmux neww "npm run dev"',
      'tmux splitw -h "pnpm dev"'
    ]) {
      const result = runScript(command);
      assert.strictEqual(result.code, 0, `Expected exit code 0 for ${command}, got ${result.code}`);
    }
  }) ? passed++ : failed++);

  (test('allows npm run dev sent to or respawned in a tmux pane (exit code 0)', () => {
    for (const command of [
      'tmux send-keys -t dev "npm run dev" Enter',
      'tmux respawn-pane -k -t dev "npm run dev"',
      'tmux new-session -d -s dev \\; send-keys -t dev "npm run dev" Enter',
      "tmux new-session -d 'echo start;' send-keys -t dev 'npm run dev' Enter",
      // In double quotes bash keeps the backslash before ;, so tmux reads a literal ;
      'tmux send-keys -t dev "echo ready\\;" "npm run dev" Enter'
    ]) {
      const result = runScript(command);
      assert.strictEqual(result.code, 0, `Expected exit code 0 for ${command}, got ${result.code}`);
    }
  }) ? passed++ : failed++);

  (test('allows npm install (exit code 0)', () => {
    const result = runScript('npm install');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows npm test (exit code 0)', () => {
    const result = runScript('npm test');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows npm run build (exit code 0)', () => {
    const result = runScript('npm run build');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  // --- dev-<suffix> scripts are distinct from the dev server, must not be blocked ---

  (test('allows npm run dev-setup — distinct script, not the dev server (exit 0)', () => {
    const result = runScript('npm run dev-setup');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows pnpm run dev-docs — distinct script (exit 0)', () => {
    const result = runScript('pnpm run dev-docs');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows yarn dev-build — distinct script (exit 0)', () => {
    const result = runScript('yarn dev-build');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  // --- Subshell bypass regression (issue: dev server slipped past via $(), ``, ()) ---

  if (!isWindows) {
    (test('blocks $(npm run dev) — command substitution', () => {
      const result = runScript('$(npm run dev)');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
      assert.ok(result.stderr.includes('BLOCKED'), 'expected BLOCKED in stderr');
    }) ? passed++ : failed++);

    (test('blocks `npm run dev` — backtick substitution', () => {
      const result = runScript('`npm run dev`');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks echo $(npm run dev) — substitution nested in argument', () => {
      const result = runScript('echo $(npm run dev)');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks (npm run dev) — plain subshell group', () => {
      const result = runScript('(npm run dev)');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks $(echo a; npm run dev) — substitution with sequenced segments', () => {
      const result = runScript('$(echo a; npm run dev)');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks (pnpm dev) — plain subshell group with pnpm', () => {
      const result = runScript('(pnpm dev)');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('allows tmux launcher inside subshell wrapping (exit code 0)', () => {
      const result = runScript('(tmux new-session -d -s dev "npm run dev")');
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('allows single-quoted "(npm run dev)" — literal string, not a subshell', () => {
      const result = runScript("git commit -m '(npm run dev)'");
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('allows double-quoted "(npm run dev)" — literal in double quotes (bash does not subshell)', () => {
      const result = runScript('echo "(npm run dev)"');
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);

    (test("allows single-quoted '$(npm run dev)' — literal string, no substitution", () => {
      const result = runScript("git commit -m '$(npm run dev) fix'");
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);
  }

  // --- Round 1 review fixes (Greptile + CodeRabbit on PR #1889) ---

  if (!isWindows) {
    (test('blocks $(echo ")"; (npm run dev)) — quoted ) does not terminate $() early', () => {
      const result = runScript('$(echo ")"; (npm run dev))');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks (echo ")"; npm run dev) — quoted ) does not terminate (...) early', () => {
      const result = runScript('(echo ")"; npm run dev)');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test("blocks echo $'it\\'s'; (npm run dev) — escaped apostrophe does not close $'...'", () => {
      const result = runScript("echo $'it\\'s'; (npm run dev)");
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('allows $(echo "(npm run dev)") — () inside double-quoted substitution body is literal', () => {
      const result = runScript('$(echo "(npm run dev)")');
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks { npm run dev; } — brace group runs in current shell', () => {
      const result = runScript('{ npm run dev; }');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks echo hi && { npm run dev; } — brace group after &&', () => {
      const result = runScript('echo hi && { npm run dev; }');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('allows {npm run dev} — bash requires space after { to form a group', () => {
      const result = runScript('{npm run dev}');
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks yarn run dev — yarn 1.x convention', () => {
      const result = runScript('yarn run dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks bun dev — bun bare form', () => {
      const result = runScript('bun dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks "$(npm run dev)" — double-quoted substitution still substitutes', () => {
      const result = runScript('echo "$(npm run dev)"');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);
  }

  // --- Newlines ---

  if (!isWindows) {
    (test('blocks a dev server after a single-quoted backslash and a separator', () => {
      for (const command of ["echo 'x\\'; npm run dev", "echo 'x\\'\nnpm run dev"]) {
        const result = runScript(command);
        assert.strictEqual(result.code, 2, `Expected exit code 2 for ${JSON.stringify(command)}, got ${result.code}`);
      }
    }) ? passed++ : failed++);

    (test('blocks a dev server started on a later line of a multi-line command', () => {
      const result = runScript('cd app\nnpm run dev');
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks a dev server after a here-document with an ANSI-C quoted delimiter', () => {
      const result = runScript("cat <<$'EOF'\ntext\nEOF\nnpm run dev");
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks a dev server after a here-document with an escaped quote in its delimiter', () => {
      const command = 'cat <<E"F\\"O"\nEF"O\nnpm run dev';
      const result = runScript(command);
      assert.strictEqual(result.code, 2, `Expected exit code 2 for ${JSON.stringify(command)}, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks a dev server started by a substitution in a here-document body', () => {
      for (const command of ["npm --version <<EOF\n'$(npm run dev)'\nEOF", "cat <<EOF\n'$(npm run dev)'\nEOF"]) {
        const result = runScript(command);
        assert.strictEqual(result.code, 2, `Expected exit code 2 for ${JSON.stringify(command)}, got ${result.code}`);
      }
    }) ? passed++ : failed++);

    (test('blocks a dev command in a substitution with a very long body', () => {
      const command = `echo "$(npm run dev; ${'true; '.repeat(150000)})"`;
      const result = runScript(command);
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
    }) ? passed++ : failed++);

    (test('blocks nested dev commands in expanded here-document substitutions', () => {
      for (const command of [
        'cat <<EOF\n\'$(echo "$(npm run dev)")\'\nEOF',
        "cat <<EOF\n'$( (npm run dev) )'\nEOF",
      ]) {
        const result = runScript(command);
        assert.strictEqual(result.code, 2, `Expected exit code 2 for ${JSON.stringify(command)}, got ${result.code}`);
      }
      const quoted = "cat <<'EOF'\n'$(echo \"$(npm run dev)\")'\nEOF";
      assert.strictEqual(runScript(quoted).code, 0, 'quoted here-document must remain literal');
    }) ? passed++ : failed++);
  }

  (test('allows a here-document that only mentions a dev server', () => {
    const result = runScript('cat <<EOF > README.md\nStart it with:\nnpm run dev\nEOF');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows a here-document body that follows an operator', () => {
    const result = runScript('cat <<EOF &&\nnpm run dev\nEOF\necho done');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows a here-document body whose ANSI-C quoted delimiter has an escape', () => {
    const result = runScript("cat <<$'E\\x4fF'\nE\\x4fF\nnpm run dev\nEOF");
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  (test('allows a here-document body fed to a package manager command', () => {
    const result = runScript('npm --version <<EOF && cat\nnpm run dev\nEOF');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
  }) ? passed++ : failed++);

  // --- Edge cases ---

  (test('empty/invalid input passes through (exit code 0)', () => {
    const result = spawnSync('node', [script], {
      encoding: 'utf8',
      input: '',
      timeout: 10000,
    });
    assert.strictEqual(result.status || 0, 0, `Expected exit code 0, got ${result.status}`);
  }) ? passed++ : failed++);

  (test('stdout contains original input on pass-through', () => {
    const input = { tool_input: { command: 'npm install' } };
    const inputStr = JSON.stringify(input);
    const result = spawnSync('node', [script], {
      encoding: 'utf8',
      input: inputStr,
      timeout: 10000,
    });
    assert.strictEqual(result.status || 0, 0);
    assert.strictEqual(result.stdout.trim(), inputStr, `Expected stdout to contain original input`);
  }) ? passed++ : failed++);

  // --- Quoted and option-separated spellings (all platforms) ---
  //
  // The hook no-ops on Windows, so the blocking tests above are skipped there
  // and this class of bug could only be caught on CI. The DECISION is
  // platform-independent, so these force the platform in-process and run
  // everywhere.
  //
  // Measured before the token-based script lookup, every one of these reached
  // the shell as a plain `npm run dev` and was allowed:
  //
  //   npm run "dev"        allow      npm --silent run dev   allow
  //   npm run 'dev'        allow      yarn --cwd app dev     allow
  //   pnpm "dev"           allow

  for (const command of [
    'npm run "dev"',
    "npm run 'dev'",
    'npm run de"v"',
    'pnpm "dev"',
    'yarn run "dev"',
    'bun run "dev"',
    'npm --silent run dev',
    'yarn --cwd app dev',
    // npm accepts any config key as `--key value`, so an option the parser does
    // not know must not swallow the script name behind it.
    'npm --userconfig /tmp/npmrc run dev',
    'npm --registry https://registry.example run dev',
    'npm --loglevel silly run dev',
    // pnpm/yarn/bun take a script without `run`, so a value-taking option of
    // theirs must not be read as the script name.
    'pnpm --loglevel debug dev',
    'yarn --network-timeout 60000 dev',
    'bun --env-file .env dev',
    // The implicit script wins over anything after it: this runs `dev` and
    // passes it `run build`.
    'pnpm dev run build'
  ]) {
    (test(`blocks a quoted or option-separated dev script: ${command}`, () => {
      const result = runScriptAsPosix(command);
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
      assert.ok(result.stderr.includes('BLOCKED'), `Expected BLOCKED, got: ${result.stderr}`);
    }) ? passed++ : failed++);
  }

  for (const command of [
    'npm run dev-setup',
    'pnpm run dev-docs',
    'yarn dev-build',
    'npm run build',
    'npm test',
    'npm install',
    // `--` ends the manager's own arguments: everything after it belongs to the
    // script, so a stray "dev" there is not a dev server.
    'npm test -- --grep dev',
    // A known value-taking option still consumes its value, so a workspace or
    // filter literally named `dev` is not mistaken for the dev script.
    'npm run build --workspace dev',
    'pnpm --filter dev run build',
    // After the `run` keyword the next token IS the script; everything past it
    // is that script's argument. `npm run run dev` runs a script called `run`.
    'npm run run dev',
    'npm run build dev',
    'tmux new-session -d -s dev "npm run dev"'
  ]) {
    (test(`still allows: ${command}`, () => {
      const result = runScriptAsPosix(command);
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}: ${result.stderr}`);
    }) ? passed++ : failed++);
  }

  // --- Manager-specific option arity ---
  //
  // The same short flag means different things per manager: npm -d and pnpm -d
  // are loglevel flags, bun -d is --define <K:V>, pnpm -w is the boolean
  // --workspace-root. A shared value table swallowed `run` or `dev` after the
  // boolean spellings, so `npm -d run dev` escaped tmux.
  for (const command of [
    'npm -d run dev',
    'npm -dd run dev',
    'npm -w app run dev',
    'pnpm -d dev',
    'pnpm -d run dev',
    'pnpm -w dev',
    'pnpm -C app dev',
    'pnpm --dir app run dev',
    'pnpm --filter web dev',
    'yarn -s dev',
    'yarn --cwd app run dev',
    'bun -d K:V dev',
    'bun --define K:V run dev',
    'bun --cwd app dev',
    // bun -c takes an optional value, so both readings are checked.
    'bun -c dev',
    'bun -c bunfig.toml dev',
    'npm run dev -- --port 3000',
    "tmux run-shell 'npm run \"dev\"'"
  ]) {
    (test(`blocks across manager grammars: ${command}`, () => {
      const result = runScriptAsPosix(command);
      assert.strictEqual(result.code, 2, `Expected exit code 2, got ${result.code}`);
      assert.ok(result.stderr.includes('BLOCKED'), `Expected BLOCKED, got: ${result.stderr}`);
    }) ? passed++ : failed++);
  }

  for (const command of [
    'pnpm --filter dev run build',
    'pnpm -F dev build',
    'pnpm -C dev build',
    'bun -d dev:1 build',
    'yarn --cwd dev build',
    'pnpm run build -- dev',
    'npm run lint -- "npm run dev"',
    "tmux new-session -d -s dev 'npm run \"dev\"'",
    // A value-taking option with no value consumes nothing that runs.
    'pnpm --filter',
    'npm run'
  ]) {
    (test(`allows across manager grammars: ${command}`, () => {
      const result = runScriptAsPosix(command);
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}: ${result.stderr}`);
    }) ? passed++ : failed++);
  }

  (test('blocks the bare `pnpm dev` / `yarn dev` / `bun dev` forms', () => {
    for (const command of ['pnpm dev', 'yarn dev', 'bun dev', 'npm run dev:ssr']) {
      const result = runScriptAsPosix(command);
      assert.strictEqual(result.code, 2, `Expected exit code 2 for ${command}, got ${result.code}`);
    }
  }) ? passed++ : failed++);

  // --- Summary ---

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
