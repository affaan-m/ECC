'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateManifest, validateReport } = require('../../scripts/sandbox/contracts');
const {
  LUME_DRIVER, executeLume, lumePreflight, lumeSeedReady, readProcessTable,
  shellQuote, startLume,
} = require('../../scripts/sandbox/backends/lume');
const { LIMA_DRIVER, executeLima, limaSeedReady } = require('../../scripts/sandbox/backends/lima');
const {
  TART_DRIVER, executeTart, tartPreflight, tartSeedReady,
} = require('../../scripts/sandbox/backends/tart');
const {
  acquireRunLock, forceOwnedLauncher, launcherIsOwned, memoryGiB, memoryMiB,
  stopOwnedLauncher,
} = require('../../scripts/sandbox/backends/vm');
const { parseScan, scanInstallDiff } = require('../../scripts/sandbox/backends/vm-scan');

const repoRoot = path.join(__dirname, '..', '..');
const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', 'sandbox');
const cliPath = path.join(repoRoot, 'scripts', 'sandbox', 'ecc-sandbox');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

function manifest(osName = 'macos') {
  return validateManifest({
    name: `${osName}-vm-test`,
    needs: {
      os: [osName],
      capabilities: ['services'],
      trust: 'first-party',
      native: true,
    },
    resources: { cpu: 2, memory: '2GB', timeout: 300 },
    steps: { setup: ['printf setup'], assert: ['printf assert'] },
    report: 'install-diff',
  });
}

function result(status, stdout = '', stderr = '', error = null) {
  return { status, stdout, stderr, error };
}

function mockSequence(results, calls) {
  let index = 0;
  return (executable, argv, options) => {
    calls.push({ executable, argv, options });
    const next = results[index];
    index += 1;
    return next || result(null, '', '', new Error('mock sequence exhausted'));
  };
}

const beforeMac = [
  '/usr/local/bin/existing\t10\t100\t755',
  '/Users/lume/.zshrc\t5\t100\t644',
].join('\n');
const lumeSeedJson = '[{"status":"stopped","os":"macOS"}]';
const limaSeedJson = '[{"status":"Stopped","arch":"aarch64","config":{"os":"Linux","arch":"aarch64","plain":true}}]';
const tartSeedJson = '{"Running":false,"State":"stopped","OS":"darwin"}';
const afterMac = [
  '/usr/local/bin/existing\t11\t101\t755',
  '/usr/local/bin/ecc-demo\t20\t101\t755',
  '/Library/LaunchDaemons/org.ecc.demo.plist\t30\t101\t644',
  '/Users/lume/.zshrc\t6\t101\t644',
].join('\n');

console.log('\n=== ECC sandbox VM adapter tests ===\n');

test('normalizes bounded scan diffs and classifies services, PATH, and dotfiles', () => {
  const parsed = parseScan(beforeMac);
  assert.strictEqual(parsed.entries.size, 2);
  const outcome = scanInstallDiff(beforeMac, afterMac, 'macos');
  assert.strictEqual(outcome.diff.method, 'scan');
  assert.strictEqual(outcome.diff.complete, false);
  assert.deepStrictEqual(outcome.diff.files_added, [
    '/Library/LaunchDaemons/org.ecc.demo.plist',
    '/usr/local/bin/ecc-demo',
  ]);
  assert.ok(outcome.diff.path_changes.includes('/usr/local/bin/ecc-demo'));
  assert.ok(outcome.diff.services_registered.includes('/Library/LaunchDaemons/org.ecc.demo.plist'));
  assert.ok(outcome.diff.dotfiles_touched.includes('/Users/lume/.zshrc'));
});

test('builds Lume 0.5.1 owned lifecycle and safely quotes one remote command', () => {
  assert.deepStrictEqual(LUME_DRIVER.startArgs('vm'), [
    'run', 'vm', '--display', 'none',
  ]);
  assert.strictEqual(LUME_DRIVER.stopViaLauncher, true);
  assert.deepStrictEqual(LUME_DRIVER.execArgs('vm', "printf '%s' hello", 20), [
    'ssh', 'vm', '--timeout', '20', '--',
    `/bin/bash -lc ${shellQuote("printf '%s' hello")}`,
  ]);
  assert.deepStrictEqual(LUME_DRIVER.deleteArgs('vm'), ['delete', 'vm', '--force']);
});

