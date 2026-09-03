'use strict';

/**
 * Tests for the hook command path itself.
 *
 * Run with: node tests/hooks/hook-command-launch.test.js
 *
 * Every other hook test invokes a script file directly with spawnSync. That
 * skips the two things a hook command actually has to survive in production:
 * the harness substituting ${CLAUDE_PLUGIN_ROOT} into the command string, and
 * a real shell parsing the result. A command can be completely broken -- wrong
 * quoting, a path that only resolves relative to the repo, an entry point that
 * cannot find its own root -- and still pass a test that bypasses the shell.
 *
 * So these tests assemble the real command strings, substitute the plugin root
 * the way the harness does, and run them through the supported shells (POSIX
 * sh, and cmd.exe on Windows) from a working directory that is neither the
 * repo nor the plugin, with CLAUDE_PLUGIN_ROOT and ECC_PLUGIN_ROOT removed
 * from the environment.
 *
 * The plugin root used is a packaged-layout fixture: a temp directory holding
 * a copy of the script tree, the way an installed plugin looks, not the repo
 * checkout. A launcher that only works because it happens to sit inside this
 * repo fails here.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOOKS_JSON_PATH = path.join(REPO_ROOT, 'hooks', 'hooks.json');
const PLUGIN_ROOT_TOKEN = '${CLAUDE_PLUGIN_ROOT}';
// Matches the ceiling run-with-flags.js applies, so a launcher that captures
// more than the test harness does cannot hide behind a smaller buffer here.
const MAX_CHILD_OUTPUT_BYTES = 16 * 1024 * 1024;

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message || String(error));
    failed += 1;
  }
}

function skip(name, reason) {
  console.log(`SKIP ${name} (${reason})`);
  skipped += 1;
}

// ---------------------------------------------------------------------------
// Packaged-layout fixture
// ---------------------------------------------------------------------------

// A hook target that reports exactly what the launcher handed it, so the test
// can assert stdin delivery, stdout, stderr and exit status independently.
// Its stdout is deliberately NOT a prefix of the raw input: the bootstrap
// suppresses stdout that is a byte-prefix of the hook event to avoid transcript
// bloat, and that suppression is asserted separately below.
const PROBE_SOURCE = `'use strict';
const fs = require('fs');
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (_) { raw = ''; }
process.stderr.write('PROBE_STDERR:' + (process.env.PROBE_TAG || '') + '\\n');
process.stdout.write('PROBE_STDOUT:' + raw);
process.exit(Number(process.env.PROBE_EXIT || 0));
`;

// A hook target that echoes the raw hook event back verbatim -- the passthrough
// shape the bootstrap is supposed to collapse to empty stdout.
const ECHO_SOURCE = `'use strict';
const fs = require('fs');
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (_) { raw = ''; }
process.stdout.write(raw);
`;

// A hook target that emits a large, self-describing payload, to prove the
// launcher captures a child's stdout without hitting a buffer cap.
const BULK_SOURCE = `'use strict';
const fs = require('fs');
try { fs.readFileSync(0, 'utf8'); } catch (_) {}
const size = Number(process.env.BULK_BYTES || 0);
process.stdout.write('B'.repeat(size));
`;

const tempDirs = [];

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function cleanupTempDirs() {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      // best effort; a leaked temp dir must not fail the suite
    }
  }
}

/**
 * Build a directory that looks like an installed ECC plugin rather than this
 * repo: the script tree, the sentinel skill resolveEccRoot() probes for, and
 * the probe hook targets. Nothing else from the checkout is present.
 */
function makePackagedPluginRoot() {
  const base = makeTempDir('ecc-packaged-root-');
  const root = path.join(base, 'ecc');
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  // resolveEccRoot() accepts a candidate only when the script tree and a
  // sentinel ECC skill are both present.
  fs.mkdirSync(path.join(root, 'skills', 'continuous-learning-v2'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'hooks', 'launcher-probe.js'), PROBE_SOURCE);
  fs.writeFileSync(path.join(root, 'scripts', 'hooks', 'launcher-echo.js'), ECHO_SOURCE);
  fs.writeFileSync(path.join(root, 'scripts', 'hooks', 'launcher-bulk.js'), BULK_SOURCE);
  return root;
}

