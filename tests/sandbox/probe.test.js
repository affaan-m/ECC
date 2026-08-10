'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateCapabilities } = require('../../scripts/sandbox/contracts');
const { defaultHost } = require('../../scripts/sandbox/router');
const {
  probeCapabilities,
  readCapabilityCache,
  reportsVersion,
  writeCapabilityCache,
} = require('../../scripts/sandbox/probe');

const repoRoot = path.join(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'scripts', 'sandbox', 'ecc-sandbox');
const SUBPROCESS_TIMEOUT_MS = 30_000;
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

function result(status, stdout = '', stderr = '') {
  return { status, stdout, stderr, error: null };
}

function missing(executable) {
  const error = new Error(`spawn ${executable} ENOENT`);
  error.code = 'ENOENT';
  return { status: null, stdout: '', stderr: '', error };
}

function fakeRunner(platform, installed = {}) {
  return (executable, argv = []) => {
    const command = `${executable} ${argv.join(' ')}`;
    if (executable === 'sysctl') return result(0, installed.virtualization ? '1\n' : '0\n');
    if (executable === 'powershell.exe' && command.includes('VirtualizationFirmwareEnabled')) {
      return result(0, installed.virtualization ? 'True\n' : 'False\n');
    }
    if (executable === 'powershell.exe' && command.includes('Microsoft-Hyper-V-All')) {
      return result(installed.hyperv ? 0 : 1, installed.hyperv ? 'Enabled\n' : 'Disabled\n');
    }
    if (executable === 'podman' && argv[0] === 'machine') {
      return result(0, JSON.stringify([{ Running: Boolean(installed.podmanRunning) }]));
    }
    if (executable === 'podman' && argv[0] === 'info') {
      return installed.podmanRunning
        ? result(0, JSON.stringify({
          host: { security: { rootless: installed.podmanRootless !== false } },
        }))
        : result(1, '', 'not ready');
    }
    if (executable === 'docker' && argv[0] === 'info') {
      return installed.docker ? result(0, '"27.0"') : missing(executable);
    }
    if (executable === 'gh' && argv[0] === 'auth') {
      return installed.ghAuth ? result(0, '', 'authenticated') : result(1, '', 'not logged in');
    }
    if (executable === 'cmd.exe' && command.includes('C:\\Tools\\srt.cmd --version')) {
      return installed.srt ? result(0, 'srt 1.0.0\n') : missing('srt.cmd');
    }
    if (executable === 'cmd.exe' && command.includes('C:\\Tools\\srt.cmd -c echo ecc-srt-probe')) {
      return installed.srtReady === false
        ? result(1, '', 'Windows sandbox is not installed')
        : result(0, 'ecc-srt-probe\n');
    }
    if (executable === 'srt' && argv[0] === '-c') {
      return installed.srtReady === false
        ? result(1, '', 'Windows sandbox is not installed')
        : result(0, 'ecc-srt-probe\n');
    }
    const aliases = {
      srt: 'srt 1.0.0',
      podman: 'podman version 6.0.0',
      docker: 'Docker version 27.0.0',
      msb: installed.msbVersion || 'msb 0.6.8',
      lume: installed.lumeVersion || 'lume 0.5.1',
      limactl: installed.limaVersion || 'limactl version 2.2.0',
      tart: installed.tartVersion || '2.32.1',
      gh: 'gh version 2.80.0',
      wsb: 'Windows Sandbox CLI',
    };
    const key = executable === 'wsb' ? 'windowsSandbox' : executable;
    if (installed[key]) return result(0, `${aliases[executable]}\n`);
    return missing(executable);
  };
}

function commonOptions(platform, architecture, installed, extras = {}) {
  return {
    platform,
    architecture,
    cpus: 8,
    now: new Date('2026-08-08T12:00:00.000Z'),
    run: fakeRunner(platform, installed),
    fileExists: extras.fileExists || (filePath => (
      platform === 'win32'
      && installed.srt
      && filePath.toLowerCase() === 'c:\\tools\\srt.cmd'
    )),
    readFile: extras.readFile || (() => ''),
    canAccess: extras.canAccess || (() => Boolean(installed.virtualization)),
    env: extras.env || (platform === 'win32' ? { Path: 'C:\\Tools' } : {}),
  };
}

console.log('\n=== ECC sandbox probe tests ===\n');

test('probes a ready Apple Silicon macOS host', () => {
  const capabilities = probeCapabilities(commonOptions('darwin', 'arm64', {
    virtualization: true,
    srt: true,
    podman: true,
    podmanRunning: true,
    docker: true,
    msb: true,
    lume: true,
    limactl: true,
    tart: true,
    gh: true,
    ghAuth: true,
  }));
  assert.strictEqual(capabilities.host.os, 'macos');
  assert.strictEqual(capabilities.host.virtualization, 'available');
  for (const name of ['srt', 'podman', 'docker', 'microsandbox', 'lume', 'lima', 'tart', 'ci']) {
    assert.strictEqual(capabilities.backends[name].available, true, name);
  }
  assert.ok(capabilities.backends.microsandbox.capabilities.includes('domain-network-policy'));
  assert.strictEqual(capabilities.backends['windows-sandbox'].available, false);
});