test('owns and stops the exact Lume launcher process before deletion', () => {
  let alive = true;
  const signals = [];
  const child = { pid: 42_424, unref() {} };
  assert.strictEqual(stopOwnedLauncher(child, () => {}, 1_000, {
    isOwned: pid => pid === child.pid && alive,
    isAlive: () => alive,
    signal: (pid, name) => {
      signals.push([pid, name]);
      alive = false;
    },
  }), true);
  assert.deepStrictEqual(signals, [[child.pid, 'SIGINT']]);

  let identity = { started: 'Mon Aug 10 00:00:00 2026', command: '/lume run vm' };
  const mockChild = {
    pid: 42_424,
    once() {},
    kill() {},
    unref() {},
  };
  const launched = startLume('/lume', ['run', 'vm'], {
    launch: () => mockChild,
    processIdentity: () => identity,
    processGroupIsAlive: () => true,
  });
  assert.strictEqual(launcherIsOwned(launched.child), true);
  identity = { started: 'Mon Aug 10 00:00:01 2026', command: '/unrelated-process' };
  assert.strictEqual(launcherIsOwned(launched.child), false);

  const failed = startLume('/definitely/missing/lume', ['run', 'vm']);
  assert.ok(failed.error);
});

test('freezes and terminates a Lume helper that escaped into its own process group', () => {
  const rootPid = 51_000;
  const helperPid = 51_001;
  const processes = new Map([
    [rootPid, {
      pid: rootPid, ppid: 1, pgid: rootPid, state: 'S',
      started: 'Mon Aug 10 00:00:00 2026', command: '/lume run active-helper-vm',
    }],
    [helperPid, {
      pid: helperPid, ppid: rootPid, pgid: helperPid, state: 'S',
      started: 'Mon Aug 10 00:00:01 2026', command: '/usr/bin/ssh lume@guest VNC_PORT',
    }],
  ]);
  const signals = [];
  const mockChild = { pid: rootPid, once() {}, kill() {}, unref() {} };
  const identityOf = pid => {
    const entry = processes.get(pid);
    return entry ? { started: entry.started, command: entry.command } : null;
  };
  const signalProcess = (target, signal) => {
    signals.push([target, signal]);
    if (target < 0) {
      for (const [entryPid, entry] of processes) {
        if (entry.pgid === -target && signal === 'SIGINT') processes.delete(entryPid);
      }
      return;
    }
    const entry = processes.get(target);
    if (!entry) {
      const error = new Error('gone');
      error.code = 'ESRCH';
      throw error;
    }
    if (signal === 'SIGSTOP') entry.state = 'T';
    if (signal === 'SIGCONT') entry.state = 'S';
    if (['SIGTERM', 'SIGKILL'].includes(signal)) processes.delete(target);
  };
  const launched = startLume('/lume', ['run', 'active-helper-vm'], {
    launch: () => mockChild,
    processIdentity: identityOf,
    processGroupIsAlive: pgid => [...processes.values()].some(entry => entry.pgid === pgid),
    processTable: () => [...processes.values()].map(entry => ({ ...entry })),
    signalProcess,
    sleep: () => {},
  });
  assert.strictEqual(stopOwnedLauncher(launched.child, () => {}, 1_000), true);
  assert.strictEqual(processes.size, 0);
  assert.ok(signals.some(([pid, signal]) => pid === rootPid && signal === 'SIGSTOP'));
  assert.ok(signals.some(([pid, signal]) => pid === helperPid && signal === 'SIGSTOP'));
  assert.ok(signals.some(([pid, signal]) => pid === helperPid && signal === 'SIGTERM'));
  assert.ok(signals.some(([pid, signal]) => pid === -rootPid && signal === 'SIGINT'));
});

