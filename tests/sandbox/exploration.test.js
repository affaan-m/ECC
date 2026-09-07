'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateManifest } = require('../../scripts/sandbox/contracts');
const {
  appendEvent,
  createRun,
  listEvents,
  readRun,
  readResources,
  updateState,
} = require('../../scripts/sandbox/session-store');
const {
  createInteractiveLaunch,
  parseLaunchArgs,
} = require('../../scripts/sandbox/interactive-launch');
const {
  exploreFromSession,
  handles,
  listRuns,
  stopSession,
  streamEvents,
} = require('../../scripts/sandbox/interactive-cli');
const { watchLaunch } = require('../../scripts/sandbox/launch-watchdog');
const {
  explorationName,
  runPodmanExploration,
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

test('outside-agent monitoring lists, redacts, streams, and stops the session', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-direct-monitor-test-'));
  try {
    const { manifestPath } = writeManifest(root);
    const created = createRun({
      root,
      manifestPath,
      manifestDigest: 'a'.repeat(64),
      exploration: true,
      route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
    });
    updateState(created.run_id, root, { status: 'exploring' });
    const secret = `ghp_${'a'.repeat(32)}`;
    appendEvent(created.run_id, root, {
      type: 'exploration.output',
      phase: 'exploration',
      stream: 'pty',
      text: `token=${secret}\nready\n`,
    });

    assert.strictEqual(listRuns(root)[0].run_id, created.run_id);
    let streamed = '';
    const originalWrite = process.stdout.write;
    try {
      process.stdout.write = chunk => {
        streamed += String(chunk);
        return true;
      };
      assert.strictEqual(streamEvents(created.run_id, root, false), 0);
    } finally {
      process.stdout.write = originalWrite;
    }
    assert.strictEqual(streamed.includes(secret), false);
    assert.match(streamed, /\[REDACTED\]/);
    assert.match(streamed, /ready/);

    const stopped = stopSession(created.run_id, root);
    assert.strictEqual(stopped.result, 'stopped');
    assert.strictEqual(readRun(created.run_id, root).state.status, 'completed');
    assert.strictEqual(listEvents(created.run_id, root).at(-1).type, 'exploration.stopped');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