/**
 * A second packaged root whose probe reports a different marker.
 *
 * Without it, "honours ECC_PLUGIN_ROOT" is untestable: an entry point that
 * ignores the variable falls back to its own directory, which in a one-root
 * fixture is the same directory the variable pointed at, so the test passes
 * either way. Pointing the variable at a root the launcher does NOT live in
 * makes the two behaviours distinguishable.
 */
function makeAlternatePluginRoot() {
  const base = makeTempDir('ecc-packaged-alt-');
  const root = path.join(base, 'ecc');
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'continuous-learning-v2'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'hooks', 'launcher-probe.js'), PROBE_SOURCE.replace('PROBE_STDERR:', 'ALT_STDERR:').replace('PROBE_STDOUT:', 'ALT_STDOUT:'));
  return root;
}

const PACKAGED_ROOT = makePackagedPluginRoot();
const ALTERNATE_ROOT = makeAlternatePluginRoot();
// A working directory that is neither the repo nor the plugin, so any launcher
// that silently depends on cwd fails.
const FOREIGN_CWD = makeTempDir('ecc-foreign-cwd-');
const FAKE_HOME = makeTempDir('ecc-fake-home-');

// ---------------------------------------------------------------------------
// Shell forms
// ---------------------------------------------------------------------------

function hasPosixShell() {
  const probe = spawnSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

/**
 * The supported host command paths. Each converts a command string into the
 * argv a harness would use to run it.
 */
function shellForms() {
  const forms = [];

  if (hasPosixShell()) {
    forms.push({
      name: 'POSIX sh',
      // POSIX paths use forward slashes; on Windows a Git Bash sh still
      // accepts a drive-letter path in that form.
      rootFor: root => root.split(path.sep).join('/'),
      spawn: (command, options) => spawnSync('sh', ['-c', command], options)
    });
  }

  if (process.platform === 'win32') {
    forms.push({
      name: 'Windows cmd.exe',
      rootFor: root => root,
      // `shell: true` is how the harness runs a command string on Windows, and
      // how the rest of this suite exercises hooks.json commands. Handing
      // cmd.exe a pre-split argv instead re-quotes the command and breaks the
      // very quoting the test exists to verify.
      spawn: (command, options) => spawnSync(command, { ...options, shell: true })
    });
  }

  return forms;
}

const SHELL_FORMS = shellForms();

/**
 * Run a hook command the way a harness does: substitute the plugin-root token,
 * hand the result to a real shell, feed the hook event on stdin.
 */
function runHookCommand(form, commandTemplate, options = {}) {
  const root = form.rootFor(PACKAGED_ROOT);
  const command = commandTemplate.split(PLUGIN_ROOT_TOKEN).join(root);

  const env = { ...process.env, ...(options.env || {}) };
  // The point of the exercise: the launcher must not need these.
  for (const name of options.keepRootVars ? [] : ['CLAUDE_PLUGIN_ROOT', 'ECC_PLUGIN_ROOT']) {
    delete env[name];
  }
  for (const [name, value] of Object.entries(options.env || {})) {
    if (value === undefined) delete env[name];
  }
  // Keep hook side effects inside the fixture.
  env.HOME = FAKE_HOME;
  env.USERPROFILE = FAKE_HOME;

  const result = form.spawn(command, {
    cwd: options.cwd || FOREIGN_CWD,
    env,
    input: options.input === undefined ? '{"session_id":"launcher-test"}' : options.input,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: MAX_CHILD_OUTPUT_BYTES
  });

  assert.ok(!result.error, `shell failed to run command: ${result.error && result.error.message}`);
  return { ...result, command };
}

function bootstrapCommand(relPath, extra = '') {
  return `node "${PLUGIN_ROOT_TOKEN}/scripts/hooks/plugin-hook-bootstrap.js" node ${relPath}${extra ? ' ' + extra : ''}`;
}

// ---------------------------------------------------------------------------
// Group A: the shape of the shipped hook commands
// ---------------------------------------------------------------------------

function loadHookCommands() {
  const config = JSON.parse(fs.readFileSync(HOOKS_JSON_PATH, 'utf8'));
  const commands = [];
  for (const [event, matchers] of Object.entries(config.hooks || {})) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks || []) {
        if (typeof hook.command === 'string') {
          commands.push({ event, matcher: matcher.matcher, command: hook.command });
        }
      }
    }
  }
  return commands;
}

