'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateManifest } = require('../../scripts/sandbox/contracts');
const {
  createRun,
  listEvents,
  readRun,
  readResources,
  updateState,
} = require('../../scripts/sandbox/session-store');
const {
  createExploration,
  createInteractiveLaunch,
  exploreFromSession,
  handles,
  parseLaunchArgs,
  watchLaunch,
} = require('../../scripts/sandbox/review-cli');
const {
  explorationName,
  runLumeExploration,
  runPodmanExploration,
  runSrtExploration,
} = require('../../scripts/sandbox/exploration');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (error) { console.log(`  ✗ ${name}\n    Error: ${error.stack || error.message}`); failed += 1; }
}

function manifest() {
  return validateManifest({
    name: 'explore-test',
    needs: { os: ['linux'], capabilities: ['clean-home'], trust: 'first-party', native: false },
    resources: { cpu: 1, memory: '256MB', timeout: 30 },
    steps: { setup: ['printf setup'], assert: ['printf assert'] },
    report: 'exit-only',
  });
}

function lumeFixture(overrides = {}) {
  const calls = [];
  const events = [];
  const resources = [];
  let alive = false;
  let stopped = false;
  let deleted = false;
  let released = false;
  const child = {
    pid: 55_555,
    ownershipReceipt: { pid: 55_555, pgid: 55_555, started: 'fixture', command: 'lume run fixture' },
    captureDescendants: () => true,
    addOwnershipMarker: () => true,
    helperBarrierReady: () => true,
    isOwned: () => alive,
    isAlive: () => alive,
    prepareStop: () => true,
    signalOwned: () => { alive = false; },
    forceStop: () => { alive = false; return true; },
    unref() {},
  };
  const options = {
    cwd: process.cwd(), seed: 'fixture-seed', name: 'fixture-clone',
    acquireLock: () => ({ pass: true, release: () => { released = true; } }),
    vmStoragePath: () => process.cwd(),
    vmCloneBudget: () => 0,
    prepareLumeClone: () => ({ supported: false, cloneBytes: null, code: 'fixture_copy', message: 'Full-copy budget required' }),
    assessHostResources: () => ({ decision: 'allow', message: 'Host resources available', marker: 'fixture-receipt' }),
    sleep() {},
    emit: event => events.push(event),
    registerResource: resource => resources.push(resource),
    clearResource: () => calls.push('clear'),
    start: () => { calls.push('start'); alive = true; return { status: 0, child }; },
    interactive: () => { calls.push('interactive'); return { status: 0 }; },
    run: (executable, argv) => {
      calls.push(argv[0]);
      if (executable === 'tart' || argv[0] === 'ls') return { status: 0, stdout: '[]' };
      if (argv[0] === 'stop') stopped = true;
      if (argv[0] === 'delete') deleted = true;
      if (argv[0] === 'get') {
        if (deleted) return { status: 1, stderr: 'virtual machine not found' };
        return { status: 0, stdout: JSON.stringify({
          state: stopped || !alive ? 'stopped' : 'running', os: 'macos', ipAddress: '192.0.2.20',
        }) };
      }
      return { status: 0, stdout: '' };
    },
    ...overrides,
  };
  return { options, calls, events, resources, released: () => released };
}

function writeManifest(root) {
  const manifestPath = path.join(root, 'sandbox.json');
  const sandboxManifest = manifest();
  fs.writeFileSync(manifestPath, `${JSON.stringify(sandboxManifest, null, 2)}\n`);
  return { manifestPath, sandboxManifest };
}

function launchContext(manifestPath, sandboxManifest, route = {
  backend: 'podman', tier: 1, os: 'linux', arch: 'arm64',
}) {
  return {
    cliPath: '/trusted/ecc-sandbox',
    resolveRun: () => ({
      manifestPath,
      manifest: sandboxManifest,
      capabilities: {},
      decision: { result: 'routable', routes: [route] },
    }),
  };
}

console.log('\n=== ECC sandbox exploration tests ===\n');

test('parses the manifest-first launch command with bounded purpose, consent, and terminal', () => {
  assert.strictEqual(handles('launch'), true);
  const parsed = parseLaunchArgs([
    '/repo/sandbox.yaml',
    '--purpose', 'isolated backend feature behavior',
    '--consent', 'y',
    '--proposal', `proposal_${'a'.repeat(64)}`,
    '--terminal', 'terminal.app',
  ]);
  assert.strictEqual(parsed.manifestPath, '/repo/sandbox.yaml');
  assert.strictEqual(parsed.purpose, 'isolated backend feature behavior');
  assert.strictEqual(parsed.consent, 'y');
  assert.strictEqual(parsed.proposalId, `proposal_${'a'.repeat(64)}`);
  assert.strictEqual(parsed.terminal, 'terminal.app');

  assert.throws(
    () => parseLaunchArgs(['/repo/sandbox.yaml', '--purpose', 'x'.repeat(241)]),
    /purpose.*240.*byte/i
  );
  assert.throws(
    () => parseLaunchArgs(['/repo/sandbox.yaml', '--purpose', 'unsafe\rprompt']),
    /purpose.*control/i
  );
  assert.throws(
    () => parseLaunchArgs(['/repo/sandbox.yaml', '--consent', 'yes']),
    /consent.*y.*n/i
  );
  assert.throws(
    () => parseLaunchArgs(['/repo/sandbox.yaml', '--terminal', 'iterm2']),
    /terminal.*wezterm.*terminal\.app/i
  );
});