test('disables weaker nested SRT on a Linux container', () => {
  const capabilities = probeCapabilities(commonOptions('linux', 'x64', {
    virtualization: true,
    srt: true,
    podman: true,
    podmanRunning: true,
    msb: true,
    limactl: true,
  }, {
    fileExists: filePath => filePath === '/.dockerenv',
  }));
  assert.strictEqual(capabilities.host.inside_container, true);
  assert.strictEqual(capabilities.backends.srt.available, false);
  assert.match(capabilities.backends.srt.reason, /nested mode/);
  assert.strictEqual(capabilities.backends.podman.available, true);
  assert.strictEqual(capabilities.backends.microsandbox.available, true);
});

test('rejects rootful Podman on Linux', () => {
  const capabilities = probeCapabilities(commonOptions('linux', 'x64', {
    virtualization: true,
    podman: true,
    podmanRunning: true,
    podmanRootless: false,
  }));
  assert.strictEqual(capabilities.backends.podman.available, false);
  assert.strictEqual(capabilities.backends.podman.state, 'unavailable');
  assert.match(capabilities.backends.podman.reason, /requires rootless/);
  assert.match(capabilities.backends.podman.fix, /unprivileged user/);
});

test('enables weaker nested SRT only through an explicit opt-in', () => {
  const capabilities = probeCapabilities(commonOptions('linux', 'x64', {
    virtualization: true,
    srt: true,
  }, {
    fileExists: filePath => filePath === '/.dockerenv',
    env: { ECC_SANDBOX_ALLOW_NESTED_SRT: '1' },
  }));
  assert.strictEqual(capabilities.backends.srt.available, true);
  assert.match(capabilities.backends.srt.reason, /explicitly enabled/);
});

test('reads the nested SRT opt-in from the real process environment', () => {
  const original = process.env.ECC_SANDBOX_ALLOW_NESTED_SRT;
  process.env.ECC_SANDBOX_ALLOW_NESTED_SRT = '1';
  try {
    const options = commonOptions('linux', 'x64', {
      virtualization: true,
      srt: true,
    }, {
      fileExists: filePath => filePath === '/.dockerenv',
    });
    delete options.env;
    const capabilities = probeCapabilities(options);
    assert.strictEqual(capabilities.backends.srt.available, true);
  } finally {
    if (original === undefined) {
      delete process.env.ECC_SANDBOX_ALLOW_NESTED_SRT;
    } else {
      process.env.ECC_SANDBOX_ALLOW_NESTED_SRT = original;
    }
  }
});

test('probes Windows Sandbox, Hyper-V, WHP, and Podman machine state', () => {
  const capabilities = probeCapabilities(commonOptions('win32', 'x64', {
    virtualization: true,
    windowsSandbox: true,
    hyperv: true,
    podman: true,
    podmanRunning: true,
    msb: true,
    gh: true,
    ghAuth: true,
  }));
  assert.strictEqual(capabilities.host.os, 'windows');
  assert.strictEqual(capabilities.backends['windows-sandbox'].available, false);
  assert.strictEqual(capabilities.backends['windows-sandbox'].state, 'detected-redirect');
  assert.strictEqual(capabilities.backends['hyper-v'].available, false);
  assert.strictEqual(capabilities.backends['hyper-v'].state, 'detected-redirect');
  assert.strictEqual(capabilities.backends.microsandbox.available, true);
  assert.strictEqual(capabilities.backends.podman.state, 'ready');
});

test('requires the one-time Windows SRT provisioning before reporting ready', () => {
  const capabilities = probeCapabilities(commonOptions('win32', 'x64', {
    virtualization: true,
    srt: true,
    srtReady: false,
  }));
  assert.strictEqual(capabilities.backends.srt.available, false);
  assert.strictEqual(capabilities.backends.srt.state, 'not-configured');
  assert.match(capabilities.backends.srt.fix, /windows-install/);
});

test('reports actionable setup commands without recommending Docker', () => {
  const capabilities = probeCapabilities(commonOptions('darwin', 'arm64', {
    virtualization: true,
  }));
  assert.match(capabilities.backends.podman.fix, /brew install podman/);
  assert.match(capabilities.backends.srt.fix, /npm install -g/);
  assert.match(capabilities.backends.ci.fix, /gh auth login/);
  assert.strictEqual(capabilities.backends.docker.fix, undefined);
});