const HOOK_COMMANDS = loadHookCommands();

test('hooks.json ships at least one hook command', () => {
  assert.ok(HOOK_COMMANDS.length > 0, 'expected hooks.json to define hook commands');
});

test('no hook command embeds an inline node program', () => {
  const offenders = HOOK_COMMANDS.filter(entry => /\bnode\s+(-e|--eval)\b/.test(entry.command)).map(entry => `${entry.event}/${entry.matcher}`);
  assert.deepStrictEqual(offenders, [], `inline node -e bootstraps are what Defender classifies as VirTool:JS/Anomelesz.A; found in ${offenders.join(', ')}`);
});

test('no hook command uses the loader shapes that trip heuristic scanners', () => {
  const banned = ['String.fromCharCode', 'readdirSync', 'catch(_)', 'spawnSync'];
  const offenders = [];
  for (const entry of HOOK_COMMANDS) {
    for (const needle of banned) {
      if (entry.command.includes(needle)) {
        offenders.push(`${entry.event}/${entry.matcher}: ${needle}`);
      }
    }
  }
  assert.deepStrictEqual(offenders, [], `hook commands should not rebuild a resolver inline`);
});

test('every hook command launches a script under the plugin root token', () => {
  const offenders = [];
  for (const entry of HOOK_COMMANDS) {
    const match = entry.command.match(/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/);
    if (!match) {
      offenders.push(`${entry.event}/${entry.matcher}: ${entry.command.slice(0, 60)}`);
    }
  }
  assert.deepStrictEqual(offenders, [], 'each command should be a direct node invocation of a launcher');
});

test('every launcher and hook script a command names exists in the repo', () => {
  const missing = [];
  for (const entry of HOOK_COMMANDS) {
    const referenced = entry.command.match(/(?:\$\{CLAUDE_PLUGIN_ROOT\}\/)?scripts\/hooks\/[A-Za-z0-9._-]+\.js/g) || [];
    for (const relPath of referenced) {
      const clean = relPath.replace(`${PLUGIN_ROOT_TOKEN}/`, '');
      if (!fs.existsSync(path.join(REPO_ROOT, clean))) {
        missing.push(`${entry.event}/${entry.matcher} -> ${clean}`);
      }
    }
  }
  assert.deepStrictEqual(missing, [], 'hook commands must not reference scripts that do not ship');
});

// ---------------------------------------------------------------------------
// Group B: the real command path, through a real shell
// ---------------------------------------------------------------------------

if (SHELL_FORMS.length === 0) {
  skip('command path through a real shell', 'no supported shell available');
}