test('behaviorally cleans an active macOS helper in a separate process group', () => {
  if (process.platform !== 'darwin') return;
  const token = `ecc-lume-active-helper-${process.pid}`;
  const parentCode = [
    "const { spawn } = require('child_process');",
    "const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', process.argv[1]], { detached: true, stdio: 'ignore' });",
    'helper.unref();',
    'setInterval(() => {}, 1000);',
  ].join(' ');
  const launched = startLume(process.execPath, ['-e', parentCode, token], {
    expectedCommand: token,
  });
  assert.strictEqual(launched.status, 0, launched.error?.message);
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    const active = readProcessTable().filter(entry => (
      !entry.state.includes('Z') && entry.command.includes(token)
    ));
    assert.ok(active.length >= 2, JSON.stringify(active));
    assert.ok(active.some(entry => entry.pid !== launched.child.pid && entry.pgid === entry.pid));
    assert.strictEqual(stopOwnedLauncher(launched.child, milliseconds => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
    }), true);
    const remaining = readProcessTable().filter(entry => (
      !entry.state.includes('Z') && entry.command.includes(token)
    ));
    assert.deepStrictEqual(remaining, []);
  } finally {
    launched.child.forceStop();
  }
});

test('discovers and forces a reparented Lume helper after launcher crash', () => {
  const rootPid = 61_000;
  const helperPid = 61_001;
  const unrelatedPid = 61_002;
  const nonSshPid = 61_003;
  const address = '192.0.2.10';
  const processes = new Map([
    [rootPid, {
      pid: rootPid, ppid: 1, pgid: rootPid, state: 'S',
      started: 'Mon Aug 10 00:00:00 2026', command: '/lume run crash-vm',
    }],
    [helperPid, {
      pid: helperPid, ppid: rootPid, pgid: helperPid, state: 'S',
      started: 'Mon Aug 10 00:00:01 2026',
      command: `/usr/bin/ssh lume@${address} echo VNC_PORT=55000`,
    }],
    [unrelatedPid, {
      pid: unrelatedPid, ppid: 1, pgid: unrelatedPid, state: 'S',
      started: 'Mon Aug 10 00:00:02 2026',
      command: '/usr/bin/ssh lume@192.0.2.100 echo VNC_PORT=55001',
    }],
    [nonSshPid, {
      pid: nonSshPid, ppid: 1, pgid: nonSshPid, state: 'S',
      started: 'Mon Aug 10 00:00:03 2026',
      command: `/usr/bin/python3 monitor.py lume@${address} VNC_PORT=55000`,
    }],
  ]);
  const identityOf = pid => {
    const entry = processes.get(pid);
    return entry ? { started: entry.started, command: entry.command } : null;
  };
  const launched = startLume('/lume', ['run', 'crash-vm'], {
    launch: () => ({ pid: rootPid, once() {}, kill() {}, unref() {} }),
    processIdentity: identityOf,
    processGroupIsAlive: pgid => [...processes.values()].some(entry => entry.pgid === pgid),
    processTable: () => [...processes.values()].map(entry => ({ ...entry })),
    signalProcess: (target, signal) => {
      if (['SIGTERM', 'SIGKILL'].includes(signal)) processes.delete(Math.abs(target));
    },
    sleep: () => {},
  });
  assert.strictEqual(launched.child.addOwnershipMarker({ guestAddress: address }), true);
  processes.delete(rootPid);
  processes.get(helperPid).ppid = 1;
  assert.strictEqual(stopOwnedLauncher(launched.child, () => {}, 1_000), false);
  assert.strictEqual(forceOwnedLauncher(launched.child, () => {}, 1_000), true);
  assert.strictEqual(processes.has(helperPid), false);
  assert.strictEqual(processes.has(unrelatedPid), true);
  assert.strictEqual(processes.has(nonSshPid), true);
});

test('uses the BSD macOS find boundary instead of the Linux-only spelling', () => {
  const command = require('../../scripts/sandbox/backends/vm-scan').SCAN_COMMANDS.macos;
  assert.match(command, /\/usr\/bin\/find -x \/Applications \/Library \/opt \/usr\/local/);
  assert.match(command, /-path "\$home\/Library" -prune/);
  assert.match(command, /\$home\/Library\/LaunchAgents/);
  assert.doesNotMatch(command, /-xdev/);
  assert.match(command, /%N%t%z%t%m%t%p/);
});