test('reports host-appropriate setup commands', () => {
  const windows = probeCapabilities(commonOptions('win32', 'x64', {
    virtualization: true,
  }));
  assert.match(windows.backends.podman.fix, /winget install/);
  assert.match(windows.backends.ci.fix, /GitHub\.cli/);
  assert.doesNotMatch(windows.backends.podman.fix, /brew/);
  assert.strictEqual(windows.backends.lume.fix, undefined);
  assert.strictEqual(windows.backends.lima.fix, undefined);

  const linux = probeCapabilities(commonOptions('linux', 'x64', {
    virtualization: true,
  }));
  assert.match(linux.backends.podman.fix, /apt-get install podman/);
  assert.match(linux.backends.microsandbox.fix, /microsandbox-cli --version 0\.6\.8/);
  assert.doesNotMatch(linux.backends.ci.fix, /brew/);
});

test('rejects Microsandbox versions outside the pinned adapter contract', () => {
  const capabilities = probeCapabilities(commonOptions('linux', 'x64', {
    virtualization: true,
    msb: true,
    msbVersion: 'msb 0.7.0',
  }));
  assert.strictEqual(capabilities.backends.microsandbox.available, false);
  assert.match(capabilities.backends.microsandbox.reason, /pinned 0\.6\.8/);
});

test('rejects Tier 2 CLI versions outside their pinned adapter contracts', () => {
  const capabilities = probeCapabilities(commonOptions('darwin', 'arm64', {
    virtualization: true,
    lume: true,
    lumeVersion: 'lume 0.6.0',
    limactl: true,
    limaVersion: 'limactl version 2.3.0',
    tart: true,
    tartVersion: '2.33.0',
  }));
  for (const [backend, version] of [['lume', '0.5.1'], ['lima', '2.2.0'], ['tart', '2.32.1']]) {
    assert.strictEqual(capabilities.backends[backend].available, false, backend);
    assert.match(capabilities.backends[backend].reason, new RegExp(`pinned ${version.replace(/\./g, '\\.')}`));
  }
  assert.strictEqual(capabilities.backends.tart.fix, undefined);
});

test('exact version probes reject prerelease and extended version tokens', () => {
  assert.strictEqual(reportsVersion('lume 0.5.1', '0.5.1'), true);
  assert.strictEqual(reportsVersion('lume 0.5.1-rc.1', '0.5.1'), false);
  assert.strictEqual(reportsVersion('limactl version 2.2.0-beta.0', '2.2.0'), false);
  assert.strictEqual(reportsVersion('tart 2.32.1.1', '2.32.1'), false);
});

test('starts an existing stopped Podman machine without reinitializing it', () => {
  const capabilities = probeCapabilities(commonOptions('darwin', 'arm64', {
    virtualization: true,
    podman: true,
    podmanRunning: false,
  }));
  assert.strictEqual(capabilities.backends.podman.available, false);
  assert.strictEqual(capabilities.backends.podman.fix, 'Start Podman: podman machine start');
});

test('rejects a rootful Podman machine', () => {
  const capabilities = probeCapabilities(commonOptions('darwin', 'arm64', {
    virtualization: true,
    podman: true,
    podmanRunning: true,
    podmanRootless: false,
  }));
  assert.strictEqual(capabilities.backends.podman.available, false);
  assert.match(capabilities.backends.podman.reason, /rootful/);
  assert.match(capabilities.backends.podman.fix, /rootful=false/);
});

test('writes and reads a private schema-valid capability cache', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-probe-cache-'));
  try {
    const cachePath = path.join(tempRoot, 'nested', 'capabilities.json');
    const capabilities = probeCapabilities(commonOptions('linux', 'x64', {
      virtualization: true,
      podman: true,
      podmanRunning: true,
    }));
    writeCapabilityCache(cachePath, capabilities);
    assert.deepStrictEqual(readCapabilityCache(cachePath), capabilities);
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(cachePath).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI mock probe preserves JSON-only output and cache reuse', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-probe-cli-'));
  try {
    const host = defaultHost();
    const mockPath = path.join(tempRoot, 'mock.json');
    const cachePath = path.join(tempRoot, 'cache.json');
    const mock = validateCapabilities({
      schema_version: 1,
      generated_at: '2026-08-08T12:00:00.000Z',
      host: { os: host.os, arch: host.arch },
      backends: { srt: { available: false, reason: 'mocked' } },
    });
    fs.writeFileSync(mockPath, JSON.stringify(mock));
    const first = spawnSync(process.execPath, [
      cliPath,
      'probe',
      '--mock',
      mockPath,
      '--cache',
      cachePath,
    ], { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: SUBPROCESS_TIMEOUT_MS });
    assert.ifError(first.error);
    assert.strictEqual(first.status, 0, first.stderr);
    assert.deepStrictEqual(JSON.parse(first.stdout), mock);
    const second = spawnSync(process.execPath, [cliPath, 'probe', '--cache', cachePath], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
      timeout: SUBPROCESS_TIMEOUT_MS,
    });
    assert.strictEqual(second.status, 0, second.stderr);
    assert.deepStrictEqual(JSON.parse(second.stdout), mock);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
