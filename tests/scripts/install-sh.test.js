/**
 * Tests for install.sh wrapper delegation and owned child lifecycle.
 * --lifecycle-only runs inert Node fixtures without invoking an installer/shell.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'install.sh');
const CHILD_LIMITS = Object.freeze({ timeout: 10000, termGrace: 100, closeGrace: 500, maxBytes: 1024 * 1024 });
const FIXTURE_LIMITS = Object.freeze({ ...CHILD_LIMITS, maxBytes: 65536 });
const STALL_LIMITS = Object.freeze({ ...FIXTURE_LIMITS, timeout: 500 });
const CHILD_PATH = [path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter);

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function finishCleanup(dirs, failed, primary, remove = cleanup) {
  const errors = [];
  for (const dir of dirs) {
    try { remove(dir); } catch (error) { errors.push(error); }
  }
  if (failed) {
    if (errors.length) console.error(`Fixture cleanup also failed (${errors.length} errors)`);
    throw primary; // Includes falsy thrown values; cleanup cannot replace them.
  }
  if (errors.length) throw new AggregateError(errors, 'Fixture cleanup failed');
}

async function withTempDirs(prefixes, fn) {
  const dirs = [];
  let failed = false;
  let primary;
  let value;
  try {
    for (const prefix of prefixes) dirs.push(createTempDir(prefix));
    value = await fn(...dirs);
  } catch (error) {
    failed = true;
    primary = error;
  }
  finishCleanup(dirs, failed, primary);
  return value;
}

function privateEnvironment(root, homeDir, overrides = {}) {
  const home = homeDir || path.join(root, 'home');
  const temp = path.join(root, 'tmp');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(temp, { recursive: true });
  return {
    PATH: CHILD_PATH, HOME: home, USERPROFILE: home,
    TMPDIR: temp, TMP: temp, TEMP: temp, LANG: 'C', LC_ALL: 'C',
    ...overrides,
  };
}

// Each invocation owns a new POSIX group. The deadline covers headers/output
// through 'close', even when a dead leader's descendant retains a pipe.
function runChild(binary, args, options, limits = CHILD_LIMITS) {
  return new Promise(resolve => {
    const started = Date.now();
    let child;
    let status = null;
    let signal = null;
    let spawnError = null;
    let exited = false;
    let closed = false;
    let settled = false;
    let terminating = false;
    let hardKillSent = false;
    let timedOut = false;
    let outputLimit = false;
    let forcedPipeClose = false;
    let bytes = 0;
    const stdout = [];
    const stderr = [];
    const signalErrors = [];
    const timers = [];
    const detached = process.platform !== 'win32';
    const later = (fn, ms) => { const timer = setTimeout(fn, ms); timers.push(timer); return timer; };
    const finish = () => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      const failed = terminating || spawnError || signal || forcedPipeClose || !closed;
      const code = failed ? (status || 1) : status;
      const result = {
        code, status, signal, errorCode: spawnError && spawnError.code,
        errorMessage: spawnError && spawnError.message,
        timedOut, outputLimit, forcedPipeClose, closed, reaped: exited,
        pid: child && child.pid, signalErrors, elapsedMs: Date.now() - started,
        stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'),
      };
      result.diagnostic = JSON.stringify({
        status, signal, errorCode: result.errorCode, timedOut, outputLimit,
        forcedPipeClose, closed, reaped: exited, signalErrors,
      });
      resolve(result);
    };
    const sendSignal = name => {
      if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return;
      try {
        if (detached) process.kill(-child.pid, name);
        else child.kill(name);
      } catch (error) {
        if (error.code !== 'ESRCH') signalErrors.push({ signal: name, code: error.code });
      }
    };
    const terminate = () => {
      if (terminating || settled) return;
      terminating = true;
      sendSignal('SIGTERM');
      later(() => {
        // Do not cancel escalation on leader exit or early pipe closure.
        sendSignal('SIGKILL');
        hardKillSent = true;
        if (closed) return finish();
        later(() => {
          forcedPipeClose = true;
          for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
          // An OS that cannot reap after SIGKILL is a reported failure, never a
          // successful flush. Do not leave its ChildProcess handle blocking us.
          child.unref();
          finish();
        }, limits.closeGrace);
      }, limits.termGrace);
    };
    const capture = target => data => {
      const remaining = limits.maxBytes - bytes;
      const part = data.subarray(0, Math.max(0, remaining));
      if (part.length) target.push(part);
      bytes += part.length;
      if (part.length !== data.length) {
        outputLimit = true;
        terminate();
      }
    };
    try {
      child = spawn(binary, args, { ...options, shell: false, detached, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      spawnError = error;
      finish();
      return;
    }
    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on('error', error => {
        if (stream === child.stdin && error.code === 'EPIPE') return;
        spawnError = spawnError || error;
        terminate();
      });
    }
    child.once('error', error => { spawnError = error; terminate(); });
    child.once('exit', (code, exitSignal) => { status = code; signal = exitSignal; exited = true; });
    child.once('close', (code, exitSignal) => {
      status = code;
      signal = exitSignal;
      closed = true;
      if (!terminating || hardKillSent) finish();
    });
    later(() => { timedOut = true; terminate(); }, limits.timeout);
    child.stdin.end();
  });
}

function classifyProbe(result) {
  if (result.errorCode === 'ENOENT' && !result.timedOut && !result.signal && !result.forcedPipeClose) return 'missing';
  if (result.timedOut || result.outputLimit || result.forcedPipeClose || result.errorCode || result.signal || !result.closed) {
    throw new Error(`Shell capability probe infrastructure failure: ${result.diagnostic}`);
  }
  if (result.code === 0) return 'supported';
  if (result.code === 127 && /\[\[: (?:not found|command not found)/.test(result.stderr)) return 'unsupported';
  throw new Error(`Unexpected shell capability probe failure: ${result.diagnostic}; ${result.stderr}`);
}

async function findPosixOnlyShell(runner = runChild) {
  return withTempDirs(['install-sh-probe-'], async root => {
    const env = privateEnvironment(root);
    const probeScript = path.join(root, 'probe.sh');
    fs.writeFileSync(probeScript, "eval '[[ 1 == 1 ]]'\n", { flag: 'wx', mode: 0o600 });
    for (const candidate of ['dash', 'sh']) {
      console.log(`  START shell capability probe: ${candidate}`);
      const result = await runner(candidate, [probeScript], { env });
      const capability = classifyProbe(result);
      console.log(`  END shell capability probe: ${candidate}: ${capability}`);
      if (capability === 'unsupported') return candidate;
    }
    return null;
  });
}

async function run(args = [], options = {}) {
  if (!options.scriptPath) {
    // Never let a real-source test enter install.sh's network bootstrap path.
    assert.ok(fs.statSync(path.join(path.dirname(SCRIPT), 'node_modules')).isDirectory(),
      'Installer source tests require already installed repository dependencies; no bootstrap is allowed');
  }
  return withTempDirs(['install-sh-env-'], async root => {
    const result = await runChild(options.shell || 'bash', [options.scriptPath || SCRIPT, ...args], {
      cwd: options.cwd,
      env: privateEnvironment(root, options.homeDir, options.env),
    });
    if (result.code !== 0) result.stderr += `\nChild failure: ${result.diagnostic}`;
    return result;
  });
}

async function test(name, fn) {
  console.log(`  START ${name}`);
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error && error.message ? error.message : String(error)}`);
    return false;
  }
}

async function inertChild(runner, source, args = [], limits = FIXTURE_LIMITS) {
  return withTempDirs(['install-sh-child-'], async root => {
    const script = path.join(root, 'child.js');
    fs.writeFileSync(script, source);
    return runner(process.execPath, [script, ...args], { cwd: root, env: privateEnvironment(root) }, limits);
  });
}

async function assertGone(pid) {
  assert.ok(Number.isInteger(pid) && pid > 0, 'fixture must identify its owned process');
  for (let attempt = 0; attempt < 25; attempt++) {
    try { process.kill(pid, 0); } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`owned fixture process ${pid} survived cleanup`);
}

function lifecycleCases(runner = runChild, probe = classifyProbe, finish = finishCleanup, findProbe = findPosixOnlyShell) {
  return [
    ['inert child preserves stdout, stderr, arguments and stdin EOF', async () => {
      const result = await inertChild(runner,
        "process.stdout.write('out:' + process.argv[2]); process.stderr.write('warning'); process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(':EOF'));",
        ['literal argument']);
      assert.strictEqual(result.code, 0, result.diagnostic);
      assert.strictEqual(result.stdout, 'out:literal argument:EOF');
      assert.strictEqual(result.stderr, 'warning');
      assert.strictEqual(result.closed, true);
      assert.strictEqual(result.reaped, true);
    }],
    ['nonzero inert child preserves exact status and partial output', async () => {
      const result = await inertChild(runner, "process.stdout.write('partial'); process.stderr.write('failure'); process.exitCode = 7;");
      assert.strictEqual(result.code, 7);
      assert.strictEqual(result.status, 7);
      assert.strictEqual(result.stdout, 'partial');
      assert.strictEqual(result.stderr, 'failure');
    }],
    ['missing executable remains unavailable rather than a supported capability', async () => {
      await withTempDirs(['install-sh-missing-'], async root => {
        const result = await runner(path.join(root, 'absent-binary'), [], { env: privateEnvironment(root) }, FIXTURE_LIMITS);
        assert.strictEqual(result.errorCode, 'ENOENT');
        assert.strictEqual(probe(result), 'missing');
        assert.notStrictEqual(result.code, 0);
      });
    }],
    ['signal termination remains an infrastructure failure', async () => {
      const result = await inertChild(runner, "process.kill(process.pid, 'SIGTERM');");
      assert.strictEqual(result.signal, 'SIGTERM');
      assert.notStrictEqual(result.code, 0);
      assert.throws(() => probe(result), /infrastructure failure/);
    }],
    ['ignored SIGTERM is escalated and the owned leader is reaped', async () => {
      const result = await inertChild(runner,
        "process.on('SIGTERM', () => {}); console.log(process.pid); setInterval(() => {}, 1000);", [], STALL_LIMITS);
      assert.strictEqual(result.timedOut, true);
      assert.strictEqual(result.signal, 'SIGKILL');
      assert.strictEqual(result.reaped, true);
      assert.strictEqual(result.forcedPipeClose, false);
      assert.notStrictEqual(result.code, 0);
      assert.ok(result.elapsedMs < 2000, result.diagnostic);
      await assertGone(Number(result.stdout.trim()));
    }],
    ['leader exit cannot hide an owned descendant retaining captured pipes', async () => {
      const descendant = "process.on('SIGTERM', () => {}); process.send('ready'); process.disconnect(); setInterval(() => {}, 1000);";
      const source = "const { spawn } = require('child_process'); const child = spawn(process.execPath, ['-e', " + JSON.stringify(descendant) + "], { stdio: ['ignore', 1, 2, 'ipc'] }); child.once('message', () => { console.log(child.pid); process.exit(0); });";
      const result = await inertChild(runner, source, [], STALL_LIMITS);
      assert.strictEqual(result.status, 0, 'the leader exits successfully before the deadline');
      assert.strictEqual(result.timedOut, true);
      assert.notStrictEqual(result.code, 0);
      assert.strictEqual(result.closed, true);
      assert.strictEqual(result.forcedPipeClose, false);
      assert.ok(result.elapsedMs < 2000, result.diagnostic);
      await assertGone(Number(result.stdout.trim()));
    }],
    ['captured output is capped and overflow fails', async () => {
      const result = await inertChild(runner, "process.stdout.write('x'.repeat(131072));");
      assert.strictEqual(result.outputLimit, true);
      assert.notStrictEqual(result.code, 0);
      assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= FIXTURE_LIMITS.maxBytes);
    }],
    ['a stalled capability probe fails instead of selecting or skipping a shell', async () => {
      const result = await inertChild(runner, "console.log('probe started'); setInterval(() => {}, 1000);", [], STALL_LIMITS);
      assert.strictEqual(result.timedOut, true);
      assert.ok(result.stdout.includes('probe started'));
      assert.throws(() => probe(result), /infrastructure failure/);
    }],
    ['probe classification accepts only known capability outcomes', () => {
      const complete = { code: 0, closed: true, stderr: '', diagnostic: 'synthetic probe' };
      assert.strictEqual(probe(complete), 'supported');
      assert.strictEqual(probe({ ...complete, code: 127, stderr: 'dash: 1: eval: [[: not found\n' }), 'unsupported');
      assert.strictEqual(probe({ ...complete, code: 127, stderr: 'sh: [[: command not found\n' }), 'unsupported');
      for (const result of [
        { ...complete, code: 2, stderr: 'syntax error' },
        { ...complete, code: 127, stderr: 'other command not found' },
        { ...complete, errorCode: 'EACCES' },
        { ...complete, signal: 'SIGKILL' },
        { ...complete, timedOut: true },
        { ...complete, outputLimit: true },
        { ...complete, forcedPipeClose: true },
        { ...complete, closed: false },
      ]) assert.throws(() => probe(result), /failure/);
    }],
    ['cleanup attempts every owned root and preserves falsy primary errors', () => {
      for (const primary of [undefined, null, false, 0, '']) {
        const attempts = [];
        let threw = false;
        try {
          finish(['first', 'second'], true, primary, dir => {
            attempts.push(dir);
            if (dir === 'first') throw new Error('synthetic cleanup failure');
          });
        } catch (error) {
          threw = true;
          assert.strictEqual(error, primary);
        }
        assert.strictEqual(threw, true);
        assert.deepStrictEqual(attempts, ['first', 'second']);
      }
    }],
    ['cleanup-only failures remain failures after all roots are attempted', () => {
      const attempts = [];
      assert.throws(() => finish(['first', 'second'], false, undefined, dir => {
        attempts.push(dir);
        throw new Error('synthetic cleanup failure');
      }), error => error instanceof AggregateError && error.errors.length === 2);
      assert.deepStrictEqual(attempts, ['first', 'second']);
    }],
    ['shell capability probe passes a private source file as one literal argument', async () => {
      const observed = [];
      const result = await findProbe(async (binary, args, options) => {
        assert.strictEqual(args.length, 1, 'probe source must be a file argument');
        assert.ok(path.isAbsolute(args[0]));
        assert.strictEqual(fs.readFileSync(args[0], 'utf8'), "eval '[[ 1 == 1 ]]'\n");
        assert.strictEqual(fs.statSync(args[0]).mode & 0o777, 0o600);
        assert.ok(options.env.HOME.startsWith(path.dirname(args[0]) + path.sep));
        observed.push({ binary, source: args[0] });
        return binary === 'dash'
          ? { code: 1, errorCode: 'ENOENT', closed: true, stderr: '' }
          : { code: 127, closed: true, stderr: 'sh: [[: not found\n', diagnostic: 'fixed probe' };
      });
      assert.strictEqual(result, 'sh');
      assert.deepStrictEqual(observed.map(item => item.binary), ['dash', 'sh']);
      assert.strictEqual(observed[0].source, observed[1].source);
      assert.strictEqual(fs.existsSync(path.dirname(observed[0].source)), false);
    }],
    ['shell capability infrastructure failure stops probing and removes its source', async () => {
      const observed = [];
      await assert.rejects(findProbe(async (binary, args) => {
        assert.strictEqual(args.length, 1, 'probe source must be a file argument');
        assert.strictEqual(fs.readFileSync(args[0], 'utf8'), "eval '[[ 1 == 1 ]]'\n");
        observed.push({ binary, source: args[0] });
        return { code: 1, timedOut: true, closed: true, diagnostic: 'fixed timed-out probe' };
      }), /infrastructure failure/);
      assert.strictEqual(observed.length, 1, 'do not select another shell after infrastructure failure');
      assert.strictEqual(observed[0].binary, 'dash');
      assert.strictEqual(fs.existsSync(path.dirname(observed[0].source)), false);
    }],
    ['child environment contains only private roots and explicit runtime settings', async () => {
      await withTempDirs(['install-sh-env-control-'], async root => {
        const env = privateEnvironment(root);
        assert.deepStrictEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE'].sort());
        for (const key of ['HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR']) assert.ok(env[key].startsWith(root + path.sep));
        assert.strictEqual(env.PATH, CHILD_PATH);
      });
    }],
  ];
}

async function runLifecycleTests(setExit = true) {
  let passed = 0;
  let failed = 0;
  for (const [name, fn] of lifecycleCases()) {
    if (await test(name, fn)) passed++; else failed++;
  }
  if (setExit) console.log(`Lifecycle results: Passed: ${passed}, Failed: ${failed}`);
  if (setExit) process.exitCode = failed ? 1 : 0;
  return { passed, failed };
}

async function runTests() {
  console.log('\n=== Testing install.sh ===\n');

  let passed = 0;
  let failed = 0;

  if (process.platform === 'win32') {
    console.log('  - skipped on Windows; install.ps1 covers the native wrapper path');
    console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
    process.exitCode = 0;
    return;
  }

  if (process.argv.includes('--lifecycle-only')) return runLifecycleTests();

  if (await test('delegates to the Node installer and preserves dry-run output', async () => {
    await withTempDirs(['install-sh-home-', 'install-sh-project-'], async (homeDir, projectDir) => {

      const result = await run(['--target', 'cursor', '--dry-run', 'typescript'], {
        cwd: projectDir,
        homeDir,
      });

      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Dry-run install plan'));
      assert.ok(!fs.existsSync(path.join(projectDir, '.cursor', 'hooks.json')));
    });
  })) passed++; else failed++;

  if (await test('absolute wrapper bootstraps a fresh source while preserving the target project cwd', async () => {
    await withTempDirs(['install-sh-source-', 'install-sh-target-'], async (sourceDir, projectDir) => {
      const binDir = path.join(sourceDir, 'test-bin');
      const scriptsDir = path.join(sourceDir, 'scripts');
      const npmCwdPath = path.join(sourceDir, 'npm-cwd.txt');
      const fixtureScript = path.join(sourceDir, 'install.sh');

      fs.mkdirSync(binDir, { recursive: true });
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.copyFileSync(SCRIPT, fixtureScript);
      fs.writeFileSync(
        path.join(binDir, 'npm'),
        `#!/usr/bin/env bash\nset -euo pipefail\nmkdir -p "$PWD/node_modules"\nprintf '%s\\n' "$PWD" > "$ECC_TEST_NPM_CWD"\n`,
        { mode: 0o755 }
      );
      fs.writeFileSync(
        path.join(scriptsDir, 'install-apply.js'),
        'console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));\n'
      );

      const result = await run(['--target', 'antigravity', '--dry-run', 'typescript'], {
        cwd: projectDir,
        scriptPath: fixtureScript,
        env: {
          ECC_TEST_NPM_CWD: npmCwdPath,
          PATH: `${binDir}${path.delimiter}${CHILD_PATH}`,
        },
      });

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = JSON.parse(result.stdout.trim().split('\n').at(-1));
      assert.strictEqual(payload.cwd, fs.realpathSync(projectDir));
      assert.deepStrictEqual(payload.args, ['--target', 'antigravity', '--dry-run', 'typescript']);
      assert.strictEqual(fs.readFileSync(npmCwdPath, 'utf8').trim(), sourceDir);
      assert.ok(fs.existsSync(path.join(sourceDir, 'node_modules')));
    });
  })) passed++; else failed++;

  if (await test('delegates to the Node installer when invoked via a POSIX sh wrapper', async () => {
    await withTempDirs(['install-sh-posix-source-', 'install-sh-posix-target-'], async (sourceDir, projectDir) => {
      const scriptsDir = path.join(sourceDir, 'scripts');
      const fixtureScript = path.join(sourceDir, 'install.sh');

      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.mkdirSync(path.join(sourceDir, 'node_modules'), { recursive: true });
      fs.copyFileSync(SCRIPT, fixtureScript);
      fs.writeFileSync(
        path.join(scriptsDir, 'install-apply.js'),
        'console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));\n'
      );

      const result = await run(['--target', 'antigravity', '--dry-run', 'typescript'], {
        cwd: projectDir,
        scriptPath: fixtureScript,
        shell: 'sh',
      });

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = JSON.parse(result.stdout.trim().split('\n').at(-1));
      assert.strictEqual(payload.cwd, fs.realpathSync(projectDir));
      assert.deepStrictEqual(payload.args, ['--target', 'antigravity', '--dry-run', 'typescript']);
    });
  })) passed++; else failed++;

  const posixOnlyShell = await findPosixOnlyShell();
  if (!posixOnlyShell) {
    console.log(
      '  - skipped: re-execs into bash under sh even when BASH_VERSION is spoofed in the environment ' +
        '(no shell without `[[` support was found on this system)'
    );
  } else if (await test('re-execs into bash under sh even when BASH_VERSION is spoofed in the environment', async () => {
    await withTempDirs(['install-sh-spoof-source-', 'install-sh-spoof-target-'], async (sourceDir, projectDir) => {
      const scriptsDir = path.join(sourceDir, 'scripts');
      const fixtureScript = path.join(sourceDir, 'install.sh');

      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.mkdirSync(path.join(sourceDir, 'node_modules'), { recursive: true });
      fs.copyFileSync(SCRIPT, fixtureScript);
      fs.writeFileSync(
        path.join(scriptsDir, 'install-apply.js'),
        'console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));\n'
      );

      const result = await run(['--target', 'antigravity', '--dry-run', 'typescript'], {
        cwd: projectDir,
        scriptPath: fixtureScript,
        shell: posixOnlyShell,
        env: { BASH_VERSION: '9.9.9(1)-spoofed' },
      });

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = JSON.parse(result.stdout.trim().split('\n').at(-1));
      assert.deepStrictEqual(payload.args, ['--target', 'antigravity', '--dry-run', 'typescript']);
    });
  })) passed++; else failed++;

  if (await test('exposes the corrected Claude target help text', async () => {
    const result = await run(['--help']);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(
      result.stdout.includes('claude       (default) - Install ECC into ~/.claude/'),
      'help text should describe the Claude target as a full ~/.claude install surface'
    );
  })) passed++; else failed++;

  const lifecycle = await runLifecycleTests(false);
  passed += lifecycle.passed;
  failed += lifecycle.failed;
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = 1; // A never-settling Promise must not silently exit successfully.
  runTests().catch(error => console.error(error && error.stack ? error.stack : String(error)));
}

module.exports = { runChild, classifyProbe, finishCleanup, lifecycleCases, runLifecycleTests };