test('guards the Apple two-running-guest limit from strict Lume JSON', () => {
  const full = lumePreflight(() => result(0, JSON.stringify([
    { status: 'running' }, { state: 'starting' }, { status: 'stopped' },
  ])));
  assert.strictEqual(full.pass, false);
  const available = lumePreflight(() => result(0, JSON.stringify([
    { status: 'running' }, { status: 'stopped' },
  ])));
  assert.strictEqual(available.pass, true);
  assert.strictEqual(lumePreflight(() => result(0, '{}')).pass, false);
  const crossBackendFull = lumePreflight(
    () => result(0, JSON.stringify([{ status: 'running' }])),
    [],
    () => result(0, JSON.stringify([{ Running: true, State: 'running' }]))
  );
  assert.strictEqual(crossBackendFull.pass, false);
});

test('rejects stopped seeds with substituted OS, architecture, or plain config', () => {
  assert.strictEqual(lumeSeedReady(result(0, lumeSeedJson), { arch: 'arm64' }), true);
  assert.strictEqual(lumeSeedReady(
    result(0, '[{"status":"stopped","os":"linux"}]'), { arch: 'arm64' }
  ), false);
  assert.strictEqual(limaSeedReady(result(0, limaSeedJson), { arch: 'arm64' }), true);
  assert.strictEqual(limaSeedReady(result(0, JSON.stringify([{
    status: 'Stopped', arch: 'x86_64',
    config: { os: 'Darwin', arch: 'x86_64', plain: false },
  }])), { arch: 'arm64' }), false);
  assert.strictEqual(tartSeedReady(result(0, tartSeedJson), { arch: 'arm64' }), true);
  assert.strictEqual(tartSeedReady(
    result(0, '{"Running":false,"State":"stopped","OS":"linux"}'), { arch: 'arm64' }
  ), false);
});

test('serializes ECC Apple VM lifecycles through one cross-backend lock', () => {
  const first = acquireRunLock('apple-macos-guests-test');
  try {
    assert.strictEqual(first.pass, true);
    const second = acquireRunLock('apple-macos-guests-test');
    assert.strictEqual(second.pass, false);
  } finally {
    first.release();
  }
  const afterRelease = acquireRunLock('apple-macos-guests-test');
  assert.strictEqual(afterRelease.pass, true);
  afterRelease.release();
});

test('refuses stale lock takeover and never releases another owner token', () => {
  const lockName = `apple-macos-guests-stale-${process.pid}`;
  const lockPath = path.join(os.tmpdir(), 'ecc-sandbox-locks', `${lockName}.lock`);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 2_147_483_647,
    token: 'stale',
  }), { mode: 0o600 });
  const refused = acquireRunLock(lockName);
  try {
    assert.strictEqual(refused.pass, false);
    assert.strictEqual(refused.stale, true);
    assert.match(refused.note, /removed manually/);
    assert.strictEqual(fs.existsSync(lockPath), true);
  } finally {
    fs.rmSync(lockPath, { force: true });
  }

  const owned = acquireRunLock(lockName);
  assert.strictEqual(owned.pass, true);
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    token: 'replacement',
  }));
  owned.release();
  assert.strictEqual(fs.existsSync(lockPath), true);
  fs.rmSync(lockPath, { force: true });
});