for (const form of SHELL_FORMS) {
  const label = `[${form.name}]`;

  test(`${label} bootstrap launcher runs from a foreign cwd with both root vars unset`, () => {
    const result = runHookCommand(form, bootstrapCommand('scripts/hooks/launcher-probe.js'));
    assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('PROBE_STDOUT:'), `expected the probe's stdout to reach the caller, got: ${JSON.stringify(result.stdout)}`);
  });

  test(`${label} bootstrap launcher delivers the hook event on stdin`, () => {
    const input = '{"session_id":"stdin-check","tool":"Bash"}';
    const result = runHookCommand(form, bootstrapCommand('scripts/hooks/launcher-probe.js'), { input });
    assert.ok(result.stdout.includes(input), `expected stdin to be forwarded verbatim, got: ${JSON.stringify(result.stdout)}`);
  });

  test(`${label} bootstrap launcher preserves the target's stderr`, () => {
    const result = runHookCommand(form, bootstrapCommand('scripts/hooks/launcher-probe.js'), {
      env: { PROBE_TAG: 'tagged' }
    });
    assert.ok(result.stderr.includes('PROBE_STDERR:tagged'), `expected the probe's stderr to reach the caller, got: ${JSON.stringify(result.stderr)}`);
  });

  test(`${label} bootstrap launcher preserves a non-zero exit status`, () => {
    const result = runHookCommand(form, bootstrapCommand('scripts/hooks/launcher-probe.js'), {
      env: { PROBE_EXIT: '2' }
    });
    // Exit 2 is how a PreToolUse hook blocks a tool call; collapsing it to 0
    // would silently disable every blocking hook.
    assert.strictEqual(result.status, 2, `stderr: ${result.stderr}`);
  });

  test(`${label} bootstrap launcher still collapses a raw passthrough to empty stdout`, () => {
    const input = '{"session_id":"passthrough-check"}';
    const result = runHookCommand(form, bootstrapCommand('scripts/hooks/launcher-echo.js'), { input });
    assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
    assert.strictEqual(result.stdout, '', `a target echoing the raw event should not be re-emitted, got: ${JSON.stringify(result.stdout)}`);
  });

  test(`${label} bootstrap launcher ignores a whitespace-only CLAUDE_PLUGIN_ROOT`, () => {
    // A harness that exports the variable but leaves it blank must not defeat
    // the launcher's ability to locate itself.
    const result = runHookCommand(form, bootstrapCommand('scripts/hooks/launcher-probe.js'), {
      keepRootVars: true,
      env: { CLAUDE_PLUGIN_ROOT: '   ', ECC_PLUGIN_ROOT: undefined }
    });
    assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('PROBE_STDOUT:'), `expected the launcher to fall back to its own directory, got stdout ${JSON.stringify(result.stdout)} stderr ${JSON.stringify(result.stderr)}`);
  });

  test(`${label} bootstrap launcher honours ECC_PLUGIN_ROOT when CLAUDE_PLUGIN_ROOT is absent`, () => {
    // The launcher is invoked out of PACKAGED_ROOT but told the plugin root is
    // ALTERNATE_ROOT, so resolving the target against the variable and
    // resolving it against __dirname give different answers.
    const result = runHookCommand(form, bootstrapCommand('scripts/hooks/launcher-probe.js'), {
      keepRootVars: true,
      env: { CLAUDE_PLUGIN_ROOT: undefined, ECC_PLUGIN_ROOT: ALTERNATE_ROOT }
    });
    assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('ALT_STDOUT:'), `expected the target to resolve under ECC_PLUGIN_ROOT, got stdout ${JSON.stringify(result.stdout)} stderr ${JSON.stringify(result.stderr)}`);
  });

  test(`${label} run-with-flags launcher runs from a foreign cwd with both root vars unset`, () => {
    const command = `node "${PLUGIN_ROOT_TOKEN}/scripts/hooks/run-with-flags.js" test:launcher-probe scripts/hooks/launcher-probe.js minimal,standard,strict`;
    const result = runHookCommand(form, command);
    assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes('PROBE_STDOUT:') || result.stderr.includes('PROBE_STDERR:'),
      `expected run-with-flags to locate and run its target, got stdout ${JSON.stringify(result.stdout)} stderr ${JSON.stringify(result.stderr)}`
    );
  });

  test(`${label} run-with-flags launcher honours ECC_PLUGIN_ROOT`, () => {
    // run-with-flags.js exports ECC_PLUGIN_ROOT for the scripts it spawns, so
    // a hook that re-enters a launcher must be able to read it back. Resolving
    // only CLAUDE_PLUGIN_ROOT drops that escape hatch silently.
    const command = `node "${PLUGIN_ROOT_TOKEN}/scripts/hooks/run-with-flags.js" test:launcher-probe scripts/hooks/launcher-probe.js minimal,standard,strict`;
    const result = runHookCommand(form, command, {
      keepRootVars: true,
      env: { CLAUDE_PLUGIN_ROOT: undefined, ECC_PLUGIN_ROOT: ALTERNATE_ROOT }
    });
    assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes('ALT_STDOUT:') || result.stderr.includes('ALT_STDERR:'),
      `expected the target to resolve under ECC_PLUGIN_ROOT, got stdout ${JSON.stringify(result.stdout)} stderr ${JSON.stringify(result.stderr)}`
    );
  });

  test(`${label} run-with-flags launcher ignores a whitespace-only CLAUDE_PLUGIN_ROOT`, () => {
    const command = `node "${PLUGIN_ROOT_TOKEN}/scripts/hooks/run-with-flags.js" test:launcher-probe scripts/hooks/launcher-probe.js minimal,standard,strict`;
    const result = runHookCommand(form, command, {
      keepRootVars: true,
      env: { CLAUDE_PLUGIN_ROOT: ' ', ECC_PLUGIN_ROOT: undefined }
    });
    assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes('PROBE_STDOUT:') || result.stderr.includes('PROBE_STDERR:'),
      `expected the launcher to fall back to its own directory, got stdout ${JSON.stringify(result.stdout)} stderr ${JSON.stringify(result.stderr)}`
    );
  });

  test(`${label} run-with-flags launcher preserves the target's stderr and exit status`, () => {
    // A Stop or PreToolUse hook signals refusal through its exit code; the
    // launcher collapsing it to 0 would disable every blocking hook silently.
    const command = `node "${PLUGIN_ROOT_TOKEN}/scripts/hooks/run-with-flags.js" test:launcher-probe scripts/hooks/launcher-probe.js minimal,standard,strict`;
    const result = runHookCommand(form, command, {
      env: { PROBE_EXIT: '2', PROBE_TAG: 'runner' }
    });
    assert.strictEqual(result.status, 2, `expected the child's exit status to survive, got ${result.status}; stderr: ${result.stderr}`);
    assert.ok(result.stderr.includes('PROBE_STDERR:runner'), `expected the child's stderr to survive, got ${JSON.stringify(result.stderr)}`);
  });

  test(`${label} run-with-flags launcher captures a multi-megabyte hook stdout intact`, () => {
    // The inline Stop wrapper this launcher replaced captured child output
    // with maxBuffer: 16 * 1024 * 1024. spawnSync defaults to 1 MB, so a hook
    // emitting more than that would be truncated and reported as a failure.
    const bulkBytes = 2 * 1024 * 1024;
    const command = `node "${PLUGIN_ROOT_TOKEN}/scripts/hooks/run-with-flags.js" test:launcher-bulk scripts/hooks/launcher-bulk.js minimal,standard,strict`;
    const result = runHookCommand(form, command, { env: { BULK_BYTES: String(bulkBytes) } });
    assert.strictEqual(result.status, 0, `stderr: ${result.stderr.slice(0, 300)}`);
    assert.strictEqual(result.stdout.length, bulkBytes, `expected ${bulkBytes} bytes of hook stdout to survive the launcher, got ${result.stdout.length}; stderr: ${result.stderr.slice(0, 300)}`);
  });

  test(`${label} posttooluse dispatcher launcher runs from a foreign cwd with both root vars unset`, () => {
    const command = `node "${PLUGIN_ROOT_TOKEN}/scripts/hooks/posttooluse-dispatcher.js" sync --passthrough`;
    const result = runHookCommand(form, command, {
      input: '{"session_id":"dispatcher-check","tool":"Read","tool_input":{},"tool_response":{}}'
    });
    assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  });

  test(`${label} posttooluse dispatcher launcher ignores a whitespace-only CLAUDE_PLUGIN_ROOT`, () => {
    const command = `node "${PLUGIN_ROOT_TOKEN}/scripts/hooks/posttooluse-dispatcher.js" sync --passthrough`;
    const result = runHookCommand(form, command, {
      keepRootVars: true,
      env: { CLAUDE_PLUGIN_ROOT: '  ', ECC_PLUGIN_ROOT: undefined },
      input: '{"session_id":"dispatcher-check","tool":"Read","tool_input":{},"tool_response":{}}'
    });
    assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  });
}

// ---------------------------------------------------------------------------

cleanupTempDirs();

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (skipped) console.log(`Skipped: ${skipped}`);

process.exit(failed > 0 ? 1 : 0);