test('manifest-first launch creates no state without y consent', () => {
  for (const consentArgs of [[], ['--consent', 'n']]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-direct-consent-test-'));
    try {
      const { manifestPath, sandboxManifest } = writeManifest(root);
      const unexpected = () => {
        throw new Error('non-consenting launch invoked a terminal or process');
      };
      const result = createInteractiveLaunch(parseLaunchArgs([
        manifestPath,
        '--purpose', 'isolated backend feature behavior',
        ...consentArgs,
      ]), launchContext(manifestPath, sandboxManifest), {
        root, launch: unexpected, spawn: unexpected,
      });
      assert.strictEqual(result.result, consentArgs.length === 0 ? 'consent-required' : 'declined');
      assert.strictEqual(result.creates_run, false);
      if (consentArgs.length === 0) {
        assert.match(result.proposal_id, /^proposal_[a-f0-9]{64}$/);
        assert.strictEqual(
          result.consent_prompt,
          'Would you like to launch a Tier 1 rootless Podman sandbox with '
            + 'a clean Linux home, a read-only source mount, and networking disabled, '
            + 'for testing isolated backend feature behavior? y/n'
        );
      }
      assert.deepStrictEqual(fs.readdirSync(root), ['sandbox.json']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('manifest-first launch rejects bare y without the returned proposal ID', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-direct-bare-consent-test-'));
  try {
    const { manifestPath, sandboxManifest } = writeManifest(root);
    assert.throws(() => createInteractiveLaunch(parseLaunchArgs([
      manifestPath,
      '--purpose', 'isolated backend feature behavior',
      '--consent', 'y',
    ]), launchContext(manifestPath, sandboxManifest), {
      root,
      launch: () => { throw new Error('bare consent launched a terminal'); },
    }), /consent y requires --proposal/i);
    assert.deepStrictEqual(fs.readdirSync(root), ['sandbox.json']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manifest-first launch starts a monitored non-evidence Podman exploration after y', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-direct-launch-test-'));
  try {
    const { manifestPath, sandboxManifest } = writeManifest(root);
    const terminalPlans = [];
    const watchdogs = [];
    const proposal = createInteractiveLaunch(parseLaunchArgs([
      manifestPath,
      '--purpose', 'isolated backend feature behavior',
      '--terminal', 'terminal.app',
    ]), launchContext(manifestPath, sandboxManifest), { root });
    const result = createInteractiveLaunch(parseLaunchArgs([
      manifestPath,
      '--purpose', 'isolated backend feature behavior',
      '--consent', 'y',
      '--proposal', proposal.proposal_id,
      '--terminal', 'terminal.app',
    ]), launchContext(manifestPath, sandboxManifest), {
      root,
      launch: plan => {
        terminalPlans.push(plan);
        return { strategy: 'app' };
      },
      spawn: (executable, argv) => {
        watchdogs.push({ executable, argv });
        return { pid: 4343, once() {}, unref() {} };
      },
    });

    assert.strictEqual(result.result, 'launching');
    assert.strictEqual(result.state, 'launching');
    assert.strictEqual(result.backend, 'podman');
    assert.strictEqual(result.tier, 1);
    assert.strictEqual(result.evidence, false);
    assert.strictEqual(result.terminal, 'terminal.app');
    assert.strictEqual(
      result.listener,
      `ecc-sandbox listen ${result.run_id} --follow --format jsonl`
    );
    assert.strictEqual(terminalPlans.length, 1);
    assert.strictEqual(terminalPlans[0].command, '/usr/bin/osascript');
    assert.ok(terminalPlans[0].argv.includes('_explore'));
    assert.strictEqual(watchdogs.length, 1);
    assert.ok(watchdogs[0].argv.includes('_watch-launch'));

    const stored = readRun(result.run_id, root);
    assert.strictEqual(stored.session.exploration, true);
    assert.strictEqual(stored.session.source_run_id, null);
    assert.strictEqual(stored.session.purpose, 'isolated backend feature behavior');
    assert.strictEqual(stored.session.consent.decision, 'y');
    assert.strictEqual(stored.session.consent.proposal_id, proposal.proposal_id);
    assert.match(
      stored.session.consent.granted_at,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
    assert.deepStrictEqual(readResources(result.run_id, root), []);
    const events = listEvents(result.run_id, root);
    assert.deepStrictEqual(events.map(event => event.type), [
      'consent.granted', 'exploration.created',
    ]);
    assert.strictEqual(events[0].purpose, 'isolated backend feature behavior');
    assert.strictEqual(events[0].prompt, stored.session.consent.prompt);
    assert.strictEqual(events[1].evidence, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('launch watchdog reports a bounded failure when the visible terminal never checks in', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-launch-watchdog-test-'));
  try {
    const { manifestPath } = writeManifest(root);
    const created = createRun({
      root,
      manifestPath,
      manifestDigest: crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex'),
      route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
      exploration: true,
    });
    updateState(created.run_id, root, { status: 'launching' });

    const result = watchLaunch(created.run_id, root, { timeoutMs: 0 });

    assert.strictEqual(result.result, 'launch-timeout');
    assert.strictEqual(readRun(created.run_id, root).state.status, 'error');
    assert.match(readRun(created.run_id, root).state.error, /terminal did not check in/i);
    assert.deepStrictEqual(listEvents(created.run_id, root).map(event => event.type), [
      'exploration.launch.failed',
    ]);
    assert.throws(
      () => exploreFromSession(created.run_id, root, { cliPath: '/trusted/ecc-sandbox' }),
      /no longer awaiting terminal check-in/i
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manifest-first launch binds y consent to the exact proposed manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-direct-proposal-test-'));
  try {
    const { manifestPath, sandboxManifest } = writeManifest(root);
    const context = launchContext(manifestPath, sandboxManifest);
    const proposal = createInteractiveLaunch(parseLaunchArgs([
      manifestPath, '--purpose', 'isolated backend feature behavior',
    ]), context, { root });
    fs.appendFileSync(manifestPath, '\n');
    assert.throws(() => createInteractiveLaunch(parseLaunchArgs([
      manifestPath,
      '--purpose', 'isolated backend feature behavior',
      '--consent', 'y',
      '--proposal', proposal.proposal_id,
    ]), context, {
      root,
      launch: () => { throw new Error('changed proposal launched a terminal'); },
    }), /proposal.*no longer matches|proposal.*changed/i);
    assert.deepStrictEqual(fs.readdirSync(root), ['sandbox.json']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manifest-first launch rejects every route except rootless Podman Tier 1 without state', () => {
  const unsupported = [
    { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
    { backend: 'lume', tier: 2, os: 'macos', arch: 'arm64' },
  ];
  for (const route of unsupported) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-direct-route-test-'));
    try {
      const { manifestPath, sandboxManifest } = writeManifest(root);
      assert.throws(() => createInteractiveLaunch(parseLaunchArgs([
        manifestPath,
        '--purpose', 'isolated backend feature behavior',
        '--consent', 'y',
      ]), launchContext(manifestPath, sandboxManifest, route), {
        root,
        launch: () => { throw new Error('unsupported route launched a terminal'); },
      }), /launch.*Tier 1.*Podman|Tier 1.*Podman.*launch/i);
      assert.deepStrictEqual(fs.readdirSync(root), ['sandbox.json']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('uses a separate unguessable resource identity', () => {
  assert.match(explorationName('podman'), /^ecc-explore-podman-[a-f0-9]{24}$/);
});

test('Podman exploration replays setup, opens a PTY, and always cleans its labeled replica', () => {
  const calls = [];
  const run = (executable, argv, options) => {
    calls.push({ executable, argv, options });
    if (argv[0] === 'info') return { status: 0, stdout: '{"host":{"security":{"rootless":true}}}', stderr: '' };
    if (argv[0] === 'image') return { status: 0, stdout: `sha256:${'a'.repeat(64)}\n`, stderr: '' };
    if (argv[0] === 'create') return { status: 0, stdout: `${'b'.repeat(64)}\n`, stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const result = runPodmanExploration(manifest(), {
    cwd: '/trusted/repo',
    image: 'localhost/ecc-sandbox:ubuntu-lts',
    name: 'ecc-explore-podman-1234567890abcdef12345678',
    ownerToken: 'owner-token',
    runId: 'run_1234567890abcdef1234567890abcdef',
    run,
  });
  assert.strictEqual(result.exitCode, 0);
  const create = calls.find(call => call.argv[0] === 'create');
  assert.ok(create.argv.includes('io.ecc.sandbox.exploration=true'));
  assert.ok(create.argv.includes('io.ecc.sandbox.owner=owner-token'));
  assert.ok(calls.some(call => call.argv.includes('printf setup')));
  const shell = calls.find(call => call.argv.includes('--interactive'));
  assert.ok(shell.argv.includes('--tty'));
  assert.deepStrictEqual(calls.at(-1).argv.slice(0, 4), ['rm', '--force', '--time', '0']);
});

test('Podman setup keeps the manifest timeout while its human shell gets a bounded exploration lease', () => {
  const calls = [];
  let interactiveOptions;
  const run = (executable, argv, options) => {
    calls.push({ executable, argv, options });
    if (argv[0] === 'info') return { status: 0, stdout: '{"host":{"security":{"rootless":true}}}', stderr: '' };
    if (argv[0] === 'image') return { status: 0, stdout: `sha256:${'a'.repeat(64)}\n`, stderr: '' };
    if (argv[0] === 'create') return { status: 0, stdout: `${'b'.repeat(64)}\n`, stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const sandboxManifest = manifest();
  runPodmanExploration(sandboxManifest, {
    cwd: '/trusted/repo',
    image: 'localhost/ecc-sandbox:ubuntu-lts',
    name: 'ecc-explore-podman-fedcba0987654321fedcba09',
    ownerToken: 'owner-token',
    runId: 'run_fedcba0987654321fedcba0987654321',
    run,
    interactive: (_executable, _argv, options) => {
      interactiveOptions = options;
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  const setup = calls.find(call => call.argv.includes('printf setup'));
  assert.strictEqual(setup.options.timeout, sandboxManifest.resources.timeout * 1000);
  assert.ok(Number.isSafeInteger(interactiveOptions.timeout));
  assert.ok(interactiveOptions.timeout >= 30 * 60 * 1000);
});

test('SRT setup keeps the manifest timeout while its human shell gets the exploration lease', () => {
  const calls = [];
  let interactiveOptions;
  const sandboxManifest = manifest();
  runSrtExploration(sandboxManifest, {
    cwd: process.cwd(),
    run: (executable, argv, options) => {
      calls.push({ executable, argv, options });
      return { status: 0, stdout: '', stderr: '' };
    },
    interactive: (_executable, _argv, options) => {
      interactiveOptions = options;
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  const setup = calls.find(call => call.argv.includes('printf setup'));
  assert.strictEqual(setup.options.timeout, sandboxManifest.resources.timeout * 1000);
  assert.ok(Number.isSafeInteger(interactiveOptions.timeout));
  assert.ok(interactiveOptions.timeout >= 30 * 60 * 1000);
});

test('Lume setup keeps the manifest timeout while its human shell gets the exploration lease', () => {
  const calls = [];
  let interactiveOptions;
  const sandboxManifest = manifest();
  const fixture = lumeFixture();
  runLumeExploration(sandboxManifest, {
    ...fixture.options,
    cwd: process.cwd(),
    name: 'ecc-explore-lume-fedcba0987654321fedcba09',
    seed: 'ecc-sandbox-macos-seed',
    run: (executable, argv, options) => {
      calls.push({ executable, argv, options });
      return fixture.options.run(executable, argv, options);
    },
    interactive: (_executable, _argv, options) => {
      interactiveOptions = options;
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  const setup = calls.find(call => call.argv.some(arg => arg.includes('printf setup')));
  assert.strictEqual(setup.options.timeout, sandboxManifest.resources.timeout * 1000);
  assert.ok(Number.isSafeInteger(interactiveOptions.timeout));
  assert.ok(interactiveOptions.timeout >= 30 * 60 * 1000);
});

test('Lume exploration reserves the shared Apple lifecycle before invoking Lume', () => {
  const calls = [];
  assert.throws(() => runLumeExploration(manifest(), {
    assessHostResources: () => ({ decision: 'allow', message: 'Host resources available' }),
    vmStoragePath: () => process.cwd(),
    vmCloneBudget: () => 0,
    prepareLumeClone: () => ({ supported: false, cloneBytes: null, code: 'fixture_copy', message: 'Full-copy budget required' }),
    cwd: process.cwd(),
    name: 'ecc-explore-lume-111111111111111111111111',
    seed: 'ecc-sandbox-macos-seed',
    acquireLock: name => {
      assert.strictEqual(name, 'host-local-vms');
      return {
        pass: false,
        note: 'another ECC macOS guest run is active',
        release() { throw new Error('unowned lock was released'); },
      };
    },
    run: (executable, argv) => {
      calls.push({ executable, argv });
      return { status: 0, stdout: '', stderr: '' };
    },
  }), /shared host VM lifecycle lock.*another ECC macOS guest run is active/i);
  assert.deepStrictEqual(calls, []);
});

test('Lume exploration verifies owned launch, stopped state, and deletion before clearing the replica', () => {
  const calls = [];
  const registered = [];
  const cleared = [];
  let alive = true;
  let stopped = false;
  let deleted = false;
  let lockReleased = false;
  const child = {
    pid: 42_424,
    ownershipReceipt: {
      pid: 42_424,
      pgid: 42_424,
      started: 'Mon Aug 10 00:00:00 2026',
      command: 'lume run ecc-explore-lume-222222222222222222222222 --display native',
    },
    captureDescendants: () => true,
    addOwnershipMarker: marker => marker.guestAddress === '192.0.2.20',
    helperBarrierReady: () => true,
    isOwned: () => alive,
    isAlive: () => alive,
    prepareStop: () => true,
    signalOwned: signal => {
      assert.strictEqual(signal, 'SIGINT');
      alive = false;
    },
    forceStop: () => { alive = false; return true; },
    unref() {},
  };
  const run = (executable, argv, options) => {
    calls.push({ executable, argv, options });
    if (executable === 'tart') return { status: 0, stdout: '[]', stderr: '' };
    if (argv[0] === 'ls') return { status: 0, stdout: '[]', stderr: '' };
    if (argv[0] === 'get' && argv[1] === 'ecc-sandbox-macos-seed') {
      return { status: 0, stdout: '{"state":"stopped","os":"macos"}', stderr: '' };
    }
    if (argv[0] === 'ssh' && argv.includes('/usr/bin/true')) {
      return { status: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'get' && !stopped && !deleted) {
      return {
        status: 0,
        stdout: '{"state":"running","os":"macos","ipAddress":"192.0.2.20"}',
        stderr: '',
      };
    }
    if (argv[0] === 'stop') {
      stopped = true;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'get' && stopped && !deleted) {
      return { status: 0, stdout: '{"state":"stopped","os":"macos"}', stderr: '' };
    }
    if (argv[0] === 'delete') {
      deleted = true;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'get' && deleted) {
      return { status: 1, stdout: '', stderr: 'virtual machine not found' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };

  const outcome = runLumeExploration(manifest(), {
    assessHostResources: () => ({ decision: 'allow', message: 'Host resources available' }),
    vmStoragePath: () => process.cwd(),
    vmCloneBudget: () => 0,
    prepareLumeClone: () => ({ supported: false, cloneBytes: null, code: 'fixture_copy', message: 'Full-copy budget required' }),
    cwd: process.cwd(),
    name: 'ecc-explore-lume-222222222222222222222222',
    seed: 'ecc-sandbox-macos-seed',
    run,
    start: (executable, argv) => {
      assert.strictEqual(executable, 'lume');
      const storageIndex = argv.indexOf('--storage');
      assert.ok(storageIndex > 1);
      assert.strictEqual(argv[storageIndex + 1], process.cwd());
      assert.deepStrictEqual(argv.filter((_arg, index) => index !== storageIndex && index !== storageIndex + 1), [
        'run', 'ecc-explore-lume-222222222222222222222222', '--display', 'native',
      ]);
      return { status: 0, stdout: '', stderr: '', child };
    },
    acquireLock: () => ({ pass: true, release: () => { lockReleased = true; } }),
    sleep: () => {},
    interactive: () => ({ status: 0, stdout: '', stderr: '' }),
    registerResource: resource => registered.push(resource),
    clearResource: resource => cleared.push(resource),
  });

  assert.strictEqual(outcome.exitCode, 0);
  assert.deepStrictEqual(outcome.cleanup, { pass: true, retained: false });
  assert.ok(registered.some(resource => resource.launcher?.pid === child.pid));
  assert.deepStrictEqual(cleared, [{ kind: 'lume', name: 'ecc-explore-lume-222222222222222222222222' }]);
  const cleanupCommands = calls.filter(call => (
    call.argv[0] === 'stop' || call.argv[0] === 'delete'
      || (call.argv[0] === 'get' && call.argv[1].includes('222222222222'))
  )).map(call => call.argv[0]);
  assert.deepStrictEqual(cleanupCommands.slice(-3), ['get', 'delete', 'get']);
  assert.strictEqual(lockReleased, true);
});

test('Lume exploration fails explicitly and retains its receipt when stopped state is unverified', () => {
  const cleared = [];
  const calls = [];
  let alive = true;
  assert.throws(() => runLumeExploration(manifest(), {
    assessHostResources: () => ({ decision: 'allow', message: 'Host resources available' }),
    vmStoragePath: () => process.cwd(),
    vmCloneBudget: () => 0,
    prepareLumeClone: () => ({ supported: false, cloneBytes: null, code: 'fixture_copy', message: 'Full-copy budget required' }),
    cwd: process.cwd(),
    name: 'ecc-explore-lume-333333333333333333333333',
    seed: 'ecc-sandbox-macos-seed',
    acquireLock: () => ({ pass: true, release() {} }),
    sleep: () => {},
    run: (executable, argv) => {
      calls.push({ executable, argv });
      if (executable === 'tart') return { status: 0, stdout: '[]', stderr: '' };
      if (argv[0] === 'ls') return { status: 0, stdout: '[]', stderr: '' };
      if (argv[0] === 'get' && argv[1] === 'ecc-sandbox-macos-seed') {
        return { status: 0, stdout: '{"state":"stopped","os":"macos"}', stderr: '' };
      }
      if (argv[0] === 'ssh' && argv.includes('/usr/bin/true')) return { status: 0, stdout: '', stderr: '' };
      if (argv[0] === 'get') {
        return {
          status: 0,
          stdout: '{"state":"running","os":"macos","ipAddress":"192.0.2.20"}',
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    start: () => ({
      status: 0, stdout: '', stderr: '',
      child: {
        pid: 43_434,
        ownershipReceipt: { pid: 43_434, pgid: 43_434, started: 'start', command: 'lume run owned' },
        captureDescendants: () => true,
        addOwnershipMarker: () => true,
        helperBarrierReady: () => true,
        isOwned: () => alive,
        isAlive: () => alive,
        prepareStop: () => true,
        signalOwned: () => { alive = false; },
        forceStop: () => { alive = false; return true; },
        unref() {},
      },
    }),
    interactive: () => ({ status: 0, stdout: '', stderr: '' }),
    clearResource: resource => cleared.push(resource),
  }), /cleanup incomplete.*retained.*stopped state/i);
  assert.strictEqual(calls.some(call => call.argv[0] === 'delete'), false);
  assert.deepStrictEqual(cleared, []);
});

test('Lume exploration retains its receipt when deletion cannot be verified', () => {
  let alive = true;
  let stopped = false;
  let deleted = false;
  const cleared = [];
  assert.throws(() => runLumeExploration(manifest(), {
    assessHostResources: () => ({ decision: 'allow', message: 'Host resources available' }),
    vmStoragePath: () => process.cwd(),
    vmCloneBudget: () => 0,
    prepareLumeClone: () => ({ supported: false, cloneBytes: null, code: 'fixture_copy', message: 'Full-copy budget required' }),
    cwd: process.cwd(),
    name: 'ecc-explore-lume-444444444444444444444444',
    seed: 'ecc-sandbox-macos-seed',
    acquireLock: () => ({ pass: true, release() {} }),
    sleep: () => {},
    run: (executable, argv) => {
      if (executable === 'tart') return { status: 0, stdout: '[]', stderr: '' };
      if (argv[0] === 'ls') return { status: 0, stdout: '[]', stderr: '' };
      if (argv[0] === 'get' && argv[1] === 'ecc-sandbox-macos-seed') {
        return { status: 0, stdout: '{"state":"stopped","os":"macos"}', stderr: '' };
      }
      if (argv[0] === 'ssh' && argv.includes('/usr/bin/true')) return { status: 0, stdout: '', stderr: '' };
      if (argv[0] === 'stop') { stopped = true; return { status: 0, stdout: '', stderr: '' }; }
      if (argv[0] === 'delete') { deleted = true; return { status: 0, stdout: '', stderr: '' }; }
      if (argv[0] === 'get' && stopped && !deleted) {
        return { status: 0, stdout: '{"state":"stopped","os":"macos"}', stderr: '' };
      }
      if (argv[0] === 'get' && deleted) {
        return { status: 0, stdout: '{"state":"stopped","os":"macos"}', stderr: '' };
      }
      if (argv[0] === 'get') {
        return {
          status: 0,
          stdout: '{"state":"running","os":"macos","ipAddress":"192.0.2.20"}',
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    start: () => ({
      status: 0, stdout: '', stderr: '',
      child: {
        pid: 44_444,
        ownershipReceipt: { pid: 44_444, pgid: 44_444, started: 'start', command: 'lume run owned' },
        captureDescendants: () => true,
        addOwnershipMarker: () => true,
        helperBarrierReady: () => true,
        isOwned: () => alive,
        isAlive: () => alive,
        prepareStop: () => true,
        signalOwned: () => { alive = false; },
        forceStop: () => { alive = false; return true; },
        unref() {},
      },
    }),
    interactive: () => ({ status: 0, stdout: '', stderr: '' }),
    clearResource: resource => cleared.push(resource),
  }), /cleanup incomplete.*retained.*deletion/i);
  assert.deepStrictEqual(cleared, []);
});

test('Lume exploration denies insufficient headroom before cloning and reports the exact receipt', () => {
  const receipt = { decision: 'deny', message: 'Host memory is under pressure; close apps and retry.' };
  const fixture = lumeFixture({ assessHostResources: () => receipt });
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /memory is under pressure.*close apps/i);
  assert.strictEqual(fixture.calls.includes('clone'), false);
  assert.strictEqual(fixture.calls.includes('start'), false);
  assert.strictEqual(fixture.calls.includes('interactive'), false);
  assert.deepStrictEqual(fixture.events, [{ type: 'resource.admission', phase: 'provision', admission: receipt, text: receipt.message }]);
  assert.strictEqual(fixture.released(), true);
});

test('Lume exploration rechecks headroom before start and cleans its stopped clone after refusal', () => {
  let checks = 0;
  const fixture = lumeFixture({ assessHostResources: () => ({
    decision: ++checks <= 2 ? 'allow' : 'deny', message: checks <= 2 ? 'Host resources available' : 'Insufficient host memory; close apps and retry.',
  }) });
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /insufficient host memory/i);
  assert.strictEqual(checks, 3);
  assert.ok(fixture.calls.includes('clone'));
  assert.strictEqual(fixture.calls.includes('start'), false);
  assert.strictEqual(fixture.calls.includes('interactive'), false);
  assert.ok(fixture.calls.includes('delete'));
  assert.ok(fixture.calls.includes('clear'));
  assert.strictEqual(fixture.released(), true);
});

test('Lume exploration checks concurrency and releases the reservation after inventory refusal', () => {
  const fixture = lumeFixture({ run: (_executable, argv) => {
    assert.strictEqual(argv[0], 'ls');
    return { status: 0, stdout: '[{"state":"running"},{"state":"starting"}]' };
  } });
  // Tart is unavailable, so only the Lume inventory contributes to this test.
  const invoke = fixture.options.run;
  fixture.options.run = (executable, argv) => executable === 'tart'
    ? { status: null, error: { code: 'ENOENT' } } : invoke(executable, argv);
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /at most two concurrent macOS guests/i);
  assert.strictEqual(fixture.released(), true);
  assert.deepStrictEqual(fixture.resources, []);
});

test('Lume exploration refuses the shell after setup fails and verifies replica cleanup', () => {
  const fixture = lumeFixture();
  const invoke = fixture.options.run;
  fixture.options.run = (executable, argv) => argv.some(arg => arg.includes('printf setup'))
    ? { status: 7, stderr: 'developer kit installation failed' } : invoke(executable, argv);
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /setup failed.*developer kit installation failed/i);
  assert.strictEqual(fixture.calls.includes('interactive'), false);
  assert.ok(fixture.calls.includes('delete'));
  assert.ok(fixture.calls.includes('clear'));
  assert.strictEqual(fixture.released(), true);
  assert.ok(fixture.events.some(event => event.type === 'exploration.setup.failed' && event.exit === 7));
});

test('Lume exploration holds the reservation through cleanup and preserves both admission receipts', () => {
  const fixture = lumeFixture();
  let checks = 0;
  fixture.options.vmCloneBudget = (backend, _seed, _result, options) => {
    assert.strictEqual(backend, 'lume');
    assert.strictEqual(options.storagePath, process.cwd());
    return 7 * 1024 ** 3;
  };
  fixture.options.assessHostResources = (actualManifest, options) => {
    assert.strictEqual(actualManifest.resources.memory, '256MB');
    assert.strictEqual(options.storagePath, process.cwd());
    assert.strictEqual(options.cloneBytes, checks === 1 ? 7 * 1024 ** 3 : 0);
    assert.strictEqual(fixture.released(), false);
    if (++checks <= 2) assert.strictEqual(fixture.calls.includes('clone'), false);
    else assert.ok(fixture.calls.includes('set'));
    assert.strictEqual(fixture.calls.includes('start'), false);
    return { decision: 'allow', message: 'Host resources available', sample: checks };
  };
  const invoke = fixture.options.run;
  fixture.options.run = (executable, argv) => {
    assert.strictEqual(fixture.released(), false);
    return invoke(executable, argv);
  };
  const result = runLumeExploration(manifest(), fixture.options);
  assert.strictEqual(result.exitCode, 0);
  assert.deepStrictEqual(result.cleanup, { pass: true, retained: false });
  assert.strictEqual(checks, 3);
  assert.deepStrictEqual(fixture.events.filter(event => event.type === 'resource.admission').map(event => event.admission.sample), [2, 3]);
  assert.strictEqual(fixture.released(), true);
});

test('Lume exploration fails closed on unavailable resource or storage probes and releases its lock', () => {
  for (const overrides of [
    { assessHostResources: () => ({ decision: 'deny', message: 'Host memory measurement unavailable; retry later.' }) },
    { assessHostResources: () => null },
    { assessHostResources: () => { throw new Error('resource probe failed'); } },
    { vmStoragePath: () => { throw new Error('destination storage unavailable'); } },
  ]) {
    const fixture = lumeFixture(overrides);
    assert.throws(() => runLumeExploration(manifest(), fixture.options), /unavailable|could not be verified|probe failed/i);
    assert.strictEqual(fixture.calls.includes('clone'), false);
    assert.strictEqual(fixture.calls.includes('start'), false);
    assert.strictEqual(fixture.calls.includes('interactive'), false);
    assert.strictEqual(fixture.released(), true);
  }
});

test('Lume exploration reports failed backend clone cleanup as unverified without deleting an unowned partial', () => {
  const fixture = lumeFixture();
  const invoke = fixture.options.run;
  fixture.options.run = (executable, argv) => argv[0] === 'clone'
    ? { status: 1, stderr: 'clone copy failed' } : invoke(executable, argv);
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /clone failed.*clone copy failed/i);
  assert.strictEqual(fixture.calls.includes('start'), false);
  assert.strictEqual(fixture.calls.includes('delete'), false);
  assert.strictEqual(fixture.calls.includes('clear'), false);
  assert.deepStrictEqual(fixture.resources, []);
  assert.ok(fixture.events.some(event => event.type === 'resource.clone.failed' && event.clone.cleanup_pass === false));
  assert.strictEqual(fixture.released(), true);
});

test('Lume exploration stops and deletes a guest that never becomes SSH-ready', () => {
  const fixture = lumeFixture();
  const invoke = fixture.options.run;
  fixture.options.run = (executable, argv) => argv[0] === 'ssh'
    ? { status: 1, stderr: 'SSH refused' } : invoke(executable, argv);
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /did not become SSH-ready/i);
  assert.strictEqual(fixture.calls.includes('interactive'), false);
  assert.ok(fixture.calls.includes('delete'));
  assert.ok(fixture.calls.includes('clear'));
  assert.strictEqual(fixture.released(), true);
});

test('Lume exploration refuses an uninspectable launcher process tree and cleans the guest', () => {
  const fixture = lumeFixture();
  const start = fixture.options.start;
  fixture.options.start = (...args) => {
    const result = start(...args);
    result.child.captureDescendants = () => false;
    return result;
  };
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /could not inspect owned launcher descendants/i);
  assert.strictEqual(fixture.calls.includes('interactive'), false);
  assert.ok(fixture.calls.includes('delete'));
  assert.strictEqual(fixture.released(), true);
});

test('Lume exploration respects the legacy Apple VM lock and releases the shared host lock on refusal', () => {
  const { acquireRunLock } = require('../../scripts/sandbox/backends/vm');
  const legacy = acquireRunLock('apple-macos-guests');
  assert.strictEqual(legacy.pass, true);
  try {
    const fixture = lumeFixture();
    delete fixture.options.acquireLock;
    assert.throws(() => runLumeExploration(manifest(), fixture.options), /shared host VM lifecycle lock/i);
    assert.deepStrictEqual(fixture.calls, []);
    const host = acquireRunLock('host-local-vms');
    assert.strictEqual(host.pass, true);
    host.release();
  } finally {
    legacy.release();
  }
});

test('Lume exploration refuses a changed clone destination and cleans the original pinned storage', () => {
  let resolutions = 0;
  const fixture = lumeFixture({ vmStoragePath: () => ++resolutions === 1 ? '/vm-storage/approved' : '/vm-storage/changed' });
  const invoke = fixture.options.run;
  fixture.options.run = (executable, argv) => {
    if (['stop', 'delete'].includes(argv[0]) || (argv[0] === 'get' && argv[1] === 'fixture-clone')) {
      assert.strictEqual(argv[argv.indexOf('--storage') + 1], '/vm-storage/approved');
    }
    return invoke(executable, argv);
  };
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /storage.*changed/i);
  assert.strictEqual(resolutions, 2);
  assert.strictEqual(fixture.calls.includes('start'), false);
  assert.strictEqual(fixture.calls.includes('interactive'), false);
  assert.ok(fixture.calls.includes('delete'));
  assert.ok(fixture.calls.includes('clear'));
  assert.ok(fixture.resources.some(resource => resource.storage_path === '/vm-storage/approved'));
  assert.strictEqual(fixture.released(), true);
});

test('Lume exploration pins clone, setup and interactive SSH to the admitted storage', () => {
  const fixture = lumeFixture();
  const invoke = fixture.options.run;
  let checkedSetup = false;
  fixture.options.run = (executable, argv) => {
    if (argv[0] === 'clone') {
      assert.strictEqual(argv[argv.indexOf('--source-storage') + 1], process.cwd());
      assert.strictEqual(argv[argv.indexOf('--dest-storage') + 1], process.cwd());
    }
    if (argv[0] === 'ssh') {
      const storageIndex = argv.indexOf('--storage');
      assert.ok(storageIndex > 1 && storageIndex < argv.indexOf('--'));
      assert.strictEqual(argv[storageIndex + 1], process.cwd());
      if (argv.some(arg => arg.includes('printf setup'))) checkedSetup = true;
    }
    return invoke(executable, argv);
  };
  fixture.options.interactive = (_executable, argv) => {
    assert.strictEqual(argv[argv.indexOf('--storage') + 1], process.cwd());
    assert.strictEqual(checkedSetup, true);
    return { status: 0 };
  };
  assert.strictEqual(runLumeExploration(manifest(), fixture.options).exitCode, 0);
});

test('Lume exploration uses a prepared copy-on-write clone with zero copy budget and verifies source state', () => {
  const fixture = lumeFixture();
  const budgets = [];
  let clones = 0;
  fixture.options.vmCloneBudget = () => { throw new Error('prepared COW must not use full-copy budget'); };
  fixture.options.prepareLumeClone = (seedPath, destPath, options) => {
    assert.strictEqual(seedPath, path.join(process.cwd(), 'fixture-seed'));
    assert.strictEqual(destPath, path.join(process.cwd(), 'fixture-clone'));
    assert.strictEqual(fixture.released(), false);
    assert.strictEqual(options.verifySourceStopped(), true);
    return Object.freeze({ supported: true, cloneBytes: 0, code: 'lume_cow_ready', message: 'COW verified', clone: () => {
      assert.strictEqual(options.verifySourceStopped(), true);
      assert.strictEqual(fixture.released(), false);
      clones += 1;
      return { ok: true, code: 'lume_cow_cloned', message: 'COW cloned', copy_method: 'clonefile-required' };
    } });
  };
  fixture.options.assessHostResources = (_manifest, options) => {
    budgets.push(options.cloneBytes);
    return { decision: 'allow', message: 'Host resources available' };
  };
  const outcome = runLumeExploration(manifest(), fixture.options);
  assert.strictEqual(outcome.exitCode, 0);
  assert.strictEqual(clones, 1);
  assert.deepStrictEqual(budgets, [0, 0, 0]);
  assert.strictEqual(fixture.calls.includes('clone'), false);
  assert.ok(fixture.events.some(event => event.type === 'resource.clone.completed'
    && event.clone.copy_method === 'clonefile-required' && event.text === 'COW cloned'));
});

test('Lume exploration refuses a prepared COW failure without a CLI full-copy fallback', () => {
  const fixture = lumeFixture({ prepareLumeClone: () => ({
    supported: true, cloneBytes: 0, code: 'lume_cow_ready', message: 'COW verified',
    clone: () => ({ ok: false, code: 'lume_cow_failed', message: 'COW failed; full-copy fallback disabled', copy_method: 'clonefile-required' }),
  }) });
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /COW failed.*fallback disabled/i);
  assert.strictEqual(fixture.calls.includes('clone'), false);
  assert.strictEqual(fixture.calls.includes('start'), false);
  assert.strictEqual(fixture.calls.includes('delete'), false);
  assert.deepStrictEqual(fixture.resources, []);
  assert.strictEqual(fixture.released(), true);
  assert.ok(fixture.events.some(event => event.type === 'resource.clone.failed' && event.clone.code === 'lume_cow_failed'));
});

test('Lume exploration preserves the conservative copy budget when COW preparation is unsupported', () => {
  const fixture = lumeFixture({ prepareLumeClone: () => ({
    supported: false, cloneBytes: null, code: 'lume_cow_unavailable', message: 'Unsupported Lume version',
    clone: () => { throw new Error('unsupported prepared operation must not execute'); },
  }), vmCloneBudget: () => 12 * 1024 ** 3 });
  const budgets = [];
  fixture.options.assessHostResources = (_manifest, options) => {
    budgets.push(options.cloneBytes);
    return { decision: 'allow', message: 'Host resources available' };
  };
  runLumeExploration(manifest(), fixture.options);
  assert.deepStrictEqual(budgets, [0, 12 * 1024 ** 3, 0]);
  assert.ok(fixture.calls.includes('clone'));
  assert.ok(fixture.events.some(event => event.type === 'resource.clone.prepared' && event.clone.supported === false));
});

test('Lume exploration refuses host pressure before preparing or compiling the clone helper', () => {
  const fixture = lumeFixture({
    assessHostResources: () => ({ decision: 'deny', message: 'Host memory pressure is warning; close apps and retry.' }),
    prepareLumeClone: () => { throw new Error('helper preparation must not run under pressure'); },
  });
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /Host memory pressure is warning/i);
  assert.strictEqual(fixture.calls.includes('clone'), false);
  assert.strictEqual(fixture.released(), true);
  assert.strictEqual(fixture.events.length, 1);
  assert.strictEqual(fixture.events[0].type, 'resource.admission');
});

test('Lume exploration refuses prepared cloning when the source starts after preparation', () => {
  const fixture = lumeFixture();
  const invoke = fixture.options.run;
  let sourceRunning = false;
  fixture.options.run = (executable, argv) => argv[0] === 'get' && argv[1] === 'fixture-seed' && sourceRunning
    ? { status: 0, stdout: '{"state":"running","os":"macos"}' } : invoke(executable, argv);
  fixture.options.prepareLumeClone = (_seedPath, _destPath, options) => {
    assert.strictEqual(options.verifySourceStopped(), true);
    sourceRunning = true;
    return { supported: true, cloneBytes: 0, code: 'lume_cow_ready', message: 'COW verified', clone() {
      assert.strictEqual(options.verifySourceStopped(), false);
      throw new Error('Source stopped state unverified');
    } };
  };
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /Source stopped state unverified/);
  assert.strictEqual(fixture.calls.includes('clone'), false);
  assert.strictEqual(fixture.calls.includes('start'), false);
  assert.strictEqual(fixture.released(), true);
  assert.ok(fixture.events.some(event => event.type === 'resource.clone.failed'));
});

test('Lume exploration fails closed on malformed prepared clone contracts and result proofs', () => {
  for (const plan of [
    { supported: true, cloneBytes: 4, clone() {} },
    { supported: true, cloneBytes: 0 },
    { supported: true, cloneBytes: 0, clone: () => ({ ok: true, copy_method: 'ordinary-copy' }) },
    { supported: true, cloneBytes: 0, clone: () => null },
  ]) {
    const fixture = lumeFixture({ prepareLumeClone: () => plan });
    assert.throws(() => runLumeExploration(manifest(), fixture.options), /clone.*contract|clone failed/i);
    assert.strictEqual(fixture.calls.includes('clone'), false);
    assert.strictEqual(fixture.calls.includes('start'), false);
    assert.strictEqual(fixture.released(), true);
  }
});

test('Lume exploration preserves an existing destination when prepared clone ownership was refused', () => {
  const fixture = lumeFixture({ prepareLumeClone: () => ({
    supported: true, cloneBytes: 0, code: 'lume_cow_ready', message: 'COW prepared', clone() {
      throw Object.assign(new Error('Destination already exists'), { receipt: {
        ok: false, code: 'lume_cow_failed', message: 'Destination already exists', owned_destination: false, cleanup_pass: true,
      } });
    },
  }) });
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /Destination already exists/);
  assert.strictEqual(fixture.calls.includes('stop'), false);
  assert.strictEqual(fixture.calls.includes('delete'), false);
  assert.deepStrictEqual(fixture.resources, []);
  assert.strictEqual(fixture.released(), true);
});

test('Lume exploration cleans only a helper-owned partial destination that the helper retained', () => {
  for (const alreadyCleaned of [false, true]) {
    const fixture = lumeFixture({ prepareLumeClone: () => ({
      supported: true, cloneBytes: 0, code: 'lume_cow_ready', message: 'COW prepared', clone() {
        throw Object.assign(new Error('Partial COW clone failed'), { receipt: {
          ok: false, code: 'lume_cow_failed', message: 'Partial COW clone failed', owned_destination: true, cleanup_pass: alreadyCleaned,
        } });
      },
    }) });
    assert.throws(() => runLumeExploration(manifest(), fixture.options), /Partial COW clone failed/);
    assert.strictEqual(fixture.calls.includes('delete'), !alreadyCleaned);
    assert.strictEqual(fixture.resources.length > 0, !alreadyCleaned);
    assert.strictEqual(fixture.calls.includes('clone'), false);
    assert.strictEqual(fixture.calls.includes('start'), false);
    assert.strictEqual(fixture.released(), true);
  }
});

test('Lume exploration refuses an occupied destination before preparing or falling back to backend clone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-lume-existing-'));
  const occupied = path.join(root, 'fixture-clone');
  fs.mkdirSync(occupied);
  fs.writeFileSync(path.join(occupied, 'keep.txt'), 'existing VM');
  try {
    const fixture = lumeFixture({
      vmStoragePath: () => root,
      prepareLumeClone: () => { throw new Error('occupied destination must fail before preparation'); },
    });
    assert.throws(() => runLumeExploration(manifest(), fixture.options), /destination already exists/i);
    assert.strictEqual(fixture.calls.includes('clone'), false);
    assert.strictEqual(fixture.calls.includes('stop'), false);
    assert.strictEqual(fixture.calls.includes('delete'), false);
    assert.deepStrictEqual(fixture.resources, []);
    assert.strictEqual(fs.readFileSync(path.join(occupied, 'keep.txt'), 'utf8'), 'existing VM');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Lume exploration preserves a destination that appears during unsupported helper preparation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-lume-raced-'));
  const occupied = path.join(root, 'fixture-clone');
  try {
    const fixture = lumeFixture({
      vmStoragePath: () => root,
      prepareLumeClone: () => {
        fs.mkdirSync(occupied);
        return { supported: false, code: 'lume_cow_unavailable', message: 'COW unavailable' };
      },
    });
    assert.throws(() => runLumeExploration(manifest(), fixture.options), /destination already exists/i);
    assert.strictEqual(fixture.calls.includes('clone'), false);
    assert.strictEqual(fixture.calls.includes('delete'), false);
    assert.deepStrictEqual(fixture.resources, []);
    assert.strictEqual(fs.existsSync(occupied), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Lume exploration refuses a dangling destination symlink without assuming ownership', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-lume-dangling-'));
  const destination = path.join(root, 'fixture-clone');
  fs.symlinkSync(path.join(root, 'missing-vm'), destination);
  try {
    const fixture = lumeFixture({ vmStoragePath: () => root });
    assert.throws(() => runLumeExploration(manifest(), fixture.options), /destination already exists/i);
    assert.strictEqual(fixture.calls.includes('clone'), false);
    assert.strictEqual(fixture.calls.includes('delete'), false);
    assert.deepStrictEqual(fixture.resources, []);
    assert.strictEqual(fs.lstatSync(destination).isSymbolicLink(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Lume exploration emits a real admission receipt from a safely simulated pressure probe', () => {
  const { assessHostResources } = require('../../scripts/sandbox/host-resources');
  const fixture = lumeFixture({ assessHostResources: (request, options) => assessHostResources(request, {
    ...options, platform: 'darwin',
    run: (executable, argv) => {
      assert.strictEqual(executable, '/usr/sbin/sysctl');
      assert.deepStrictEqual(argv, ['-n', 'kern.memorystatus_vm_pressure_level']);
      return { status: 0, stdout: '2' };
    },
    statfs: () => { throw new Error('pressure refusal should precede the disk probe'); },
  }) });
  assert.throws(() => runLumeExploration(manifest(), fixture.options), /host memory pressure is warning/i);
  const event = fixture.events.find(item => item.type === 'resource.admission');
  assert.strictEqual(event.admission.schema_version, 1);
  assert.strictEqual(event.admission.decision, 'deny');
  assert.strictEqual(event.admission.code, 'host_memory_pressure');
  assert.strictEqual(event.admission.clone_bytes, 0);
  assert.strictEqual(event.text, event.admission.message);
  assert.strictEqual(fixture.calls.includes('clone'), false);
});

test('Lume exploration registers helper ownership and clears helpers only after verified deletion', () => {
  const fixture = lumeFixture();
  const start = fixture.options.start;
  const cleared = [];
  fixture.options.start = (executable, argv, options) => {
    options.onHelper({ pid: 56_565, pgid: 56_565, started: 'fixture', command: '/usr/bin/ssh lume@192.0.2.20' });
    return start(executable, argv, options);
  };
  fixture.options.clearResource = resource => {
    assert.ok(fixture.calls.includes('delete'));
    cleared.push(resource);
  };
  runLumeExploration(manifest(), fixture.options);
  assert.ok(fixture.resources.some(resource => resource.kind === 'lume-helper' && resource.pid === 56_565));
  assert.deepStrictEqual(cleared, [
    { kind: 'lume-helper', name: '56565' }, { kind: 'lume', name: 'fixture-clone' },
  ]);
});

test('Podman exploration registers its replica before start and clears only after removal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-explore-resource-test-'));
  try {
    const manifestPath = path.join(root, 'manifest.yaml');
    fs.writeFileSync(manifestPath, 'fixture');
    const created = createRun({
      root, manifestPath, manifestDigest: 'a'.repeat(64), exploration: true,
      sourceRunId: 'run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
    });
    updateState(created.run_id, root, { status: 'exploring' });
    const calls = [];
    const run = (_executable, argv) => {
      calls.push(argv);
      if (argv[0] === 'info') return { status: 0, stdout: '{"host":{"security":{"rootless":true}}}', stderr: '' };
      if (argv[0] === 'image') return { status: 0, stdout: `sha256:${'a'.repeat(64)}\n`, stderr: '' };
      if (argv[0] === 'create') return { status: 0, stdout: `${'b'.repeat(64)}\n`, stderr: '' };
      if (argv[0] === 'start') assert.strictEqual(readResources(created.run_id, root)[0].kind, 'podman');
      return { status: 0, stdout: '', stderr: '' };
    };
    const session = require('../../scripts/sandbox/session-store').readRun(created.run_id, root).session;
    runPodmanExploration(manifest(), {
      cwd: root, runId: created.run_id, ownerToken: session.owner_token,
      name: 'ecc-explore-podman-abcdefabcdefabcdefabcdef', run,
      registerResource: resource => require('../../scripts/sandbox/session-store').writeResource(
        created.run_id, root, { ...resource, owner_token: session.owner_token }
      ),
      clearResource: selector => require('../../scripts/sandbox/session-store').clearResource(
        created.run_id, root, session.owner_token, selector
      ),
    });
    assert.strictEqual(readResources(created.run_id, root).length, 0);
    assert.strictEqual(calls.at(-1)[0], 'rm');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('exploration source sessions must have completed verification first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-explore-test-'));
  try {
    const manifestPath = path.join(root, 'sandbox.yaml');
    fs.writeFileSync(manifestPath, 'name: placeholder\n');
    const created = createRun({
      root, manifestPath, manifestDigest: 'a'.repeat(64),
      route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
    });
    assert.notStrictEqual(created.state.status, 'completed');
    updateState(created.run_id, root, { status: 'completed' });
    assert.strictEqual(require('../../scripts/sandbox/session-store').readRun(created.run_id, root).state.status, 'completed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('completed review exploration honors macOS Terminal.app selection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-explore-terminal-test-'));
  try {
    const { manifestPath } = writeManifest(root);
    const prompt = 'Would you like to launch a Tier 1 rootless Podman sandbox with '
      + 'a clean Linux home, a read-only source mount, and networking disabled, '
      + 'for testing hands-on backend inspection? y/n';
    const created = createRun({
      root,
      manifestPath,
      manifestDigest: crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex'),
      route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
      terminal: 'wezterm',
      purpose: 'hands-on backend inspection',
      consent: { decision: 'y', prompt, granted_at: '2026-09-02T12:00:00.000Z' },
    });
    updateState(created.run_id, root, { status: 'completed' });
    const plans = [];
    const result = createExploration(created.run_id, root, {
      cliPath: '/trusted/ecc-sandbox',
      terminal: 'terminal.app',
    }, {
      launch: plan => {
        plans.push(plan);
        return { strategy: 'app' };
      },
      spawn: () => ({ pid: 4545, once() {}, unref() {} }),
    });

    assert.strictEqual(result.result, 'launching');
    assert.strictEqual(result.state, 'launching');
    assert.strictEqual(result.terminal, 'terminal.app');
    assert.strictEqual(plans.length, 1);
    assert.strictEqual(plans[0].terminal, 'terminal.app');
    assert.strictEqual(plans[0].command, '/usr/bin/osascript');
    assert.ok(plans[0].argv.includes('_explore'));
    assert.strictEqual(readRun(result.run_id, root).session.terminal, 'terminal.app');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