test('executes clone-configure-start-scan-steps-stop-delete through Lume', () => {
  const calls = [];
  const outcome = executeLume(manifest(), {
    arch: 'arm64',
    cwd: repoRoot,
    manifestPath: '/repo/sandbox.yaml',
    mock: true,
    run: mockSequence([
      result(0, lumeSeedJson),
      result(0, '[]'),
      result(0),
      result(0),
      result(0),
      result(0),
      result(0, beforeMac),
      result(0, 'setup'),
      result(0, 'assert'),
      result(0, afterMac),
      result(0),
      result(0),
    ], calls),
    seed: 'ecc-macos-seed',
    sleep: () => {},
    vmName: 'ecc-lume-test',
  });
  assert.strictEqual(validateReport(outcome.report), outcome.report);
  assert.strictEqual(outcome.report.result, 'pass');
  assert.strictEqual(outcome.report.backend, 'lume');
  assert.strictEqual(outcome.report.install_diff.method, 'scan');
  assert.strictEqual(outcome.cleanup.pass, true);
  assert.deepStrictEqual(calls[2].argv, ['clone', 'ecc-macos-seed', 'ecc-lume-test']);
  assert.deepStrictEqual(calls.at(-1).argv, ['delete', 'ecc-lume-test', '--force']);
});

test('builds a mount-free Lima clone and executes a complete mock lifecycle', () => {
  assert.strictEqual(memoryGiB('256MB'), 0.25);
  assert.strictEqual(memoryMiB('2GB'), 2048);
  assert.ok(LIMA_DRIVER.seedFix('seed').includes('--plain'));
  assert.deepStrictEqual(LIMA_DRIVER.cloneArgs('seed', 'child', manifest('linux')), [
    '--tty=false', 'clone', '--cpus', '2', '--memory', '2', '--mount-none', 'seed', 'child',
  ]);
  assert.deepStrictEqual(LIMA_DRIVER.configureArgs('child', manifest('linux')), [
    '--tty=false', 'edit', '--plain', '--mount-none', '--cpus', '2', '--memory', '2', 'child',
  ]);
  const before = '/usr/local/bin/existing\t10\t100.0\t755';
  const after = `${before}\n/etc/systemd/system/ecc.service\t20\t101.0\t644`;
  const calls = [];
  const outcome = executeLima(manifest('linux'), {
    arch: 'arm64',
    cwd: repoRoot,
    manifestPath: '/repo/linux.yaml',
    mock: true,
    run: mockSequence([
      result(0, limaSeedJson),
      result(0),
      result(0),
      result(0),
      result(0),
      result(0, before),
      result(0, 'setup'),
      result(0, 'assert'),
      result(0, after),
      result(0),
      result(0),
    ], calls),
    seed: 'ecc-linux-seed',
    sleep: () => {},
    vmName: 'ecc-lima-test',
  });
  assert.strictEqual(outcome.report.result, 'pass');
  assert.ok(outcome.report.install_diff.services_registered.includes('/etc/systemd/system/ecc.service'));
  assert.deepStrictEqual(calls.at(-1).argv, [
    '--tty=false', 'delete', '--force', 'ecc-lima-test',
  ]);
});

test('builds and executes the optional headless Tart lifecycle', () => {
  assert.deepStrictEqual(TART_DRIVER.startArgs('child', manifest()), [
    'run', '--no-graphics', '--no-audio', '--no-clipboard', '--net-host', 'child',
  ]);
  assert.deepStrictEqual(TART_DRIVER.configureArgs('child', manifest()), [
    'set', 'child', '--cpu', '2', '--memory', '2048',
  ]);
  const full = tartPreflight(() => result(0, JSON.stringify([
    { Running: true, State: 'running' }, { Running: true, State: 'running' },
  ])));
  assert.strictEqual(full.pass, false);

  const calls = [];
  const outcome = executeTart(manifest(), {
    arch: 'arm64',
    cwd: repoRoot,
    manifestPath: '/repo/tart.yaml',
    mock: true,
    run: mockSequence([
      result(0, tartSeedJson),
      result(0, '[]'),
      result(0), result(0), result(0), result(0),
      result(0, beforeMac), result(0, 'setup'), result(0, 'assert'),
      result(0, afterMac), result(0), result(0),
    ], calls),
    seed: 'ecc-tart-seed',
    sleep: () => {},
    vmName: 'ecc-tart-test',
  });
  assert.strictEqual(validateReport(outcome.report), outcome.report);
  assert.strictEqual(outcome.report.result, 'pass');
  assert.strictEqual(outcome.report.backend, 'tart');
  assert.match(outcome.report.notes.join('\n'), /Fair Source 100/);
  assert.deepStrictEqual(calls.at(-1).argv, ['delete', 'ecc-tart-test']);
});

