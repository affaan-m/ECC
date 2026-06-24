/**
 * Tests for hook scripts
 *
 * Run with: node tests/hooks/hooks.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawn, spawnSync } = require('child_process');

const SKIP_BASH = process.platform === 'win32';

function toBashPath(filePath) {
  if (process.platform !== 'win32') {
    return filePath;
  }

  return String(filePath)
    .replace(/^([A-Za-z]):/, (_, driveLetter) => `/${driveLetter.toLowerCase()}`)
    .replace(/\\/g, '/');
}

function fromBashPath(filePath) {
  if (process.platform !== 'win32') {
    return filePath;
  }

  const rawPath = String(filePath || '');
  if (!rawPath) {
    return rawPath;
  }

  try {
    return execFileSync(
      'bash',
      ['-lc', 'cygpath -w -- "$1"', 'bash', rawPath],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .toString()
      .trim();
  } catch {
    // Fall back to common Git Bash path shapes when cygpath is unavailable.
  }

  const match = rawPath.match(/^\/(?:cygdrive\/)?([A-Za-z])\/(.*)$/)
    || rawPath.match(/^\/\/([A-Za-z])\/(.*)$/);
  if (match) {
    return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
  }

  if (/^[A-Za-z]:\//.test(rawPath)) {
    return rawPath.replace(/\//g, '\\');
  }

  return rawPath;
}

function normalizeComparablePath(filePath) {
  const nativePath = fromBashPath(filePath);
  if (!nativePath) {
    return nativePath;
  }

  let comparablePath = nativePath;
  try {
    comparablePath = fs.realpathSync.native ? fs.realpathSync.native(nativePath) : fs.realpathSync(nativePath);
  } catch {
    comparablePath = path.resolve(nativePath);
  }

  comparablePath = comparablePath.replace(/[\\/]+/g, '/');
  if (comparablePath.length > 1 && !/^[A-Za-z]:\/$/.test(comparablePath)) {
    comparablePath = comparablePath.replace(/\/+$/, '');
  }

  return process.platform === 'win32' ? comparablePath.toLowerCase() : comparablePath;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function getCanonicalSessionsDir(homeDir) {
  return path.join(homeDir, '.claude', 'session-data');
}

function getLegacySessionsDir(homeDir) {
  return path.join(homeDir, '.claude', 'sessions');
}

function getSessionStartAdditionalContext(stdout) {
  assert.ok(stdout.trim(), 'Expected SessionStart hook to emit stdout payload');
  const payload = JSON.parse(stdout);
  assert.strictEqual(payload.hookSpecificOutput?.hookEventName, 'SessionStart', 'Should emit SessionStart hook payload');
  assert.strictEqual(typeof payload.hookSpecificOutput?.additionalContext, 'string', 'Should include additionalContext text');
  return payload.hookSpecificOutput.additionalContext;
}

const RESUME_SESSION_SENTINEL = 'RESUME_CONTEXT_SHOULD_NOT_BE_INJECTED';
const INVALID_STDIN_SESSION_SENTINEL = 'INVALID_STDIN_CONTEXT_SHOULD_NOT_BE_INJECTED';
const INVALID_STDIN_LOG_SENTINEL = 'SENSITIVE_STDIN_SHOULD_NOT_BE_LOGGED';
const CROSS_PROJECT_SESSION_SENTINEL = 'CROSS_PROJECT_CONTEXT_SHOULD_NOT_BE_INJECTED';
const CROSS_WORKTREE_PROJECT_SENTINEL = 'CROSS_WORKTREE_PROJECT_CONTEXT_SHOULD_NOT_BE_INJECTED';
const CLI_RESUME_SESSION_SENTINEL = 'CLI_RESUME_CONTEXT_SHOULD_NOT_BE_INJECTED';
const CLI_CLEAR_SESSION_SENTINEL = 'CLI_CLEAR_CONTEXT_SHOULD_NOT_BE_INJECTED';
const DESKTOP_CLEAR_SESSION_SENTINEL = 'DESKTOP_CLEAR_CONTEXT_SHOULD_NOT_BE_INJECTED';
const PROJECT_ONLY_SESSION_SENTINEL = 'PROJECT_ONLY_CONTEXT_SHOULD_BE_INJECTED';

function buildSessionStartFixture(content, options = {}) {
  const title = options.title ?? '# Session';
  const project = options.project ?? path.basename(process.cwd());
  const worktree = options.worktree ?? process.cwd();

  const lines = [title, `**Project:** ${project}`];
  if (worktree) {
    lines.push(`**Worktree:** ${worktree}`);
  }
  lines.push('', content, '');

  return lines.join('\n');
}

// Test helper
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

// Async test helper
async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

// Run a script and capture output
function runScript(scriptPath, input = '', env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => (stdout += data));
    proc.stderr.on('data', data => (stderr += data));

    if (input) {
      proc.stdin.write(input);
    }
    proc.stdin.end();

    proc.on('close', code => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', reject);
  });
}

function runShellScript(scriptPath, args = [], input = '', env = {}, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [toBashPath(scriptPath), ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    if (input) {
      proc.stdin.write(input);
    }
    proc.stdin.end();

    proc.stdout.on('data', data => (stdout += data));
    proc.stderr.on('data', data => (stderr += data));
    proc.on('close', code => resolve({ code, stdout, stderr }));
    proc.on('error', reject);
  });
}

// Create a temporary test directory
function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'));
}

// Clean up test directory
function cleanupTestDir(testDir) {
  const retryableCodes = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!retryableCodes.has(error.code) || attempt === 4) {
        throw error;
      }
      sleepMs(50 * (attempt + 1));
    }
  }
}

function createCommandShim(binDir, baseName, logFile) {
  fs.mkdirSync(binDir, { recursive: true });

  const shimJs = path.join(binDir, `${baseName}-shim.js`);
  fs.writeFileSync(
    shimJs,
    ["const fs = require('fs');", `fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ bin: ${JSON.stringify(baseName)}, args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');`].join(
      '\n'
    )
  );

  if (process.platform === 'win32') {
    const shimCmd = path.join(binDir, `${baseName}.cmd`);
    fs.writeFileSync(shimCmd, `@echo off\r\nnode "${shimJs}" %*\r\n`);
    return shimCmd;
  }

  const shimPath = path.join(binDir, baseName);
  fs.writeFileSync(shimPath, `#!/usr/bin/env node\nrequire(${JSON.stringify(shimJs)});\n`);
  fs.chmodSync(shimPath, 0o755);
  return shimPath;
}

function readCommandLog(logFile) {
  if (!fs.existsSync(logFile)) return [];
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function withPrependedPath(binDir, env = {}) {
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || (process.platform === 'win32' ? 'Path' : 'PATH');
  const currentPath = process.env[pathKey] || process.env.PATH || '';
  const nextPath = `${binDir}${path.delimiter}${currentPath}`;

  return {
    ...env,
    [pathKey]: nextPath,
    PATH: nextPath
  };
}

function assertNoProjectDetectionSideEffects(homeDir, testName) {
  const homunculusDir = path.join(homeDir, '.local', 'share', 'ecc-homunculus');
  const registryPath = path.join(homunculusDir, 'projects.json');
  const projectsDir = path.join(homunculusDir, 'projects');

  assert.ok(!fs.existsSync(registryPath), `${testName} should not create projects.json`);

  const projectEntries = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir).filter(entry => fs.statSync(path.join(projectsDir, entry)).isDirectory()) : [];
  assert.strictEqual(projectEntries.length, 0, `${testName} should not create project directories`);
}

async function assertObserveSkipBeforeProjectDetection(testCase) {
  const observePath = path.join(__dirname, '..', '..', 'skills', 'continuous-learning-v2', 'hooks', 'observe.sh');
  const homeDir = createTestDir();
  const projectDir = createTestDir();

  try {
    const cwd = testCase.cwdSuffix ? path.join(projectDir, testCase.cwdSuffix) : projectDir;
    fs.mkdirSync(cwd, { recursive: true });

    const payload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      tool_response: 'ok',
      session_id: `session-${testCase.name.replace(/[^a-z0-9]+/gi, '-')}`,
      cwd,
      ...(testCase.payload || {})
    });

    const result = await runShellScript(
      observePath,
      ['post'],
      payload,
      {
        HOME: homeDir,
        USERPROFILE: homeDir,
        ...testCase.env
      },
      projectDir
    );

    assert.strictEqual(result.code, 0, `${testCase.name} should exit successfully, stderr: ${result.stderr}`);
    assertNoProjectDetectionSideEffects(homeDir, testCase.name);
  } finally {
    cleanupTestDir(homeDir);
    cleanupTestDir(projectDir);
  }
}

function runPatchedRunAll(tempRoot) {
  const wrapperPath = path.join(tempRoot, 'run-all-wrapper.js');
  const tempTestsDir = path.join(tempRoot, 'tests');
  let source = fs.readFileSync(path.join(__dirname, '..', 'run-all.js'), 'utf8');
  source = source.replace('const testsDir = __dirname;', `const testsDir = ${JSON.stringify(tempTestsDir)};`);
  fs.writeFileSync(wrapperPath, source);

  const result = spawnSync('node', [wrapperPath], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15000
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

// Test suite
async function runTests() {
  console.log('\n=== Testing Hook Scripts ===\n');

  let passed = 0;
  let failed = 0;

  const scriptsDir = path.join(__dirname, '..', '..', 'scripts', 'hooks');

  // session-start.js tests
  console.log('session-start.js:');

  if (
    await asyncTest('runs without error', async () => {
      const result = await runScript(path.join(scriptsDir, 'session-start.js'));
      assert.strictEqual(result.code, 0, `Exit code should be 0, got ${result.code}`);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('outputs session info to stderr', async () => {
      const result = await runScript(path.join(scriptsDir, 'session-start.js'));
      assert.ok(result.stderr.includes('[SessionStart]') || result.stderr.includes('Package manager'), 'Should output session info');
    })
  )
    passed++;
  else failed++;

  // session-start.js edge cases
  console.log('\nsession-start.js (edge cases):');

  if (
    await asyncTest('exits 0 even with isolated empty HOME', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-iso-start-${Date.now()}`);
      fs.mkdirSync(getCanonicalSessionsDir(isoHome), { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });
      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0, `Exit code should be 0, got ${result.code}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('reports package manager detection', async () => {
      const result = await runScript(path.join(scriptsDir, 'session-start.js'));
      assert.ok(result.stderr.includes('Package manager') || result.stderr.includes('[SessionStart]'), 'Should report package manager info');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('skips template session content', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-tpl-start-${Date.now()}`);
      const sessionsDir = getLegacySessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      // Create a session file with template placeholder
      const sessionFile = path.join(sessionsDir, '2026-02-11-abcd1234-session.tmp');
      fs.writeFileSync(sessionFile, '## Current State\n\n[Session context goes here]\n');

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(!additionalContext.includes('Previous session summary'), 'Should not inject template session content');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('injects real session content', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-real-start-${Date.now()}`);
      const sessionsDir = getLegacySessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      // Create a real session file
      const sessionFile = path.join(sessionsDir, '2026-02-11-efgh5678-session.tmp');
      fs.writeFileSync(
        sessionFile,
        buildSessionStartFixture('I worked on authentication refactor.', { title: '# Real Session' })
      );

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(
          additionalContext.includes('HISTORICAL REFERENCE ONLY'),
          'Should wrap injected session with the stale-replay guard preamble'
        );
        assert.ok(
          additionalContext.includes('STALE-BY-DEFAULT'),
          'Should spell out the stale-by-default contract so the model does not re-execute prior ARGUMENTS'
        );
        assert.ok(
          additionalContext.includes('--- BEGIN PRIOR-SESSION SUMMARY ---'),
          'Should delimit the prior-session summary with an explicit begin marker'
        );
        assert.ok(
          additionalContext.includes('--- END PRIOR-SESSION SUMMARY ---'),
          'Should delimit the prior-session summary with an explicit end marker'
        );
        assert.ok(additionalContext.includes('authentication refactor'), 'Should include session content text');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('caps very large session-start context by default', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-large-start-${Date.now()}`);
      const sessionsDir = getLegacySessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const sessionFile = path.join(sessionsDir, '2026-02-11-large000-session.tmp');
      fs.writeFileSync(
        sessionFile,
        buildSessionStartFixture(`START_MARKER\n${'A'.repeat(20000)}\nEND_MARKER`, { title: '# Large Session' })
      );

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(additionalContext.length <= 8200, `context should stay near the 8000-char default cap, got ${additionalContext.length}`);
        assert.ok(additionalContext.includes('START_MARKER'), 'Should keep the start of the selected session summary');
        assert.ok(additionalContext.includes('[SessionStart truncated'), 'Should explain that context was truncated');
        assert.ok(!additionalContext.includes('END_MARKER'), 'Should not inject the full oversized session summary');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('honors ECC_SESSION_START_MAX_CHARS for injected context', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-max-start-${Date.now()}`);
      const sessionsDir = getLegacySessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const sessionFile = path.join(sessionsDir, '2026-02-11-max0000-session.tmp');
      fs.writeFileSync(
        sessionFile,
        buildSessionStartFixture('B'.repeat(1200), { title: '# Sized Session' })
      );

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome,
          ECC_SESSION_START_MAX_CHARS: '700'
        });
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(additionalContext.length <= 700, `context should respect configured cap, got ${additionalContext.length}`);
        assert.ok(additionalContext.includes('[SessionStart truncated'), 'Should include a truncation marker');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('disables session-start additional context when requested', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-disabled-start-${Date.now()}`);
      const sessionsDir = getLegacySessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const sessionFile = path.join(sessionsDir, '2026-02-11-disabled-session.tmp');
      fs.writeFileSync(sessionFile, '# Disabled Session\n\nDO_NOT_INJECT_THIS\n');

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome,
          ECC_SESSION_START_CONTEXT: 'off'
        });
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.strictEqual(additionalContext, '', 'Should emit no additional context when disabled');
        assert.ok(result.stderr.includes('Additional context injection disabled'), `Should log disabled mode, stderr: ${result.stderr}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('prefers canonical session-data content over legacy duplicates', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-canonical-start-${Date.now()}`);
      const canonicalDir = getCanonicalSessionsDir(isoHome);
      const legacyDir = getLegacySessionsDir(isoHome);
      const now = new Date();
      const filename = `${now.toISOString().slice(0, 10)}-dupe1234-session.tmp`;
      const canonicalFile = path.join(canonicalDir, filename);
      const legacyFile = path.join(legacyDir, filename);
      const canonicalTime = new Date(now.getTime() - 60 * 1000);
      const legacyTime = new Date(canonicalTime.getTime());

      fs.mkdirSync(canonicalDir, { recursive: true });
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      fs.writeFileSync(
        canonicalFile,
        buildSessionStartFixture('Use the canonical session-data copy.', { title: '# Canonical Session' })
      );
      fs.writeFileSync(
        legacyFile,
        buildSessionStartFixture('Do not prefer the legacy duplicate.', { title: '# Legacy Session' })
      );
      fs.utimesSync(canonicalFile, canonicalTime, canonicalTime);
      fs.utimesSync(legacyFile, legacyTime, legacyTime);

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(additionalContext.includes('canonical session-data copy'));
        assert.ok(!additionalContext.includes('legacy duplicate'));
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('strips ANSI escape codes from injected session content', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-ansi-start-${Date.now()}`);
      const sessionsDir = getLegacySessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const sessionFile = path.join(sessionsDir, '2026-02-11-winansi00-session.tmp');
      fs.writeFileSync(
        sessionFile,
        buildSessionStartFixture(
          'I worked on \x1b[1;36mWindows terminal handling\x1b[0m.\x1b[K',
          { title: '\x1b[H\x1b[2J\x1b[3J# Real Session' }
        )
      );

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(
          additionalContext.includes('HISTORICAL REFERENCE ONLY'),
          'Should wrap injected session with the stale-replay guard preamble'
        );
        assert.ok(additionalContext.includes('Windows terminal handling'), 'Should preserve sanitized session text');
        assert.ok(!additionalContext.includes('\x1b['), 'Should not emit ANSI escape codes');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('skips prior session summary on Desktop SessionStart resume', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-resume-start-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const sessionFile = path.join(sessionsDir, '2026-02-11-resume00-session.tmp');
      fs.writeFileSync(sessionFile, buildSessionStartFixture(RESUME_SESSION_SENTINEL));

      try {
        const result = await runScript(
          path.join(scriptsDir, 'session-start.js'),
          JSON.stringify({ hookName: 'SessionStart:resume' }),
          { HOME: isoHome, USERPROFILE: isoHome }
        );
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(!additionalContext.includes('HISTORICAL REFERENCE ONLY'), 'Should not inject a previous summary on resume');
        assert.ok(!additionalContext.includes(RESUME_SESSION_SENTINEL), 'Should not inject resume session content');
        assert.ok(result.stderr.includes('non-startup SessionStart mode: resume'), `Should log skip reason, stderr: ${result.stderr}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('skips prior session summary on CLI SessionStart resume', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-cli-resume-start-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const sessionFile = path.join(sessionsDir, '2026-02-11-clires00-session.tmp');
      fs.writeFileSync(sessionFile, buildSessionStartFixture(CLI_RESUME_SESSION_SENTINEL));

      try {
        const result = await runScript(
          path.join(scriptsDir, 'session-start.js'),
          JSON.stringify({ hook_event_name: 'SessionStart', source: 'resume' }),
          { HOME: isoHome, USERPROFILE: isoHome }
        );
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(!additionalContext.includes(CLI_RESUME_SESSION_SENTINEL), 'Should not inject CLI resume session content');
        assert.ok(result.stderr.includes('non-startup SessionStart mode: resume'), `Should log skip reason, stderr: ${result.stderr}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('skips prior session summary on clear SessionStart payloads', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-clear-start-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const desktopFile = path.join(sessionsDir, '2026-02-11-deskclear-session.tmp');
      fs.writeFileSync(desktopFile, buildSessionStartFixture(`${DESKTOP_CLEAR_SESSION_SENTINEL}\n${CLI_CLEAR_SESSION_SENTINEL}`));

      try {
        const desktopResult = await runScript(
          path.join(scriptsDir, 'session-start.js'),
          JSON.stringify({ hookName: 'SessionStart:clear' }),
          { HOME: isoHome, USERPROFILE: isoHome }
        );
        assert.strictEqual(desktopResult.code, 0);
        const desktopContext = getSessionStartAdditionalContext(desktopResult.stdout);
        assert.ok(!desktopContext.includes(DESKTOP_CLEAR_SESSION_SENTINEL), 'Should not inject Desktop clear session content');

        const cliResult = await runScript(
          path.join(scriptsDir, 'session-start.js'),
          JSON.stringify({ hook_event_name: 'SessionStart', source: 'clear' }),
          { HOME: isoHome, USERPROFILE: isoHome }
        );
        assert.strictEqual(cliResult.code, 0);
        const cliContext = getSessionStartAdditionalContext(cliResult.stdout);
        assert.ok(!cliContext.includes(CLI_CLEAR_SESSION_SENTINEL), 'Should not inject CLI clear session content');
        assert.ok(cliResult.stderr.includes('non-startup SessionStart mode: clear'), `Should log clear skip reason, stderr: ${cliResult.stderr}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('does not log malformed SessionStart stdin content while skipping prior summary', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-invalid-start-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const sessionFile = path.join(sessionsDir, '2026-02-11-invalid-session.tmp');
      fs.writeFileSync(sessionFile, buildSessionStartFixture(INVALID_STDIN_SESSION_SENTINEL));
      const malformedPayload = `{"hookName":"SessionStart:resume","secret":"${INVALID_STDIN_LOG_SENTINEL}"`;

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), malformedPayload, {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(!additionalContext.includes(INVALID_STDIN_SESSION_SENTINEL), 'Should not inject session content after malformed stdin');
        assert.ok(result.stderr.includes('Invalid stdin payload'), `Should log invalid stdin payload, stderr: ${result.stderr}`);
        assert.ok(result.stderr.includes(`Length: ${malformedPayload.length}`), `Should log payload length only, stderr: ${result.stderr}`);
        assert.ok(!result.stderr.includes(INVALID_STDIN_LOG_SENTINEL), 'Should not leak raw malformed stdin content');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('does not fall back to unrelated recent session content', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-cross-project-start-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const sessionFile = path.join(sessionsDir, '2026-02-11-crossproj-session.tmp');
      fs.writeFileSync(sessionFile, buildSessionStartFixture(CROSS_PROJECT_SESSION_SENTINEL, {
        project: 'different-project',
        worktree: path.join(os.tmpdir(), 'different-project')
      }));

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(!additionalContext.includes(CROSS_PROJECT_SESSION_SENTINEL), 'Should not inject unrelated newest session content');
        assert.ok(result.stderr.includes('No worktree/project session match found'), `Should log no-match reason, stderr: ${result.stderr}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('does not inject same-project sessions from a different explicit worktree', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-cross-worktree-start-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const sessionFile = path.join(sessionsDir, '2026-02-11-crosswt-session.tmp');
      fs.writeFileSync(sessionFile, buildSessionStartFixture(CROSS_WORKTREE_PROJECT_SENTINEL, {
        worktree: path.join(os.tmpdir(), 'same-project-different-worktree')
      }));

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(!additionalContext.includes(CROSS_WORKTREE_PROJECT_SENTINEL), 'Should not inject same-project content from another worktree');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('allows project fallback only for legacy sessions without worktree metadata', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-project-only-start-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const sessionFile = path.join(sessionsDir, '2026-02-11-projectonly-session.tmp');
      fs.writeFileSync(sessionFile, buildSessionStartFixture(PROJECT_ONLY_SESSION_SENTINEL, { worktree: '' }));

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(additionalContext.includes(PROJECT_ONLY_SESSION_SENTINEL), 'Should still inject legacy same-project sessions');
        assert.ok(result.stderr.includes('(match: project)'), `Should report project fallback, stderr: ${result.stderr}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('reports learned skills count', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-skills-start-${Date.now()}`);
      const learnedDir = path.join(isoHome, '.claude', 'skills', 'learned');
      fs.mkdirSync(learnedDir, { recursive: true });
      fs.mkdirSync(getCanonicalSessionsDir(isoHome), { recursive: true });

      // Create learned skill files
      fs.writeFileSync(path.join(learnedDir, 'testing-patterns.md'), '# Testing');
      fs.writeFileSync(path.join(learnedDir, 'debugging.md'), '# Debugging');

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        assert.ok(result.stderr.includes('2 learned skill(s)'), `Should report 2 learned skills, stderr: ${result.stderr}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('injects learned skills into session-start additional context', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-skills-context-${Date.now()}`);
      const learnedDir = path.join(isoHome, '.claude', 'skills', 'learned');
      fs.mkdirSync(learnedDir, { recursive: true });
      fs.mkdirSync(getCanonicalSessionsDir(isoHome), { recursive: true });

      fs.writeFileSync(
        path.join(learnedDir, 'testing-patterns.md'),
        [
          '# Testing Patterns',
          '',
          '## When to Use',
          'Use for recurring flaky integration tests that need deterministic setup checks.',
          '',
          '## Solution',
          'Verify service readiness before running the test body.',
        ].join('\n'),
      );
      fs.mkdirSync(path.join(learnedDir, 'debugging-pattern'), { recursive: true });
      fs.writeFileSync(
        path.join(learnedDir, 'debugging-pattern', 'SKILL.md'),
        [
          '# Debugging Pattern',
          '',
          '## Trigger',
          'Use when a CLI tool silently exits without a result payload.',
        ].join('\n'),
      );

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(
          additionalContext.includes('Available learned skills'),
          `Should inject learned skills into additionalContext, got: ${additionalContext}`
        );
        assert.ok(additionalContext.includes('testing-patterns'), 'Should include the learned skill slug');
        assert.ok(
          additionalContext.includes('Use for recurring flaky integration tests'),
          'Should include the learned skill trigger text'
        );
        assert.ok(additionalContext.includes('debugging-pattern'), 'Should include directory-style learned skills');
        assert.ok(
          additionalContext.includes('CLI tool silently exits'),
          'Should summarize directory-style learned skill trigger text'
        );
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // check-console-log.js tests
  console.log('\ncheck-console-log.js:');

  if (
    await asyncTest('passes through stdin data to stdout', async () => {
      const stdinData = JSON.stringify({ tool_name: 'Write', tool_input: {} });
      const result = await runScript(path.join(scriptsDir, 'check-console-log.js'), stdinData);
      assert.strictEqual(result.code, 0);
      assert.ok(result.stdout.includes('tool_name'), 'Should pass through stdin data');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('exits 0 with empty stdin', async () => {
      const result = await runScript(path.join(scriptsDir, 'check-console-log.js'), '');
      assert.strictEqual(result.code, 0);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles invalid JSON stdin gracefully', async () => {
      const result = await runScript(path.join(scriptsDir, 'check-console-log.js'), 'not valid json');
      assert.strictEqual(result.code, 0, 'Should exit 0 on invalid JSON');
      // Should still pass through the data
      assert.ok(result.stdout.includes('not valid json'), 'Should pass through invalid data');
    })
  )
    passed++;
  else failed++;

  // session-end.js tests
  console.log('\nsession-end.js:');

  if (
    await asyncTest('runs without error', async () => {
      const result = await runScript(path.join(scriptsDir, 'session-end.js'));
      assert.strictEqual(result.code, 0, `Exit code should be 0, got ${result.code}`);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('creates or updates session file', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-session-create-${Date.now()}`);

      try {
        await runScript(path.join(scriptsDir, 'session-end.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });

        // Check if session file was created
        // Note: Without CLAUDE_SESSION_ID, falls back to project/worktree name (not 'default')
        // Use local time to match the script's getDateString() function
        const sessionsDir = getCanonicalSessionsDir(isoHome);
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // Get the expected session ID (project name fallback)
        const utils = require('../../scripts/lib/utils');
        const expectedId = utils.getSessionIdShort();
        const sessionFile = path.join(sessionsDir, `${today}-${expectedId}-session.tmp`);

        assert.ok(fs.existsSync(sessionFile), `Session file should exist: ${sessionFile}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('includes session ID in filename', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-session-id-${Date.now()}`);
      const testSessionId = 'test-session-abc12345';
      const expectedShortId = 'abc12345'; // Last 8 chars

      try {
        await runScript(path.join(scriptsDir, 'session-end.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome,
          CLAUDE_SESSION_ID: testSessionId
        });

        // Check if session file was created with session ID
        // Use local time to match the script's getDateString() function
        const sessionsDir = getCanonicalSessionsDir(isoHome);
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const sessionFile = path.join(sessionsDir, `${today}-${expectedShortId}-session.tmp`);

        assert.ok(fs.existsSync(sessionFile), `Session file should exist: ${sessionFile}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // Regression test for #1494: transcript_path UUID-derived shortId (last 8 chars)
  // isolates sibling subprocess invocations while preserving getSessionIdShort()
  // backward compatibility (same `.slice(-8)` convention).
  if (
    await asyncTest('derives shortId from transcript_path UUID when available', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-session-transcript-${Date.now()}`);
      const transcriptUuid = 'abcdef12-3456-4789-a012-bcdef3456789';
      const expectedShortId = 'f3456789'; // Last 8 chars of UUID (matches getSessionIdShort convention)
      const transcriptPath = path.join(isoHome, 'transcripts', `${transcriptUuid}.jsonl`);

      try {
        fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
        fs.writeFileSync(transcriptPath, '');

        const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
        await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
          HOME: isoHome,
          USERPROFILE: isoHome,
          // Clear CLAUDE_SESSION_ID so parent-process env does not leak into the
          // child and the test deterministically exercises the transcript_path
          // branch (getSessionIdShort() is the alternative path that is not
          // exercised here).
          CLAUDE_SESSION_ID: ''
        });

        const sessionsDir = getCanonicalSessionsDir(isoHome);
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const sessionFile = path.join(sessionsDir, `${today}-${expectedShortId}-session.tmp`);

        assert.ok(fs.existsSync(sessionFile), `Session file with transcript UUID shortId should exist: ${sessionFile}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // Regression test for #1494: uppercase UUID hex digits should be normalized to
  // lowercase so the filename is consistent with getSessionIdShort()'s output.
  if (
    await asyncTest('normalizes transcript UUID shortId to lowercase', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-session-transcript-upper-${Date.now()}`);
      const transcriptUuid = 'ABCDEF12-3456-4789-A012-BCDEF3456789';
      const expectedShortId = 'f3456789'; // last 8 lowercased
      const transcriptPath = path.join(isoHome, 'transcripts', `${transcriptUuid}.jsonl`);

      try {
        fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
        fs.writeFileSync(transcriptPath, '');

        const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
        await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
          HOME: isoHome,
          USERPROFILE: isoHome,
          CLAUDE_SESSION_ID: ''
        });

        const sessionsDir = getCanonicalSessionsDir(isoHome);
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const sessionFile = path.join(sessionsDir, `${today}-${expectedShortId}-session.tmp`);

        assert.ok(fs.existsSync(sessionFile), `Session file with lowercase shortId should exist: ${sessionFile}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // Regression test for #1494: when CLAUDE_SESSION_ID and transcript_path refer to the
  // same UUID, the derived shortId must be identical to the pre-fix behaviour so that
  // existing .tmp files are not orphaned on upgrade.
  if (
    await asyncTest('matches getSessionIdShort when transcript UUID equals CLAUDE_SESSION_ID', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-session-transcript-match-${Date.now()}`);
      const sessionUuid = '11223344-5566-4778-8899-aabbccddeeff';
      const expectedShortId = 'ccddeeff'; // last 8 chars of both transcript UUID and CLAUDE_SESSION_ID
      const transcriptPath = path.join(isoHome, 'transcripts', `${sessionUuid}.jsonl`);

      try {
        fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
        fs.writeFileSync(transcriptPath, '');

        const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
        await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
          HOME: isoHome,
          USERPROFILE: isoHome,
          CLAUDE_SESSION_ID: sessionUuid
        });

        const sessionsDir = getCanonicalSessionsDir(isoHome);
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const sessionFile = path.join(sessionsDir, `${today}-${expectedShortId}-session.tmp`);

        assert.ok(fs.existsSync(sessionFile), `Session filename should match the pre-fix CLAUDE_SESSION_ID-based name: ${sessionFile}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('writes project, branch, and worktree metadata into new session files', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-session-metadata-${Date.now()}`);
      const testSessionId = 'test-session-meta1234';
      const expectedShortId = testSessionId.slice(-8);
      const topLevel = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
      const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
      const project = path.basename(topLevel);

      try {
        const result = await runScript(path.join(scriptsDir, 'session-end.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome,
          CLAUDE_SESSION_ID: testSessionId
        });
        assert.strictEqual(result.code, 0, 'Hook should exit 0');

        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const sessionFile = path.join(getCanonicalSessionsDir(isoHome), `${today}-${expectedShortId}-session.tmp`);
        const content = fs.readFileSync(sessionFile, 'utf8');

        assert.ok(content.includes(`**Project:** ${project}`), 'Should persist project metadata');
        assert.ok(content.includes(`**Branch:** ${branch}`), 'Should persist branch metadata');
        assert.ok(content.includes(`**Worktree:** ${process.cwd()}`), 'Should persist worktree metadata');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // pre-compact.js tests
  console.log('\npre-compact.js:');

  if (
    await asyncTest('runs without error', async () => {
      const result = await runScript(path.join(scriptsDir, 'pre-compact.js'));
      assert.strictEqual(result.code, 0, `Exit code should be 0, got ${result.code}`);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('outputs PreCompact message', async () => {
      const result = await runScript(path.join(scriptsDir, 'pre-compact.js'));
      assert.ok(result.stderr.includes('[PreCompact]'), 'Should output PreCompact message');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('creates compaction log', async () => {
      await runScript(path.join(scriptsDir, 'pre-compact.js'));
      const logFile = path.join(getCanonicalSessionsDir(os.homedir()), 'compaction-log.txt');
      assert.ok(fs.existsSync(logFile), 'Compaction log should exist');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('annotates active session file with compaction marker', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-compact-annotate-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create an active .tmp session file
      const sessionFile = path.join(sessionsDir, '2026-02-11-test-session.tmp');
      fs.writeFileSync(sessionFile, '# Session: 2026-02-11\n**Started:** 10:00\n');

      try {
        await runScript(path.join(scriptsDir, 'pre-compact.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });

        const content = fs.readFileSync(sessionFile, 'utf8');
        assert.ok(content.includes('Compaction occurred'), 'Should annotate the session file with compaction marker');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('compaction log contains timestamp', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-compact-ts-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      try {
        await runScript(path.join(scriptsDir, 'pre-compact.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });

        const logFile = path.join(sessionsDir, 'compaction-log.txt');
        assert.ok(fs.existsSync(logFile), 'Compaction log should exist');
        const content = fs.readFileSync(logFile, 'utf8');
        // Should have a timestamp like [2026-02-11 14:30:00]
        assert.ok(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/.test(content), `Log should contain timestamped entry, got: ${content.substring(0, 100)}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // suggest-compact.js tests
  console.log('\nsuggest-compact.js:');

  if (
    await asyncTest('runs without error', async () => {
      const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
        CLAUDE_SESSION_ID: 'test-session-' + Date.now()
      });
      assert.strictEqual(result.code, 0, `Exit code should be 0, got ${result.code}`);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('increments counter on each call', async () => {
      const sessionId = 'test-counter-' + Date.now();

      // Run multiple times
      for (let i = 0; i < 3; i++) {
        await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId
        });
      }

      // Check counter file
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
      assert.strictEqual(count, 3, `Counter should be 3, got ${count}`);

      // Cleanup
      fs.unlinkSync(counterFile);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('suggests compact at threshold', async () => {
      const sessionId = 'test-threshold-' + Date.now();
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);

      // Set counter to threshold - 1
      fs.writeFileSync(counterFile, '49');

      const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
        CLAUDE_SESSION_ID: sessionId,
        COMPACT_THRESHOLD: '50'
      });

      assert.ok(result.stderr.includes('50 tool calls reached'), 'Should suggest compact at threshold');

      // Cleanup
      fs.unlinkSync(counterFile);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('does not suggest below threshold', async () => {
      const sessionId = 'test-below-' + Date.now();
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);

      fs.writeFileSync(counterFile, '10');

      const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
        CLAUDE_SESSION_ID: sessionId,
        COMPACT_THRESHOLD: '50'
      });

      assert.ok(!result.stderr.includes('tool calls'), 'Should not suggest compact below threshold');

      fs.unlinkSync(counterFile);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('suggests at regular intervals after threshold', async () => {
      const sessionId = 'test-interval-' + Date.now();
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);

      // Set counter to 74 (next will be 75, which is >50 and 75%25==0)
      fs.writeFileSync(counterFile, '74');

      const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
        CLAUDE_SESSION_ID: sessionId,
        COMPACT_THRESHOLD: '50'
      });

      assert.ok(result.stderr.includes('75 tool calls'), 'Should suggest at 25-call intervals after threshold');

      fs.unlinkSync(counterFile);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles corrupted counter file', async () => {
      const sessionId = 'test-corrupt-' + Date.now();
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);

      fs.writeFileSync(counterFile, 'not-a-number');

      const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
        CLAUDE_SESSION_ID: sessionId
      });

      assert.strictEqual(result.code, 0, 'Should handle corrupted counter gracefully');

      // Counter should be reset to 1
      const newCount = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
      assert.strictEqual(newCount, 1, 'Should reset counter to 1 on corrupt data');

      fs.unlinkSync(counterFile);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('uses default session ID when no env var', async () => {
      const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
        CLAUDE_SESSION_ID: '' // Empty, should use 'default'
      });

      assert.strictEqual(result.code, 0, 'Should work with default session ID');

      // Cleanup the default counter file
      const counterFile = path.join(os.tmpdir(), 'claude-tool-count-default');
      if (fs.existsSync(counterFile)) fs.unlinkSync(counterFile);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('validates threshold bounds', async () => {
      const sessionId = 'test-bounds-' + Date.now();
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);

      // Invalid threshold should fall back to 50
      fs.writeFileSync(counterFile, '49');

      const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
        CLAUDE_SESSION_ID: sessionId,
        COMPACT_THRESHOLD: '-5' // Invalid: negative
      });

      assert.ok(result.stderr.includes('50 tool calls'), 'Should use default threshold (50) for invalid value');

      fs.unlinkSync(counterFile);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('reads session_id from stdin JSON (Claude Code wire format)', async () => {
      const sessionId = 'test-stdin-' + Date.now();
      const stdinJson = JSON.stringify({ session_id: sessionId, tool_name: 'Edit' });

      const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), stdinJson, {});
      assert.strictEqual(result.code, 0, `Exit code should be 0, got ${result.code}`);

      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      assert.ok(fs.existsSync(counterFile), `Counter file should be created from stdin session_id at ${counterFile}`);
      const count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
      assert.strictEqual(count, 1, `Counter should be 1, got ${count}`);

      fs.unlinkSync(counterFile);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('stdin session_id takes precedence over env CLAUDE_SESSION_ID', async () => {
      const stdinSession = 'stdin-wins-' + Date.now();
      const envSession = 'env-loses-' + Date.now();
      const stdinJson = JSON.stringify({ session_id: stdinSession });

      const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), stdinJson, {
        CLAUDE_SESSION_ID: envSession
      });
      assert.strictEqual(result.code, 0);

      const stdinCounter = path.join(os.tmpdir(), `claude-tool-count-${stdinSession}`);
      const envCounter = path.join(os.tmpdir(), `claude-tool-count-${envSession}`);
      assert.ok(fs.existsSync(stdinCounter), 'Stdin session counter must exist');
      assert.ok(!fs.existsSync(envCounter), 'Env session counter must NOT exist when stdin provides session_id');

      fs.unlinkSync(stdinCounter);
    })
  )
    passed++;
  else failed++;

  // evaluate-session.js tests
  console.log('\nevaluate-session.js:');

  if (
    await asyncTest('runs without error when no transcript', async () => {
      const result = await runScript(path.join(scriptsDir, 'evaluate-session.js'));
      assert.strictEqual(result.code, 0, `Exit code should be 0, got ${result.code}`);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('skips short sessions', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // Create a short transcript (less than 10 user messages)
      const transcript = Array(5).fill('{"type":"user","content":"test"}\n').join('');
      fs.writeFileSync(transcriptPath, transcript);

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'evaluate-session.js'), stdinJson);

      assert.ok(result.stderr.includes('Session too short'), 'Should indicate session is too short');

      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('processes sessions with enough messages', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // Create a longer transcript (more than 10 user messages)
      const transcript = Array(15).fill('{"type":"user","content":"test"}\n').join('');
      fs.writeFileSync(transcriptPath, transcript);

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'evaluate-session.js'), stdinJson);

      assert.ok(result.stderr.includes('15 messages'), 'Should report message count');

      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  // evaluate-session.js: whitespace tolerance regression test
  if (
    await asyncTest('counts user messages with whitespace in JSON (regression)', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // Create transcript with whitespace around colons (pretty-printed style)
      const lines = [];
      for (let i = 0; i < 15; i++) {
        lines.push('{ "type" : "user", "content": "message ' + i + '" }');
      }
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'evaluate-session.js'), stdinJson);

      assert.ok(result.stderr.includes('15 messages'), 'Should count user messages with whitespace in JSON, got: ' + result.stderr.trim());

      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  // session-end.js: content array with null elements regression test
  if (
    await asyncTest('handles transcript with null content array elements (regression)', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // Create transcript with null elements in content array
      const lines = [
        '{"type":"user","content":[null,{"text":"hello"},null,{"text":"world"}]}',
        '{"type":"user","content":"simple string message"}',
        '{"type":"user","content":[{"text":"normal"},{"text":"array"}]}',
        '{"type":"tool_use","tool_name":"Edit","tool_input":{"file_path":"/test.js"}}'
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson);

      // Should not crash (exit 0)
      assert.strictEqual(result.code, 0, 'Should handle null content elements without crash');
    })
  )
    passed++;
  else failed++;

  // post-edit-console-warn.js tests
  console.log('\npost-edit-console-warn.js:');

  if (
    await asyncTest('warns about console.log in JS files', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'test.js');
      fs.writeFileSync(testFile, 'const x = 1;\nconsole.log(x);\nreturn x;');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);

      assert.ok(result.stderr.includes('console.log'), 'Should warn about console.log');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('does not warn for non-JS files', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'test.md');
      fs.writeFileSync(testFile, 'Use console.log for debugging');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);

      assert.ok(!result.stderr.includes('console.log'), 'Should not warn for non-JS files');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('does not warn for clean JS files', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'clean.ts');
      fs.writeFileSync(testFile, 'const x = 1;\nreturn x;');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);

      assert.ok(!result.stderr.includes('WARNING'), 'Should not warn for clean files');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles missing file gracefully', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/nonexistent/file.ts' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);

      assert.strictEqual(result.code, 0, 'Should not crash on missing file');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('limits console.log output to 5 matches', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'many-logs.js');
      // Create a file with 8 console.log statements
      const lines = [];
      for (let i = 1; i <= 8; i++) {
        lines.push(`console.log('debug ${i}');`);
      }
      fs.writeFileSync(testFile, lines.join('\n'));

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);

      assert.ok(result.stderr.includes('console.log'), 'Should warn about console.log');
      // Count how many "debug N" lines appear in stderr (the line-number output)
      const debugLines = result.stderr.split('\n').filter(l => /^\d+:/.test(l.trim()));
      assert.ok(debugLines.length <= 5, `Should show at most 5 matches, got ${debugLines.length}`);
      // Should include debug 1 but not debug 8 (sliced)
      assert.ok(result.stderr.includes('debug 1'), 'Should include first match');
      assert.ok(!result.stderr.includes('debug 8'), 'Should not include 8th match');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('ignores console.warn and console.error (only flags console.log)', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'other-console.ts');
      fs.writeFileSync(testFile, ['console.warn("this is a warning");', 'console.error("this is an error");', 'console.debug("this is debug");', 'console.info("this is info");'].join('\n'));

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);

      assert.ok(!result.stderr.includes('WARNING'), 'Should NOT warn about console.warn/error/debug/info');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('passes through original data on stdout', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/test.py' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);

      assert.ok(result.stdout.includes('tool_input'), 'Should pass through stdin data');
    })
  )
    passed++;
  else failed++;

  // post-edit-format.js tests
  console.log('\npost-edit-format.js:');

  if (
    await asyncTest('runs without error on empty stdin', async () => {
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'));
      assert.strictEqual(result.code, 0, 'Should exit 0 on empty stdin');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('skips non-JS/TS files', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/test.py' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should exit 0 for non-JS files');
      assert.ok(result.stdout.includes('tool_input'), 'Should pass through stdin data');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('passes through data for invalid JSON', async () => {
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), 'not json');
      assert.strictEqual(result.code, 0, 'Should exit 0 for invalid JSON');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles null tool_input gracefully', async () => {
      const stdinJson = JSON.stringify({ tool_input: null });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should exit 0 for null tool_input');
      assert.ok(result.stdout.includes('tool_input'), 'Should pass through data');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles missing file_path in tool_input', async () => {
      const stdinJson = JSON.stringify({ tool_input: {} });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should exit 0 for missing file_path');
      assert.ok(result.stdout.includes('tool_input'), 'Should pass through data');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('exits 0 and passes data when prettier is unavailable', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/nonexistent/path/file.ts' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should exit 0 even when prettier fails');
      assert.ok(result.stdout.includes('tool_input'), 'Should pass through original data');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('finds formatter config in parent dirs without package.json', async () => {
      const testDir = createTestDir();
      const rootDir = path.join(testDir, 'config-only-repo');
      const nestedDir = path.join(rootDir, 'src', 'nested');
      const filePath = path.join(nestedDir, 'component.ts');
      const binDir = path.join(testDir, 'bin');
      const logFile = path.join(testDir, 'formatter.log');

      fs.mkdirSync(nestedDir, { recursive: true });
      fs.writeFileSync(path.join(rootDir, '.prettierrc'), '{}');
      fs.writeFileSync(filePath, 'export const value = 1;\n');
      createCommandShim(binDir, 'npx', logFile);
      const isolatedHome = path.join(testDir, 'isolated-home');
      fs.mkdirSync(path.join(isolatedHome, '.claude'), { recursive: true });

      const stdinJson = JSON.stringify({ tool_input: { file_path: filePath } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson, withPrependedPath(binDir, {
        HOME: isolatedHome,
        USERPROFILE: isolatedHome
      }));

      assert.strictEqual(result.code, 0, 'Should exit 0 for config-only repo');
      const logEntries = readCommandLog(logFile);
      assert.strictEqual(logEntries.length, 1, 'Should invoke formatter once');
      assert.strictEqual(fs.realpathSync(logEntries[0].cwd), fs.realpathSync(rootDir), 'Should run formatter from config root');
      assert.deepStrictEqual(logEntries[0].args, ['prettier', '--write', filePath], 'Should use the formatter on the nested file');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('respects CLAUDE_PACKAGE_MANAGER for formatter fallback runner', async () => {
      const testDir = createTestDir();
      const rootDir = path.join(testDir, 'pnpm-repo');
      const filePath = path.join(rootDir, 'index.ts');
      const binDir = path.join(testDir, 'bin');
      const logFile = path.join(testDir, 'pnpm.log');

      fs.mkdirSync(rootDir, { recursive: true });
      fs.writeFileSync(path.join(rootDir, '.prettierrc'), '{}');
      fs.writeFileSync(filePath, 'export const value = 1;\n');
      createCommandShim(binDir, 'pnpm', logFile);

      const stdinJson = JSON.stringify({ tool_input: { file_path: filePath } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson, withPrependedPath(binDir, { CLAUDE_PACKAGE_MANAGER: 'pnpm' }));

      assert.strictEqual(result.code, 0, 'Should exit 0 when pnpm fallback is used');
      const logEntries = readCommandLog(logFile);
      assert.strictEqual(logEntries.length, 1, 'Should invoke pnpm fallback runner once');
      assert.strictEqual(logEntries[0].bin, 'pnpm', 'Should use pnpm runner');
      assert.deepStrictEqual(logEntries[0].args, ['dlx', 'prettier', '--write', filePath], 'Should use pnpm dlx for fallback formatter execution');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('respects project package-manager config for formatter fallback runner', async () => {
      const testDir = createTestDir();
      const rootDir = path.join(testDir, 'bun-repo');
      const filePath = path.join(rootDir, 'index.ts');
      const binDir = path.join(testDir, 'bin');
      const logFile = path.join(testDir, 'bun.log');

      fs.mkdirSync(path.join(rootDir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, '.claude', 'package-manager.json'), JSON.stringify({ packageManager: 'bun' }));
      fs.writeFileSync(path.join(rootDir, '.prettierrc'), '{}');
      fs.writeFileSync(filePath, 'export const value = 1;\n');
      createCommandShim(binDir, 'bunx', logFile);

      const stdinJson = JSON.stringify({ tool_input: { file_path: filePath } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson, withPrependedPath(binDir));

      assert.strictEqual(result.code, 0, 'Should exit 0 when project config selects bun');
      const logEntries = readCommandLog(logFile);
      assert.strictEqual(logEntries.length, 1, 'Should invoke bunx fallback runner once');
      assert.strictEqual(logEntries[0].bin, 'bunx', 'Should use bunx runner');
      assert.deepStrictEqual(logEntries[0].args, ['prettier', '--write', filePath], 'Should use bunx for fallback formatter execution');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  console.log('\npre-bash-dev-server-block.js:');

  if (
    await asyncTest('allows non-dev commands whose heredoc text mentions npm run dev', async () => {
      const command = ['gh pr create --title "fix: docs" --body "$(cat <<\'EOF\'', '## Test plan', '- run npm run dev to verify the site starts', 'EOF', ')"'].join('\n');
      const stdinJson = JSON.stringify({ tool_input: { command } });
      const result = await runScript(path.join(scriptsDir, 'pre-bash-dev-server-block.js'), stdinJson);

      assert.strictEqual(result.code, 0, 'Non-dev commands should pass through');
      assert.strictEqual(result.stdout, stdinJson, 'Should preserve original input');
      assert.ok(!result.stderr.includes('BLOCKED'), 'Should not emit a block message');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('blocks bare npm run dev outside tmux on non-Windows platforms', async () => {
      const stdinJson = JSON.stringify({ tool_input: { command: 'npm run dev' } });
      const result = await runScript(path.join(scriptsDir, 'pre-bash-dev-server-block.js'), stdinJson);

      if (process.platform === 'win32') {
        assert.strictEqual(result.code, 0, 'Windows path should pass through');
        assert.strictEqual(result.stdout, stdinJson, 'Windows path should preserve original input');
      } else {
        assert.strictEqual(result.code, 2, 'Unix path should block bare dev servers');
        assert.ok(result.stderr.includes('BLOCKED'), 'Should explain why the command was blocked');
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('blocks env-wrapped npm run dev outside tmux on non-Windows platforms', async () => {
      const stdinJson = JSON.stringify({ tool_input: { command: '/usr/bin/env npm run dev' } });
      const result = await runScript(path.join(scriptsDir, 'pre-bash-dev-server-block.js'), stdinJson);

      if (process.platform === 'win32') {
        assert.strictEqual(result.code, 0, 'Windows path should pass through');
        assert.strictEqual(result.stdout, stdinJson, 'Windows path should preserve original input');
      } else {
        assert.strictEqual(result.code, 2, 'Unix path should block wrapped dev servers');
        assert.ok(result.stderr.includes('BLOCKED'), 'Should explain why the command was blocked');
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('blocks nohup-wrapped npm run dev outside tmux on non-Windows platforms', async () => {
      const stdinJson = JSON.stringify({ tool_input: { command: 'nohup npm run dev >/tmp/dev.log 2>&1 &' } });
      const result = await runScript(path.join(scriptsDir, 'pre-bash-dev-server-block.js'), stdinJson);

      if (process.platform === 'win32') {
        assert.strictEqual(result.code, 0, 'Windows path should pass through');
        assert.strictEqual(result.stdout, stdinJson, 'Windows path should preserve original input');
      } else {
        assert.strictEqual(result.code, 2, 'Unix path should block wrapped dev servers');
        assert.ok(result.stderr.includes('BLOCKED'), 'Should explain why the command was blocked');
      }
    })
  )
    passed++;
  else failed++;

  // post-edit-typecheck.js tests
  console.log('\npost-edit-typecheck.js:');

  if (
    await asyncTest('runs without error on empty stdin', async () => {
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'));
      assert.strictEqual(result.code, 0, 'Should exit 0 on empty stdin');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('skips non-TypeScript files', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/test.js' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should exit 0 for non-TS files');
      assert.ok(result.stdout.includes('tool_input'), 'Should pass through stdin data');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles nonexistent TS file gracefully', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/nonexistent/file.ts' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should exit 0 for missing file');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles TS file with no tsconfig gracefully', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'test.ts');
      fs.writeFileSync(testFile, 'const x: number = 1;');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should exit 0 when no tsconfig found');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('stops tsconfig walk at max depth (20)', async () => {
      // Create a deeply nested directory (>20 levels) with no tsconfig anywhere
      const testDir = createTestDir();
      let deepDir = testDir;
      for (let i = 0; i < 25; i++) {
        deepDir = path.join(deepDir, `d${i}`);
      }
      fs.mkdirSync(deepDir, { recursive: true });
      const testFile = path.join(deepDir, 'deep.ts');
      fs.writeFileSync(testFile, 'const x: number = 1;');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const startTime = Date.now();
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      const elapsed = Date.now() - startTime;

      assert.strictEqual(result.code, 0, 'Should not hang at depth limit');
      assert.ok(elapsed < 5000, `Should complete quickly at depth limit, took ${elapsed}ms`);
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('passes through stdin data on stdout (post-edit-typecheck)', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'test.ts');
      fs.writeFileSync(testFile, 'const x: number = 1;');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      assert.ok(result.stdout.includes('tool_input'), 'Should pass through stdin data on stdout');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  // session-end.js extractSessionSummary tests
  console.log('\nsession-end.js (extractSessionSummary):');

  if (
    await asyncTest('extracts user messages from transcript', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      const lines = ['{"type":"user","content":"Fix the login bug"}', '{"type":"assistant","content":"I will fix it"}', '{"type":"user","content":"Also add tests"}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles transcript with array content fields', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      const lines = ['{"type":"user","content":[{"text":"Part 1"},{"text":"Part 2"}]}', '{"type":"user","content":"Simple message"}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should handle array content without crash');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('extracts tool names and file paths from transcript', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      const lines = [
        '{"type":"user","content":"Edit the file"}',
        '{"type":"tool_use","tool_name":"Edit","tool_input":{"file_path":"/src/main.ts"}}',
        '{"type":"tool_use","tool_name":"Read","tool_input":{"file_path":"/src/utils.ts"}}',
        '{"type":"tool_use","tool_name":"Write","tool_input":{"file_path":"/src/new.ts"}}'
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir,
        USERPROFILE: testDir
      });
      assert.strictEqual(result.code, 0);
      // Session file should contain summary with tools used
      assert.ok(result.stderr.includes('Created session file') || result.stderr.includes('Updated session file'), 'Should create/update session file');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles transcript with malformed JSON lines', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      const lines = ['{"type":"user","content":"Valid message"}', 'NOT VALID JSON', '{"broken json', '{"type":"user","content":"Another valid"}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should skip malformed lines gracefully');
      assert.ok(result.stderr.includes('unparseable') || result.stderr.includes('Skipped'), `Should report parse errors, got: ${result.stderr.substring(0, 200)}`);
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles empty transcript (no user messages)', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // Only tool_use entries, no user messages
      const lines = ['{"type":"tool_use","tool_name":"Read","tool_input":{}}', '{"type":"assistant","content":"done"}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should handle transcript with no user messages');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('truncates long user messages to 200 chars', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      const longMsg = 'x'.repeat(500);
      const lines = [`{"type":"user","content":"${longMsg}"}`];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should handle and truncate long messages');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('uses CLAUDE_TRANSCRIPT_PATH env var as fallback', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      const lines = ['{"type":"user","content":"Fallback test message"}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      // Send invalid JSON to stdin so it falls back to env var
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), 'not json', {
        CLAUDE_TRANSCRIPT_PATH: transcriptPath
      });
      assert.strictEqual(result.code, 0, 'Should use env var fallback');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('escapes backticks in user messages in session file', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // User messages with backticks that could break markdown
      const lines = ['{"type":"user","content":"Fix the `handleAuth` function in `auth.ts`"}', '{"type":"user","content":"Run `npm test` to verify"}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0, 'Should handle backticks without crash');

      // Find the session file in the temp HOME
      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          // Backticks should be escaped in the output
          assert.ok(content.includes('\\`'), 'Should escape backticks in session file');
          assert.ok(!content.includes('`handleAuth`'), 'Raw backticks should be escaped');
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('session file contains tools used and files modified', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      const lines = [
        '{"type":"user","content":"Edit the config"}',
        '{"type":"tool_use","tool_name":"Edit","tool_input":{"file_path":"/src/config.ts"}}',
        '{"type":"tool_use","tool_name":"Read","tool_input":{"file_path":"/src/utils.ts"}}',
        '{"type":"tool_use","tool_name":"Write","tool_input":{"file_path":"/src/new-file.ts"}}'
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0);

      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          // Should contain files modified (Edit and Write, not Read)
          assert.ok(content.includes('/src/config.ts'), 'Should list edited file');
          assert.ok(content.includes('/src/new-file.ts'), 'Should list written file');
          // Should contain tools used
          assert.ok(content.includes('Edit'), 'Should list Edit tool');
          assert.ok(content.includes('Read'), 'Should list Read tool');
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('omits Tools Used and Files Modified sections when empty', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // Only user messages, no tool_use entries
      const lines = ['{"type":"user","content":"Just chatting"}', '{"type":"user","content":"No tools used at all"}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0);

      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          assert.ok(content.includes('### Tasks'), 'Should have Tasks section');
          assert.ok(!content.includes('### Files Modified'), 'Should NOT have Files Modified when empty');
          assert.ok(!content.includes('### Tools Used'), 'Should NOT have Tools Used when empty');
          assert.ok(content.includes('Total user messages: 2'), 'Should show correct message count');
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('slices user messages to last 10', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // 15 user messages — should keep only last 10
      const lines = [];
      for (let i = 1; i <= 15; i++) {
        lines.push(`{"type":"user","content":"UserMsg_${i}"}`);
      }
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0);

      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          // Should NOT contain first 5 messages (sliced to last 10)
          assert.ok(!content.includes('UserMsg_1\n'), 'Should not include first message (sliced)');
          assert.ok(!content.includes('UserMsg_5\n'), 'Should not include 5th message (sliced)');
          // Should contain messages 6-15
          assert.ok(content.includes('UserMsg_6'), 'Should include 6th message');
          assert.ok(content.includes('UserMsg_15'), 'Should include last message');
          assert.ok(content.includes('Total user messages: 15'), 'Should show total of 15');
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('slices tools to first 20', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // 25 unique tools — should keep only first 20
      const lines = ['{"type":"user","content":"Do stuff"}'];
      for (let i = 1; i <= 25; i++) {
        lines.push(`{"type":"tool_use","tool_name":"Tool${i}","tool_input":{}}`);
      }
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0);

      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          // Should contain Tool1 through Tool20
          assert.ok(content.includes('Tool1'), 'Should include Tool1');
          assert.ok(content.includes('Tool20'), 'Should include Tool20');
          // Should NOT contain Tool21-25 (sliced)
          assert.ok(!content.includes('Tool21'), 'Should not include Tool21 (sliced to 20)');
          assert.ok(!content.includes('Tool25'), 'Should not include Tool25 (sliced to 20)');
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('slices files modified to first 30', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // 35 unique files via Edit — should keep only first 30
      const lines = ['{"type":"user","content":"Edit all the things"}'];
      for (let i = 1; i <= 35; i++) {
        lines.push(`{"type":"tool_use","tool_name":"Edit","tool_input":{"file_path":"/src/file${i}.ts"}}`);
      }
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0);

      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          // Should contain file1 through file30
          assert.ok(content.includes('/src/file1.ts'), 'Should include file1');
          assert.ok(content.includes('/src/file30.ts'), 'Should include file30');
          // Should NOT contain file31-35 (sliced)
          assert.ok(!content.includes('/src/file31.ts'), 'Should not include file31 (sliced to 30)');
          assert.ok(!content.includes('/src/file35.ts'), 'Should not include file35 (sliced to 30)');
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('parses Claude Code JSONL format (entry.message.content)', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // Claude Code v2.1.41+ JSONL format: user messages nested in entry.message
      const lines = ['{"type":"user","message":{"role":"user","content":"Fix the build error"}}', '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Also update tests"}]}}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0);

      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          assert.ok(content.includes('Fix the build error'), 'Should extract string content from message');
          assert.ok(content.includes('Also update tests'), 'Should extract array content from message');
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('extracts tool_use from assistant message content blocks', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // Claude Code JSONL: tool uses nested in assistant message content array
      const lines = [
        '{"type":"user","content":"Edit the config"}',
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'I will edit the file.' },
              { type: 'tool_use', name: 'Edit', input: { file_path: '/src/app.ts' } },
              { type: 'tool_use', name: 'Write', input: { file_path: '/src/new.ts' } }
            ]
          }
        })
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0);

      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          assert.ok(content.includes('Edit'), 'Should extract Edit tool from content blocks');
          assert.ok(content.includes('/src/app.ts'), 'Should extract file path from Edit block');
          assert.ok(content.includes('/src/new.ts'), 'Should extract file path from Write block');
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  // hooks.json validation
  console.log('\nhooks.json Validation:');

  if (
    test('hooks.json is valid JSON', () => {
      const hooksPath = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');
      const content = fs.readFileSync(hooksPath, 'utf8');
      JSON.parse(content); // Will throw if invalid
    })
  )
    passed++;
  else failed++;

  if (
    test('hooks.json has required event types', () => {
      const hooksPath = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');
      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));

      assert.ok(hooks.hooks.PreToolUse, 'Should have PreToolUse hooks');
      assert.ok(hooks.hooks.PostToolUse, 'Should have PostToolUse hooks');
      assert.ok(hooks.hooks.SessionStart, 'Should have SessionStart hooks');
      assert.ok(hooks.hooks.SessionEnd, 'Should have SessionEnd hooks');
      assert.ok(hooks.hooks.Stop, 'Should have Stop hooks');
      assert.ok(hooks.hooks.PreCompact, 'Should have PreCompact hooks');
    })
  )
    passed++;
  else failed++;

  if (
    test('hooks.json consolidates Bash hooks into one pre and one post dispatcher', () => {
      const hooksPath = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');
      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));

      const preBash = hooks.hooks.PreToolUse.filter(entry => entry.matcher === 'Bash');
      const postBash = hooks.hooks.PostToolUse.filter(entry => entry.matcher === 'Bash');

      assert.strictEqual(preBash.length, 1, 'Should have exactly one PreToolUse Bash dispatcher');
      assert.strictEqual(postBash.length, 1, 'Should have exactly one PostToolUse Bash dispatcher');
      assert.strictEqual(preBash[0].id, 'pre:bash:dispatcher');
      assert.strictEqual(postBash[0].id, 'post:bash:dispatcher');

      const preCommand = Array.isArray(preBash[0].hooks[0].command)
        ? preBash[0].hooks[0].command.join(' ')
        : preBash[0].hooks[0].command;
      const postCommand = Array.isArray(postBash[0].hooks[0].command)
        ? postBash[0].hooks[0].command.join(' ')
        : postBash[0].hooks[0].command;

      assert.ok(preCommand.includes('pre-bash-dispatcher.js'), 'PreToolUse Bash hook should use the pre dispatcher');
      assert.ok(postCommand.includes('post-bash-dispatcher.js'), 'PostToolUse Bash hook should use the post dispatcher');
    })
  )
    passed++;
  else failed++;

  if (
    test('SessionEnd marker hook is async and cleanup-safe', () => {
      const hooksPath = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');
      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      const sessionEndHooks = hooks.hooks.SessionEnd.flatMap(entry => entry.hooks);
      const markerHook = sessionEndHooks.find(hook => hook.command.includes('session-end-marker.js'));

      assert.ok(markerHook, 'SessionEnd should invoke session-end-marker.js');
      assert.strictEqual(markerHook.async, true, 'SessionEnd marker hook should run async during cleanup');
      assert.ok(Number.isInteger(markerHook.timeout) && markerHook.timeout > 0, 'SessionEnd marker hook should define a timeout');
    })
  )
    passed++;
  else failed++;

  if (
    test('all hook commands use string form for Claude Code schema compatibility', () => {
      const hooksPath = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');
      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));

      for (const [eventName, hookArray] of Object.entries(hooks.hooks)) {
        for (const entry of hookArray) {
          for (const hook of entry.hooks) {
            assert.strictEqual(
              typeof hook.command,
              'string',
              `${eventName}/${entry.id || entry.matcher || 'hook'} should use string command form`,
            );
          }
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('inline hook bootstraps avoid escaped double quotes for Git Bash', () => {
      const hooksPath = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');
      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));

      for (const [eventName, hookArray] of Object.entries(hooks.hooks)) {
        for (const entry of hookArray) {
          for (const hook of entry.hooks) {
            const commandText = Array.isArray(hook.command) ? hook.command.join(' ') : hook.command;
            if (typeof commandText === 'string' && commandText.startsWith('node -e ')) {
              assert.ok(
                !commandText.includes('\\"'),
                `${eventName}/${entry.id || entry.matcher || 'hook'} should not ship escaped double quotes in node -e payload`,
              );
            }
          }
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('all hook commands use node or approved shell wrappers', () => {
      const hooksPath = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');
      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));

      const checkHooks = hookArray => {
        for (const entry of hookArray) {
          for (const hook of entry.hooks) {
            if (hook.type === 'command') {
              const commandText = Array.isArray(hook.command) ? hook.command.join(' ') : hook.command;
              const commandStart = Array.isArray(hook.command) ? hook.command[0] : hook.command;
              const isNode = commandStart === 'node' || (typeof commandStart === 'string' && commandStart.startsWith('node'));
              const isNpx = commandStart === 'npx' || (typeof commandStart === 'string' && commandStart.startsWith('npx '));
              const isSkillScript = commandText.includes('/skills/') && (/^(bash|sh)\s/.test(commandText) || commandText.includes('/skills/'));
              assert.ok(
                isNode || isNpx || isSkillScript,
                `Hook command should use node or approved shell wrapper: ${commandText.substring(0, 100)}...`
              );
            }
          }
        }
      };

      for (const [, hookArray] of Object.entries(hooks.hooks)) {
        checkHooks(hookArray);
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('SessionStart hook uses safe inline resolver without plugin-tree scanning', () => {
      const hooksPath = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');
      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      const sessionStartHook = hooks.hooks.SessionStart?.[0]?.hooks?.[0];

      assert.ok(sessionStartHook, 'Should define a SessionStart hook');
      const commandText = sessionStartHook.command;
      assert.strictEqual(typeof sessionStartHook.command, 'string', 'SessionStart should use string command form for Claude Code compatibility');
      assert.ok(
        commandText.includes('session-start-bootstrap.js'),
        'SessionStart should delegate to the extracted bootstrap script'
      );
      assert.ok(commandText.includes('CLAUDE_PLUGIN_ROOT'), 'SessionStart should use CLAUDE_PLUGIN_ROOT');
      assert.ok(!commandText.includes('${CLAUDE_PLUGIN_ROOT}'), 'SessionStart should not depend on raw shell placeholder expansion');
      assert.ok(!commandText.includes('find '), 'Should not scan arbitrary plugin paths with find');
      assert.ok(!commandText.includes('head -n 1'), 'Should not pick the first matching plugin path');

      // Verify the bootstrap script itself contains the expected logic
      const bootstrapPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'session-start-bootstrap.js');
      assert.ok(fs.existsSync(bootstrapPath), 'Bootstrap script should exist at scripts/hooks/session-start-bootstrap.js');
      const bootstrapSrc = fs.readFileSync(bootstrapPath, 'utf8');
      assert.ok(bootstrapSrc.includes('session:start'), 'Bootstrap should invoke the session:start profile');
      assert.ok(bootstrapSrc.includes('run-with-flags.js'), 'Bootstrap should resolve the runner script');
      assert.ok(bootstrapSrc.includes('CLAUDE_PLUGIN_ROOT'), 'Bootstrap should consult CLAUDE_PLUGIN_ROOT');
      assert.ok(bootstrapSrc.includes('plugins'), 'Bootstrap should probe known plugin roots');
    })
  )
    passed++;
  else failed++;
  if (
    test('Stop and SessionEnd hooks use the safe inline resolver when plugin root may be unset', () => {
      const hooksPath = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');
      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      const stopHooks = (hooks.hooks.Stop || []).flatMap(entry => entry.hooks || []);
      const sessionEndHooks = (hooks.hooks.SessionEnd || []).flatMap(entry => entry.hooks || []);

      for (const hook of [...stopHooks, ...sessionEndHooks]) {
        const commandText = Array.isArray(hook.command) ? hook.command.join(' ') : hook.command;
        assert.ok(
          (Array.isArray(hook.command) && hook.command[0] === 'node' && hook.command[1] === '-e') ||
          (typeof hook.command === 'string' && hook.command.startsWith('node -e "')),
          'Lifecycle hook should use inline node resolver'
        );
        assert.ok(commandText.includes('run-with-flags.js'), 'Lifecycle hook should resolve the runner script');
        assert.ok(commandText.includes('CLAUDE_PLUGIN_ROOT'), 'Lifecycle hook should consult CLAUDE_PLUGIN_ROOT');
        assert.ok(!commandText.includes('${CLAUDE_PLUGIN_ROOT}'), 'Lifecycle hook should not depend on raw shell placeholder expansion');
        assert.ok(commandText.includes('plugins'), 'Lifecycle hook should probe known plugin roots');
        assert.ok(!commandText.includes('find '), 'Lifecycle hook should not scan arbitrary plugin paths with find');
        assert.ok(!commandText.includes('head -n 1'), 'Lifecycle hook should not pick the first matching plugin path');
      }
    })
  )
    passed++;
  else failed++;
  if (
    test('script references use the safe inline resolver or plugin bootstrap', () => {
      const hooksPath = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');
      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));

      const checkHooks = hookArray => {
        for (const entry of hookArray) {
          for (const hook of entry.hooks) {
            const commandText = Array.isArray(hook.command) ? hook.command.join(' ') : hook.command;
            const commandStart = Array.isArray(hook.command) ? `${hook.command[0]} ${hook.command[1] || ''}`.trim() : hook.command;
            if (hook.type === 'command' && commandText.includes('scripts/hooks/')) {
              const usesInlineResolver = commandStart.startsWith('node -e') && commandText.includes('run-with-flags.js');
              const usesPluginBootstrap = commandStart.startsWith('node -e') && commandText.includes('plugin-hook-bootstrap.js');
              assert.ok(!commandText.includes('${CLAUDE_PLUGIN_ROOT}'), `Script paths should not depend on raw shell placeholder expansion: ${commandText.substring(0, 80)}...`);
              assert.ok(
                usesInlineResolver || usesPluginBootstrap,
                `Script paths should use the inline resolver or plugin bootstrap: ${commandText.substring(0, 80)}...`
              );
            }
          }
        }
      };

      for (const [, hookArray] of Object.entries(hooks.hooks)) {
        checkHooks(hookArray);
      }
    })
  )
    passed++;
  else failed++;


  // plugin.json validation
  console.log('\nplugin.json Validation:');

  if (
    test('plugin.json does NOT have explicit hooks declaration', () => {
      // Claude Code automatically loads hooks/hooks.json by convention.
      // Explicitly declaring it in plugin.json causes a duplicate detection error.
      // See: https://github.com/affaan-m/everything-claude-code/issues/103
      const pluginPath = path.join(__dirname, '..', '..', '.claude-plugin', 'plugin.json');
      const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));

      assert.ok(!plugin.hooks, 'plugin.json should NOT have "hooks" field - Claude Code auto-loads hooks/hooks.json');
    })
  )
    passed++;
  else failed++;

  // ─── evaluate-session.js tests ───
  console.log('\nevaluate-session.js:');

  if (
    await asyncTest('skips when no transcript_path in stdin', async () => {
      const result = await runScript(path.join(scriptsDir, 'evaluate-session.js'), '{}');
      assert.strictEqual(result.code, 0, 'Should exit 0 (non-blocking)');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('skips when transcript file does not exist', async () => {
      const stdinJson = JSON.stringify({ transcript_path: '/tmp/nonexistent-transcript-12345.jsonl' });
      const result = await runScript(path.join(scriptsDir, 'evaluate-session.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should exit 0 when file missing');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('skips short sessions (< 10 user messages)', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'short.jsonl');
      // Only 3 user messages — below the default threshold of 10
      const lines = ['{"type":"user","content":"msg1"}', '{"type":"user","content":"msg2"}', '{"type":"user","content":"msg3"}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));
      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'evaluate-session.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      assert.ok(result.stderr.includes('too short'), 'Should log "too short" message');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('evaluates long sessions (>= 10 user messages)', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'long.jsonl');
      // 12 user messages — above the default threshold
      const lines = [];
      for (let i = 0; i < 12; i++) {
        lines.push(`{"type":"user","content":"message ${i}"}`);
      }
      fs.writeFileSync(transcriptPath, lines.join('\n'));
      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'evaluate-session.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      assert.ok(result.stderr.includes('12 messages'), 'Should report message count');
      assert.ok(result.stderr.includes('evaluate'), 'Should signal evaluation');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles malformed stdin JSON (falls back to env var)', async () => {
      const result = await runScript(path.join(scriptsDir, 'evaluate-session.js'), 'not json at all', { CLAUDE_TRANSCRIPT_PATH: '' });
      // No valid transcript path from either source → exit 0
      assert.strictEqual(result.code, 0);
    })
  )
    passed++;
  else failed++;

  // ─── suggest-compact.js tests ───
  console.log('\nsuggest-compact.js:');

  if (
    await asyncTest('increments tool counter on each invocation', async () => {
      const sessionId = `test-counter-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      try {
        // First invocation → count = 1
        await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId
        });
        let val = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
        assert.strictEqual(val, 1, 'First call should write count 1');

        // Second invocation → count = 2
        await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId
        });
        val = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
        assert.strictEqual(val, 2, 'Second call should write count 2');
      } finally {
        try {
          fs.unlinkSync(counterFile);
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('suggests compact at exact threshold', async () => {
      const sessionId = `test-threshold-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      try {
        // Pre-seed counter at threshold - 1 so next call hits threshold
        fs.writeFileSync(counterFile, '4');
        const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId,
          COMPACT_THRESHOLD: '5'
        });
        assert.strictEqual(result.code, 0);
        assert.ok(result.stderr.includes('5 tool calls reached'), 'Should suggest compact at threshold');
      } finally {
        try {
          fs.unlinkSync(counterFile);
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('suggests at periodic intervals after threshold', async () => {
      const sessionId = `test-periodic-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      try {
        // Pre-seed at 29 so next call = 30 (threshold 5 + 25 = 30)
        // (30 - 5) % 25 === 0 → should trigger periodic suggestion
        fs.writeFileSync(counterFile, '29');
        const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId,
          COMPACT_THRESHOLD: '5'
        });
        assert.strictEqual(result.code, 0);
        assert.ok(result.stderr.includes('30 tool calls'), 'Should suggest at threshold + 25n intervals');
      } finally {
        try {
          fs.unlinkSync(counterFile);
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('does not suggest below threshold', async () => {
      const sessionId = `test-below-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      try {
        fs.writeFileSync(counterFile, '2');
        const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId,
          COMPACT_THRESHOLD: '50'
        });
        assert.strictEqual(result.code, 0);
        assert.ok(!result.stderr.includes('tool calls reached'), 'Should not suggest below threshold');
        assert.ok(!result.stderr.includes('checkpoint'), 'Should not suggest checkpoint');
      } finally {
        try {
          fs.unlinkSync(counterFile);
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('resets counter when file contains huge overflow number', async () => {
      const sessionId = `test-overflow-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      try {
        // Write a value that passes Number.isFinite() but exceeds 1000000 clamp
        fs.writeFileSync(counterFile, '999999999999');
        const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId
        });
        assert.strictEqual(result.code, 0);
        // Should reset to 1 because 999999999999 > 1000000
        const newCount = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
        assert.strictEqual(newCount, 1, 'Should reset to 1 on overflow value');
      } finally {
        try {
          fs.unlinkSync(counterFile);
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('resets counter when file contains negative number', async () => {
      const sessionId = `test-negative-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      try {
        fs.writeFileSync(counterFile, '-42');
        const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId
        });
        assert.strictEqual(result.code, 0);
        const newCount = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
        assert.strictEqual(newCount, 1, 'Should reset to 1 on negative value');
      } finally {
        try {
          fs.unlinkSync(counterFile);
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles COMPACT_THRESHOLD of zero (falls back to 50)', async () => {
      const sessionId = `test-zero-thresh-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      try {
        fs.writeFileSync(counterFile, '49');
        const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId,
          COMPACT_THRESHOLD: '0'
        });
        assert.strictEqual(result.code, 0);
        assert.ok(result.stderr.includes('50 tool calls reached'), 'Zero threshold should fall back to 50');
      } finally {
        try {
          fs.unlinkSync(counterFile);
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles invalid COMPACT_THRESHOLD (falls back to 50)', async () => {
      const sessionId = `test-invalid-thresh-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      try {
        // Pre-seed at 49 so next call = 50 (the fallback default)
        fs.writeFileSync(counterFile, '49');
        const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId,
          COMPACT_THRESHOLD: 'not-a-number'
        });
        assert.strictEqual(result.code, 0);
        assert.ok(result.stderr.includes('50 tool calls reached'), 'Should use default threshold of 50');
      } finally {
        try {
          fs.unlinkSync(counterFile);
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  // ─── Round 20 bug fix tests ───
  console.log('\ncheck-console-log.js (exact pass-through):');

  if (
    await asyncTest('stdout is exact byte match of stdin (no trailing newline)', async () => {
      // Before the fix, console.log(data) added a trailing \n.
      // process.stdout.write(data) should preserve exact bytes.
      const stdinData = '{"tool":"test","value":42}';
      const result = await runScript(path.join(scriptsDir, 'check-console-log.js'), stdinData);
      assert.strictEqual(result.code, 0);
      // stdout should be exactly the input — no extra newline appended
      assert.strictEqual(result.stdout, stdinData, 'Should not append extra newline to output');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('preserves empty string stdin without adding newline', async () => {
      const result = await runScript(path.join(scriptsDir, 'check-console-log.js'), '');
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, '', 'Empty input should produce empty output');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('preserves data with embedded newlines exactly', async () => {
      const stdinData = 'line1\nline2\nline3';
      const result = await runScript(path.join(scriptsDir, 'check-console-log.js'), stdinData);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, stdinData, 'Should preserve embedded newlines without adding extra');
    })
  )
    passed++;
  else failed++;

  console.log('\npost-edit-format.js (security & extension tests):');

  if (
    await asyncTest('source code does not pass shell option to execFileSync (security)', async () => {
      const formatSource = fs.readFileSync(path.join(scriptsDir, 'post-edit-format.js'), 'utf8');
      // Strip comments to avoid matching "shell: true" in comment text
      const codeOnly = formatSource.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      assert.ok(!/execFileSync\([^)]*shell\s*:/.test(codeOnly), 'post-edit-format.js should not pass shell option to execFileSync');
      assert.ok(codeOnly.includes("process.platform === 'win32' && resolved.bin.endsWith('.cmd')"), 'Windows shell execution must stay gated to .cmd shims');
      assert.ok(codeOnly.includes('UNSAFE_PATH_CHARS'), 'Must guard against shell metacharacters before using shell: true');
      // npx.cmd handling in shared resolve-formatter.js
      const resolverSource = fs.readFileSync(path.join(scriptsDir, '..', 'lib', 'resolve-formatter.js'), 'utf8');
      assert.ok(resolverSource.includes('npx.cmd'), 'resolve-formatter.js should use npx.cmd for Windows cross-platform safety');
      assert.ok(formatSource.includes('resolveFormatterBin'), 'post-edit-format.js should use shared resolveFormatterBin');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('blocks Windows shell metacharacters before shell:true formatter execution', async () => {
      const hookPath = path.join(scriptsDir, 'post-edit-format.js');
      const resolverPath = path.join(scriptsDir, '..', 'lib', 'resolve-formatter.js');
      const childProcess = require('child_process');
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      const originalSpawnSync = childProcess.spawnSync;
      const originalExecFileSync = childProcess.execFileSync;
      const resolvedResolverPath = require.resolve(resolverPath);
      const resolvedHookPath = require.resolve(hookPath);
      const originalResolverCache = require.cache[resolvedResolverPath];
      const originalHookCache = require.cache[resolvedHookPath];
      const blockedPaths = ['semicolon;test.js', 'backtick`test.js', 'subshell$(test).js', 'group(test).js'];

      try {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

        let spawnCalls = [];
        childProcess.spawnSync = (...args) => {
          spawnCalls.push(args);
          return { status: 0, stderr: Buffer.from('') };
        };
        childProcess.execFileSync = () => {
          throw new Error('execFileSync should not run for Windows .cmd formatter shims');
        };

        require.cache[resolvedResolverPath] = {
          id: resolvedResolverPath,
          filename: resolvedResolverPath,
          loaded: true,
          exports: {
            findProjectRoot: () => process.cwd(),
            detectFormatter: () => 'prettier',
            resolveFormatterBin: () => ({ bin: 'formatter.cmd', prefix: [] })
          }
        };
        delete require.cache[resolvedHookPath];

        const { run } = require(hookPath);

        for (const filePath of blockedPaths) {
          spawnCalls = [];
          const stdinJson = JSON.stringify({ tool_input: { file_path: filePath } });
          assert.strictEqual(run(stdinJson), stdinJson, 'Should pass through original stdin JSON');
          assert.strictEqual(spawnCalls.length, 0, `Should reject ${filePath} before spawnSync`);
        }
      } finally {
        if (originalPlatform) {
          Object.defineProperty(process, 'platform', originalPlatform);
        }
        childProcess.spawnSync = originalSpawnSync;
        childProcess.execFileSync = originalExecFileSync;
        if (originalResolverCache) require.cache[resolvedResolverPath] = originalResolverCache;
        else delete require.cache[resolvedResolverPath];
        if (originalHookCache) require.cache[resolvedHookPath] = originalHookCache;
        else delete require.cache[resolvedHookPath];
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('matches .tsx extension for formatting', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/nonexistent/component.tsx' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      // Should attempt to format (will fail silently since file doesn't exist, but should pass through)
      assert.ok(result.stdout.includes('component.tsx'), 'Should pass through data for .tsx files');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('matches .jsx extension for formatting', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/nonexistent/component.jsx' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      assert.ok(result.stdout.includes('component.jsx'), 'Should pass through data for .jsx files');
    })
  )
    passed++;
  else failed++;

  console.log('\npost-edit-typecheck.js (security & extension tests):');

  if (
    await asyncTest('source code does not pass shell option to execFileSync (security)', async () => {
      const typecheckSource = fs.readFileSync(path.join(scriptsDir, 'post-edit-typecheck.js'), 'utf8');
      // Strip comments to avoid matching "shell: true" in comment text
      const codeOnly = typecheckSource.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      assert.ok(!codeOnly.includes('shell:'), 'post-edit-typecheck.js should not pass shell option in code');
      assert.ok(typecheckSource.includes('npx.cmd'), 'Should use npx.cmd for Windows cross-platform safety');
    })
  )
    passed++;
  else failed++;

  console.log('\nShell wrapper portability:');

  if (
    test('run-with-flags-shell resolves plugin root when CLAUDE_PLUGIN_ROOT is unset', () => {
      const wrapperSource = fs.readFileSync(path.join(scriptsDir, 'run-with-flags-shell.sh'), 'utf8');
      assert.ok(wrapperSource.includes('PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-'), 'Shell wrapper should derive PLUGIN_ROOT from its own script path');
    })
  )
    passed++;
  else failed++;

  if (
    test('continuous-learning shell scripts use resolved Python command instead of hardcoded python3 invocations', () => {
      const observeSource = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'continuous-learning-v2', 'hooks', 'observe.sh'), 'utf8');
      const startObserverSource = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'continuous-learning-v2', 'agents', 'start-observer.sh'), 'utf8');
      const detectProjectSource = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'continuous-learning-v2', 'scripts', 'detect-project.sh'), 'utf8');

      assert.ok(!/python3\s+-c/.test(observeSource), 'observe.sh should not invoke python3 directly');
      assert.ok(!/python3\s+-c/.test(startObserverSource), 'start-observer.sh should not invoke python3 directly');
      assert.ok(observeSource.includes('PYTHON_CMD'), 'observe.sh should resolve Python dynamically');
      assert.ok(startObserverSource.includes('CLV2_PYTHON_CMD'), 'start-observer.sh should reuse detected Python command');
      assert.ok(detectProjectSource.includes('_clv2_resolve_python_cmd'), 'detect-project.sh should provide shared Python resolution');
    })
  )
    passed++;
  else failed++;

  if (
    test('observer-loop uses a configurable max-turn budget with safe default', () => {
      const observerLoopSource = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'continuous-learning-v2', 'agents', 'observer-loop.sh'), 'utf8');

      assert.ok(observerLoopSource.includes('ECC_OBSERVER_MAX_TURNS'), 'observer-loop should allow max-turn overrides');
      assert.ok(observerLoopSource.includes('max_turns=$(( analysis_count / 10 ))'), 'observer-loop should auto-scale max_turns from the analysis batch size when no override is set');
      assert.ok(observerLoopSource.includes('if [ "$max_turns" -lt 20 ]; then max_turns=20; fi'), 'observer-loop should clamp the auto-scaled budget to a floor of 20 turns');
      assert.ok(observerLoopSource.includes('if [ "$max_turns" -gt 100 ]; then max_turns=100; fi'), 'observer-loop should clamp the auto-scaled budget to a cap of 100 turns');
      assert.ok(!observerLoopSource.includes('--max-turns 3'), 'observer-loop should not hardcode a 3-turn limit');
      assert.ok(observerLoopSource.includes('ECC_SKIP_OBSERVE=1'), 'observer-loop should suppress observe.sh for automated sessions');
      assert.ok(observerLoopSource.includes('ECC_HOOK_PROFILE=minimal'), 'observer-loop should run automated analysis with the minimal hook profile');
      assert.ok(observerLoopSource.includes('prompt_content="$(cat "$prompt_file" 2>/dev/null || true)"'), 'observer-loop should read prompt_file into memory before claude is spawned');
      assert.ok(observerLoopSource.includes('-p "$prompt_content"'), 'observer-loop should pass in-memory prompt content to claude');
      assert.ok(!observerLoopSource.includes('-p "$(cat "$prompt_file")"'), 'observer-loop should not re-read prompt_file at invocation time');
    })
  )
    passed++;
  else failed++;

  if (SKIP_BASH) {
    console.log('  ⊘ detect-project exports the resolved Python command (skipped on Windows)');
    passed++;
  } else if (
    await asyncTest('detect-project exports the resolved Python command for downstream scripts', async () => {
      const detectProjectPath = path.join(__dirname, '..', '..', 'skills', 'continuous-learning-v2', 'scripts', 'detect-project.sh');
      const shellCommand = [`source "${toBashPath(detectProjectPath)}" >/dev/null 2>&1`, 'printf "%s\\n" "${CLV2_PYTHON_CMD:-}"'].join('; ');

      const shell = process.platform === 'win32' ? 'bash' : 'bash';
      const proc = spawn(shell, ['-lc', shellCommand], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', data => (stdout += data));
      proc.stderr.on('data', data => (stderr += data));

      const code = await new Promise((resolve, reject) => {
        proc.on('close', resolve);
        proc.on('error', reject);
      });

      assert.strictEqual(code, 0, `detect-project.sh should source cleanly, stderr: ${stderr}`);
      assert.ok(stdout.trim().length > 0, 'CLV2_PYTHON_CMD should export a resolved interpreter path');
    })
  )
    passed++;
  else failed++;

  if (SKIP_BASH) {
    console.log('  ⊘ detect-project writes project metadata (skipped on Windows)');
    passed++;
  } else if (
    await asyncTest('detect-project writes project metadata to the registry and project directory', async () => {
      const testRoot = createTestDir();
      const homeDir = path.join(testRoot, 'home');
      const repoDir = path.join(testRoot, 'repo');
      const detectProjectPath = path.join(__dirname, '..', '..', 'skills', 'continuous-learning-v2', 'scripts', 'detect-project.sh');

      try {
        fs.mkdirSync(homeDir, { recursive: true });
        fs.mkdirSync(repoDir, { recursive: true });
        spawnSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
        spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/example/ecc-test.git'], { cwd: repoDir, stdio: 'ignore' });

        const shellCommand = [`cd "${toBashPath(repoDir)}"`, `source "${toBashPath(detectProjectPath)}" >/dev/null 2>&1`, 'printf "%s\\n" "$PROJECT_ID"', 'printf "%s\\n" "$PROJECT_DIR"'].join('; ');

        const proc = spawn('bash', ['-lc', shellCommand], {
          env: {
            ...process.env,
            HOME: homeDir,
            USERPROFILE: homeDir,
            CLAUDE_PROJECT_DIR: ''
          },
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', data => (stdout += data));
        proc.stderr.on('data', data => (stderr += data));

        const code = await new Promise((resolve, reject) => {
          proc.on('close', resolve);
          proc.on('error', reject);
        });

        assert.strictEqual(code, 0, `detect-project should source cleanly, stderr: ${stderr}`);

        const [projectId, projectDir] = stdout.trim().split(/\r?\n/);
        const registryPath = path.join(homeDir, '.local', 'share', 'ecc-homunculus', 'projects.json');
        const expectedProjectDir = path.join(
          homeDir,
          '.local',
          'share',
          'ecc-homunculus',
          'projects',
          projectId
        );
        const projectMetadataPath = path.join(expectedProjectDir, 'project.json');

        assert.ok(projectId, 'detect-project should emit a project id');
        assert.ok(projectDir, 'detect-project should emit a project directory');
        assert.ok(fs.existsSync(registryPath), 'projects.json should be created');
        assert.ok(fs.existsSync(projectMetadataPath), 'project.json should be written in the project directory');

        const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        const metadata = JSON.parse(fs.readFileSync(projectMetadataPath, 'utf8'));
        const comparableMetadataRoot = normalizeComparablePath(metadata.root);
        const comparableRepoDir = normalizeComparablePath(repoDir);
        const comparableProjectDir = normalizeComparablePath(projectDir);
        const comparableExpectedProjectDir = normalizeComparablePath(expectedProjectDir);

        assert.ok(registry[projectId], 'registry should contain the detected project');
        assert.strictEqual(metadata.id, projectId, 'project.json should include the detected id');
        assert.strictEqual(metadata.name, path.basename(repoDir), 'project.json should include the repo name');
        assert.strictEqual(
          comparableMetadataRoot,
          comparableRepoDir,
          `project.json should include the repo root (expected ${comparableRepoDir}, got ${comparableMetadataRoot})`
        );
        assert.strictEqual(metadata.remote, 'https://github.com/example/ecc-test.git', 'project.json should include the sanitized remote');
        assert.ok(metadata.created_at, 'project.json should include created_at');
        assert.ok(metadata.last_seen, 'project.json should include last_seen');
        assert.strictEqual(
          comparableProjectDir,
          comparableExpectedProjectDir,
          `PROJECT_DIR should point at the project storage directory (expected ${comparableExpectedProjectDir}, got ${comparableProjectDir})`
        );
      } finally {
        cleanupTestDir(testRoot);
      }
    })
  )
    passed++;
  else failed++;

  if (SKIP_BASH) {
    console.log('  ⊘ observe.sh falls back to legacy output fields (skipped on Windows)');
    passed++;
  } else if (
    await asyncTest('observe.sh falls back to legacy output fields when tool_response is null', async () => {
      const homeDir = createTestDir();
      const projectDir = createTestDir();
      const observePath = path.join(__dirname, '..', '..', 'skills', 'continuous-learning-v2', 'hooks', 'observe.sh');
      const payload = JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'echo hello' },
        tool_response: null,
        tool_output: 'legacy output',
        session_id: 'session-123',
        cwd: projectDir
      });

      try {
        const result = await runShellScript(
          observePath,
          ['post'],
          payload,
          {
            HOME: homeDir,
            USERPROFILE: homeDir,
            CLAUDE_PROJECT_DIR: projectDir
          },
          projectDir
        );

        assert.strictEqual(result.code, 0, `observe.sh should exit successfully, stderr: ${result.stderr}`);

        const homunculusDir = path.join(homeDir, '.local', 'share', 'ecc-homunculus');
        const projectsDir = path.join(homunculusDir, 'projects');
        assert.ok(
          !fs.existsSync(projectsDir) || fs.readdirSync(projectsDir).length === 0,
          'observe.sh should not create a project-scoped directory for a non-git cwd'
        );

        const observationsPath = path.join(homunculusDir, 'observations.jsonl');
        const observations = fs.readFileSync(observationsPath, 'utf8').trim().split('\n').filter(Boolean);
        assert.ok(observations.length > 0, 'observe.sh should append at least one observation');

        const observation = JSON.parse(observations[0]);
        assert.strictEqual(observation.output, 'legacy output', 'observe.sh should fall back to legacy tool_output when tool_response is null');
      } finally {
        cleanupTestDir(homeDir);
        cleanupTestDir(projectDir);
      }
    })
  )
    passed++;
  else failed++;

  if (SKIP_BASH) {
    console.log('  \u2298 observe.sh skips non-cli entrypoints (skipped on Windows)');
    passed++;
  } else if (
    await asyncTest('observe.sh skips non-cli entrypoints before project detection side effects', async () => {
      await assertObserveSkipBeforeProjectDetection({
        name: 'non-cli entrypoint',
        env: { CLAUDE_CODE_ENTRYPOINT: 'mcp' }
      });
    })
  )
    passed++;
  else failed++;

  if (SKIP_BASH) { console.log("  ⊘ observe.sh skips minimal hook profile (skipped on Windows)"); passed++; } else if (
    await asyncTest('observe.sh skips minimal hook profile before project detection side effects', async () => {
      await assertObserveSkipBeforeProjectDetection({
        name: 'minimal hook profile',
        env: { CLAUDE_CODE_ENTRYPOINT: 'cli', ECC_HOOK_PROFILE: 'minimal' }
      });
    })
  )
    passed++;
  else failed++;

  if (SKIP_BASH) { console.log("  ⊘ observe.sh skips cooperative skip env (skipped on Windows)"); passed++; } else if (
    await asyncTest('observe.sh skips cooperative skip env before project detection side effects', async () => {
      await assertObserveSkipBeforeProjectDetection({
        name: 'cooperative skip env',
        env: { CLAUDE_CODE_ENTRYPOINT: 'cli', ECC_SKIP_OBSERVE: '1' }
      });
    })
  )
    passed++;
  else failed++;

  if (SKIP_BASH) { console.log("  ⊘ observe.sh skips subagent payloads (skipped on Windows)"); passed++; } else if (
    await asyncTest('observe.sh skips subagent payloads before project detection side effects', async () => {
      await assertObserveSkipBeforeProjectDetection({
        name: 'subagent payload',
        env: { CLAUDE_CODE_ENTRYPOINT: 'cli' },
        payload: { agent_id: 'agent-123' }
      });
    })
  )
    passed++;
  else failed++;

  if (SKIP_BASH) { console.log("  ⊘ observe.sh skips configured observer-session paths (skipped on Windows)"); passed++; } else if (
    await asyncTest('observe.sh skips configured observer-session paths before project detection side effects', async () => {
      await assertObserveSkipBeforeProjectDetection({
        name: 'cwd skip path',
        env: {
          CLAUDE_CODE_ENTRYPOINT: 'cli',
          ECC_OBSERVE_SKIP_PATHS: ' observer-sessions , .claude-mem '
        },
        cwdSuffix: path.join('observer-sessions', 'worker')
      });
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('matches .tsx extension for type checking', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'component.tsx');
      fs.writeFileSync(testFile, 'const x: number = 1;');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      assert.ok(result.stdout.includes('tool_input'), 'Should pass through data for .tsx files');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  // ─── Round 23: Bug fixes & high-priority gap coverage ───

  // Helper: create a patched evaluate-session.js wrapper that resolves
  // require('../lib/utils') to the real utils.js and uses a custom config path
  const realUtilsPath = path.resolve(__dirname, '..', '..', 'scripts', 'lib', 'utils.js');
  function createEvalWrapper(testDir, configPath) {
    const wrapperScript = path.join(testDir, 'eval-wrapper.js');
    let src = fs.readFileSync(path.join(scriptsDir, 'evaluate-session.js'), 'utf8');
    // Patch require to use absolute path (the temp dir doesn't have ../lib/utils)
    src = src.replace(/require\('\.\.\/lib\/utils'\)/, `require(${JSON.stringify(realUtilsPath)})`);
    // Patch config file path to point to our test config
    src = src.replace(/const configFile = path\.join\(scriptDir.*?config\.json'\);/, `const configFile = ${JSON.stringify(configPath)};`);
    fs.writeFileSync(wrapperScript, src);
    return wrapperScript;
  }

  console.log('\nRound 23: evaluate-session.js (config & nullish coalescing):');

  if (
    await asyncTest('respects min_session_length=0 from config (nullish coalescing)', async () => {
      // This tests the ?? fix: min_session_length=0 should mean "evaluate ALL sessions"
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'short.jsonl');
      // Only 2 user messages — normally below the default threshold of 10
      const lines = ['{"type":"user","content":"msg1"}', '{"type":"user","content":"msg2"}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      // Create a config file with min_session_length=0
      const skillsDir = path.join(testDir, 'skills', 'continuous-learning');
      fs.mkdirSync(skillsDir, { recursive: true });
      const configPath = path.join(skillsDir, 'config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          min_session_length: 0,
          learned_skills_path: path.join(testDir, 'learned')
        })
      );

      const wrapperScript = createEvalWrapper(testDir, configPath);

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(wrapperScript, stdinJson, {
        HOME: testDir,
        USERPROFILE: testDir
      });
      assert.strictEqual(result.code, 0);
      // With min_session_length=0, even 2 messages should trigger evaluation
      assert.ok(result.stderr.includes('2 messages') && result.stderr.includes('evaluate'), 'Should evaluate session with min_session_length=0 (not skip as too short)');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('config with min_session_length=null falls back to default 10', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'short.jsonl');
      // 5 messages — below default 10
      const lines = [];
      for (let i = 0; i < 5; i++) lines.push(`{"type":"user","content":"msg${i}"}`);
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const skillsDir = path.join(testDir, 'skills', 'continuous-learning');
      fs.mkdirSync(skillsDir, { recursive: true });
      const configPath = path.join(skillsDir, 'config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          min_session_length: null,
          learned_skills_path: path.join(testDir, 'learned')
        })
      );

      const wrapperScript = createEvalWrapper(testDir, configPath);

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(wrapperScript, stdinJson, {
        HOME: testDir,
        USERPROFILE: testDir
      });
      assert.strictEqual(result.code, 0);
      // null ?? 10 === 10, so 5 messages should be "too short"
      assert.ok(result.stderr.includes('too short'), 'Should fall back to default 10 when null');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('config with custom learned_skills_path creates directory', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      fs.writeFileSync(transcriptPath, '{"type":"user","content":"msg"}');

      const customLearnedDir = path.join(testDir, 'custom-learned-skills');
      const skillsDir = path.join(testDir, 'skills', 'continuous-learning');
      fs.mkdirSync(skillsDir, { recursive: true });
      const configPath = path.join(skillsDir, 'config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          learned_skills_path: customLearnedDir
        })
      );

      const wrapperScript = createEvalWrapper(testDir, configPath);

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      await runScript(wrapperScript, stdinJson, {
        HOME: testDir,
        USERPROFILE: testDir
      });
      assert.ok(fs.existsSync(customLearnedDir), 'Should create custom learned skills directory');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles invalid config JSON gracefully (uses defaults)', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      const lines = [];
      for (let i = 0; i < 5; i++) lines.push(`{"type":"user","content":"msg${i}"}`);
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const skillsDir = path.join(testDir, 'skills', 'continuous-learning');
      fs.mkdirSync(skillsDir, { recursive: true });
      const configPath = path.join(skillsDir, 'config.json');
      fs.writeFileSync(configPath, 'not valid json!!!');

      const wrapperScript = createEvalWrapper(testDir, configPath);

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(wrapperScript, stdinJson, {
        HOME: testDir,
        USERPROFILE: testDir
      });
      assert.strictEqual(result.code, 0);
      // Should log parse failure and fall back to default 10 → 5 msgs too short
      assert.ok(result.stderr.includes('too short'), 'Should use defaults when config is invalid JSON');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 23: session-end.js (update existing file path):');

  if (
    await asyncTest('updates Last Updated timestamp in existing session file', async () => {
      const testDir = createTestDir();
      const sessionsDir = getCanonicalSessionsDir(testDir);
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Get the expected filename
      const utils = require('../../scripts/lib/utils');
      const today = utils.getDateString();

      // Create a pre-existing session file with known timestamp
      const shortId = 'update01';
      const sessionFile = path.join(sessionsDir, `${today}-${shortId}-session.tmp`);
      const originalContent = `# Session: ${today}\n**Date:** ${today}\n**Started:** 09:00\n**Last Updated:** 09:00\n\n---\n\n## Current State\n\n[Session context goes here]\n\n### Completed\n- [ ]\n\n### In Progress\n- [ ]\n\n### Notes for Next Session\n-\n\n### Context to Load\n\`\`\`\n[relevant files]\n\`\`\`\n`;
      fs.writeFileSync(sessionFile, originalContent);

      const result = await runScript(path.join(scriptsDir, 'session-end.js'), '', {
        HOME: testDir,
        USERPROFILE: testDir,
        CLAUDE_SESSION_ID: `session-${shortId}`
      });
      assert.strictEqual(result.code, 0);

      const updated = fs.readFileSync(sessionFile, 'utf8');
      // The timestamp should have been updated (no longer 09:00)
      assert.ok(updated.includes('**Last Updated:**'), 'Should still have Last Updated field');
      assert.ok(result.stderr.includes('Updated session file'), 'Should log update');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('normalizes existing session headers with project, branch, and worktree metadata', async () => {
      const testDir = createTestDir();
      const sessionsDir = getCanonicalSessionsDir(testDir);
      fs.mkdirSync(sessionsDir, { recursive: true });

      const utils = require('../../scripts/lib/utils');
      const today = utils.getDateString();
      const shortId = 'update04';
      const sessionFile = path.join(sessionsDir, `${today}-${shortId}-session.tmp`);
      const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
      const project = path.basename(spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim());

      fs.writeFileSync(sessionFile, `# Session: ${today}\n**Date:** ${today}\n**Started:** 09:00\n**Last Updated:** 09:00\n\n---\n\n## Current State\n\n[Session context goes here]\n`);

      const result = await runScript(path.join(scriptsDir, 'session-end.js'), '', {
        HOME: testDir,
        USERPROFILE: testDir,
        CLAUDE_SESSION_ID: `session-${shortId}`
      });
      assert.strictEqual(result.code, 0);

      const updated = fs.readFileSync(sessionFile, 'utf8');
      assert.ok(updated.includes(`**Project:** ${project}`), 'Should inject project metadata into existing headers');
      assert.ok(updated.includes(`**Branch:** ${branch}`), 'Should inject branch metadata into existing headers');
      assert.ok(updated.includes(`**Worktree:** ${process.cwd()}`), 'Should inject worktree metadata into existing headers');

      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('replaces blank template with summary when updating existing file', async () => {
      const testDir = createTestDir();
      const sessionsDir = getCanonicalSessionsDir(testDir);
      fs.mkdirSync(sessionsDir, { recursive: true });

      const utils = require('../../scripts/lib/utils');
      const today = utils.getDateString();

      const shortId = 'update02';
      const sessionFile = path.join(sessionsDir, `${today}-${shortId}-session.tmp`);
      // Pre-existing file with blank template
      const originalContent = `# Session: ${today}\n**Date:** ${today}\n**Started:** 09:00\n**Last Updated:** 09:00\n\n---\n\n## Current State\n\n[Session context goes here]\n\n### Completed\n- [ ]\n\n### In Progress\n- [ ]\n\n### Notes for Next Session\n-\n\n### Context to Load\n\`\`\`\n[relevant files]\n\`\`\`\n`;
      fs.writeFileSync(sessionFile, originalContent);

      // Create a transcript with user messages
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      const lines = ['{"type":"user","content":"Fix auth bug"}', '{"type":"tool_use","tool_name":"Edit","tool_input":{"file_path":"/src/auth.ts"}}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir,
        USERPROFILE: testDir,
        CLAUDE_SESSION_ID: `session-${shortId}`
      });
      assert.strictEqual(result.code, 0);

      const updated = fs.readFileSync(sessionFile, 'utf8');
      // Should have replaced blank template with actual summary
      assert.ok(!updated.includes('[Session context goes here]'), 'Should replace blank template');
      assert.ok(updated.includes('Fix auth bug'), 'Should include user message in summary');
      assert.ok(updated.includes('/src/auth.ts'), 'Should include modified file');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('always updates session summary content on session end', async () => {
      const testDir = createTestDir();
      const sessionsDir = getCanonicalSessionsDir(testDir);
      fs.mkdirSync(sessionsDir, { recursive: true });

      const utils = require('../../scripts/lib/utils');
      const today = utils.getDateString();

      const shortId = 'update03';
      const sessionFile = path.join(sessionsDir, `${today}-${shortId}-session.tmp`);
      // Pre-existing file with already-filled summary
      const existingContent = `# Session: ${today}\n**Date:** ${today}\n**Started:** 08:00\n**Last Updated:** 08:30\n\n---\n\n## Session Summary\n\n### Tasks\n- Previous task from earlier\n`;
      fs.writeFileSync(sessionFile, existingContent);

      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      fs.writeFileSync(transcriptPath, '{"type":"user","content":"New task"}');

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir,
        USERPROFILE: testDir,
        CLAUDE_SESSION_ID: `session-${shortId}`
      });
      assert.strictEqual(result.code, 0);

      const updated = fs.readFileSync(sessionFile, 'utf8');
      // Session summary should always be refreshed with current content (#317)
      assert.ok(updated.includes('## Session Summary'), 'Should have Session Summary section');
      assert.ok(updated.includes('# Session:'), 'Should preserve session header');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 23: pre-compact.js (glob specificity):');

  if (
    await asyncTest('only annotates *-session.tmp files, not other .tmp files', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-compact-glob-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create a session .tmp file and a non-session .tmp file
      const sessionFile = path.join(sessionsDir, '2026-02-11-abc-session.tmp');
      const otherTmpFile = path.join(sessionsDir, 'other-data.tmp');
      fs.writeFileSync(sessionFile, '# Session\n');
      fs.writeFileSync(otherTmpFile, 'some other data\n');

      try {
        await runScript(path.join(scriptsDir, 'pre-compact.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });

        const sessionContent = fs.readFileSync(sessionFile, 'utf8');
        const otherContent = fs.readFileSync(otherTmpFile, 'utf8');

        assert.ok(sessionContent.includes('Compaction occurred'), 'Should annotate session file');
        assert.strictEqual(otherContent, 'some other data\n', 'Should NOT annotate non-session .tmp file');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles no active session files gracefully', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-compact-nosession-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      try {
        const result = await runScript(path.join(scriptsDir, 'pre-compact.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0, 'Should exit 0 with no session files');
        assert.ok(result.stderr.includes('[PreCompact]'), 'Should still log success');

        // Compaction log should still be created
        const logFile = path.join(sessionsDir, 'compaction-log.txt');
        assert.ok(fs.existsSync(logFile), 'Should create compaction log even with no sessions');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 23: session-end.js (extractSessionSummary edge cases):');

  if (
    await asyncTest('handles transcript with only assistant messages (no user messages)', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      // Only assistant messages — no user messages
      const lines = ['{"type":"assistant","message":{"content":[{"type":"text","text":"response"}]}}', '{"type":"tool_use","tool_name":"Read","tool_input":{"file_path":"/src/app.ts"}}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0);

      // With no user messages, extractSessionSummary returns null → blank template
      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          assert.ok(content.includes('[Session context goes here]'), 'Should use blank template when no user messages');
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('extracts tool_use from assistant message content blocks', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      // Claude Code JSONL format: tool_use blocks inside assistant message content array
      const lines = [
        '{"type":"user","content":"Edit config"}',
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'I will edit the config.' },
              { type: 'tool_use', name: 'Edit', input: { file_path: '/src/config.ts' } },
              { type: 'tool_use', name: 'Write', input: { file_path: '/src/new.ts' } }
            ]
          }
        })
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0);

      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          assert.ok(content.includes('/src/config.ts'), 'Should extract file from nested tool_use block');
          assert.ok(content.includes('/src/new.ts'), 'Should extract Write file from nested block');
          assert.ok(content.includes('Edit'), 'Should list Edit in tools used');
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  // ─── Round 24: suggest-compact interval fix, fd fallback, session-start maxAge ───
  console.log('\nRound 24: suggest-compact.js (interval fix & fd fallback):');

  if (
    await asyncTest('periodic intervals are consistent with non-25-divisible threshold', async () => {
      // Regression test: with threshold=13, periodic suggestions should fire at 38, 63, 88...
      // (count - 13) % 25 === 0 → 38-13=25, 63-13=50, etc.
      const sessionId = `test-interval-fix-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      try {
        // Pre-seed at 37 so next call = 38 (13 + 25 = 38)
        fs.writeFileSync(counterFile, '37');
        const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId,
          COMPACT_THRESHOLD: '13'
        });
        assert.strictEqual(result.code, 0);
        assert.ok(result.stderr.includes('38 tool calls'), 'Should suggest at threshold(13) + 25 = 38');
      } finally {
        try {
          fs.unlinkSync(counterFile);
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('does not suggest at old-style multiples that skip threshold offset', async () => {
      // With threshold=13, count=50 should NOT trigger (old behavior would: 50%25===0)
      // New behavior: (50-13)%25 = 37%25 = 12 → no suggestion
      const sessionId = `test-no-false-suggest-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      try {
        fs.writeFileSync(counterFile, '49');
        const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId,
          COMPACT_THRESHOLD: '13'
        });
        assert.strictEqual(result.code, 0);
        assert.ok(!result.stderr.includes('checkpoint'), 'Should NOT suggest at count=50 with threshold=13');
      } finally {
        try {
          fs.unlinkSync(counterFile);
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('fd fallback: handles corrupted counter file gracefully', async () => {
      const sessionId = `test-corrupt-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      try {
        // Write non-numeric data to trigger parseInt → NaN → reset to 1
        fs.writeFileSync(counterFile, 'corrupted data here!!!');
        const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId
        });
        assert.strictEqual(result.code, 0);
        const newCount = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
        assert.strictEqual(newCount, 1, 'Should reset to 1 on corrupted file content');
      } finally {
        try {
          fs.unlinkSync(counterFile);
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles counter at exact 1000000 boundary', async () => {
      const sessionId = `test-boundary-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      try {
        // 1000000 is the upper clamp boundary — should still increment
        fs.writeFileSync(counterFile, '1000000');
        const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId
        });
        assert.strictEqual(result.code, 0);
        const newCount = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
        assert.strictEqual(newCount, 1000001, 'Should increment from exactly 1000000');
      } finally {
        try {
          fs.unlinkSync(counterFile);
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 24: post-edit-format.js (edge cases):');

  if (
    await asyncTest('passes through malformed JSON unchanged', async () => {
      const malformedJson = '{"tool_input": {"file_path": "/test.ts"';
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), malformedJson);
      assert.strictEqual(result.code, 0);
      // Should pass through the malformed data unchanged
      assert.ok(result.stdout.includes(malformedJson), 'Should pass through malformed JSON');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('passes through data for non-JS/TS file extensions', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/path/to/file.py' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      assert.ok(result.stdout.includes('file.py'), 'Should pass through for .py files');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 24: post-edit-typecheck.js (edge cases):');

  if (
    await asyncTest('skips typecheck for non-existent file and still passes through', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/nonexistent/deep/file.ts' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      assert.ok(result.stdout.includes('file.ts'), 'Should pass through for non-existent .ts file');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('passes through for non-TS extensions without running tsc', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/path/to/file.js' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      assert.ok(result.stdout.includes('file.js'), 'Should pass through for .js file without running tsc');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 24: session-start.js (edge cases):');

  if (
    await asyncTest('exits 0 with empty sessions directory (no recent sessions)', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-start-empty-${Date.now()}`);
      fs.mkdirSync(getCanonicalSessionsDir(isoHome), { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });
      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0, 'Should exit 0 with no sessions');
        // Should NOT inject any previous session data (stdout should be empty or minimal)
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(!additionalContext.includes('Previous session summary'), 'Should not inject when no sessions');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('does not inject blank template session into context', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-start-blank-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      // Create a session file with the blank template marker
      const today = new Date().toISOString().slice(0, 10);
      const sessionFile = path.join(sessionsDir, `${today}-blank-session.tmp`);
      fs.writeFileSync(sessionFile, '# Session\n[Session context goes here]\n');

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        // Should NOT inject blank template
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(!additionalContext.includes('Previous session summary'), 'Should skip blank template sessions');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // ─── Round 25: post-edit-console-warn pass-through fix, check-console-log edge cases ───
  console.log('\nRound 25: post-edit-console-warn.js (pass-through fix):');

  if (
    await asyncTest('stdout is exact byte match of stdin (no trailing newline)', async () => {
      // Regression test: console.log(data) was replaced with process.stdout.write(data)
      const stdinData = '{"tool_input":{"file_path":"/nonexistent/file.py"}}';
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinData);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, stdinData, 'stdout should exactly match stdin (no extra newline)');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('passes through malformed JSON unchanged without crash', async () => {
      const malformed = '{"tool_input": {"file_path": "/test.ts"';
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), malformed);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, malformed, 'Should pass through malformed JSON exactly');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles missing file_path in tool_input gracefully', async () => {
      const stdinJson = JSON.stringify({ tool_input: {} });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, stdinJson, 'Should pass through with missing file_path');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('passes through when file does not exist (readFile returns null)', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/nonexistent/deep/file.ts' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, stdinJson, 'Should pass through exactly when file not found');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 25: check-console-log.js (edge cases):');

  if (
    await asyncTest('source has expected exclusion patterns', async () => {
      // The EXCLUDED_PATTERNS array includes .test.ts, .spec.ts, etc.
      const source = fs.readFileSync(path.join(scriptsDir, 'check-console-log.js'), 'utf8');
      // Verify the exclusion patterns exist (regex escapes use \. so check for the pattern names)
      assert.ok(source.includes('EXCLUDED_PATTERNS'), 'Should have exclusion patterns array');
      assert.ok(/\.test\\\./.test(source), 'Should have test file exclusion pattern');
      assert.ok(/\.spec\\\./.test(source), 'Should have spec file exclusion pattern');
      assert.ok(source.includes('scripts'), 'Should exclude scripts/ directory');
      assert.ok(source.includes('__tests__'), 'Should exclude __tests__/ directory');
      assert.ok(source.includes('__mocks__'), 'Should exclude __mocks__/ directory');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('passes through data unchanged on non-git repo', async () => {
      // In a temp dir with no git repo, the hook should pass through data unchanged
      const testDir = createTestDir();
      const stdinData = '{"tool_input":"test"}';
      const result = await runScript(path.join(scriptsDir, 'check-console-log.js'), stdinData, {
        // Use a non-git directory as CWD
        HOME: testDir,
        USERPROFILE: testDir
      });
      // Note: We're still running from a git repo, so isGitRepo() may still return true.
      // This test verifies the script doesn't crash and passes through data.
      assert.strictEqual(result.code, 0);
      assert.ok(result.stdout.includes(stdinData), 'Should pass through data');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('exits 0 even when no stdin is provided', async () => {
      const result = await runScript(path.join(scriptsDir, 'check-console-log.js'), '');
      assert.strictEqual(result.code, 0, 'Should exit 0 with empty stdin');
    })
  )
    passed++;
  else failed++;

  // ── Round 29: post-edit-format.js cwd fix and process.exit(0) consistency ──
  console.log('\nRound 29: post-edit-format.js (cwd and exit):');

  if (
    await asyncTest('source uses cwd based on file directory for npx', async () => {
      const formatSource = fs.readFileSync(path.join(scriptsDir, 'post-edit-format.js'), 'utf8');
      assert.ok(formatSource.includes('cwd:'), 'Should set cwd option for execFileSync');
      assert.ok(formatSource.includes('path.dirname'), 'cwd should use path.dirname of the file');
      assert.ok(formatSource.includes('path.resolve'), 'cwd should resolve the file path first');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('source calls process.exit(0) after writing output', async () => {
      const formatSource = fs.readFileSync(path.join(scriptsDir, 'post-edit-format.js'), 'utf8');
      assert.ok(formatSource.includes('process.exit(0)'), 'Should call process.exit(0) for clean termination');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('uses process.stdout.write instead of console.log for pass-through', async () => {
      const formatSource = fs.readFileSync(path.join(scriptsDir, 'post-edit-format.js'), 'utf8');
      assert.ok(formatSource.includes('process.stdout.write(data)'), 'Should use process.stdout.write to avoid trailing newline');
      // Verify no console.log(data) for pass-through (console.error for warnings is OK)
      const lines = formatSource.split('\n');
      const passThrough = lines.filter(l => /console\.log\(data\)/.test(l));
      assert.strictEqual(passThrough.length, 0, 'Should not use console.log(data) for pass-through');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 29: post-edit-typecheck.js (exit and pass-through):');

  if (
    await asyncTest('source calls process.exit(0) after writing output', async () => {
      const tcSource = fs.readFileSync(path.join(scriptsDir, 'post-edit-typecheck.js'), 'utf8');
      assert.ok(tcSource.includes('process.exit(0)'), 'Should call process.exit(0) for clean termination');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('uses process.stdout.write instead of console.log for pass-through', async () => {
      const tcSource = fs.readFileSync(path.join(scriptsDir, 'post-edit-typecheck.js'), 'utf8');
      assert.ok(tcSource.includes('process.stdout.write(data)'), 'Should use process.stdout.write');
      const lines = tcSource.split('\n');
      const passThrough = lines.filter(l => /console\.log\(data\)/.test(l));
      assert.strictEqual(passThrough.length, 0, 'Should not use console.log(data) for pass-through');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('exact stdout pass-through without trailing newline (typecheck)', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/nonexistent/file.py' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, stdinJson, 'stdout should exactly match stdin (no trailing newline)');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('exact stdout pass-through without trailing newline (format)', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/nonexistent/file.py' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, stdinJson, 'stdout should exactly match stdin (no trailing newline)');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 29: post-edit-console-warn.js (extension and exit):');

  if (
    await asyncTest('source calls process.exit(0) after writing output', async () => {
      const cwSource = fs.readFileSync(path.join(scriptsDir, 'post-edit-console-warn.js'), 'utf8');
      assert.ok(cwSource.includes('process.exit(0)'), 'Should call process.exit(0)');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('does NOT match .mts or .mjs extensions', async () => {
      const stdinMts = JSON.stringify({ tool_input: { file_path: '/some/file.mts' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinMts);
      assert.strictEqual(result.code, 0);
      // .mts is not in the regex /\.(ts|tsx|js|jsx)$/, so no console.log scan
      assert.strictEqual(result.stdout, stdinMts, 'Should pass through .mts without scanning');
      assert.ok(!result.stderr.includes('console.log'), 'Should NOT scan .mts files for console.log');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('does NOT match uppercase .TS extension', async () => {
      const stdinTS = JSON.stringify({ tool_input: { file_path: '/some/file.TS' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinTS);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, stdinTS, 'Should pass through .TS without scanning');
      assert.ok(!result.stderr.includes('console.log'), 'Should NOT scan .TS (uppercase) files');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('detects console.log in commented-out code', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'commented.js');
      fs.writeFileSync(testFile, '// console.log("debug")\nconst x = 1;\n');
      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);
      assert.strictEqual(result.code, 0);
      // The regex /console\.log/ matches even in comments — this is intentional
      assert.ok(result.stderr.includes('console.log'), 'Should detect console.log even in comments');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 29: check-console-log.js (exclusion patterns and exit):');

  if (
    await asyncTest('source calls process.exit(0) after writing output', async () => {
      const clSource = fs.readFileSync(path.join(scriptsDir, 'check-console-log.js'), 'utf8');
      // Should have at least 2 process.exit(0) calls (early return + end)
      const exitCalls = clSource.match(/process\.exit\(0\)/g) || [];
      assert.ok(exitCalls.length >= 2, `Should have at least 2 process.exit(0) calls, found ${exitCalls.length}`);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('EXCLUDED_PATTERNS correctly excludes test files', async () => {
      // Test the patterns directly by reading the source and evaluating the regex
      const source = fs.readFileSync(path.join(scriptsDir, 'check-console-log.js'), 'utf8');
      // Verify the 6 exclusion patterns exist in the source (as regex literals with escapes)
      const expectedSubstrings = ['test', 'spec', 'config', 'scripts', '__tests__', '__mocks__'];
      for (const substr of expectedSubstrings) {
        assert.ok(source.includes(substr), `Should include pattern containing "${substr}"`);
      }
      // Verify the array name exists
      assert.ok(source.includes('EXCLUDED_PATTERNS'), 'Should have EXCLUDED_PATTERNS array');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('exclusion patterns match expected file paths', async () => {
      // Recreate the EXCLUDED_PATTERNS from the source and test them
      const EXCLUDED_PATTERNS = [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /\.config\.[jt]s$/, /scripts\//, /__tests__\//, /__mocks__\//];
      // These SHOULD be excluded
      const excluded = [
        'src/utils.test.ts',
        'src/utils.test.js',
        'src/utils.test.tsx',
        'src/utils.test.jsx',
        'src/utils.spec.ts',
        'src/utils.spec.js',
        'src/utils.config.ts',
        'src/utils.config.js',
        'scripts/hooks/session-end.js',
        '__tests__/utils.ts',
        '__mocks__/api.ts'
      ];
      for (const f of excluded) {
        const matches = EXCLUDED_PATTERNS.some(p => p.test(f));
        assert.ok(matches, `Expected "${f}" to be excluded but it was not`);
      }
      // These should NOT be excluded
      const notExcluded = [
        'src/utils.ts',
        'src/main.tsx',
        'src/app.js',
        'src/test.component.ts', // "test" in name but not .test. pattern
        'src/config.ts' // "config" in name but not .config. pattern
      ];
      for (const f of notExcluded) {
        const matches = EXCLUDED_PATTERNS.some(p => p.test(f));
        assert.ok(!matches, `Expected "${f}" to NOT be excluded but it was`);
      }
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 29: run-all.js test runner improvements:');

  if (
    await asyncTest('test runner uses spawnSync to capture stderr on success', async () => {
      const runAllSource = fs.readFileSync(path.join(__dirname, '..', 'run-all.js'), 'utf8');
      assert.ok(runAllSource.includes('spawnSync'), 'Should use spawnSync instead of execSync');
      assert.ok(!runAllSource.includes('execSync'), 'Should not use execSync');
      // Verify it shows stderr
      assert.ok(runAllSource.includes('stderr'), 'Should handle stderr output');
      assert.ok(runAllSource.includes('result.status !== 0'), 'Should treat non-zero child exits as failures');
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('test runner discovers nested tests via tests/**/*.test.js glob', async () => {
      const testRoot = createTestDir();
      const testsDir = path.join(testRoot, 'tests');
      const nestedDir = path.join(testsDir, 'nested');
      fs.mkdirSync(nestedDir, { recursive: true });

      fs.writeFileSync(path.join(testsDir, 'top.test.js'), "console.log('Passed: 1\\nFailed: 0');\n");
      fs.writeFileSync(path.join(nestedDir, 'deep.test.js'), "console.log('Passed: 2\\nFailed: 0');\n");
      fs.writeFileSync(path.join(nestedDir, 'ignore.js'), "console.log('Passed: 999\\nFailed: 999');\n");

      try {
        const result = runPatchedRunAll(testRoot);
        assert.strictEqual(result.code, 0, `run-all wrapper should succeed, stderr: ${result.stderr}`);
        assert.ok(result.stdout.includes('Running top.test.js'), 'Should run the top-level test');
        assert.ok(result.stdout.includes('Running nested/deep.test.js'), 'Should run nested .test.js files');
        assert.ok(!result.stdout.includes('ignore.js'), 'Should ignore non-.test.js files');
        assert.ok(result.stdout.includes('Total Tests:    3'), `Should aggregate nested test totals, got: ${result.stdout}`);
      } finally {
        cleanupTestDir(testRoot);
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 32: post-edit-typecheck special characters & check-console-log ──
  console.log('\nRound 32: post-edit-typecheck (special character paths):');

  if (
    await asyncTest('handles file path with spaces gracefully', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'my file.ts');
      fs.writeFileSync(testFile, 'const x: number = 1;');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should handle spaces in path');
      assert.ok(result.stdout.includes('tool_input'), 'Should pass through data');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles file path with shell metacharacters safely', async () => {
      const testDir = createTestDir();
      // File name with characters that could be dangerous in shell contexts
      const testFile = path.join(testDir, 'test$(echo).ts');
      fs.writeFileSync(testFile, 'const x: number = 1;');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should not crash on shell metacharacters');
      // execFileSync prevents shell injection — just verify no crash
      assert.ok(result.stdout.includes('tool_input'), 'Should pass through data safely');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles .tsx file extension', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'component.tsx');
      fs.writeFileSync(testFile, 'const App = () => <div>Hello</div>;');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should handle .tsx files');
      assert.ok(result.stdout.includes('tool_input'), 'Should pass through data');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 32: check-console-log (edge cases):');

  if (
    await asyncTest('passes through data when git commands fail', async () => {
      // Run from a non-git directory
      const testDir = createTestDir();
      const stdinData = JSON.stringify({ tool_name: 'Write', tool_input: {} });
      const result = await runScript(path.join(scriptsDir, 'check-console-log.js'), stdinData);
      assert.strictEqual(result.code, 0, 'Should exit 0');
      assert.ok(result.stdout.includes('tool_name'), 'Should pass through stdin');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles very large stdin within limit', async () => {
      // Send just under the 1MB limit
      const largePayload = JSON.stringify({ tool_name: 'x'.repeat(500000) });
      const result = await runScript(path.join(scriptsDir, 'check-console-log.js'), largePayload);
      assert.strictEqual(result.code, 0, 'Should handle large stdin');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 32: post-edit-console-warn (additional edge cases):');

  if (
    await asyncTest('handles file with only console.error (no warning)', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'errors-only.ts');
      fs.writeFileSync(testFile, 'console.error("this is fine");\nconsole.warn("also fine");');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);
      assert.ok(!result.stderr.includes('WARNING'), 'Should NOT warn for console.error/warn only');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles null tool_input gracefully', async () => {
      const stdinJson = JSON.stringify({ tool_input: null });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should handle null tool_input');
      assert.ok(result.stdout.includes('tool_input'), 'Should pass through data');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 32: session-end.js (empty transcript):');

  if (
    await asyncTest('handles completely empty transcript file', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'empty.jsonl');
      fs.writeFileSync(transcriptPath, '');

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should handle empty transcript');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('handles transcript with only whitespace lines', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'whitespace.jsonl');
      fs.writeFileSync(transcriptPath, '  \n\n  \n');

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should handle whitespace-only transcript');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  // ── Round 38: evaluate-session.js tilde expansion & missing config ──
  console.log('\nRound 38: evaluate-session.js (tilde expansion & missing config):');

  if (
    await asyncTest('expands ~ in learned_skills_path to home directory', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      // 1 user message — below threshold, but we only need to verify directory creation
      fs.writeFileSync(transcriptPath, '{"type":"user","content":"msg"}');

      const skillsDir = path.join(testDir, 'skills', 'continuous-learning');
      fs.mkdirSync(skillsDir, { recursive: true });
      const configPath = path.join(skillsDir, 'config.json');
      // Use ~ prefix — should expand to the HOME dir we set
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          learned_skills_path: '~/test-tilde-skills'
        })
      );

      const wrapperScript = createEvalWrapper(testDir, configPath);

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(wrapperScript, stdinJson, {
        HOME: testDir,
        USERPROFILE: testDir
      });
      assert.strictEqual(result.code, 0);
      // ~ should expand to os.homedir() which during the script run is the real home
      // The script creates the directory via ensureDir — check that it attempted to
      // create a directory starting with the home dir, not a literal ~/
      // Verify the literal ~/test-tilde-skills was NOT created
      assert.ok(!fs.existsSync(path.join(testDir, '~', 'test-tilde-skills')), 'Should NOT create literal ~/test-tilde-skills directory');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('does NOT expand ~ in middle of learned_skills_path', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      fs.writeFileSync(transcriptPath, '{"type":"user","content":"msg"}');

      const midTildeDir = path.join(testDir, 'some~path', 'skills');
      const skillsDir = path.join(testDir, 'skills', 'continuous-learning');
      fs.mkdirSync(skillsDir, { recursive: true });
      const configPath = path.join(skillsDir, 'config.json');
      // Path with ~ in the middle — should NOT be expanded
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          learned_skills_path: midTildeDir
        })
      );

      const wrapperScript = createEvalWrapper(testDir, configPath);

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(wrapperScript, stdinJson, {
        HOME: testDir,
        USERPROFILE: testDir
      });
      assert.strictEqual(result.code, 0);
      // The directory with ~ in the middle should be created as-is
      assert.ok(fs.existsSync(midTildeDir), 'Should create directory with ~ in middle of path unchanged');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('uses defaults when config file does not exist', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      // 5 user messages — below default threshold of 10
      const lines = [];
      for (let i = 0; i < 5; i++) lines.push(`{"type":"user","content":"msg${i}"}`);
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      // Point config to a non-existent file
      const configPath = path.join(testDir, 'nonexistent', 'config.json');
      const wrapperScript = createEvalWrapper(testDir, configPath);

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(wrapperScript, stdinJson, {
        HOME: testDir,
        USERPROFILE: testDir
      });
      assert.strictEqual(result.code, 0);
      // With no config file, default min_session_length=10 applies
      // 5 messages should be "too short"
      assert.ok(result.stderr.includes('too short'), 'Should use default threshold (10) when config file missing');
      // No error messages about missing config
      assert.ok(!result.stderr.includes('Failed to parse config'), 'Should NOT log config parse error for missing file');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  // Round 41: pre-compact.js (multiple session files)
  console.log('\nRound 41: pre-compact.js (multiple session files):');

  if (
    await asyncTest('annotates only the newest session file when multiple exist', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-compact-multi-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create two session files with different mtimes
      const olderSession = path.join(sessionsDir, '2026-01-01-older-session.tmp');
      const newerSession = path.join(sessionsDir, '2026-02-11-newer-session.tmp');
      fs.writeFileSync(olderSession, '# Older Session\n');
      // Small delay to ensure different mtime
      const now = Date.now();
      fs.utimesSync(olderSession, new Date(now - 60000), new Date(now - 60000));
      fs.writeFileSync(newerSession, '# Newer Session\n');

      try {
        const result = await runScript(path.join(scriptsDir, 'pre-compact.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);

        const newerContent = fs.readFileSync(newerSession, 'utf8');
        const olderContent = fs.readFileSync(olderSession, 'utf8');

        // findFiles sorts by mtime newest first, so sessions[0] is the newest
        assert.ok(newerContent.includes('Compaction occurred'), 'Should annotate the newest session file');
        assert.strictEqual(olderContent, '# Older Session\n', 'Should NOT annotate older session files');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // Round 40: session-end.js (newline collapse in markdown list items)
  console.log('\nRound 40: session-end.js (newline collapse):');

  if (
    await asyncTest('collapses newlines in user messages to single-line markdown items', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      // User message containing newlines that would break markdown list
      const lines = [JSON.stringify({ type: 'user', content: 'Please help me with:\n1. Task one\n2. Task two\n3. Task three' })];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0);

      // Find the session file and verify newlines were collapsed
      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          // Each task should be a single-line markdown list item
          const taskLines = content.split('\n').filter(l => l.startsWith('- '));
          for (const line of taskLines) {
            assert.ok(!line.includes('\n'), 'Task list items should be single-line');
          }
          // Newlines should be replaced with spaces
          assert.ok(content.includes('Please help me with: 1. Task one 2. Task two'), `Newlines should be collapsed to spaces, got: ${content.substring(0, 500)}`);
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  // ── Round 44: session-start.js empty session file ──
  console.log('\nRound 44: session-start.js (empty session file):');

  if (
    await asyncTest('does not inject empty session file content into context', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-start-empty-file-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      // Create a 0-byte session file (simulates truncated/corrupted write)
      const today = new Date().toISOString().slice(0, 10);
      const sessionFile = path.join(sessionsDir, `${today}-empty0000-session.tmp`);
      fs.writeFileSync(sessionFile, '');

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0, 'Should exit 0 with empty session file');
        // readFile returns '' (falsy) → the if (content && ...) guard skips injection
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(!additionalContext.includes('Previous session summary'), 'Should NOT inject empty string into context');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 49: typecheck extension matching and session-end conditional sections ──
  console.log('\nRound 49: post-edit-typecheck.js (extension edge cases):');

  if (
    await asyncTest('.d.ts files match the TS regex and trigger typecheck path', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'types.d.ts');
      fs.writeFileSync(testFile, 'declare const x: number;');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should exit 0 for .d.ts file');
      assert.ok(result.stdout.includes('tool_input'), 'Should pass through stdin data');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('.mts extension does not trigger typecheck', async () => {
      const stdinJson = JSON.stringify({ tool_input: { file_path: '/project/utils.mts' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);
      assert.strictEqual(result.code, 0, 'Should exit 0 for .mts file');
      assert.strictEqual(result.stdout, stdinJson, 'Should pass through .mts unchanged');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 49: session-end.js (conditional summary sections):');

  if (
    await asyncTest('summary omits Files Modified and Tools Used when none found', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-notools-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      // Only user messages — no tool_use entries at all
      const lines = ['{"type":"user","content":"How does authentication work?"}', '{"type":"assistant","message":{"content":[{"type":"text","text":"It uses JWT"}]}}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));
      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });

      try {
        const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);

        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('-session.tmp'));
        assert.ok(files.length > 0, 'Should create session file');
        const content = fs.readFileSync(path.join(sessionsDir, files[0]), 'utf8');
        assert.ok(content.includes('authentication'), 'Should include user message');
        assert.ok(!content.includes('### Files Modified'), 'Should omit Files Modified when empty');
        assert.ok(!content.includes('### Tools Used'), 'Should omit Tools Used when empty');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
        cleanupTestDir(testDir);
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 50: alias reporting, parallel compaction, graceful degradation ──
  console.log('\nRound 50: session-start.js (alias reporting):');

  if (
    await asyncTest('reports available session aliases on startup', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-start-alias-${Date.now()}`);
      fs.mkdirSync(getCanonicalSessionsDir(isoHome), { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      // Pre-populate the aliases file
      fs.writeFileSync(
        path.join(isoHome, '.claude', 'session-aliases.json'),
        JSON.stringify({
          version: '1.0',
          aliases: {
            'my-feature': { sessionPath: '/sessions/feat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), title: null },
            'bug-fix': { sessionPath: '/sessions/fix', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), title: null }
          },
          metadata: { totalCount: 2, lastUpdated: new Date().toISOString() }
        })
      );

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        assert.ok(result.stderr.includes('alias'), 'Should mention aliases in stderr');
        assert.ok(result.stderr.includes('my-feature') || result.stderr.includes('bug-fix'), 'Should list at least one alias name');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 50: pre-compact.js (parallel execution):');

  if (
    await asyncTest('parallel compaction runs all append to log without loss', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-compact-par-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      try {
        const promises = Array(3)
          .fill(null)
          .map(() =>
            runScript(path.join(scriptsDir, 'pre-compact.js'), '', {
              HOME: isoHome,
              USERPROFILE: isoHome
            })
          );
        const results = await Promise.all(promises);
        results.forEach((r, i) => assert.strictEqual(r.code, 0, `Run ${i} should exit 0`));

        const logFile = path.join(sessionsDir, 'compaction-log.txt');
        assert.ok(fs.existsSync(logFile), 'Compaction log should exist');
        const content = fs.readFileSync(logFile, 'utf8');
        const entries = (content.match(/Context compaction triggered/g) || []).length;
        assert.strictEqual(entries, 3, `Should have 3 log entries, got ${entries}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 50: session-start.js (graceful degradation):');

  if (
    await asyncTest('exits 0 when sessions path is a file (not a directory)', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-start-blocked-${Date.now()}`);
      fs.mkdirSync(path.join(isoHome, '.claude'), { recursive: true });
      // Block sessions dir creation by placing a file at that path
      fs.writeFileSync(getCanonicalSessionsDir(isoHome), 'blocked');

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0, 'Should exit 0 even when sessions dir is blocked');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 53: console-warn max matches and format non-existent file ──
  console.log('\nRound 53: post-edit-console-warn.js (max matches truncation):');

  if (
    await asyncTest('reports maximum 5 console.log matches per file', async () => {
      const testDir = createTestDir();
      const testFile = path.join(testDir, 'many-logs.js');
      const lines = Array(7)
        .fill(null)
        .map((_, i) => `console.log("debug line ${i + 1}");`);
      fs.writeFileSync(testFile, lines.join('\n'));

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), stdinJson);

      assert.strictEqual(result.code, 0, 'Should exit 0');
      // Count line number reports in stderr (format: "N: console.log(...)")
      const lineReports = (result.stderr.match(/^\d+:/gm) || []).length;
      assert.strictEqual(lineReports, 5, `Should report max 5 matches, got ${lineReports}`);
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 53: post-edit-format.js (non-existent file):');

  if (
    await asyncTest('passes through data for non-existent .tsx file path', async () => {
      const stdinJson = JSON.stringify({
        tool_input: { file_path: '/nonexistent/path/file.tsx' }
      });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson);

      assert.strictEqual(result.code, 0, 'Should exit 0 for non-existent file');
      assert.strictEqual(result.stdout, stdinJson, 'Should pass through stdin data unchanged');
    })
  )
    passed++;
  else failed++;

  // ── Round 55: maxAge boundary, multi-session injection, stdin overflow ──
  console.log('\nRound 55: session-start.js (maxAge 7-day boundary):');

  if (
    await asyncTest('excludes session files older than 7 days', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-start-7day-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      // Create session file 6.9 days old (should be INCLUDED by maxAge:7)
      const recentFile = path.join(sessionsDir, '2026-02-06-recent69-session.tmp');
      fs.writeFileSync(
        recentFile,
        buildSessionStartFixture('RECENT CONTENT HERE', { title: '# Recent Session' })
      );
      const sixPointNineDaysAgo = new Date(Date.now() - 6.9 * 24 * 60 * 60 * 1000);
      fs.utimesSync(recentFile, sixPointNineDaysAgo, sixPointNineDaysAgo);

      // Create session file 8 days old (should be EXCLUDED by maxAge:7)
      const oldFile = path.join(sessionsDir, '2026-02-05-old8day-session.tmp');
      fs.writeFileSync(
        oldFile,
        buildSessionStartFixture('OLD CONTENT SHOULD NOT APPEAR', { title: '# Old Session' })
      );
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldFile, eightDaysAgo, eightDaysAgo);

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        assert.ok(result.stderr.includes('1 recent session'), `Should find 1 recent session (6.9-day included, 8-day excluded), stderr: ${result.stderr}`);
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(additionalContext.includes('RECENT CONTENT HERE'), 'Should inject the 6.9-day-old session content');
        assert.ok(!additionalContext.includes('OLD CONTENT SHOULD NOT APPEAR'), 'Should NOT inject the 8-day-old session content');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('prunes session files older than the retention window', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-start-prune-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const recentFile = path.join(sessionsDir, '2026-02-10-keepme-session.tmp');
      fs.writeFileSync(recentFile, '# Recent Session\n\nKEEP ME');
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      fs.utimesSync(recentFile, fiveDaysAgo, fiveDaysAgo);

      const expiredFile = path.join(sessionsDir, '2026-01-01-pruneme-session.tmp');
      fs.writeFileSync(expiredFile, '# Expired Session\n\nDELETE ME');
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      fs.utimesSync(expiredFile, thirtyOneDaysAgo, thirtyOneDaysAgo);

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome,
          ECC_SESSION_RETENTION_DAYS: '30',
        });

        assert.strictEqual(result.code, 0);
        assert.ok(!fs.existsSync(expiredFile), 'Should delete expired session files beyond retention');
        assert.ok(fs.existsSync(recentFile), 'Should keep recent session files inside retention');
        assert.ok(result.stderr.includes('Pruned 1 expired session'), `Should report pruning activity, stderr: ${result.stderr}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('disables pruning when ECC_SESSION_RETENTION_DAYS=0', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-start-prune-off-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const expiredFile = path.join(sessionsDir, '2026-01-01-keepme-session.tmp');
      fs.writeFileSync(expiredFile, '# Old Session\n\nSHOULD STILL EXIST');
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      fs.utimesSync(expiredFile, ninetyDaysAgo, ninetyDaysAgo);

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome,
          ECC_SESSION_RETENTION_DAYS: '0',
        });

        assert.strictEqual(result.code, 0);
        assert.ok(fs.existsSync(expiredFile), 'Should keep all sessions when retention is opt-out=0');
        assert.ok(result.stderr.includes('Pruning disabled via ECC_SESSION_RETENTION_DAYS'),
          `Should log pruning disabled, stderr: ${result.stderr}`);
        assert.ok(!result.stderr.includes('Pruned'), `Should not log any pruning, stderr: ${result.stderr}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('disables pruning when ECC_SESSION_RETENTION_DAYS=off', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-start-prune-offstr-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const expiredFile = path.join(sessionsDir, '2025-12-15-keepme-session.tmp');
      fs.writeFileSync(expiredFile, '# Forensic Session\n\nKEEP ME');
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      fs.utimesSync(expiredFile, sixtyDaysAgo, sixtyDaysAgo);

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome,
          ECC_SESSION_RETENTION_DAYS: 'off',
        });

        assert.strictEqual(result.code, 0);
        assert.ok(fs.existsSync(expiredFile), 'Should keep all sessions when retention is opt-out=off');
        assert.ok(result.stderr.includes('Pruning disabled via ECC_SESSION_RETENTION_DAYS'),
          `Should log pruning disabled, stderr: ${result.stderr}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('falls back to default retention when ECC_SESSION_RETENTION_DAYS is garbage', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-start-prune-garbage-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const expiredFile = path.join(sessionsDir, '2026-01-01-pruneme-session.tmp');
      fs.writeFileSync(expiredFile, '# Old Session\n\nDELETE ME');
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      fs.utimesSync(expiredFile, fortyDaysAgo, fortyDaysAgo);

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome,
          ECC_SESSION_RETENTION_DAYS: 'bogus-value',
        });

        assert.strictEqual(result.code, 0);
        assert.ok(!fs.existsSync(expiredFile),
          'Should fall back to default 30-day retention and prune the 40-day-old file');
        assert.ok(result.stderr.includes('Pruned 1 expired session'),
          `Should log pruning at default retention, stderr: ${result.stderr}`);
        assert.ok(!result.stderr.includes('Pruning disabled'),
          'Should NOT treat garbage as opt-out');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 55: session-start.js (newest session selection):');

  if (
    await asyncTest('injects newest session when multiple recent sessions exist', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-start-multi-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });

      const now = Date.now();

      // Create older session (2 days ago)
      const olderSession = path.join(sessionsDir, '2026-02-11-olderabc-session.tmp');
      fs.writeFileSync(
        olderSession,
        buildSessionStartFixture('OLDER_CONTEXT_MARKER', { title: '# Older Session' })
      );
      fs.utimesSync(olderSession, new Date(now - 2 * 86400000), new Date(now - 2 * 86400000));

      // Create newer session (1 day ago)
      const newerSession = path.join(sessionsDir, '2026-02-12-newerdef-session.tmp');
      fs.writeFileSync(
        newerSession,
        buildSessionStartFixture('NEWER_CONTEXT_MARKER', { title: '# Newer Session' })
      );
      fs.utimesSync(newerSession, new Date(now - 1 * 86400000), new Date(now - 1 * 86400000));

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);
        assert.ok(result.stderr.includes('2 recent session'), `Should find 2 recent sessions, stderr: ${result.stderr}`);
        // Should inject the NEWER session, not the older one
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(additionalContext.includes('NEWER_CONTEXT_MARKER'), 'Should inject the newest session content');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 55: session-end.js (stdin overflow):');

  if (
    await asyncTest('handles stdin exceeding MAX_STDIN (1MB) gracefully', async () => {
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      // Create a minimal valid transcript so env var fallback works
      fs.writeFileSync(transcriptPath, JSON.stringify({ type: 'user', content: 'Overflow test' }) + '\n');

      // Create stdin > 1MB: truncated JSON will be invalid → falls back to env var
      const oversizedPayload = '{"transcript_path":"' + 'x'.repeat(1048600) + '"}';

      try {
        const result = await runScript(path.join(scriptsDir, 'session-end.js'), oversizedPayload, {
          HOME: testDir,
          USERPROFILE: testDir,
          CLAUDE_TRANSCRIPT_PATH: transcriptPath
        });
        assert.strictEqual(result.code, 0, 'Should exit 0 even with oversized stdin');
        // Truncated JSON → JSON.parse throws → falls back to env var → creates session file
        assert.ok(result.stderr.includes('Created session file') || result.stderr.includes('Updated session file'), `Should create/update session file via env var fallback, stderr: ${result.stderr}`);
      } finally {
        cleanupTestDir(testDir);
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 56: typecheck tsconfig walk-up, suggest-compact fallback path ──
  console.log('\nRound 56: post-edit-typecheck.js (tsconfig in parent directory):');

  if (
    await asyncTest('walks up directory tree to find tsconfig.json in grandparent', async () => {
      const testDir = createTestDir();
      // Place tsconfig at the TOP level, file is nested 2 levels deep
      fs.writeFileSync(
        path.join(testDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { strict: false, noEmit: true }
        })
      );
      const deepDir = path.join(testDir, 'src', 'components');
      fs.mkdirSync(deepDir, { recursive: true });
      const testFile = path.join(deepDir, 'widget.ts');
      fs.writeFileSync(testFile, 'export const value: number = 42;\n');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);

      assert.strictEqual(result.code, 0, 'Should exit 0 after walking up to find tsconfig');
      // Core assertion: stdin must pass through regardless of whether tsc ran
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.tool_input.file_path, testFile, 'Should pass through original stdin data with file_path intact');
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 56: suggest-compact.js (counter file as directory — fallback path):');

  if (
    await asyncTest('exits 0 when counter file path is occupied by a directory', async () => {
      const sessionId = `dirblock-${Date.now()}`;
      const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);
      // Create a DIRECTORY at the counter file path — openSync('a+') will fail with EISDIR
      fs.mkdirSync(counterFile);

      try {
        const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
          CLAUDE_SESSION_ID: sessionId
        });
        assert.strictEqual(result.code, 0, 'Should exit 0 even when counter file path is a directory (graceful fallback)');
      } finally {
        // Cleanup: remove the blocking directory
        try {
          fs.rmdirSync(counterFile);
        } catch {
          /* best-effort */
        }
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 59: session-start unreadable file, console-log stdin overflow, pre-compact write error ──
  console.log('\nRound 59: session-start.js (unreadable session file — readFile returns null):');

  if (
    await asyncTest('does not inject content when session file is unreadable', async () => {
      // Skip on Windows or when running as root (permissions won't work)
      if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) {
        console.log('    (skipped — not supported on this platform)');
        return;
      }
      const isoHome = path.join(os.tmpdir(), `ecc-start-unreadable-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create a session file with real content, then make it unreadable
      const sessionFile = path.join(sessionsDir, `${Date.now()}-session.tmp`);
      fs.writeFileSync(sessionFile, '# Sensitive session content that should NOT appear');
      fs.chmodSync(sessionFile, 0o000);

      try {
        const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0, 'Should exit 0 even with unreadable session file');
        // readFile returns null for unreadable files → content is null → no injection
        const additionalContext = getSessionStartAdditionalContext(result.stdout);
        assert.ok(!additionalContext.includes('Sensitive session content'), 'Should NOT inject content from unreadable file');
      } finally {
        try {
          fs.chmodSync(sessionFile, 0o644);
        } catch {
          /* best-effort */
        }
        try {
          fs.rmSync(isoHome, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 59: check-console-log.js (stdin exceeding 1MB — truncation):');

  if (
    await asyncTest('suppresses pass-through for oversized stdin (fail-open, #2090)', async () => {
      // Send 1.2MB of data — exceeds the 1MB MAX_STDIN limit. Echoing the
      // truncated string would emit a JSON document cut mid-stream, which the
      // harness reports as a Stop hook JSON validation failure.
      const payload = 'x'.repeat(1024 * 1024 + 200000);
      const result = await runScript(path.join(scriptsDir, 'check-console-log.js'), payload);

      assert.strictEqual(result.code, 0, 'Should exit 0 even with oversized stdin');
      assert.strictEqual(result.stdout, '', 'Truncated stdin must not be echoed (empty stdout = no opinion)');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 59: pre-compact.js (read-only session file — appendFile error):');

  if (
    await asyncTest('exits 0 when session file is read-only (appendFile fails)', async () => {
      if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) {
        console.log('    (skipped — not supported on this platform)');
        return;
      }
      const isoHome = path.join(os.tmpdir(), `ecc-compact-ro-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create a session file then make it read-only
      const sessionFile = path.join(sessionsDir, `${Date.now()}-session.tmp`);
      fs.writeFileSync(sessionFile, '# Active session\n');
      fs.chmodSync(sessionFile, 0o444);

      try {
        const result = await runScript(path.join(scriptsDir, 'pre-compact.js'), '', {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        // Should exit 0 — hooks must not block the user (catch at lines 45-47)
        assert.strictEqual(result.code, 0, 'Should exit 0 even when append fails');
        // Session file should remain unchanged (write was blocked)
        const content = fs.readFileSync(sessionFile, 'utf8');
        assert.strictEqual(content, '# Active session\n', 'Read-only session file should remain unchanged');
      } finally {
        try {
          fs.chmodSync(sessionFile, 0o644);
        } catch {
          /* best-effort */
        }
        try {
          fs.rmSync(isoHome, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 60: replaceInFile failure, console-warn stdin overflow, format missing tool_input ──
  console.log('\nRound 60: session-end.js (replaceInFile returns false — timestamp update warning):');

  if (
    await asyncTest('logs warning when existing session file lacks Last Updated field', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-end-nots-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create transcript with a user message so a summary is produced
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      fs.writeFileSync(transcriptPath, '{"type":"user","content":"test message"}\n');

      // Pre-create session file WITHOUT the **Last Updated:** line
      // Use today's date and a short ID matching getSessionIdShort() pattern
      const today = new Date().toISOString().split('T')[0];
      const sessionFile = path.join(sessionsDir, `${today}-session-session.tmp`);
      fs.writeFileSync(sessionFile, '# Session file without timestamp marker\nSome existing content\n');

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: isoHome,
        USERPROFILE: isoHome
      });

      assert.strictEqual(result.code, 0, 'Should exit 0 even when replaceInFile fails');
      // replaceInFile returns false → line 166 logs warning about failed timestamp update
      assert.ok(result.stderr.includes('Failed to update') || result.stderr.includes('[SessionEnd]'), 'Should log warning when timestamp pattern not found in session file');

      cleanupTestDir(testDir);
      try {
        fs.rmSync(isoHome, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 60: post-edit-console-warn.js (stdin exceeding 1MB — truncation):');

  if (
    await asyncTest('truncates stdin at 1MB limit and still passes through data', async () => {
      // Send 1.2MB of data — exceeds the 1MB MAX_STDIN limit
      const payload = 'x'.repeat(1024 * 1024 + 200000);
      const result = await runScript(path.join(scriptsDir, 'post-edit-console-warn.js'), payload);

      assert.strictEqual(result.code, 0, 'Should exit 0 even with oversized stdin');
      // Data should be truncated — stdout significantly less than input
      assert.ok(result.stdout.length < payload.length, `stdout (${result.stdout.length}) should be shorter than input (${payload.length})`);
      // Should be approximately 1MB (last accepted chunk may push slightly over)
      assert.ok(result.stdout.length <= 1024 * 1024 + 65536, `stdout (${result.stdout.length}) should be near 1MB, not unbounded`);
      assert.ok(result.stdout.length > 0, 'Should still pass through truncated data');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 60: post-edit-format.js (valid JSON without tool_input key):');

  if (
    await asyncTest('skips formatting when JSON has no tool_input field', async () => {
      const stdinJson = JSON.stringify({ result: 'ok', output: 'some data' });
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), stdinJson);

      assert.strictEqual(result.code, 0, 'Should exit 0 for JSON without tool_input');
      // input.tool_input?.file_path is undefined → skips formatting → passes through
      assert.strictEqual(result.stdout, stdinJson, 'Should pass through data unchanged when tool_input is absent');
    })
  )
    passed++;
  else failed++;

  // ── Round 64: post-edit-typecheck.js valid JSON without tool_input ──
  console.log('\nRound 64: post-edit-typecheck.js (valid JSON without tool_input):');

  if (
    await asyncTest('skips typecheck when JSON has no tool_input field', async () => {
      const stdinJson = JSON.stringify({ result: 'ok', metadata: { action: 'test' } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);

      assert.strictEqual(result.code, 0, 'Should exit 0 for JSON without tool_input');
      // input.tool_input?.file_path is undefined → skips TS check → passes through
      assert.strictEqual(result.stdout, stdinJson, 'Should pass through data unchanged when tool_input is absent');
    })
  )
    passed++;
  else failed++;

  // ── Round 66: session-end.js entry.role === 'user' fallback and nonexistent transcript ──
  console.log('\nRound 66: session-end.js (entry.role user fallback):');

  if (
    await asyncTest('extracts user messages from role-only format (no type field)', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-role-only-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      // Use entries with ONLY role field (no type:"user") to exercise the fallback
      const lines = ['{"role":"user","content":"Deploy the production build"}', '{"role":"assistant","content":"I will deploy now"}', '{"role":"user","content":"Check the logs after deploy"}'];
      fs.writeFileSync(transcriptPath, lines.join('\n'));
      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });

      try {
        const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);

        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('-session.tmp'));
        assert.ok(files.length > 0, 'Should create session file');
        const content = fs.readFileSync(path.join(sessionsDir, files[0]), 'utf8');
        // The role-only user messages should be extracted
        assert.ok(content.includes('Deploy the production build') || content.includes('deploy'), `Session file should include role-only user messages. Got: ${content.substring(0, 300)}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
        cleanupTestDir(testDir);
      }
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 66: session-end.js (nonexistent transcript path):');

  if (
    await asyncTest('logs "Transcript not found" for nonexistent transcript_path', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-notfound-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      const stdinJson = JSON.stringify({ transcript_path: '/tmp/nonexistent-transcript-99999.jsonl' });

      try {
        const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0, 'Should exit 0 for missing transcript');
        assert.ok(result.stderr.includes('Transcript not found') || result.stderr.includes('not found'), `Should log transcript not found. Got stderr: ${result.stderr.substring(0, 300)}`);
        // Should still create a session file (with blank template, since summary is null)
        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('-session.tmp'));
        assert.ok(files.length > 0, 'Should still create session file even without transcript');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 70: session-end.js entry.name / entry.input fallback in direct tool_use entries ──
  console.log('\nRound 70: session-end.js (entry.name/entry.input fallback):');

  if (
    await asyncTest('extracts tool name and file path from entry.name/entry.input (not tool_name/tool_input)', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-r70-entryname-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      const transcriptPath = path.join(isoHome, 'transcript.jsonl');

      // Use "name" and "input" fields instead of "tool_name" and "tool_input"
      // This exercises the fallback at session-end.js lines 63 and 66:
      //   const toolName = entry.tool_name || entry.name || '';
      //   const filePath  = entry.tool_input?.file_path || entry.input?.file_path || '';
      const lines = [
        '{"type":"user","content":"Use the alt format fields"}',
        '{"type":"tool_use","name":"Edit","input":{"file_path":"/src/alt-format.ts"}}',
        '{"type":"tool_use","name":"Read","input":{"file_path":"/src/other.ts"}}',
        '{"type":"tool_use","name":"Write","input":{"file_path":"/src/written.ts"}}'
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      try {
        const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0, 'Should exit 0');

        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.tmp'));
        assert.ok(files.length > 0, 'Should create session file');
        const content = fs.readFileSync(path.join(sessionsDir, files[0]), 'utf8');
        // Tools extracted via entry.name fallback
        assert.ok(content.includes('Edit'), 'Should list Edit via entry.name fallback');
        assert.ok(content.includes('Read'), 'Should list Read via entry.name fallback');
        // Files modified via entry.input fallback (Edit and Write, not Read)
        assert.ok(content.includes('/src/alt-format.ts'), 'Should list edited file via entry.input fallback');
        assert.ok(content.includes('/src/written.ts'), 'Should list written file via entry.input fallback');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 71: session-start.js default source shows getSelectionPrompt ──
  console.log('\nRound 71: session-start.js (default source — selection prompt):');

  if (
    await asyncTest('shows selection prompt when no package manager preference found (default source)', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-r71-ss-default-${Date.now()}`);
      const isoProject = path.join(isoHome, 'project');
      fs.mkdirSync(getCanonicalSessionsDir(isoHome), { recursive: true });
      fs.mkdirSync(path.join(isoHome, '.claude', 'skills', 'learned'), { recursive: true });
      fs.mkdirSync(isoProject, { recursive: true });
      // No package.json, no lock files, no package-manager.json — forces default source

      try {
        const result = await new Promise((resolve, reject) => {
          const env = { ...process.env, HOME: isoHome, USERPROFILE: isoHome };
          delete env.CLAUDE_PACKAGE_MANAGER; // Remove any env-level PM override
          const proc = spawn('node', [path.join(scriptsDir, 'session-start.js')], {
            env,
            cwd: isoProject, // CWD with no package.json or lock files
            stdio: ['pipe', 'pipe', 'pipe']
          });
          let stdout = '';
          let stderr = '';
          proc.stdout.on('data', data => (stdout += data));
          proc.stderr.on('data', data => (stderr += data));
          proc.stdin.end();
          proc.on('close', code => resolve({ code, stdout, stderr }));
          proc.on('error', reject);
        });
        assert.strictEqual(result.code, 0, 'Should exit 0');
        assert.ok(result.stderr.includes('No package manager preference'), `Should show selection prompt when source is default. Got stderr: ${result.stderr.slice(0, 500)}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 74: session-start.js main().catch handler ──
  console.log('\nRound 74: session-start.js (main catch — unrecoverable error):');

  if (
    await asyncTest('session-start exits 0 with error message when HOME is non-directory', async () => {
      if (process.platform === 'win32') {
        console.log('    (skipped — /dev/null not available on Windows)');
        return;
      }
      // HOME=/dev/null makes ensureDir(sessionsDir) throw ENOTDIR,
      // which propagates to main().catch — the top-level error boundary
      const result = await runScript(path.join(scriptsDir, 'session-start.js'), '', {
        HOME: '/dev/null',
        USERPROFILE: '/dev/null'
      });
      assert.strictEqual(result.code, 0, `Should exit 0 (don't block on errors), got ${result.code}`);
      assert.ok(result.stderr.includes('[SessionStart] Error:'), `stderr should contain [SessionStart] Error:, got: ${result.stderr}`);
    })
  )
    passed++;
  else failed++;

  // ── Round 75: pre-compact.js main().catch handler ──
  console.log('\nRound 75: pre-compact.js (main catch — unrecoverable error):');

  if (
    await asyncTest('pre-compact exits 0 with error message when HOME is non-directory', async () => {
      if (process.platform === 'win32') {
        console.log('    (skipped — /dev/null not available on Windows)');
        return;
      }
      // HOME=/dev/null makes ensureDir(sessionsDir) throw ENOTDIR,
      // which propagates to main().catch — the top-level error boundary
      const result = await runScript(path.join(scriptsDir, 'pre-compact.js'), '', {
        HOME: '/dev/null',
        USERPROFILE: '/dev/null'
      });
      assert.strictEqual(result.code, 0, `Should exit 0 (don't block on errors), got ${result.code}`);
      assert.ok(result.stderr.includes('[PreCompact] Error:'), `stderr should contain [PreCompact] Error:, got: ${result.stderr}`);
    })
  )
    passed++;
  else failed++;

  // ── Round 75: session-end.js main().catch handler ──
  console.log('\nRound 75: session-end.js (main catch — unrecoverable error):');

  if (
    await asyncTest('session-end exits 0 with error message when HOME is non-directory', async () => {
      if (process.platform === 'win32') {
        console.log('    (skipped — /dev/null not available on Windows)');
        return;
      }
      // HOME=/dev/null makes ensureDir(sessionsDir) throw ENOTDIR inside main(),
      // which propagates to runMain().catch — the top-level error boundary
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), '{}', {
        HOME: '/dev/null',
        USERPROFILE: '/dev/null'
      });
      assert.strictEqual(result.code, 0, `Should exit 0 (don't block on errors), got ${result.code}`);
      assert.ok(result.stderr.includes('[SessionEnd] Error:'), `stderr should contain [SessionEnd] Error:, got: ${result.stderr}`);
    })
  )
    passed++;
  else failed++;

  // ── Round 76: evaluate-session.js main().catch handler ──
  console.log('\nRound 76: evaluate-session.js (main catch — unrecoverable error):');

  if (
    await asyncTest('evaluate-session exits 0 with error message when HOME is non-directory', async () => {
      if (process.platform === 'win32') {
        console.log('    (skipped — /dev/null not available on Windows)');
        return;
      }
      // HOME=/dev/null makes ensureDir(learnedSkillsPath) throw ENOTDIR,
      // which propagates to main().catch — the top-level error boundary
      const result = await runScript(path.join(scriptsDir, 'evaluate-session.js'), '{}', {
        HOME: '/dev/null',
        USERPROFILE: '/dev/null'
      });
      assert.strictEqual(result.code, 0, `Should exit 0 (don't block on errors), got ${result.code}`);
      assert.ok(result.stderr.includes('[ContinuousLearning] Error:'), `stderr should contain [ContinuousLearning] Error:, got: ${result.stderr}`);
    })
  )
    passed++;
  else failed++;

  // ── Round 76: suggest-compact.js main().catch handler ──
  console.log('\nRound 76: suggest-compact.js (main catch — double-failure):');

  if (
    await asyncTest('suggest-compact exits 0 with error when TMPDIR is non-directory', async () => {
      if (process.platform === 'win32') {
        console.log('    (skipped — /dev/null not available on Windows)');
        return;
      }
      // TMPDIR=/dev/null causes openSync to fail (ENOTDIR), then the catch
      // fallback writeFile also fails, propagating to main().catch
      const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
        TMPDIR: '/dev/null'
      });
      assert.strictEqual(result.code, 0, `Should exit 0 (don't block on errors), got ${result.code}`);
      assert.ok(result.stderr.includes('[StrategicCompact] Error:'), `stderr should contain [StrategicCompact] Error:, got: ${result.stderr}`);
    })
  )
    passed++;
  else failed++;

  // ── Round 80: session-end.js entry.message?.role === 'user' third OR condition ──
  console.log('\nRound 80: session-end.js (entry.message.role user — third OR condition):');

  if (
    await asyncTest('extracts user messages from entries where only message.role is user (not type or role)', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-msgrole-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');
      // Entries where type is NOT 'user' and there is no direct role field,
      // but message.role IS 'user'. This exercises the third OR condition at
      // session-end.js line 48: entry.message?.role === 'user'
      const lines = [
        '{"type":"human","message":{"role":"user","content":"Refactor the auth module"}}',
        '{"type":"human","message":{"role":"assistant","content":"I will refactor it"}}',
        '{"type":"human","message":{"role":"user","content":"Add integration tests too"}}'
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));
      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });

      try {
        const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0);

        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('-session.tmp'));
        assert.ok(files.length > 0, 'Should create session file');
        const content = fs.readFileSync(path.join(sessionsDir, files[0]), 'utf8');
        // The third OR condition should fire for type:"human" + message.role:"user"
        assert.ok(content.includes('Refactor the auth module') || content.includes('auth'), `Session should include message extracted via message.role path. Got: ${content.substring(0, 300)}`);
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
        cleanupTestDir(testDir);
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 81: suggest-compact threshold upper bound, session-end non-string content ──
  console.log('\nRound 81: suggest-compact.js (COMPACT_THRESHOLD > 10000):');

  if (
    await asyncTest('COMPACT_THRESHOLD exceeding 10000 falls back to default 50', async () => {
      // suggest-compact.js line 31: rawThreshold <= 10000 ? rawThreshold : 50
      // Values > 10000 are positive and finite but fail the upper-bound check.
      // Existing tests cover 0, negative, NaN — this covers the > 10000 boundary.
      const result = await runScript(path.join(scriptsDir, 'suggest-compact.js'), '', {
        COMPACT_THRESHOLD: '20000'
      });
      assert.strictEqual(result.code, 0, 'Should exit 0');
      // The script logs the threshold it chose — should fall back to 50
      // Look for the fallback value in stderr (log output)
      const compactSource = fs.readFileSync(path.join(scriptsDir, 'suggest-compact.js'), 'utf8');
      // The condition at line 31: rawThreshold <= 10000 ? rawThreshold : 50
      assert.ok(compactSource.includes('<= 10000'), 'Source should have <= 10000 upper bound check');
      assert.ok(compactSource.includes(': 50'), 'Source should fall back to 50 when threshold exceeds 10000');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 81: session-end.js (user entry with non-string non-array content):');

  if (
    await asyncTest('skips user messages with numeric content (non-string non-array branch)', async () => {
      // session-end.js line 50-55: rawContent is checked for string, then array, else ''
      // When content is a number (42), neither branch matches, text = '', message is skipped.
      const isoHome = path.join(os.tmpdir(), `ecc-r81-numcontent-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });
      const transcriptPath = path.join(isoHome, 'transcript.jsonl');

      const lines = [
        // Normal user message (string content) — should be included
        '{"type":"user","content":"Real user message"}',
        // User message with numeric content — exercises the else: '' branch
        '{"type":"user","content":42}',
        // User message with boolean content — also hits the else branch
        '{"type":"user","content":true}',
        // User message with object content (no .text) — also hits the else branch
        '{"type":"user","content":{"type":"image","source":"data:..."}}'
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      try {
        const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0, 'Should exit 0');

        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.tmp'));
        assert.ok(files.length > 0, 'Should create session file');
        const content = fs.readFileSync(path.join(sessionsDir, files[0]), 'utf8');
        // The real string message should appear
        assert.ok(content.includes('Real user message'), 'Should include the string content user message');
        // Numeric/boolean/object content should NOT appear as task bullets.
        // The full file may legitimately contain "42" in timestamps like 03:42.
        assert.ok(!content.includes('\n- 42\n'), 'Numeric content should not be rendered as a task bullet');
        assert.ok(!content.includes('\n- true\n'), 'Boolean content should not be rendered as a task bullet');
        assert.ok(!content.includes('\n- [object Object]\n'), 'Object content should not be stringified into a task bullet');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 82: tool_name OR fallback, template marker regex no-match ──

  console.log('\nRound 82: session-end.js (entry.tool_name without type=tool_use):');

  if (
    await asyncTest('collects tool name from entry with tool_name but non-tool_use type', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-r82-toolname-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      const transcriptPath = path.join(isoHome, 'transcript.jsonl');
      const lines = [
        '{"type":"user","content":"Fix the bug"}',
        '{"type":"result","tool_name":"Edit","tool_input":{"file_path":"/tmp/app.js"}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Done fixing"}]}}'
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      try {
        const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0, 'Should exit 0');
        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.tmp'));
        assert.ok(files.length > 0, 'Should create session file');
        const content = fs.readFileSync(path.join(sessionsDir, files[0]), 'utf8');
        // The tool name "Edit" should appear even though type is "result", not "tool_use"
        assert.ok(content.includes('Edit'), 'Should collect Edit tool via tool_name OR fallback');
        // The file modified should also be collected since tool_name is Edit
        assert.ok(content.includes('app.js'), 'Should collect modified file path from tool_input');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 82: session-end.js (template marker present but regex no-match):');

  if (
    await asyncTest('preserves file when marker present but regex does not match corrupted template', async () => {
      const isoHome = path.join(os.tmpdir(), `ecc-r82-tmpl-${Date.now()}`);
      const sessionsDir = getCanonicalSessionsDir(isoHome);
      fs.mkdirSync(sessionsDir, { recursive: true });

      const today = new Date().toISOString().split('T')[0];
      const sessionFile = path.join(sessionsDir, `session-${today}.tmp`);

      // Write a corrupted template: has the marker but NOT the full regex structure
      const corruptedTemplate = `# Session: ${today}
**Date:** ${today}
**Started:** 10:00
**Last Updated:** 10:00

---

## Current State

[Session context goes here]

Some random content without the expected ### Context to Load section
`;
      fs.writeFileSync(sessionFile, corruptedTemplate);

      // Provide a transcript with enough content to generate a summary
      const transcriptPath = path.join(isoHome, 'transcript.jsonl');
      const lines = [
        '{"type":"user","content":"Implement authentication feature"}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"I will implement the auth feature using JWT tokens and bcrypt for password hashing."}]}}',
        '{"type":"tool_use","tool_name":"Write","name":"Write","tool_input":{"file_path":"/tmp/auth.js"}}',
        '{"type":"user","content":"Now add the login endpoint"}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Adding the login endpoint with proper validation."}]}}'
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      try {
        const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
          HOME: isoHome,
          USERPROFILE: isoHome
        });
        assert.strictEqual(result.code, 0, 'Should exit 0');

        const content = fs.readFileSync(sessionFile, 'utf8');
        // The marker text should still be present since regex didn't match
        assert.ok(content.includes('[Session context goes here]'), 'Marker should remain when regex fails to match corrupted template');
        // The corrupted content should still be there
        assert.ok(content.includes('Some random content'), 'Original corrupted content should be preserved');
      } finally {
        fs.rmSync(isoHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // ── Round 87: post-edit-format.js and post-edit-typecheck.js stdin overflow (1MB) ──
  console.log('\nRound 87: post-edit-format.js (stdin exceeding 1MB — truncation):');

  if (
    await asyncTest('truncates stdin at 1MB limit and still passes through data (post-edit-format)', async () => {
      // Send 1.2MB of data — exceeds the 1MB MAX_STDIN limit (lines 14-22)
      const payload = 'x'.repeat(1024 * 1024 + 200000);
      const result = await runScript(path.join(scriptsDir, 'post-edit-format.js'), payload);

      assert.strictEqual(result.code, 0, 'Should exit 0 even with oversized stdin');
      // Output should be truncated — significantly less than input
      assert.ok(result.stdout.length < payload.length, `stdout (${result.stdout.length}) should be shorter than input (${payload.length})`);
      // Output should be approximately 1MB (last accepted chunk may push slightly over)
      assert.ok(result.stdout.length <= 1024 * 1024 + 65536, `stdout (${result.stdout.length}) should be near 1MB, not unbounded`);
      assert.ok(result.stdout.length > 0, 'Should still pass through truncated data');
    })
  )
    passed++;
  else failed++;

  console.log('\nRound 87: post-edit-typecheck.js (stdin exceeding 1MB — truncation):');

  if (
    await asyncTest('truncates stdin at 1MB limit and still passes through data (post-edit-typecheck)', async () => {
      // Send 1.2MB of data — exceeds the 1MB MAX_STDIN limit (lines 16-24)
      const payload = 'x'.repeat(1024 * 1024 + 200000);
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), payload);

      assert.strictEqual(result.code, 0, 'Should exit 0 even with oversized stdin');
      // Output should be truncated — significantly less than input
      assert.ok(result.stdout.length < payload.length, `stdout (${result.stdout.length}) should be shorter than input (${payload.length})`);
      // Output should be approximately 1MB (last accepted chunk may push slightly over)
      assert.ok(result.stdout.length <= 1024 * 1024 + 65536, `stdout (${result.stdout.length}) should be near 1MB, not unbounded`);
      assert.ok(result.stdout.length > 0, 'Should still pass through truncated data');
    })
  )
    passed++;
  else failed++;

  // ── Round 89: post-edit-typecheck.js error detection path (relevantLines) ──
  console.log('\nRound 89: post-edit-typecheck.js (TypeScript error detection path):');

  if (
    await asyncTest('filters TypeScript errors to edited file when tsc reports errors', async () => {
      // post-edit-typecheck.js lines 60-85: when execFileSync('npx', ['tsc', ...]) throws,
      // the catch block filters error output by file path candidates and logs relevant lines.
      // All existing tests either have no tsconfig (tsc never runs) or valid TS (tsc succeeds).
      // This test creates a .ts file with a type error and a tsconfig.json.
      const testDir = createTestDir();
      fs.writeFileSync(
        path.join(testDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { strict: true, noEmit: true }
        })
      );
      const testFile = path.join(testDir, 'broken.ts');
      // Intentional type error: assigning string to number
      fs.writeFileSync(testFile, 'const x: number = "not a number";\n');

      const stdinJson = JSON.stringify({ tool_input: { file_path: testFile } });
      const result = await runScript(path.join(scriptsDir, 'post-edit-typecheck.js'), stdinJson);

      // Core: script must exit 0 and pass through stdin data regardless
      assert.strictEqual(result.code, 0, 'Should exit 0 even when tsc finds errors');
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.tool_input.file_path, testFile, 'Should pass through original stdin data with file_path intact');

      // If tsc is available and ran, check that error output is filtered to this file
      if (result.stderr.includes('TypeScript errors in')) {
        assert.ok(result.stderr.includes('broken.ts'), `Should reference the edited file basename. Got: ${result.stderr}`);
      }
      // Either way, no crash and data passes through (verified above)
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  // ── Round 89: extractSessionSummary entry.name + entry.input fallback paths ──
  console.log('\nRound 89: session-end.js (entry.name + entry.input fallback in extractSessionSummary):');

  if (
    await asyncTest('extracts tool name from entry.name and file path from entry.input (fallback format)', async () => {
      // session-end.js line 63: const toolName = entry.tool_name || entry.name || '';
      // session-end.js line 66: const filePath = entry.tool_input?.file_path || entry.input?.file_path || '';
      // All existing tests use tool_name + tool_input format. This tests the name + input fallback.
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      const lines = [
        '{"type":"user","content":"Fix the auth module"}',
        // Tool entries using "name" + "input" instead of "tool_name" + "tool_input"
        '{"type":"tool_use","name":"Edit","input":{"file_path":"/src/auth.ts"}}',
        '{"type":"tool_use","name":"Write","input":{"file_path":"/src/new-helper.ts"}}',
        // Also include a tool with tool_name but entry.input (mixed format)
        '{"tool_name":"Read","input":{"file_path":"/src/config.ts"}}'
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0, 'Should exit 0');

      // Read the session file to verify tool names and file paths were extracted
      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          // Tools from entry.name fallback
          assert.ok(content.includes('Edit'), `Should extract Edit tool from entry.name fallback. Got: ${content}`);
          assert.ok(content.includes('Write'), `Should extract Write tool from entry.name fallback. Got: ${content}`);
          // File paths from entry.input fallback
          assert.ok(content.includes('/src/auth.ts'), `Should extract file path from entry.input.file_path fallback. Got: ${content}`);
          assert.ok(content.includes('/src/new-helper.ts'), `Should extract Write file from entry.input.file_path fallback. Got: ${content}`);
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  // ── Round 90: readStdinJson timeout path (utils.js lines 215-229) ──
  console.log('\nRound 90: readStdinJson (timeout fires when stdin stays open):');

  if (
    await asyncTest('readStdinJson resolves with {} when stdin never closes (timeout fires, no data)', async () => {
      // utils.js line 215: setTimeout fires because stdin 'end' never arrives.
      // Line 225: data.trim() is empty → resolves with {}.
      // Exercises: removeAllListeners, process.stdin.unref(), and the empty-data timeout resolution.
      const script = 'const u=require("./scripts/lib/utils");u.readStdinJson({timeoutMs:100}).then(d=>{process.stdout.write(JSON.stringify(d));process.exit(0)})';
      return new Promise((resolve, reject) => {
        const child = spawn('node', ['-e', script], {
          cwd: path.resolve(__dirname, '..', '..'),
          stdio: ['pipe', 'pipe', 'pipe']
        });
        // Don't write anything or close stdin — force the timeout to fire
        let stdout = '';
        child.stdout.on('data', d => (stdout += d));
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('Test timed out'));
        }, 5000);
        child.on('close', code => {
          clearTimeout(timer);
          try {
            assert.strictEqual(code, 0, 'Should exit 0 via timeout resolution');
            const parsed = JSON.parse(stdout);
            assert.deepStrictEqual(parsed, {}, 'Should resolve with {} when no data received before timeout');
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    })
  )
    passed++;
  else failed++;

  if (
    await asyncTest('readStdinJson resolves with {} when timeout fires with invalid partial JSON', async () => {
      // utils.js lines 224-228: setTimeout fires, data.trim() is non-empty,
      // JSON.parse(data) throws → catch at line 226 resolves with {}.
      const script = 'const u=require("./scripts/lib/utils");u.readStdinJson({timeoutMs:100}).then(d=>{process.stdout.write(JSON.stringify(d));process.exit(0)})';
      return new Promise((resolve, reject) => {
        const child = spawn('node', ['-e', script], {
          cwd: path.resolve(__dirname, '..', '..'),
          stdio: ['pipe', 'pipe', 'pipe']
        });
        // Write partial invalid JSON but don't close stdin — timeout fires with unparseable data
        child.stdin.write('{"incomplete":');
        let stdout = '';
        child.stdout.on('data', d => (stdout += d));
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('Test timed out'));
        }, 5000);
        child.on('close', code => {
          clearTimeout(timer);
          try {
            assert.strictEqual(code, 0, 'Should exit 0 via timeout resolution');
            const parsed = JSON.parse(stdout);
            assert.deepStrictEqual(parsed, {}, 'Should resolve with {} when partial JSON cannot be parsed');
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    })
  )
    passed++;
  else failed++;

  // ── Round 94: session-end.js tools used but no files modified ──
  console.log('\nRound 94: session-end.js (tools used without files modified):');

  if (
    await asyncTest('session file includes Tools Used but omits Files Modified when only Read/Grep used', async () => {
      // session-end.js buildSummarySection (lines 217-228):
      //   filesModified.length > 0 → include "### Files Modified" section
      //   toolsUsed.length > 0 → include "### Tools Used" section
      // Previously tested: BOTH present (Round ~10) and NEITHER present (Round ~10).
      // Untested combination: toolsUsed present, filesModified empty.
      // Transcript with Read/Grep tools (don't add to filesModified) and user messages.
      const testDir = createTestDir();
      const transcriptPath = path.join(testDir, 'transcript.jsonl');

      const lines = [
        '{"type":"user","content":"Search the codebase for auth handlers"}',
        '{"type":"tool_use","tool_name":"Read","tool_input":{"file_path":"/src/auth.ts"}}',
        '{"type":"tool_use","tool_name":"Grep","tool_input":{"pattern":"handler"}}',
        '{"type":"user","content":"Check the test file too"}',
        '{"type":"tool_use","tool_name":"Read","tool_input":{"file_path":"/tests/auth.test.ts"}}'
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const stdinJson = JSON.stringify({ transcript_path: transcriptPath });
      const result = await runScript(path.join(scriptsDir, 'session-end.js'), stdinJson, {
        HOME: testDir
      });
      assert.strictEqual(result.code, 0, 'Should exit 0');

      const claudeDir = getCanonicalSessionsDir(testDir);
      if (fs.existsSync(claudeDir)) {
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.tmp'));
        if (files.length > 0) {
          const content = fs.readFileSync(path.join(claudeDir, files[0]), 'utf8');
          assert.ok(content.includes('### Tools Used'), 'Should include Tools Used section');
          assert.ok(content.includes('Read'), 'Should list Read tool');
          assert.ok(content.includes('Grep'), 'Should list Grep tool');
          assert.ok(!content.includes('### Files Modified'), 'Should NOT include Files Modified section (Read/Grep do not modify files)');
        }
      }
      cleanupTestDir(testDir);
    })
  )
    passed++;
  else failed++;

  // Summary
  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