test('cleanup failure upgrades an otherwise passing VM run to error', () => {
  const outcome = executeLume(manifest(), {
    arch: 'arm64',
    manifestPath: '/repo/sandbox.yaml',
    mock: true,
    run: mockSequence([
      result(0, lumeSeedJson), result(0, '[]'), result(0), result(0),
      result(0), result(0), result(0, beforeMac), result(0), result(0),
      result(0, afterMac), result(0), result(1, '', 'locked'),
    ], []),
    seed: 'ecc-macos-seed',
    sleep: () => {},
    vmName: 'ecc-lume-cleanup-test',
  });
  assert.strictEqual(outcome.report.result, 'error');
  assert.match(outcome.report.notes.join('\n'), /cleanup failed/);
});

test('stops a managed Lume guest after its launcher exits and before deletion', () => {
  const calls = [];
  let alive = true;
  const child = {
    pid: 71_000,
    forceStop: () => { alive = false; return true; },
    isAlive: () => alive,
    isOwned: () => alive,
    prepareStop: () => true,
    signalOwned: () => { alive = false; },
    unref() {},
  };
  const exitOnly = manifest();
  exitOnly.report = 'exit-only';
  const outcome = executeLume(exitOnly, {
    arch: 'arm64',
    manifestPath: '/repo/managed-launcher.yaml',
    mock: true,
    run: (executable, argv) => {
      calls.push(argv);
      if (argv[0] === 'get') return result(0, lumeSeedJson);
      if (argv[0] === 'ls') return result(0, '[]');
      return result(0);
    },
    seed: 'ecc-macos-seed',
    sleep: () => {},
    start: () => ({ ...result(0), child }),
    vmName: 'ecc-lume-managed-launcher-test',
  });
  const stopIndex = calls.findIndex(argv => argv[0] === 'stop');
  const deleteIndex = calls.findIndex(argv => argv[0] === 'delete');
  assert.strictEqual(outcome.report.result, 'pass');
  assert.strictEqual(outcome.cleanup.pass, true);
  assert.ok(stopIndex >= 0);
  assert.ok(deleteIndex > stopIndex);
});

test('CLI mock mode routes to Lume on Apple Silicon and emits one schema-valid report', () => {
  const hostArch = process.arch === 'x64' ? 'x86_64' : process.arch;
  if (process.platform !== 'darwin' || hostArch !== 'arm64') return;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vm-cli-'));
  try {
    const capabilitiesPath = path.join(tempRoot, 'capabilities.json');
    const mockPath = path.join(tempRoot, 'mock.json');
    fs.writeFileSync(capabilitiesPath, JSON.stringify({
      schema_version: 1,
      host: { os: 'macos', arch: 'arm64' },
      backends: { lume: { available: true, targets: [{ os: 'macos', arch: 'arm64' }] } },
    }));
    fs.writeFileSync(mockPath, JSON.stringify({ results: [
      { status: 0, stdout: lumeSeedJson },
      { status: 0, stdout: '[]' },
      { status: 0 }, { status: 0 }, { status: 0 }, { status: 0 },
      { status: 0, stdout: beforeMac }, { status: 0 }, { status: 0 },
      { status: 0, stdout: afterMac }, { status: 0 }, { status: 0 },
    ] }));
    const cli = spawnSync(process.execPath, [
      cliPath, 'run', path.join(fixtureRoot, 'lume-native.yaml'),
      '--capabilities', capabilitiesPath,
      '--mock', mockPath,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, ECC_SANDBOX_LUME_SEED: 'ecc-macos-seed' },
      shell: false,
      timeout: 30_000,
    });
    assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout);
    const report = validateReport(JSON.parse(cli.stdout));
    assert.strictEqual(report.backend, 'lume');
    assert.strictEqual(report.execution_mode, 'mock');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI mock mode independently exercises Lima and Tart adapters', () => {
  const hostArch = process.arch === 'x64' ? 'x86_64' : process.arch;
  if (process.platform !== 'darwin' || hostArch !== 'arm64') return;
  for (const scenario of [
    {
      backend: 'lima', fixture: 'lima-native.yaml', envName: 'ECC_SANDBOX_LIMA_SEED',
      target: { os: 'linux', arch: 'arm64' },
      results: [
        { status: 0, stdout: limaSeedJson },
        { status: 0 }, { status: 0 }, { status: 0 }, { status: 0 },
        { status: 0, stdout: '/usr/local/bin/existing\t10\t100.0\t755' },
        { status: 0 }, { status: 0 },
        { status: 0, stdout: '/usr/local/bin/existing\t10\t100.0\t755' },
        { status: 0 }, { status: 0 },
      ],
    },
    {
      backend: 'tart', fixture: 'tart-native.yaml', envName: 'ECC_SANDBOX_TART_SEED',
      target: { os: 'macos', arch: 'arm64' },
      results: [
        { status: 0, stdout: tartSeedJson },
        { status: 0, stdout: '[]' },
        { status: 0 }, { status: 0 }, { status: 0 }, { status: 0 },
        { status: 0, stdout: beforeMac }, { status: 0 }, { status: 0 },
        { status: 0, stdout: afterMac }, { status: 0 }, { status: 0 },
      ],
    },
  ]) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ecc-${scenario.backend}-cli-`));
    try {
      const capabilitiesPath = path.join(tempRoot, 'capabilities.json');
      const mockPath = path.join(tempRoot, 'mock.json');
      fs.writeFileSync(capabilitiesPath, JSON.stringify({
        schema_version: 1,
        host: { os: 'macos', arch: 'arm64' },
        backends: {
          [scenario.backend]: { available: true, targets: [scenario.target] },
        },
      }));
      fs.writeFileSync(mockPath, JSON.stringify({ results: scenario.results }));
      const cli = spawnSync(process.execPath, [
        cliPath, 'run', path.join(fixtureRoot, scenario.fixture),
        '--capabilities', capabilitiesPath,
        '--mock', mockPath,
      ], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, [scenario.envName]: `ecc-${scenario.backend}-seed` },
        shell: false,
        timeout: 30_000,
      });
      assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout);
      const report = validateReport(JSON.parse(cli.stdout));
      assert.strictEqual(report.backend, scenario.backend);
      assert.strictEqual(report.execution_mode, 'mock');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

test('malformed VM scan evidence upgrades a run to error', () => {
  const outcome = executeLume(manifest(), {
    arch: 'arm64',
    manifestPath: '/repo/malformed.yaml',
    mock: true,
    run: mockSequence([
      result(0, lumeSeedJson), result(0, '[]'), result(0), result(0),
      result(0), result(0), result(0, beforeMac), result(0), result(0),
      result(0, `${afterMac}\nnot-an-absolute-path\t1\t2\t3`), result(0), result(0),
    ], []),
    seed: 'ecc-macos-seed',
    sleep: () => {},
    vmName: 'ecc-lume-malformed-test',
  });
  assert.strictEqual(outcome.report.result, 'error');
  assert.match(outcome.report.notes.join('\n'), /malformed path records/);
});

test('bounded VM scan evidence remains a pass with an explicit truncation note', () => {
  const manyFiles = Array.from({ length: 1_001 }, (_, index) => (
    `/opt/ecc/file-${String(index).padStart(4, '0')}\t1\t2\t644`
  )).join('\n');
  const outcome = executeLume(manifest(), {
    arch: 'arm64',
    manifestPath: '/repo/truncated.yaml',
    mock: true,
    run: mockSequence([
      result(0, lumeSeedJson), result(0, '[]'), result(0), result(0),
      result(0), result(0), result(0, ''), result(0), result(0),
      result(0, manyFiles), result(0), result(0),
    ], []),
    seed: 'ecc-macos-seed',
    sleep: () => {},
    vmName: 'ecc-lume-truncated-test',
  });
  assert.strictEqual(outcome.report.result, 'pass');
  assert.strictEqual(outcome.report.install_diff.files_added.length, 1_000);
  assert.match(outcome.report.notes.join('\n'), /truncated/);
});

test('bounds VM readiness probes by the manifest deadline', () => {
  let now = 0;
  let readinessCalls = 0;
  const short = manifest();
  short.resources.timeout = 1;
  const outcome = executeLume(short, {
    arch: 'arm64',
    clock: () => now,
    manifestPath: '/repo/timeout.yaml',
    mock: true,
    run: (executable, argv, options) => {
      if (argv[0] === 'get') return result(0, lumeSeedJson);
      if (argv[0] === 'ls') return result(0, '[]');
      if (argv[0] === 'ssh') {
        readinessCalls += 1;
        now += options.timeout;
        return result(1, '', 'not ready');
      }
      return result(0);
    },
    seed: 'ecc-macos-seed',
    sleep: milliseconds => { now += milliseconds; },
    vmName: 'ecc-lume-timeout-test',
  });
  assert.strictEqual(readinessCalls, 1);
  assert.ok(outcome.report.duration_ms <= 1_000);
  assert.strictEqual(outcome.report.result, 'error');
});

test('bounds real Lume ownership lookup by the remaining manifest deadline', () => {
  let now = 0;
  let ownershipTimeout = null;
  let alive = true;
  const short = manifest();
  short.resources.timeout = 1;
  const child = {
    pid: 70_000,
    addOwnershipMarker: () => true,
    forceStop: () => { alive = false; return true; },
    helperBarrierReady: () => true,
    isAlive: () => alive,
    isOwned: () => alive,
    prepareStop: () => true,
    signalOwned: () => { alive = false; },
    unref() {},
  };
  const outcome = executeLume(short, {
    arch: 'arm64',
    clock: () => now,
    manifestPath: '/repo/ownership-timeout.yaml',
    run: (executable, argv, options) => {
      if (executable === 'tart') {
        const error = new Error('missing');
        error.code = 'ENOENT';
        return result(null, '', '', error);
      }
      if (argv[0] === 'get' && argv[1] === 'ecc-macos-seed') return result(0, lumeSeedJson);
      if (argv[0] === 'ls') return result(0, '[]');
      if (argv[0] === 'ssh') {
        now = 999;
        return result(0);
      }
      if (argv[0] === 'get') {
        ownershipTimeout = options.timeout;
        now += options.timeout;
        return result(0, '[{"status":"running","os":"macOS","ipAddress":"192.0.2.20"}]');
      }
      return result(0);
    },
    seed: 'ecc-macos-seed',
    sleep: milliseconds => { now += milliseconds; },
    start: () => ({ ...result(0), child }),
    vmName: 'ecc-lume-ownership-timeout-test',
  });
  assert.strictEqual(ownershipTimeout, 1);
  assert.ok(outcome.report.duration_ms <= 1_000);
  assert.strictEqual(outcome.cleanup.pass, true);
});

test('cleans up and releases the Apple lock when deadline expires before readiness', () => {
  let now = 0;
  const calls = [];
  const short = manifest();
  short.resources.timeout = 1;
  const outcome = executeLume(short, {
    arch: 'arm64',
    clock: () => now,
    manifestPath: '/repo/pre-ready-timeout.yaml',
    mock: true,
    run: (executable, argv) => {
      calls.push(argv);
      if (argv[0] === 'get') return result(0, lumeSeedJson);
      if (argv[0] === 'ls') return result(0, '[]');
      if (argv[0] === 'run') now = 1_000;
      return result(0);
    },
    seed: 'ecc-macos-seed',
    sleep: () => {},
    vmName: 'ecc-lume-pre-ready-timeout-test',
  });
  assert.strictEqual(validateReport(outcome.report), outcome.report);
  assert.strictEqual(outcome.report.result, 'error');
  assert.ok(calls.some(argv => argv[0] === 'stop'));
  assert.ok(calls.some(argv => argv[0] === 'delete'));
  const lock = acquireRunLock('apple-macos-guests');
  assert.strictEqual(lock.pass, true);
  lock.release();
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
